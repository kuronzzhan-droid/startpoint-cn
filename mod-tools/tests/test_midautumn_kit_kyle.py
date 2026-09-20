# -*- coding: utf-8 -*-
"""凯尔 kit（139990 ``kyle_moon``）rework1：行计划自查 + 行装配 + DSL 门禁。

三组用例：

1. **纯静态**（不需要 live / 官方基线）：模块常量与 ``design/kyle.json`` 的互锁、
   裁决 §8 的自查（队长表禁 422/724/713、422 必挂前置 42 且 c118 非空、前置 kind 白名单、
   固有 ID 8 位且上限非 ``(None)``、629 必配字符串键且排在读它的计数行之后、
   面板文案逐行对齐 ``rework1/panel/kyle.json``、面板禁词），以及本模块的小工具
   （判定区/CNA 改格、绑定号平移、图标绘制）。
2. **官方基线**（缺 ``.cdn/cn`` 或 live store 时跳过）：4＋23 行逐行装配并与 ``EXPECT``
   的 ``wf_describe`` 回读逐字比对；两棵主技能树与两棵 629 追击树的装配与全部 DSL 门禁
   （元素、主体绑定、判定区归属、方向、坐标系），母本漂移断言。
3. **已构建的 workspace**（``work/character_packs/ma-kyle`` 不存在时跳过）：包内自有键、
   4 棵 DSL 程序、三个固有状态与图标、三族特效、``custom_ability_string`` 10 键。

不写 live store / ``assets/`` / ``.cdn``，不跑发布；官方基线只读。
"""
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_client_legality as L  # noqa: E402
import wf_dsl  # noqa: E402
import wf_midautumn_common as MC  # noqa: E402
import wf_midautumn_kit_kyle as K  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_mod_tool as core  # noqa: E402
import wf_seasonal7_build as B  # noqa: E402

ROOT = core.project_root()
DESIGN = MS.load_design(ROOT, "kyle")
WORKSPACE = ROOT / "work/character_packs/ma-kyle"
PANEL = ROOT / "work/character_packs/midautumn-20260920/rework1/panel/kyle.json"


def _baseline_available() -> bool:
    profile = core.resolve_profile()
    return profile is not None and profile.store.is_dir() and (ROOT / ".cdn" / "cn").is_dir()


_BASELINE = _baseline_available()
_CTX = None


def ctx():
    """只读上下文：``record_sources=False`` ⇒ 母本取数不写 workspace（框架 §10.2）。"""
    global _CTX
    if _CTX is None:
        _CTX = B.KitContext(MC.MAPack(MS.get_spec("kyle"), record_sources=False))
    return _CTX


def fake_family(src_dir: str, dst_dir: str, sub: str, donor: str, bases: list[str]) -> dict:
    return {"src_dir": src_dir, "dst_dir": dst_dir, "donor": donor,
            "dst_name": sub, "copied_bases": list(bases)}


def blade_family() -> dict:
    return fake_family(K.FX_BLADE_SRC, K.FX_BLADE_DST, K.FX_BLADE_SUB, K.TEMPLATE_CODE,
                       [f"{K.TEMPLATE_CODE}_slash", f"{K.TEMPLATE_CODE}_smash",
                        f"{K.TEMPLATE_CODE}_explosion"])


def bolt_family() -> dict:
    return fake_family(K.FX_BOLT_SRC, K.FX_BOLT_DST, K.FX_BOLT_SUB, K.FX_BOLT_TEMPLATE,
                       [f"{K.FX_BOLT_TEMPLATE}_start", f"{K.FX_BOLT_TEMPLATE}_shock",
                        f"{K.FX_BOLT_TEMPLATE}_shock_ground", f"{K.FX_BOLT_TEMPLATE}_hit"])


def trail_family() -> dict:
    return fake_family(K.FX_TRAIL_SRC, K.FX_TRAIL_DST, K.FX_TRAIL_SUB, K.FX_TRAIL_TEMPLATE,
                       [K.FX_TRAIL_BASE])


def all_rows(context) -> dict:
    return K.build_rows(context)


# ---------------------------------------------------------------- 1. 纯静态

