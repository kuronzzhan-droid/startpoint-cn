"""Check that repair entry points preserve existing inputs and output receipts."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import prepare_ios
import repair_current


class RepairBoundaries(unittest.TestCase):
    def test_legacy_main_fails_before_preparation(self):
        with patch.object(prepare_ios, 'prepare_historical_input_unlinked') as old:
            with self.assertRaisesRegex(RuntimeError, 'Legacy.*disabled'):
                prepare_ios.main()
            old.assert_not_called()

    def test_historical_api_preserves_existing_output_before_reading_inputs(self):
        with tempfile.TemporaryDirectory(prefix='historical-equipment-boundary-') as folder:
            root = Path(folder)
            output = root / 'retained'
            output.mkdir()
            sentinel = output / 'keep.txt'
            sentinel.write_bytes(b'preserve-history')
            with self.assertRaises(FileExistsError):
                prepare_ios.prepare_historical_input_unlinked(
                    source_ipa=root / 'missing.ipa', source_full_abc=root / 'missing.abc',
                    donor_swf=root / 'missing.swf', output_dir=output)
            self.assertEqual(sentinel.read_bytes(), b'preserve-history')

    def run_retained_output(self, retained_name):
        with tempfile.TemporaryDirectory(prefix='equipment-boundary-') as folder:
            root = Path(folder)
            full, donor, out = root / 'input.abc', root / 'donor.swf', root / 'out'
            full.write_bytes(b'input'); donor.write_bytes(b'donor'); out.mkdir()
            retained = out / retained_name
            retained.write_bytes(b'keep-this-exactly')
            sha = lambda data: hashlib.sha256(data).hexdigest()
            argv = ['repair_current.py', '--full-abc', str(full), '--input-sha256', sha(b'input'),
                    '--donor-swf', str(donor), '--donor-sha256', sha(b'donor'), '--output-dir', str(out)]
            with (patch.object(sys, 'argv', argv),
                  patch.object(prepare_ios, 'DONOR_SWF_SHA256', sha(b'donor')),
                  patch.object(repair_current, 'regenerate') as generate):
                with self.assertRaises(FileExistsError):
                    repair_current.main()
                generate.assert_not_called()
            self.assertEqual(retained.read_bytes(), b'keep-this-exactly')
            self.assertEqual(full.read_bytes(), b'input')
            self.assertEqual(donor.read_bytes(), b'donor')

    def test_existing_candidate_preserved(self):
        self.run_retained_output('equipment-fixed-full.abc')

    def test_existing_report_without_candidate_preserved(self):
        self.run_retained_output('generation.json')

    def test_nonempty_resolve_exceptions_rejected_before_mutation(self):
        body = [1, 1, 1, 0, 1, b'', [(0, 1, 0, 0, 0)], []]
        with self.assertRaisesRegex(AssertionError, 'exception handlers'):
            prepare_ios.transform_resolve_helper(body, None)
        self.assertEqual(body[6], [(0, 1, 0, 0, 0)])


if __name__ == '__main__':
    unittest.main(verbosity=2)
