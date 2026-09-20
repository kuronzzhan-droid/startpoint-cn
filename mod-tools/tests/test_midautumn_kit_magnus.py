# -*- coding: utf-8 -*-
"""玛格诺斯（119990 lion_swordman_moon）kit 的单测 —— rework1（2026-09-21）。

四层：
1. 纯静态（无 IO）：行计划的硬约束——队长表禁 422/724/713、422 必须挂前置 42 且 param_id 显式、
   629 排在 525 之前且同触发同 CT、固有 ID 8 位 / 上限不是 (None)、自有键全部声明、面板文案规则；
2. 设计稿对账：``B/design/magnus.json`` 的 ``plan_rework1`` 与 kit 常量逐项一致；
3. 集成（需要 live store + ``.cdn/cn`` 官方归档）：用 kitlib 的真实代码路径回放 23 行
   （``build_row`` 的 ``expect_describe`` 逐字比对），并从官方 donor 树重建 6 棵 DSL；
4. 成品包（需要已重建的 workspace）：PF 三档、克隆特效族、克拉莉丝裁段都真的落进了包里。
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_dsl  # noqa: E402
import wf_midautumn_kit_magnus as KM  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_mod_tool as core  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
WORKSPACE = REPO / "work/character_packs/ma-magnus"
PKG_COMMON = WORKSPACE / "package/roots/common"


def _live_available() -> bool:
    profile = core.resolve_profile()
    return (profile is not None and profile.store.is_dir()
            and (core.project_root() / ".cdn" / "cn").is_dir())


_LIVE = _live_available()

# 队长表写这三个 kind = 角色页 C7050（裁决 §8 / 记忆卡 wf-dash-parameter-leader-table-trap）
LEADER_FORBIDDEN_KINDS = ("422", "724", "713")
ABILITY_CONTENT_COL = 47
ABILITY_DURING_CONTENT_COL = 109
LEADER_CONTENT_COL = 45
LEADER_DURING_CONTENT_COL = 107


class PlanStaticTests(unittest.TestCase):
    """不碰任何表，只看 kit 常量自身的一致性。"""

    def test_identity_matches_the_registry(self):
        spec = MS.SPECS["magnus"]
        self.assertEqual((spec.cid, spec.code), (KM.CID, KM.CODE))
        self.assertEqual((spec.template_id, spec.template_code),
                         (KM.TEMPLATE_ID, KM.TEMPLATE_CODE))
        self.assertEqual(spec.element, 0, "玛格诺斯改口为火，不翻属性")

    def test_unique_id_is_eight_digits_under_cid(self):
        self.assertEqual(KM.UID, str(KM.CID * 100 + 1))
        self.assertEqual(len(KM.UID), 8)

    def test_unique_condition_is_unbounded_in_both_axes(self):
        self.assertNotIn(KM.UNIQUE_CAP, ("", "(None)"), "(None) 会被读成上限 1，叠层全死")
        self.assertEqual(KM.UNIQUE_CAP, "99", "「不设置上限」的官方写法是 99")
        self.assertEqual(KM.UNIQUE_FRAMES, "99999999", "「无时间限制」的官方写法")
        self.assertEqual(KM.UNIQUE_CELLS[3], KM.UNIQUE_FRAMES)
        self.assertEqual(KM.UNIQUE_CELLS[4], KM.UNIQUE_CAP)

    def test_every_self_owned_key_is_declared(self):
        declared = {logical: set(keys) for logical, keys in SPEC_KEYS().items()}
        self.assertIn(KM.UID, declared[MS.UNIQUE_CONDITION_LOGICAL])
        self.assertEqual(set(KM.CAS_TEXTS), declared[KL.CAS])
        self.assertIn(KM.VOICE_KEY, declared[KL.SWITCHED])
        self.assertEqual(declared[KM.PFA], {KM.PF_KEY})

    def test_ability_key_c0_c1_c2_are_uniform_per_key(self):
        for slot, records in KM.PLAN.items():
            c0 = {cells.get(0) for _d, _s, cells, _e in records}
            self.assertEqual(c0, {f"{KM.CODE}_{slot}"}, f"slot {slot} c0")
            c1 = {cells.get(1) for _d, _s, cells, _e in records}
            self.assertEqual(len(c1), 1, f"slot {slot} 主位限制必须单值: {c1}")
            c2 = {cells.get(2) for _d, _s, cells, _e in records}
            self.assertEqual(len(c2), 1, f"slot {slot} 雕像组必须单值: {c2}")
            self.assertLessEqual(c2 - set(_statue_groups()), set(), f"slot {slot} 雕像组不认识")

    def test_only_slot3_is_main_position_only(self):
        main_only = {slot for slot, records in KM.PLAN.items()
                     if records[0][2].get(1) == "false"}
        self.assertEqual(main_only, {3}, "目标面板只有能力 3 带 Ⓜ")

    def test_invoke_row_precedes_the_consume_row(self):
        """629 发动追击必须排在同触发的 525 消耗行之前，否则最后一层先被吃掉。"""
        slot3 = KM.PLAN[3]
        invoke = next(i for i, (_d, _s, c, _e) in enumerate(slot3)
                      if c.get(70) == KM.CHASE_STRING)
        consume = next(i for i, (_d, _s, _c, e) in enumerate(slot3) if "消耗固有状态" in e)
        self.assertLess(invoke, consume)

    def test_invoke_and_consume_share_precondition_trigger_and_cooldown(self):
        by_desc = {e: c for _d, _s, c, e in KM.PLAN[3]}
        invoke = next(c for e, c in by_desc.items() if "发动技能动作" in e)
        consume = next(c for e, c in by_desc.items() if "消耗固有状态" in e)
        for col in (6, 7, 9, 10, 12, 27, 28, 30, 31, 34, 35):
            self.assertEqual(invoke.get(col), consume.get(col), f"c{col} 必须同形")
        self.assertEqual(invoke[6], "188", "前置 188 = 固有状态实例数")
        self.assertEqual(invoke[9], "100000",
                         "188 数的是实例数（恒为 1）：阈值只能写 ≥1，写 ≥2 永不成立")
        self.assertEqual(invoke[27], "180",
                         "面板原话「强化弹射命中敌人时」= 180 OneOfEnemyPowerFlipHitLv1")
        self.assertEqual(invoke[35], "36", "多敌时一次 PF 触发多次 ⇒ 必须带 CT 限流")

    def test_629_row_carries_both_the_string_key_and_the_program(self):
        invoke = next(c for _d, _s, c, e in KM.PLAN[3] if "发动技能动作" in e)
        self.assertEqual(invoke[70], KM.CHASE_STRING)
        self.assertEqual(invoke[71], KM.CHASE_PROGRAM)
        self.assertIn(KM.CHASE_STRING, KM.CAS_TEXTS, "629 必须配一条面板字符串")

    def test_stack_gates_never_use_the_instance_counting_preconditions(self):
        """「引擎点火 N 层以上」只能走 during 134；前置 188 / during 194 数实例恒为 1。"""
        layered = [c for _d, _s, c, _e in KM.PLAN[3]
                   if c.get(97) is None and c.get(ABILITY_DURING_CONTENT_COL) == "411"]
        gate = next(c for _d, _s, c, e in KM.PLAN[3] if "≥5(限1次)" in e)
        self.assertEqual(gate[100], "500000", "阈值 = 5 层")
        self.assertEqual(gate[102], "1", "limit 1 ⇒ 平坦门槛（写 (None) 才是按层成长）")
        grow = next(c for _d, _s, c, e in KM.PLAN[3] if "≥1[固有" in e and "全队(火)" in e)
        self.assertEqual(grow[102], "(None)", "按层无上限成长；留空串 = 上限 0，全程零收益")
        self.assertEqual(grow[104], KM.UID)
        del layered

    def test_during_134_rows_declare_the_unique_id(self):
        """during 134 的固有 id 列必须是本角色的固有（puller 契约在集成层按成品行复核）。"""
        seen = 0
        for slot in (2, 3):
            for _d, _s, cells, expect in KM.PLAN[slot]:
                if "状态累积计数固有" not in expect:
                    continue
                self.assertEqual(cells.get(104), KM.UID, expect)
                seen += 1
        self.assertEqual(seen, 4, "槽 2 两条按层加成 + 槽 3 两条独立乘区")

    def test_leader_rows_never_carry_dash_fever_or_713(self):
        for index, (_donor, _source, cells, _expect) in enumerate(KM.LEADER):
            for col in (LEADER_CONTENT_COL, LEADER_DURING_CONTENT_COL):
                value = cells.get(col)
                if value is not None:
                    self.assertNotIn(str(value), LEADER_FORBIDDEN_KINDS, f"leader#{index}")

    def test_dash_rows_live_in_the_ability_table_behind_the_leader_precondition(self):
        dash = [c for _d, _s, c, e in KM.PLAN[5] if "冲刺参数" in e]
        self.assertEqual(len(dash), 2, "常驻 CD 行 + 疾走抵消行")
        for cells in dash:
            self.assertEqual(cells.get(0), f"{KM.CODE}_5")
        # 422 的前置/param_id 来自 donor，行装配后由 _dash_problems 复核（见集成层）
        self.assertEqual(sorted(int(c[113]) for c in dash),
                         sorted((KM.DASH_PARAM0_BASE, KM.DASH_PARAM0_SWIFT)))
        for cells in dash:
            self.assertEqual(cells[113], cells[114], "满级单值，行拉平")

    def test_swift_offset_matches_the_cancellation_formula(self):
        """非 Swift 90×(1+s0) 帧 == Swift 中 20×(1+s0+m) 帧 ⇒ m = 3.5×(1+s0)。"""
        s0 = KM.DASH_PARAM0_BASE / 100000
        m = KM.DASH_PARAM0_SWIFT / 100000
        self.assertAlmostEqual(90 * (1 + s0), 20 * (1 + s0 + m), places=6)

    def test_722_row_is_gated_on_this_character_element_only(self):
        pf = next(c for _d, _s, c, e in KM.LEADER if "强化弹射覆盖" in e)
        self.assertEqual(pf[45], "722")
        self.assertEqual(pf[4], "2", "前置必须是编成门（官方 141201#1 先例）")
        self.assertEqual(pf[9], "Red", "门必须是本角色属性")
        self.assertEqual(pf[80], KM.PF_KEY)
        self.assertEqual(pf[81], "1,2,3")
        self.assertEqual(pf[82], KM.PF_STRING)
        self.assertEqual(len(KM.PF_PROGRAMS), 3)
        self.assertTrue(all(KM.PF_KEY in p for p in KM.PF_PROGRAMS))

    def test_all_rows_are_flattened_to_the_max_level_value(self):
        """作者总口径「全部都按照满级的描述」⇒ 强度两端相等。"""
        pairs = ((51, 52), (49, 50), (113, 114))
        for label, records in [("leader", [r[2] for r in KM.LEADER])] + \
                [(f"slot{s}", [r[2] for r in rs]) for s, rs in KM.PLAN.items()]:
            for cells in records:
                for lo, hi in pairs:
                    if lo in cells and hi in cells:
                        self.assertEqual(cells[lo], cells[hi], f"{label} c{lo}/c{hi}")

    def test_panel_strings_follow_the_batch_rules(self):
        for key, text in KM.CAS_TEXTS.items():
            for line in text.split("\n"):
                self.assertEqual(
                    KL.panel_problems(line.replace(KM.MAIN_ICON, ""),
                                      skill_flag=key in KM.SKILL_FLAG_TEXT_KEYS),
                    [], f"{key}: {line}")
        for value in KM.TEXTS.values():
            self.assertEqual(KL.panel_problems(value), [], value)

    def test_main_position_slot_override_carries_its_own_icon(self):
        """desc_override 把客户端逐行画的 Ⓜ 一起盖掉 ⇒ 主位键的覆盖文案必须自带图标。"""
        for slot in KM.SLOT_OVERRIDE_SLOTS:
            lines = KM.CAS_TEXTS[KM.SLOT_OVERRIDE[slot]].split("\n")
            wants = KM.PLAN[slot][0][2].get(1) == "false"
            for line in lines:
                self.assertEqual(line.startswith(KM.MAIN_ICON), wants, f"slot {slot}: {line}")

    def test_panel_override_line_counts_match_the_target_panel(self):
        counts = {KM.LEADER_OVERRIDE: 6, KM.SLOT_OVERRIDE[1]: 2,
                  KM.SLOT_OVERRIDE[2]: 1, KM.SLOT_OVERRIDE[3]: 5, KM.SLOT_OVERRIDE[5]: 2}
        for key, want in counts.items():
            self.assertEqual(len(KM.CAS_TEXTS[key].split("\n")), want, key)

    def test_energy_is_six_hundred_on_both_levels(self):
        self.assertEqual(KM.ENERGY["1"][:2], ("600", "600"))
        self.assertEqual(KM.ENERGY["2"][:2], ("600", "600"))
        self.assertEqual(KM.ENERGY["1"][0], KM.ENERGY["2"][0],
                         "官方 492 个双档技能的 c4 两档恒同值")

    def test_voice_route_avoids_the_always_on_change_skill_flag(self):
        self.assertEqual(KM.VOICE_ROUTE["kind"], 1,
                         "kind 3 会因 536 常驻而让 skill_ready 永不播")
        self.assertEqual(KM.VOICE_ROUTE["condition_id"], KM.UID)

    def test_cloned_effect_families_live_under_this_code_name(self):
        for subdir, src_dir, names in KM.FX_CLONES:
            self.assertTrue(src_dir.startswith("battle/effect/skill_unique/"), src_dir)
            self.assertNotIn(KM.CODE, src_dir, "克隆源必须是官方族")
            self.assertTrue(names)
        for path in (KM.ZETA_LANCE, KM.CLARISSE, KM.AURA):
            self.assertTrue(path.startswith(f"battle/effect/skill_unique/{KM.CODE}/"),
                            f"兄弟目录名会「进战斗数据不足」: {path}")
        self.assertTrue(KM.FLAME.startswith(f"battle/effect/skill_unique/{KM.TEMPLATE_CODE}/"),
                        "母本件不克隆 ⇒ 直接引用官方路径，图集零增量")

    def test_clarisse_tail_cut_constants(self):
        self.assertEqual(KM.CLARISSE_NEW_R, (1 << 30) | KM.CLARISSE_CUT)
        self.assertEqual(KM.CLARISSE_NEW_T, KM.CLARISSE_TOTAL - KM.CLARISSE_CUT)
        self.assertEqual(KM.CLARISSE_NEW_R >> 30, 1, "kind=1 播一次，末帧定格")

    def test_power_flip_carries_no_chase_knobs_any_more(self):
        """反馈轮 1：作者要求去掉强化弹射追踪 ⇒ 常量与文案都不许再出现。"""
        for name in ("CHASE_TAG", "CHASE_STEP", "CHASE_SPEED", "CHASE_SELECTOR",
                     "CHASE_BIND", "PF_EXTRA_FX", "ZETA_HIT", "ZETA_END"):
            self.assertFalse(hasattr(KM, name), f"{name} 应随追踪/方块特效一起删掉")
        for text in (KM.CAS_TEXTS[KM.PF_STRING], KM._SKILL_DESC,
                     KM.TEXTS["desc1"], KM.TEXTS["desc2"]):
            self.assertNotIn("追击", text, "行为删了文案不能留")

    def test_zeta_family_keeps_only_the_cone(self):
        """「只要锥形的效果黄色的小方框不要」：黄色六边形来自 hit/end 两族。"""
        lance = dict((sub, names) for sub, _src, names in KM.FX_CLONES)["lance"]
        self.assertEqual(tuple(lance), ("zeta_lance",))
        self.assertEqual(sorted(KM.PF_LANCE_SCALE), [1, 2, 3])
        tiers = [KM.PF_LANCE_SCALE[n] for n in (1, 2, 3)]
        self.assertEqual(tiers, sorted(tiers))
        self.assertLess(tiers[0], tiers[2], "三档靠锥形 scale 递增表达「逐渐增强」")

    def test_lance_points_along_the_ball(self):
        """EF = BallImpl.getDirEF() = 球的飞行角（官方 zeta$zeta_1 同写法）；AB 会恒定朝上。"""
        self.assertEqual(KM.PF_LANCE_COORD, ["EF"])

    def test_aura_ring_is_drawn_exactly_on_the_judgement_circle(self):
        """反馈轮 1「没有碰撞到的技能伤害」的根因：环比判定圆大 24%，外圈是纯装饰。"""
        for level in ("1", "2"):
            scale, radius, _mult = KM.AURA_TUNING[level]
            drawn = KM.AURA_RING_PX_PER_SCALE * scale / 2
            self.assertLess(abs(drawn - radius), 2.0,
                            f"lv{level} 画出来的环半径 {drawn:.1f} 必须等于判定半径 {radius}")
        self.assertLess(KM.AURA_TUNING["1"][0], 3.75, "作者要求「稍微小一点」")
        self.assertLess(KM.AURA_TUNING["2"][0], 5.00)
        for level in ("1", "2"):
            shrink = 1 - KM.AURA_TUNING[level][0] / {"1": 3.75, "2": 5.00}[level]
            self.assertTrue(0.10 <= shrink <= 0.25, f"lv{level} 缩了 {shrink:.1%}，越界就不是「稍微」")
        self.assertEqual(KM.AURA_RADIUS, {"1": 200, "2": 270}, "缩的是画面，判定强度不动")
        self.assertEqual(KM.AURA_MAX_HITS, 10, "每目标上限不动 ⇒ 单次技能总伤不变")
        self.assertLess(KM.AURA_HIT_INTERVAL, 600 / (KM.AURA_MAX_HITS - 0.5),
                        "母本 CalculatedUsingMaxNumOfHits(10) 推出来的 63 帧太稀，擦过就打不出第二跳")

    def test_deviations_are_registered(self):
        self.assertTrue(KM.DEVIATIONS)
        for item in KM.DEVIATIONS:
            self.assertEqual({"want", "got", "why"}, set(item))


def SPEC_KEYS() -> dict[str, tuple[str, ...]]:
    return dict(KM.SPEC["extra_keys"])


def _statue_groups() -> tuple[str, ...]:
    import wf_client_legality as L
    return tuple(L.ABILITY_STATUE_GROUPS)


class DesignDocumentTests(unittest.TestCase):
    """kit 常量必须与设计稿 plan_rework1 逐项一致（漂移会让 build 直接报错）。"""

    @classmethod
    def setUpClass(cls):
        path = (REPO / "work/character_packs/midautumn-20260920/design/magnus.json")
        if not path.is_file():
            raise unittest.SkipTest(f"design document absent: {path}")
        cls.design = json.loads(path.read_text(encoding="utf-8"))

    def test_kit_matches_the_design_document(self):
        self.assertEqual(KM._design_problems(self.design), [])

    def test_design_texts_match_the_kit(self):
        for key, value in KM.TEXTS.items():
            self.assertEqual(self.design["texts"][key], value, key)

    def test_first_round_design_is_kept_as_history_only(self):
        self.assertNotIn("plan", self.design, "旧 plan 必须移进 history，不得与 rework1 并存")
        self.assertIn("design_20260920", self.design.get("history", {}))


class InstallStagedAssetsTests(unittest.TestCase):
    """kitlib 的向后兼容小补丁：像素交付件若是标准 PNG，装包时换成 WF 存储态魔数。"""

    class _Pack:
        def __init__(self, batch_dir):
            self.batch_dir = Path(batch_dir)

    class _Ctx:
        def __init__(self, pack):
            self.pack = pack
            self.written = {}

        def write_asset(self, root, logical, data, owner=None):
            self.written[(root, logical)] = (data, owner)

    def _run(self, payload: bytes, logical: str):
        with tempfile.TemporaryDirectory() as tmp:
            batch = Path(tmp)
            staged = batch / "pixel" / "magnus"
            staged.mkdir(parents=True)
            (staged / "sheet.png").write_bytes(payload)
            (staged / "install.json").write_text(json.dumps(
                [{"root": "common", "logical": logical, "file": "sheet.png"}]), encoding="utf-8")
            ctx = self._Ctx(self._Pack(batch))
            result = KL.install_staged_assets(ctx, staged / "install.json")
            return ctx, result

    def test_standard_png_gets_the_store_signature(self):
        payload = b"\x89PNG\r\n\x1a\n" + b"rest-of-the-file"
        ctx, result = self._run(payload, "character/x/pixelart/sprite_sheet.png")
        data, owner = ctx.written[("common", "character/x/pixelart/sprite_sheet.png")]
        self.assertEqual(data, b"\x89png\r\n\x1a\n" + b"rest-of-the-file")
        self.assertEqual(owner, "pixel")
        self.assertTrue(result["installed"][0]["store_signature_applied"])

    def test_store_png_is_passed_through_untouched(self):
        payload = b"\x89png\r\n\x1a\n" + b"already-store"
        ctx, result = self._run(payload, "character/x/pixelart/sprite_sheet.png")
        data, _owner = ctx.written[("common", "character/x/pixelart/sprite_sheet.png")]
        self.assertEqual(data, payload)
        self.assertFalse(result["installed"][0]["store_signature_applied"])

    def test_non_png_payloads_are_untouched(self):
        payload = b"\x89PNG\r\n\x1a\nnot-really"
        ctx, _result = self._run(payload, "character/x/pixelart/pixelart.frame.amf3.deflate")
        data, _owner = ctx.written[("common", "character/x/pixelart/pixelart.frame.amf3.deflate")]
        self.assertEqual(data, payload)

    def test_missing_install_json_is_silently_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = self._Ctx(self._Pack(tmp))
            result = KL.install_staged_assets(ctx, Path(tmp) / "nope.json")
        self.assertFalse(result["present"])
        self.assertEqual(ctx.written, {})


# ---------------------------------------------------------------- 集成（只读）

class _ReadOnlyPack:
    """DSL 构建用得到的包口：只读已重建的 workspace（不存在时按「文件缺失」处理）。"""

    def __init__(self, batch_dir: Path):
        self.batch_dir = batch_dir

    def pkg_path(self, root: str, logical: str) -> Path:
        return WORKSPACE / "package/roots" / root / logical


class _ReadOnlyCtx:
    """kitlib.build_row / unique_row 与 kit 的 DSL 构建只用到这几个口，全部只读。"""

    def __init__(self):
        from wf_enhancement_policy import OfficialBaseline
        import wf_seasonal7_common as C
        self.root = core.project_root()
        self.spec = MS.get_spec("magnus", with_kit=False)
        self._baseline = OfficialBaseline(self.root / ".cdn/cn",
                                          cache_dir=self.root / "mod-tools/work/official-baseline",
                                          write_cache=False)
        self._store = core.resolve_profile().store
        self._cache: dict = {}
        self.walk = C.walk
        self.csv_split = core.read_csv_lines
        self._C = C
        self.pack = _ReadOnlyPack(self.root / "work/character_packs/midautumn-20260920")

    def official_read(self, logical: str, root: str | None = None):
        digest = core.sha1_path(logical)
        try:
            return self._baseline.get(root or "common", digest[:2] + "/" + digest[2:])
        except Exception:
            return None

    def official_flat(self, table: str) -> dict[str, str]:
        if ("o", table) not in self._cache:
            self._cache[("o", table)] = core.read_orderedmap_file_from_bytes(
                self.official_read(table))
        return self._cache[("o", table)]

    def live_flat(self, table: str) -> dict[str, str]:
        if ("s", table) not in self._cache:
            self._cache[("s", table)] = core.load_table(table, self._store).text_rows()
        return self._cache[("s", table)]

    template_flat = official_flat
    pkg_flat = official_flat

    def template_dsl(self, program: str):
        logical = program if program.endswith(".deflate") else wf_dsl.dsl_logical(program)
        raw = self.official_read(logical)
        if raw is None:
            raise AssertionError(f"official baseline lacks {logical}")
        return wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"]

    def rewrite_effect_refs(self, tree, family, *, strict: bool = False):
        return self._C.rewrite_effect_refs(tree, family, strict=strict)

    def program_path(self, level: str) -> str:
        import wf_seasonal7_tables as T
        return T.program_path(self.spec, level)


def _stub_families() -> dict[str, dict]:
    """``clone_effect_family`` 的返回形状里 ``rewrite_effect_refs`` 真正用到的那几个键。"""
    out = {}
    for subdir, src_dir, names in KM.FX_CLONES:
        donor = src_dir.rsplit("/", 1)[-1]
        out[subdir] = {"src_dir": src_dir,
                       "dst_dir": f"battle/effect/skill_unique/{KM.CODE}/{subdir}",
                       "donor": donor, "dst_name": subdir,
                       "copied_bases": list(names)}
    return out


@unittest.skipUnless(_LIVE, "requires live store and .cdn/cn official archives")
class RowIntegrationTests(unittest.TestCase):
    """用 kitlib 的真实代码路径回放全部行：donor 漂移 / 列改动写错 / 描述器漂移都会红。"""

    @classmethod
    def setUpClass(cls):
        cls.ctx = _ReadOnlyCtx()

    def _leader_rows(self):
        return [KL.build_row(self.ctx, "leader_ability", d, c, source=s, element=0,
                             expect_describe=e, label=f"L{i}")[0]
                for i, (d, s, c, e) in enumerate(KM.LEADER)]

    def _ability_rows(self, slot):
        return [KL.build_row(self.ctx, "ability", d, c, source=s, element=0,
                             expect_describe=e, label=f"{KM.CID}{slot}#{i}")[0]
                for i, (d, s, c, e) in enumerate(KM.PLAN[slot])]

    def test_leader_rows_build_and_render_as_designed(self):
        for index, (donor, source, cells, expect) in enumerate(KM.LEADER):
            with self.subTest(leader=index):
                row, evidence = KL.build_row(self.ctx, "leader_ability", donor, cells,
                                             source=source, element=0,
                                             expect_describe=expect, label=f"L{index}")
                self.assertEqual(len(row), KL.LEADER_NCOLS)
                self.assertEqual(row[0], KM.CODE)
                self.assertEqual(evidence["describe"], expect)
        KM._leader_forbidden(self._leader_rows())

    def test_ability_rows_build_and_pass_the_key_contract(self):
        for slot in KM.PLAN:
            rows = self._ability_rows(slot)
            for row in rows:
                self.assertEqual(len(row), KL.ABILITY_NCOLS)
            KL.check_ability_key(rows, f"{KM.CID}{slot}", KM.CODE, slot)

    def test_slot3_order_contract_holds_on_the_built_rows(self):
        rows = self._ability_rows(3)
        KM._order_problems(rows)                       # 顺序或 CT 不一致会抛
        kinds = [row[ABILITY_CONTENT_COL] for row in rows]
        self.assertLess(kinds.index("629"), kinds.index("525"))

    def test_slot5_dash_contract_holds_on_the_built_rows(self):
        rows = self._ability_rows(5)
        KM._dash_problems(rows)                        # 前置 42 / param_id / 抵消公式
        dash = [r for r in rows if r[ABILITY_DURING_CONTENT_COL] == "422"]
        self.assertEqual(len(dash), 2)
        for row in dash:
            self.assertEqual(row[6], "42", "422 只在他当队长时生效，靠前置 42 隔离")
            self.assertEqual(row[118], "0", "param_id 0 必须显式写，留空 = 声明即必填闸门报错")

    def test_during_134_puller_contract_on_the_built_rows(self):
        """换 kind 必须重查 puller，否则 parseAt98 → 角色页 C7050。"""
        seen = 0
        for slot in (2, 3):
            for row in self._ability_rows(slot):
                if row[97] != "134":
                    continue
                self.assertEqual(row[98], "0", f"slot {slot} during 134 puller")
                self.assertEqual(row[104], KM.UID)
                seen += 1
        self.assertEqual(seen, 4)

    def test_unique_condition_row(self):
        key, row = KL.unique_row(self.ctx, self.ctx.spec, 1, KM.UNIQUE_DONOR,
                                 KM.UNIQUE_CELLS, name=KM.UNIQUE_NAME)
        self.assertEqual(key, KM.UID)
        self.assertEqual(len(row), KL.UNIQUE_NCOLS)
        self.assertEqual(row[1], KM.UNIQUE_NAME)
        self.assertEqual(row[2], KM.UC_ICON_ROW)
        self.assertEqual(row[3], KM.UNIQUE_FRAMES)
        self.assertEqual(row[4], KM.UNIQUE_CAP)
        self.assertEqual(row[14], KM.CODE, "PF 语音独占 code = 自身")

    def test_only_the_dash_rows_need_a_client_patch(self):
        caps = set()
        for slot, records in KM.PLAN.items():
            for donor, source, cells, _expect in records:
                _row, evidence = KL.build_row(self.ctx, "ability", donor, cells,
                                              source=source, element=0)
                caps.update(evidence["capabilities"])
        for donor, source, cells, _expect in KM.LEADER:
            _row, evidence = KL.build_row(self.ctx, "leader_ability", donor, cells,
                                          source=source, element=0)
            caps.update(evidence["capabilities"])
        self.assertEqual(sorted(caps), ["dash-parameter-v1"])
        self.assertIn("panel-description-override-v2", KM.SPEC["required_capabilities"])

    def test_custom_ability_string_keys_are_free_officially(self):
        official = self.ctx.official_flat(KL.CAS)
        for key in KM.CAS_TEXTS:
            self.assertNotIn(key, official)


@unittest.skipUnless(_LIVE, "requires live store and .cdn/cn official archives")
class SkillTreeIntegrationTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.ctx = _ReadOnlyCtx()
        cls.families = _stub_families()

    def _effects(self, tree):
        return list(wf_dsl.iter_dsl_commands(tree, "ShowEffect"))

    def _assert_no_cd_coordsys(self, tree):
        """CD 的 getDirCD() 在球/敌人/角色上都是 throw ⇒ U_4f5401。

        EF 只有 Mate(-33) 会抛：``BallImpl.getDirEF()`` 返回球的飞行角，
        官方赛达 ``zeta$zeta_1`` 就是 ``(-18, ["EF"])``，所以球上允许 EF。
        """
        for show in self._effects(tree):
            self.assertIn(show[6][0], ("AB", "GH", "EF"), show[1])
            if show[3] in (-18,) or show[3] >= 0:
                self.assertNotEqual(show[6][0], "CD", show[1])
            if show[3] == -33:
                self.assertIn(show[6][0], ("AB", "GH"), show[1])

    def test_main_tree_merges_the_aura_ring(self):
        for level in ("1", "2"):
            with self.subTest(level=level):
                tree, meta = KM.build_main_tree(self.ctx, level, self.families)
                self.assertEqual(tree[10], 0, "根头 buffTargetAs=0 ⇒ 按技能伤害结算")
                ids = KM._declared_ids(tree)
                self.assertEqual(len(ids), len(set(ids)))
                self.assertEqual(sorted(ids), [0, 1, 2, 3, 4, 5, *KM.AURA_BINDS])
                scale, radius, mult = KM.AURA_TUNING[level]
                self.assertEqual(meta["aura"], {
                    "scale": scale, "radius": radius, "multiplier": mult,
                    "ring_diameter_px": round(KM.AURA_RING_PX_PER_SCALE * scale, 1),
                    "hit_interval": KM.AURA_HIT_INTERVAL, "max_hits": KM.AURA_MAX_HITS,
                    "lifetime": KM.AURA_FRAMES, "binds": list(KM.AURA_BINDS)})
                self.assertEqual(wf_dsl.player_side_dsl_problems(tree), [])
                self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree)
                self._assert_no_cd_coordsys(tree)

    def test_main_tree_keeps_the_template_slash_untouched(self):
        expected = {"1": 28.0, "2": 42.0}
        for level in ("1", "2"):
            _tree, meta = KM.build_main_tree(self.ctx, level, self.families)
            self.assertEqual(float(meta["slash"]["max"]), expected[level])
            self.assertEqual(meta["slash"]["alv_min"], 1.75)
            self.assertEqual(meta["slash"]["alv_max"], 3.5)

    def test_enhanced_form_really_widens_the_ring(self):
        low, high = KM.AURA_TUNING["1"], KM.AURA_TUNING["2"]
        self.assertGreater(high[0], low[0], "536 换形态后光环范围必须真的变大")
        self.assertGreater(high[1], low[1])
        self.assertGreater(high[2], low[2])

    def test_aura_block_drops_the_element_tolerance_and_foreign_hit_effect(self):
        tree, _meta = KM.build_main_tree(self.ctx, "2", self.families)
        area = next(a for a in wf_dsl.iter_dsl_commands(tree, "CreateHitArea")
                    if a[19] == KM.AURA_BINDS[0])
        self.assertEqual(area[24], 0, "写 4 = 按直击算，整块乘区被跳过")
        self.assertEqual(
            [c[0] for c in wf_dsl.iter_dsl_commands(area[23], "CreateCondition")], [],
            "目标面板没有火耐性↓这一条")
        cna = next(iter(wf_dsl.iter_dsl_commands(area[23], "CreateNormalAttack")))
        self.assertEqual(cna[15], ["Fine"], "命中特效用引擎内置件 ⇒ 只需克隆 _aura")
        self.assertEqual(cna[1], KM.AURA_BINDS[2])

    def test_aura_block_is_the_official_block_except_for_the_listed_knobs(self):
        """「碰到光圈不掉血」的排查基线：逐参对齐官方魏虎原块，只允许这几格不同。

        允许不同的格（都写在 kit 常量里）：p9 判定圆、p13 寿命、p14 命中间隔、p15 每目标上限、
        p19/p21/p22 绑定 id、p23 命中块（去掉火耐性行 + 换倍率/命中特效）。
        其余 19 格（尤其是 p2 挂球、p7 跟随球、p24 伤害归属 0）一格都不许漂。
        """
        donor = self.ctx.template_dsl(KM.AURA_DONOR)
        official = next(c for c in wf_dsl.iter_dsl_commands(donor, "CreateHitArea")
                        if c[2] == -18)
        tunable = {9, 13, 14, 15, 19, 21, 22, 23}
        for level in ("1", "2"):
            tree, _meta = KM.build_main_tree(self.ctx, level, self.families)
            area = next(a for a in wf_dsl.iter_dsl_commands(tree, "CreateHitArea")
                        if a[19] == KM.AURA_BINDS[0])
            self.assertEqual(len(area), len(official), "26 参判定区的参数个数必须一致")
            for index in range(len(official)):
                if index in tunable:
                    continue
                self.assertEqual(area[index], official[index],
                                 f"lv{level} 判定区 p{index} 漂了：{area[index]!r}")
            self.assertEqual(area[2], -18, "判定区挂球")
            self.assertEqual(area[3], ["AB"])
            self.assertEqual(area[7], True, "trackingPos：每帧重取球的位置")
            self.assertEqual(area[24], 0, "0 = 按 createdBy 标志算 ⇒ 技能伤害")
            self.assertEqual(area[13], ["SpecifyHitAreaLifetimeDirectly", KM.AURA_FRAMES])
            self.assertEqual(area[14], ["SpecifyMinHitIntervalDirectly", KM.AURA_HIT_INTERVAL])
            self.assertEqual(area[15], ["Some", [{"min": KM.AURA_MAX_HITS,
                                                  "max": KM.AURA_MAX_HITS}]])
            self.assertEqual(area[9], ["Circle", [{"min": KM.AURA_RADIUS[level],
                                                   "max": KM.AURA_RADIUS[level]}]])
            hits = [c[1][0] for c in area[23][1]]
            self.assertEqual(hits, ["ShakeCamera", "CreateNormalAttack"],
                             "命中块只剩摄像机抖 + 一发技能伤害")
            self.assertEqual(area[23][1][1][1][1], area[22],
                             "CNA 的目标位必须是判定区 p22 绑定，否则 lookup 拿不到被打中的敌人")
            ring = next(s for s in self._effects(tree) if s[1] == "aura_ring")
            self.assertEqual((ring[3], ring[6]), (-18, ["AB"]), "光圈挂球、绝对坐标（官方原样）")
            self.assertEqual(ring[5], ["SpecifyEffectLifetimeDirectly", KM.AURA_FRAMES],
                             "演出寿命必须与判定区寿命同值，否则看得见的环比判定活得久")
            drawn = KM.AURA_RING_PX_PER_SCALE * ring[12][1][0]["max"] / 2
            self.assertLess(abs(drawn - KM.AURA_RADIUS[level]), 2.0,
                            "环画出来的半径必须等于判定半径")

    def test_main_tree_only_references_official_or_cloned_effects(self):
        for level in ("1", "2"):
            tree, _meta = KM.build_main_tree(self.ctx, level, self.families)
            paths = {str(s[2][1]) for s in self._effects(tree)}
            self.assertIn(KM.AURA, paths)
            for path in paths:
                self.assertTrue(
                    path.startswith(f"battle/effect/skill_unique/{KM.TEMPLATE_CODE}/")
                    or path.startswith(f"battle/effect/skill_unique/{KM.CODE}/"), path)

    def test_chase_tree(self):
        tree, meta = KM.build_chase_tree(self.ctx, self.families)
        self.assertEqual(tree[10], 0, "629 以 AbilitySkill 执行 ⇒ 自动按技能伤害结算")
        attacks = list(wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack"))
        self.assertEqual(len(attacks), 1)
        self.assertEqual((attacks[0][6][0]["min"], attacks[0][6][0]["max"]),
                         (KM.CHASE_MULT, KM.CHASE_MULT))
        names = sorted(show[1] for show in self._effects(tree))
        self.assertEqual(names, ["ignite_aura", "ignite_burst"])
        aura = next(s for s in self._effects(tree) if s[1] == "ignite_aura")
        self.assertEqual(aura[2][1], KM.FLAME, "球身光环留母本件，图集零增量")
        self.assertEqual(aura[5], ["PlayOnlyFirstSequence"], "母本 _flame 是 once/70 帧")
        burst = next(s for s in self._effects(tree) if s[1] == "ignite_burst")
        self.assertEqual(burst[2][1], KM.CLARISSE)
        self.assertEqual(burst[5], ["SpecifyEffectLifetimeDirectly", KM.CLARISSE_NEW_T])
        self.assertEqual(burst[12], ["Some", [{"min": KM.BURST_SCALE, "max": KM.BURST_SCALE}]])
        self.assertEqual(meta["burst_radius"], KM.BURST_RADIUS)
        self.assertEqual(wf_dsl.player_side_dsl_problems(tree), [])
        self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree)
        self._assert_no_cd_coordsys(tree)

    def test_chase_burst_is_pinned_to_the_hit_point(self):
        tree, _meta = KM.build_chase_tree(self.ctx, self.families)
        points = list(wf_dsl.iter_dsl_commands(tree, "CreateReferencePoint"))
        self.assertTrue(points, "爆炸必须挂在命中那一帧快照出来的固定点上，否则跟着球跑")
        self.assertTrue(any(p[1] == -18 and p[2] == ["AB"] for p in points))
        radii = sorted(a[9][1][0]["max"] for a in wf_dsl.iter_dsl_commands(tree, "CreateHitArea"))
        self.assertIn(KM.BURST_RADIUS, radii)

    def test_power_flip_trees(self):
        for level in (1, 2, 3):
            with self.subTest(level=level):
                raw = self.ctx.official_read(wf_dsl.dsl_logical(KM.SPECIAL_PROGRAMS[level]))
                self.assertEqual(hashlib.sha256(raw).hexdigest(), KM.SPECIAL_SHA[level],
                                 "官方 special 底座漂移 ⇒ 倍率要重算")
                tree, meta = KM.build_pf_tree(self.ctx, level, self.families)
                self.assertEqual(tree[1], 1, "追踪树不带 StopBall ⇒ 优先级保持 1")
                self.assertEqual(tree[10], 0)
                suppress = list(wf_dsl.iter_dsl_commands(tree, "SetPowerFilpSuppress"))
                self.assertEqual(suppress[0][1], KM.PF_SUPPRESS)
                self.assertTrue(list(wf_dsl.iter_dsl_commands(tree, "NotifyPowerflipEnd")),
                                "空场也一定要收尾，否则 PF 卡死")
                for area in wf_dsl.iter_dsl_commands(tree, "CreateHitArea"):
                    self.assertEqual(area[24], 0)
                    self.assertEqual(area[9][1][0]["max"], KM.BURST_RADIUS)
                self.assertEqual(wf_dsl.player_side_dsl_problems(tree), [])
                self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree)
                self._assert_no_cd_coordsys(tree)
                self.assertIsNone(meta["chase"], "反馈轮 1：不再追踪 boss")

    def test_power_flip_keeps_the_native_trajectory(self):
        """去追踪：弹道必须回到官方 special 底座（删判定用的反向断言）。"""
        for level in (1, 2, 3):
            tree, meta = KM.build_pf_tree(self.ctx, level, self.families)
            base = self.ctx.template_dsl(KM.SPECIAL_PROGRAMS[level])
            for name in ("MoveBall", "FindNearSubjects", "RemoveEvent", "Repeat"):
                # 底座自带一条 RemoveEvent("ヒット判定") ⇒ 判据是与底座同名同数
                self.assertEqual(len(list(wf_dsl.iter_dsl_commands(tree, name))),
                                 len(list(wf_dsl.iter_dsl_commands(base, name))),
                                 f"lv{level} 的 {name} 条数与官方底座不一致")
            self.assertEqual([n for n in tree[11][1]
                              if n[0] == "Event" and n[1][0] == "Repeat"], [])
            self.assertEqual(meta["extra_effects"], [])
            base = self.ctx.template_dsl(KM.SPECIAL_PROGRAMS[level])
            self.assertEqual([n[1][0] if n[0] == "Command" else n[1][0] for n in tree[11][1]],
                             [n[1][0] if n[0] == "Command" else n[1][0] for n in base[11][1]],
                             f"lv{level} root 命令序列必须和官方底座逐条对齐")

    def test_power_flip_tiers_are_one_cone_that_grows(self):
        totals, fx, scales = [], [], []
        for level in (1, 2, 3):
            tree, meta = KM.build_pf_tree(self.ctx, level, self.families)
            totals.append(meta["total"])
            fx.append({str(s[2][1]) for s in self._effects(tree)})
            lance = [s for s in self._effects(tree) if str(s[2][1]) == KM.ZETA_LANCE]
            self.assertEqual(len(lance), 1, "只留一层锥形")
            self.assertEqual(lance[0][3], -18)
            self.assertEqual(lance[0][6], ["EF"], "朝球的飞行方向，AB 会恒定朝上")
            scales.append(lance[0][12][1][0]["max"])
            del tree
        self.assertEqual(totals, sorted(totals), "三档逐渐增强")
        self.assertEqual(scales, [KM.PF_LANCE_SCALE[n] for n in (1, 2, 3)])
        self.assertEqual(scales, sorted(scales))
        self.assertEqual(fx[0], fx[1], "不再按档位叠加别的基名")
        self.assertEqual(fx[1], fx[2])
        for names in fx:
            self.assertEqual(names, {KM.ZETA_LANCE, KM.CLARISSE},
                             "黄色小方框（zeta_lance_hit/_end）不许再出现")
        self.assertIn(KM.ZETA_LANCE, fx[0])


@unittest.skipUnless(PKG_COMMON.is_dir(), "requires a rebuilt ma-magnus workspace")
class PackageIntegrationTests(unittest.TestCase):
    """成品包层：PF 三档、克隆族、克拉莉丝裁段都真的落进了包（漏建本体树会静默用旧版）。"""

    @classmethod
    def setUpClass(cls):
        import wf_seasonal7_common as C
        cls.C = C

    def _tree(self, program: str):
        return self.C.amf_parse((PKG_COMMON / wf_dsl.dsl_logical(program)).read_bytes())

    def test_power_flip_action_row_points_at_the_three_programs(self):
        table = core.read_orderedmap_file_from_bytes(
            (PKG_COMMON / KM.PFA).read_bytes())
        self.assertIn(KM.PF_KEY, table)
        row = list(core.read_csv_lines(table[KM.PF_KEY]))[0]
        self.assertEqual(list(row), list(KM.PF_PROGRAMS))

    def test_all_six_trees_are_in_the_package(self):
        for program in (*(f"battle/action/skill/action/rare5/{KM.CODE}${KM.CODE}_{n}"
                          for n in (1, 2)), KM.CHASE_PROGRAM, *KM.PF_PROGRAMS):
            self.assertTrue((PKG_COMMON / wf_dsl.dsl_logical(program)).is_file(), program)

    def test_cloned_effect_families_are_in_the_package(self):
        for subdir, _src, names in KM.FX_CLONES:
            base = PKG_COMMON / f"battle/effect/skill_unique/{KM.CODE}/{subdir}"
            self.assertTrue((base / f"{subdir}.png").is_file(), subdir)
            self.assertTrue((base / f"{subdir}.atlas.amf3.deflate").is_file(), subdir)
            for name in names:
                self.assertTrue((base / f"{name}.parts.amf3.deflate").is_file(), name)

    def test_clarisse_only_plays_its_end_burst(self):
        base = PKG_COMMON / f"battle/effect/skill_unique/{KM.CODE}/burst"
        parts = self.C.amf_parse((base / "clarisse.parts.amf3.deflate").read_bytes())
        timeline = self.C.amf_parse((base / "clarisse.timeline.amf3.deflate").read_bytes())
        keyframe = parts["g"][0]["s"][0]["l"][0]
        self.assertEqual(int(keyframe["r"]), KM.CLARISSE_NEW_R)
        self.assertEqual(int(keyframe["t"]), KM.CLARISSE_NEW_T)
        self.assertEqual(int(parts["g"][0]["t"]), KM.CLARISSE_NEW_T)
        self.assertEqual(int(timeline["sequences"][0]["end"]), KM.CLARISSE_NEW_T)
        self.assertEqual(timeline["sequences"][0]["begin"], 1)
        self.assertGreater(len(parts["g"]), 1, "g[1] 及以下一个字节都不许改")

    def test_package_trees_reference_only_paths_that_exist(self):
        for program in (f"battle/action/skill/action/rare5/{KM.CODE}${KM.CODE}_2",
                        KM.CHASE_PROGRAM, KM.PF_PROGRAMS[2]):
            tree = self._tree(program)
            for show in wf_dsl.iter_dsl_commands(tree, "ShowEffect"):
                path = str(show[2][1])
                if not path.startswith(f"battle/effect/skill_unique/{KM.CODE}/"):
                    continue
                self.assertTrue(
                    (PKG_COMMON / f"{path}.parts.amf3.deflate").is_file()
                    or (PKG_COMMON / f"{path}.timeline.amf3.deflate").is_file(), path)


if __name__ == "__main__":
    unittest.main()