class ConstantTests(unittest.TestCase):
    def test_identity_matches_the_registry(self):
        spec = MS.SPECS["kyle"]
        self.assertEqual((K.CID, K.CODE, K.ELEMENT), (spec.cid, spec.code, spec.element))
        self.assertEqual((K.TEMPLATE_ID, K.TEMPLATE_CODE),
                         (spec.template_id, spec.template_code))

    def test_element_is_not_colorless(self):
        # element=6 是敌专属 Colorless，可玩角色写 6 会 C7050（记忆 wf-element6-colorless-crash）
        self.assertEqual(K.ELEMENT, 2)
        self.assertEqual(K.ELEMENT_TOKEN, "Yellow")

    def test_unique_condition_ids_are_eight_digits_and_distinct(self):
        keys = [key for key, *_ in K.UNIQUES]
        self.assertEqual(len(set(keys)), 3)
        for key in keys:
            self.assertEqual(len(key), 8, key)
            self.assertTrue(key.startswith(str(K.CID)), key)

    def test_unique_cap_is_never_none(self):
        # c4 写 (None) ＝ 上限 1，during 134 / vlv 成长会全死（记忆 wf-unique-cap-none-trap）
        for _key, _sid, _name, cap, frames, _style in K.UNIQUES:
            self.assertNotIn(cap, ("", "(None)"))
            self.assertTrue(cap.isdigit(), cap)
            self.assertTrue(frames.isdigit(), frames)

    def test_spec_declares_every_self_owned_key(self):
        extra = K.SPEC["extra_keys"]
        self.assertEqual(set(extra[MS.UNIQUE_CONDITION_LOGICAL]),
                         {key for key, *_ in K.UNIQUES})
        self.assertEqual(set(extra[KL.CAS]), set(K.CAS_TEXTS))
        self.assertEqual(len(extra[KL.CAS]), 10)

    def test_required_capabilities_cover_dash_and_panel_override(self):
        self.assertEqual(set(K.SPEC["required_capabilities"]),
                         {"dash-parameter-v1", "panel-description-override-v2"})

    def test_ability_keys_are_the_six_slots(self):
        self.assertEqual(K.ABILITY_KEYS, tuple(f"{K.CID}{n}" for n in range(1, 7)))
        self.assertEqual(sorted(K.PLAN), [1, 2, 3, 4, 5, 6])


