"""Offline Kyubi revision must preserve unrelated rows, Fever time and ability 4-6."""
from __future__ import annotations

import importlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).parents[1]))
import wf_dsl
import wf_mod_tool as core

SOURCE = Path("D:/WF/startpoint-cn/work/character_packs/fox_oracle_autumn/package")


class KyubiRevisionTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.find_spec("wf_kyubi_pf_revision")
        self.assertIsNotNone(spec, "the isolated package revision is not implemented")
        self.mod = importlib.import_module("wf_kyubi_pf_revision")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.package = Path(self.temp.name) / "codex_out" / "kyubi" / "package"
        if not SOURCE.is_dir():
            self.skipTest("original character package fixture is unavailable")
        self.package.mkdir(parents=True)
        shutil.copyfile(SOURCE / "manifest.json", self.package / "manifest.json")
        for root, logical in self.mod.INPUTS:
            target = self.package / "roots" / root / logical
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / "roots" / root / logical, target)

    def test_dry_run_writes_nothing_and_original_path_is_refused(self):
        before = {p: p.read_bytes() for p in self.package.rglob("*") if p.is_file()}
        report = self.mod.revise(self.package, dry_run=True)
        self.assertGreater(len(report["changed"]), 5)
        self.assertEqual(before, {p: p.read_bytes() for p in self.package.rglob("*") if p.is_file()})
        with self.assertRaises(ValueError):
            self.mod.revise(SOURCE, dry_run=True)

    def test_no_foreign_rows_fever_or_456_change(self):
        path = self.package / "roots/common/master/ability/ability.orderedmap"
        before = core.read_orderedmap_file(path, "ability").text_rows()
        self.mod.revise(self.package, dry_run=False)
        after = core.read_orderedmap_file(path, "ability").text_rows()
        self.assertEqual(before, after)
        row = core.read_csv_lines(after["1399952"])[0]
        self.assertEqual(row[27], "15")
        self.assertEqual(row[35], "45")
        self.assertEqual(row[47], "354")
        self.assertEqual(row[1], "true", "ability 2 must remain available in unison")

    def test_pf_damage_and_special_available_outside_fever(self):
        self.mod.revise(self.package, dry_run=False)
        for program in (*self.mod.MAIN, self.mod.SPECIAL):
            path = self.package / "roots/common" / (program + self.mod.SUFFIX)
            tree = wf_dsl.parse_dsl(zlib.decompress(path.read_bytes(), -15))["tree"]
            self.assertEqual(tree[10], 3)
            self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree)
            attacks = list(wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack"))
            self.assertTrue(attacks)
            self.assertTrue(all(node[-1] is True for node in attacks))
        tree = wf_dsl.parse_dsl(zlib.decompress(
            (self.package / "roots/common" / (self.mod.SPECIAL + self.mod.SUFFIX)).read_bytes(), -15))["tree"]
        # Fever's false branch now has damage, so ordinary PF also has the extra special attack.
        fever = list(wf_dsl.iter_dsl_commands(tree, "ConditionalsFeverMode"))[0]
        self.assertTrue(list(wf_dsl.iter_dsl_commands(fever[2], "CreateNormalAttack")))
        radii = {node[9][1][0]["max"] for node in wf_dsl.iter_dsl_commands(tree, "CreateHitArea")}
        self.assertEqual(radii, {320, 480})

    def test_capability_claim_and_idempotence(self):
        self.mod.revise(self.package, dry_run=False)
        manifest = json.loads((self.package / "manifest.json").read_text(encoding="utf-8"))
        self.assertIn("kyubi-pf-damage-v1", manifest["required_capabilities"])
        self.assertFalse(manifest["qa"]["release_ready"])
        strings = next(x for x in manifest["tables"] if "custom_ability_string" in x["logical_path"])
        self.assertEqual(strings["outer_keys"], [self.mod.SPECIAL_KEY])
        first = {p: p.read_bytes() for p in self.package.rglob("*") if p.is_file()}
        self.mod.revise(self.package, dry_run=False)
        self.assertEqual(first, {p: p.read_bytes() for p in self.package.rglob("*") if p.is_file()})

    def test_main_art_nodes_preserved_but_unknown_damage_rejected(self):
        from wf_kyubi_pf_dsl import revise_tree
        path = self.package / "roots/common" / (self.mod.MAIN[0] + self.mod.SUFFIX)
        tree = wf_dsl.parse_dsl(zlib.decompress(path.read_bytes(), -15))["tree"]
        art = ["Command", ["HideEffect", "test_art_marker"]]
        tree[11][1].append(art)
        result = revise_tree(tree, self.mod.MAIN[0])
        self.assertIn(art, result[11][1])
        self.assertEqual(tree[10], 0, "input tree must not be mutated")
        next(wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack"))[6][0]["max"] = 999
        with self.assertRaises(ValueError):
            revise_tree(tree, self.mod.MAIN[0])

    def test_foreign_text_rows_preserved_and_display_matches_pf(self):
        flat_paths = (self.mod.TEXT, self.mod.STRINGS)
        before = {}
        for logical in flat_paths:
            path = self.package / "roots/common" / logical
            before[logical] = core.read_orderedmap_file(path, logical).text_rows()
        self.mod.revise(self.package, dry_run=False)
        for logical in flat_paths:
            path = self.package / "roots/common" / logical
            after = core.read_orderedmap_file(path, logical).text_rows()
            own = "139995" if logical == self.mod.TEXT else self.mod.SPECIAL_KEY
            self.assertEqual({k: v for k, v in before[logical].items() if k != own},
                             {k: v for k, v in after.items() if k != own})
            self.assertIn("强化弹射伤害", after[own])
            self.assertNotIn("范围扩大", after[own])

    def test_unknown_special_fails_before_any_package_writes(self):
        path = self.package / "roots/common" / (self.mod.SPECIAL + self.mod.SUFFIX)
        tree = wf_dsl.parse_dsl(zlib.decompress(path.read_bytes(), -15))["tree"]
        next(wf_dsl.iter_dsl_commands(tree, "CreateHitArea"))[13][1] = 91
        compressor = zlib.compressobj(wbits=-15)
        path.write_bytes(compressor.compress(wf_dsl.encode_amf3(tree)) + compressor.flush())
        before = {p: p.read_bytes() for p in self.package.rglob("*") if p.is_file()}
        with self.assertRaises(ValueError):
            self.mod.revise(self.package, dry_run=False)
        self.assertEqual(before, {p: p.read_bytes() for p in self.package.rglob("*") if p.is_file()})


if __name__ == "__main__":
    unittest.main()
