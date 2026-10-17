"""Read Android binary XML and patch only manifest versionCode's integer slot.

No XML/compiler round trip is performed. Public API:
    decode_manifest(raw) -> metadata dict
    patch_version_code(raw, old_code=1008001, new_code=1008002)
        -> (patched_bytes, audit_dict)
"""
from __future__ import annotations

import hashlib
import json
import struct
import zipfile
from pathlib import Path

ANDROID_NS = 'http://schemas.android.com/apk/res/android'
NO_INDEX = 0xFFFFFFFF
TYPE_STRING = 0x03
TYPE_INT_DEC = 0x10
VERSION_CODE_RESOURCE = 0x0101021B


class ManifestError(ValueError):
    """The input is not the exact kind of binary manifest accepted here."""


def _require(condition, message):
    if not condition:
        raise ManifestError(message)


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _string_pool(raw, offset, header_size, chunk_size):
    _require(header_size >= 28, 'short string-pool header')
    count, styles, flags, strings_start, styles_start = struct.unpack_from('<5I', raw, offset + 8)
    _require(header_size + 4 * (count + styles) <= chunk_size, 'invalid string-pool offsets')
    end = offset + (styles_start or chunk_size)
    _require(offset + header_size + 4 * (count + styles) <= offset + strings_start <= end,
             'invalid string-pool data bounds')

    def length(pos, utf8):
        unit = 1 if utf8 else 2
        _require(pos + unit <= end, 'truncated string length')
        value = raw[pos] if utf8 else struct.unpack_from('<H', raw, pos)[0]
        pos += unit
        mask = 0x80 if utf8 else 0x8000
        if value & mask:
            _require(pos + unit <= end, 'truncated long string length')
            following = raw[pos] if utf8 else struct.unpack_from('<H', raw, pos)[0]
            value = ((value & (mask - 1)) << (8 if utf8 else 16)) | following
            pos += unit
        return value, pos

    result = []
    for index in range(count):
        relative = struct.unpack_from('<I', raw, offset + header_size + index * 4)[0]
        pos = offset + strings_start + relative
        _require(offset + strings_start <= pos < end, 'string offset outside pool')
        utf8 = bool(flags & 0x100)
        _, pos = length(pos, utf8)
        if utf8:
            size, pos = length(pos, True)
            terminator = 1
        else:
            size, _ = length(offset + strings_start + relative, False)
            size *= 2
            terminator = 2
        _require(pos + size + terminator <= end, 'truncated string data')
        _require(raw[pos + size:pos + size + terminator] == b'\0' * terminator,
                 'missing string terminator')
        try:
            result.append(raw[pos:pos + size].decode('utf-8' if utf8 else 'utf-16-le'))
        except UnicodeDecodeError as error:
            raise ManifestError('invalid string-pool encoding') from error
    return result


