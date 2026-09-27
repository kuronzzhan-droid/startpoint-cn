# -*- coding: utf-8 -*-
"""PARADOX（wf_paradox_weapon）生成器离线测试。fixture = live 1.4.1059 的模板行 + 四名角色行 + 角色标签表。"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_battle_rules as BR  # noqa: E402
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
        # 开局 461 刻「诅咒」：永续、1 层、坏状态、不可驱散、强制付与（c10 短路自身 58 弱体无效的 ConditionPrevent）
        self.assertEqual(self.out["flat"][P.UNIQUE], {P.CURSE_UID: [P.curse_unique_row()]})
        u = self.out["flat"][P.UNIQUE][P.CURSE_UID][0]
        self.assertEqual(len(u), 15)
        self.assertEqual(u[:5], [f"paradox_curse_{P.CURSE_UID}", "诅咒",
                                 f"battle/common/unique_condition/{W.ICON_CURSE}", "99999999", "1"])
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
        # 需求并集精确等于两项：legality 只报运行时 gauge-gain-rules-v1，解析器的 equipment-gauge-gain-rules-v1 由生成器补齐
        want = sorted([BR.GAUGE_CAP, S.EQUIPMENT_GAUGE_CAP])
        self.assertEqual(base["capabilities"], want)
        self.assertEqual(self.out["capabilities"], want)
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


if __name__ == "__main__":
    unittest.main()