class PlanSelfCheckTests(unittest.TestCase):
    """不碰基线，只看 PLAN/LEADER 里写死的列值本身是否踩线。"""

    def ability_cells(self, slot: int):
        for _addr, _src, cells, _expect in K.PLAN[slot]:
            yield cells

    def test_leader_plan_writes_no_dash_fever_or_independent_multiplier_kinds(self):
        # LeaderAbilityValues.parseAt107 没打补丁 ⇒ 队长表写 422/724/713 = 角色页 C7050
        for _addr, _src, cells, _expect in K.LEADER:
            self.assertNotIn(cells.get(107), ("422", "724", "713"))

    def test_dash_rows_are_leader_gated_and_carry_a_param_id(self):
        dash = [cells for cells in self.ability_cells(5) if cells.get(118)]
        self.assertEqual(len(dash), 3, "冲刺参数应当是 3 条（CD / 弹射速度 / 可发动高度）")
        ids = sorted(cells["118"] if "118" in cells else cells[118] for cells in dash)
        self.assertEqual(ids, ["0", "1", "6"])
        for cells in dash:
            self.assertEqual(cells.get(6), "42", "422 行必须挂前置 42（持有者为队长）")

    def test_invoke_rows_declare_both_a_string_key_and_a_program(self):
        for slot, rows in K.PLAN.items():
            for addr, _src, cells, _expect in rows:
                if cells.get(71):
                    self.assertTrue(cells.get(70), f"{slot} {addr}: 629 行缺字符串键 c70")
                    self.assertEqual(cells.get(35), "0", f"{slot} {addr}: 629 的 CT 不能留空")

    def test_invoke_programs_live_under_the_ability_skill_namespace(self):
        for program in (K.PIERCE_PROGRAM, K.THUNDER_PROGRAM):
            self.assertIn("/ability_skill/", program)
            self.assertIn("$", program)

    def test_only_the_main_only_slot_hosts_629(self):
        # 629 在副位不生效 ⇒ 宿主键必须 unisonable=false
        for slot, rows in K.PLAN.items():
            if any(cells.get(71) for _a, _s, cells, _e in rows):
                self.assertEqual(K._UNISONABLE[slot], "false", slot)

    def test_precondition_kinds_stay_inside_the_vetted_set(self):
        for _addr, _src, cells, _expect in K.LEADER:
            for col in (4, 11, 18):
                self.assertIn(str(cells.get(col, "")), K.ALLOWED_PRECONDITION_KINDS + ("",))
        for slot, rows in K.PLAN.items():
            for addr, _src, cells, _expect in rows:
                for col in (6, 13, 20):
                    value = str(cells.get(col, ""))
                    self.assertIn(value, K.ALLOWED_PRECONDITION_KINDS + ("",),
                                  f"{slot} {addr} c{col}")

    def test_condition_unique_preconditions_name_a_unique_and_a_puller(self):
        # 手拼前置 187/188 漏 c7='0' 会 C7050；固有 id 列留空同样会崩
        owned = {key for key, *_ in K.UNIQUES}
        for slot, rows in K.PLAN.items():
            for addr, _src, cells, _expect in rows:
                if cells.get(6) == "187":
                    self.assertEqual(cells.get(7), "0", f"{slot} {addr}: 前置 187 缺 c7 puller")
                    self.assertIn(cells.get(12), owned, f"{slot} {addr}: 前置 187 的固有 id")

    def test_no_precondition_188_or_144(self):
        # 188 数的是实例个数（461 叠层恒为 1），144 官方零先例（裁决 §8）
        for slot, rows in K.PLAN.items():
            for _addr, _src, cells, _expect in rows:
                for col in (6, 13, 20):
                    self.assertNotIn(str(cells.get(col, "")), ("188", "144"), slot)

    def test_unlimited_growth_rows_write_none_not_an_empty_limit(self):
        # during 134 的 limit 留空 = 上限 0（词条全程零收益，面板出「上限 0 次」）
        for _addr, _src, cells, _expect in K.LEADER:
            if cells.get(95) == "134" or cells.get(102):
                self.assertNotEqual(cells.get(100), "")
        for slot, rows in K.PLAN.items():
            for addr, _src, cells, _expect in rows:
                if cells.get(104):
                    self.assertEqual(cells.get(102), "(None)", f"{slot} {addr}")

    def test_unique_references_point_at_our_own_ids(self):
        owned = {key for key, *_ in K.UNIQUES}
        for slot, rows in K.PLAN.items():
            for addr, _src, cells, _expect in rows:
                for col in (12, 68, 104):
                    value = cells.get(col)
                    if value and str(value).isdigit() and len(str(value)) == 8:
                        self.assertIn(value, owned, f"{slot} {addr} c{col}")


class PanelTextTests(unittest.TestCase):
    def test_panel_text_obeys_the_project_rules(self):
        KL.check_panel(K.PANEL_LEADER, label="leader")
        for slot, text in K.PANEL_ABILITY.items():
            KL.check_panel(text, label=f"ability {slot}")
        KL.check_panel(K.CAS_TEXTS[K.CAS_SWITCH], skill_flag=True, label="change_skill")

    def test_panel_text_matches_the_author_approved_target(self):
        """逐行对齐 ``rework1/panel/kyle.json``：那是作者已过目并放行的目标面板。"""
        if not PANEL.is_file():
            self.skipTest("rework1/panel/kyle.json missing")
        panel = json.loads(PANEL.read_text(encoding="utf-8"))
        want_leader = [line["text"] for line in panel["leader"]["lines"]]
        self.assertEqual(K.PANEL_LEADER.split("／"), want_leader)
        for entry in panel["abilities"]:
            slot = int(entry["index"])
            self.assertEqual(K.PANEL_ABILITY[slot].split("／"),
                             [line["text"] for line in entry["lines"]], f"ability {slot}")

    def test_main_only_slot_matches_the_panel(self):
        if not PANEL.is_file():
            self.skipTest("rework1/panel/kyle.json missing")
        panel = json.loads(PANEL.read_text(encoding="utf-8"))
        for entry in panel["abilities"]:
            slot = int(entry["index"])
            self.assertEqual(K._UNISONABLE[slot] == "false", bool(entry["main_only"]),
                             f"ability {slot} 的主位限制与面板不符")

    def test_skill_energy_matches_the_panel(self):
        if not PANEL.is_file() or not DESIGN:
            self.skipTest("panel or design missing")
        panel = json.loads(PANEL.read_text(encoding="utf-8"))
        energy = DESIGN["plan"]["skills"]["energy"]
        for level in ("1", "2"):
            self.assertEqual(int(energy[level]["c4"]), int(panel["skill"]["energy"]))


