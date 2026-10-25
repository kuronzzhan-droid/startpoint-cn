"""Post-link unwind/function-start integration for subsequent sparse AOT ports.

This module never signs or writes an artifact. It preserves existing unwind
entries and LSDAs, and returns the modified bytes with exact changed ranges.
Simple zR arm64 EH frames may move into verified __TEXT header padding. Section
order and symbol section indices are updated, while PC-relative FDE starts
are adjusted and read back as the same absolute targets.
"""
from __future__ import annotations

import bisect
from pathlib import Path
import re
import struct

import build_candidate as b
import compact_unwind as u


def read_uleb(data, at, limit):
    value, shift = 0, 0
    while True:
        b.require(at < limit and shift < 64, 'invalid EH ULEB')
        byte = data[at]
        at += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, at
        shift += 7


def eh_frames(data, address):
    """Parse the carrier's explicitly supported CIE/FDE contract, fail closed."""
    at, cies, fdes = 0, set(), []
    expected_cie = bytes.fromhex('00000000017a520001781e01100c1f00')
    while at < len(data):
        b.require(at + 4 <= len(data), 'truncated EH record length')
        size = struct.unpack_from('<I', data, at)[0]
        if size == 0:
            b.require(not any(data[at:]), 'nonzero EH bytes after terminator')
            break
        end = at + 4 + size
        b.require(size >= 4 and size != 0xffffffff and end <= len(data), 'unsupported EH record length')
        cie_pointer = struct.unpack_from('<I', data, at + 4)[0]
        if cie_pointer == 0:
            b.require(data[at + 4:end] == expected_cie, 'unsupported EH CIE; relocation is not proven')
            cies.add(at)
        else:
            b.require(at + 4 - cie_pointer in cies and size >= 21, 'unknown FDE CIE or truncated FDE')
            field = at + 8
            target = address + field + struct.unpack_from('<q', data, field)[0]
            length = struct.unpack_from('<Q', data, at + 16)[0]
            augment, cursor = read_uleb(data, at + 24, end)
            b.require(augment == 0, 'FDE augmentation requires separate relocation support')
            # Validate CFI opcodes so arbitrary address expressions cannot hide
            # in data being treated as a position-independent instruction tail.
            while cursor < end:
                opcode = data[cursor]
                cursor += 1
                high = opcode & 0xc0
                if high in (0x40, 0xc0) or opcode in (0, 10, 11):
                    continue
                if high == 0x80 or opcode in (6, 7, 8, 13, 14):
                    _, cursor = read_uleb(data, cursor, end)
                elif opcode in (5, 9, 12):
                    _, cursor = read_uleb(data, cursor, end)
                    _, cursor = read_uleb(data, cursor, end)
                elif opcode in (2, 3, 4):
                    cursor += {2: 1, 3: 2, 4: 4}[opcode]
                    b.require(cursor <= end, 'truncated CFI advance')
                else:
                    raise ValueError('unsupported address-bearing/extended CFI opcode')
            fdes.append(dict(offset=at, pointer_offset=field, target=target, length=length))
        at = end
    b.require(cies and fdes, 'empty EH frame contract')
    return dict(cies=sorted(cies), fdes=fdes)


def relocate_eh_frames(data, address, growth):
    original = eh_frames(data, address)
    changed = bytearray(data)
    for row in original['fdes']:
        at = row['pointer_offset']
        struct.pack_into('<q', changed, at, struct.unpack_from('<q', data, at)[0] - growth)
    b.require(eh_frames(changed, address + growth) == original, 'EH FDE target changed while moving section')
    return changed, dict(original, delta=growth, all_fde_targets_preserved=True,
                          cie_and_cfi_bytes_preserved=True)


