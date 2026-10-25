"""Independent, read-only verification of staged unsigned iOS candidates.

Read native/SWF payloads from the actual ZIP; unchanged members are compared as
compressed bytes, without extracting the application.  Decode object relocations,
Mach-O metadata and unwind records independently of the linker/finalizer.
"""
from __future__ import annotations

import argparse
import bisect
from collections import Counter
import hashlib
import json
from pathlib import Path
import plistlib
import re
import struct
import sys
from types import SimpleNamespace
import zipfile
import zlib

from verify_equipment import Image, function_starts, unwind_semantics

HERE = Path(__file__).resolve().parent
CLIENT = HERE.parent
BASE = 0x100000000
INFO = 104549248
LEGACY = 0x62C0780
LEGACY_COUNT = 101071


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(Path(path).read_text('utf-8-sig'))


def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf-8')


def u32(raw, at=0):
    return struct.unpack_from('<I', raw, at)[0]


def u64(raw, at=0):
    return struct.unpack_from('<Q', raw, at)[0]


def signed(value, bits):
    return value - (1 << bits) if value & (1 << (bits - 1)) else value


def commands(raw):
    require(struct.unpack_from('<II', raw) == (0xFEEDFACF, 0x100000C), 'Not ARM64 Mach-O')
    at = 32
    for _ in range(u32(raw, 16)):
        kind, size = struct.unpack_from('<II', raw, at)
        require(size >= 8 and at + size <= len(raw), 'Invalid load command')
        yield at, kind, raw[at:at + size]
        at += size
    require(at == 32 + u32(raw, 20), 'Load-command extent')


def sections(raw):
    result = []
    for _, kind, command in commands(raw):
        if kind != 0x19:
            continue
        for n in range(u32(command, 64)):
            at = 72 + n * 80
            name = command[at:at + 16].rstrip(b'\0').decode()
            segment = command[at + 16:at + 32].rstrip(b'\0').decode()
            va, size, off, alignment, reloc, count, flags = struct.unpack_from('<QQIIIII', command, at + 32)
            result.append(dict(name=name, segment=segment, va=va, size=size, off=off,
                               reloc=reloc, count=count, flags=flags, ordinal=len(result) + 1))
    return result


def symbols(raw):
    _, _, command = next(x for x in commands(raw) if x[1] == 2)
    off, count, strings, length = struct.unpack_from('<4I', command, 8)
    names = raw[strings:strings + length]
    result = []
    for index in range(count):
        word, kind, section, desc, value = struct.unpack_from('<IBBHQ', raw, off + index * 16)
        require(word < len(names), 'Symbol name outside string table')
        end = names.find(b'\0', word)
        require(end >= word, 'Unterminated symbol')
        result.append(dict(name=names[word:end].decode('utf-8', errors='replace'), raw_name=names[word:end].hex(), type=kind, section=section,
                           desc=desc, value=value, string=word))
    return result, names


def relocations(raw, section):
    result = []
    for i in range(section['count']):
        at, word = struct.unpack_from('<iI', raw, section['reloc'] + i * 8)
        require(0 <= at < section['size'], 'Object relocation outside section')
        result.append(dict(offset=at, type=word >> 28, external=(word >> 27) & 1,
                           width=(word >> 25) & 3, pcrel=(word >> 24) & 1, symbol=word & 0xFFFFFF))
    return result


class Object:
    def __init__(self, path, expected_hash):
        self.path = Path(path)
        self.raw = self.path.read_bytes()
        require(sha(self.raw) == expected_hash, 'Compiled object identity: ' + str(path))
        require(u32(self.raw, 12) == 1, 'Not MH_OBJECT')
        self.sections = sections(self.raw)
        self.symbols, _ = symbols(self.raw)
        self.defined = {s['name']: s for s in self.symbols if s['section'] and s['type'] & 0xE == 0xE}

    def section(self, symbol):
        return self.sections[symbol['section'] - 1]

    def extract(self, name, size=None):
        symbol = self.defined[name]
        section = self.section(symbol)
        start = symbol['value'] - section['va']
        if size is None:
            ends = [s['value'] for s in self.symbols if s['section'] == symbol['section']
                    and s['value'] > symbol['value'] and not s['name'].startswith(('ltmp', 'lCPI'))]
            size = min(ends, default=section['va'] + section['size']) - symbol['value']
        require(0 <= start <= start + size <= section['size'], 'Symbol extent outside section')
        return self.raw[section['off'] + start:section['off'] + start + size]

    def function(self, name):
        symbol = self.defined[name]
        section = self.section(symbol)
        require(section['name'] == '__text', 'Function is not in text')
        data = self.extract(name)
        start = symbol['value'] - section['va']
        rows = []
        for row in relocations(self.raw, section):
            if start <= row['offset'] < start + len(data):
                row = dict(row, offset=row['offset'] - start)
                if row['type'] != 10:
                    require(row['external'] and row['symbol'] < len(self.symbols), 'Unsupported text relocation binding')
                    row['name'] = self.symbols[row['symbol']]['name']
                rows.append(row)
        extent, encoding = len(data), 0
        compact = next((s for s in self.sections if s['name'] == '__compact_unwind'), None)
        if compact:
            require(compact['size'] % 32 == 0, 'Compact unwind alignment')
            compact_relocs = relocations(self.raw, compact)
            matches = []
            for at in range(0, compact['size'], 32):
                pointer, size, enc, personality, lsda = struct.unpack_from('<QIIQQ', self.raw, compact['off'] + at)
                if pointer == symbol['value']:
                    matches.append((at, size, enc, personality, lsda))
            require(len(matches) <= 1, 'Duplicate compact unwind function')
            if matches:
                at, extent, encoding, personality, lsda = matches[0]
                require(personality == lsda == 0 and 0 < extent <= len(data), 'Unsupported object unwind extent/personality/LSDA')
                selected = [r for r in compact_relocs if at <= r['offset'] < at + 32]
                require(len(selected) == 1 and selected[0] == dict(offset=at, type=0, external=0,
                        width=3, pcrel=0, symbol=symbol['section']), 'Unsupported compact pointer binding')
        return dict(symbol=name, object=self, source=symbol['value'], data=data, rows=rows,
                    code_size=extent, encoding=encoding)


def uleb(raw, cursor):
    value = shift = 0
    while cursor < len(raw):
        byte = raw[cursor]; cursor += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, cursor
        shift += 7
        require(shift <= 63, 'Oversized ULEB')
    raise ValueError('Truncated ULEB')


