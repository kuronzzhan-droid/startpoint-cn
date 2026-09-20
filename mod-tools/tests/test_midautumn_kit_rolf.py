# -*- coding: utf-8 -*-
"""罗尔夫 kit（149986 ``black_wolf_knight_moon``）rework1：行计划自查 + 行装配 + DSL 门禁。

三组用例：

1. **纯静态**（不需要 live / 官方基线）：模块常量与 ``design/rolf.json`` 的 ``plan_rework1``
   互锁；裁决 §8 的自查（队长表禁 422/724/713/693、422 必挂前置 42 且 c118 非空、
   前置 kind 白名单、201/202/521 必须 Initial 触发、629 必配字符串键且该键 unisonable=false、
   536 必带 c70、during puller 契约）；面板文案逐块对齐 ``rework1/panel/rolf.json``、面板禁词；
   以及本模块的小工具（``ConditionalsChangeSkillFlag`` 形状、``StopBall`` 剥离、AMF3 数值壳）。
2. **官方基线**（缺 ``.cdn/cn`` 或 live store 时跳过）：7＋18 行逐行装配并与 ``EXPECT`` 的
   ``wf_describe`` 回读逐字比对；两棵主技能树与一棵 629 追击树的装配与全部 DSL 门禁
   （元素、主体绑定、判定区归属、方向、坐标系），母本漂移断言。
3. **已构建的 workspace**（``work/character_packs/ma-rolf`` 不存在时跳过）：包内 3 棵 DSL 程序、
   ``custom_ability_string`` 9 键、零固有状态、特效仍指官方 wt23 路径。

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
import wf_midautumn_kit_rolf as K  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_mod_tool as core  # noqa: E402
import wf_seasonal7_build as B  # noqa: E402
import wf_seasonal7_common as C  # noqa: E402

ROOT = core.project_root()
DESIGN = MS.load_design(ROOT, "rolf")
WORKSPACE = ROOT / "work/character_packs/ma-rolf"
PANEL = ROOT / "work/character_packs/midautumn-20260920/rework1/panel/rolf.json"


def _baseline_available() -> bool:
    profile = core.resolve_profile()
    return profile is not None and profile.store.is_dir() and (ROOT / ".cdn" / "cn").is_dir()


_BASELINE = _baseline_available()
_CTX = None


def ctx():
    """只读上下文：``record_sources=False`` ⇒ 母本取数不写 workspace。"""
    global _CTX
    if _CTX is None:
        _CTX = B.KitContext(MC.MAPack(MS.get_spec("rolf"), record_sources=False))
    return _CTX


def panel_json() -> dict:
    return json.loads(PANEL.read_text(encoding="utf-8"))


def all_rows(context) -> dict:
    return K.build_rows(context)


# ---------------------------------------------------------------- 1. 纯静态

class ConstantTests(unittest.TestCase):
    def test_identity_matches_the_registry(self):
        spec = MS.get_spec("rolf")
        self.assertEqual((spec.cid, spec.code, spec.element), (K.CID, K.CODE, K.ELEMENT))
        self.assertEqual((spec.template_id, spec.template_code), (K.TEMPLATE_ID, K.TEMPLATE_CODE))
        self.assertEqual((spec.pf_type, spec.stance), (K.PF_TYPE, K.STANCE))

    def test_element_is_not_colorless(self):
        # element=6（Colorless）是敌专属，可玩角色写 6 会崩 C7050（记忆 wf-element6-colorless-crash）
        self.assertEqual(K.ELEMENT, 3)
        self.assertEqual(K.ELEMENT_TOKEN, "Green")
        self.assertEqual(K.DSL_WIND, K.ELEMENT + 1)     # DSL 显式元素码 = 内部 + 1

    def test_ability_keys_are_the_six_slots(self):
        self.assertEqual(K.ABILITY_KEYS, tuple(f"{K.CID}{n}" for n in range(1, 7)))
        self.assertEqual(sorted(K.PLAN), list(range(1, 7)))

    def test_no_unique_conditions_and_no_icons(self):
        """本轮零固有状态：SPEC 不许声明固有键，设计镜像的 unique_conditions 必须是空表。"""
        self.assertNotIn(MS.UNIQUE_CONDITION_LOGICAL, K.SPEC["extra_keys"])
        self.assertEqual(DESIGN["plan_rework1"]["unique_conditions"], [])

    def test_spec_declares_every_self_owned_key(self):
        declared = set(K.SPEC["extra_keys"][KL.CAS])
        self.assertEqual(declared, set(K.CAS_TEXTS))
        self.assertEqual(len(declared), 9)
        self.assertEqual(K.SPEC["extra_keys"][KL.SWITCHED], (K.VOICE_KEY,))

    def test_required_capabilities_cover_dash_and_panel_override(self):
        self.assertIn("dash-parameter-v1", K.SPEC["required_capabilities"])
        self.assertIn(L.PANEL_OVERRIDE_V2, K.SPEC["required_capabilities"])

    def test_encore_program_path_stays_short_enough_for_windows(self):
        """``inspect`` 会把包复制到批目录下的临时目录；键名过长会撞 260 字符上限（20260921 实测）。"""
        self.assertTrue(K.ENCORE_PROGRAM.endswith(f"{K.CAS_ENCORE}${K.CAS_ENCORE}"))
        self.assertTrue(K.ENCORE_PROGRAM.startswith("battle/action/skill/action/ability_skill/"))
        self.assertLessEqual(len(K.CAS_ENCORE), 32)

    def test_voice_route_is_the_shipped_primula_shape(self):
        self.assertEqual(K.VOICE_ROUTE_COLS[0], "1")          # kind 1 ConditionExist
        self.assertEqual(K.VOICE_ROUTE_COLS[1], "31")         # 贯通
        self.assertEqual(K.VOICE_ROUTE_COLS[5], K.VOICE_KEY)
        self.assertEqual(list(DESIGN["voice"]["route"]["columns"]), K.VOICE_ROUTE_COLS)


class DesignMirrorTests(unittest.TestCase):
    def test_design_mirrors_the_module_plan(self):
        self.assertEqual(K.design_problems(DESIGN), [])

    def test_a_drifted_mirror_is_rejected(self):
        drifted = copy.deepcopy(DESIGN)
        drifted["plan_rework1"]["ability_records"] = 17
        self.assertTrue(K.design_problems(drifted))
        drifted = copy.deepcopy(DESIGN)
        drifted["plan_rework1"]["ability_skill_programs"] = []
        self.assertTrue(K.design_problems(drifted))
        self.assertTrue(K.design_problems({}))

    def test_row_counts_match_the_plan(self):
        self.assertEqual(len(K.LEADER), K.LEADER_ROWS)
        self.assertEqual(sum(len(rows) for rows in K.PLAN.values()), K.ABILITY_RECORDS)

    def test_skill_values_carry_the_boost_pair(self):
        values = DESIGN["plan_rework1"]["skills"]["values"]
        self.assertEqual(values["hit_area_damage_kind"], 4)
        self.assertEqual(values["encore_level"], 2)
        for level in ("1", "2"):
            self.assertEqual(values[level]["fixed_speed_speed_boost"], 4)
            self.assertEqual(values[level]["fixed_speed_charge_boost"], 0)
            # 常态档的充能必须留在官方实读区间；强化档的 0 是作者点名要的例外
            self.assertIn(values[level]["fixed_speed_charge"], K.OFFICIAL_FIXED_SPEED_CHARGES)


class PlanSelfCheckTests(unittest.TestCase):
    def cells(self, slot: int):
        return [dict(entry[2]) for entry in K.PLAN[slot]]

    def test_leader_plan_never_writes_the_forbidden_kinds(self):
        for index, (_addr, _src, cells, _exp) in enumerate(K.LEADER):
            for col in (K.LEADER_INSTANT_KIND, K.LEADER_DURING_KIND):
                self.assertNotIn(str(cells.get(col, "")), K.FORBIDDEN_LEADER_KINDS,
                                 f"leader#{index} 写了队长表禁用 kind")

    def test_swift_offset_row_leaves_the_puller_empty(self):
        """during 34 ConditionSwift 的 puller 列写 '0' = parseAt98 C7050。"""
        swift = [c for c in self.cells(6) if str(c.get(97, "")) == "34"]
        self.assertEqual(len(swift), 1)
        self.assertEqual(swift[0][98], "")

    def test_the_invoke_string_key_and_program_are_wired_to_the_module(self):
        invoke = [c for c in self.cells(3) if c.get(70) == K.CAS_ENCORE]
        self.assertEqual(len(invoke), 1)
        self.assertEqual(invoke[0][71], K.ENCORE_PROGRAM)
        self.assertEqual(K._UNISONABLE[3], "false")     # 629 在副位不生效
        flag = [c for c in self.cells(3) if c.get(70) == K.CAS_FLAG]
        self.assertEqual(len(flag), 1)

    def test_unlimited_growth_rows_write_none_not_an_empty_limit(self):
        """trigger_limit 留空 = 上限 0（词条全程零收益）；无上限的官方写法是 ``(None)``。"""
        wanted = {("3", 1), ("3", 2), ("3", 4), ("3", 5), ("6", 0), ("6", 3)}
        for slot, index in wanted:
            cells = self.cells(int(slot))[index]
            if 34 in cells:
                self.assertEqual(cells[34], "(None)", f"slot {slot}#{index}")

    def test_preconditions_stay_inside_the_vetted_set(self):
        for slot in range(1, 7):
            for index, cells in enumerate(self.cells(slot)):
                for col in (6, 13, 20):
                    if col in cells:
                        self.assertIn(str(cells[col]), K.ALLOWED_PRECONDITION_KINDS,
                                      f"slot {slot}#{index} c{col}")

    def test_statue_groups_are_single_valued_and_known(self):
        for slot, group in K._STATUE.items():
            self.assertIn(group, L.ABILITY_STATUE_GROUPS, f"slot {slot}")
            for cells in self.cells(slot):
                self.assertNotIn(2, cells, "c2 由 build_rows 统一注入，行计划里不该再写")


class KindGuardTests(unittest.TestCase):
    """``_ban_kinds`` 本身必须真的会拦 —— 删掉判据这些用例就得变红。"""

    def blank(self, ncols: int) -> list[str]:
        return [""] * ncols

    def test_forbidden_content_kind_in_the_leader_table_is_rejected(self):
        for kind in ("422", "724", "713", "693"):
            row = self.blank(KL.LEADER_NCOLS)
            row[K.LEADER_DURING_KIND] = kind
            with self.assertRaises(KL.KitError):
                K._ban_kinds("leader_ability", [row], "leader")

    def test_dash_row_without_the_leader_precondition_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[K.ABILITY_DURING_KIND] = "422"
        row[118] = "0"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "a")

    def test_dash_row_without_a_param_id_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[6] = "42"
        row[K.ABILITY_DURING_KIND] = "422"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "a")

    def test_invoke_without_a_string_key_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[1] = "false"
        row[K.ABILITY_INSTANT_KIND] = "629"
        row[35] = "300"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "a")

    def test_invoke_in_a_unisonable_key_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[1] = "true"
        row[K.ABILITY_INSTANT_KIND] = "629"
        row[35] = "300"
        row[70], row[71] = K.CAS_ENCORE, K.ENCORE_PROGRAM
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "a")

    def test_direct_attack3_with_a_non_initial_trigger_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[1] = "true"
        row[27] = "12"
        row[K.ABILITY_INSTANT_KIND] = "202"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "a")

    def test_unvetted_precondition_kind_is_rejected(self):
        row = self.blank(KL.ABILITY_NCOLS)
        row[6] = "188"          # 数实例数恒 1，阈值 ≥2 永不成立（裁决 §8）
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "a")

    def test_during_puller_contract(self):
        for trigger in K.PULLER_MUST_BE_EMPTY:
            row = self.blank(KL.ABILITY_NCOLS)
            row[K.ABILITY_DURING_TRIGGER] = trigger
            row[K.ABILITY_DURING_PULLER] = "0"
            with self.assertRaises(KL.KitError):
                K._check_pullers([row], K.ABILITY_DURING_TRIGGER, K.ABILITY_DURING_PULLER, "a")
        row = self.blank(KL.ABILITY_NCOLS)
        row[K.ABILITY_DURING_TRIGGER] = "204"
        with self.assertRaises(KL.KitError):
            K._check_pullers([row], K.ABILITY_DURING_TRIGGER, K.ABILITY_DURING_PULLER, "a")

    def test_invoke_row_must_exist_in_slot_three(self):
        with self.assertRaises(KL.KitError):
            K._order_problems([self.blank(KL.ABILITY_NCOLS)])


class PanelTextTests(unittest.TestCase):
    def test_panel_text_obeys_the_project_rules(self):
        for key, text in K.CAS_TEXTS.items():
            for line in text.split("\n"):
                self.assertEqual(
                    KL.panel_problems(line.replace(K.MAIN_ICON, ""),
                                      skill_flag=(key == K.CAS_FLAG)),
                    [], f"{key}: {line}")

    def test_skill_flag_entry_carries_no_numbers_or_time(self):
        self.assertFalse(any(ch.isdigit() for ch in K.CAS_TEXTS[K.CAS_FLAG]))

    def test_panel_text_matches_the_author_approved_target(self):
        """多条记录用换行分行（禁止「／」挤成一行）；每行文字以目标面板 lines[].text 为准。"""
        panel = panel_json()
        joined = "\n".join(line["text"] for line in panel["leader"]["lines"])
        self.assertEqual(joined, K.PANEL_LEADER)
        for block in panel["abilities"]:
            slot = block["index"]
            texts = [line["text"] for line in block["lines"]]
            if block["main_only"]:
                joined = "\n".join(K.MAIN_ICON + text for text in texts)
            else:
                joined = "\n".join(texts)
            self.assertEqual(joined, K.PANEL_ABILITY[slot], f"ability {slot}")

    def test_main_only_slot_matches_the_panel(self):
        for block in panel_json()["abilities"]:
            slot = block["index"]
            self.assertEqual(K._UNISONABLE[slot], "false" if block["main_only"] else "true",
                             f"ability {slot}")

    def test_main_position_slots_carry_their_own_icon_and_no_literal_glyph(self):
        """主位限制槽（能力3）覆盖串每行都要带 <icon id='main'>，全文不许出现字面「Ⓜ」；
        非主位槽不带图标。多记录槽的覆盖串行数＝目标面板对应槽位的行数（不许「／」挤成一行）。
        """
        panel_by_slot = {block["index"]: block for block in panel_json()["abilities"]}
        for slot in range(1, 7):
            text = K.CAS_TEXTS[K.CAS_ABILITY[slot]]
            self.assertNotIn("Ⓜ", text, f"ability {slot}")
            lines = text.split("\n")
            block = panel_by_slot[slot]
            self.assertEqual(len(lines), len(block["lines"]), f"ability {slot} line count")
            wants_icon = block["main_only"]
            for line in lines:
                self.assertEqual(line.startswith(K.MAIN_ICON), wants_icon,
                                 f"ability {slot}: {line}")
        self.assertNotIn("Ⓜ", K.PANEL_LEADER)
        self.assertEqual(len(K.PANEL_LEADER.split("\n")), len(panel_json()["leader"]["lines"]))

    def test_panel_identity_matches_the_module(self):
        panel = panel_json()
        self.assertEqual(panel["cid"], K.CID)
        self.assertEqual(panel["element"], "风")

    def test_skill_energy_matches_the_panel(self):
        energy = DESIGN["plan_rework1"]["skills"]["energy"]
        self.assertEqual(energy["inner1"]["c4"], panel_json()["skill"]["energy"])


class DslHelperTests(unittest.TestCase):
    def test_block_wraps_every_payload_in_a_command(self):
        node = K.block([["ShakeCamera", 1]])
        self.assertEqual(node, ["Block", [["Command", ["ShakeCamera", 1]]]])

    def test_flag_branch_has_the_official_shape(self):
        node = K.flag_branch([["ShakeCamera", 1]], [["ShakeCamera", 2]])
        self.assertEqual(node[0], "ConditionalsChangeSkillFlag")
        self.assertEqual(node[1], K.SKILL_FLAG_INDEX)
        for branch in node[2:]:
            self.assertEqual(branch[0], "Block")       # 禁写 ["DoNothing"]（F1009）
        self.assertNotIn("DoNothing", json.dumps(node))

    def test_number_shape_keeps_integers_integral(self):
        self.assertIsInstance(K.num(900), int)
        self.assertIsInstance(K.num(-0.1), float)
        self.assertEqual(K.span(4), [{"min": 4, "max": 4}])
        self.assertEqual(K.span(1.13, 1.3), [{"min": 1.13, "max": 1.3}])

    def test_strip_stop_ball_removes_only_stop_ball(self):
        tree = ["Block", [["Command", ["StopBall", -18, 70]],
                          ["Command", ["ShakeCamera", 1]]]]
        removed = K.strip_stop_ball(tree)
        self.assertEqual(removed, 1)
        self.assertEqual(tree, ["Block", [["Command", ["ShakeCamera", 1]]]])

    def test_write_dsl_rejects_the_wrapper_shell(self):
        """``write_dsl`` 只吃裸树；喂 ``{tree, numbers}`` 包装 = 进战斗 F1034。"""
        with self.assertRaises(KL.KitError):
            K.write_dsl_checked(None, "x", {"tree": ["ActionDsl"], "numbers": []})


# ---------------------------------------------------------------- 2. 官方基线

@unittest.skipUnless(_BASELINE, "需要 .cdn/cn 官方归档与 live store")
class OfficialRowTests(unittest.TestCase):
    def test_rows_assemble_and_render_as_designed(self):
        built = all_rows(ctx())
        self.assertEqual(len(built["leader"]), K.LEADER_ROWS)
        self.assertEqual(sum(len(r) for r in built["ability"].values()), K.ABILITY_RECORDS)
        rendered = {ev["label"]: ev["describe"] for ev in built["evidence"]}
        for label, want in K.EXPECT.items():
            self.assertEqual(rendered[label], want, label)

    def test_every_row_is_covered_by_the_expect_gate(self):
        """EXPECT 必须盖满 25 行：漏一行就等于那一行没有 describe 门禁。"""
        built = all_rows(ctx())
        self.assertEqual(sorted(K.EXPECT), sorted(ev["label"] for ev in built["evidence"]))

    def test_only_the_dash_rows_need_a_client_capability(self):
        built = all_rows(ctx())
        self.assertEqual(built["capabilities"], ["dash-parameter-v1"])
        needing = [ev["label"] for ev in built["evidence"] if ev["capabilities"]]
        self.assertEqual(needing, [f"{K.CID}6#1", f"{K.CID}6#2"])

    def test_dash_rows_are_leader_gated_and_carry_a_param_id(self):
        rows = all_rows(ctx())["ability"][f"{K.CID}6"]
        dash = [r for r in rows if r[K.ABILITY_DURING_KIND] == "422"]
        self.assertEqual(len(dash), 2)
        for row in dash:
            self.assertEqual(row[6], "42")              # 前置 42 Leader（与别人的 422 隔离）
            self.assertEqual(row[118], "0")             # param_id 0 必须显式写
        self.assertEqual(sorted(r[113] for r in dash), ["-33000", "234500"])

    def test_invoke_row_declares_both_a_string_key_and_a_program(self):
        rows = all_rows(ctx())["ability"][f"{K.CID}3"]
        invoke = [r for r in rows if r[K.ABILITY_INSTANT_KIND] == "629"]
        self.assertEqual(len(invoke), 1)
        self.assertEqual(invoke[0][70], K.CAS_ENCORE)
        self.assertEqual(invoke[0][71], K.ENCORE_PROGRAM)
        self.assertEqual(invoke[0][35], "300")          # CT 5 秒，不能留空
        self.assertEqual(rows[0][1], "false")           # 629 在副位不生效

    def test_only_the_main_only_slot_hosts_629_and_the_skill_flag(self):
        ability = all_rows(ctx())["ability"]
        for key, rows in ability.items():
            for row in rows:
                if row[K.ABILITY_INSTANT_KIND] in ("629",) + KL.SKILL_FLAG_KINDS:
                    self.assertEqual(key, f"{K.CID}3", row[K.ABILITY_INSTANT_KIND])

    def test_direct_attack3_row_uses_an_initial_trigger(self):
        """C2308：瞬发常驻 201/202/521 的触发不是 Initial 就会被 validate() 打回。"""
        rows = all_rows(ctx())["ability"][f"{K.CID}3"]
        da3 = [r for r in rows if r[K.ABILITY_INSTANT_KIND] == "202"]
        self.assertEqual(len(da3), 1)
        self.assertIn(da3[0][27], ("", "0"))
        self.assertEqual((da3[0][48], da3[0][49]), ("5", K.ELEMENT_TOKEN))

    def test_no_other_direct_attack_stage_source_exists(self):
        """段数多来源取优不相加 ⇒ 套件内只许有 202 一个来源（卡 B §1.1）。"""
        built = all_rows(ctx())
        for rows in list(built["ability"].values()) + [built["leader"]]:
            for row in rows:
                for col in (K.ABILITY_INSTANT_KIND, K.ABILITY_DURING_KIND,
                            K.LEADER_INSTANT_KIND, K.LEADER_DURING_KIND):
                    if col < len(row):
                        self.assertNotIn(row[col], ("201", "521", "45", "46", "252"))

    def test_a_drifted_cell_is_caught_by_the_describe_gate(self):
        with self.assertRaises(KL.KitError):
            KL.build_row(ctx(), "leader_ability", K.LEADER[0][0],
                         {0: K.CODE, 49: "1", 50: "1"},
                         expect_describe=K.EXPECT["leader#0"], label="drift")

    def test_statue_group_report_names_the_zero_precedent_rows(self):
        built = all_rows(ctx())
        report = K.statue_group_report(ctx(), built["ability"])
        zero = {f"{e['key']}#{e['record']} {e['kind']}" for e in report if e["official_rows"] == 0}
        # 422/693 官方全表 0 行；629 官方唯一一行的组是 special。c2 是纯面板外观。
        self.assertEqual(zero, {f"{K.CID}3#4 629", f"{K.CID}6#1 422",
                                f"{K.CID}6#2 422", f"{K.CID}6#3 693"})


@unittest.skipUnless(_BASELINE, "需要 .cdn/cn 官方归档与 live store")
class SkillTreeTests(unittest.TestCase):
    def values(self, level: str) -> dict:
        block = DESIGN["plan_rework1"]["skills"]["values"]
        out = dict(block[level])
        out["hit_area_damage_kind"] = block["hit_area_damage_kind"]
        return out

    def tree(self, level: str):
        return K.build_skill_tree(ctx(), level, self.values(level), None)

    def test_power_flip_block_is_removed_and_two_blocks_are_grafted(self):
        tree, gates = self.tree("2")
        self.assertEqual(gates["removed_power_flip"]["removed_command"], "FindAllSubjects")
        self.assertEqual(len(K.statements(tree)), 3)         # 主块 + 团队块 + 风属性块
        self.assertEqual(gates["team_conditions"], ["ACPiercing", "ACFixedSpeed"])
        self.assertEqual(gates["buff_target_as"], 0)
        self.assertEqual(json.dumps(tree).count("ACPowerFlipDamage"), 0)

    def test_both_hit_areas_switch_to_the_direct_attack_pool(self):
        tree, _ = self.tree("2")
        areas = list(wf_dsl.iter_dsl_commands(tree, "CreateHitArea"))
        self.assertEqual(len(areas), 2)
        for area in areas:
            self.assertEqual(area[K.HIT_AREA_DAMAGE_SLOT], 4)

    def test_combo_bonus_is_behind_the_skill_flag(self):
        """强化档吃连击成长、常态档不吃；分支必须成对出现。"""
        tree, _ = self.tree("2")
        attacks = list(wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack"))
        self.assertEqual(len(attacks), 4)                     # 两段 × (then, else)
        self.assertEqual(sorted(a[K.CNA_COMBO_SLOT] for a in attacks),
                         [False, False, True, True])
        self.assertEqual(json.dumps(tree).count("ConditionalsChangeSkillFlag"), 3)

    def test_fixed_speed_has_a_boosted_and_a_normal_branch(self):
        tree, _ = self.tree("2")
        values = self.values("2")
        speeds = [c[2][0] for c in wf_dsl.iter_dsl_commands(tree, "CreateCondition")
                  if c[2][0][0] == "ACFixedSpeed"]
        self.assertEqual(len(speeds), 2)
        boosted = [s for s in speeds if s[2] == K.span(values["fixed_speed_speed_boost"])]
        normal = [s for s in speeds if s[2] == K.span(values["fixed_speed_speed"])]
        self.assertEqual(len(boosted), 1)
        self.assertEqual(len(normal), 1)
        self.assertEqual(boosted[0][3], K.span(values["fixed_speed_charge_boost"]))
        self.assertEqual(normal[0][3], K.span(values["fixed_speed_charge"]))

    def test_grafted_conditions_keep_the_official_target_kinds(self):
        """``CreateCondition`` 下标 10 = 付与对象种类：82 配 3 Member、113 配 1（错配 = C16102）。"""
        tree, _ = self.tree("2")
        for node in wf_dsl.iter_dsl_commands(tree, "CreateCondition"):
            name = node[2][0][0]
            if name in ("ACPiercing", "ACFixedSpeed"):
                self.assertEqual(node[10], 3)
                self.assertEqual(node[1], K.BIND_TEAM)
            if name == "ACDirectDamage":
                self.assertEqual(node[10], 1)
                self.assertEqual(node[1], K.BIND_WIND)

    def test_selectors_and_element_filter(self):
        tree, _ = self.tree("2")
        found = {}
        for node in wf_dsl.iter_dsl_commands(tree, "FindAllSubjects"):
            found[node[2]] = node
        self.assertIn(K.SELECTOR_MAIN_PARTY, found)
        self.assertIn(K.SELECTOR_ELEMENT, found)
        self.assertEqual(found[K.SELECTOR_ELEMENT][3], [K.DSL_WIND])

    def test_effects_stay_on_the_official_template_paths(self):
        tree, gates = self.tree("2")
        self.assertEqual(set(gates["effect_paths"]), set(K.OFFICIAL_FX_PATHS))
        self.assertEqual(gates["effect_rewrites"], None)

    def test_all_dsl_gates_pass(self):
        for level in ("1", "2"):
            tree, _ = self.tree(level)
            self.assertEqual(K.dsl_problems(tree), [], level)

    def test_a_drifted_donor_is_caught(self):
        tree = K.donor_tree(ctx(), "2")
        K.drop_power_flip_block(tree)
        with self.assertRaises(KL.KitError):
            K.drop_power_flip_block(tree)          # 第二次就没有第二条语句了


@unittest.skipUnless(_BASELINE, "需要 .cdn/cn 官方归档与 live store")
class EncoreTreeTests(unittest.TestCase):
    def build(self):
        block = DESIGN["plan_rework1"]["skills"]["values"]
        level = str(block["encore_level"])
        values = dict(block[level])
        values["hit_area_damage_kind"] = block["hit_area_damage_kind"]
        return K.build_encore_tree(ctx(), level, values, None)

    def test_encore_carries_only_the_damage_block(self):
        tree, gates = self.build()
        self.assertEqual(len(K.statements(tree)), 1)
        self.assertEqual(gates["team_blocks"], 0)
        self.assertEqual(list(wf_dsl.iter_dsl_commands(tree, "CreateCondition")), [])

    def test_encore_never_stops_the_ball(self):
        tree, gates = self.build()
        self.assertEqual(gates["stop_ball_removed"], 1)
        self.assertEqual(json.dumps(tree).count("StopBall"), 0)

    def test_encore_combo_bonus_is_always_on_and_unbranched(self):
        tree, _ = self.build()
        attacks = list(wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack"))
        self.assertEqual(len(attacks), 2)
        self.assertTrue(all(a[K.CNA_COMBO_SLOT] is True for a in attacks))
        self.assertEqual(json.dumps(tree).count("ConditionalsChangeSkillFlag"), 0)

    def test_encore_keeps_the_direct_attack_attribution(self):
        tree, _ = self.build()
        self.assertEqual(tree[10], 0)                 # 根 buffTargetAs 保持自动档
        for area in wf_dsl.iter_dsl_commands(tree, "CreateHitArea"):
            self.assertEqual(area[K.HIT_AREA_DAMAGE_SLOT], 4)

    def test_encore_dsl_gates_pass(self):
        tree, gates = self.build()
        self.assertEqual(K.dsl_problems(tree), [])
        self.assertEqual(set(gates["effect_paths"]), set(K.OFFICIAL_FX_PATHS))


# ---------------------------------------------------------------- 3. 已构建的包

@unittest.skipUnless((WORKSPACE / "package").is_dir(), "workspace 还没构建")
class PackageTests(unittest.TestCase):
    def pkg(self) -> Path:
        return WORKSPACE / "package" / "roots" / "common"

    def test_three_dsl_programs_are_in_the_package(self):
        want = [f"battle/action/skill/action/rare5/{K.CODE}${K.CODE}_1",
                f"battle/action/skill/action/rare5/{K.CODE}${K.CODE}_2",
                K.ENCORE_PROGRAM]
        for program in want:
            path = self.pkg() / wf_dsl.dsl_logical(program)
            self.assertTrue(path.is_file(), program)

    def test_custom_ability_string_carries_exactly_our_nine_keys(self):
        """多行 desc_override 的 ``\\n`` 必须活过 orderedmap 的 CSV 编解码（同 hibiki 的等价用例）。"""
        blob = core.read_orderedmap_file_from_bytes(
            (self.pkg() / KL.CAS).read_bytes())
        ours = {k for k in blob if k in K.CAS_TEXTS}
        self.assertEqual(ours, set(K.CAS_TEXTS))
        for key, text in K.CAS_TEXTS.items():
            self.assertEqual(C.csv_split(blob[key])[0][0], text, key)
        # 改键名前写出来的旧条目不许留在包里（否则 manifest 的 claimed_keys 会一直红）
        self.assertNotIn(f"ability_skill_{K.CODE}_encore", blob)

    def test_package_has_no_unique_condition_table(self):
        self.assertFalse((self.pkg() / MS.UNIQUE_CONDITION_LOGICAL).is_file())

    def test_manifest_declares_both_capabilities(self):
        manifest = json.loads((WORKSPACE / "package" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(manifest["required_capabilities"]),
                         sorted(K.SPEC["required_capabilities"]))

    def test_package_does_not_clone_any_effect_family(self):
        """裁决 §4：特效优先直接引用官方路径，零克隆零图集增量。"""
        self.assertFalse((self.pkg() / "battle" / "effect" / "skill_unique" / K.CODE).exists())


if __name__ == "__main__":
    unittest.main()
