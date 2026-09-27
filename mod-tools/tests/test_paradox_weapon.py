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
                  ("717", ""): "100000", ("32", P.PRE_MY_SELF): "150000"}
        seen = {}
        for r in self.rows:
            kind = _cell(r, "instant_content", "kind")
            if kind in ("629", "226", "58"):
                continue
            lo, hi = _cell(r, "instant_content", "strength.power1"), _cell(r, "instant_content", "strength.first_max")
            self.assertEqual(lo, hi, kind)                      # 觉醒 1→5 不变
            pre = _cell(r, "precondition1", "kind")
            seen[(kind, "" if pre == "0" else pre)] = lo
        self.assertEqual(seen, expect)

    def test_debuff_immunity_uses_bad_direction_only(self):
        # 58 DebuffPrevent = ConditionPrevent(All(1))；57 是 All(2)（好坏都挡，会挡掉自身增益）——不许用
        kinds = [_cell(r, "instant_content", "kind") for r in self.rows]
        self.assertEqual(kinds.count("58"), 1)
        self.assertNotIn("57", kinds)
        row = next(r for r in self.rows if _cell(r, "instant_content", "kind") == "58")
        self.assertEqual(_cell(row, "instant_content", "target"), W.T_SELF)

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

    def _ea(self, row: list[str], block: str, name: str) -> str:
        return row[W._col(W.EA_T, block, name)]

    def test_curses_only_at_120_and_base_positive(self):
        # 作者 0928：强化 120 级解放诅咒；本体（满破）只有正面
        for r in self.rows:
            if _cell(r, "instant_content", "kind") in ("629", "226", "58"):
                continue
            self.assertGreater(float(_cell(r, "instant_content", "strength.power1")), 0)
        curses = []
        for r in self.out["flat"][P.EA][P.ID]:
            kind = self._ea(r, "instant_content", "kind")
            negative = kind in ("32", "35") and self._ea(r, "instant_content", "target") == W.T_EXCEPT
            if negative or kind == "209":
                curses.append(kind)
                self.assertEqual((r[1], r[2]), ("120", "120"), kind)      # learn = max = 120
        self.assertEqual(sorted(curses), ["209", "32", "35"])

    def test_enhancement_reaches_final_values(self):
        final = {("32", ""): 800, ("33", ""): 800, ("34", ""): 800, ("55", ""): 800, ("388", ""): 800,
                 ("723", ""): 20, ("693", ""): 20, ("694", ""): 20, ("695", ""): 20, ("696", ""): 20,
                 ("35", ""): 30, ("245", ""): 100, ("717", ""): 150, ("32", P.PRE_MY_SELF): 250}
        total: dict = {}
        for r in self.rows:
            kind = _cell(r, "instant_content", "kind")
            key = (kind, "" if _cell(r, "precondition1", "kind") == "0" else _cell(r, "precondition1", "kind"))
            if key in final:
                total[key] = total.get(key, 0) + float(_cell(r, "instant_content", "strength.first_max")) / 1000
        for r in self.out["flat"][P.EA][P.ID]:
            kind = self._ea(r, "instant_content", "kind")
            if self._ea(r, "instant_content", "target") == W.T_EXCEPT:
                continue
            key = (kind, "" if self._ea(r, "precondition1", "kind") == "0" else self._ea(r, "precondition1", "kind"))
            if key in final:
                total[key] = total.get(key, 0) + float(self._ea(r, "instant_content", "strength.first_max")) / 1000
        self.assertEqual({k: round(v, 6) for k, v in total.items()}, final)
        combo = [r for r in self.out["flat"][P.EA][P.ID] if self._ea(r, "instant_content", "kind") == "226"]
        self.assertEqual([self._ea(r, "instant_content", "strength.power1") for r in combo], [W.times(15)])

    def test_enhancement_entry_shop_and_server(self):
        enh = self.out["flat"][P.ENH][P.ID][0]
        self.assertEqual((enh[2], enh[4], enh[6]), (P.NAME120, P.ICON120, P.ENH_DESCRIPTION))
        self.assertLessEqual(len(enh[6]), W.DESC_LIMITS["enhancement"])
        shop = self.out["flat"][P.ENH_SHOP]
        self.assertEqual(sorted(shop), [f"{P.ID}{s:02d}" for s in range(1, 7)])
        caps = [int(shop[f"{P.ID}{s:02d}"][0][30]) for s in range(1, 7)]
        self.assertEqual(caps, [69, 70, 98, 99, 119, 120])
        for r in (v[0] for v in shop.values()):
            self.assertEqual((r[0], r[2], r[29], r[31]), (W.ENH_CATEGORY_KEY, P.ID, P.ID, "5"))
            used = {r[i] for i in (14, 16, 18, 20) if r[i] not in ("", "(None)")}
            self.assertTrue(used and used <= {W.BLUEPRINT, W.CRYSTAL, W.CORE})
        srv = self.out["server"]["equipment_enhancement_shop.json"]
        self.assertEqual(sorted(srv), sorted(shop))
        self.assertEqual({v["enhancementMaxLevel"] for v in srv.values()}, {69, 70, 98, 99, 119, 120})
        self.assertEqual(self.out["nested"][P.ENH_STATUS], {P.ID: dict(W.ENH_STATUS_ROWS)})

    def test_final_hits_dsl(self):
        tree = self.out["dsl"][P.HITS_FINAL]
        self.assertEqual(W.dsl_signature_problems(tree), [])
        self.assertIn('{"min": 8, "max": 8}', json.dumps(tree))
        paths = [self._ea(r, "instant_content", "action_path") for r in self.out["flat"][P.EA][P.ID]
                 if self._ea(r, "instant_content", "kind") == "629"]
        self.assertEqual(paths, [P.HITS_FINAL])

    def test_decay_tiers_mirror_full_rows(self):
        # client-patch/equipment-rules 按 ID+1000·n 选档：分档行与满档逐行同构，只许强度 / 629 段数 / 连击数不同
        flat = self.out["flat"]
        for logical, table in ((P.SOUL, W.SOUL_T), (P.EA, W.EA_T)):
            full = flat[logical][P.ID]
            strength = {W._col(table, "instant_content", c) for c in ("strength.power1", "strength.first_max")}
            invoke = {W._col(table, "instant_content", c) for c in ("string_id", "action_path")}
            for n, ratio in P.TIERS.items():
                tier = flat[logical][P.tier_id(n)]
                self.assertEqual(len(tier), len(full), (logical, n))
                for a, b in zip(full, tier):
                    diff = {j for j, (x, y) in enumerate(zip(a, b)) if x != y}
                    kind = a[W._col(table, "instant_content", "kind")]
                    allowed = invoke if kind == "629" else strength
                    self.assertLessEqual(diff, allowed, (logical, n, kind))
                    curse = kind == "209" or a[W._col(table, "instant_content", "target")] == W.T_EXCEPT
                    if curse or kind == "58":
                        self.assertEqual(a, b, (logical, n, kind))        # 诅咒不缩放、弱体无效保留
                    elif kind not in ("629", "226"):
                        col = W._col(table, "instant_content", "strength.first_max")
                        self.assertAlmostEqual(float(b[col]), float(a[col]) * ratio, delta=1, msg=(logical, n, kind))
        self.assertFalse({P.tier_id(n) for n in P.TIERS} & (set(flat[P.EQUIPMENT]) | set(flat[P.ITEM])))

    def test_decay_tier_discrete_rounding(self):
        self.assertEqual([P.hits_segments(n, False) for n in (0, 1, 2, 3)], [6, 5, 4, 2])
        self.assertEqual([P.hits_segments(n, True) for n in (0, 1, 2, 3)], [8, 6, 5, 3])
        combos = []
        for n in (0, 1, 2, 3):
            rows = self.out["flat"][P.SOUL][P.tier_id(n) if n else P.ID]
            combos.append(next(_cell(r, "instant_content", "strength.power1") for r in rows
                               if _cell(r, "instant_content", "kind") == "226"))
        self.assertEqual(combos, [W.times(x) for x in (35, 26, 18, 9)])
        for n in (0, 1, 2, 3):
            for final in (False, True):
                tree = self.out["dsl"][P.hits_program(n, final)]
                seg = P.hits_segments(n, final)
                self.assertIn(f'{{"min": {seg}, "max": {seg}}}', json.dumps(tree))
                self.assertEqual(self.out["flat"][P.CAS][P.hits_key(n, final)], [[P.hits_text(n, final)]])

    def test_deterministic(self):
        again = P.build(fixture_reader())
        self.assertEqual(json.dumps(again["flat"], sort_keys=True), json.dumps(self.out["flat"], sort_keys=True))
        self.assertEqual(again["dsl"], self.out["dsl"])


if __name__ == "__main__":
    unittest.main()