def rebases(image):
    _, _, command = next(x for x in image.commands if x[1] in (0x22, 0x80000022))
    off, size = struct.unpack_from('<II', command, 8)
    raw = image.raw[off:off + size]
    cursor = kind = segment = location = 0
    rows = []
    while cursor < len(raw):
        byte = raw[cursor]; cursor += 1
        op, imm = byte & 0xF0, byte & 15
        count = skip = 0
        if op == 0:
            require(not any(raw[cursor:]), 'Trailing rebase instructions after DONE')
            return rows
        if op == 0x10:
            kind = imm
        elif op == 0x20:
            segment = imm; location, cursor = uleb(raw, cursor)
        elif op == 0x30:
            advance, cursor = uleb(raw, cursor); location += advance
        elif op == 0x40:
            location += imm * 8
        elif op == 0x50:
            count = imm
        elif op == 0x60:
            count, cursor = uleb(raw, cursor)
        elif op == 0x70:
            count = 1; skip, cursor = uleb(raw, cursor)
        elif op == 0x80:
            count, cursor = uleb(raw, cursor); skip, cursor = uleb(raw, cursor)
        else:
            raise ValueError('Unsupported dyld rebase opcode')
        for _ in range(count):
            require(kind == 1 and segment < len(image.segments), 'Unsupported rebase kind/segment')
            seg = image.segments[segment]
            require(0 <= location <= seg['fs'] - 8 and seg['name'] != '__LINKEDIT', 'Rebase outside payload')
            rows.append((segment, location, kind))
            location += 8 + skip
    raise ValueError('Missing rebase DONE')


def page(word, pc):
    require(word & 0x9F000000 == 0x90000000, 'Expected ADRP')
    immediate = ((word >> 29) & 3) | (((word >> 5) & 0x7FFFF) << 2)
    return (pc & ~4095) + signed(immediate, 21) * 4096


def pageoff(word):
    if word & 0x7F000000 == 0x11000000:
        return ((word >> 10) & 4095) << (12 if word & (1 << 22) else 0)
    require(word & 0x3B000000 == 0x39000000, 'Expected ADD or unsigned load/store')
    # Q-register vector loads use a 16-byte scale despite size bits == 00.
    scale = 16 if (word & 0x04800000) == 0x04800000 else 1 << (word >> 30)
    return ((word >> 10) & 4095) * scale


def branch(word, pc):
    require(word & 0x7C000000 == 0x14000000, 'Expected B/BL immediate')
    return pc + signed(word & 0x3FFFFFF, 26) * 4


def veneer(image, address):
    a, b, c, d = struct.unpack('<4I', image.read(address, 16))
    require(a & 31 == 16 and b & 0xFFC003FF == 0x91000210 and c == 0xD61F0200
            and d == 0xD503201F, 'Unexpected veneer instruction/register sequence')
    return page(a, address) + pageoff(b)


def eh_model(image):
    va, size, off = image.sections['__TEXT', '__eh_frame']
    raw = image.raw[off:off + size]
    rows, at, cies = [], 0, {}
    while at < len(raw):
        length = u32(raw, at)
        if not length:
            require(not any(raw[at:]), 'Nonzero EH terminator tail')
            break
        require(length != 0xFFFFFFFF and length >= 4 and at + 4 + length <= len(raw), 'Unsupported EH record extent')
        end = at + 4 + length
        cie = u32(raw, at + 4)
        if not cie:
            payload = raw[at + 4:end]
            require(payload == bytes.fromhex('00000000017a520001781e01100c1f00'), 'Unknown EH CIE encoding')
            cies[at] = payload
            rows.append(('CIE', at, payload.hex()))
        else:
            require(at + 4 - cie in cies, 'Unknown EH CIE reference')
            target = va + at + 8 + struct.unpack_from('<q', raw, at + 8)[0]
            require(raw[at + 24] == 0, 'Unsupported FDE augmentation')
            rows.append(('FDE', at, cie, target, u64(raw, at + 16), raw[at + 24:end].hex()))
        at = end
    return rows


def metadata(image):
    ranges, sig = [], None
    for _, kind, command in image.commands:
        require(kind != 0x80000034, 'Unsupported chained fixups')
        if kind == 0x1D:
            sig = struct.unpack_from('<II', command, 8)
        if kind in (0x22, 0x80000022):
            fields = [(8 + n * 8, 1, name) for n, name in enumerate(('rebase','bind','weak_bind','lazy_bind','export'))]
        elif kind == 2:
            fields = [(8,16,'symbols'),(16,1,'strings')]
        elif kind == 0xB:
            fields = [(32,8,'toc'),(40,56,'modules'),(48,4,'external_refs'),(56,4,'indirect_symbols'),
                      (64,8,'external_relocations'),(72,8,'local_relocations')]
        elif kind in (0x1E, 0x26, 0x29, 0x2B, 0x2E, 0x80000033):
            fields = [(8,1,hex(kind))]
        else:
            fields = []
        for at, width, name in fields:
            offset, count = struct.unpack_from('<II', command, at)
            if count:
                ranges.append(dict(name=name, offset=offset, size=count * width))
            if name in ('external_relocations','local_relocations'):
                require(count == 0, 'Unprocessed external/local relocations')
    require(sig and sig[0] % 16 == 0 and sig[1] > 0 and sum(sig) == len(image.raw), 'Signature tail extent')
    tail = image.segments[-1]
    require(tail['name'] == '__LINKEDIT' and tail['off'] + tail['fs'] == len(image.raw), 'LINKEDIT extent')
    ranges.sort(key=lambda x: x['offset'])
    for row in ranges:
        require(tail['off'] <= row['offset'] and row['offset'] + row['size'] <= sig[0], 'Loader metadata outside trim boundary')
    require(all(a['offset'] + a['size'] <= b['offset'] for a, b in zip(ranges, ranges[1:])), 'Overlapping loader metadata')
    require(ranges[-1]['name'] == 'strings' and (ranges[-1]['offset'] + ranges[-1]['size'] + 15) & ~15 == sig[0], 'ldid would trim loader metadata')
    return dict(ranges=ranges, signature_offset=sig[0], signature_size=sig[1], ldid_code_limit=sig[0])