class DesignMirrorTests(unittest.TestCase):
    def test_design_mirrors_the_module_plan(self):
        if not DESIGN:
            self.skipTest("design/kyle.json missing")
        self.assertEqual(K._design_problems(DESIGN), [])

    def test_a_drifted_mirror_is_rejected(self):
        if not DESIGN:
            self.skipTest("design/kyle.json missing")
        broken = copy.deepcopy(DESIGN)
        broken["plan"]["rework1"]["leader"] = ["official:999999#0"]
        self.assertTrue(K._design_problems(broken))

    def test_design_texts_pass_the_panel_rules(self):
        if not DESIGN:
            self.skipTest("design/kyle.json missing")
        for name in ("title", "profile", "leader", "skill1", "desc1", "skill2", "desc2"):
            KL.check_panel(DESIGN["texts"][name], label=name)


class KindGuardTests(unittest.TestCase):
    def blank(self, ncols: int) -> list[str]:
        return [""] * ncols

    def test_forbidden_content_kind_in_the_leader_table_is_rejected(self):
        row = self.blank(KL.LEADER_NCOLS)
        row[107] = "422"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("leader_ability", [row], "leader")

    def test_dash_row_without_the_leader_precondition_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[109], row[118] = "422", "0"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "1399905")

    def test_dash_row_without_a_param_id_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[6], row[109] = "42", "422"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "1399905")

    def test_unvetted_precondition_kind_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[6] = "188"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "1399903")

    def test_invoke_must_follow_the_counter_row(self):
        add = self.blank(KL.ABILITY_NCOLS)
        add[1], add[27], add[47] = "false", "51", "461"
        invoke = self.blank(KL.ABILITY_NCOLS)
        invoke[1], invoke[27], invoke[47] = "false", "51", "629"
        invoke[35], invoke[70], invoke[71] = "0", K.CAS_PIERCE, K.PIERCE_PROGRAM
        K._order_problems([add, invoke])
        with self.assertRaises(KL.KitError):
            K._order_problems([invoke, add])

    def test_invoke_without_a_string_key_is_rejected(self):
        add = self.blank(KL.ABILITY_NCOLS)
        add[1], add[27], add[47] = "false", "51", "461"
        invoke = self.blank(KL.ABILITY_NCOLS)
        invoke[1], invoke[27], invoke[47], invoke[35] = "false", "51", "629", "0"
        with self.assertRaises(KL.KitError):
            K._order_problems([add, invoke])


class DslHelperTests(unittest.TestCase):
    def hit_area(self) -> list:
        body = ["CreateHitArea"] + [None] * 26
        body[9] = ["Circle", [{"min": 225, "max": 225}]]
        body[13] = ["SpecifyHitAreaLifetimeDirectly", 30]
        body[14] = ["CalculatedUsingMaxNumOfHits", 1]
        body[24] = 0
        return body

    def test_hit_area_setter_writes_the_direct_attack_attribution(self):
        body = self.hit_area()
        K._set_hitarea(body, radius=320, lifetime=20, max_hits=1, label="t")
        self.assertEqual(body[9], ["Circle", [{"min": 320, "max": 320}]])
        self.assertEqual(body[24], K.BUFF_TARGET_AS_DIRECT)

    def test_hit_area_setter_rejects_a_drifted_shape(self):
        body = self.hit_area()
        body[9] = ["Rectangle", []]
        with self.assertRaises(KL.KitError):
            K._set_hitarea(body, radius=10, lifetime=1, max_hits=1, label="t")

    def test_create_normal_attack_keeps_the_inherited_element_slot(self):
        body = ["CreateNormalAttack"] + [None] * 16
        body[2] = 255
        K._set_cna(body, K.CNA_SHAPE[0], {"min": 1, "max": 1}, "t", combo_bonus=True)
        self.assertEqual(body[2], 255)
        self.assertIs(body[8], True)
        body[2] = 3
        with self.assertRaises(KL.KitError):
            K._set_cna(body, K.CNA_SHAPE[0], {"min": 1, "max": 1}, "t")

    def test_bind_remap_uses_the_authoritative_slot_table(self):
        node = ["Command", ["FindNearSubjects", -18, 1, 49, ["DoNothing"], 3,
                            ["Block", [["Command", ["CreateCondition", 3, [], [], None, True,
                                                    False, "", None, False, 3, [], False]]]]]]
        K._remap_binds(node, 30)
        self.assertEqual(node[1][5], 33)
        self.assertEqual(node[1][6][1][0][1][1], 33)
        self.assertEqual(node[1][1], -18, "内建主体（球）不许被平移")

    def test_finish_hit_area_binds_do_not_collide_with_the_enemy_block(self):
        self.assertNotIn(K.ENEMY_BIND, K.FINISH_BINDS)

    def test_normal_thunder_is_referenced_not_cloned(self):
        self.assertTrue(K.THUNDER_NORMAL_DONOR.endswith("psychic_tohru_1"))
        self.assertNotIn("psychic_tohru", K.FX_BOLT_DST)

    def test_pierce_growth_is_not_capped_at_three(self):
        self.assertGreater(K.PIERCE_VAR_CEIL, 3)
        self.assertEqual(K.PIERCE_BASE_TIMES, 1)
        self.assertEqual(K.PIERCE_TIMES_PER_LAYER, 1)
        # 段数取优不相加：同段数时比伤害% ⇒ 不得低于词条层的 3 段 +300%
        self.assertGreaterEqual(K.PIERCE_DAMAGE, 3.0)

    def test_pierce_condition_carries_a_distinct_key(self):
        # 带 vlv 的 CreateCondition 必须有非空区分键，否则不同层数会叠加
        self.assertTrue(K.PIERCE_CONDITION_KEY)


