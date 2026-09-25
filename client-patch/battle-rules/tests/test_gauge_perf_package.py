"""单独交付入口的兼容性、拒绝覆盖与输入保留检查。"""
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apply_gauge_perf import prepare, SWF_MEMBER

BASE = Path('D:/WF/out/夏勇希与杰拉尔调整-20260924/voice-pools-ui.swf')


class GaugePackageTest(unittest.TestCase):
    def test_unknown_baseline_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root/'foreign.swf'
            source.write_bytes(b'foreign client modifications')
            with self.assertRaisesRegex(ValueError, 'Unknown SWF baseline'):
                prepare(source, root/'output')
            self.assertFalse((root/'output').exists())
            self.assertEqual(source.read_bytes(), b'foreign client modifications')

    def test_duplicate_apk_entries_are_rejected(self):
        import warnings
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)/'ambiguous.apk'
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(source, 'w') as archive:
                    archive.writestr(SWF_MEMBER, b'one')
                    archive.writestr(SWF_MEMBER, b'two')
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                prepare(source, check_only=True)

    @unittest.skipUnless(BASE.is_file(), 'local baseline fixture unavailable')
    def test_exact_upgrade_idempotence_and_container_only_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root/'receiver.apk'
            with zipfile.ZipFile(source, 'w') as archive:
                archive.write(BASE, SWF_MEMBER)
                archive.writestr('assets/receiver.txt', b'receiver-specific resource')
            before = source.read_bytes()
            self.assertEqual(prepare(source, check_only=True)['status'], 'ready')
            result = prepare(source, root/'output')
            self.assertEqual(result['status'], 'prepared')
            self.assertEqual(len(result['changed_methods']), 2)
            self.assertEqual(source.read_bytes(), before)
            with self.assertRaises(FileExistsError):
                prepare(source, root/'output')
            again = root/'unused'
            self.assertEqual(prepare(result['output_swf'], again)['status'], 'already_patched')
            self.assertFalse(again.exists())


if __name__ == '__main__':
    unittest.main()
