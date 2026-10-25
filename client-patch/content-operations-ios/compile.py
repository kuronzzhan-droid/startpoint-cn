"""Compile the prepared iOS operations unit and retain full native objects.

The shared PR43 compiler restores owner/newclass context only in a separate
compiler input. It never overwrites the runtime full ABC. Object extraction
retains the owning LIEF Binary while reading sections and all relocations.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'pr43-ios'))
import compile_port
from native_support import backend, dump, read_report, sha, wanted_methods, symbol_record


def extract(prepared, directory):
    prepared, port = read_report(prepared)
    directory = Path(directory)
    report = json.loads((directory / 'compile-report.json').read_text('utf-8'))
    if report['prepared_report_sha256'] != sha(prepared.read_bytes()):
        raise ValueError('Prepared report changed after compilation')
    link = backend()
    wanted = wanted_methods(port)
    objects, found = {}, {}
    for item in report['objects']:
        path = directory / item['name']
        if sha(path.read_bytes()) != item['sha256']:
            raise ValueError(('Object identity differs', path))
        obj = link.lief.parse(str(path))
        if not obj:
            raise ValueError(('Cannot parse compiler object', path))
        objects[path] = obj
        for symbol in obj.symbols:
            name = link.aot.text(symbol.name)
            match = re.search(r':(\d+):', name)
            if not symbol.numberof_sections or not match or int(match[1]) not in wanted:
                continue
            mid = int(match[1])
            if mid in found:
                raise ValueError(('Ambiguous target symbol', mid))
            found[mid] = (path, obj, name)
    if set(found) != wanted:
        raise ValueError(('Missing compiled targets', sorted(wanted - set(found))))
    functions = directory / 'target-functions'
    functions.mkdir(exist_ok=True)
    records = []
    for mid in sorted(wanted):
        path, obj, name = found[mid]
        function, _path, section, symbols, _legacy_rows = symbol_record(obj, path, name, mid)
        start = function.source_start - section.virtual_address
        content = bytes(section.content)
        if not 0 <= start < start + function.size <= len(content):
            raise ValueError(('Incomplete function bounds', mid))
        raw = content[start:start + function.size]
        if len(raw) != function.size or not raw or len(raw) % 4:
            raise ValueError(('Incomplete ARM64 symbol extent', mid))
        compact_rows = []
        for unwind_section in obj.sections:
            if unwind_section.name != '__compact_unwind':
                continue
            unwind_raw = bytes(unwind_section.content)
            if len(unwind_raw) % 32:
                raise ValueError(('Malformed compiler compact-unwind section', path))
            compact_rows.extend(struct.unpack_from('<QIIQQ', unwind_raw, i) for i in range(0, len(unwind_raw), 32))
        code_bounds = [row for row in compact_rows if row[0] == function.source_start]
        boundary_source = 'compiler compact_unwind descriptor'
        if not code_bounds and name.endswith('cn.content::ContentOperationsState$/currentRevision') and raw.hex() == '006440fdc0035fd6':
            # The complete function is LDR d0,[x0,#0xc8]; RET. It neither
            # allocates a frame nor calls another function, so no descriptor
            # is emitted. This exact leaf has no inline literal/jump bytes.
            code_bytes, unwind_encoding = 8, None
            boundary_source = 'exact frameless LDR d0,[x0,#0xc8]; RET leaf'
        else:
            if len(code_bounds) != 1 or not 0 < code_bounds[0][1] <= len(raw):
                raise ValueError(('Missing or ambiguous compiler code boundary', mid, code_bounds))
            code_bytes, unwind_encoding = code_bounds[0][1], code_bounds[0][2]
        object_raw = path.read_bytes()
        rows = []
        for ri in range(section.numberof_relocations):
            address, word = struct.unpack_from('<iI', object_raw, section.relocation_offset + ri * 8)
            source_address = section.virtual_address + address
            if not function.source_start <= source_address < function.source_end:
                continue
            external = (word >> 27) & 1
            symbol_index = word & 0xffffff
            row = dict(source_address=source_address, offset=source_address-function.source_start,
                       type=word >> 28, external=external, raw=word,
                       symbol=link.aot.text(symbols[symbol_index].name) if external else None)
            if row['type'] == 10:
                row['signed_addend'] = link.aot.sign_extend_24(symbol_index)
            rows.append(row)
        if any(not 0 <= row['offset'] <= len(raw) - 4 for row in rows):
            raise ValueError(('Relocation outside full function', mid))
        if any(row['type'] != 10 and (not row['external'] or row['symbol'] is None) for row in rows):
            raise ValueError(('Local/anonymous relocation needs an explicit plan', mid))
        for row in rows:
            if row['type'] == 10 and (row['external'] or len([r for r in rows if r['offset']==row['offset'] and r['type'] in (3,4)]) != 1):
                raise ValueError(('ADDEND must pair with exactly one PAGE21/PAGEOFF12 relocation', mid, row))
        destination = functions / f'method-{mid}.bin'
        destination.write_bytes(raw)
        record = dict(method_id=mid, symbol=name, object_file=path.name,
                      object_sha256=sha(path.read_bytes()), section=section.name,
                      section_virtual_address=section.virtual_address,
                      function_source_start=function.source_start, function_source_end=function.source_end,
                      bytes=len(raw), sha256=sha(raw), file=str(destination.relative_to(directory)),
                      symbol_extent_bytes=len(raw), code_bytes=code_bytes,
                      trailing_inline_data_bytes=len(raw)-code_bytes,
                      compact_unwind_encoding=unwind_encoding, code_boundary_source=boundary_source,
                      extent_rule='Complete text symbol bytes retain trailing switch/jump data. Only compact_unwind code_bytes describes the compiler function code range.',
                      relocations=rows, owning_object_retained=True,
                      method_environment='own original typed MethodEnv' if mid < port['old_methods'] else 'own appended helper MethodEnv',
                      native_linked=False, native_executed=False)
        dump(functions / f'method-{mid}.json', record)
        records.append(record)
    all_symbols = sorted({row['symbol'] for record in records for row in record['relocations'] if row['symbol'] is not None})
    result = dict(status='complete_native_objects_extracted_not_linked',
                  prepared_report=str(prepared), prepared_report_sha256=sha(prepared.read_bytes()),
                  compiler_report_sha256=sha((directory / 'compile-report.json').read_bytes()),
                  full_abc_sha256=port['full_abc_sha256'], compile_input_sha256=report['compile_input_sha256'],
                  old_methods=port['old_methods'], total_methods=port['total_methods'],
                  expected_methods=sorted(wanted), functions=records,
                  total_function_bytes=sum(r['bytes'] for r in records),
                  total_code_bytes=sum(r['code_bytes'] for r in records),
                  total_trailing_inline_data_bytes=sum(r['trailing_inline_data_bytes'] for r in records),
                  total_relocations=sum(len(r['relocations']) for r in records), external_symbols=all_symbols,
                  object_retention='All compiler objects retained, including AOTInfo, method flags, activation and generated code; final linker must include their complete dependency closure and unwind.',
                  compiler_only_lifecycles=report['compiler_only_lifecycles'],
                  native_linked=False, native_executed=False, device_tested=False)
    dump(directory / 'native-contract.json', result)
    print(json.dumps({k: result[k] for k in ('status', 'total_function_bytes', 'total_relocations')}))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('prepared', 'out', 'sdk', 'dependencies', 'background'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--extract-only', action='store_true')
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args()
    if not args.extract_only:
        compile_port.run(args.prepared, args.out, sdk=args.sdk, dependencies=args.dependencies,
                         background=args.background, timeout=args.timeout)
    extract(args.prepared, args.out)


if __name__ == '__main__':
    main()