class IconTests(unittest.TestCase):
    def frame(self):
        from PIL import Image
        image = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
        pixels = image.load()
        for y in range(48):
            for x in range(48):
                pixels[x, y] = (0, 0, 0, 255 if 4 <= x < 44 and 4 <= y < 44 else 0)
        return image

    def test_every_style_keeps_the_official_alpha_and_size(self):
        frame = self.frame()
        for _key, _sid, _name, _cap, _frames, style in K.UNIQUES:
            icon = K.draw_icon(frame, style)
            self.assertEqual(icon.size, (48, 48))
            self.assertEqual(icon.getchannel("A").tobytes(), frame.getchannel("A").tobytes())

    def test_styles_differ_from_each_other(self):
        frame = self.frame()
        blobs = {style: K.draw_icon(frame, style).tobytes()
                 for _k, _s, _n, _c, _f, style in K.UNIQUES}
        self.assertEqual(len(set(blobs.values())), len(blobs))

    def test_unknown_style_is_rejected(self):
        with self.assertRaises(KL.KitError):
            K.draw_icon(self.frame(), "nope")

    def test_icon_rejects_a_wrong_sized_frame(self):
        from PIL import Image
        with self.assertRaises(KL.KitError):
            K.draw_icon(Image.new("RGBA", (32, 32)), "crescent")


# ---------------------------------------------------------------- 2. 官方基线

@unittest.skipUnless(_BASELINE, "需要 .cdn/cn 官方基线与 live store")
class RowBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.built = all_rows(ctx())

    def test_row_counts(self):
        self.assertEqual(len(self.built["leader"]), 4)
        self.assertEqual(sum(len(rows) for rows in self.built["ability"].values()), 23)

    def test_every_row_matches_the_baked_describe_readback(self):
        for ev in self.built["evidence"]:
            self.assertEqual(ev["describe"], K.EXPECT[ev["label"]], ev["label"])

    def test_capabilities_are_declared(self):
        self.assertTrue(set(self.built["capabilities"])
                        <= set(K.SPEC["required_capabilities"]))

    def test_leader_rows_are_all_crescent_growth(self):
        for row in self.built["leader"]:
            self.assertEqual(row[95], "134")
            self.assertEqual(row[102], K.UID_CRESCENT)
            self.assertEqual(row[100], "(None)")

    def test_self_and_party_layers_sum_to_the_panel_numbers(self):
        """面板：自身攻击 +100% / 直击 +200%，除自身外 +50% / +100%。"""
        share = {(row[107], row[108]): int(row[111]) for row in self.built["leader"]}
        self.assertEqual(share[("0", "5")] + share[("0", "0")], 100000)
        self.assertEqual(share[("1", "5")] + share[("1", "0")], 200000)
        self.assertEqual(share[("0", "5")], 50000)
        self.assertEqual(share[("1", "5")], 100000)

    def test_direct_attack_stack_row_beats_the_batch_floor(self):
        row = next(r for r in self.built["ability"][f"{K.CID}3"] if r[47] == "202")
        self.assertEqual(row[48], "5")
        self.assertEqual(row[49], K.ELEMENT_TOKEN)
        # 跨角色：全批统一 3 段，主 C 的合计伤害不低于辅助（罗尔夫 200%）
        self.assertGreaterEqual(int(row[51]), 200000)

    def test_dash_parameters_match_the_panel(self):
        dash = {row[118]: int(row[113]) for row in self.built["ability"][f"{K.CID}5"]
                if row[109] == "422"}
        self.assertEqual(dash["0"], -50000, "冲刺冷却时间 −50%")
        self.assertGreater(dash["1"], 0, "冲刺弹射速度提升")
        self.assertGreater(dash["6"], 0, "可从更高的位置发动冲刺")


