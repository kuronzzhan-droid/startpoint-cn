"""Link a reviewed equipment plan and package a fresh unsigned iOS candidate.

Only the supplied output directory is written. Existing source artifacts and
acceptance registries are immutable. No compiler, signer or secret module runs.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import plistlib
import struct
import sys
import zipfile

from compact_unwind import extend as extend_unwind

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
HELPERS = (101439, 101442, 101443)
FIELDS = ('ints', 'uints', 'doubles', 'strings', 'namespaces', 'ns_sets', 'multinames',
          'methods', 'metadata', 'instances', 'classes', 'scripts')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text('utf-8-sig'))


def dump(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + '\n', 'utf8')


def align(value, size=0x4000):
    return (value + size - 1) & -size


def sections(data, link):
    result = []
    for at, command, raw in link.commands(data):
        if command != 0x19:
            continue
        for n in range(struct.unpack_from('<I', raw, 64)[0]):
            start = 72 + 80 * n
            name = raw[start:start + 16].rstrip(b'\0').decode()
            seg = raw[start + 16:start + 32].rstrip(b'\0').decode()
            va, size, off = struct.unpack_from('<QQI', raw, start + 32)
            result.append(dict(name=name, segment=seg, va=va, size=size, off=off, command=at + start))
    return result


def add_executable_segment(native, plan, link):
    """Keep all old segment indices; insert a new RX segment before LINKEDIT."""
    segments = link.segments(native)
    tail = segments[-1]
    require(tail['name'] == '__LINKEDIT', 'LINKEDIT is not the final segment')
    base = plan['future_region']['base_va']
    used = plan['future_region']['end_va'] - base
    require(base == align(max(s['vm'] + s['vs'] for s in segments)), 'plan arena no longer follows this image')
    require(tail['off'] % 0x4000 == base % 0x4000 == 0, 'unaligned new segment')
    size = align(used)
    off = tail['off']
    rx = bytearray(152)
    struct.pack_into('<II16sQQQQiiII', rx, 0, 0x19, 152, b'__EQFIX', base, size, off, size, 5, 5, 1, 0)
    struct.pack_into('<16s16sQQIIIIIIII', rx, 72, b'__text', b'__EQFIX', base, used, off, 4,
                     0, 0, 0x80000400, 0, 0, 0)
    fields = {2: [8, 16], 0xb: [32, 40, 48, 56, 64, 72],
              0x22: [8, 16, 24, 32, 40], 0x80000022: [8, 16, 24, 32, 40]}
    data_commands = {0x1d, 0x1e, 0x26, 0x29, 0x2b, 0x2e, 0x80000033}
    commands = []
    for at, cmd, raw in link.commands(native):
        require(cmd != 0x80000034, 'chained fixups require a different linker')
        row = bytearray(raw)
        if at == tail['command']:
            commands.append(rx)
            struct.pack_into('<Q', row, 24, base + size)
            struct.pack_into('<Q', row, 40, off + size)
        for field in fields.get(cmd, [8] if cmd in data_commands else []):
            value = struct.unpack_from('<I', row, field)[0]
            if value:
                require(value >= off, 'LINKEDIT metadata unexpectedly precedes LINKEDIT')
                struct.pack_into('<I', row, field, value + size)
        commands.append(row)
    old_end = 32 + struct.unpack_from('<I', native, 20)[0]
    new_commands = b''.join(commands)
    new_end = 32 + len(new_commands)
    first_content = min(s['off'] for s in sections(native, link) if s['off'])
    require(new_end <= first_content and not any(native[old_end:new_end]), 'no verified header padding')
    result = bytearray(native[:off] + bytes(size) + native[off:])
    result[32:new_end] = new_commands
    struct.pack_into('<II', result, 16, len(commands), len(new_commands))
    for index, segment in enumerate(link.segments(result)[:-2]):
        require({k: segment[k] for k in ('name', 'vm', 'vs', 'off', 'fs')} ==
                {k: segments[index][k] for k in ('name', 'vm', 'vs', 'off', 'fs')}, 'old segment changed')
    return result, dict(name='__EQFIX', vm=base, off=off, size=size, payload=used,
                        prot=5, index=len(segments) - 1), new_end


def function_starts(data, link):
    at, _, raw = next(row for row in link.commands(data) if row[1] == 0x26)
    off, size = struct.unpack_from('<II', raw, 8)
    stream = data[off:off + size]
    entries, n, address = [], 0, 0
    while n < len(stream):
        value, shift = 0, 0
        while True:
            require(n < len(stream) and shift <= 63, 'invalid function-start ULEB')
            byte = stream[n]
            n += 1
            value |= (byte & 127) << shift
            if not byte & 128:
                break
            shift += 7
        if value == 0:
            require(not any(stream[n:]), 'nonzero function-start bytes after terminator')
            return at, entries
        address += value
        entries.append(address)
    raise ValueError('function-start stream has no terminator')


def object_unwind(record, lief):
    path = Path(record['object_file'])
    raw = path.read_bytes()
    require(sha(raw) == record['object_sha256'], 'compiled object identity changed')
    obj = lief.parse(str(path))
    section = next(s for s in obj.sections if s.name == '__compact_unwind')
    payload = bytes(section.content)
    matches = [(at, struct.unpack_from('<QIIQQ', payload, at)) for at in range(0, len(payload), 32)
               if struct.unpack_from('<Q', payload, at)[0] == record['function_source_start']]
    require(len(matches) == 1, 'missing or ambiguous object unwind function')
    at, (start, size, encoding, personality, lsda) = matches[0]
    require(size == record['raw_function_bytes'] and not personality and not lsda,
            'unwind extent/personality/LSDA needs explicit relocation support')
    require(encoding & 0xff000000 == 0x04000000, 'expected a simple arm64 frame encoding')
    relocs = [struct.unpack_from('<iI', raw, section.relocation_offset + n * 8)
              for n in range(section.numberof_relocations)]
    selected = [(offset, value) for offset, value in relocs if at <= offset < at + 32]
    require(len(selected) == 1 and selected[0][0] == at, 'unexpected compact unwind relocations')
    value = selected[0][1]
    require(value >> 28 == 0 and (value >> 24) & 1 == 0 and (value >> 25) & 3 == 3
            and (value >> 27) & 1 == 0, 'unsupported object unwind relocation')
    target_section = list(obj.sections)[(value & 0xffffff) - 1]
    require(target_section.name == '__text', 'compact unwind does not reference text')
    return dict(method_id=record['method_id'], encoding=encoding, size=size,
                object_file=str(path), object_sha256=record['object_sha256'],
                source_start=start, source_end=start + size, compact_unwind_row_offset=at)


def assert_preserved_ranges(old, new, end, allowed):
    cursor = 0
    for lo, hi in sorted(allowed):
        lo, hi = max(0, lo), min(end, hi)
        if lo >= hi:
            continue
        require(old[cursor:lo] == new[cursor:lo], 'unexpected preexisting native byte change')
        cursor = max(cursor, hi)
    require(old[cursor:end] == new[cursor:end], 'unexpected final preexisting native byte change')


def run(args):
    require(__debug__, 'Python optimization would disable imported contract checks')
    out = args.output.resolve()
    require(not out.exists() and not out.is_relative_to(REPO), 'fresh external output directory required')
    sys.path[:0] = [str(HERE.parent / 'pr43-ios'), str(args.libraries)]
    import native_support as ns
    link = ns.backend()
    import lief
    from macho_signing_layout import assert_signable_layout, insert_before_string_table, linkedit_ranges

    registry = read_json(args.registry)
    reg = registry['artifact']
    plan = read_json(args.plan)
    require(plan['status'] == 'unapplied_relocated_plan_future_addresses_unallocated'
            and plan['method_ids'] == [18392, *HELPERS] and plan['relocation_count'] == 93
            and len(plan['patches']) == 9 and len(plan['chunks']) == 19, 'unexpected equipment plan contract')
    require(plan['native_input_sha256'] == reg['native_sha256'], 'plan differs from selected carrier')
    inputs = {}
    for name, row in plan['input_bindings'].items():
        require(file_sha(row['path']) == row['sha256'], 'plan dependency changed: ' + name)
        inputs[name] = row
    source = Path(reg['ipa'])
    require(file_sha(source) == reg['ipa_sha256'], 'source IPA identity changed')
    with zipfile.ZipFile(source) as archive:
        native = archive.read(reg['native_member'])
        swf = archive.read(reg['swf_member'])
    require(sha(native) == reg['native_sha256'] and sha(swf) == reg['swf_sha256'], 'source members changed')
    assert_signable_layout(native)
    info = reg['aot_info_file_offset']
    require(info == ns.INFO_OFFSET and ns.read64(native, info + 56) == reg['aot_method_count'], 'AOT identity differs')
    old_full = Path(inputs['current_full_abc']['path']).read_bytes()
    full = Path(inputs['candidate_abc']['path']).read_bytes()
    require(hashlib.sha1(old_full).digest() == native[info:info + 20], 'baseline full ABC identity differs')
    require(sha(full) == plan['candidate_abc_sha256'], 'candidate full ABC differs')
    full_digest = hashlib.sha1(full).digest()
    require(full_digest.hex() == plan['candidate_abc_sha1'], 'candidate SHA1 differs')
    abc_offset = link.file_offset(native, ns.read64(native, info + 24), ns.read64(native, info + 32))
    runtime = native[abc_offset:abc_offset + ns.read64(native, info + 32)]
    old_abc, new_abc, runtime_abc = map(link.abcfmt.ABC, (old_full, full, runtime))
    require(len(new_abc.methods) == reg['aot_method_count'], 'candidate method count changed')
    for field in FIELDS:
        require(link.freeze(getattr(old_abc, field)) == link.freeze(getattr(new_abc, field)), 'full ABI changed: ' + field)
        require(link.freeze(getattr(runtime_abc, field)) == link.freeze(getattr(new_abc, field)), 'runtime ABI differs: ' + field)
    changed_bodies = [a[0] for a, b in zip(old_abc.bodies, new_abc.bodies) if link.freeze(a) != link.freeze(b)]
    require(len(old_abc.bodies) == len(new_abc.bodies) and changed_bodies == list(HELPERS), 'unexpected full ABC changes')
    require(all(not b[5] for b in runtime_abc.bodies if b[0] in (18392, 17701, *HELPERS)),
            'expected stripped runtime AOT bodies')

    original_rebases = link.read_rebase(native)['entries']
    old_segments = link.segments(native)
    rebased = {(old_segments[si]['off'] + offset, typ) for si, offset, typ in original_rebases}
    patched, rx, header_end = add_executable_segment(native, plan, link)
    chunks, new_unwind = [], []
    thunk = read_json(inputs['thunk_contract']['path'])
    helpers = read_json(inputs['helpers_contract']['path'])['contracts']
    records = {r['method_id']: r for r in [thunk, *helpers]}
    unwind_records = {mid: object_unwind(row, lief) for mid, row in records.items()}
    for row in plan['chunks']:
        path = args.plan.parent / row['file']
        require(path.resolve().parent == args.plan.parent.resolve(), 'chunk path escapes plan directory')
        code = path.read_bytes()
        require(len(code) == row['bytes'] and sha(code) == row['sha256'], 'planned chunk differs')
        offset = rx['off'] + row['va'] - rx['vm']
        require(rx['off'] <= offset and offset + len(code) <= rx['off'] + rx['payload'], 'chunk outside RX')
        require(not any(patched[offset:offset + len(code)]), 'chunk overlap')
        patched[offset:offset + len(code)] = code
        chunks.append(dict(row, file_offset=offset))
        if row['name'].startswith('method-'):
            mid = int(row['name'].split('-')[1])
            encoding = unwind_records[mid]['encoding']
            require(unwind_records[mid]['size'] == len(code), 'object unwind function extent differs')
        elif row['name'] == 'resolver-wrapper':
            require(code[:4].hex() == 'fd7bbba9' and code[20:24].hex() == 'fd030091', 'wrapper frame changed')
            encoding = 0x04000000
        else:
            require(row['name'].startswith('call-veneer-') and len(code) == 12, 'unknown generated code')
            encoding = 0x02000000
        new_unwind.append((row['va'] - link.aot.IMAGE_BASE, len(code), encoding))
    table_sites = []
    for row in plan['patches']:
        at, before, after = row['file_offset'], bytes.fromhex(row['before']), bytes.fromhex(row['after'])
        require(len(before) == len(after) and native[at:at + len(before)] == before, 'patch preimage changed')
        patched[at:at + len(after)] = after
        if len(after) == 8:
            require((at, 1) in rebased, 'retargeted AOT pointer is missing its dyld rebase')
            table_sites.append(at)
    require(len(table_sites) == 5, 'unexpected retargeted/restored AOT pointer count')
    patched[info:info + 20] = full_digest
    unwind_section, = [s for s in sections(native, link) if (s['segment'], s['name']) == ('__TEXT', '__unwind_info')]
    unwind_offset, unwind_size = unwind_section['off'], unwind_section['size']
    unwind, unwind_report = extend_unwind(native[unwind_offset:unwind_offset + unwind_size], new_unwind)
    patched[unwind_offset:unwind_offset + unwind_size] = unwind
    original_starts_command, original_starts = function_starts(native, link)
    starts = sorted(set(original_starts) | {r['va'] - link.aot.IMAGE_BASE for r in chunks})
    stream, previous = bytearray(), 0
    for value in starts:
        stream += link.uleb(value - previous)
        previous = value
    stream.append(0)
    starts_offset = insert_before_string_table(patched, stream)
    starts_command, _ = function_starts(patched, link)
    struct.pack_into('<II', patched, starts_command + 8, starts_offset, len(stream))
    require(function_starts(patched, link)[1] == starts, 'function-start readback differs')
    require(link.read_rebase(patched)['entries'] == original_rebases, 'existing rebase entries changed')
    for before, after in zip(linkedit_ranges(native), linkedit_ranges(patched)):
        require(before['name'] == after['name'], 'loader metadata set changed')
        if before['name'] != '0x26':
            require(native[before['offset']:before['offset'] + before['size']] ==
                    patched[after['offset']:after['offset'] + after['size']], 'loader metadata changed: ' + before['name'])
    for row in plan['preserved_native_ranges']:
        require(sha(patched[row['file_offset']:row['file_offset'] + row['bytes']]) == row['sha256'],
                'preserved resolver range changed')
    allowed = [(0, header_end), (info, info + 20), (unwind_offset, unwind_offset + unwind_size)]
    allowed += [(r['file_offset'], r['file_offset'] + len(bytes.fromhex(r['after']))) for r in plan['patches']]
    assert_preserved_ranges(native, patched, rx['off'], allowed)
    require(patched[abc_offset:abc_offset + len(runtime)] == runtime, 'runtime stripped ABC changed')
    newswf = link.aot.replace_main_swf_hash(swf, native[info:info + 20], full_digest)
    require(link.aot.replace_main_swf_hash(newswf, full_digest, native[info:info + 20]) == swf,
            'SWF digest replacement changed unrelated bytes')
    signing = assert_signable_layout(patched)
    models = ns.verify_signing_models(patched)
    origin = ns.current_origin(patched)
    out.mkdir(parents=True, exist_ok=False)
    native_path, swf_path = out / 'worldflipper', out / 'worldflipper_ios_release.swf'
    native_path.write_bytes(patched)
    swf_path.write_bytes(newswf)
    full_path, runtime_path = out / 'equipment-fixed-full.abc', out / 'runtime-stripped.abc'
    full_path.write_bytes(full)
    runtime_path.write_bytes(runtime)
    loaded = lief.parse(str(native_path))
    require(len(list(loaded.segments)) == len(old_segments) + 1, 'independent Mach-O segment parse differs')
    final_table = link.file_offset(patched, ns.read64(patched, info + 48), reg['aot_method_count'] * 8)
    method_readback = {str(mid): ns.read64(patched, final_table + mid * 8) for mid in (17701, 18392, *HELPERS, 101444)}
    source_hashes = {str(Path(m.__file__).resolve()): file_sha(m.__file__) for m in list(sys.modules.values())
                     if getattr(m, '__file__', None) and Path(m.__file__).suffix == '.py'
                     and Path(m.__file__).resolve().is_relative_to(REPO)}
    report = dict(status='linked_native_not_executed', source_ipa=reg, plan_file=str(args.plan.resolve()),
                  plan_sha256=file_sha(args.plan), input_bindings=inputs, source_hashes=source_hashes,
                  native_file=str(native_path), native_sha256=sha(patched), swf_file=str(swf_path), swf_sha256=sha(newswf),
                  full_abc_file=str(full_path), full_abc_sha256=sha(full), full_abc_sha1=full_digest.hex(),
                  runtime_abc_file=str(runtime_path), runtime_abc_sha256=sha(runtime), runtime_abc_preserved=True,
                  runtime_contract='Existing zero-body AOT runtime ABC retained byte-for-byte; compiler-only thunk and script bodies excluded.',
                  total_methods=reg['aot_method_count'], changed_full_method_bodies=changed_bodies,
                  executable_segment=rx, chunks=chunks, relocations=plan['relocations'], patches=plan['patches'],
                  method_readback=method_readback, preserved_native_ranges=plan['preserved_native_ranges'],
                  native_change_ranges=allowed, rebase_count=len(original_rebases),
                  retargeted_pointer_rebases_verified=table_sites, added_rebases=0,
                  unwind=dict(unwind_report, section=unwind_section, object_evidence=unwind_records,
                              added_ranges=new_unwind, executed=False),
                  function_starts=dict(old_count=len(original_starts), new_count=len(starts),
                                       added_count=len(starts) - len(original_starts), offset=starts_offset, size=len(stream)),
                  loader_metadata_preserved=True, signing_layout=signing, signing_models=models, origin=origin,
                  native_executed=False, device_tested=False, signing='unsigned', accepted_registry_updated=False)
    dump(out / 'link-report.json', report)
    ipa = out / 'StarPoint-iOS-1.8.4-equipment-repair-20261025-unsigned.ipa'
    replacements = {reg['native_member']: patched, reg['swf_member']: newswf}
    with zipfile.ZipFile(source) as old, zipfile.ZipFile(ipa, 'w', allowZip64=True) as new:
        require(len(old.namelist()) == len(set(old.namelist())), 'duplicate IPA member')
        new.comment = old.comment
        for entry in old.infolist():
            payload = replacements.get(entry.filename)
            new.writestr(copy.copy(entry), old.read(entry) if payload is None else payload)
    changed = []
    with zipfile.ZipFile(source) as old, zipfile.ZipFile(ipa) as new:
        require(old.namelist() == new.namelist() and old.comment == new.comment, 'IPA member order changed')
        require(new.testzip() is None, 'IPA CRC failure')
        for a, b in zip(old.infolist(), new.infolist()):
            for key in ('filename', 'date_time', 'compress_type', 'comment', 'extra', 'create_system', 'external_attr'):
                require(getattr(a, key) == getattr(b, key), 'IPA member metadata changed: ' + key)
            if old.read(a) != new.read(b):
                changed.append(a.filename)
        identity = plistlib.loads(new.read('Payload/worldflipper.app/Info.plist'))
        require((identity['CFBundleIdentifier'], identity['CFBundleShortVersionString'], identity['CFBundleVersion']) ==
                (reg['bundle_id'], reg['version'], reg['build']), 'package identity changed')
        require(set(changed) == set(replacements), 'unexpected IPA member changes')
    result = dict(status='unsigned_offline_candidate', ipa=str(ipa), ipa_sha256=file_sha(ipa),
                  size_bytes=ipa.stat().st_size, link_report=str(out / 'link-report.json'),
                  native_sha256=sha(patched), swf_sha256=sha(newswf), full_abc_sha256=sha(full),
                  full_abc_sha1=full_digest.hex(), runtime_abc_sha256=sha(runtime), total_methods=reg['aot_method_count'],
                  changed_members=changed, original_members_retained=True, zip_crc_verified=True,
                  package_metadata_preserved=True, signing='unsigned', device_tested=False,
                  accepted_registry_updated=False, admission_materials_unchanged=True)
    dump(out / 'package-report.json', result)
    print(json.dumps(result, ensure_ascii=False))
    return report, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registry', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--libraries', type=Path, required=True)
    run(parser.parse_args())


if __name__ == '__main__':
    main()
