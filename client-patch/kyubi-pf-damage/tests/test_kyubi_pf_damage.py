"""Fail-closed source patch tests; optional fixture is exported from the exact V8 APK."""
import hashlib
import importlib.util
import os
from pathlib import Path
import unittest

PATCH_PATH = Path(__file__).parents[1] / "patch.py"
DEFAULT_FIXTURE = Path(
    "D:/WF/startpoint-cn/work/codex_out/newchars-revision-20260906/"
    "pf-agent-package/client-source/v8/scripts"
)


def load_patch():
    if not PATCH_PATH.is_file():
        return None
    spec = importlib.util.spec_from_file_location("kyubi_pf_patch", PATCH_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PatchContractTests(unittest.TestCase):
    def setUp(self):
        self.patch = load_patch()

    def test_patcher_exists(self):
        self.assertIsNotNone(self.patch, "the guarded V8 source patcher is not implemented")

    def test_unrecognized_source_is_rejected(self):
        if self.patch is None:
            self.skipTest("implementation missing")
        with self.assertRaises(self.patch.PatchError):
            self.patch.patch_source("ActionEvaluator", "package foreign {}")


class RealV8Tests(unittest.TestCase):
    def setUp(self):
        self.patch = load_patch()
        self.fixture = Path(os.environ.get("KYUBI_PF_V8_SOURCE", DEFAULT_FIXTURE))
        if self.patch is None or not self.fixture.is_dir():
            self.skipTest("set KYUBI_PF_V8_SOURCE to the exact V8 exported scripts directory")

    def source(self, name):
        return (self.fixture / self.patch.CLASS_PATHS[name]).read_text(encoding="utf-8-sig")

    def test_v8_fixture_identity(self):
        for name, expected in self.patch.V8_SHA256.items():
            self.assertEqual(hashlib.sha256(self.source(name).encode()).hexdigest(), expected)

    def test_only_allowed_edits_and_idempotence(self):
        for name in self.patch.CLASS_PATHS:
            source = self.source(name)
            patched = self.patch.patch_source(name, source)
            self.assertNotEqual(source, patched)
            self.assertEqual(self.patch.unpatch_source(name, patched), source)
            self.assertEqual(self.patch.patch_source(name, patched), patched)
            with self.assertRaises(self.patch.PatchError):
                self.patch.patch_source(name, patched.replace("kyubi", "tampered", 1))

    def test_main_and_unison_programs_are_checked_separately(self):
        out = self.patch.patch_source("SquadManagerImpl", self.source("SquadManagerImpl"))
        self.assertIn('_loc3_.selfActionSkill.values.program_path == "' + self.patch.MAIN_1 + '"', out)
        self.assertIn('_loc30_.values.program_path == "' + self.patch.MAIN_2 + '"', out)
        self.assertNotIn("unicorn_lancer_rose", out)
        self.assertNotIn('mainCharacterStringId == "fox_oracle_autumn"', out)

    def test_only_normal_attack_impact_flags_are_reclassified(self):
        before = self.source("ActionEvaluator")
        out = self.patch.patch_source("ActionEvaluator", before)
        self.assertIn("_loc63_ = true;", out)
        self.assertIn("_loc4_ = false;", out)
        self.assertIn("_loc5_ = false;", out)
        self.assertIn("_loc24_ < 1 || _loc24_ > 3", out)
        self.assertIn("_loc24_ = 1;", out)
        # Fixed/ratio/only-hit code must not become PF as a side effect.
        self.assertEqual(before[before.index("            case 16:", before.index("public function evalCommand")):],
                         out[out.index("            case 16:", out.index("public function evalCommand")):])

    def test_ability_paths_and_charge_snapshot_are_precise(self):
        out = self.patch.patch_source("MemberImpl", self.source("MemberImpl"))
        self.assertIn('param3.params[1] == "' + self.patch.SPECIAL + '"', out)
        self.assertNotIn("ability_skill_fox_oracle_autumn_pf_pursuit", out)
        self.assertIn("kyubiLastPowerFlipChargeLv = param2;", out)
        self.assertIn('"kyubiPfChargeLv":kyubiGetPowerFlipChargeLv()', out)
        self.assertIn("_loc1_.params[0].kyubiLastPowerFlipChargeLv", out)

    def test_unknown_v8_change_is_rejected_before_patching(self):
        source = self.source("ActionEvaluator").replace('"createdByDirectAttack":false',
                                                           '"createdByDirectAttack":true', 1)
        with self.assertRaises(self.patch.PatchError):
            self.patch.patch_source("ActionEvaluator", source)

    def test_ability2_retains_unison_and_exact_identity(self):
        out = self.patch.patch_source("MemberImpl", self.source("MemberImpl"))
        self.assertIn("kyubiIsPfAbilityDamage", out)
        self.assertIn("_loc3_.source.origin == 2000", out)
        self.assertIn("_loc3_.source.origin == 1002000", out)
        self.assertIn("_loc4_.params[0] == 1399952", out)
        self.assertIn("_loc3_.address === param1", out)

    def test_ability_damage_shot_changes_only_kyubi_marked_shots(self):
        self.assertIn("AbilityDamageShot", self.patch.CLASS_PATHS)
        out = self.patch.patch_source("AbilityDamageShot", self.source("AbilityDamageShot"))
        self.assertIn('"createdByPowerFlipAction":kyubiPfDamage', out)
        self.assertIn('"createdByAbility":!kyubiPfDamage', out)
        self.assertIn('"createdByUnisonAbility":!kyubiPfDamage && _loc10_', out)
        self.assertIn('"incrementCombo":!kyubiPfDamage && _loc23_', out)
        self.assertIn("kyubiPfChargeLv = (param4 as MemberImpl).kyubiGetPowerFlipChargeLv()", out)


if __name__ == "__main__":
    unittest.main()