@unittest.skipUnless(_BASELINE, "需要 .cdn/cn 官方基线与 live store")
class SkillTreeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = ctx()
        cls.donor = cls.context.template_dsl(
            f"battle/action/skill/action/rare5/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_2")

    def mutated(self, level: str = "2"):
        donor = self.context.template_dsl(
            f"battle/action/skill/action/rare5/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_{level}")
        tree, evidence = K.mutate_tree(self.context, donor, level)
        tree, _ = self.context.rewrite_effect_refs(tree, blade_family())
        tree, _ = self.context.rewrite_effect_refs(tree, trail_family())
        return tree, evidence

    def test_donor_fingerprint_is_asserted(self):
        self.assertEqual(K._command_counts(copy.deepcopy(self.donor)), K.DONOR_COMMAND_COUNTS)

    def test_drifted_donor_is_rejected(self):
        broken = copy.deepcopy(self.donor)
        broken[11][1].pop()
        with self.assertRaises(KL.KitError):
            K.mutate_tree(self.context, broken, "2")

    def test_skill_tree_passes_every_dsl_gate(self):
        for level in ("1", "2"):
            tree, _ = self.mutated(level)
            self.assertEqual(K._dsl_problems(tree), [], level)

    def test_dash_replaces_stop_ball(self):
        tree, evidence = self.mutated()
        names = {body[0] for body in
                 (node[1] for node in K._walk(tree) if K._is_command(node))}
        if K.DASH_REPLACES_STOPBALL:
            self.assertIn("MoveBall", names)
            self.assertNotIn("StopBall", names)
            self.assertEqual(evidence["dash"]["with"], K.MOVE_BALL)
        else:
            self.assertIn("StopBall", names)

    def test_trail_effect_is_attached_to_the_dash_block(self):
        tree, _ = self.mutated()
        trail = [body for body in (node[1] for node in K._walk(tree)
                                   if K._is_command(node, "ShowEffect"))
                 if body[1] == K.FX_TRAIL_LABEL]
        self.assertEqual(len(trail), 1)
        self.assertEqual(trail[0][2], ["SpecifyEffectDirectly", K.FX_TRAIL_EFFECT])
        self.assertEqual(trail[0][3], -18)
        self.assertEqual(trail[0][4], ["BacksideOfCharacter"])
        self.assertEqual(trail[0][6], ["AB"])

    def test_blade_effect_names_keep_their_tree_order(self):
        tree, _ = self.mutated()
        shows = [body[1] for body in (node[1] for node in K._walk(tree)
                                      if K._is_command(node, "ShowEffect"))]
        self.assertEqual(shows[:3], [K.EFFECT_NAMES[0], K.EFFECT_NAMES[1], K.EFFECT_NAMES[2]])

    def test_all_three_slashes_settle_as_direct_attack_damage(self):
        tree, _ = self.mutated()
        areas = [body for body in (node[1] for node in K._walk(tree)
                                   if K._is_command(node, "CreateHitArea"))]
        self.assertEqual(len(areas), 3)
        for area in areas:
            self.assertEqual(area[24], K.BUFF_TARGET_AS_DIRECT)

    def test_resonance_branch_carries_the_team_buffs_and_the_enemy_debuffs(self):
        tree, _ = self.mutated()
        flags = [body for body in (node[1] for node in K._walk(tree)
                                   if K._is_command(node, "ConditionalsChangeSkillFlag"))]
        self.assertEqual(len(flags), 1)
        boost, plain = flags[0][2], flags[0][3]
        self.assertEqual(plain, ["Block", []], "非共鸣档不加任何东西")
        kinds = {ac[0] for body in (node[1] for node in K._walk(boost)
                                    if K._is_command(node, "CreateCondition"))
                 for ac in body[2]}
        self.assertTrue({"ACPiercing", "ACDirectDamage", "ACSpeedup", "ACFrozen"} <= kinds)
        dispel = [body for body in (node[1] for node in K._walk(boost)
                                    if K._is_command(node, "DeleteCondition"))]
        self.assertEqual(len(dispel), 1)
        self.assertEqual(dispel[0][2], ["DCAll", 2])
        self.assertEqual(dispel[0][3], K.DISPEL_COUNT)

    def test_boost_durations_match_the_panel(self):
        tree, evidence = self.mutated()
        self.assertEqual(evidence["boost"]["piercing_frames"], 330)   # 5.5 秒
        self.assertEqual(evidence["boost"]["speedup_frames"], 900)    # 15 秒

    def test_awake_unique_is_applied_outside_the_branch(self):
        tree, _ = self.mutated()
        awake = [body for body in (node[1] for node in K._walk(tree[11][1][1:2])
                                   if K._is_command(node, "CreateCondition"))]
        self.assertEqual(len(awake), 1)
        self.assertEqual(awake[0][2][0][0], "ACUnique")
        self.assertEqual(awake[0][2][0][1], int(K.UID_AWAKE))

    def test_effect_refs_leave_no_donor_namespace_behind(self):
        for level in ("1", "2"):
            tree, _ = self.mutated(level)
            for path in K.effect_paths(tree):
                self.assertFalse(path.startswith(f"battle/effect/skill_unique/{K.TEMPLATE_CODE}/"),
                                 path)
                self.assertFalse(path.startswith(f"{K.FX_TRAIL_SRC}/"), path)


