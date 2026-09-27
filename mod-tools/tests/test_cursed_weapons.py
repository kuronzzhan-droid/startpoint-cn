# -*- coding: utf-8 -*-
"""诅咒武器 23 把生成器（wf_cursed_weapons）的离线测试。

fixture 只含模板行（live 1.4.1056 快照）；与 live 的撞键检查在暂存脚本里对真 store 做。
锁定：口径（本体只正面、诅咒只在 120 级）、强化/商店/上架形状、客户端合法性与 DSL 签名、服务端镜像与客户端行一致。
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_cursed_weapons as W  # noqa: E402
import wf_dsl  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures/cursed_weapons_templates.json"
NEGATIVE_KINDS = {"19", "219", "209", "208", "479", "475"}      # 麻痹/封印/比例伤害/增益无效/回复无效
CURSE_COMMANDS = {"SubtractSkillPoint", "RemoveMultiball", "SuppressBallActivity", "DeleteCondition"}
CURSE_ACS = {"ACParalysis", "ACComboRestriction", "ACHealRejection", "ACPoison", "ACSilence", "ACBuffRejection"}
FIVE_BOSS_MATERIALS = {W.BLUEPRINT, W.CRYSTAL, W.CORE}


def fixture_reader() -> W.LiveReader:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return W.LiveReader(lambda logical: data["flat"].get(logical, {}),
                        lambda logical: data["nested"].get(logical, {}),
                        lambda name: {})


def _col(table: str, block: str, name: str) -> int:
    return W._col(table, block, name)


def _strengths(table: str, row: list[str]) -> list[float]:
    block = "instant_content" if row[W._LAYOUT[table]["blocks"]["precondition1"] - 1] == "0" else "during_content"
    lo, hi = row[_col(table, block, "strength.power1")], row[_col(table, block, "strength.first_max")]
    return [float(x) for x in (lo, hi) if x not in ("", "(None)")]


def _kind(table: str, row: list[str]) -> str:
    mode = row[W._LAYOUT[table]["blocks"]["precondition1"] - 1]
    return row[_col(table, "instant_content" if mode == "0" else "during_content", "kind")]


def _walk(node):
    yield node
    if isinstance(node, list):
        for child in node:
            yield from _walk(child)
    elif isinstance(node, dict):
        for child in node.values():
            yield from _walk(child)


def _dsl_is_curse(tree) -> bool:
    for node in _walk(tree):
        if isinstance(node, list) and len(node) == 2 and node[0] == "Command" and node[1][0] in CURSE_COMMANDS:
            return True
        if isinstance(node, list) and node and isinstance(node[0], str) and node[0] in CURSE_ACS:
            return True
        if isinstance(node, list) and len(node) >= 3 and isinstance(node[0], str) and node[0].startswith("AC"):
            for part in node[1:]:
                if isinstance(part, list) and part and isinstance(part[0], dict) and part[0].get("min", 0) < 0:
                    return True
    return False


class CursedWeaponTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = W.build(fixture_reader())
        cls.ws = cls.out["weapons"]

    def test_no_legality_or_dsl_problems(self):
        self.assertEqual(self.out["problems"], [])

    def test_weapon_set_matches_sheet(self):
        self.assertEqual([w.row for w in self.ws], [*range(1, 22), 23, 24])
        self.assertEqual([w.id for w in self.ws], [str(5910100 + r) for r in [*range(1, 22), 23, 24]])
        for logical in (W.ITEM, W.EQUIPMENT, W.SOUL, W.ENH, W.EA):
            self.assertEqual(sorted(self.out["flat"][logical]), sorted(w.id for w in self.ws), logical)

    def test_base_is_positive_only(self):
        dsl = self.out["dsl"]
        for w in self.ws:
            for index, row in enumerate(self.out["flat"][W.SOUL][w.id]):
                where = f"{w.name} S{index}"
                self.assertNotIn(_kind(W.SOUL_T, row), NEGATIVE_KINDS, where)
                self.assertTrue(all(v >= 0 for v in _strengths(W.SOUL_T, row)), where)
                if _kind(W.SOUL_T, row) == "629":
                    program = row[_col(W.SOUL_T, "instant_content", "action_path")]
                    self.assertFalse(_dsl_is_curse(dsl[program]), where)

    def test_curses_only_at_120(self):
        dsl = self.out["dsl"]
        for w in self.ws:
            for index, row in enumerate(self.out["flat"][W.EA][w.id]):
                learn, maxlvl = int(row[1]), int(row[2])
                kind = _kind(W.EA_T, row)
                negative = kind in NEGATIVE_KINDS or any(v < 0 for v in _strengths(W.EA_T, row))
                if kind == "629":
                    negative = negative or _dsl_is_curse(dsl[row[_col(W.EA_T, "instant_content", "action_path")]])
                if negative:
                    self.assertEqual((learn, maxlvl), (120, 120), f"{w.name} E{index}")

    def test_enhancement_rows_shape(self):
        for w in self.ws:
            rows = self.out["flat"][W.EA][w.id]
            self.assertEqual([int(r[0]) for r in rows], list(range(len(rows))), w.name)      # 每行独占 slot
            for r in rows:
                learn, maxlvl = int(r[1]), int(r[2])
                self.assertIn((learn, maxlvl), {(1, 119), (120, 120), (1, 120)}, w.name)
                if learn == maxlvl:
                    self.assertEqual(r[3], r[4])
                    self.assertEqual(len(set(_strengths(W.EA_T, r))), 1 if _strengths(W.EA_T, r) else 0)
            soul = self.out["flat"][W.SOUL][w.id]
            self.assertEqual([int(r[0]) for r in soul], list(range(len(soul))), w.name)
            self.assertTrue(all(r[1] == "1" for r in soul), w.name)

    def test_growth_pairs_reach_totals(self):
        self.assertAlmostEqual(W._grow(500, 240) + W._topup(500, 240) + 240, 500)
        self.assertAlmostEqual(W._grow(1000, 50) + W._topup(1000, 50) + 50, 1000)
        w20 = next(w for w in self.ws if w.row == 20)
        rows = [r for r in self.out["flat"][W.EA][w20.id] if r[_col(W.EA_T, "instant_content", "target")] == W.T_SECOND
                and _kind(W.EA_T, r) == "32"]
        soul = self.out["flat"][W.SOUL][w20.id][0]
        total = float(soul[_col(W.SOUL_T, "instant_content", "strength.first_max")]) \
            + sum(float(r[_col(W.EA_T, "instant_content", "strength.first_max")]) for r in rows)
        self.assertEqual(total, 550000)       # 提案：120 级除队长外攻击力 +550%

    def test_enhancement_meta_and_status(self):
        for w in self.ws:
            enh = self.out["flat"][W.ENH][w.id][0]
            self.assertEqual(enh[0], "120")
            self.assertEqual(enh[4], w.icon120)
            self.assertEqual(max(self.out["nested"][W.ENH_STATUS][w.id], key=int), "120")
            self.assertEqual(self.out["nested"][W.EQUIPMENT_STATUS][w.id], W.EQUIPMENT_STATUS_ROWS)
            eq = self.out["flat"][W.EQUIPMENT][w.id][0]
            self.assertEqual((eq[2], eq[6], eq[8], eq[10], eq[11]), ("0", w.icon, "5", w.id, "5"))
            item = self.out["flat"][W.ITEM][w.id][0]
            self.assertEqual((item[1], item[3]), (w.id, w.icon))

    def test_shop_uses_five_boss_materials_only(self):
        shop = self.out["flat"][W.ENH_SHOP]
        for w in self.ws:
            keys = [f"{w.id}{s:02d}" for s in range(1, 7)]
            self.assertTrue(all(k in shop for k in keys), w.name)
            caps = [int(shop[k][0][30]) for k in keys]
            self.assertEqual(caps, [69, 70, 98, 99, 119, 120])
            for k in keys:
                r = shop[k][0]
                self.assertEqual((r[0], r[2], r[29], r[31]), ("6", w.id, w.id, "5"))
                used = {r[i] for i in (14, 16, 18, 20) if r[i] not in ("", "(None)")}
                self.assertTrue(used and used <= FIVE_BOSS_MATERIALS, (k, used))
        body = self.out["flat"][W.BOSS_COIN_SHOP]
        self.assertEqual(sorted(body), [str(990099003 + i) for i in range(23)])
        for r in (v[0] for v in body.values()):
            self.assertEqual(r[0], "99")
            # 客户端 list_order 倒序：0 = 排在原有凭证(2)/死亡使者(1)之后，同序按商品 ID 升序
            self.assertEqual(r[9], "0")
            self.assertEqual((r[32], r[34]), ("4", "1"))
            self.assertEqual({r[17], r[19]}, {W.BLUEPRINT, W.CRYSTAL})

    def test_descriptions_credit_the_proposer(self):
        # 作者 0928：武器介绍带上提案表里的提案人（本体说明 / 120 解咒说明 / 五重商店说明三处）
        for w in self.ws:
            credit = f"提案：{w.author}"
            self.assertTrue(self.out["flat"][W.EQUIPMENT][w.id][0][7].endswith(credit), w.name)
            self.assertTrue(self.out["flat"][W.ENH][w.id][0][6].endswith(credit), w.name)
            key = str(W.BOSS_SHOP_BASE + 2 + self.ws.index(w) + 1)
            self.assertTrue(self.out["flat"][W.BOSS_COIN_SHOP][key][0][10].endswith(credit), w.name)

    def test_server_delta_mirrors_client(self):
        srv = self.out["server"]
        ids = sorted(int(w.id) for w in self.ws)
        self.assertEqual(sorted(srv["equipment_ids.json"]), ids)
        self.assertEqual(sorted(srv["equipment_enhancement_shop.json"]), sorted(self.out["flat"][W.ENH_SHOP]))
        for key, v in srv["equipment_enhancement_shop.json"].items():
            r = self.out["flat"][W.ENH_SHOP][key][0]
            self.assertEqual(v["enhancementMaxLevel"], int(r[30]))
            self.assertEqual([c["id"] for c in v["costs"]], [int(r[i]) for i in (14, 16, 18, 20) if r[i] != "(None)"])
            self.assertEqual(v["shopCategoryId"], 6)
        body = srv["boss_coin_shop.json"]["99"]
        self.assertEqual(sorted(body), sorted(self.out["flat"][W.BOSS_COIN_SHOP]))
        self.assertEqual(set(srv["boss_coin_shop_item_category_map.json"].values()), {99})
        for key, v in body.items():
            self.assertEqual(v["rewards"][0]["id"], int(self.out["flat"][W.BOSS_COIN_SHOP][key][0][33]))

    def test_dsl_roundtrip_and_references(self):
        referenced = set()
        for table, logical in ((W.SOUL_T, W.SOUL), (W.EA_T, W.EA)):
            for rows in self.out["flat"][logical].values():
                for r in rows:
                    if _kind(table, r) == "629":
                        referenced.add(r[_col(table, "instant_content", "action_path")])
                        self.assertIn(r[_col(table, "instant_content", "string_id")], self.out["flat"][W.CAS])
        self.assertEqual(referenced, set(self.out["dsl"]))
        for program, tree in self.out["dsl"].items():
            self.assertTrue(program.startswith(W.DSL_DIR + "$"))
            self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree, program)
            self.assertEqual(W.dsl_signature_problems(tree), [], program)

    def test_hit_effects_load_for_colorless_owner(self):
        # 1.4.1057 实机：终焉拳套 255 属性 + Fine 命中特效 → 进战斗 C10013。正向对照：旧写法必须被拦下。
        for program, tree in self.out["dsl"].items():
            self.assertEqual(W.colorless_hit_effect_problems(tree), [], program)
        old = json.loads(json.dumps(W._full_screen_attack(5.0)).replace('"Explosion"', '"Fine"'))
        self.assertEqual(len(W.colorless_hit_effect_problems(old)), 1)

    def test_group_pullers_carry_character_groups(self):
        # 1.4.1057 实机：协力球来源（puller 9）角色组空串 → 说明显示「null角色」
        for table, logical in ((W.SOUL_T, W.SOUL), (W.EA_T, W.EA)):
            puller = _col(table, "instant_trigger", "trigger_puller")
            groups = _col(table, "instant_trigger", "trigger_puller.character_groups")
            for key, rows in self.out["flat"][logical].items():
                for r in rows:
                    if r[puller] in ("4", "5", "6", "7", "9"):
                        self.assertNotEqual(r[groups], "", (logical, key))

    def test_mul_conditions_have_unique_keys(self):
        for program, tree in self.out["dsl"].items():
            for node in _walk(tree):
                if isinstance(node, list) and node and node[0] == "Command" and node[1][0] == "CreateCondition":
                    has_mul = any(isinstance(n, dict) and "mul" in n for n in _walk(node[1][2]))
                    if has_mul:
                        self.assertTrue(node[1][7], program)

    def test_unique_references_resolve(self):
        uniques = self.out["flat"][W.UNIQUE]
        for key, rows in uniques.items():
            self.assertEqual(len(rows[0]), 15)
            self.assertTrue(rows[0][2].startswith("battle/common/unique_condition/"))
        for table, logical in ((W.SOUL_T, W.SOUL), (W.EA_T, W.EA)):
            for rows in self.out["flat"][logical].values():
                for r in rows:
                    for block in ("instant_content", "during_trigger", "precondition1"):
                        try:
                            col = _col(table, block, "unique_condition_id")
                        except KeyError:
                            continue
                        if r[col] not in ("", "(None)"):
                            self.assertIn(r[col], uniques, (block, r[col]))

    def test_deterministic(self):
        again = W.build(fixture_reader())
        self.assertEqual(again["flat"], self.out["flat"])
        self.assertEqual(again["dsl"], self.out["dsl"])
        self.assertEqual(again["server"], self.out["server"])

    def test_design_doc_covers_every_weapon(self):
        text = W.design_markdown(self.ws)
        for w in self.ws:
            self.assertIn(f"{w.row:02d}. {w.name}", text)


if __name__ == "__main__":
    unittest.main()
