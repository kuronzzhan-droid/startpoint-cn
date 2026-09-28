# -*- coding: utf-8 -*-
"""PARADOX（wf_paradox_weapon）生成器离线测试。fixture = live 1.4.1059 的模板行 + 四名角色行 + 角色标签表。"""
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_battle_rules as BR  # noqa: E402
import wf_client_legality as L  # noqa: E402
import wf_client_patch_scope as S  # noqa: E402
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
        # 目标客户端 = 装了 equipment-rules 补丁 APK；默认 1047 基线的拦截见 test_capability_gate_blocks_unpatched_clients
        cls.out = P.build(fixture_reader(), client_capabilities=P.PATCHED_CLIENT_CAPABILITIES)
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
        # 衰减规则只能写在说明里（详情页显示满档）：风味句保留，后接规则
        self.assertEqual(equip[7], P.FLAVOR + P.DECAY_RULE)
        self.assertIn("同队每多1件其他武器或魂珠效果-25%", equip[7])
        self.assertNotIn(",", equip[7])
        self.assertNotIn("\n", equip[7])
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
        self.assertNotIn(P.CURSE_UID, json.dumps(self.rows))              # 「诅咒」只在强化 120 级刻
        curses = []
        for r in self.out["flat"][P.EA][P.ID]:
            kind = self._ea(r, "instant_content", "kind")
            negative = kind in ("32", "35") and self._ea(r, "instant_content", "target") == W.T_EXCEPT
            during = self._ea(r, "during_content", "kind")
            if negative or kind in ("209", "461") or during == "423":
                curses.append(kind or during)
                self.assertEqual((r[1], r[2]), ("120", "120"), kind or during)      # learn = max = 120
        # 作者 0928 定稿：-800% 攻击、-40% 充能、无法获得能力和装备的技能槽增加（423 + 开局刻「诅咒」）
        self.assertEqual(sorted(curses), ["32", "35", "423", "461"])

    def _gauge_row(self, key: str = P.ID) -> list[str]:
        rows = [r for r in self.out["flat"][P.EA][key] if self._ea(r, "during_content", "kind") == "423"]
        self.assertEqual(len(rows), 1, key)
        return rows[0]

    def test_gauge_restriction_row_matches_readme(self):
        # client-patch/equipment-rules/README.md「R3 行」逐格核对（equipment_enhancement_ability 126 列）
        row = self._gauge_row()
        slots = [r[0] for r in self.out["flat"][P.EA][P.ID]]
        self.assertEqual(slots, [str(i) for i in range(len(slots))])     # 空闲 slot，追加在末尾
        self.assertEqual(len(row), 126)
        self.assertEqual(row[0:6], [row[0], "120", "120", "48", "48", "1"])
        self.assertEqual((row[6], row[13], row[20]), ("0", "0", "0"))   # 三个前置都是 Always
        self.assertEqual(row[85], "(None)")                               # 持续累计触发
        # 持续触发 = 134「自身持有固有状态」≥1 层、不随层数倍乘；不是 HpHigh 0（面板会显示「生命值0%以上时」）
        self.assertEqual((row[97], row[98], row[100], row[101], row[102], row[104]),
                         (W.DT_UNIQUE, W.P_SELF, W.times(1), W.times(1), "1", P.CURSE_UID))
        self.assertNotEqual(row[97], W.DT_HP_HIGH)
        self.assertEqual(row[108], "false")                               # 持有者阵亡后诅咒解除
        self.assertEqual((row[109], row[110], row[111]), ("423", W.T_EXCEPT, "(None)"))
        self.assertEqual(row[118], "8")
        self.assertEqual(P.GAUGE_MASK, 8)
        self.assertEqual(P.GAUGE_MASK, BR.gauge_mask(["ability"]))
        # 除上面这些格与 c99（来源 Self 不带角色组）外，其余全部留空：瞬发块不残留
        filled = {i for i, v in enumerate(row) if v != ""}
        self.assertEqual(filled, {0, 1, 2, 3, 4, 5, 6, 13, 20, 85, 97, 98, 100, 101, 102, 104, 108, 109, 110, 111, 118})

    def test_curse_unique_condition(self):
        # 开局 461 刻「诅咒」：永续、坏状态、不可驱散、强制付与（c10 短路自身 58 弱体无效的 ConditionPrevent）。
        # 叠层上限必须 >1：R3 的持续触发 134 按层数读，上限 1 时层数恒 0（1.4.1067 首发即失效）
        self.assertEqual(self.out["flat"][P.UNIQUE], {P.CURSE_UID: [P.curse_unique_row()]})
        u = self.out["flat"][P.UNIQUE][P.CURSE_UID][0]
        self.assertEqual(len(u), 15)
        self.assertEqual(u[:5], [f"paradox_curse_{P.CURSE_UID}", "诅咒",
                                 "battle/common/unique_condition/paradox_curse", "99999999", "2"])
        self.assertTrue(P.CURSE_ICON_SRC.is_file())
        # 负对照：上限改回 1，build 必须报出 R3 门禁读不到层数
        from unittest import mock
        original = W.unique_row
        with mock.patch.object(W, "unique_row", lambda sid, name, icon, duration, cap, **kw:
                               original(sid, name, icon, duration, "1" if name == P.CURSE_UNIQUE_NAME else cap, **kw)):
            probs = P.build(fixture_reader(), client_capabilities=P.PATCHED_CLIENT_CAPABILITIES)["problems"]
        self.assertTrue(probs and all(P.CURSE_UID in p and "134" in p for p in probs), probs)
        self.assertEqual((u[9], u[10], u[11], u[13]), ("false", "true", "1", "false"))
        # ID 段：59200000 +（ID−5920000）×10 + k，与诅咒武器 59100000 + 行号×10 + k（行号 ≤ 99）不相交
        self.assertEqual(P.CURSE_UID, "59200011")
        cursed = {w.uid(k) for w in W.weapons() for k in range(10)}
        self.assertNotIn(P.CURSE_UID, cursed)
        self.assertFalse(W.UNIQUE_BASE <= int(P.CURSE_UID) < W.UNIQUE_BASE + 1000)
        grant = [r for r in self.out["flat"][P.EA][P.ID] if self._ea(r, "instant_content", "kind") == "461"]
        self.assertEqual(len(grant), 1)
        g = grant[0]
        self.assertEqual((g[1], g[2], g[5]), ("120", "120", "0"))          # Lv120 瞬发
        self.assertEqual(self._ea(g, "instant_trigger", "kind"), W.IT_INITIAL)
        self.assertEqual((self._ea(g, "instant_content", "target"), self._ea(g, "instant_content", "unique_condition_id"),
                          self._ea(g, "instant_content", "strength.power1")), (W.T_SELF, P.CURSE_UID, W.times(1)))
        self.assertEqual(self._gauge_row()[104], P.CURSE_UID)

    def test_unique_refs_gate(self):
        # 分档行引用的固有状态必须存在：没有 59200011 时 461 与 134 两行都要报；有时不报；423 的规则码 8 不当固有状态查
        for key in (P.ID, *(P.tier_id(n) for n in P.TIERS)):
            missing = [p for r in self.out["flat"][P.EA][key] for p in P.unique_ref_problems(W.EA_T, r, set())]
            self.assertEqual(missing, [f"固有状态 {P.CURSE_UID} 不存在"] * 2, key)
            present = [p for r in self.out["flat"][P.EA][key]
                       for p in P.unique_ref_problems(W.EA_T, r, {P.CURSE_UID})]
            self.assertEqual(present, [], key)
        self.assertNotIn(P.CURSE_UID, fixture_reader().flat(P.UNIQUE))    # fixture 无此键：build 不报 = 自带的行被计入

    def test_capability_gate_blocks_unpatched_clients(self):
        # R3 的 423 行在 1047 = C7050：默认按 1047 基线构建，满档与三个分档的 423 行各报一条缺口，其余行（含魂表）不报
        gauge = self._gauge_row()
        index = self.out["flat"][P.EA][P.ID].index(gauge)
        keys = (P.ID, *(P.tier_id(n) for n in P.TIERS))
        miss = "目标客户端缺 capability {}（未打补丁读到即 C7050）"
        base = P.build(fixture_reader())
        self.assertEqual(base["problems"], [f"{W.EA_T}[{k}]#{index}: {miss.format(S.EQUIPMENT_GAUGE_CAP)}" for k in keys])
        # 需求并集：legality 只报运行时 gauge-gain-rules-v1，解析器的 equipment-gauge-gain-rules-v1 由生成器补齐；
        # 另加装备详情覆盖三键的 equipment-description-override-v1 —— 行为型，两个目标客户端都没有它，却不进 problems
        want = sorted([BR.GAUGE_CAP, S.EQUIPMENT_GAUGE_CAP, L.EQUIPMENT_DESC_OVERRIDE])
        self.assertEqual(base["capabilities"], want)
        self.assertEqual(self.out["capabilities"], want)
        self.assertNotIn(L.EQUIPMENT_DESC_OVERRIDE, P.PATCHED_CLIENT_CAPABILITIES)
        self.assertEqual(self.out["problems"], [])
        self.assertEqual(P.row_capabilities(W.EA_T, gauge), [BR.GAUGE_CAP, S.EQUIPMENT_GAUGE_CAP])
        # 没有任何补丁的客户端：423 行两项都缺，仍只有这 4 行
        bare = P.build(fixture_reader(), client_capabilities=())
        self.assertEqual(bare["problems"], [f"{W.EA_T}[{k}]#{index}: {miss.format(c)}"
                                            for k in keys for c in (BR.GAUGE_CAP, S.EQUIPMENT_GAUGE_CAP)])
        # 单个字符串会被拆成字符集合、静默放空门禁：直接拒绝
        with self.assertRaises(W.CursedWeaponError):
            P.build(fixture_reader(), client_capabilities=S.EQUIPMENT_GAUGE_CAP)

    def test_client_capability_sets_match_equipment_rules_patch(self):
        # 1047 基线与补丁 APK 新增的两项以 client-patch/equipment-rules/rules.py 为准
        path = Path(__file__).resolve().parents[2] / "client-patch/equipment-rules/rules.py"
        name = "_equipment_rules_for_paradox_test"
        spec = importlib.util.spec_from_file_location(name, path)
        rules = importlib.util.module_from_spec(spec)
        sys.modules[name] = rules  # dataclass 注解解析需要模块已登记
        try:
            spec.loader.exec_module(rules)
        finally:
            sys.modules.pop(name, None)
        self.assertEqual(P.BASE_CLIENT_CAPABILITIES, frozenset(rules.INHERITED_CAPABILITIES))
        self.assertEqual(P.PATCHED_CLIENT_CAPABILITIES - P.BASE_CLIENT_CAPABILITIES,
                         {rules.CAPABILITY_RULES, rules.CAPABILITY_GAUGE})
        self.assertNotIn(rules.CAPABILITY_GAUGE, P.BASE_CLIENT_CAPABILITIES)

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
        # W.growth_pair 自 d63896fd 起按诅咒武器口径扣「设计值 × 0.2」；PARADOX 本体满额，须折回（= live 1.4.1064 的形状）
        first = [(self._ea(r, "instant_content", "strength.power1"), self._ea(r, "instant_content", "strength.first_max"))
                 for r in self.out["flat"][P.EA][P.ID][:2]]
        self.assertEqual(first, [("1933", "230000"), ("20000", "20000")])
        combo = [r for r in self.out["flat"][P.EA][P.ID] if self._ea(r, "instant_content", "kind") == "226"]
        self.assertEqual([self._ea(r, "instant_content", "strength.power1") for r in combo], [W.times(15)])

    def test_enhancement_entry_shop_and_server(self):
        enh = self.out["flat"][P.ENH][P.ID][0]
        self.assertEqual((enh[2], enh[4], enh[6]), (P.NAME120, P.ICON120, P.ENH_DESCRIPTION))
        self.assertLessEqual(len(enh[6]), W.DESC_LIMITS["enhancement"])
        # 面板上 423 只有通用的「限制技能槽增加」：作者原话写在强化说明里
        self.assertIn("除自身外的角色无法获得能力和装备的技能槽增加效果", enh[6])
        self.assertNotIn(",", enh[6])
        self.assertNotIn("\n", enh[6])
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
            head = 3 if table == W.SOUL_T else 6                          # slot / learn /（max / 战力）/ 触发模式
            for n, ratio in P.TIERS.items():
                tier = flat[logical][P.tier_id(n)]
                self.assertEqual(len(tier), len(full), (logical, n))
                self.assertEqual([r[:head] for r in tier], [r[:head] for r in full], (logical, n))
                for a, b in zip(full, tier):
                    diff = {j for j, (x, y) in enumerate(zip(a, b)) if x != y}
                    if a[head - 1] == "1":                                # 持续行（R3 的 423）：原样
                        self.assertEqual(a, b, (logical, n, "during"))
                        continue
                    kind = a[W._col(table, "instant_content", "kind")]
                    allowed = invoke if kind == "629" else strength
                    self.assertLessEqual(diff, allowed, (logical, n, kind))
                    curse = kind in ("209", "461") or a[W._col(table, "instant_content", "target")] == W.T_EXCEPT
                    if curse or kind == "58":
                        self.assertEqual(a, b, (logical, n, kind))        # 诅咒不缩放、弱体无效保留
                    elif kind not in ("629", "226"):
                        col = W._col(table, "instant_content", "strength.first_max")
                        self.assertAlmostEqual(float(b[col]), float(a[col]) * ratio, delta=1, msg=(logical, n, kind))
        self.assertFalse({P.tier_id(n) for n in P.TIERS} & (set(flat[P.EQUIPMENT]) | set(flat[P.ITEM])))

    def test_decay_tiers_keep_curse_rows_verbatim(self):
        # R3 的 423 行与刻「诅咒」的 461 行在三个分档里逐字相同（诅咒不缩放）；满档 4 行诅咒在各档同一 slot
        ea = self.out["flat"][P.EA]
        full = ea[P.ID]

        def curse_rows(rows: list[list[str]]) -> list[list[str]]:
            return [r for r in rows if self._ea(r, "during_content", "kind") == "423"
                    or self._ea(r, "instant_content", "kind") == "461"
                    or self._ea(r, "instant_content", "target") == W.T_EXCEPT]

        self.assertEqual(len(curse_rows(full)), 4)
        for n in P.TIERS:
            tier = ea[P.tier_id(n)]
            self.assertEqual(curse_rows(tier), curse_rows(full), n)
            self.assertEqual(self._gauge_row(P.tier_id(n)), self._gauge_row(), n)
        self.assertNotIn(P.tier_id(4), ea)                                  # n≥4 整件失效：5924001 不得出现
        self.assertNotIn(P.tier_id(4), self.out["flat"][P.SOUL])

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

    def test_skill_echoes(self):
        # 三人专属 25% 回响：自身发动技能 + 自身是该角色（标签）→ 629；分档里原样；DSL 过全部门禁
        tag_of = {cid: tag for cid, tag, _ in P.TAGS}
        for key in (P.ID, *(P.tier_id(n) for n in P.TIERS)):
            rows = [r for r in self.out["flat"][P.SOUL][key]
                    if _cell(r, "instant_content", "kind") == "629" and "echo" in _cell(r, "instant_content", "action_path")]
            self.assertEqual(len(rows), len(P.ECHOES), key)
            for r, (cid, code, _) in zip(rows, P.ECHOES):
                self.assertEqual(_cell(r, "instant_trigger", "kind"), W.IT_SKILL)
                self.assertEqual(_cell(r, "instant_trigger", "trigger_puller"), W.P_SELF)
                self.assertEqual((_cell(r, "precondition1", "kind"), _cell(r, "precondition1", "character_groups")),
                                 (P.PRE_MY_SELF, tag_of[cid]))
                self.assertEqual(_cell(r, "instant_content", "action_path"), P.echo_program(code))
        for cid, code, text in P.ECHOES:
            tree = self.out["dsl"][P.echo_program(code)]
            self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree)
            self.assertEqual(W.dsl_signature_problems(tree), [])
            self.assertEqual(W.colorless_hit_effect_problems(tree), [])
            self.assertEqual(self.out["flat"][P.CAS][f"paradox_echo_{code}"], [[text]])
            self.assertNotIn(",", text)

    def test_deterministic(self):
        again = P.build(fixture_reader())
        self.assertEqual(json.dumps(again["flat"], sort_keys=True), json.dumps(self.out["flat"], sort_keys=True))
        self.assertEqual(again["dsl"], self.out["dsl"])



