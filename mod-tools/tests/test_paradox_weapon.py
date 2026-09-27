# -*- coding: utf-8 -*-
"""PARADOX（wf_paradox_weapon）生成器离线测试。fixture = live 1.4.1059 的模板行 + 四名角色行 + 角色标签表。"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_cursed_weapons as W  # noqa: E402
import wf_dsl  # noqa: E402
import wf_paradox_weapon as P  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures/paradox_templates.json"


def fixture_reader() -> W.LiveReader:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return W.LiveReader(lambda logical: data["flat"].get(logical, {}),
                        lambda logical: data["nested"].get(logical, {}),
                        lambda name: {})


def _cell(row: list[str], block: str, name: str) -> str:
    return row[W._col(W.SOUL_T, block, name)]


class ParadoxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.out = P.build(fixture_reader())
        cls.rows = cls.out["flat"][P.SOUL][P.ID]

    def test_no_problems(self):
        self.assertEqual(self.out["problems"], [])

    def test_stat_values_are_constant_and_as_designed(self):
        expect = {("32", ""): "550000", ("33", ""): "550000", ("34", ""): "550000", ("55", ""): "550000",
                  ("388", ""): "550000", ("723", ""): "10000", ("693", ""): "10000", ("694", ""): "10000",
                  ("695", ""): "10000", ("696", ""): "10000", ("35", ""): "20000", ("245", ""): "50000",
                  ("32", P.PRE_MY_SELF): "150000"}
        seen = {}
        for r in self.rows:
            kind = _cell(r, "instant_content", "kind")
            if kind in ("629", "226"):
                continue
            lo, hi = _cell(r, "instant_content", "strength.power1"), _cell(r, "instant_content", "strength.first_max")
            self.assertEqual(lo, hi, kind)                      # 觉醒 1→5 不变
            pre = _cell(r, "precondition1", "kind")
            seen[(kind, "" if pre == "0" else pre)] = lo
        self.assertEqual(seen, expect)

    def test_combo_on_every_flip(self):
        row = next(r for r in self.rows if _cell(r, "instant_content", "kind") == "226")
        self.assertEqual(_cell(row, "instant_trigger", "kind"), "6")
        self.assertEqual(_cell(row, "instant_trigger", "threshold.power1"), W.times(1))
        self.assertEqual(_cell(row, "instant_content", "strength.power1"), W.times(35))

    def test_chosen_three_gate(self):
        row = next(r for r in self.rows if _cell(r, "precondition1", "kind") == P.PRE_MY_SELF)
        self.assertEqual(_cell(row, "precondition1", "character_groups").split(","), [t for _, t, _ in P.TAGS])
        self.assertEqual(set(self.out["flat"][P.CHARACTER_TAG]), {t for _, t, _ in P.TAGS})

    def test_character_rows_only_gain_the_tag(self):
        for cid, tag, _ in P.TAGS:
            before = self.fx["flat"][P.CHARACTER][cid][0]
            after = self.out["flat"][P.CHARACTER][cid][0]
            diff = [i for i, (a, b) in enumerate(zip(before, after)) if a != b]
            self.assertEqual((len(before), diff), (len(after), [P.TAG_COLUMN]), cid)
            old = [t for t in before[P.TAG_COLUMN].split(",") if t]
            self.assertEqual(after[P.TAG_COLUMN].split(","), old + [tag], cid)
        self.assertEqual(len(P.TAGS), 3)
        self.assertNotIn("129999", self.out["flat"][P.CHARACTER])        # 赛瑞斯按作者 0928 要求移出
        self.assertEqual(self.out["delete"], {P.CHARACTER_TAG: []})

    def test_stale_tags_are_cleaned_after_1060(self):
        # 1.4.1060 曾给赛瑞斯发过 tag_paradox_seris：同步时要把它从角色行和标签表清掉，其余三人不动
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        chars = data["flat"][P.CHARACTER]
        for cid, tag, label in P.TAGS:
            chars[cid][0][P.TAG_COLUMN] = P.retag(chars[cid][0], tag)[P.TAG_COLUMN]
            data["flat"][P.CHARACTER_TAG][tag] = [[label]]
        chars["129999"][0][P.TAG_COLUMN] = "ModDualForm,tag_paradox_seris"
        data["flat"][P.CHARACTER_TAG]["tag_paradox_seris"] = [["赛瑞斯"]]
        read = W.LiveReader(lambda lg: data["flat"].get(lg, {}), lambda lg: data["nested"].get(lg, {}), lambda n: {})
        out = P.build(read, allow_existing=True)
        self.assertEqual(out["flat"][P.CHARACTER]["129999"][0][P.TAG_COLUMN], "ModDualForm")
        self.assertEqual(out["delete"], {P.CHARACTER_TAG: ["tag_paradox_seris"]})
        for cid, tag, _ in P.TAGS:
            self.assertEqual(out["flat"][P.CHARACTER][cid], chars[cid])
        with self.assertRaises(W.CursedWeaponError):
            P.build(read)                                                    # 首发口径：已存在即撞键

    def test_hits_dsl(self):
        tree = self.out["dsl"][P.HITS]
        self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree)
        self.assertEqual(W.dsl_signature_problems(tree), [])
        self.assertEqual(W.colorless_hit_effect_problems(tree), [])
        text = json.dumps(tree)
        self.assertIn('"ACAdditionalDirectAttack"', text)
        self.assertIn('{"min": 6, "max": 6}', text)
        invoke = next(r for r in self.rows if _cell(r, "instant_content", "kind") == "629")
        self.assertEqual(_cell(invoke, "instant_content", "action_path"), P.HITS)
        self.assertIn(_cell(invoke, "instant_content", "string_id"), self.out["flat"][P.CAS])

    def test_weapon_rows_and_server(self):
        equip = self.out["flat"][P.EQUIPMENT][P.ID][0]
        self.assertEqual((equip[1], equip[6], equip[10]), (P.NAME, P.ICON, P.ID))
        self.assertLessEqual(len(equip[7]), W.DESC_LIMITS["equipment"])
        self.assertEqual(self.out["nested"][P.EQUIPMENT_STATUS], {P.ID: {"1": "330,148", "5": "495,221"}})
        srv = self.out["server"]
        self.assertEqual(srv["equipment_ids.json"], [int(P.ID)])
        self.assertEqual(srv["equipment_max_level.json"], {P.ID: 5})

    def test_deterministic(self):
        again = P.build(fixture_reader())
        self.assertEqual(json.dumps(again["flat"], sort_keys=True), json.dumps(self.out["flat"], sort_keys=True))
        self.assertEqual(again["dsl"], self.out["dsl"])


if __name__ == "__main__":
    unittest.main()