def loader_contract(old, new, linked, old_layout, new_layout):
    """Check metadata not interpreted elsewhere and restrict all header edits."""
    before_ranges = {x['name']:x for x in old_layout['ranges']}
    after_ranges = {x['name']:x for x in new_layout['ranges']}
    require(before_ranges.keys() == after_ranges.keys(), 'Loader metadata kinds changed')
    for name, a in before_ranges.items():
        b = after_ranges[name]
        if name not in ('rebase','symbols','0x26'):
            require(old.raw[a['offset']:a['offset']+a['size']] == new.raw[b['offset']:b['offset']+b['size']],
                    'Unrelated loader metadata changed: ' + name)
    require(old.raw[old_layout['signature_offset']:] == new.raw[new_layout['signature_offset']:], 'Unsigned signature placeholder changed')
    growth = linked['executable_extension']['size']
    for index,(a,b) in enumerate(zip(old.segments,new.segments)):
        expected = dict(a)
        if index == len(old.segments)-2:
            expected.update(fs=a['fs']+growth,vs=a['vs']+growth)
        elif index == len(old.segments)-1:
            fs=len(new.raw)-(a['off']+growth)
            expected.update(off=a['off']+growth,vm=a['vm']+growth,fs=fs,vs=(fs+16383)&~16383)
        require(expected==b,'Unexpected segment growth or mapping')
    def headers(image):
        result={}
        for _,kind,command in image.commands:
            if kind==0x19:
                for n in range(u32(command,64)):
                    at=72+n*80; raw=command[at:at+80]
                    result[raw[16:32].rstrip(b'\0').decode(),raw[:16].rstrip(b'\0').decode()]=raw
        return result
    a_sections,b_sections=headers(old),headers(new)
    require(a_sections.keys()==b_sections.keys(),'Section identities changed')
    old_eh=old.sections['__TEXT','__eh_frame']; new_eh=new.sections['__TEXT','__eh_frame']
    moved=old_eh[0]!=new_eh[0]
    if moved:
        require(not any(old.raw[new_eh[2]:new_eh[2]+new_eh[1]]) and
                new_eh[2]>=32+u32(new.raw,20) and new_eh[2]+new_eh[1]<=old.sections['__TEXT','__text'][2],
                'EH destination is not unused header padding')
    for key,a in a_sections.items():
        b=b_sections[key]; expected=bytearray(a)
        if key==('__TEXT','__eh_frame'):
            require(u64(b,40)==u64(a,40),'EH size changed')
            struct.pack_into('<Q',expected,32,new_eh[0]); struct.pack_into('<I',expected,48,new_eh[2])
        elif key==('__TEXT','__unwind_info'):
            expected_size=u64(a,40)+(old_eh[1] if moved else 0)
            struct.pack_into('<Q',expected,40,expected_size)
        elif key[0]=='__EQFIX':
            struct.pack_into('<Q',expected,40,old.segments[-2]['fs']+linked['executable_extension']['payload'])
        elif key[0]=='__CNADTAB':
            struct.pack_into('<Q',expected,40,u64(new.raw,INFO+88)+linked['total_methods']*16-u64(a,32))
        bridges=[r for r in linked['entry_bridges'] if r['segment']==key[0]]
        if bridges:
            struct.pack_into('<Q',expected,40,max([u64(expected,40)]+[r['address']+r['size']-u64(a,32) for r in bridges]))
        require(bytes(expected)==b,'Unexpected section header field changed: '+str(key))
    offset_fields={2:[8,16],0xB:[32,40,48,56,64,72],0x22:[8,16,24,32,40],0x80000022:[8,16,24,32,40]}
    data_commands={0x1D,0x1E,0x26,0x29,0x2B,0x2E,0x80000033}
    require(len(old.commands)==len(new.commands),'Load command count changed')
    for (_,ka,a),(_,kb,b) in zip(old.commands,new.commands):
        require(ka==kb and len(a)==len(b),'Load command layout changed')
        aa,bb=bytearray(a),bytearray(b)
        if ka==0x19:
            # Section payloads were checked by identity above, including reordered TEXT headers.
            aa=aa[:72]; bb=bb[:72]
            aa[24:56]=bb[24:56]=bytes(32)
        else:
            fields=offset_fields.get(ka,[8] if ka in data_commands else [])
            for at in fields:
                aa[at:at+4]=bb[at:at+4]=bytes(4)
            if ka in (0x22,0x80000022,0x26):
                aa[12:16]=bb[12:16]=bytes(4)
        require(aa==bb,'Unrelated load command bytes changed: '+hex(ka))
    return dict(unrelated_loader_payloads_preserved=True,load_commands_restricted=True,eh_moved_into_zero_header=moved)


def decoder_contract_tests(image):
    """Small fault injections exercise rejection paths without changing files."""
    rejected=[]
    def reject(name, call):
        try:
            call()
        except ValueError:
            rejected.append(name)
        else:
            raise ValueError('Negative verification did not reject: '+name)
    require(branch(0x97FFFFFF,0x1000)==0xFFC,'Signed BRANCH26 self-test')
    require(page(0xF0FFFFE0,0x2000)==0x1000,'Signed ADRP self-test')
    require(pageoff(0xF9400800)==16 and pageoff(0x3DC00800)==32,'Scaled PAGEOFF self-test')
    reject('non_branch_opcode',lambda:branch(0xD503201F,0x1000))
    reject('non_adrp_opcode',lambda:page(0xD503201F,0x1000))
    reject('non_pageoff_opcode',lambda:pageoff(0xD503201F))
    def changed_command(kind, at, value):
        rows=[]
        for pos,cmd,raw in image.commands:
            if cmd==kind:
                raw=bytearray(raw); struct.pack_into('<I',raw,at,value); raw=bytes(raw)
            rows.append((pos,cmd,raw))
        return SimpleNamespace(raw=image.raw,commands=rows,segments=image.segments)
    layout=metadata(image)
    reject('loader_metadata_in_signature',lambda:metadata(changed_command(0x26,8,layout['signature_offset'])))
    _,_,symtab=next(x for x in image.commands if x[1]==2)
    reject('ldid_truncates_metadata',lambda:metadata(changed_command(2,20,u32(symtab,20)-32)))
    return dict(passed=8,negative_cases=rejected,scope='in-memory decoder and loader-boundary mutations; candidate bytes untouched')


def payload(zipper, info):
    zipper.fp.seek(info.header_offset)
    header = zipper.fp.read(30)
    require(header[:4] == b'PK\x03\x04', 'ZIP local header magic')
    name_size, extra_size = struct.unpack_from('<HH', header, 26)
    zipper.fp.seek(name_size + extra_size, 1)
    return zipper.fp.read(info.compress_size)


