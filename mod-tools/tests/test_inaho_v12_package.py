# -*- coding: utf-8 -*-
"""Inaho V12 (package 1.0.9): the native Fever-growth contract, in the package itself.

V11 hid three ability/leader descriptions behind ``desc_override_*`` rows because the
counter was a hand-rolled ``S`` accumulator (I461 seed 4200 + two I629 DSLs + three
I213 per-stack rows) whose native panel text leaked ``每等级280`` / ``累计1000000000``.
V12 replaces that with the official primitives: the unique condition counts layers, a
leader DURING row (trigger 134 ``ConditionAccumulationCountUnique`` -> content 18
``FeverPoint``) scales the Fever rate per layer, and the panel needs no override.

This test pins the removal.  Deleting an assertion here must turn red -- it is the only
place that says the internal-counter machinery may not come back through a merge.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_dsl  # noqa: E402
import wf_mod_tool as core  # noqa: E402
from wf_client_description_legality import description_compatibility_problems  # noqa: E402
from wf_client_legality import (  # noqa: E402
    client_legality_problems, required_client_capabilities,
)

PACKAGE = Path(__file__).resolve().parents[2] / "work/character_packs/fox_oracle_autumn/package"
ABILITY = "master/ability/ability.orderedmap"
LEADER = "master/ability/leader_ability.orderedmap"
UNIQUE = "master/character/unique_condition.orderedmap"
STRINGS = "master/string/custom_ability_string.orderedmap"

STATE = "1399952"
LAYER_CAP = "99"   # 2026-09-09 作者:余辉无上限成长(99 = 客户端显示上限)
FEVER_RATIO_CAPABILITY = "kyubi-fever-ratio-v1"

# custom_ability_string keys the V12 build removed: two dead I629 描述键 plus the three
# V11 panel overrides.  They must be gone from the table *and* from the manifest claim --
# a key left in the claim is republished, a key left in the table is never deleted live.
REMOVED_STRING_KEYS = (
    "ability_fox_oracle_autumn_drain",
    "ability_fox_oracle_autumn_fever_growth",
    "desc_override_fox_oracle_autumn_1",
)
# 2026-09-09/10 回来的固定文案(队长技 + 词条6),内容由作者口径决定,这里只钉存在。
PRESENT_STRING_KEYS = (
    "desc_override_fox_oracle_autumn",
    "desc_override_fox_oracle_autumn_2",
    "desc_override_fox_oracle_autumn_6",
)
REMOVED_DSLS = (
    "battle/action/skill/action/ability_skill/"
    "ability_fox_oracle_autumn_drain$ability_fox_oracle_autumn_drain.action.dsl.amf3.deflate",
    "battle/action/skill/action/ability_skill/ability_fox_oracle_autumn_fever_growth$"
    "ability_fox_oracle_autumn_fever_growth.action.dsl.amf3.deflate",
)
SKILL_DSLS = {
    1: ("battle/action/skill/action/rare5/fox_oracle_autumn$"
        "fox_oracle_autumn_1.action.dsl.amf3.deflate", {"min": 35, "max": 35}),
    2: ("battle/action/skill/action/rare5/fox_oracle_autumn$"
        "fox_oracle_autumn_2.action.dsl.amf3.deflate", {"min": 45, "max": 50}),
}


def _records(logical: str, key: str) -> list[list[str]]:
    table = core.read_orderedmap_file_raw_rows(PACKAGE / "roots/common" / logical, logical)
    raw = table.rows[table.keys.index(key)]
    return core.read_csv_lines(zlib.decompress(raw).decode("utf-8"))


class InahoV12PackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (PACKAGE / "manifest.json").is_file():
            raise unittest.SkipTest("Inaho character package is unavailable")
        cls.manifest = json.loads((PACKAGE / "manifest.json").read_bytes())
        cls.strings = core.read_orderedmap_file(
            PACKAGE / "roots/common" / STRINGS, STRINGS
        ).text_rows()

    def test_unique_condition_counts_layers_not_a_raw_accumulator(self):
        row, = _records(UNIQUE, STATE)
        # c4 = UniqueConditionValues.max_accumulation (UniqueConditionValues.as:59);
        # "(None)" or 1 would make UniqueConditionLogic.get_maxAccumulation return 1 and
        # the DURING trigger 134 could never count past one layer.
        self.assertEqual(row[4], LAYER_CAP)
        self.assertEqual(row[1], "余辉")
        self.assertEqual((row[9], row[10]), ("false", "true"))  # cancelable / force_apply

    def test_ability_1_seeds_nothing_and_gains_one_layer_per_fever(self):
        rows = _records(ABILITY, "1399951")
        self.assertEqual(len(rows), 6)
        seed = rows[3]
        # trigger 8 Fever, content 461 ConditionUnique, initial_multiply 1:
        # +1 layer whenever Fever starts, and no battle-start seed at all.
        self.assertEqual((seed[27], seed[47], seed[68], seed[74]), ("8", "461", STATE, "1"))
        self.assertEqual((seed[51], seed[59]), ("100000", "100000"))
        self.assertNotIn("4200", seed)
        # No I629 program cell and no I213 per-stack row survive in this ability.
        for row in rows:
            self.assertNotEqual(row[47], "629")
            self.assertNotEqual(row[47], "213")
            self.assertEqual(row[70], "")
            self.assertEqual(row[71], "")

    def test_ability_1_fever_skill_ratio_and_ally_gauge_rows(self):
        drain, ally = _records(ABILITY, "1399951")[4:6]
        # 1.1.1: Fever + own PowerFlip (trigger 2, every PF) -> 724 AddFeverPointRatio, -10% of cap.
        self.assertEqual((drain[6], drain[27], drain[28]), ("12", "2", "0"))
        self.assertEqual((drain[47], drain[51], drain[52]), ("724", "-10000", "-10000"))
        # Yellow resonance + Fever + own SkillInvoke -> 211 SkillGauge, ExceptMyself +10%.
        self.assertEqual((ally[6], ally[9], ally[11], ally[13]), ("2", "600000", "Yellow", "12"))
        self.assertEqual((ally[27], ally[28]), ("23", "0"))
        self.assertEqual((ally[47], ally[48], ally[51], ally[52]),
                         ("211", "1", "10000", "10000"))

    def test_ability_6_has_no_skill_fever_gain_row(self):
        # 1.1.0 (author, 2026-09-07): "去掉雷属性角色放技能获得fever的词条" -- the 213
        # Fever+350-on-skill record is gone; the Fever PF-damage during row stays, and
        # 2026-09-10 added the leader-gated 「余辉≥10 且非Fever,PF 时 FEVER 槽+15%」(724) row.
        rows = _records(ABILITY, "1399956")
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertNotEqual(row[47], "213")
        self.assertNotIn(STATE, rows[0])
        gate = rows[1]
        self.assertEqual((gate[6], gate[13], gate[14], gate[16], gate[19], gate[20]),
                         ("186", "144", "0", "1000000", STATE, "42"))
        self.assertEqual((gate[27], gate[47], gate[51], gate[52]), ("2", "724", "15000", "15000"))

    def test_leader_scales_the_fever_rate_per_layer_and_keeps_the_i722_slot(self):
        rows = _records(LEADER, "139995")
        self.assertEqual(len(rows), 12)   # 2026-09-09 +during 413 每层;2026-09-10 +Fever→461 余辉+1
        growth = rows[2]
        self.assertEqual(growth[3], "1")                       # During
        self.assertEqual(growth[83], "(None)")                 # accumulation trigger
        self.assertEqual((growth[95], growth[96]), ("134", "0"))
        self.assertEqual((growth[98], growth[99]), ("100000", "100000"))
        self.assertEqual((growth[100], growth[102]), ("(None)", STATE))   # 层数不封顶
        # 2026-09-10: target 自身→雷属性全队(引擎乘区只放大攻击者本人的 Fever 点),两列拉平 40%
        self.assertEqual((growth[106], growth[107], growth[108], growth[109]), ("false", "18", "5", "Yellow"))
        self.assertEqual((growth[111], growth[112]), ("40000", "40000"))
        # wf_dual_pf_contract.bind_native_programs pins the I722 override to row index 8.
        self.assertEqual(rows[8][45], "722")
        self.assertEqual(rows[8][80], "override_fox_oracle_autumn_dual_pf")
        # The 213 rows that produced 每等级280 / 余辉等级在0以下 are gone.
        for row in rows:
            self.assertNotEqual(row[45], "213")
            self.assertNotIn(row[11], ("187", "199"))

    def test_every_row_is_client_legal_and_only_724_needs_the_patch(self):
        gated = []
        for key, alias in ((f"13999{index}", "ability") for index in range(51, 57)):
            for index, row in enumerate(_records(ABILITY, key)):
                self.assertEqual(client_legality_problems(alias, row), [], f"{key}#{index}")
                self.assertEqual(description_compatibility_problems(alias, row), [])
                gated += [(f"{key}#{index}", cap)
                          for cap in required_client_capabilities(alias, row)]
        for index, row in enumerate(_records(LEADER, "139995")):
            self.assertEqual(client_legality_problems("leader_ability", row), [], index)
            self.assertEqual(description_compatibility_problems("leader_ability", row), [])
            gated += [(f"139995#{index}", cap)
                      for cap in required_client_capabilities("leader_ability", row)]
        self.assertEqual(gated, [("1399951#4", FEVER_RATIO_CAPABILITY),
                                 ("1399956#1", FEVER_RATIO_CAPABILITY)])

    def test_skill_dsls_are_plain_add_fever_point_again(self):
        for level, (logical, points) in SKILL_DSLS.items():
            with self.subTest(level=level):
                raw = (PACKAGE / "roots/common" / logical).read_bytes()
                tree = wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"]
                # 2026-09-10: AddFeverPoint 只在非 Fever 执行(ConditionalsFeverMode 第一分支=Fever中)。
                self.assertEqual(tree[11][1][3],
                                 ["Command", ["ConditionalsFeverMode", ["Block", []],
                                              ["Block", [["Command", ["AddFeverPoint", [points]]]]]]])
                self.assertNotIn(STATE, json.dumps(tree))

    def test_dead_strings_and_dsls_left_the_package_and_the_manifest(self):
        self.assertEqual(self.manifest["package_version"], "1.1.1")
        # V9 (kyubi-pf-damage) was dropped on 2026-09-07: the FFDec whole-class
        # recompile crashed evalCommand (F1069) and the author no longer wants
        # skills classified as PF damage.
        self.assertNotIn("kyubi-pf-damage-v1", self.manifest["required_capabilities"])
        claim, = [t for t in self.manifest["tables"] if t["logical_path"] == STRINGS]
        root_paths = {entry["logical_path"] for entry in self.manifest["roots"]["common"]}
        for key in REMOVED_STRING_KEYS:
            with self.subTest(key=key):
                self.assertNotIn(key, self.strings)
                self.assertNotIn(key, claim["outer_keys"])
        for key in PRESENT_STRING_KEYS:
            with self.subTest(key=key):
                self.assertIn(key, self.strings)
        self.assertEqual(claim["outer_keys"], [
            "ability_skill_fox_oracle_autumn_fever_pf",
            "override_string_fox_oracle_autumn_dual_pf",
            # 1.1.1: V11 panel override for ability 2 (「Fever模式中，无法获得Fever」).
            "desc_override_fox_oracle_autumn_2",
        ])
        for logical in REMOVED_DSLS:
            with self.subTest(logical=logical):
                self.assertNotIn(logical, root_paths)
                self.assertFalse((PACKAGE / "roots/common" / logical).exists())


if __name__ == "__main__":
    unittest.main()
