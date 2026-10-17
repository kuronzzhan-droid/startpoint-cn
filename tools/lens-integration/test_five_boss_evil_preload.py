"""Regression gates for the native evil-summon element mismatch."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile
import zlib

import five_boss_evil_preload as fix


class EvilPreloadRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.native = json.loads((Path(__file__).parent / "test-fixtures/five-boss-evil-native-dsl.json").read_text("utf-8"))
        repo = Path(__file__).resolve().parents[2]
        cls.manifest = json.loads((repo / "assets/asset-patch/manifest.json").read_bytes())
        cls.payloads = fix.read_archive(repo / "assets/asset-patch/active" / fix.ARCHIVE)
        cls.after = cls.payloads[fix.GB]
        chunks = fix.raw_rows(cls.after)
        for key in fix.KEYS:
            tiers = fix.raw_rows(chunks[key])
            cells = fix.row(zlib.decompress(tiers["100"]).decode("utf-8"))
            cells[149] = ""
            tiers["100"] = zlib.compress(fix.csv_text(cells).encode("utf-8"), 9)
            chunks[key] = fix.pack_rows(tiers)
        cls.before = fix.pack_rows(chunks)

    def test_real_native_current_element_requires_a_fixed_green_shim(self):
        native_effect = [n for n in fix.walk(self.native) if isinstance(n, list) and n[:2] == ["ResolveByElement", fix.CANNON]]
        self.assertEqual(native_effect[0][2], 255)
        shim, edits = fix.make_shim(self.native)
        decoded = fix.decode(shim)
        fixed = [n for n in fix.walk(decoded) if isinstance(n, list) and n[:2] == ["ResolveByElement", fix.CANNON]]
        self.assertEqual(fixed[0][2], 4)
        self.assertEqual(len(edits), 2)
        self.assertEqual(shim, self.payloads[fix.SHIM + ".action.dsl.amf3.deflate"])

    def test_valid_dark_shim_is_rejected_despite_passing_dsl_signature(self):
        wrong = fix.decode(self.payloads[fix.SHIM + ".action.dsl.amf3.deflate"])
        for n in fix.walk(wrong):
            if isinstance(n, list) and n[:2] == ["ResolveByElement", fix.CANNON]:
                n[2] = 6
        fix.wf_dsl_sig.validate_action_dsl(wrong)
        with self.assertRaisesRegex(ValueError, "permitted native operand edits"):
            fix.validate_shim(self.native, fix.encode(wrong))

    def test_executable_action39_marker_is_rejected(self):
        class ExecutableSlot:
            def read(self, _logical):
                return fix.encode({"points": [{"path": "enemy_action39", "frames": []}]})
        with self.assertRaisesRegex(ValueError, "executable from a marker"):
            fix.check_free_slot(ExecutableSlot(), fix.q.parse_node(self.before))

    def test_verify_replays_the_135_prefix_without_dropping_disabled_entries(self):
        prefix = fix.baseline_manifest_prefix(self.manifest, allow_target_edge=True)
        self.assertEqual(prefix["cdn_version"], fix.BASE)
        self.assertEqual(prefix["patches"], self.manifest["patches"][:-1])
        self.assertEqual(prefix, fix.baseline_manifest_prefix(prefix))
        with self.assertRaisesRegex(ValueError, "tail changed"):
            fix.baseline_manifest_prefix(self.manifest)

    def test_verify_rejects_an_edge_with_the_wrong_baseline(self):
        wrong = copy.deepcopy(self.manifest)
        wrong["patches"][-1]["depends_on"] = "1.4.134"
        with self.assertRaisesRegex(ValueError, "final enabled manifest entry"):
            fix.baseline_manifest_prefix(wrong, allow_target_edge=True)

    def test_native_element_drift_is_not_silently_copied(self):
        malformed = copy.deepcopy(self.native)
        for n in fix.walk(malformed):
            if isinstance(n, list) and n[:2] == ["ResolveByElement", fix.CANNON]:
                n[2] = 6
        with self.assertRaisesRegex(ValueError, "no longer uses current element"):
            fix.make_shim(malformed)

    def test_native_malformed_callback_option_is_rejected(self):
        malformed = copy.deepcopy(self.native)
        for n in fix.walk(malformed):
            if isinstance(n, list) and n and n[0] == "ShowEffect":
                n[12] = ["Some", 9]
        with self.assertRaises(fix.wf_dsl_sig.DslSignatureError):
            fix.make_shim(malformed)

    def test_target_enemy_attribute_change_is_rejected(self):
        chunks = fix.raw_rows(self.after)
        tiers = fix.raw_rows(chunks[fix.KEYS[2]])
        cells = fix.row(zlib.decompress(tiers["100"]).decode("utf-8"))
        cells[0] = "4"
        tiers["100"] = zlib.compress(fix.csv_text(cells).encode("utf-8"), 9)
        chunks[fix.KEYS[2]] = fix.pack_rows(tiers)
        with self.assertRaisesRegex(ValueError, "unauthorized CSV"):
            fix.validate_table(self.before, fix.pack_rows(chunks))

    def test_unrelated_row_loss_is_rejected(self):
        chunks = fix.raw_rows(self.after)
        unrelated = next(k for k in chunks if k not in fix.KEYS)
        del chunks[unrelated]
        with self.assertRaisesRegex(ValueError, "outer key drift"):
            fix.validate_table(self.before, fix.pack_rows(chunks))

    def test_archive_with_extra_member_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get("FIVE_BOSS_TEST_WORK")) as directory:
            path = Path(directory) / "unexpected.zip"
            path.write_bytes(fix.zip_bytes(self.payloads))
            with zipfile.ZipFile(path, "a") as z:
                z.writestr("production/upload/unexpected", b"extra")
            with self.assertRaisesRegex(ValueError, "whitelist"):
                fix.read_archive(path)


if __name__ == "__main__":
    unittest.main()