def package_readback(package, linked, previous_package):
    source = linked['source_ipa']
    current_path, previous_path = Path(package['ipa']), Path(source['ipa'])
    require(sha(current_path.read_bytes()) == package['ipa_sha256'], 'Final IPA digest')
    require(sha(previous_path.read_bytes()) == source['ipa_sha256'] == previous_package['ipa_sha256'], 'Previous IPA digest')
    changed = []
    with zipfile.ZipFile(previous_path) as old, zipfile.ZipFile(current_path) as new:
        require(old.namelist() == new.namelist() and len(set(new.namelist())) == len(new.namelist()), 'ZIP member order or duplicates')
        require(old.comment == new.comment, 'ZIP archive comment changed')
        for a, b in zip(old.infolist(), new.infolist()):
            require(all(getattr(a, k) == getattr(b, k) for k in ('filename','date_time','compress_type','comment','extra',
                    'create_system','create_version','extract_version','flag_bits','internal_attr','external_attr')), 'ZIP metadata changed: ' + a.filename)
            if payload(old, a) != payload(new, b):
                changed.append(a.filename)
            else:
                require((a.CRC, a.file_size, a.compress_size) == (b.CRC, b.file_size, b.compress_size), 'Unchanged ZIP CRC/size differs')
        require(set(changed) == {source['native_member'], source['swf_member']}, 'Unexpected changed ZIP members')
        native, swf = new.read(source['native_member']), new.read(source['swf_member'])
        previous_native, previous_swf = old.read(source['native_member']), old.read(source['swf_member'])
        # zipfile validates CRC while reading these two replacement payloads.
        plist = plistlib.loads(new.read('Payload/worldflipper.app/Info.plist'))
        require((plist['CFBundleIdentifier'], plist['CFBundleShortVersionString'], plist['CFBundleVersion']) ==
                ('com.kulo.wf', '1.8.4', '1.8.46'), 'Package identity changed')
    require(sha(native) == package['native_sha256'] == linked['native_sha256'] and
            sha(swf) == package['swf_sha256'] == linked['swf_sha256'], 'Packaged native/SWF differs from report')
    require(sha(previous_native) == source['native_sha256'] and sha(previous_swf) == source['swf_sha256'], 'Prior ZIP payload identity')
    require(native == Path(linked['native_file']).read_bytes() and swf == Path(linked['swf_file']).read_bytes(), 'Loose artifacts differ from IPA')
    return Image(previous_native), Image(native), previous_swf, swf, dict(changed_members=changed,
            unchanged_compressed_members_exact=len(new.infolist()) - 2, replacement_payload_crc_verified=True,
            package_identity=['com.kulo.wf','1.8.4','1.8.46'])


def abc_checks(old, new, previous, linked, prepared, meta):
    from build_swf import abcfmt, freeze
    full = Path(linked['full_abc_file']).read_bytes()
    old_full = Path(previous['full_abc_file']).read_bytes()
    require(sha(full) == linked['full_abc_sha256'] == prepared['full_abc_sha256'] and sha(old_full) == previous['full_abc_sha256'], 'Full ABC lineage')
    require(prepared.get('base_full_abc_sha256', prepared.get('input_full_abc_sha256')) == sha(old_full), 'Preparation input is not previous ABC')
    digest = hashlib.sha1(full).digest()
    require(new.raw[INFO:INFO + 20] == digest and digest.hex() == linked['full_abc_sha1'], 'AOTInfo SHA1')
    count, old_count = u64(new.raw, INFO + 56), u64(old.raw, INFO + 56)
    require(count == linked['total_methods'] == prepared['total_methods'] and old_count == prepared['old_methods'], 'AOT method count')
    runtime = new.read(u64(new.raw, INFO + 24), u64(new.raw, INFO + 32))
    old_runtime = old.read(u64(old.raw, INFO + 24), u64(old.raw, INFO + 32))
    require(sha(runtime) == linked['runtime_abc_sha256'] and runtime == Path(linked['runtime_abc_file']).read_bytes(), 'Runtime ABC identity')
    a, b, c, d = map(abcfmt.ABC, (old_full, full, old_runtime, runtime))
    fields = ('methods','metadata','scripts','ints','uints','doubles','strings','namespaces','ns_sets','multinames')
    for field in fields:
        old_rows, new_rows = getattr(a, field), getattr(b, field)
        require(freeze(old_rows) == freeze(new_rows[:len(old_rows)]), 'Full ABC prefix: ' + field)
        require(freeze(new_rows) == freeze(getattr(d, field)), 'Runtime/full declaration: ' + field)
    for field in ('instances','classes'):
        require(freeze(getattr(b, field)) == freeze(getattr(d, field)), 'Runtime/full class layout')
        for before, after in zip(getattr(a, field), getattr(b, field)):
            require(freeze(before[:-1]) == freeze(after[:-1]) and freeze(before[-1]) == freeze(after[-1][:len(before[-1])]), 'Old class layout changed')
            require(all(t.kind not in (0,6) for t in after[-1][len(before[-1]):]), 'New old-class storage slot')
    targets = {int(r['method_id']): r for r in prepared['methods'] if r.get('strategy','replace') == 'replace'}
    old_bodies, new_bodies = ({x[0]: x for x in abc.bodies} for abc in (a,b))
    changed = []
    for mid, body in old_bodies.items():
        current = new_bodies[mid]
        if freeze(body) != freeze(current):
            changed.append(mid)
            require(mid in targets, 'Unlisted changed full ABC method: ' + str(mid))
        if mid in targets:
            row = targets[mid]
            require(sha(body[5]) == row['before_code_sha256'] and sha(current[5]) == row['after_code_sha256'], 'Prepared method code hash')
            require(freeze(body[7]) == freeze(current[7]), 'Changed activation traits')
    old_runtime_bodies = {x[0]: x for x in c.bodies}
    meta_info = meta.extract(next(n for n in meta.defined if n.endswith('_284_aotInfo')), 168)
    compiled_raw = meta.extract(next(n for n in meta.defined if n.endswith('_abcBytes')), u64(meta_info, 32))
    compiled_abc = abcfmt.ABC(compiled_raw)
    compiled_bodies = {x[0]: x for x in compiled_abc.bodies}
    require({x[0] for x in d.bodies} == compiled_bodies.keys() and len({x[0] for x in d.bodies}) == len(d.bodies), 'Runtime method-body set')
    for body in d.bodies:
        mid = body[0]
        expected = compiled_bodies[mid] if mid in targets or mid >= old_count else old_runtime_bodies[mid]
        require(freeze(body) == freeze(expected), 'Runtime body differs from compiler/preserved body: ' + str(mid))
    flags = new.read(u64(new.raw, INFO + 64), count * 4)
    compiler_flags = meta.extract(next(n for n in meta.defined if n.endswith('_methodFlagsArr')), count * 4)
    require(flags == compiler_flags and flags[:old_count * 4] == old.read(u64(old.raw, INFO + 64), old_count * 4), 'Flags compiler/new or old prefix')
    require(u64(new.raw, INFO + 48) == u64(old.raw, INFO + 48) and u64(new.raw, INFO + 88) == u64(old.raw, INFO + 88), 'AOT table address moved')
    mutable = set(range(20)) | set(range(24,40)) | set(range(56,72))
    require(all(new.raw[INFO + n] == old.raw[INFO + n] for n in range(168) if n not in mutable), 'Unrelated AOTInfo fields changed')
    return dict(old_methods=old_count, total_methods=count, targets=sorted(targets), changed_existing_bodies=sorted(changed),
                new_method_ids=list(range(old_count,count)), full_abc_sha256=sha(full), runtime_abc_sha256=sha(runtime),
                declaration_pool_prefix_preserved=True, unrelated_runtime_bodies_preserved=True, flags_prefix_exact=True)