@unittest.skipUnless(_BASELINE, "需要 .cdn/cn 官方基线与 live store")
class AbilitySkillTreeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = ctx()
        cls.donor = cls.context.template_dsl(
            f"battle/action/skill/action/rare5/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_2")

    def test_pierce_tree_binds_and_uses_the_variable_in_one_block(self):
        tree, note = K.build_pierce_tree(self.context, self.donor)
        self.assertEqual(K._dsl_problems(tree), [])
        block = tree[11]
        self.assertEqual(block[0], "Block")
        names = [node[1][0] for node in block[1] if K._is_command(node)]
        self.assertEqual(names, ["BindConditionAccumulationVariable", "CreateCondition"])
        bind = block[1][0][1]
        self.assertEqual(bind[3], ["DCUnique", int(K.UID_PIERCE)])
        ac = block[1][1][1][2][0]
        self.assertEqual(ac[0], "ACAdditionalDirectAttack")
        self.assertEqual(ac[2][0]["vlv"][0]["vid"], bind[2])
        self.assertEqual(note["ceiling"], K.PIERCE_VAR_CEIL)

    def test_pierce_condition_has_a_non_empty_discriminator(self):
        tree, _ = K.build_pierce_tree(self.context, self.donor)
        condition = tree[11][1][1][1]
        self.assertTrue(condition[7])
        self.assertEqual(condition[10], 3, "付与对象种类必须是 3（Member），否则施法 C16102")

    def test_thunder_tree_has_two_mutually_exclusive_branches(self):
        tree, note = K.build_thunder_tree(self.context, self.donor, bolt_family())
        self.assertEqual(K._dsl_problems(tree), [])
        flags = [body for body in (node[1] for node in K._walk(tree)
                                   if K._is_command(node, "ConditionalsChangeSkillFlag"))]
        self.assertEqual(len(flags), 1)
        boost_paths = K.effect_paths(flags[0][2])
        normal_paths = K.effect_paths(flags[0][3])
        self.assertTrue(all(path.startswith(K.FX_BOLT_DST) for path in boost_paths), boost_paths)
        self.assertTrue(all("psychic_tohru" in path for path in normal_paths), normal_paths)
        self.assertFalse(note["normal"]["direct"])
        self.assertTrue(note["boost"]["direct"])

    def test_boost_thunder_settles_as_direct_attack_and_grows_with_combo(self):
        tree, _ = K.build_thunder_tree(self.context, self.donor, bolt_family())
        flags = [body for body in (node[1] for node in K._walk(tree)
                                   if K._is_command(node, "ConditionalsChangeSkillFlag"))][0]
        area = [body for body in (node[1] for node in K._walk(flags[2])
                                  if K._is_command(node, "CreateHitArea"))][0]
        attack = [body for body in (node[1] for node in K._walk(flags[2])
                                    if K._is_command(node, "CreateNormalAttack"))][0]
        self.assertEqual(area[24], K.BUFF_TARGET_AS_DIRECT)
        self.assertIs(attack[8], True)

    def test_branch_binds_do_not_collide(self):
        tree, _ = K.build_thunder_tree(self.context, self.donor, bolt_family())
        flags = [body for body in (node[1] for node in K._walk(tree)
                                   if K._is_command(node, "ConditionalsChangeSkillFlag"))][0]

        def binds(node):
            out = set()
            for cmd in (n[1] for n in K._walk(node) if K._is_command(n)):
                for ids, _block in L.DSL_SUBJECT_BINDERS.get(cmd[0], ()):
                    for slot in ids:
                        if slot < len(cmd) and isinstance(cmd[slot], int):
                            out.add(cmd[slot])
            return out

        self.assertFalse(binds(flags[2]) & binds(flags[3]),
                         "两个分支的绑定号不能重号（lookup 会解析到错误主体）")

    def test_thunder_tree_keeps_no_reference_to_the_uncloned_donor_family(self):
        tree, _ = K.build_thunder_tree(self.context, self.donor, bolt_family())
        for path in K.effect_paths(tree):
            self.assertFalse(path.startswith(f"{K.FX_BOLT_SRC}/"), path)


