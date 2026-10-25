"""Bind each prepared native method to its complete object bytes/relocations."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import struct
import sys

import prepare_profile_town as recipe


def text(value):
    return value.decode('utf8', 'replace') if isinstance(value, bytes) else value


def run(prepared, compiled, output, native_libraries):
    sys.path.insert(0, str(native_libraries))
    import lief
    import capstone
    from native_support import wanted_methods
    prepared, compiled, output = Path(prepared), Path(compiled), Path(output)
    port = json.loads(prepared.read_text('utf8'))
    report = json.loads(compiled.read_text('utf8'))
    assert report['prepared_report_sha256'] == recipe.sha(prepared.read_bytes())
    assert report['full_abc_sha256'] == port['full_abc_sha256']
    full = (prepared.parent / port['full_abc_file']).read_bytes()
    assert recipe.sha(full) == port['full_abc_sha256']
    abc = recipe.p.abcfmt.ABC(full)
    av = recipe.view(abc)
    wanted = wanted_methods(port)
    assert set(report['target_symbol_coverage']['found']) == wanted
    decoder = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_LITTLE_ENDIAN)
    found = {mid: [] for mid in wanted}
    objects = []
    for row in report['objects']:
        path = compiled.parent / row['name']
        raw = path.read_bytes()
        assert recipe.sha(raw) == row['sha256']
        obj = lief.parse(str(path))
        assert obj is not None
        symbols = list(obj.symbols)
        sections = list(obj.sections)
        for symbol in symbols:
            match = re.search(r':(\d+):', text(symbol.name))
            if not match or int(match.group(1)) not in wanted or not symbol.numberof_sections:
                continue
            mid = int(match.group(1))
            section = sections[symbol.numberof_sections-1]
            assert section.name == '__text'
            ends = [s.value for s in symbols if s.numberof_sections == symbol.numberof_sections
                    and s.value > symbol.value and not text(s.name).startswith(('ltmp','lCPI'))]
            end = min(ends, default=section.virtual_address+section.size)
            offset = symbol.value-section.virtual_address
            code = bytes(section.content)[offset:end-section.virtual_address]
            assert code and len(code) == end-symbol.value and len(code)%4 == 0
            instructions = list(decoder.disasm(code, 0))
            assert sum(i.size for i in instructions) == len(code), ('incomplete decode', mid)
            relocs = []
            for index in range(section.numberof_relocations):
                where, word = struct.unpack_from('<iI', raw, section.relocation_offset+index*8)
                address = section.virtual_address+where
                if not symbol.value <= address < end:
                    continue
                external = bool((word >> 27)&1)
                symbol_index = word&0xffffff
                kind = word >> 28
                assert 0 <= address-symbol.value <= len(code)-4
                relocs.append(dict(offset=address-symbol.value, type=kind, external=external,
                                   pcrel=bool((word>>24)&1), length_power=(word>>25)&3,
                                   symbol=text(symbols[symbol_index].name) if external else None,
                                   local_section_or_addend=None if external else symbol_index,
                                   raw_relocation_word=word, source_instruction=code[address-symbol.value:address-symbol.value+4].hex()))
            bi, = [i for i,b in enumerate(abc.bodies) if b[0] == mid]
            body = abc.bodies[bi]
            # Keep obj alive until code, symbols, sections and relocation data
            # have all been copied; no LIEF child object escapes this scope.
            found[mid].append(dict(method_id=mid, label=av.labels[mid], symbol=text(symbol.name),
                                   object_file=str(path.resolve()), object_sha256=row['sha256'],
                                   section=section.name, source_start=symbol.value, source_end=end,
                                   function_bytes=len(code), function_sha256=recipe.sha(code),
                                   code_hex=code.hex(), relocations=relocs,
                                   signature=recipe.common.signature(av, mid), body_header=body[:5],
                                   activation=recipe.p.activation_traits(av, body),
                                   body_code_sha256=recipe.sha(body[5]),
                                   environment_contract='real owner MethodInfo and original typed entry signature',
                                   disassembly_complete=True, owning_binary_retained=True))
        objects.append(row)
    assert all(len(rows)==1 for rows in found.values()), ('native symbol must be unique', {m:len(r) for m,r in found.items()})
    records = [found[mid][0] for mid in sorted(found)]
    contract = dict(status='object_contracts_verified_not_linked', full_abc_sha256=port['full_abc_sha256'],
                    prepared_report_sha256=recipe.sha(prepared.read_bytes()),
                    compile_report_sha256=recipe.sha(compiled.read_bytes()),
                    compiler_input_sha256=report['compile_input_sha256'],
                    methods=records, objects=objects, total_function_bytes=sum(r['function_bytes'] for r in records),
                    total_relocations=sum(len(r['relocations']) for r in records),
                    native_linked=False, native_executed=False, device_tested=False)
    recipe.dump(output, contract)
    print(json.dumps({k:contract[k] for k in ('status','total_function_bytes','total_relocations')}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('prepared','compiled','out','native-libraries'):
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args()
    run(args.prepared, args.compiled, args.out, args.native_libraries)


if __name__ == '__main__':
    main()