def verify(args):
    sys.path[:0] = [str(args.libraries), str(CLIENT / 'pr43-ios/support'), str(CLIENT / 'lens0907-0908'),
                    str(CLIENT / 'ios-cumulative-login')]
    package, equipment = read(args.package_report), read(args.equipment_link)
    linked = read(package['link_report'])
    previous, previous_package = read(linked['previous_link_report']), read(linked['previous_package_report'])
    prepared, compiled = read(linked['source_prepare_report']), read(linked['compiled_report'])
    require(package['status'] == 'unsigned_offline_candidate' and linked['status'] == 'linked_native_not_executed'
            and linked['unwind_finalized'] and package['signing'] == 'unsigned', 'Not finalized unsigned candidate')
    require(not any(package.get(k) for k in ('native_executed','device_tested','accepted_registry_updated')), 'Candidate acceptance mislabel')
    for field, path in (('previous_link_sha256',linked['previous_link_report']),
                        ('previous_package_sha256',linked['previous_package_report']),
                        ('prepared_report_sha256',linked['source_prepare_report'])):
        require(sha(Path(path).read_bytes()) == linked[field], 'Report lineage hash: ' + field)
    old, new, old_swf, swf, package_proof = package_readback(package, linked, previous_package)
    require(sha(old.raw) == previous['native_sha256'], 'Previous native lineage')
    objects = [Object(Path(compiled['directory']) / row['name'], row['sha256']) for row in compiled['objects']]
    meta, = [obj for obj in objects if any(n.endswith('_284_aotInfo') for n in obj.defined)]
    abc = abc_checks(old,new,previous,linked,prepared,meta)
    require(compiled['full_abc_sha256'] == abc['full_abc_sha256'], 'Compiler full ABC lineage')
    require(compiled['prepared_report_sha256'] == sha(Path(linked['source_prepare_report']).read_bytes()), 'Compiler preparation report lineage')
    info_name=next(n for n in meta.defined if n.endswith('_284_aotInfo'))
    require(meta.extract(info_name,20).hex()==compiled['compile_input_sha1'],'Compiler AOTInfo input digest')
    def plain(raw):
        require(raw[:3] in (b'CWS',b'FWS'), 'Unsupported SWF compression')
        data = b'FWS' + raw[3:8] + zlib.decompress(raw[8:]) if raw[:3] == b'CWS' else raw
        require(u32(data,4) == len(data), 'SWF length')
        return data
    before_swf, after_swf = plain(old_swf), plain(swf)
    needle = bytes(4) + old.raw[INFO:INFO + 20]
    require(before_swf.count(needle) == 1 and after_swf == before_swf.replace(needle, bytes(4) + new.raw[INFO:INFO + 20]), 'SWF changed beyond main AOT digest')

    functions = {int(r['method']): r for r in linked['functions']}
    wanted = set(range(abc['old_methods'],abc['total_methods'])) | set(abc['targets']) | set(map(int,prepared.get('compiled_helpers',[])))
    wanted |= {int(r['compiled']) for r in prepared.get('method_redirects',[])}
    wanted |= set(map(int, linked.get('generated_initializers',{}).values()))
    require(set(functions) == wanted and len(functions) == len(linked['functions']), 'Compiled function IDs are not one-to-one')
    definitions, function_proofs, relocation_proofs, addend_proofs = {}, [], [], []
    for mid, row in functions.items():
        generated = [name for name,key in linked.get('generated_initializers',{}).items() if int(key) == mid]
        candidates = [(obj,name) for obj in objects for name in obj.defined if
                      (name in generated if mid < 0 else re.search(rf':{mid}:', name))]
        require(len(candidates) == 1, 'Ambiguous compiled function: ' + str(mid))
        obj, name = candidates[0]
        fn = obj.function(name)
        require(row['size'] == len(fn['data']) and new.offset(row['address'], row['size']) == row['file_offset'], 'Function size/file mapping')
        actual = new.read(row['address'],row['size'])
        require(sha(actual) == row['sha256'], 'Final function SHA256')
        fn.update(row=row, actual=actual)
        definitions[mid] = fn
    named = {fn['symbol']: fn['row']['address'] for fn in definitions.values()}
    old_count, count = abc['old_methods'], abc['total_methods']
    active = u64(old.raw, INFO + 48)
    named.update({s['name']:u64(old.read(active + int(m.group(1)) * 8,8))
                  for obj in objects for s in obj.symbols if (m := re.search(r':(\d+):',s['name']))
                  and int(m.group(1)) < old_count and s['name'] not in named})
    named[next(n for n in meta.defined if n.endswith('_284_aotInfo'))] = BASE + INFO
    from fixed_inputs import fixed_json
    import aot_helpers
    helpers = {n:int(v['address'],0) for n,v in fixed_json('runtime-helper-map.json')['symbols'].items()}
    helpers.update(aot_helpers.DEPENDENCY_AOT_INFOS)
    helpers.update({n:v['address'] for n,v in fixed_json('runtime-extra-map.json').items()})
    extra = fixed_json('additional-helper.json'); helpers[extra['symbol']] = extra['address']
    helpers[aot_helpers.STRICT_EQUALS_SYMBOL] = aot_helpers.STRICT_EQUALS_VA
    runtime_objects={}
    for name, proof in linked.get('runtime_helper_proofs',{}).items():
        address = proof['address']
        require(old.read(address, len(bytes.fromhex(proof['native_bytes']))).hex() == proof['native_bytes'], 'Runtime helper preimage')
        if 'abc_file' in proof:
            dependency = Path(proof['abc_file']).read_bytes()
            require(sha(dependency) == proof['abc_sha256'] and old.read(address,20) == hashlib.sha1(dependency).digest(), 'Dependency AOT identity')
        else:
            path=proof['object']
            if path not in runtime_objects:
                runtime_objects[path]=Object(path,proof['object_sha256'])
            obj=runtime_objects[path]; symbol=obj.defined[name]; section=obj.section(symbol)
            data=obj.extract(name,proof['size']); start=symbol['value']-section['va']
            masks=set()
            for row in relocations(obj.raw,section):
                if start<=row['offset']<start+len(data):
                    masks.update(range(row['offset']-start,row['offset']-start+(1<<row['width'])))
            actual=old.read(address,len(data))
            require(all(x==y for at,(x,y) in enumerate(zip(data,actual)) if at not in masks),'Runtime helper object/native bytes')
        helpers[name] = address
    declared_relocs = {(r['method'],r['offset']):r for r in linked['relocations']}
    require(len(declared_relocs) == len(linked['relocations']), 'Duplicate linked relocation')
    seen, constant_bindings = set(), {}
    for mid, fn in definitions.items():
        row, raw, rows = fn['row'], fn['data'], fn['rows']
        addends = {r['offset']:signed(r['symbol'],24) for r in rows if r['type'] == 10}
        require(len(addends) == sum(r['type'] == 10 for r in rows), 'Duplicate ADDEND')
        ordinary = [r for r in rows if r['type'] != 10]
        require(set(addends) <= {r['offset'] for r in ordinary}, 'Unpaired ADDEND')
        patched_offsets = set()
        for r in ordinary:
            key, at, typ, name = (mid,r['offset']), r['offset'], r['type'], r['name']
            require(key in declared_relocs and typ in (2,3,4,5,6) and r['width'] == 2, 'Missing/unsupported object relocation')
            require(r['pcrel']==int(typ in (2,3,5)), 'Unexpected relocation PC-relative flag')
            report = declared_relocs[key]; pc = row['address'] + at; addend = addends.get(at,0)
            require(report['type'] == typ and report['symbol'] == name and report['pc'] == pc, 'Object/report relocation mismatch')
            if name in named:
                target = named[name] + addend
            elif name in helpers:
                target = helpers[name] + addend
            elif name.startswith(('lCPI','_exceptionDesc')):
                symbol = fn['object'].defined[name]; section = fn['object'].section(symbol)
                require(section['name'] in ('__const','__literal8','__literal16'), 'Unexpected constant section')
                ends = [s['value'] for s in fn['object'].symbols if s['section'] == symbol['section'] and s['value'] > symbol['value']]
                length = min(ends, default=section['va'] + section['size']) - symbol['value']
                data = fn['object'].extract(name,length)
                binding = report['target'] - addend
                require(new.read(binding,len(data)) == data and not any(symbol['value'] - section['va'] <= x['offset'] < symbol['value'] - section['va'] + length
                        for x in relocations(fn['object'].raw,section)), 'Constant bytes/relocations')
                constant_key = (str(fn['object'].path),name)
                require(constant_key not in constant_bindings or constant_bindings[constant_key] == binding, 'Inconsistent constant binding')
                constant_bindings[constant_key] = binding
                target = binding + addend
            else:
                raise ValueError('Unresolved independent symbol: ' + name)
            require(target == report['target'], 'Incorrect logical relocation target')
            word, original = u32(fn['actual'],at), u32(raw,at)
            if typ == 2:
                destination = branch(word,pc)
                require(destination == report['branch_target'] and word & 0xFC000000 == original & 0xFC000000, 'BRANCH26 decode/opcode')
                require((destination == target) or veneer(new,destination) == target, 'Veneer does not reach logical target')
            elif typ in (3,5):
                require(page(word,pc) == target & ~4095 and word & ~((3<<29)|(0x7FFFF<<5)) == original & ~((3<<29)|(0x7FFFF<<5)), 'ADRP decode/register')
            else:
                require(pageoff(word) == target & 4095, 'PAGEOFF12 decode')
                if typ == 6:
                    require(word & 0xFFC003FF == 0x91000000 | (original & 1023), 'GOT relaxation changed registers')
                else:
                    require(word & ~(4095<<10) == original & ~(4095<<10), 'PAGEOFF opcode/register changed')
            patched_offsets.update(range(at,at+4)); seen.add(key)
            relocation_proofs.append(dict(method=mid, offset=at, type=typ, symbol=name, addend=addend, target=target))
        require(all(a == b for n,(a,b) in enumerate(zip(raw,fn['actual'])) if n not in patched_offsets), 'Unrelocated function bytes differ')
        for at, value in addends.items():
            addend_proofs.append(dict(method=mid,offset=at,addend=value,paired_type=next(r['type'] for r in ordinary if r['offset']==at)))
        function_proofs.append(dict(method=mid, symbol=fn['symbol'], object=str(fn['object'].path), address=row['address'],
                                   size=row['size'], sha256=row['sha256'], code_size=fn['code_size'], unwind_encoding=fn['encoding']))
    require(seen == set(declared_relocs), 'Report contains non-object relocation')

    expected_table = bytearray(old.read(active,old_count*8) + bytes((count-old_count)*8))
    expected_legacy = bytearray(old.raw[LEGACY:LEGACY+LEGACY_COUNT*8])
    changed_slots = {}
    for mid, fn in definitions.items():
        if mid >= 0:
            changed_slots[mid] = fn['row']['address']
    for row in prepared.get('method_redirects',[]):
        changed_slots[int(row['original'])] = definitions[int(row['compiled'])]['row']['address']
    for mid,target in changed_slots.items():
        struct.pack_into('<Q',expected_table,mid*8,target)
        if mid < LEGACY_COUNT:
            struct.pack_into('<Q',expected_legacy,mid*8,target)
    require(new.read(active,count*8) == expected_table and new.raw[LEGACY:LEGACY+LEGACY_COUNT*8] == expected_legacy, 'Active/legacy table exact contents')
    expected_hooks=set()
    for mid,target in changed_slots.items():
        if mid < old_count:
            expected_hooks.add((mid,u64(old.read(active+mid*8,8)),target))
            if mid < LEGACY_COUNT:
                expected_hooks.add((mid,u64(old.raw,LEGACY+mid*8),target))
    require({(r['method'],r['previous'],r['target']) for r in linked['hooks']} == expected_hooks and len(linked['hooks'])==len(expected_hooks),
            'Legacy/active native hook coverage differs from prepared targets')
    activation = u64(old.raw, INFO+88)
    require(new.read(activation,old_count*16) == old.read(activation,old_count*16), 'Old activation descriptor prefix')
    act_name = next(n for n in meta.defined if n.endswith('_activationInfo'))
    act_symbol = meta.defined[act_name]; act_section = meta.section(act_symbol)
    activation_tail = bytearray(meta.extract(act_name,count*16)[old_count*16:])
    new_act_relocs = []
    act_start = act_symbol['value'] - act_section['va'] + old_count*16
    for r in relocations(meta.raw,act_section):
        if act_start <= r['offset'] < act_start + len(activation_tail):
            at = r['offset'] - act_start
            require(r['type'] == 0 and r['external'] == 1 and r['width'] == 3 and at % 16 == 8 and u64(activation_tail,at) == 0, 'Activation pointer relocation format')
            name = meta.symbols[r['symbol']]['name']
            require(name in named, 'Activation initializer unresolved')
            struct.pack_into('<Q',activation_tail,at,named[name]); new_act_relocs.append(at)
    require(new.read(activation+old_count*16,len(activation_tail)) == activation_tail, 'New activation bytes')
    old_rebases, new_rebases = rebases(old), rebases(new)
    require(new_rebases[:len(old_rebases)] == old_rebases, 'Existing rebase prefix changed')
    table_seg = next(i for i,s in enumerate(new.segments) if s['vm'] <= active < s['vm']+s['fs'])
    seg = new.segments[table_seg]
    expected_new_rebases = [(table_seg,active + mid*8-seg['vm'],1) for mid in range(old_count,count)]
    expected_new_rebases += [(table_seg,activation+old_count*16+at-seg['vm'],1) for at in new_act_relocs]
    require(new_rebases[len(old_rebases):] == sorted(expected_new_rebases), 'New pointer rebase coverage')
    old_rebase_set = set(old_rebases)
    for mid in changed_slots:
        if mid < old_count:
            require((table_seg,active+mid*8-seg['vm'],1) in old_rebase_set, 'Existing changed pointer lacks rebase')

    new_starts, old_starts = function_starts(new), function_starts(old)
    require(old_starts <= new_starts, 'Old function starts lost')
    additions = {r['address']-BASE for r in linked['functions']+linked['entry_bridges']+linked['veneers']}
    require(new_starts == old_starts | additions, 'Function starts missing/extra new entry')
    for r in linked['veneers'] + linked['entry_bridges']:
        require(sha(new.read(r['address'],r['size'])) == r['sha256'] and veneer(new,r['address']) == r['target'], 'Veneer/entry bridge bytes')
    for hook in linked['hooks']:
        require(old.offset(hook['previous'],4) == hook['offset'], 'Hook address/file offset')
        destination = branch(u32(new.raw,hook['offset']),hook['previous'])
        require(destination == hook['target'] or veneer(new,destination) == hook['target'], 'Old entry hook destination')
    def unwind(image):
        _,size,off = image.sections['__TEXT','__unwind_info']
        return unwind_semantics(image.raw[off:off+size])
    old_unwind, new_unwind = unwind(old), unwind(new)
    require(all(new_unwind[0].get(at) == enc for at,enc in old_unwind[0].items()) and old_unwind[1:3] == new_unwind[1:3], 'Old unwind boundary/personality/LSDA')
    keys = sorted(new_unwind[0])
    def lookup(at):
        index = bisect.bisect_right(keys,at)-1
        return new_unwind[0][keys[index]] if index >= 0 and at < new_unwind[3] else 0
    old_keys = sorted(old_unwind[0])
    for i,start in enumerate(old_keys):
        end = old_keys[i+1] if i+1 < len(old_keys) else old_unwind[3]
        enc = old_unwind[0][start]
        if enc:
            probes = [start,end-1] + keys[bisect.bisect_right(keys,start):bisect.bisect_left(keys,end)]
            require(all(lookup(at) == enc for at in probes), 'Old nonzero unwind interval changed')
    tail_proofs = []
    for mid, fn in definitions.items():
        row = fn['row']; begin=row['address']-BASE; code_end=begin+fn['code_size']; end=begin+row['size']
        probes = [begin,code_end-1] + keys[bisect.bisect_right(keys,begin):bisect.bisect_left(keys,code_end)]
        require(all(lookup(at) == fn['encoding'] for at in probes), 'New function unwind encoding')
        if code_end < end:
            rows = fn['rows']; addends={r['offset']:signed(r['symbol'],24) for r in rows if r['type']==10}
            offsets = sorted({addends[r['offset']] for r in rows if r['type'] in (3,4) and r['name']==fn['symbol']
                              and fn['code_size'] <= addends.get(r['offset'],-1) < row['size']})
            require(offsets and offsets[0] == fn['code_size'] and all(r['offset'] < fn['code_size'] for r in rows), 'Inline data lacks object ownership')
            tables=[]
            for j,at in enumerate(offsets):
                limit=offsets[j+1] if j+1<len(offsets) else row['size']
                require(at%4 == limit%4 == 0, 'Switch table alignment')
                deltas=struct.unpack_from('<'+'i'*((limit-at)//4),fn['actual'],at)
                targets=[at+x for x in deltas]
                require(all(0 <= x < fn['code_size'] and x%4==0 for x in targets), 'Switch table target leaves code')
                require(sum(r['type']==3 and r.get('name')==fn['symbol'] and addends.get(r['offset'])==at for r in rows)==1 and
                        sum(r['type']==4 and r.get('name')==fn['symbol'] and addends.get(r['offset'])==at for r in rows)==1, 'Switch page pair ownership')
                tables.append(dict(offset=at,size=limit-at,targets=targets))
            require(all(lookup(at)==0 for at in range(code_end,end,4)) and not any(code_end<=at<end for at in new_starts), 'Inline data has unwind frame/function start')
            tail_proofs.append(dict(method=mid,code_size=fn['code_size'],data_size=end-code_end,tables=tables))
    for row in linked['entry_bridges']+linked['veneers']:
        require(lookup(row['address']-BASE)==0 and lookup(row['address']-BASE+row['size']-1)==0, 'Bridge/veneer has invented unwind frame')
    require(eh_model(old)==eh_model(new),'EH CIE/FDE target/CFI changed')
    old_sections, new_sections = sections(old.raw), sections(new.raw)
    section_map={s['ordinal']:next(t['ordinal'] for t in new_sections if (t['name'],t['segment'])==(s['name'],s['segment'])) for s in old_sections}
    require(all(s['count']==0 for s in old_sections+new_sections),'Unhandled section relocation')
    before_symbols, before_strings = symbols(old.raw); after_symbols, after_strings=symbols(new.raw)
    require(len(before_symbols)==len(after_symbols) and before_strings==after_strings,'Symbol count/strings changed')
    symbol_changes=[]
    for i,(a,b) in enumerate(zip(before_symbols,after_symbols)):
        expected=dict(a)
        # Retain section associations of N_FUN and the existing N_SO end records.
        if a['type'] == 0x64 and a['section']:
            require(a['name'] == '' and a['value'] == 0, 'Unknown N_SO section association')
        if a['section'] and ((a['type'] & 0xE == 0xE and not a['type'] & 0xE0) or a['type'] in (0x24,0x64)):
            expected['section']=section_map[a['section']]
        require(expected==b,'Unrelated nlist changed: ' + repr((i,a,b,expected)))
        if a!=b:
            symbol_changes.append(i)
    require(len(old.segments)==len(new.segments)==19,'Segment count changed')
    for a,b in zip(old.segments[:-1],new.segments[:-1]):
        require((a['name'],a['vm'],a['off'])==(b['name'],b['vm'],b['off']),'Existing segment VA/file offset changed')
    layout=metadata(new); old_layout=metadata(old)
    loader=loader_contract(old,new,linked,old_layout,layout)
    decoder_tests=decoder_contract_tests(new)
    old_eh_va,old_eh_size,_=old.sections['__TEXT','__eh_frame']
    if old_eh_va!=new.sections['__TEXT','__eh_frame'][0]:
        require(all(not old_eh_va<=s['value']<old_eh_va+old_eh_size for s in before_symbols),'Old nlist points into relocated EH')
        require(all(not old_eh_va<=u64(old.raw,old.segments[si]['off']+off)<old_eh_va+old_eh_size
                    for si,off,_ in old_rebases),'Old rebase points into relocated EH')
    for r in new_rebases:
        si,off,_=r; at=new.segments[si]['off']+off
        require(not any(m['offset']<=at<m['offset']+m['size'] for m in layout['ranges']),'Rebase overlaps loader metadata')
    # Derive every allowed prefix mutation from decoded contracts, not linker receipts.
    allowed=[(0,32+u32(new.raw,20)),(INFO,INFO+20),(INFO+24,INFO+40),(INFO+56,INFO+72)]
    allowed += [(new.offset(active+mid*8),new.offset(active+mid*8)+8) for mid in changed_slots]
    allowed += [(LEGACY+mid*8,LEGACY+mid*8+8) for mid in changed_slots if mid<LEGACY_COUNT]
    allowed += [(new.offset(activation+old_count*16),new.offset(activation+old_count*16)+len(activation_tail))] if activation_tail else []
    allowed += [(r['offset'],r['offset']+4) for r in linked['hooks']]
    allowed += [(r['file_offset'],r['file_offset']+r['size']) for r in linked['entry_bridges']]
    for image in (old,new):
        for name in ('__unwind_info','__eh_frame'):
            _,size,off=image.sections['__TEXT',name]; allowed.append((off,off+size))
    end=old.segments[-1]['off']; prefix=bytearray(new.raw[:end])
    for lo,hi in allowed:
        if lo<end:
            prefix[lo:min(hi,end)]=old.raw[lo:min(hi,end)]
    require(prefix==old.raw[:end],'Unexpected existing native bytes changed')
    plan=read(equipment['plan_file']); plan_dir=Path(equipment['plan_file']).parent
    for r in plan['chunks']:
        require(new.read(r['va'],r['bytes'])==(plan_dir/r['file']).read_bytes(),'Equipment chunk changed')
    for r in plan['patches']:
        after=bytes.fromhex(r['after']); require(new.raw[r['file_offset']:r['file_offset']+len(after)]==after,'Equipment patch changed')
    for r in plan['preserved_native_ranges']:
        require(sha(new.read(r['va'],r['bytes']))==r['sha256'],'Equipment protected resolver bytes changed')
    detail=dict(abc=abc,functions=function_proofs,relocations=relocation_proofs,addends=addend_proofs,switch_tables=tail_proofs,
                metadata=layout,loader=loader,decoder_contract_tests=decoder_tests,symbol_section_changed_indices=symbol_changes,old_unwind_boundary_count=len(old_unwind[0]),
                old_rebase_count=len(old_rebases),new_rebase_count=len(new_rebases),new_rebase_entries=expected_new_rebases,
                allowed_native_prefix_ranges=allowed,package=package_proof)
    dump(args.detail_output,detail)
    result=dict(status='independent_actual_stage_package_readback_passed',ipa=package['ipa'],ipa_sha256=package['ipa_sha256'],
                native_sha256=sha(new.raw),swf_sha256=sha(swf),full_abc_sha256=abc['full_abc_sha256'],
                total_methods=count,replaced_methods=len(abc['targets']),compiled_functions=len(functions),
                relocations_checked=len(relocation_proofs),relocation_types=dict(Counter(r['type'] for r in relocation_proofs)),
                addend_rows_checked=len(addend_proofs),inline_switch_functions=len(tail_proofs),
                old_rebases_preserved=len(old_rebases),new_pointer_rebases=len(expected_new_rebases),
                old_unwind_boundaries_preserved=len(old_unwind[0]),new_function_starts=len(new_starts-old_starts),
                eh_cfi_and_absolute_targets_preserved=True,symbol_section_updates=len(symbol_changes),
                existing_native_prefix_preserved=True,equipment_chunks_preserved=len(plan['chunks']),equipment_patches_preserved=len(plan['patches']),
                package=package_proof,loader=loader,decoder_contract_tests=decoder_tests,signing='unsigned',native_executed=False,device_tested=False,accepted_registry_updated=False,
                detail_report=str(args.detail_output.resolve()),verifier_source_sha256=sha(Path(__file__).read_bytes()))
    dump(args.output,result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-report',required=True,type=Path)
    parser.add_argument('--equipment-link',required=True,type=Path)
    parser.add_argument('--libraries',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--detail-output',required=True,type=Path)
    args=parser.parse_args()
    require(__debug__,'Assertions must remain enabled')
    try:
        result=verify(args)
    except Exception as error:
        dump(args.output,dict(status='independent_verification_failed',error=str(error),verifier_source_sha256=sha(Path(__file__).read_bytes())))
        raise
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':
    main()