# ---------------------------------------------------------------------------
# 装备详情覆盖（desc_override_equipment_*）
# ---------------------------------------------------------------------------

_NUMBER = re.compile(r"[+-]?\d+(?:\.\d+)?")
ROOT = Path(__file__).resolve().parents[2]

#: 作者口径定稿文案（设计稿 text_draft）；生成器任何改动若改了措辞或数字，这里先红。
GOLDEN = {
    P.OVERRIDE_BASE: "\n".join((
        "攻击力与全部伤害类型（直接攻击／技能／能力／强化弹射）+550%＆全部独立乘区+10%",
        "直接攻击判定额外+5次（共6段）",
        "每次弹射时连击数+35",
        "技能充能速度+20%＆技能槽上限+50%",
        "弱体无效（异常状态与数值降低全部无效）",
        "攻击力追加合击角色攻击力的100%",
        "自身为基诺维／杰拉德／凯尔时攻击力再+150%",
        "自身为基诺维时：发动技能1秒后以25%的效果回响「掠影协奏」",
        "自身为杰拉德时：发动技能1.5秒后以25%的效果回响「月耀一闪」",
        "自身为凯尔时：发动技能约1.7秒后以25%的效果回响「月华·狼牙连斩」",
    )),
    P.OVERRIDE_GROWTH: "\n".join((
        "随强化等级逐级提升，强化Lv119时追加：",
        "攻击力与全部伤害类型+230%＆全部独立乘区+9.5%",
        "技能充能速度+9.25%＆技能槽上限+47.5%",
        "合击角色攻击力的追加比例+46.25%",
        "自身为基诺维／杰拉德／凯尔时攻击力再+93.75%",
    )),
    P.OVERRIDE_FINAL: "\n".join((
        "终式合计（含本体）：攻击力与全部伤害类型+800%＆全部独立乘区+20%",
        "直接攻击判定额外+7次（共8段）",
        "每次弹射时连击数合计+50",
        "技能充能速度合计+30%＆技能槽上限合计+100%",
        "攻击力追加合击角色攻击力的150%",
        "自身为基诺维／杰拉德／凯尔时攻击力合计+250%",
        "【诅咒】自身以外的角色攻击力-800%＆技能充能速度-40%",
        "【诅咒】战斗开始时自身获得「诅咒」（永续、无法驱散）：自身以外的角色无法获得能力和装备的技能槽增加效果",
    )),
}


