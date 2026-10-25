"""Exercise real-carrier allocator guards and fail-closed packaging boundaries."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

import package_stage
from verify_equipment import Image


class StageBoundaries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.native = INPUT_NATIVE.read_bytes()
        if hashlib.sha256(cls.native).hexdigest() != '2a1e088c1a49e8b9b6215df9ecfaa6ebf5e076a4cad38204f9c4eba758ba25c2':
            raise RuntimeError('The verified equipment carrier has changed')

    def test_extend_retains_old_segment_addresses_and_complete_linkedit_bytes(self):
        before = Image(self.native)
        result, region, _ = linker.extend_last_rx(self.native, 1024)
        after = Image(result)
        self.assertEqual(len(before.segments), len(after.segments))
        for old, new in zip(before.segments[:-2], after.segments[:-2]):
            self.assertEqual(old, new)
        old_tail, new_tail = before.segments[-1], after.segments[-1]
        self.assertEqual(result[new_tail['off']:], self.native[old_tail['off']:])
        self.assertEqual(new_tail['off'] - old_tail['off'], 0x4000)
        self.assertEqual(new_tail['vm'] - old_tail['vm'], 0x4000)
        self.assertEqual(region['vm'], old_tail['vm'])

    def test_non_executable_last_payload_rejected(self):
        damaged = bytearray(self.native)
        segment = linker.original.link.segments(damaged)[-2]
        struct.pack_into('<ii', damaged, segment['command'] + 56, 3, 3)
        with self.assertRaisesRegex(ValueError, 'not RX'):
            linker.extend_last_rx(damaged, 1024)

    def test_zero_fill_tail_rejected(self):
        damaged = bytearray(self.native)
        segment = linker.original.link.segments(damaged)[-2]
        struct.pack_into('<Q', damaged, segment['command'] + 48, segment['fs'] - 16)
        with self.assertRaises(ValueError):
            linker.extend_last_rx(damaged, 1024)

    def run_package_guard(self, report, retained=None):
        with tempfile.TemporaryDirectory(prefix='ios-stage-boundary-') as folder:
            root = Path(folder); linked = root / 'link.json'; output = root / 'candidate.ipa'
            linked.write_text(json.dumps(report), encoding='utf-8')
            target = output if retained == 'ipa' else output.with_suffix('.json')
            if retained:
                target.write_bytes(b'preserve-exactly')
            with patch.object(sys, 'argv', ['package_stage.py','--linked',str(linked),'--output',str(output)]):
                with self.assertRaises((ValueError, FileExistsError)):
                    package_stage.main()
            if retained:
                self.assertEqual(target.read_bytes(), b'preserve-exactly')
            else:
                self.assertFalse(output.exists())

    def test_pending_report_never_packages(self):
        self.run_package_guard({'status':'linked_pending_unwind_finalization','unwind_finalized':False})
        self.run_package_guard({'status':'linked_native_not_executed','unwind_finalized':False})
        self.run_package_guard({'status':'linked_native_not_executed'})

    def test_existing_ipa_preserved(self):
        self.run_package_guard({'status':'linked_native_not_executed','unwind_finalized':True}, 'ipa')

    def test_existing_receipt_preserved(self):
        self.run_package_guard({'status':'linked_native_not_executed','unwind_finalized':True}, 'receipt')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--libraries', required=True, type=Path)
    parser.add_argument('--equipment-native', required=True, type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(args.libraries))
    import link_stage as linker
    INPUT_NATIVE = args.equipment_native
    unittest.main(argv=[sys.argv[0]], verbosity=2)