# ---------------------------------------------------------------- 3. 已构建的包

@unittest.skipUnless(WORKSPACE.is_dir(), "workspace 尚未构建")
class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads((WORKSPACE / "evidence" / "kit-report.json").read_text("utf-8")) \
            if (WORKSPACE / "evidence" / "kit-report.json").is_file() else {}
        cls.rows = json.loads((WORKSPACE / "evidence" / "kit-rows.json").read_text("utf-8"))
        cls.skills = json.loads((WORKSPACE / "evidence" / "kit-skills.json").read_text("utf-8"))

    def test_four_programs_are_written(self):
        self.assertEqual(len(self.skills["programs"]), 4)
        self.assertIn(K.PIERCE_PROGRAM, self.skills["programs"])
        self.assertIn(K.THUNDER_PROGRAM, self.skills["programs"])

    def test_every_program_file_exists(self):
        for program in self.skills["programs"]:
            path = WORKSPACE / "package" / "roots" / "common" / (
                wf_dsl.dsl_logical(program))
            self.assertTrue(path.is_file(), path)

    def test_three_unique_conditions_with_icons(self):
        self.assertEqual(sorted(self.rows["unique_condition"]),
                         sorted(key for key, *_ in K.UNIQUES))
        for icon in self.rows["icons"]:
            path = WORKSPACE / "package" / "roots" / "common" / icon["logical"]
            self.assertTrue(path.is_file(), path)

    def test_custom_ability_strings_cover_the_panel(self):
        self.assertEqual(sorted(self.rows["custom_ability_string"]), sorted(K.CAS_TEXTS))

    def test_three_effect_families_are_packaged(self):
        for dst in (K.FX_BLADE_DST, K.FX_BOLT_DST, K.FX_TRAIL_DST):
            path = WORKSPACE / "package" / "roots" / "common" / dst
            self.assertTrue(path.is_dir(), path)

    def test_the_normal_thunder_family_is_not_cloned(self):
        path = WORKSPACE / "package" / "roots" / "common" / "battle/effect/skill_unique/psychic_tohru"
        self.assertFalse(path.exists(), "常态天雷必须只引用官方路径，克隆会让图集 fits=False")

    def test_pixel_and_voice_assets_are_untouched_by_this_rework(self):
        """本轮只改表/DSL/特效/图标；小人与语音一格不改（作者 09-21：凯尔小人不变）。"""
        pixel = WORKSPACE / "package" / "roots" / "common" / "character" / K.CODE / "pixelart"
        self.assertTrue(pixel.is_dir())
        self.assertTrue(any(pixel.iterdir()))


if __name__ == "__main__":
    unittest.main()