def _find(node, name: str) -> list:
    """DSL 树里第一个以 name 开头的列表节点。"""
    if isinstance(node, list):
        if node and node[0] == name:
            return node
        for child in node:
            hit = _find(child, name)
            if hit:
                return hit
    return []


def _row_totals(out: dict, level: int | None) -> dict:
    """按行重新求和（与生成器常量无关）：键 = (kind, 前置1, 是否「自身以外」)，值 = %（226 为次数）。
    level=None 只算魂表（满破，觉醒 1→5 不变）；否则只算该强化等级已习得的强化行，且要求已成长到上限
    （MinToMaxLevelScale 在 max_power_level 钳到 first_max，Lv119 / Lv120 都不落在插值段）。"""
    tables = ((W.SOUL_T, P.SOUL),) if level is None else ((W.EA_T, P.EA),)
    totals: dict = {}
    for table, logical in tables:
        for r in out["flat"][logical][P.ID]:
            mode = r[2] if table == W.SOUL_T else r[5]
            if mode != "0":
                continue
            kind = r[W._col(table, "instant_content", "kind")]
            if kind in ("629", "58", "461"):
                continue
            if table == W.EA_T:
                if int(r[1]) > level:
                    continue
                assert level >= int(r[2]), (kind, r[1], r[2], level)
            hi = float(r[W._col(table, "instant_content", "strength.first_max")])
            value = hi / 100000 if kind == "226" else hi / 1000
            key = (kind, r[W._col(table, "precondition1", "kind")],
                   r[W._col(table, "instant_content", "target")] == W.T_EXCEPT)
            totals[key] = totals.get(key, 0.0) + value
    return totals


