"""Build a sparse, unapplied equipment-native plan; never write a Mach-O/IPA.

New addresses are simulated after all existing segments.  They are not mapped
or allocated by this tool.  Output consists of individual relocated functions,
local call veneers, one wrapper, guarded old-file patches, and JSON evidence.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import struct
import sys

import native_preload as preload


HELPERS = (101439, 101442, 101443)
FUNCTIONS = (18392, *HELPERS)
NOP = struct.pack('<I', 0xD503201F)


class PlanRejected(ValueError):
    def __init__(self, reason, **details):
        super().__init__(reason)
        self.details = details


def require(condition, reason, **details):
    if not condition:
        raise PlanRejected(reason, **details)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def number(value):
    return int(value, 0) if isinstance(value, str) else int(value)


def align(value, boundary):
    return (value + boundary - 1) & -boundary


def u32(raw, offset=0):
    return struct.unpack_from('<I', raw, offset)[0]


class NativeImage:
    """Immutable, bounded thin ARM64 Mach-O/AOT reader."""
    def __init__(self, raw, aot_info_offset):
        self.data, self.aot_info_offset = bytes(raw), aot_info_offset
        require(len(raw) >= 32 and u32(raw) == 0xFEEDFACF and u32(raw, 4) == 0x100000C,
                'Expected thin little-endian ARM64 Mach-O')
        self.segments = []
        at, end = 32, 32 + u32(raw, 20)
        require(end <= len(raw), 'Load commands exceed native file')
        for _ in range(u32(raw, 16)):
            cmd, size = struct.unpack_from('<II', raw, at)
            require(size >= 8 and at + size <= end, 'Invalid load command')
            if cmd == 0x19:
                require(size >= 72, 'Short LC_SEGMENT_64')
                vm, vs, off, fs, _max, prot, _ns, _flags = struct.unpack_from('<QQQQiiII', raw, at + 24)
                require(off + fs <= len(raw), 'Segment exceeds native file')
                self.segments.append(dict(name=raw[at+8:at+24].rstrip(b'\0').decode(),
                                          vm=vm, vs=vs, off=off, fs=fs, prot=prot))
            at += size
        require(at == end, 'Load command size mismatch')
        self.aot = self.aot_at(aot_info_offset)

    def offset(self, address, size=1):
        matches = [s for s in self.segments if s['fs'] and s['vm'] <= address
                   and address + size <= s['vm'] + s['fs']]
        require(len(matches) == 1, 'Address must be uniquely file backed', address=address, bytes=size)
        return matches[0]['off'] + address - matches[0]['vm']

    def read(self, address, size):
        at = self.offset(address, size)
        return self.data[at:at+size]

    def aot_at(self, offset):
        require(0 <= offset <= len(self.data) - 64, 'AOTInfo exceeds file')
        runtime, runtime_bytes = struct.unpack_from('<QQ', self.data, offset + 24)
        table, count = struct.unpack_from('<QQ', self.data, offset + 48)
        require(0 < count < 1000000, 'Invalid AOT method count')
        return dict(info_offset=offset, full_abc_sha1=self.data[offset:offset+20].hex(),
                    runtime_abc_va=runtime, runtime_abc_bytes=runtime_bytes,
                    method_table_va=table, method_table_offset=self.offset(table, count*8), method_count=count)

    def method(self, method_id):
        require(0 <= method_id < self.aot['method_count'], 'MethodInfo id outside AOT table')
        at = self.aot['method_table_offset'] + method_id*8
        va, = struct.unpack_from('<Q', self.data, at)
        return dict(method_id=method_id, slot_offset=at, va=va)


def adrp(rd, pc, target):
    require(0 <= rd < 31 and pc % 4 == 0, 'Invalid ADRP register or PC')
    delta = ((target & ~0xFFF) - (pc & ~0xFFF)) >> 12
    require(-(1 << 20) <= delta < (1 << 20), 'ADRP page target outside signed range', pc=pc, target=target)
    imm = delta & 0x1FFFFF
    return struct.pack('<I', 0x90000000 | ((imm & 3) << 29) | ((imm >> 2) << 5) | rd)


def adrp_target(word, pc):
    require(word & 0x9F000000 == 0x90000000, 'Expected ADRP')
    immediate = (((word >> 5) & 0x7FFFF) << 2) | ((word >> 29) & 3)
    if immediate & (1 << 20):
        immediate -= 1 << 21
    return (pc & ~0xFFF) + (immediate << 12)


def add_address(rd, rn, target):
    require(0 <= rd < 31 and 0 <= rn < 31, 'Invalid ADD register')
    return struct.pack('<I', 0x91000000 | ((target & 0xFFF) << 10) | (rn << 5) | rd)


def decode_address_pair(raw, pc):
    require(len(raw) == 8, 'Address pair must contain two words')
    first, second = struct.unpack('<II', raw)
    register = first & 31
    require(second & 0xFFC00000 == 0x91000000 and second & 31 == register
            and (second >> 5) & 31 == register, 'ADRP/ADD registers do not match')
    return adrp_target(first, pc) + ((second >> 10) & 0xFFF)


def call_veneer(pc, target):
    """IP0/x16 is call-scratch; no resolver/helper argument is replaced."""
    raw = adrp(16, pc, target) + add_address(16, 16, target) + struct.pack('<I', 0xD61F0200)
    require(decode_address_pair(raw[:8], pc) == target and u32(raw, 8) == 0xD61F0200,
            'Local veneer target decode mismatch')
    return raw


class FutureArena:
    def __init__(self, base):
        self.base, self.cursor, self.chunks, self.veneer_targets = base, base, [], {}

    def reserve(self, name, raw):
        address = align(self.cursor, 16)
        chunk = dict(name=name, va=address, code=bytes(raw))
        self.chunks.append(chunk)
        self.cursor = address + len(raw)
        return chunk

    def veneer(self, target):
        if target not in self.veneer_targets:
            address = align(self.cursor, 16)
            chunk = self.reserve(f'call-veneer-{target:x}', call_veneer(address, target))
            chunk['target'] = target
            self.veneer_targets[target] = chunk
        return self.veneer_targets[target]['va']


def relax_builtin_pair(raw, base, high_offset, low_offset, target):
    """Relax the verified type5/type6 GOT-load pair into direct ADRP/ADD."""
    code = bytearray(raw)
    require(high_offset % 4 == low_offset % 4 == 0 and 0 <= high_offset < low_offset <= len(raw)-4
            and low_offset-high_offset <= 16, 'Unsupported builtin relocation pair spacing')
    high, low = u32(code, high_offset), u32(code, low_offset)
    register = high & 31
    require(high & 0x9F000000 == 0x90000000, 'Builtin type5 is not ADRP')
    require(low & 0xFFC00000 == 0xF9400000 and low & 31 == register and (low >> 5) & 31 == register,
            'Builtin type6 must be matching 64-bit unsigned LDR Rd,[Rd]')
    require(((high >> 29) & 3) == 0 and ((high >> 5) & 0x7FFFF) == 0
            and ((low >> 10) & 0xFFF) == 0, 'Unreviewed builtin relocation addend')
    for offset in range(high_offset + 4, low_offset, 4):
        word = u32(code, offset)
        # The real pair contains STR x22,[sp,#0x28].  Such non-writeback SP
        # stores and NOP cannot destroy the ADRP destination or branch away.
        require(word == 0xD503201F or word & 0xFFC003E0 == 0xF90003E0,
                'Intervening builtin-pair instruction needs explicit review', offset=offset, word=hex(word))
    code[high_offset:high_offset+4] = adrp(register, base+high_offset, target)
    code[low_offset:low_offset+4] = add_address(register, register, target)
    require(adrp_target(u32(code, high_offset), base+high_offset)
            + ((u32(code, low_offset) >> 10) & 0xFFF) == target, 'Relaxed builtin target mismatch')
    return bytes(code)


def relocate_function(raw, address, relocations, runtime_addresses, arena, builtin_target=None):
    code = bytearray(raw)
    offsets = [r['offset'] for r in relocations]
    require(len(set(offsets)) == len(offsets), 'Duplicate relocation offset')
    for row in relocations:
        require(isinstance(row['offset'], int) and row['offset'] % 4 == 0
                and 0 <= row['offset'] <= len(code)-4 and row['external'] == 1
                and row['symbol'], 'Invalid, local or incomplete relocation', relocation=row)
        require(row['type'] in (2, 5, 6), 'Unsupported relocation type', relocation=row)
    pages = [r for r in relocations if r['type'] in (5, 6)]
    results = []
    if pages:
        require(len(pages) == 2 and {r['type'] for r in pages} == {5, 6}
                and {r['symbol'] for r in pages} == {'_builtin_aotInfo'} and builtin_target is not None,
                'Only the observed builtin GOT-load pair is supported')
        high, = [r for r in pages if r['type'] == 5]
        low, = [r for r in pages if r['type'] == 6]
        code = bytearray(relax_builtin_pair(code, address, high['offset'], low['offset'], builtin_target))
        for row in pages:
            off = row['offset']
            results.append(dict(row, pc=address+off, target=builtin_target, strategy='builtin_ADRP_ADD_relaxation',
                                before=raw[off:off+4].hex(), after=code[off:off+4].hex()))
    for row in relocations:
        if row['type'] != 2:
            continue
        off, symbol = row['offset'], row['symbol']
        require(u32(raw, off) == 0x94000000, 'External branch relocation must be an unrelocated BL without addend', relocation=row)
        require(symbol in runtime_addresses, 'Runtime symbol is unmapped', symbol=symbol)
        target, pc = runtime_addresses[symbol], address+off
        try:
            encoded = preload.branch(pc, target, link=True)
            via, strategy = target, 'direct_BL'
        except preload.ContractError:
            via, strategy = arena.veneer(target), 'BL_to_local_ADRP_ADD_BR_x16_veneer'
            encoded = preload.branch(pc, via, link=True)
        code[off:off+4] = encoded
        require(preload.branch_target(pc, encoded, link=True) == via, 'Relocated BL target decode mismatch')
        results.append(dict(row, pc=pc, target=target, encoded_target=via, strategy=strategy,
                            before=raw[off:off+4].hex(), after=encoded.hex()))
    require(len(results) == len(relocations), 'Not every object relocation was handled')
    for off in range(0, len(raw), 4):
        require(u32(raw, off) != 0x94000000 or off in offsets, 'Unrecorded unresolved BL remains', offset=off)
    return bytes(code), sorted(results, key=lambda r:r['offset'])


def scan_helper_interiors(image, ranges):
    """Conservative direct B/BL scan over every file-backed executable word.

    Branches originating inside the same preserved old function are internal
    control flow.  Every other source into its interior rejects an entry detour.
    Inline data is not silently promoted to proven executable code.
    """
    hits, internal, words, branches = [], 0, 0, 0
    for segment in image.segments:
        if not segment['prot'] & 4 or not segment['fs']:
            continue
        require(segment['vm'] % 4 == segment['off'] % 4 == segment['fs'] % 4 == 0,
                'Executable segment is not word-aligned')
        start, length = segment['off'], segment['fs']
        for index, (word,) in enumerate(struct.iter_unpack('<I', image.data[start:start+length])):
            words += 1
            if word & 0x7C000000 != 0x14000000:
                continue
            branches += 1
            pc = segment['vm'] + index*4
            immediate = word & 0x3FFFFFF
            if immediate & (1 << 25):
                immediate -= 1 << 26
            target = pc + (immediate << 2)
            for row in ranges:
                if row['start'] < target < row['end']:
                    if row['start'] <= pc < row['end']:
                        internal += 1
                    else:
                        hits.append(dict(source=pc, target=target, method_id=row['method_id'],
                                         source_segment=segment['name'], opcode='BL' if word & 0x80000000 else 'B'))
    table_hits = []
    for mid in range(image.aot['method_count']):
        va = image.method(mid)['va']
        for row in ranges:
            if row['start'] < va < row['end']:
                table_hits.append(dict(method_id=mid, target=va, helper=row['method_id']))
    return dict(executable_words_scanned=words, direct_branch_words=branches,
                same_function_internal_branches=internal, external_interior_targets=hits,
                aot_interior_targets=table_hits, pass_no_external_interior_targets=not hits and not table_hits,
                scope='B/BL instruction-word patterns and AOT pointers only; not global indirect reachability')


def json_read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def load_function(contract, directory):
    filename = contract['raw_function_file']
    path = directory / filename
    require(path.resolve().parent == directory.resolve(), 'Function bytes must be in their contract directory')
    raw = path.read_bytes()
    require(len(raw) == contract['raw_function_bytes'] and sha(raw) == contract['raw_function_sha256']
            and len(raw) % 4 == 0, 'Function byte identity mismatch')
    object_path = Path(contract['object_file'])
    require(sha(object_path.read_bytes()) == contract['object_sha256'], 'Compiler object identity mismatch')
    require(contract['function_source_end']-contract['function_source_start'] == len(raw), 'Object function extent mismatch')
    for row in contract['objectRelocs']:
        require(row['source_address']-contract['function_source_start'] == row['offset'], 'Object relocation source offset mismatch')
    preload.validate_frame_entry(raw)
    return raw


def patch_dict(patch):
    return dict(asdict(patch), before=patch.before.hex(), after=patch.after.hex())


def validate_thunk_contract(thunk):
    require(thunk['method_id'] == 18392 and thunk['owner'] == preload.RESOLVER_OWNER
            and tuple(thunk['parameters']) == preload.RESOLVER_PARAMETERS and thunk['return_type'] == 'void'
            and thunk['environment_register'] == 6 and thunk['input_method_metadata_unchanged']
            and thunk['input_activation_traits_unchanged'], 'Thunk MethodInfo/owner ABI mismatch')
    require(thunk.get('static_abi_review_passed') is True
            and thunk.get('receiver_representation') == 'typed_resolver_receiver'
            and thunk.get('environment_contract') == 'original_resolver_methodenv',
            'Thunk requires its actual reviewed typed receiver and original resolver MethodEnv contract')


def build_plan(args, md):
    import prepare_ios as prep
    native_raw = args.native.read_bytes()
    require(sha(native_raw) == args.native_sha256, 'Current native input hash changed')
    image = NativeImage(native_raw, args.aot_info_offset)
    full_raw, candidate_raw = args.current_full_abc.read_bytes(), args.candidate_abc.read_bytes()
    require(hashlib.sha1(full_raw).hexdigest() == image.aot['full_abc_sha1'], 'Current full ABC does not match native AOTInfo')
    full, candidate = prep.abcfmt.ABC(full_raw), prep.abcfmt.ABC(candidate_raw)
    require(len(full.methods) == len(candidate.methods) == image.aot['method_count'], 'ABC/AOT method counts differ')
    for field in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames','methods','metadata','instances','classes','scripts'):
        require(prep.p.freeze(getattr(full,field)) == prep.p.freeze(getattr(candidate,field)), 'Candidate changes frozen metadata', field=field)
    require(len(full.bodies) == len(candidate.bodies), 'Candidate changes body count')
    changed = [a[0] for a,b in zip(full.bodies,candidate.bodies) if prep.p.freeze(a) != prep.p.freeze(b)]
    require(changed == list(HELPERS), 'Candidate changes unexpected bodies', changed=changed)
    view = prep.view(candidate)
    resolver_label = preload.RESOLVER_OWNER + '/resolvePathCollection|1'
    require(prep.method_id_for_label(view,resolver_label) == 18392, 'Wrong resolver method identity')
    resolver = preload.capture_resolver(image, preload.MethodABI(18392,preload.RESOLVER_OWNER,preload.RESOLVER_PARAMETERS,'void'))
    thunk = json_read(args.thunk_contract)
    helpers_document = json_read(args.helpers_contract)
    helper_records = helpers_document['contracts']
    require(helpers_document['source_sha256'] == sha(candidate_raw), 'Helper compiler source differs from candidate')
    require([r['method_id'] for r in helper_records] == list(HELPERS), 'Expected exactly the three corrected helpers')
    validate_thunk_contract(thunk)
    records = {18392:thunk, **{r['method_id']:r for r in helper_records}}
    functions = {}
    candidate_sha1 = hashlib.sha1(candidate_raw).hexdigest()
    for mid,record in records.items():
        require(record['pool_abc_sha1'] == candidate_sha1, 'Compiled function uses a different candidate ABC', method=mid)
        symbol = record.get('symbol',record.get('object_symbol',''))
        require(f':{mid}:' in symbol, 'Compiled symbol does not identify its MethodInfo', method=mid)
        directory = args.thunk_contract.parent if mid==18392 else args.helpers_contract.parent
        functions[mid] = load_function(record,directory)
        if mid in HELPERS:
            info = candidate.methods[mid]
            require(record['owner']=='cn.mod::AuthorState' and record['static']
                    and record['parameters']==[candidate.mn_name(x) for x in info[1]]
                    and record['return_type']==candidate.mn_name(info[0]) and record['method_flags']==info[3]
                    and record['environment_register']==len(info[1])+1
                    and record.get('static_abi_review_passed') is True, 'Helper ABI review/metadata mismatch', method=mid)
            body, = [b for b in candidate.bodies if b[0]==mid]
            require(sha(body[5])==record['body_code_sha256'], 'Compiled helper body differs from candidate', method=mid)
    extent_document = json_read(args.old_extents)
    old_ranges = []
    for mid in HELPERS:
        evidence=extent_document['methods'][str(mid)]
        receipt=evidence['assembly']; old=image.method(mid)
        require(receipt['va']==old['va'] and receipt['complete_raw_byte_export']
                and evidence['current_bytes_equal_historical_function'], 'Old helper extent evidence differs from current entry', method=mid)
        raw=image.read(old['va'],receipt['size'])
        require(sha(raw)==receipt['sha256'], 'Old helper complete byte extent changed', method=mid)
        old_ranges.append(dict(method_id=mid,start=old['va'],end=old['va']+len(raw),sha256=sha(raw),bytes=len(raw),
                               source='current-byte-matched historical complete-function receipt'))
    scan=scan_helper_interiors(image,old_ranges)
    require(scan['pass_no_external_interior_targets'], 'Direct/AOT target enters an old helper interior; detour coverage is unproven',scan=scan)
    binding=json_read(args.builtin_evidence)
    require(binding['current_native_sha256']==sha(native_raw) and binding['builtin_symbol']=='_builtin_aotInfo', 'Builtin evidence input mismatch')
    builtin=number(binding['builtin_aot_info_va'])
    require(image.read(builtin,64).hex()==binding['builtin_aot_info_prefix_hex'], 'Builtin AOTInfo bytes changed')
    pair=binding['existing_builtin_materialization']
    require(len(pair)==2 and pair[1]['va']==pair[0]['va']+4, 'Builtin materialization pair is not adjacent')
    pair_raw=b''.join(bytes.fromhex(r['bytes']) for r in pair)
    require(image.read(pair[0]['va'],8)==pair_raw and decode_address_pair(pair_raw,pair[0]['va'])==builtin,
            'Actual old helper no longer materializes the builtin AOTInfo')
    require(image.aot_at(image.offset(builtin))['method_count']==binding['builtin_declaration_method_count'], 'Builtin AOTInfo method count changed')
    runtime_map=json_read(args.runtime_map)['symbols']
    needed=sorted({r['symbol'] for record in records.values() for r in record['objectRelocs'] if r['type']==2})
    runtime_addresses, runtime_bindings = {}, []
    for symbol in needed:
        require(symbol in runtime_map, 'Exact runtime-map symbol missing',symbol=symbol)
        entry=number(runtime_map[symbol]['address'])
        prefix=image.read(entry,32)
        segment=next(s for s in image.segments if s['vm']<=entry<s['vm']+s['fs'])
        require(segment['prot']&4 and entry%4==0, 'Runtime helper entry is not executable and aligned',symbol=symbol)
        runtime_addresses[symbol]=entry
        runtime_bindings.append(dict(symbol=symbol,entry_va=entry,file_offset=image.offset(entry,32),
                                     prefix_hex=prefix.hex(),prefix_sha256=sha(prefix),mapping_source_sha256=sha(args.runtime_map.read_bytes()),
                                     identity_limit='Exact hash-bound map key plus actual current entry bytes; stripped native symbols are not invented.'))
    base=align(max(s['vm']+s['vs'] for s in image.segments),0x4000)
    arena=FutureArena(base)
    chunks={mid:arena.reserve(f'method-{mid}',functions[mid]) for mid in FUNCTIONS}
    wrapper_chunk=arena.reserve('resolver-wrapper',b'\0'*52)
    relocations=[]
    for mid in FUNCTIONS:
        relocated, rows=relocate_function(functions[mid],chunks[mid]['va'],records[mid]['objectRelocs'],runtime_addresses,arena,builtin)
        chunks[mid]['code']=relocated
        relocations.extend(dict(row,method_id=mid) for row in rows)
    review=preload.BridgeReview(method_id=18392,owner=preload.RESOLVER_OWNER,entry_va=chunks[18392]['va'],
        parameters=preload.RESOLVER_PARAMETERS,return_type='void',environment_register=6,
        receiver_representation=thunk['receiver_representation'],environment_contract=thunk['environment_contract'],
        pool_abc_sha1=candidate_sha1,compiled_sha256=sha(chunks[18392]['code']),evidence_reference=str(args.thunk_contract))
    wrapper=preload.generate_wrapper(wrapper_va=wrapper_chunk['va'],bridge_entry_va=chunks[18392]['va'],
        continuation_va=resolver.entry_va,resolver=resolver,bridge_code=chunks[18392]['code'],bridge_review=review)
    wrapper_chunk['code']=wrapper.code
    patches=[wrapper.method_slot_patch]
    for mid in HELPERS:
        old=image.method(mid); address=chunks[mid]['va']
        patches.extend((preload.WordPatch(f'redirect corrected helper {mid} AOT slot',old['slot_offset'],struct.pack('<Q',old['va']),struct.pack('<Q',address)),
                        preload.WordPatch(f'detour exact old helper {mid} entry for direct callers',image.offset(old['va'],4),image.read(old['va'],4),preload.branch(old['va'],address))))
    patches.extend(preload.plan_login_factory_restore(image,factory_entry_va=args.login_factory_entry,
        bad_wrapper_va=args.bad_wrapper_entry,bad_bridge_entry_va=args.bad_bridge_entry))
    sorted_patches=sorted(patches,key=lambda p:p.file_offset)
    for a,b in zip(sorted_patches,sorted_patches[1:]):
        require(a.file_offset+len(a.before)<=b.file_offset,'Old-file patches overlap')
    for patch in patches:
        require(len(patch.before)==len(patch.after) and image.data[patch.file_offset:patch.file_offset+len(patch.before)]==patch.before,
                'Patch preimage does not match current native',purpose=patch.purpose)
    preserved=[]
    for name,address,size in (('five-in-one-old-wrapper',resolver.entry_va,args.old_wrapper_bytes),
                              ('retained-original-resolver',args.original_resolver_entry,args.original_resolver_bytes)):
        at=image.offset(address,size)
        require(all(p.file_offset+len(p.before)<=at or at+size<=p.file_offset for p in patches), 'Plan overlaps a preserved resolver range',name=name)
        preserved.append(dict(name=name,va=address,file_offset=at,bytes=size,sha256=sha(image.read(address,size))))
    require(preload.branch_target(resolver.entry_va+args.old_wrapper_original_call_offset,
            image.read(resolver.entry_va+args.old_wrapper_original_call_offset,4),link=True)==args.original_resolver_entry,
            'Preserved old wrapper no longer calls the preserved original resolver')
    require(u32(image.read(args.original_resolver_entry,4))&0x7C000000!=0x14000000,'Original resolver unexpectedly begins with a branch')
    decoded=[]
    for chunk in arena.chunks:
        rows=list(md.disasm(chunk['code'],chunk['va']))
        require(sum(len(r.bytes) for r in rows)==len(chunk['code']), 'Independent decoder does not cover a complete planned chunk',chunk=chunk['name'])
        decoded.extend(dict(chunk=chunk['name'],va=r.address,bytes=bytes(r.bytes).hex(),mnemonic=r.mnemonic,operands=r.op_str) for r in rows)
    for row in relocations:
        instruction, = [r for r in decoded if r['va']==row['pc']]
        if row['type']==2:
            require(instruction['mnemonic']=='bl' and number(instruction['operands'].lstrip('#'))==row['encoded_target'], 'Independent BL decode mismatch')
        else:
            require(instruction['mnemonic']==('adrp' if row['type']==5 else 'add'), 'Independent builtin relaxation decode mismatch')
    return dict(status='unapplied_relocated_plan_future_addresses_unallocated',native_input_sha256=sha(native_raw),
        current_full_abc_sha256=sha(full_raw),candidate_abc_sha256=sha(candidate_raw),candidate_abc_sha1=candidate_sha1,
        future_region=dict(base_va=base,end_va=arena.cursor,alignment=0x4000,allocated=False,mapped=False,segment_added=False),
        method_ids=list(FUNCTIONS),relocation_count=len(relocations),relocation_type_counts={str(k):sum(r['type']==k for r in relocations) for k in (2,5,6)},
        relocations=relocations,runtime_symbol_bindings=runtime_bindings,builtin_binding=dict(symbol='_builtin_aotInfo',target=builtin,evidence_sha256=sha(args.builtin_evidence.read_bytes())),
        helper_interior_scan=scan,old_helper_extents=old_ranges,patches=[patch_dict(p) for p in patches],preserved_native_ranges=preserved,
        independent_decode=decoded,local_call_veneer_count=len(arena.veneer_targets),
        required_later_work=['Allocate/map executable storage in a reviewed Mach-O linker; the simulated addresses currently have no segment.',
            'Integrate candidate full/runtime ABC and matching AOTInfo/SWF digests together; this sparse plan does not do so.',
            'Review load commands, LINKEDIT/rebase/bind, signing and ldid boundaries, LC_FUNCTION_STARTS and unwind metadata.',
            'Test actual GC, exceptions, game behavior and devices; static ABI/relocation evidence is bounded.'],
        limits=dict(native_written=False,ipa_built=False,all_indirect_callers_proven=False,gc_runtime_verified=False,
                    exception_unwind_verified=False,device_tested=False)),arena.chunks


def main():
    if not __debug__:
        raise RuntimeError('Run without -O; contract checks must remain enabled')
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('native','current-full-abc','candidate-abc','thunk-contract','helpers-contract','old-extents','builtin-evidence','runtime-map','output-dir','libraries'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--native-sha256',required=True)
    for name in ('aot-info-offset','login-factory-entry','bad-wrapper-entry','bad-bridge-entry','original-resolver-entry',
                 'original-resolver-bytes','old-wrapper-bytes','old-wrapper-original-call-offset'):
        parser.add_argument('--'+name,type=lambda x:int(x,0),required=True)
    args=parser.parse_args()
    require(not args.output_dir.exists(),'Use a new output directory; retained plans are never overwritten')
    sys.path.insert(0,str(args.libraries))
    import capstone
    md=capstone.Cs(capstone.CS_ARCH_ARM64,capstone.CS_MODE_LITTLE_ENDIAN)
    args.output_dir.mkdir(parents=True,exist_ok=False)
    bindings={name:dict(path=str(getattr(args,name)),sha256=sha(getattr(args,name).read_bytes()))
              for name in ('current_full_abc','candidate_abc','thunk_contract','helpers_contract','old_extents','builtin_evidence','runtime_map')}
    try:
        report,chunks=build_plan(args,md)
    except (PlanRejected,preload.ContractError) as exc:
        blocked=dict(status='plan_rejected_no_native_writes',reason=str(exc),details=getattr(exc,'details',{}),input_bindings=bindings)
        (args.output_dir/'blocked.json').write_text(json.dumps(blocked,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(dict(status=blocked['status'],reason=str(exc)),ensure_ascii=False))
        raise SystemExit(2)
    report['input_bindings']=bindings
    report['planner_source_sha256']=sha(Path(__file__).read_bytes())
    report['wrapper_generator_source_sha256']=sha(Path(preload.__file__).read_bytes())
    report['chunks']=[]
    for chunk in chunks:
        filename=chunk['name']+'.bin'
        (args.output_dir/filename).write_bytes(chunk['code'])
        report['chunks'].append(dict(name=chunk['name'],va=chunk['va'],bytes=len(chunk['code']),sha256=sha(chunk['code']),file=filename))
    (args.output_dir/'plan.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(status=report['status'],relocations=report['relocation_count'],chunks=len(chunks),
                         patches=len(report['patches']),call_veneers=report['local_call_veneer_count']),ensure_ascii=False))


if __name__=='__main__':
    main()
