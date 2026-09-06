"""V9 source guards for the private Kyubi PF's pre-consumption combo snapshot."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SOURCE = Path("D:/WF/out/newchars-pf-v10-20260906/v9-export/scripts")


class ComboPatchTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("kyubi_combo_patch", HERE / "patch.py")
        self.patch = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = self.patch
        spec.loader.exec_module(self.patch)
        if not SOURCE.is_dir():
            self.skipTest("exact V9 export fixture is unavailable")

    def source(self, name):
        return (SOURCE / self.patch.CLASS_PATHS[name]).read_text(encoding="utf-8")

    def test_unknown_source_and_partial_patch_fail_closed(self):
        for name in self.patch.CLASS_PATHS:
            old = self.source(name)
            with self.assertRaises(self.patch.PatchError):
                self.patch.patch_source(name, old + "// drift\n")
            new = self.patch.patch_source(name, old)
            with self.assertRaises(self.patch.PatchError):
                self.patch.patch_source(name, new.replace("kyubiPowerFlipInitialCombo", "broken", 1))

    def test_source_is_reversible_and_idempotent(self):
        for name in self.patch.CLASS_PATHS:
            old = self.source(name)
            new = self.patch.patch_source(name, old)
            self.assertNotEqual(old, new)
            self.assertEqual(self.patch.unpatch_source(name, new), old)
            self.assertEqual(self.patch.patch_source(name, new), new)

    def test_snapshot_is_unmasked_and_taken_before_combo_expiration(self):
        new = self.patch.patch_source("BallImpl", self.source("BallImpl"))
        snapshot = "kyubiPowerFlipInitialCombo = MaskGeneral.maskBit ^ _loc6_;"
        self.assertEqual(new.count(snapshot), 1)
        start = new.index("public function resolveCollisionForPrimaryOrSummons")
        body = new[start:]
        self.assertLess(body.index("_loc6_ = comboCalculator.getCombo();"), body.index(snapshot))
        self.assertLess(body.index(snapshot), body.index("comboCalculator.expire();"))
        self.assertLess(body.index("comboCalculator.expire();"), body.index("squad.startPowerFlipAction"))
        self.assertEqual(new.count("comboCalculator.expire();"), self.source("BallImpl").count("comboCalculator.expire();"))

    def test_only_exact_private_pf_reads_the_ball_snapshot(self):
        new = self.patch.patch_source("ActionEvaluationResolver", self.source("ActionEvaluationResolver"))
        self.assertIn('param5.kind.index == 5', new)
        self.assertIn('param5.kind.params[0] == "override_fox_oracle_autumn_dual_pf"', new)
        self.assertIn('param5.type.index == 2 && param5.type.params[0] is BallImpl', new)
        self.assertIn('initialCombo = (param5.type.params[0] as BallImpl).kyubiPowerFlipInitialCombo;', new)
        self.assertIn('initialCombo = MaskGeneral.maskBit ^ comboCalculator.getCombo();', new)
        self.assertNotIn('comboCalculator.addCombo', new)

    def test_constructor_pcode_is_exact_reversible_and_rejects_drift(self):
        sys.path.insert(0, str(HERE))
        import pcode
        path = SOURCE.parents[1] / "resolver-pcode/scripts" / self.patch.CLASS_PATHS[
            "ActionEvaluationResolver"].replace(".as", ".pcode")
        block = pcode.extract_constructor(path.read_text(encoding="utf-8"))
        new = pcode.patch_block(block)
        self.assertEqual(new.replace(pcode.inserted_code(), "", 1), block)
        self.assertEqual(pcode.patch_block(new), new)
        self.assertIn("maxstack 8", new)
        self.assertIn("localcount 16", new)
        with self.assertRaises(pcode.PatchError):
            pcode.patch_block(block.replace("maxstack 8", "maxstack 7"))
        with self.assertRaises(pcode.PatchError):
            pcode.patch_block(new.replace("pushbyte 5", "pushbyte 6", 1))

    def test_ball_pcode_refuses_unknown_edits(self):
        sys.path.insert(0, str(HERE))
        import pcode
        path = SOURCE.parents[1] / "ball-original.pcode"
        block = path.read_text(encoding="utf-8")
        new = pcode.patch_ball_block(block)
        self.assertEqual(pcode.patch_ball_block(new), new)
        with self.assertRaises(pcode.PatchError):
            pcode.patch_ball_block(new.replace('"maskBit"', '"wrongMask"', 1))

    def test_independent_verifier_accepts_minimal_binary_and_rejects_broad_recompile(self):
        sys.path.insert(0, str(HERE))
        import verify
        root = SOURCE.parents[1]
        report = verify.verify(root / "base-v9.swf", root / "v10-minimal.swf")
        self.assertEqual(report["changed_method_bodies"], [52311, 59953])
        broad = root / "v10-final.swf"
        if broad.exists():
            with self.assertRaises(verify.PatchError):
                verify.verify(root / "base-v9.swf", broad)

    def test_slot_writer_refuses_the_wrong_swf_base(self):
        sys.path.insert(0, str(HERE))
        import slot
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "unknown.swf"
            path.write_bytes(b"FWS wrong base")
            output = Path(temporary) / "out.swf"
            with self.assertRaises(slot.PatchError):
                slot.apply(path, output)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