def _segments(out: dict, table: str, logical: str, *, final: bool) -> int:
    paths = [r[W._col(table, "instant_content", "action_path")] for r in out["flat"][logical][P.ID]
             if r[W._col(table, "instant_content", "kind")] == "629"
             and "$echo_" not in r[W._col(table, "instant_content", "action_path")]]
    assert len(paths) == 1, paths
    node = _find(out["dsl"][paths[0]], "ACAdditionalDirectAttack")
    return int(node[2][0]["min"])


def _echo_scale() -> float:
    """derive_echo.SCALE（按源码读：导入该脚本会解析本机 store）。"""
    src = (ROOT / "mod-tools/assets/paradox/echo/derive_echo.py").read_text(encoding="utf-8")
    return float(re.search(r"^SCALE = ([0-9.]+)$", src, re.M).group(1))


def _expected_numbers(out: dict) -> dict[str, list[float]]:
    """三段文案里应出现的每个数字，全部按生成出的行 / DSL 重新求出（不读生成器的数值常量）。"""
    soul, ea119, ea120 = _row_totals(out, None), _row_totals(out, 119), _row_totals(out, 120)

    def same(totals: dict, kinds: tuple, pre: str = "0") -> float:
        values = {round(totals.get((k, pre, False), 0.0), 6) for k in kinds}
        assert len(values) == 1, (kinds, values)
        return values.pop()

    def total(key: tuple) -> float:
        return soul.get(key, 0.0) + ea120.get(key, 0.0)

    damage, mult = ("32", "33", "34", "55", "388"), ("723", "693", "694", "695", "696")
    chosen = ("32", P.PRE_MY_SELF, False)
    seg, seg_final = _segments(out, W.SOUL_T, P.SOUL, final=False), _segments(out, W.EA_T, P.EA, final=True)
    growth_max = {int(r[2]) for r in out["flat"][P.EA][P.ID] if r[1] == "1" and r[5] == "0"}
    assert len(growth_max) == 1, growth_max
    echoes = []
    for r in out["flat"][P.SOUL][P.ID]:
        path = r[W._col(W.SOUL_T, "instant_content", "action_path")]
        if "$echo_" in path:
            wait = out["dsl"][path][11][1][0][1]
            assert wait[0] == "Wait", wait
            echoes += [round(wait[1] / 60, 1), _echo_scale() * 100]
    return {
        P.OVERRIDE_BASE: [same(soul, damage), same(soul, mult), seg - 1, seg, soul[("226", "0", False)],
                          soul[("35", "0", False)], soul[("245", "0", False)], soul[("717", "0", False)],
                          soul[chosen], *echoes],
        P.OVERRIDE_GROWTH: [growth_max.pop(), same(ea119, damage), same(ea119, mult), ea119[("35", "0", False)],
                            ea119[("245", "0", False)], ea119[("717", "0", False)], ea119[chosen]],
        P.OVERRIDE_FINAL: [same({k: total(k) for k in set(soul) | set(ea120)}, damage),
                           same({k: total(k) for k in set(soul) | set(ea120)}, mult), seg_final - 1, seg_final,
                           total(("226", "0", False)), total(("35", "0", False)), total(("245", "0", False)),
                           total(("717", "0", False)), total(chosen),
                           ea120[("32", "0", True)], ea120[("35", "0", True)]],
    }