def verify_switch_tables(record, section, relocations, code_size):
    """Prove a compiler-owned signed-offset table tail, not arbitrary padding."""
    import capstone
    b.require(0 < code_size < record.size and (record.size - code_size) % 4 == 0,
              'invalid switch table tail extent')
    start = record.source_start - section.virtual_address
    raw = bytes(section.content)[start:start + record.size]
    b.require(all(row['offset'] < code_size for row in relocations), 'relocation inside switch table data')
    addends = {r['offset']: ((r['raw'] & 0xffffff) - (1 << 24) if r['raw'] & 0x800000 else r['raw'] & 0xffffff)
               for r in relocations if r['type'] == 10}
    table_relocs = [r for r in relocations if r['type'] in (3, 4) and r['symbol'] == record.symbol
                    and code_size <= addends.get(r['offset'], -1) < record.size]
    offsets = sorted({addends[r['offset']] for r in table_relocs})
    b.require(offsets and offsets[0] == code_size and all(value % 4 == 0 for value in offsets),
              'tail lacks exact self-symbol PAGE/ADDEND ownership')
    md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_LITTLE_ENDIAN)
    md.detail = True
    instructions = list(md.disasm(raw[:code_size], 0))
    b.require(sum(ins.size for ins in instructions) == code_size, 'complete code prefix does not decode')
    instruction_offsets = {ins.address for ins in instructions}
    def writes(ins, register):
        return any(ins.reg_name(value) in (f'x{register}', f'w{register}') for value in ins.regs_access()[1])
    tables = []
    for number, offset in enumerate(offsets):
        end = offsets[number + 1] if number + 1 < len(offsets) else record.size
        values = list(struct.unpack_from('<' + 'i' * ((end - offset) // 4), raw, offset))
        targets = [offset + value for value in values]
        b.require(all(value in instruction_offsets for value in targets), 'switch table target leaves code or is unaligned')
        pages = [r for r in table_relocs if addends[r['offset']] == offset and r['type'] == 3]
        lows = [r for r in table_relocs if addends[r['offset']] == offset and r['type'] == 4]
        b.require(len(pages) == len(lows) == 1, 'ambiguous switch address materialization')
        page, low = pages[0]['offset'], lows[0]['offset']
        page_word, low_word = struct.unpack_from('<I', raw, page)[0], struct.unpack_from('<I', raw, low)[0]
        base = page_word & 31
        b.require(page_word & 0x9f000000 == 0x90000000 and low_word & 0xffc00000 == 0x91000000
                  and low_word & 31 == base and (low_word >> 5) & 31 == base and page < low,
                  'switch table PAGE/ADD is not a guarded same-register pair')
        b.require(all(not writes(ins, base) for ins in instructions if page < ins.address < low),
                  'switch base overwritten between PAGE/ADD')
        candidates = []
        for index, ins in enumerate(instructions):
            if ins.address <= low or ins.mnemonic != 'ldrsw':
                continue
            match = re.fullmatch(rf'x(\d+), \[x{base}, x(\d+), lsl #2\]', ins.op_str)
            if not match:
                continue
            dest, selector = map(int, match.groups())
            if any(writes(previous, base) for previous in instructions if low < previous.address < ins.address):
                continue
            adds = [(j, x) for j, x in enumerate(instructions[index + 1:index + 9], index + 1)
                    if x.mnemonic == 'add' and x.op_str == f'x{dest}, x{dest}, x{base}']
            if not adds:
                continue
            add_index, add = adds[0]
            if any(writes(x, dest) or writes(x, base) for x in instructions[index + 1:add_index]):
                continue
            branches = [(j, x) for j, x in enumerate(instructions[add_index + 1:add_index + 5], add_index + 1)
                        if x.mnemonic == 'br' and x.op_str == f'x{dest}']
            if not branches:
                continue
            branch_index, branch = branches[0]
            if any(writes(x, dest) for x in instructions[add_index + 1:branch_index]):
                continue
            guards = [x for x in instructions[max(0, index - 24):index]
                      if x.mnemonic == 'cmp' and re.fullmatch(rf'w{selector}, #(0x[0-9a-f]+|\d+)', x.op_str)
                      and int(x.op_str.split('#')[1], 0) == len(values) - 1]
            if not guards:
                continue
            guard = guards[-1]
            highs = [x for x in instructions if guard.address < x.address < ins.address and x.mnemonic == 'b.hi']
            if not highs:
                continue
            high = highs[-1]
            high_target = int(high.op_str.lstrip('#'), 0)
            if not (branch.address + 4 <= high_target < code_size):
                continue
            if any('nzcv' in [x.reg_name(value) for value in x.regs_access()[1]]
                   for x in instructions if guard.address < x.address < high.address):
                continue
            if any(writes(x, selector) for x in instructions if guard.address < x.address < ins.address):
                continue
            candidates.append(dict(load_offset=ins.address, add_offset=add.address, branch_offset=branch.address,
                                   bound_compare_offset=guard.address, bound_branch_offset=high.address,
                                   bound_branch_target=high_target,
                                   base_register=base, selector_register=selector, result_register=dest))
        b.require(len(candidates) == 1, 'switch table lacks unique bounded LDRSW/ADD/BR dispatch')
        tables.append(dict(offset=offset, size=end - offset, entries=len(values), signed_offsets=values,
                           targets=targets, page_relocation_offset=page, pageoff_relocation_offset=low,
                           symbol=record.symbol, addend=offset, dispatch=candidates[0],
                           sha256=b.sha(raw[offset:end])))
    return dict(offset=code_size, size=record.size - code_size, sha256=b.sha(raw[code_size:]),
                role='compiler signed32 switch tables; explicit no-unwind data', tables=tables)


def _compile_functions(compiled_report, functions, generated, ns, link):
    report = b.read_json(compiled_report) if isinstance(compiled_report, (str, Path)) else compiled_report
    import lief
    wanted = {int(row['method']): row for row in functions}
    names = {name: int(mid) for name, mid in (generated or {}).items()}
    found = {}
    for object_row in report['objects']:
        path = Path(report['directory']) / object_row['name']
        b.require(b.file_sha(path) == object_row['sha256'], 'compiled object hash changed')
        obj = lief.parse(str(path))
        symbols = list(obj.symbols)
        matches = []
        for symbol in symbols:
            if not symbol.numberof_sections:
                continue
            name = link.aot.text(symbol.name)
            match = re.search(r':(\d+):', name)
            mid = int(match.group(1)) if match else names.get(name)
            if mid in wanted and (mid >= 0 or names.get(name) == mid):
                if link.aot.find_section(obj, symbol).name == '__text':
                    matches.append((mid, name))
        if not matches:
            continue
        compact = next((s for s in obj.sections if s.name == '__compact_unwind'), None)
        raw = path.read_bytes()
        if compact is not None:
            payload = bytes(compact.content)
            b.require(len(payload) % 32 == 0, 'malformed compact unwind object section')
            rows = [(at, struct.unpack_from('<QIIQQ', payload, at)) for at in range(0, len(payload), 32)]
            relocs = [struct.unpack_from('<iI', raw, compact.relocation_offset + j * 8)
                      for j in range(compact.numberof_relocations)]
        else:
            rows, relocs = [], []
        for mid, name in matches:
            b.require(mid not in found, 'ambiguous compiled function identity')
            record, _, text_section, _, code_relocs = ns.symbol_record(obj, path, name, mid)
            b.require(record.size == wanted[mid]['size'], 'linked function does not match complete object extent')
            matched = [(at, row) for at, row in rows if row[0] == record.source_start]
            b.require(len(matched) <= 1, 'ambiguous object compact unwind')
            reason = None
            data_tail = None
            code_size = record.size
            if matched:
                at, (_, size, encoding, personality, lsda) = matched[0]
                b.require(0 < size <= record.size and personality == lsda == 0,
                          'object unwind personality/LSDA/extent requires explicit support')
                code_size = size
                if code_size < record.size:
                    data_tail = verify_switch_tables(record, text_section, code_relocs, code_size)
                b.require(encoding & 0xff000000 in (0x02000000, 0x04000000), 'unsupported generated unwind encoding')
                selected = [(offset, value) for offset, value in relocs if at <= offset < at + 32]
                b.require(len(selected) == 1 and selected[0][0] == at, 'unsupported compact unwind relocation set')
                value = selected[0][1]
                b.require(value >> 28 == 0 and (value >> 24) & 1 == 0 and (value >> 25) & 3 == 3
                          and (value >> 27) & 1 == 0, 'unsupported compact unwind pointer relocation')
                b.require(list(obj.sections)[(value & 0xffffff) - 1].name == '__text', 'unwind target is not text')
            else:
                encoding = 0
                reason = 'compiler emitted no compact unwind row; explicit no-unwind range'
            found[mid] = dict(wanted[mid], symbol=name, encoding=encoding, object_file=str(path),
                              object_sha256=object_row['sha256'], source_start=record.source_start,
                              source_end=record.source_end, no_unwind_reason=reason,
                              unwind_size=code_size, data_tail=data_tail)
    b.require(set(found) == set(wanted), 'missing function/object binding (generated symbols need generated_initializers)')
    return list(found.values())


def _augment_model(original, ranges):
    old = u.parse(original)
    old_entries = [entry for page in old['pages'] for entry in page['entries']]
    lsda = [row for page in old['pages'] for row in page['lsda']]
    old_addresses = [row[0] for row in old_entries]
    def encoding_at(address):
        index = bisect.bisect_right(old_addresses, address) - 1
        return old_entries[index][1] if index >= 0 and address < old['sentinel'] else 0
    entries = dict(old_entries)
    entries[old['sentinel']] = 0
    for start, size, encoding in ranges:
        end = start + size
        interior = [address for address in old_addresses if start <= address < end]
        b.require(encoding_at(start) == 0 and all(encoding_at(address) == 0 for address in interior),
                  'new unwind range overlaps old nonzero unwind metadata')
        b.require(not any(start <= address < end for address, _ in lsda), 'new range overlaps retained LSDA')
        for address in interior:
            del entries[address]
        entries[start] = encoding
        if end not in entries:
            entries[end] = encoding_at(end)
    sentinel = max(old['sentinel'], max(start + size for start, size, _ in ranges))
    b.require(entries[sentinel] == 0, 'unwind sentinel is not a terminal zero encoding')
    del entries[sentinel]
    # Compact-unwind permits folding adjacent equal encodings without LSDA or
    # personality. Apply this only to new boundaries, never an original row.
    # Function identity/extent remains in LC_FUNCTION_STARTS and the receipt.
    ordered, folded = [], []
    original_starts = set(old_addresses)
    for row in sorted(entries.items()):
        if (ordered and row[0] not in original_starts and row[1] == ordered[-1][1]
                and not row[1] & 0x70000000):
            folded.append(row)
        else:
            ordered.append(row)
    pages, cursor = [], 0
    while cursor < len(ordered):
        end = cursor + 1
        local = set() if ordered[cursor][1] in old['common'] else {ordered[cursor][1]}
        while end < len(ordered):
            new_local = local | ({ordered[end][1]} - set(old['common']))
            if (ordered[end][0] - ordered[cursor][0] > 0xffffff or
                    12 + 4 * (end - cursor + 1 + len(new_local)) > 4096 or
                    len(old['common']) + len(new_local) > 256):
                break
            local = new_local
            end += 1
        next_start = ordered[end][0] if end < len(ordered) else sentinel
        pages.append(dict(entries=ordered[cursor:end],
                          lsda=[row for row in lsda if ordered[cursor][0] <= row[0] < next_start]))
        cursor = end
    model = dict(common=old['common'], personalities=old['personalities'], pages=pages, sentinel=sentinel)
    packed = u.serialize(model)
    b.require(u.parse(packed) == model, 'augmented unwind round trip differs')
    for start, encoding in old_entries:
        if encoding:
            b.require(entries.get(start) == encoding, 'original nonzero unwind function entry changed')
    b.require([row for page in pages for row in page['lsda']] == lsda, 'original LSDA rows changed')
    return packed, dict(original_functions=len(old_entries), final_functions=len(ordered),
                        old_pages=len(old['pages']), new_pages=len(pages),
                        preserved_original_nonzero_entries=True, preserved_personalities_and_lsda=True,
                        packed_size=len(packed), folded_new_boundaries=folded,
                        folding_rule='Only new equal encodings without LSDA/personality; all original rows retained.')


def move_eh_to_header_padding(data, uw, eh, needed, link):
    """Release the old EH bytes without touching historical code after them."""
    text, = [s for s in link.segments(data) if s['name'] == '__TEXT']
    section_rows = b.sections(data, link)
    text_rows = [s for s in section_rows if s['segment'] == '__TEXT']
    b.require(text_rows[-2]['name'] == '__unwind_info' and text_rows[-1]['name'] == '__eh_frame'
              and uw['off'] + uw['size'] == eh['off'], 'unsupported EH/unwind section layout')
    capacity = uw['size'] + eh['size']
    b.require(needed <= capacity, 'unwind exceeds capacity released by relocating EH frame')
    header_end = 32 + struct.unpack_from('<I', data, 20)[0]
    destination = b.align(header_end, 8)
    first_section = min(s['off'] for s in section_rows if s['off'])
    b.require(destination + eh['size'] <= first_section and not any(data[destination:destination + eh['size']]),
              'no verified header padding for EH frame')
    b.require(all(struct.unpack_from('<I', data, s['command'] + 60)[0] == 0 for s in section_rows),
              'section relocations require explicit section-index remapping')
    for _, command, raw in link.commands(data):
        if command == 0xb:
            b.require(struct.unpack_from('<IIII', raw, 64) == (0, 0, 0, 0),
                      'external/local relocation tables require explicit section-index remapping')
    rebases = link.read_rebase(data)['entries']
    segments = link.segments(data)
    for index, offset, typ in rebases:
        b.require(typ == 1, 'non-pointer rebase needs explicit EH reference handling')
        value = struct.unpack_from('<Q', data, segments[index]['off'] + offset)[0]
        b.require(not eh['va'] <= value < eh['va'] + eh['size'], 'active rebase points into old EH frame')
    old_eh = bytes(data[eh['off']:eh['off'] + eh['size']])
    destination_va = text['vm'] + destination - text['off']
    moved, proof = relocate_eh_frames(old_eh, eh['va'], destination_va - eh['va'])
    raw_headers = {row['name']: bytes(data[row['command']:row['command'] + 80]) for row in text_rows}
    reordered = [eh, *text_rows[:-1]]
    old_ordinals = {row['command']: index + 1 for index, row in enumerate(section_rows)}
    ordinal_map = {old_ordinals[row['command']]: old_ordinals[text_rows[index]['command']]
                   for index, row in enumerate(reordered)}
    symtab_command, _, symtab = next(row for row in link.commands(data) if row[1] == 2)
    symbol_offset, symbol_count = struct.unpack_from('<II', symtab, 8)
    symbol_changes = []
    for index in range(symbol_count):
        at = symbol_offset + index * 16
        before = bytes(data[at:at + 16])
        _, _, ordinal, _, value = struct.unpack_from('<IBBHQ', before)
        b.require(not eh['va'] <= value < eh['va'] + eh['size'], 'symbol value into EH frame needs explicit relocation')
        if ordinal in ordinal_map and ordinal_map[ordinal] != ordinal:
            data[at + 5] = ordinal_map[ordinal]
            after = bytes(data[at:at + 16])
            b.require(before[:5] == after[:5] and before[6:] == after[6:], 'unrelated symbol fields changed')
            symbol_changes.append(dict(index=index, old_section=ordinal, new_section=ordinal_map[ordinal]))
    start = text_rows[0]['command']
    for index, row in enumerate(reordered):
        raw = bytearray(raw_headers[row['name']])
        if row['name'] == '__eh_frame':
            struct.pack_into('<Q', raw, 32, destination_va)
            struct.pack_into('<I', raw, 48, destination)
        elif row['name'] == '__unwind_info':
            struct.pack_into('<Q', raw, 40, capacity)
        data[start + index * 80:start + (index + 1) * 80] = raw
    data[destination:destination + len(moved)] = moved
    updated_sections = b.sections(data, link)
    new_uw, = [s for s in updated_sections if (s['segment'], s['name']) == ('__TEXT', '__unwind_info')]
    b.require(new_uw['size'] == capacity and new_uw['off'] == uw['off'], 'unwind section relocation differs')
    new_text = [s for s in updated_sections if s['segment'] == '__TEXT']
    b.require(all(a['off'] + a['size'] <= z['off'] for a, z in zip(new_text, new_text[1:])),
              'reordered TEXT sections overlap or are out of order')
    b.require(new_text[-1]['off'] + new_text[-1]['size'] == eh['off'] + eh['size'],
              'TEXT sizeOfSections changed')
    for row in updated_sections:
        if row['segment'] == '__TEXT' and row['name'] not in ('__eh_frame', '__unwind_info'):
            old = next(s for s in text_rows if s['name'] == row['name'])
            b.require({k: row[k] for k in ('name', 'segment', 'va', 'off', 'size')} ==
                      {k: old[k] for k in ('name', 'segment', 'va', 'off', 'size')}, 'original TEXT section mapping changed')
    proof.update(strategy='move EH into verified header padding and reorder only TEXT section headers',
                 original_section=eh, new_section=dict(va=destination_va, off=destination, size=eh['size']),
                 released_unwind_capacity=capacity, original_TEXT_sizeOfSections_preserved=True,
                 section_ordinal_map=ordinal_map, symbol_count=symbol_count, symbol_section_changes=symbol_changes,
                 all_unrelated_symbol_fields_preserved=True, section_relocations=0, external_local_relocations=0,
                 rebases_checked=len(rebases), rebase_references_to_old_EH=0,
                 old_eh_sha256=b.sha(old_eh), new_eh_sha256=b.sha(moved))
    changed = [(start, start + len(text_rows) * 80), (destination, destination + eh['size']),
               (symbol_offset, symbol_offset + symbol_count * 16), (uw['off'], uw['off'] + capacity)]
    return new_uw, proof, changed


def finalize_delta(native, compiled_report, functions, entry_bridges=(), veneers=(), *,
                   generated_initializers=None, image_base=0x100000000):
    """Return (native_bytes, receipt); caller owns saving and final signing QA.

    functions: link-report.functions records {method,address,size,sha256,...}.
    compiled_report: parsed compile-port report or its JSON path.
    Negative method IDs require link-report.generated_initializers (symbol->ID).
    Bridge/veneer records use {address,size,sha256,...}; no compact row is
    invented for them, and their explicit no-unwind boundaries are recorded.
    """
    import native_support as ns
    link = ns.backend()
    from macho_signing_layout import assert_signable_layout, insert_before_string_table
    data = bytearray(native)
    assert_signable_layout(data)
    functions = _compile_functions(compiled_report, functions, generated_initializers, ns, link)
    records = list(functions)
    for name, rows in (('entry_bridge', entry_bridges), ('veneer', veneers)):
        for row in rows:
            records.append(dict(row, encoding=0, kind=name,
                                no_unwind_reason='synthetic branch-only trampoline; explicit no-unwind range'))
    records.sort(key=lambda row: row['address'])
    b.require(records, 'empty native delta')
    for row in records:
        at = link.file_offset(data, row['address'], row['size'])
        b.require(row['address'] % 4 == row['size'] % 4 == 0 and row['size'] > 0, 'unaligned linked function')
        if row.get('sha256'):
            b.require(b.sha(data[at:at + row['size']]) == row['sha256'], 'linked function bytes differ from link report')
        tail = row.get('data_tail')
        if tail:
            b.require(b.sha(data[at + tail['offset']:at + row['size']]) == tail['sha256'], 'linked switch table bytes changed')
            for table in tail['tables']:
                page, low = table['page_relocation_offset'], table['pageoff_relocation_offset']
                pw, lw = struct.unpack_from('<I', data, at + page)[0], struct.unpack_from('<I', data, at + low)[0]
                base = table['dispatch']['base_register']
                b.require(pw & 0x9f00001f == 0x90000000 | base
                          and lw & 0xffc003ff == 0x91000000 | (base << 5) | base,
                          'linked switch PAGE/ADD opcode or register changed')
                immediate = ((pw >> 29) & 3) | (((pw >> 5) & 0x7ffff) << 2)
                if immediate & (1 << 20):
                    immediate -= 1 << 21
                target = ((row['address'] + page) & ~0xfff) + (immediate << 12) + ((lw >> 10) & 0xfff)
                b.require(target == row['address'] + table['offset'], 'linked switch PAGE/ADD target changed')
        segment, = [s for s in link.segments(data) if s['off'] <= at and at + row['size'] <= s['off'] + s['fs']]
        b.require(struct.unpack_from('<i', data, segment['command'] + 60)[0] & 4, 'unwind function is not executable')
    b.require(all(a['address'] + a['size'] <= z['address'] for a, z in zip(records, records[1:])),
              'overlapping linked function/bridge ranges')
    ranges, padding = [], []
    for index, row in enumerate(records):
        size = row['size']
        if index + 1 < len(records):
            gap = records[index + 1]['address'] - row['address'] - size
            if 0 < gap <= 12:
                off = link.file_offset(data, row['address'] + size, gap)
                if not any(data[off:off + gap]):
                    padding.append(dict(start=row['address'] + size, size=gap))
                    size += gap
        if row.get('data_tail'):
            ranges.append((row['address'] - image_base, row['unwind_size'], row['encoding']))
            ranges.append((row['address'] - image_base + row['unwind_size'], size - row['unwind_size'], 0))
        else:
            ranges.append((row['address'] - image_base, size, row['encoding']))
    section_rows = b.sections(data, link)
    uw, = [s for s in section_rows if (s['segment'], s['name']) == ('__TEXT', '__unwind_info')]
    original_unwind = bytes(data[uw['off']:uw['off'] + uw['size']])
    packed, receipt = _augment_model(original_unwind, ranges)
    growth = max(0, len(packed) - uw['size'])
    changed_ranges = [(uw['off'], uw['off'] + uw['size'])]
    eh_report = None
    if growth:
        eh, = [s for s in section_rows if (s['segment'], s['name']) == ('__TEXT', '__eh_frame')]
        old_size = uw['size']
        uw, eh_report, extra = move_eh_to_header_padding(data, uw, eh, len(packed), link)
        changed_ranges += extra
        growth = uw['size'] - old_size
    size = uw['size']
    data[uw['off']:uw['off'] + size] = packed + bytes(size - len(packed))
    b.require(u.parse(data[uw['off']:uw['off'] + size]) == u.parse(packed), 'final unwind readback differs')
    command, old_starts = b.function_starts(data, link)
    starts = sorted(set(old_starts) | {row['address'] - image_base for row in records})
    stream, previous = bytearray(), 0
    for address in starts:
        stream += link.uleb(address - previous)
        previous = address
    stream.append(0)
    at = insert_before_string_table(data, stream)
    struct.pack_into('<II', data, command + 8, at, len(stream))
    b.require(b.function_starts(data, link)[1] == starts, 'final function-start readback differs')
    assert_signable_layout(data)
    receipt.update(original_unwind_sha256=b.sha(original_unwind), final_unwind_sha256=b.sha(data[uw['off']:uw['off'] + size]),
                   section_growth=growth, new_section_size=size, eh_frame_relocation=eh_report,
                   functions=functions, synthetic=[r for r in records if 'kind' in r],
                   covered_zero_alignment_padding=padding, new_ranges=ranges, native_change_ranges=changed_ranges,
                   function_starts=dict(old_count=len(old_starts), new_count=len(starts),
                                        added_count=len(starts) - len(old_starts), offset=at, size=len(stream)),
                   unwind_execution_tested=False)
    return bytes(data), receipt
