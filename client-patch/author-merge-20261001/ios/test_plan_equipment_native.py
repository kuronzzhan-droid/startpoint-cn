"""Planner encoding/bounds tests; no native or package execution."""
from __future__ import annotations

import struct
import unittest

import native_preload as p
import plan_equipment_native as n


def reloc(offset, symbol='runtime', kind=2):
    return dict(offset=offset,type=kind,external=1,symbol=symbol)


class ScanImage:
    def __init__(self, words, pointers=()):
        self.data=b''.join(words)
        self.segments=[dict(name='fixture_RX',vm=0x1000,off=0,fs=len(self.data),prot=5)]
        self.pointers=pointers
        self.aot=dict(method_count=len(pointers))

    def method(self, mid):
        return dict(va=self.pointers[mid])


class PlannerTests(unittest.TestCase):
    def test_thunk_requires_actual_reviewed_receiver_and_environment_contract(self):
        contract=dict(method_id=18392,owner=p.RESOLVER_OWNER,parameters=p.RESOLVER_PARAMETERS,
                      return_type='void',environment_register=6,input_method_metadata_unchanged=True,
                      input_activation_traits_unchanged=True,static_abi_review_passed=True,
                      receiver_representation='typed_resolver_receiver',environment_contract='original_resolver_methodenv')
        n.validate_thunk_contract(contract)
        for changes in (dict(static_abi_review_passed=False),dict(static_abi_review_passed=None),
                        dict(receiver_representation='class_closure'),dict(environment_contract='borrow_static_env'),
                        dict(environment_register=2)):
            with self.subTest(changes=changes),self.assertRaises(n.PlanRejected):
                n.validate_thunk_contract(dict(contract,**changes))

    def test_adrp_page_range_and_target_decode(self):
        for pc,target in ((0x10D000000,0x100A2671C),(0x100000000,0x1FFFFFABC),
                          (0x200000000,0x100000000),(0x100004000,0x100003FFF)):
            raw=n.adrp(16,pc,target)+n.add_address(16,16,target)
            self.assertEqual(n.decode_address_pair(raw,pc),target)
        for target in (0,0x300000000):
            with self.assertRaises(n.PlanRejected):
                n.adrp(16,0x180000000,target)

    def test_call_veneer_uses_only_ip0_and_br_preserves_call_lr(self):
        raw=n.call_veneer(0x10D000000,0x100A2671C)
        self.assertEqual(n.decode_address_pair(raw[:8],0x10D000000),0x100A2671C)
        self.assertEqual(n.u32(raw,8),0xD61F0200)  # BR x16, not BLR: keep original call LR.
        self.assertEqual(n.u32(raw)&31,16)
        self.assertEqual(n.u32(raw,4)&31,16)

    def test_in_range_branch_stays_direct(self):
        arena=n.FutureArena(0x100000000)
        code,rows=n.relocate_function(bytes.fromhex('00000094 c0035fd6'),0x100000000,
                                     [reloc(0)],{'runtime':0x100001000},arena)
        self.assertEqual(p.branch_target(0x100000000,code[:4],link=True),0x100001000)
        self.assertEqual(rows[0]['strategy'],'direct_BL')
        self.assertEqual(arena.chunks,[])

    def test_out_of_range_calls_share_verified_local_veneer(self):
        base,target=0x10D000000,0x100A2671C
        arena=n.FutureArena(base+0x1000)
        raw=bytes.fromhex('00000094 00000094 c0035fd6')
        code,rows=n.relocate_function(raw,base,[reloc(0),reloc(4)],{'runtime':target},arena)
        self.assertEqual(len(arena.chunks),1)
        self.assertEqual(len(arena.veneer_targets),1)
        for i,row in enumerate(rows):
            self.assertEqual(p.branch_target(base+i*4,code[i*4:i*4+4],link=True),arena.chunks[0]['va'])
            self.assertEqual(row['target'],target)
        self.assertEqual(n.decode_address_pair(arena.chunks[0]['code'][:8],arena.chunks[0]['va']),target)

    def test_unreachable_runtime_target_rejects_instead_of_truncating(self):
        with self.assertRaises(n.PlanRejected):
            n.relocate_function(bytes.fromhex('00000094'),0x100000000,[reloc(0)],
                                {'runtime':0x900000000},n.FutureArena(0x100001000))

    def test_actual_builtin_pair_shape_relaxes_load_to_address(self):
        raw=bytes.fromhex('15000090 f61700f9 b50240f9 c0035fd6')
        target,base=0x1063B7D00,0x10D000000
        fixed=n.relax_builtin_pair(raw,base,0,8,target)
        self.assertEqual(n.u32(fixed,8)&0xFFC00000,0x91000000)
        self.assertEqual(n.adrp_target(n.u32(fixed),base)+((n.u32(fixed,8)>>10)&0xFFF),target)
        self.assertEqual(fixed[4:8],raw[4:8])
        code,rows=n.relocate_function(raw,base,[reloc(0,'_builtin_aotInfo',5),reloc(8,'_builtin_aotInfo',6)],{},n.FutureArena(base+0x1000),target)
        self.assertEqual(code,fixed)
        self.assertEqual({r['type'] for r in rows},{5,6})

    def test_builtin_pair_requires_matching_registers_and_safe_intervening_instruction(self):
        good=bytes.fromhex('15000090 f61700f9 b50240f9 c0035fd6')
        for bad in (good[:8]+struct.pack('<I',0xF94002D5)+good[12:],
                    good[:4]+n.add_address(21,21,1)+good[8:],
                    struct.pack('<I',0x90000035)+good[4:]):
            with self.assertRaises(n.PlanRejected):
                n.relax_builtin_pair(bad,0x10D000000,0,8,0x1063B7D00)

    def test_incomplete_or_wrong_builtin_relocation_pair_rejected(self):
        raw=bytes.fromhex('15000090 f61700f9 b50240f9 c0035fd6')
        for rows in ([reloc(0,'_builtin_aotInfo',5)],
                     [reloc(0,'wrong',5),reloc(8,'wrong',6)]):
            with self.assertRaises(n.PlanRejected):
                n.relocate_function(raw,0x10D000000,rows,{},n.FutureArena(0x10D001000),0x1063B7D00)

    def test_missing_duplicate_local_unknown_and_addend_relocations_reject(self):
        raw=bytes.fromhex('00000094 c0035fd6')
        cases=([reloc(0,kind=3)], [reloc(0),reloc(0)], [dict(reloc(0),external=0)],
               [reloc(2)], [reloc(0,'missing')], [])
        for rows in cases:
            with self.subTest(rows=rows), self.assertRaises(n.PlanRejected):
                n.relocate_function(raw,0x10D000000,rows,{'runtime':0x100A2671C},n.FutureArena(0x10D001000))
        with self.assertRaises(n.PlanRejected):
            n.relocate_function(bytes.fromhex('01000094'),0x10D000000,[reloc(0)],{'runtime':0x100A2671C},n.FutureArena(0x10D001000))

    def test_external_direct_target_into_old_helper_interior_blocks_detour(self):
        words=[p.branch(0x1000,0x1014)]+[n.NOP]*7
        image=ScanImage(words)
        scan=n.scan_helper_interiors(image,[dict(method_id=1,start=0x1010,end=0x1020)])
        self.assertFalse(scan['pass_no_external_interior_targets'])
        self.assertEqual(scan['external_interior_targets'][0]['target'],0x1014)

    def test_old_function_internal_control_flow_is_classified_separately(self):
        words=[n.NOP]*4+[p.branch(0x1010,0x1014)]+[n.NOP]*3
        scan=n.scan_helper_interiors(ScanImage(words,[0x1010]),[dict(method_id=1,start=0x1010,end=0x1020)])
        self.assertTrue(scan['pass_no_external_interior_targets'])
        self.assertEqual(scan['same_function_internal_branches'],1)

    def test_aot_pointer_into_old_helper_interior_blocks_detour(self):
        scan=n.scan_helper_interiors(ScanImage([n.NOP]*8,[0x1014]),[dict(method_id=1,start=0x1010,end=0x1020)])
        self.assertFalse(scan['pass_no_external_interior_targets'])
        self.assertEqual(scan['aot_interior_targets'][0]['target'],0x1014)

    def test_future_arena_alignment_and_nonoverlap(self):
        arena=n.FutureArena(0x10D000000)
        a=arena.reserve('a',b'x'*17);b=arena.reserve('b',b'y'*11)
        self.assertEqual(a['va']%16,0);self.assertEqual(b['va']%16,0)
        self.assertGreaterEqual(b['va'],a['va']+len(a['code']))


if __name__=='__main__':
    unittest.main(verbosity=2)
