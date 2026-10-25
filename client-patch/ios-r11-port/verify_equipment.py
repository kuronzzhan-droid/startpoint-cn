"""Independent package/native readback of the equipment-only candidate."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import struct
import zipfile


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class Image:
    def __init__(self, raw):
        assert struct.unpack_from('<II', raw) == (0xFEEDFACF, 0x100000C)
        self.raw, self.commands, self.segments, self.sections = raw, [], [], {}
        at = 32
        for _ in range(struct.unpack_from('<I', raw, 16)[0]):
            command, size = struct.unpack_from('<II', raw, at)
            assert size >= 8 and at + size <= len(raw)
            self.commands.append((at, command, raw[at:at + size]))
            if command == 0x19:
                name = raw[at + 8:at + 24].rstrip(b'\0').decode()
                vm, vs, off, fs = struct.unpack_from('<QQQQ', raw, at + 24)
                assert off + fs <= len(raw) and fs <= vs
                self.segments.append(dict(name=name, vm=vm, vs=vs, off=off, fs=fs))
                for i in range(struct.unpack_from('<I', raw, at + 64)[0]):
                    base = at + 72 + 80 * i
                    section_name = raw[base:base + 16].rstrip(b'\0').decode()
                    va, length, offset = struct.unpack_from('<QQI', raw, base + 32)
                    self.sections[name, section_name] = (va, length, offset)
            at += size
        assert at == 32 + struct.unpack_from('<I', raw, 20)[0]
        ranges = sorted((r['vm'], r['vm'] + r['vs']) for r in self.segments if r['vs'])
        assert all(a[1] <= b[0] for a, b in zip(ranges, ranges[1:]))

    def offset(self, va, count=1):
        row, = [r for r in self.segments if r['fs'] and r['vm'] <= va and va + count <= r['vm'] + r['fs']]
        return row['off'] + va - row['vm']

    def read(self, va, count):
        at = self.offset(va, count)
        return self.raw[at:at + count]


def unwind_semantics(raw):
    version, co, nc, po, np, io, ni = struct.unpack_from('<7I', raw)
    assert version == 1
    common = struct.unpack_from('<' + 'I' * nc, raw, co)
    personality = struct.unpack_from('<' + 'I' * np, raw, po)
    index = [struct.unpack_from('<III', raw, io + i * 12) for i in range(ni)]
    assert index[-1][1] == 0
    rows, lsdas = {}, []
    for i, (start, page, lsda) in enumerate(index[:-1]):
        kind, entry_off, count = struct.unpack_from('<IHH', raw, page)
        if kind == 3:
            encoding_off, encoding_count = struct.unpack_from('<HH', raw, page + 8)
            encodings = common + struct.unpack_from('<' + 'I' * encoding_count, raw, page + encoding_off)
            for n in range(count):
                word = struct.unpack_from('<I', raw, page + entry_off + n * 4)[0]
                address = start + (word & 0xFFFFFF)
                assert address not in rows
                rows[address] = encodings[word >> 24]
        else:
            assert kind == 2
            for n in range(count):
                address, encoding = struct.unpack_from('<II', raw, page + entry_off + n * 8)
                assert address not in rows
                rows[address] = encoding
        assert (index[i + 1][2] - lsda) % 8 == 0
        lsdas.extend(struct.unpack_from('<II', raw, n) for n in range(lsda, index[i + 1][2], 8))
    return rows, personality, lsdas, index[-1][0]


def function_starts(image):
    _, _, command = next(r for r in image.commands if r[1] == 0x26)
    at, length = struct.unpack_from('<II', command, 8)
    stream = image.raw[at:at + length]
    values, cursor, current = [], 0, 0
    while cursor < len(stream):
        value, shift = 0, 0
        while True:
            byte = stream[cursor]; cursor += 1
            value |= (byte & 127) << shift
            if byte < 128:
                break
            shift += 7
            assert shift <= 63
        if value == 0:
            assert not any(stream[cursor:])
            return set(values)
        current += value
        values.append(current)
    raise AssertionError('unterminated function starts')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-report', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = json.loads(args.package_report.read_text(encoding='utf-8'))
    linked = json.loads(Path(report['link_report']).read_text(encoding='utf-8'))
    assert report['status'] == 'unsigned_offline_candidate' and linked['status'] == 'linked_native_not_executed'
    source = linked['source_ipa']
    assert sha(Path(report['ipa']).read_bytes()) == report['ipa_sha256']
    with zipfile.ZipFile(source['ipa']) as old, zipfile.ZipFile(report['ipa']) as new:
        assert old.namelist() == new.namelist() and new.testzip() is None
        changed = []
        for before, after in zip(old.infolist(), new.infolist()):
            assert all(getattr(before, key) == getattr(after, key) for key in
                       ('filename','date_time','compress_type','comment','extra','create_system','external_attr'))
            if old.read(before) != new.read(after):
                changed.append(before.filename)
        assert set(changed) == {source['native_member'], source['swf_member']}
        original, candidate = Image(old.read(source['native_member'])), Image(new.read(source['native_member']))
        assert sha(candidate.raw) == report['native_sha256']
        assert sha(new.read(source['swf_member'])) == report['swf_sha256']
        plist = plistlib.loads(new.read('Payload/worldflipper.app/Info.plist'))
        assert (plist['CFBundleIdentifier'], plist['CFBundleShortVersionString'], plist['CFBundleVersion']) == ('com.kulo.wf','1.8.4','1.8.46')
    plan = json.loads(Path(linked['plan_file']).read_text(encoding='utf-8'))
    directory = Path(linked['plan_file']).parent
    for chunk in plan['chunks']:
        expected = (directory / chunk['file']).read_bytes()
        assert candidate.read(chunk['va'], chunk['bytes']) == expected
    for patch in plan['patches']:
        at = patch['file_offset']
        assert original.raw[at:at + len(bytes.fromhex(patch['before']))].hex() == patch['before']
        assert candidate.raw[at:at + len(bytes.fromhex(patch['after']))].hex() == patch['after']
    for preserved in plan['preserved_native_ranges']:
        assert sha(candidate.read(preserved['va'], preserved['bytes'])) == preserved['sha256']
    old_section = original.sections['__TEXT','__unwind_info']
    new_section = candidate.sections['__TEXT','__unwind_info']
    old_model = unwind_semantics(original.raw[old_section[2]:old_section[2] + old_section[1]])
    new_model = unwind_semantics(candidate.raw[new_section[2]:new_section[2] + new_section[1]])
    assert all(new_model[0].get(at) == encoding for at, encoding in old_model[0].items())
    assert old_model[1:3] == new_model[1:3]
    assert function_starts(original) <= function_starts(candidate)
    for chunk in plan['chunks']:
        assert chunk['va'] - 0x100000000 in function_starts(candidate)
    info = 104549248
    full = Path(linked['full_abc_file']).read_bytes()
    assert candidate.raw[info:info + 20] == hashlib.sha1(full).digest()
    assert struct.unpack_from('<Q', candidate.raw, info + 56)[0] == 101496
    runtime_va, runtime_size = struct.unpack_from('<QQ', candidate.raw, info + 24)
    old_runtime_va, old_runtime_size = struct.unpack_from('<QQ', original.raw, info + 24)
    assert candidate.read(runtime_va, runtime_size) == original.read(old_runtime_va, old_runtime_size)
    allowed = [(0, 32 + struct.unpack_from('<I', candidate.raw, 20)[0]), (info, info + 20),
               (old_section[2], old_section[2] + old_section[1])]
    allowed += [(r['file_offset'], r['file_offset'] + len(bytes.fromhex(r['before']))) for r in plan['patches']]
    end = next(r for r in original.segments if r['name'] == '__LINKEDIT')['off']
    prefix = bytearray(candidate.raw[:end])
    for lo, hi in allowed:
        prefix[lo:hi] = original.raw[lo:hi]
    assert prefix == original.raw[:end], 'Unexpected old native byte changes'
    result = dict(status='independent_actual_equipment_package_readback_passed', ipa=report['ipa'],
                  ipa_sha256=report['ipa_sha256'], changed_members=changed, planned_chunks_exact=len(plan['chunks']),
                  guarded_patches_exact=len(plan['patches']), old_unwind_rows_preserved=len(old_model[0]),
                  personality_and_LSDA_preserved=True, runtime_ABC_unchanged=True,
                  unrelated_native_prefix_unchanged=True, package_identity_preserved=True,
                  signing='unsigned', device_tested=False, native_executed=False)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