def _parse(raw):
    _require(isinstance(raw, bytes), 'manifest must be bytes')
    _require(len(raw) >= 8, 'truncated XML header')
    xml_type, xml_header, total = struct.unpack_from('<HHI', raw)
    _require(xml_type == 3 and xml_header == 8 and total == len(raw), 'invalid binary XML envelope')
    strings = None
    resources = []
    root = None
    offset = xml_header

    def string(index):
        if index == NO_INDEX:
            return None
        _require(strings is not None and index < len(strings), 'invalid XML string index')
        return strings[index]

    while offset < total:
        _require(offset + 8 <= total, 'truncated XML chunk')
        kind, header_size, size = struct.unpack_from('<HHI', raw, offset)
        _require(8 <= header_size <= size and offset + size <= total and size % 4 == 0,
                 'invalid XML chunk bounds')
        if kind == 1:
            _require(strings is None, 'duplicate XML string pool')
            strings = _string_pool(raw, offset, header_size, size)
        elif kind == 0x180:
            _require(not resources and header_size == 8 and (size - 8) % 4 == 0,
                     'invalid or duplicate XML resource map')
            resources = list(struct.unpack_from('<' + 'I' * ((size - 8) // 4), raw, offset + 8))
        elif kind == 0x102:
            _require(header_size == 16 and size >= 36, 'unexpected start-element layout')
            namespace_index, name_index, attr_start, attr_size, attr_count = struct.unpack_from(
                '<IIHHH', raw, offset + header_size)
            name = string(name_index)
            if root is None:
                _require(name == 'manifest' and namespace_index == NO_INDEX, 'root is not manifest')
                _require(attr_start >= 20 and attr_size == 20, 'unexpected manifest attribute layout')
                attrs_begin = offset + header_size + attr_start
                _require(attrs_begin + attr_size * attr_count <= offset + size, 'truncated manifest attributes')
                attributes = {}
                for index in range(attr_count):
                    pos = attrs_begin + index * attr_size
                    ns, attr_name, raw_value, typed_size, reserved, value_type, value = struct.unpack_from(
                        '<IIIHBBI', raw, pos)
                    _require(typed_size == 8 and reserved == 0, 'unexpected manifest typed-value layout')
                    key = (string(ns), string(attr_name))
                    _require(key not in attributes, f'duplicate manifest attribute: {key}')
                    attributes[key] = {
                        'raw_value': string(raw_value), 'type': value_type, 'data': value,
                        'data_offset': pos + 16, 'type_offset': pos + 15,
                        'resource_id': resources[attr_name] if attr_name < len(resources) else None,
                        'string_value': string(value) if value_type == TYPE_STRING else None,
                    }
                root = {'attributes': attributes, 'chunk_offset': offset, 'chunk_size': size,
                        'attribute_count': attr_count, 'attributes_begin': attrs_begin}
            else:
                _require(name != 'manifest', 'duplicate manifest element')
        offset += size
    _require(root is not None, 'manifest element missing')
    attrs = root['attributes']
    required = [(None, 'package'), (ANDROID_NS, 'versionCode'), (ANDROID_NS, 'versionName')]
    _require(all(key in attrs for key in required), 'required manifest identity/version attributes missing')
    package, code, version = [attrs[key] for key in required]
    _require(package['type'] == TYPE_STRING and version['type'] == TYPE_STRING,
             'package/versionName must be typed strings')
    _require(code['type'] == TYPE_INT_DEC, 'versionCode must be TYPE_INT_DEC (0x10)')
    _require(code['resource_id'] == VERSION_CODE_RESOURCE, 'unexpected versionCode resource ID')
    _require(code['raw_value'] is None, 'versionCode has an unexpected separate raw string')
    root['metadata'] = {
        'package_name': package['string_value'], 'versionCode': code['data'],
        'versionName': version['string_value'], 'version_code_data_offset': code['data_offset'],
        'version_code_type': code['type'], 'version_code_resource_id': code['resource_id'],
    }
    return root


def decode_manifest(raw: bytes) -> dict:
    """Decode required metadata, rejecting ambiguous/noninteger versionCode."""
    return _parse(raw)['metadata']


def patch_version_code(raw: bytes, old_code: int = 1008001, new_code: int = 1008002) -> tuple[bytes, dict]:
    """Hash-neutral elsewhere: replace only the four-byte versionCode data slot."""
    before = decode_manifest(raw)
    _require(before['versionCode'] == old_code, f"versionCode lock failed: {before['versionCode']} != {old_code}")
    _require(isinstance(new_code, int) and old_code < new_code <= 0x7FFFFFFF, 'new versionCode must increase')
    offset = before['version_code_data_offset']
    patched = raw[:offset] + struct.pack('<I', new_code) + raw[offset + 4:]
    after = decode_manifest(patched)
    _require(after == {**before, 'versionCode': new_code}, 'metadata changed beyond versionCode')
    outside_equal = raw[:offset] == patched[:offset] and raw[offset + 4:] == patched[offset + 4:]
    _require(outside_equal and len(raw) == len(patched), 'manifest changed outside versionCode slot')
    report = {
        'before': before, 'after': after, 'manifest_before_sha256': _sha(raw),
        'manifest_after_sha256': _sha(patched), 'manifest_size': len(raw),
        'patched_member': 'AndroidManifest.xml', 'patched_attribute': 'manifest/@android:versionCode',
        'data_offset': offset, 'data_size': 4, 'before_hex': raw[offset:offset + 4].hex(),
        'after_hex': patched[offset:offset + 4].hex(),
        'differing_byte_offsets': [index for index, (left, right) in enumerate(zip(raw, patched)) if left != right],
        'outside_four_byte_slot_identical': outside_equal,
        'outside_slot_sha256': _sha(raw[:offset] + raw[offset + 4:]),
        'package_name_unchanged': before['package_name'] == after['package_name'],
        'versionName_unchanged': before['versionName'] == after['versionName'],
        'application_xml_changed': False,
    }
    return patched, report


def _negative_checks(raw):
    parsed = _parse(raw)
    code = parsed['attributes'][(ANDROID_NS, 'versionCode')]
    checks = []

    def rejected(name, candidate, operation=patch_version_code):
        try:
            operation(candidate)
        except ManifestError as error:
            checks.append({'name': name, 'rejected': True, 'reason': str(error)})
        else:
            raise AssertionError(f'negative input accepted: {name}')

    wrong_code = bytearray(raw)
    struct.pack_into('<I', wrong_code, code['data_offset'], 1008000)
    rejected('unexpected_old_version_code', bytes(wrong_code))
    wrong_type = bytearray(raw)
    wrong_type[code['type_offset']] = 0x11
    rejected('unexpected_integer_type_hex', bytes(wrong_type))
    duplicate = bytearray(raw)
    attr_start = code['data_offset'] - 16
    insertion = parsed['attributes_begin'] + parsed['attribute_count'] * 20
    duplicate[insertion:insertion] = raw[attr_start:attr_start + 20]
    struct.pack_into('<I', duplicate, 4, len(duplicate))
    struct.pack_into('<I', duplicate, parsed['chunk_offset'] + 4, parsed['chunk_size'] + 20)
    struct.pack_into('<H', duplicate, parsed['chunk_offset'] + 16 + 12, parsed['attribute_count'] + 1)
    rejected('duplicate_version_code_attribute', bytes(duplicate))
    rejected('truncated_manifest', raw[:-1])
    return checks


def main():
    root = Path(__file__).resolve().parents[1]
    inputs = {
        'arm': (Path(r'D:\WF\MuMuPlayer\vms\MuMuPlayer-15.0-1\private_shared\wt_v33.apk'),
                '3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532'),
        'x86': (Path(r'D:\WF\bughunt-20261015\apk\in\v33-x86.apk'),
                '572dd17256de6708b9cdcbe752e184a97b44781bce8fd5ffacf7be7413e0c331'),
    }
    reports = {}
    for variant, (path, expected_sha) in inputs.items():
        _require(_sha(path.read_bytes()) == expected_sha, f'input APK hash mismatch: {variant}')
        with zipfile.ZipFile(path) as apk:
            manifest = apk.read('AndroidManifest.xml')
            air = apk.read('assets/META-INF/AIR/application.xml')
        _, report = patch_version_code(manifest)
        report.update(input_apk=str(path), input_apk_sha256=expected_sha,
                      application_xml_sha256=_sha(air), negative_checks=_negative_checks(manifest))
        _require(report['before']['package_name'] == 'com.leiting.wt', 'unexpected package identity')
        _require(report['before']['versionName'] == '1.8.1', 'unexpected versionName')
        reports[variant] = report
    result = {'passed': True, 'operation': '4-byte typed integer data-slot patch only', 'variants': reports}
    output = root / 'audits/version-manifest.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