def assert_texts_follow_rows(tc: unittest.TestCase, out: dict) -> None:
    """发出去的三段文案（out.flat[CAS]）里的数字 == 按行重算的数字，逐个、按顺序。"""
    expected = _expected_numbers(out)
    for key in P.OVERRIDE_KEYS:
        text = out["flat"][P.CAS][key][0][0]
        got = [round(float(x), 6) for x in _NUMBER.findall(text)]
        tc.assertEqual(got, [round(float(x), 6) for x in expected[key]], key)


class ParadoxDescriptionOverrideTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = P.build(fixture_reader(), client_capabilities=P.PATCHED_CLIENT_CAPABILITIES)
        cls.cas = cls.out["flat"][P.CAS]

    def test_three_keys_exactly(self):
        prefixed = sorted(k for k in self.cas if k.startswith(L.EQUIPMENT_DESC_OVERRIDE_KEY_PREFIX))
        self.assertEqual(prefixed, sorted(P.OVERRIDE_KEYS))
        self.assertEqual(P.OVERRIDE_KEYS, ("desc_override_equipment_5920001",
                                           "desc_override_equipment_enhancement_5920001",
                                           "desc_override_equipment_enhancement_5920001_final"))
        for key in P.OVERRIDE_KEYS:
            self.assertEqual(self.cas[key], [[P.override_texts()[key]]], key)
            self.assertEqual(L.equipment_desc_override_key_problems(key), [], key)
            self.assertEqual(L.panel_override_capability(key), L.EQUIPMENT_DESC_OVERRIDE, key)
        # 键里的 ID：本体键按魂 ID（equipment c10）、强化键按装备 ID —— PARADOX 两者都是 5920001
        self.assertEqual(self.out["flat"][P.EQUIPMENT][P.ID][0][10], P.ID)
        self.assertEqual(set(self.out["flat"][P.ENH]), {P.ID})
        self.assertIn(P.ID, self.out["flat"][P.SOUL])
        # 其余 CAS 键（段数 / 回响说明）不属于任何面板覆盖
        for key in set(self.cas) - set(P.OVERRIDE_KEYS):
            self.assertIsNone(L.panel_override_capability(key), key)

    def test_golden_texts(self):
        self.assertEqual(P.override_texts(), GOLDEN)

    def test_texts_follow_the_rows(self):
        assert_texts_follow_rows(self, self.out)

    def test_drift_check_catches_text_or_row_edits(self):
        # 负对照：只改文案、或只改行，按行重算的核对都必须红
        tampered = copy.deepcopy(self.out)
        text = tampered["flat"][P.CAS][P.OVERRIDE_BASE][0][0]
        tampered["flat"][P.CAS][P.OVERRIDE_BASE] = [[text.replace("+550%", "+551%", 1)]]
        with self.assertRaises(AssertionError):
            assert_texts_follow_rows(self, tampered)
        tampered = copy.deepcopy(self.out)
        row = tampered["flat"][P.SOUL][P.ID][0]
        self.assertEqual(row[W._col(W.SOUL_T, "instant_content", "kind")], "32")
        row[W._col(W.SOUL_T, "instant_content", "strength.first_max")] = "551000"
        with self.assertRaises(AssertionError):
            assert_texts_follow_rows(self, tampered)
        tampered = copy.deepcopy(self.out)
        for r in tampered["flat"][P.EA][P.ID]:
            if r[W._col(W.EA_T, "instant_content", "kind")] == "723" and r[1] == "1":
                r[W._col(W.EA_T, "instant_content", "strength.first_max")] = "9000"
        with self.assertRaises(AssertionError):
            assert_texts_follow_rows(self, tampered)

    def test_changing_a_value_changes_rows_and_text(self):
        cases = (
            ("ATK_BASE", 600, P.OVERRIDE_BASE, "+600%"),
            ("ATK_BASE", 600, P.OVERRIDE_GROWTH, "攻击力与全部伤害类型+180%"),
            ("MULT_TOTAL", 30, P.OVERRIDE_FINAL, "全部独立乘区+30%"),
            ("CHARGE_BASE", 25, P.OVERRIDE_GROWTH, "技能充能速度+4.25%"),
            ("GAUGE_TOTAL", 120, P.OVERRIDE_FINAL, "技能槽上限合计+120%"),
            ("UNISON_BASE", 80, P.OVERRIDE_BASE, "合击角色攻击力的80%"),
            ("CHOSEN_TOTAL", 300, P.OVERRIDE_GROWTH, "攻击力再+142.5%"),
            ("HITS_EXTRA_BASE", 4, P.OVERRIDE_BASE, "额外+4次（共5段）"),
            ("HITS_EXTRA_FINAL", 9, P.OVERRIDE_FINAL, "额外+9次（共10段）"),
            ("COMBO_BASE", 30, P.OVERRIDE_BASE, "连击数+30"),
            ("COMBO_TOTAL", 60, P.OVERRIDE_FINAL, "连击数合计+60"),
            ("CURSE_ATK", -500, P.OVERRIDE_FINAL, "攻击力-500%"),
            ("CURSE_CHARGE", -30, P.OVERRIDE_FINAL, "技能充能速度-30%"),
        )
        for name, value, key, needle in cases:
            with self.subTest(name=name, key=key), mock.patch.object(P, name, value):
                out = P.build(fixture_reader(), client_capabilities=P.PATCHED_CLIENT_CAPABILITIES)
                self.assertEqual(out["problems"], [])
                self.assertIn(needle, out["flat"][P.CAS][key][0][0])
                self.assertNotEqual(out["flat"][P.CAS][key], self.cas[key])
                assert_texts_follow_rows(self, out)                   # 行跟着变，文案仍与行一致

    def test_constants_match_the_row_machinery(self):
        # 成长行 1→FINAL_LEVEL−1、补足/终式行 FINAL_LEVEL（W.growth_pair 写死 119/120）；强化 c0 = maxLevel
        ea = self.out["flat"][P.EA][P.ID]
        self.assertEqual({(r[1], r[2]) for r in ea}, {("1", str(P.FINAL_LEVEL - 1)),
                                                        (str(P.FINAL_LEVEL), str(P.FINAL_LEVEL))})
        self.assertEqual(self.out["flat"][P.ENH][P.ID][0][0], str(P.FINAL_LEVEL))
        self.assertEqual(set(P.DAMAGE_KINDS), {"32", *(k for k, _ in P.DAMAGE_TYPE_TEXT)})
        self.assertEqual(len(P.MULT_KINDS), 5)
        # 回响比例 = derive_echo.SCALE；回响短名与延迟和已发布的 629 说明一致
        self.assertEqual(P.ECHO_PERCENT, round(_echo_scale() * 100))
        self.assertEqual(set(P.ECHO_SKILL), {code for _, code, _ in P.ECHOES})
        self.assertEqual([P.echo_delay_frames(code) for _, code, _ in P.ECHOES], [60, 90, 100])
        for _, code, text in P.ECHOES:
            head = f"「{P.ECHO_SKILL[code]}」回响：{P.seconds_text(P.echo_delay_frames(code))}后以{P.ECHO_PERCENT}%的效果"
            self.assertTrue(text.startswith(head), (code, text))

    def test_no_override_for_decay_tiers(self):
        tiers = [P.tier_id(n) for n in (*P.TIERS, 4)]
        for key in self.cas:
            for tid in tiers:
                self.assertNotIn(tid, key)
        texts = P.override_texts()
        equip = self.out["flat"][P.EQUIPMENT][P.ID][0]
        for tid in tiers:
            for key in (f"desc_override_equipment_{tid}", f"desc_override_equipment_enhancement_{tid}",
                        f"desc_override_equipment_enhancement_{tid}_final"):
                problems = P.override_text_problems({key: texts[P.OVERRIDE_BASE]}, equip)
                self.assertTrue(any("分档" in p for p in problems), (key, problems))

    def test_validator_negative_controls(self):
        texts = P.override_texts()
        equip = self.out["flat"][P.EQUIPMENT][P.ID][0]
        self.assertEqual(P.override_text_problems(texts, equip), [])
        base = texts[P.OVERRIDE_BASE]
        bad = {
            "comma": {P.OVERRIDE_BASE: base + ",x"},
            "cr": {P.OVERRIDE_BASE: base.replace("\n", "\r\n", 1)},
            "empty line": {P.OVERRIDE_BASE: base.replace("\n", "\n\n", 1)},
            "trailing newline": {P.OVERRIDE_BASE: base + "\n"},
            "leading space": {P.OVERRIDE_BASE: " " + base},
            "long line": {P.OVERRIDE_BASE: "攻" * (P.OVERRIDE_LINE_LIMIT + 1)},
            "hp low": {P.OVERRIDE_BASE: "生命值100%以下时攻击力+10%"},
            "hp high": {P.OVERRIDE_GROWTH: "生命值0%以上时攻击力+10%"},
            "leader": {P.OVERRIDE_FINAL: "自身为队长时攻击力+10%"},
            "self pf": {P.OVERRIDE_BASE: "自身的强化弹射伤害+550%"},
            "pf self": {P.OVERRIDE_BASE: "强化弹射伤害+550%（仅自身）"},
            "empty text": {P.OVERRIDE_BASE: ""},
            "foreign id": {"desc_override_equipment_5910101": base},
            "malformed key": {"desc_override_equipment_5920001_final": base},
        }
        for label, case in bad.items():
            with self.subTest(label):
                self.assertTrue(P.override_text_problems(case, equip), label)
        wrong = list(equip)
        wrong[10] = P.tier_id(1)
        self.assertTrue(P.override_text_problems(texts, wrong))
        # build 硬拦：坏文案不出行
        with mock.patch.object(P, "override_texts", lambda: {**texts, P.OVERRIDE_BASE: base + ",x"}):
            with self.assertRaises(W.CursedWeaponError):
                P.build(fixture_reader(), client_capabilities=P.PATCHED_CLIENT_CAPABILITIES)

    def test_capability_is_behaviour_only(self):
        # 缺 equipment-description-override-v1 的客户端（1047 / equipment-rules / 无补丁）只是显示原文案：
        # capabilities 报它，problems 永远不报它；加上它也不改变 problems
        for have in ((), P.BASE_CLIENT_CAPABILITIES, P.PATCHED_CLIENT_CAPABILITIES):
            out = P.build(fixture_reader(), client_capabilities=have)
            self.assertIn(L.EQUIPMENT_DESC_OVERRIDE, out["capabilities"])
            self.assertFalse(any(L.EQUIPMENT_DESC_OVERRIDE in p for p in out["problems"]), have)
            more = P.build(fixture_reader(), client_capabilities=set(have) | {L.EQUIPMENT_DESC_OVERRIDE})
            self.assertEqual(more["problems"], out["problems"])
        self.assertNotIn(L.EQUIPMENT_DESC_OVERRIDE, P.PATCHED_CLIENT_CAPABILITIES)

    def test_capability_name_matches_client_patch(self):
        path = ROOT / "client-patch/equipment-description-override/rules.py"
        if not path.exists():
            self.skipTest("client-patch/equipment-description-override 尚未落地")
        name = "_equipment_description_override_rules_for_paradox_test"
        spec = importlib.util.spec_from_file_location(name, path)
        rules = importlib.util.module_from_spec(spec)
        sys.modules[name] = rules
        try:
            spec.loader.exec_module(rules)
        finally:
            sys.modules.pop(name, None)
        self.assertEqual(rules.CAPABILITY, L.EQUIPMENT_DESC_OVERRIDE)
        # 补丁拼键用的三段字面量 = 这里发出的三键
        self.assertEqual((rules.BASE_PREFIX + P.ID, rules.ENH_PREFIX + P.ID, rules.ENH_PREFIX + P.ID + rules.FINAL_SUFFIX),
                         P.OVERRIDE_KEYS)
        self.assertEqual(rules.BASE_PREFIX, L.EQUIPMENT_DESC_OVERRIDE_KEY_PREFIX)


if __name__ == "__main__":
    unittest.main()
