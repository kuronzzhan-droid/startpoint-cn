"""Fault-injection tests for cumulative source selection and native readback."""
import argparse
import copy
from pathlib import Path
import struct
from types import SimpleNamespace
import unittest

import verify_cumulative as cumulative


class MemoryImage:
    def __init__(self, blocks):
        self.blocks = blocks

    def read(self, at, size):
        for base, raw in self.blocks.items():
            if base <= at and at + size <= base + len(raw):
                return raw[at - base:at - base + size]
        raise ValueError('Read outside fixture')


class CumulativeContracts(unittest.TestCase):
    def references(self):
        ids = list(range(100, 228)) + [52124] + list(range(101496, 101598))
        return [('operations', {'functions': [{'method': x} for x in ids]}),
                ('profile', {'functions': []}), ('town', {'functions': [{'method': 52124}]})]

    def test_last_52124_wins_and_all_helpers_retained(self):
        selected = cumulative.select_functions(self.references())
        self.assertEqual(selected[52124]['stage'], 'town')
        self.assertEqual(len(selected), 231)

    def test_unknown_overlap_rejected(self):
        rows = self.references()
        rows[-1][1]['functions'].append({'method': 100})
        with self.assertRaisesRegex(ValueError, 'overlap'):
            cumulative.select_functions(rows)

    def test_missing_helper_rejected(self):
        rows = self.references()
        rows[0][1]['functions'].pop()
        with self.assertRaisesRegex(ValueError, 'target set'):
            cumulative.select_functions(rows)

    def test_stubs_and_obsolete_metadata_hidden(self):
        obj = SimpleNamespace(defined={'_x:52124:ResponseData': {}, '_x:100:Target': {},
                                       '_x:200:Unselected': {}, '_x_284_aotInfo': {}, 'lCPI1_0': {}})
        selected = {52124: {'stage': 'town'}, 100: {'stage': 'operations'}}
        visible = cumulative.visible_definitions(obj, 'operations', selected)
        self.assertEqual(set(visible), {'_x:100:Target', 'lCPI1_0'})
        self.assertIn('_x_284_aotInfo', cumulative.visible_definitions(obj, 'town', selected))

    def test_activation_relocation_and_preserved_globals(self):
        before = struct.pack('<4Q', 7, 0x1000, 9, 0x5000)
        after = struct.pack('<4Q', 7, 0x2000, 9, 0x5000)
        self.assertEqual(cumulative.compare_activation(before, after, {0x1000: 3}, {3: 0x2000}), 1)
        with self.assertRaisesRegex(ValueError, 'initializer'):
            cumulative.compare_activation(before, struct.pack('<4Q', 7, 0x2000, 9, 0x6000), {0x1000: 3}, {3: 0x2000})
        with self.assertRaisesRegex(ValueError, 'descriptor'):
            cumulative.compare_activation(before, struct.pack('<4Q', 8, 0x2000, 9, 0x5000), {0x1000: 3}, {3: 0x2000})

    def test_real_branch_decode_rejects_false_report(self):
        image = MemoryImage({0x1000: struct.pack('<I', 0x14000004)})
        row = dict(offset=0, type=2, pc=0x1000, target=0x1010, branch_target=0x1010)
        cumulative.check_relocation(image, row, 0x1000, 0x14000000)
        row['branch_target'] = 0x1020
        with self.assertRaisesRegex(ValueError, 'target'):
            cumulative.check_relocation(image, row, 0x1000, 0x14000000)

    def test_entry_follow_is_bounded_and_preserves_call_opcode(self):
        image = MemoryImage({0x1000: struct.pack('<I', 0x14000004), 0x1010: struct.pack('<I', 0x14000004)})
        self.assertTrue(cumulative.follow_to(image, 0x1000, 0x1020))
        cycle = MemoryImage({0x1000: struct.pack('<I', 0x14000000)})
        self.assertFalse(cumulative.follow_to(cycle, 0x1000, 0x1020))
        call = MemoryImage({0x1000: struct.pack('<I', 0x94000004)})
        self.assertFalse(cumulative.follow_to(call, 0x1000, 0x1010))

    def test_runtime_cinit_max_stack_and_every_body_field_checked(self):
        # Actual retained 101586 shape; town compiler-only metadata used stack=1.
        body = [101586, 0, 1, 0, 0, b'', [], []]
        cumulative.require_runtime_body(body, copy.deepcopy(body), 101586, lambda x: x)
        mutations = {0: 101587, 1: 1, 2: 2, 3: 1, 4: 1,
                     5: b'\x47', 6: [(0, 1, 2, 3, 4)], 7: ['unexpected activation']}
        for field, value in mutations.items():
            with self.subTest(field=field):
                changed = copy.deepcopy(body); changed[field] = value
                with self.assertRaisesRegex(ValueError, 'Runtime body.*101586'):
                    cumulative.require_runtime_body(body, changed, 101586, lambda x: x)

    def test_non_relocation_corruption_and_stale_response_data_rejected(self):
        expected = bytes.fromhex('0000009400000091c0035fd6')
        relocated = bytes.fromhex('0100009400000091c0035fd6')
        cumulative.require_unrelocated_bytes(expected, relocated, set(range(4)), 52124)
        for mid in (100, 52124):
            wrong = bytearray(relocated); wrong[5] ^= 1
            with self.subTest(method=mid):
                with self.assertRaisesRegex(ValueError, 'Non-relocation native bytes.*' + str(mid)):
                    cumulative.require_unrelocated_bytes(expected, wrong, set(range(4)), mid)
        with self.assertRaisesRegex(ValueError, 'extent'):
            cumulative.require_unrelocated_bytes(expected, relocated[:-1], set(range(4)), 52124)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-root', type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(CumulativeContracts))
    if not result.wasSuccessful():
        raise SystemExit(1)
    if args.reference_root:
        _, selected, objects, stages, _ = cumulative.load_references(args.reference_root)
        view = cumulative.make_object_view(objects, stages, selected)
        actual = {}
        for key, obj in objects.items():
            current = view(key, cumulative.sha(obj.raw))
            for name in current.defined:
                mid = cumulative.method_id(name)
                if mid is not None:
                    if mid in actual:
                        raise ValueError('Duplicate actual source definition')
                    actual[mid] = key
        cumulative.require(set(actual) == selected.keys(), 'Actual source view incomplete')
        cumulative.require(all(actual[mid] == row['object_path'] for mid, row in selected.items()), 'Actual source ownership drift')
        print('Original source view verified:', len(actual), 'functions in', len(objects), 'unchanged objects')


if __name__ == '__main__':
    main()
