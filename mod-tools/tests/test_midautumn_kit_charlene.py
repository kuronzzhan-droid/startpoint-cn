# -*- coding: utf-8 -*-
"""夏琳（139992 ``artificialeye_sniper_moon``）kit 的单测。

纯静态用例（方案自洽、面板文案规则、DSL 变形器）永远跑；
需要官方基线 / live store 的集成用例在缺环境时自动跳过（与 ``test_midautumn_framework`` 同口径）。
不写 live store / ``assets/`` / ``.cdn``，不跑发布，不碰设备。
"""
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_midautumn_common as MC  # noqa: E402
import wf_midautumn_kit_charlene as KIT  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_mod_tool as core  # noqa: E402
import wf_seasonal7_build as B  # noqa: E402


def _live_available() -> bool:
    profile = core.resolve_profile()
    return (profile is not None and profile.store.is_dir()
            and (core.project_root() / "assets" / "mana_node.json").is_file()
            and (core.project_root() / ".cdn" / "cn").is_dir())


_LIVE = _live_available()
_CTX = None


def ctx():
    """只读探针包（``record_sources=False``，不写 workspace，见框架文档 §10.2）。"""
    global _CTX
    if _CTX is None:
        _CTX = B.KitContext(MC.MAPack(MS.get_spec(KIT.KEY), record_sources=False))
    return _CTX


def donor_tree(level: str):
    context = ctx()
    return context.template_dsl(
        context.program_path(level).replace(KIT.CODE, KIT.TEMPLATE_CODE))


# ---------------------------------------------------------------- 静态：方案自洽

class PlanTests(unittest.TestCase):
    def test_identity_matches_the_roster(self):
        spec = MS.SPECS[KIT.KEY]
        self.assertEqual((spec.cid, spec.code, spec.element, spec.rarity),
                         (KIT.CID, KIT.CODE, KIT.ELEMENT, 5))
        self.assertEqual(spec.template_code, KIT.TEMPLATE_CODE)
        self.assertEqual(spec.template_id, 131176)
        self.assertEqual(spec.pf_type, 2)                     # 射击
        self.assertEqual(spec.element_token, KIT.ELEMENT_TOKEN)
        self.assertEqual(str(spec.cid), KIT.CID_S)

    def test_spec_declares_only_the_voice_key(self):
        self.assertEqual(SPEC_KEYS := set(KIT.SPEC["extra_keys"]), {KL.SWITCHED})
        self.assertEqual(KIT.SPEC["extra_keys"][KL.SWITCHED], (KIT.VOICE_KEY,))
        self.assertEqual(KIT.VOICE_KEY, KIT.CODE + "_voice_ready")
        # 无固有状态、无 custom_ability_string ⇒ 不占 8 位固有 ID，也不需要 APK 补丁 kind
        self.assertNotIn(MS.UNIQUE_CONDITION_LOGICAL, SPEC_KEYS)
        self.assertNotIn(KL.CAS, SPEC_KEYS)
        self.assertEqual(tuple(KIT.SPEC["required_capabilities"]), ())

    def test_merged_spec_carries_the_kit_overrides(self):
        spec = MS.get_spec(KIT.KEY)
        self.assertEqual(spec.stance, "Jammer")
        self.assertEqual(spec.extra_keys.get(KL.SWITCHED), (KIT.VOICE_KEY,))
        self.assertEqual(tuple(spec.required_capabilities), ())

    def test_ability_keys_are_the_six_character_slots(self):
        self.assertEqual(sorted(KIT.ABILITY), [f"{KIT.CID_S}{n}" for n in range(1, 7)])
        self.assertEqual(len(KIT.LEADER), 5)
        self.assertEqual(sum(len(v) for v in KIT.ABILITY.values()), 10)

    def test_every_ability_key_has_a_single_statue_group(self):
        """裁决 §8：一键内 c2 必须单值（官方 790 个多记录键 0 个混用）。"""
        for key, records in KIT.ABILITY.items():
            groups = {cells.get(2) for _donor, cells, _expect in records}
            self.assertEqual(groups, {KIT.STATUE_GROUP}, key)

    def test_statue_group_is_a_known_enum(self):
        import wf_client_legality as L
        self.assertIn(KIT.STATUE_GROUP, L.ABILITY_STATUE_GROUPS)

    def test_ability_string_ids_follow_code_slot(self):
        for key, records in KIT.ABILITY.items():
            for _donor, cells, _expect in records:
                self.assertEqual(cells[0], f"{KIT.CODE}_{key[-1]}", key)

    def test_leader_rows_carry_the_code_as_string_id(self):
        for _donor, cells, _expect in KIT.LEADER:
            self.assertEqual(cells[0], KIT.CODE)

    def test_donor_references_are_official_and_parsable(self):
        for donor, _cells, _expect in KIT.LEADER + tuple(
                rec for recs in KIT.ABILITY.values() for rec in recs):
            key, sep, index = donor.partition("#")
            self.assertTrue(sep and key.isdigit() and index.isdigit(), donor)

    def test_no_row_declares_a_capability(self):
        """15 条行全部由客户端原生渲染 ⇒ 不需要任何 APK 补丁 kind。"""
        self.assertEqual(tuple(KIT.SPEC["required_capabilities"]), ())


# ---------------------------------------------------------------- 静态：面板文案

class PanelTextTests(unittest.TestCase):
    def test_texts_pass_the_batch_rules(self):
        for name in ("title", "profile", "skill1", "desc1", "skill2", "desc2", "leader"):
            self.assertEqual(KL.panel_problems(KIT.TEXTS[name]), [], name)

    def test_expected_panel_lines_pass_the_batch_rules(self):
        for _donor, _cells, expect in KIT.LEADER:
            self.assertEqual(KL.panel_problems(expect), [], expect)
        for records in KIT.ABILITY.values():
            for _donor, _cells, expect in records:
                self.assertEqual(KL.panel_problems(expect), [], expect)

    def test_no_always_true_hp_condition_text(self):
        for _donor, _cells, expect in KIT.LEADER:
            self.assertNotIn("生命值", expect)
        for records in KIT.ABILITY.values():
            for _donor, _cells, expect in records:
                self.assertNotIn("生命值", expect)

    def test_texts_are_complete(self):
        self.assertEqual(sorted(KIT.TEXTS), sorted(
            ["name", "furigana", "profile", "title", "skill1", "desc1",
             "skill2", "desc2", "leader", "cv"]))
        self.assertTrue(all(KIT.TEXTS.values()))
        self.assertNotIn("（待设计稿）", "".join(KIT.TEXTS.values()))

    def test_skill_descriptions_mention_every_condition_family(self):
        """面板文案必须与真实机制一致：技能真给四种弱体。"""
        for level in ("1", "2"):
            desc = KIT.TEXTS[f"desc{level}"]
            for token in ("抗性降低", "攻击力降低", "麻痹", "中毒", "无视弱体耐性"):
                self.assertIn(token, desc, level)


# ---------------------------------------------------------------- 静态：语音路由

class VoiceRouteTests(unittest.TestCase):
    def test_route_targets_the_declared_switch_key(self):
        cols = KL.voice_route(KIT.CODE, KIT.VOICE_ROUTE)
        self.assertEqual(cols, ["1", "3", "0", "", "", KIT.VOICE_KEY, "false", "false"])
        self.assertEqual(KL.switch_key(KIT.CODE), KIT.VOICE_KEY)

    def test_route_kind_is_condition_exist(self):
        # kind 1 = ConditionExist；条件种类 3 = AttackPointUp（词条 1399923#0 的 15 秒团队攻击力）
        self.assertEqual(KIT.VOICE_ROUTE["kind"], 1)
        self.assertEqual(KIT.VOICE_ROUTE["condition_kind"], "3")


# ---------------------------------------------------------------- 静态：DSL 变形器

def _fake_donor_tree(**overrides):
    """母本 on-hit 结构的最小替身，用来在不碰官方基线的情况下测 :func:`KIT.mutate_tree`。"""
    prefix = KIT.OFFICIAL_EFFECT_PREFIX
    def show(name):
        return ["Command", ["ShowEffect", name, ["SpecifyEffectDirectly", prefix + name],
                            2, ["ForesideOfCharacter"], ["PlayOnlyFirstSequence"], ["CD"],
                            0, 0, 0, False, False, ["Some", [{"min": 2, "max": 2}]]]]
    condition = ["Command", ["CreateCondition", 3,
                             [["ACToleranceOfElement", [{"min": 960, "max": 960}], 3,
                               [{"min": -0.2, "max": -0.2, "alv_min": -0.05, "alv_max": -0.1}],
                               [{"min": 1, "max": 1}]]],
                             [{"min": 1, "max": 1}], ["GenericConditionHitEffect"],
                             True, False, "", None, False,
                             overrides.get("target_kind", 3), [{"min": 1, "max": 1}],
                             overrides.get("force_apply", False)]]
    onhit = ["Block", [["Command", ["ShakeCamera", 2]],
                       ["Command", ["CreateNormalAttack", 3, overrides.get("element", 255),
                                    [], [], 200, [{"min": 20, "max": 20}], [{"min": 0, "max": 0}],
                                    False, False, False, False, False,
                                    [{"min": 10, "max": 10}], [{"min": 10, "max": 10}],
                                    ["None"], True]],
                       condition, show("hiteffect")]]
    move_block = ["Block", [["Command", ["MoveHitArea", 0, 0, 0, 0]], show("bullet")]]
    hit_area = ["Command", ["CreateHitArea", "", -18, ["GH", 0], move_block, onhit]]
    body = ["Block", [["Command", ["StopBall", -18, 50, ["Stop"], ["GH", 0], 0]],
                      show("target"), show("charge"), show("shoot"), hit_area]]
    find = ["Command", ["FindNearSubjects", -18, 1, 49,
                        ["CreateImaginaryTarget", -100000], 0, body]]
    return ["ActionDsl", overrides.get("movement_priority", 2), ["None"],
            False, False, False, False, False, False, False,
            overrides.get("buff_target_as", 0), ["Block", [find]]]


class MutateTreeTests(unittest.TestCase):
    def test_fake_donor_matches_the_expected_command_counts(self):
        self.assertEqual(KIT._command_counts(_fake_donor_tree()), KIT.DONOR_COMMAND_COUNTS)

    def test_multiplier_and_conditions_are_rewritten(self):
        for level, (low, high) in KIT.SKILL_MULTIPLIER.items():
            tree, ev = KIT.mutate_tree(_fake_donor_tree(), level)
            (parent, index), = KIT._command_slots(tree, "CreateNormalAttack")
            self.assertEqual(parent[index][1][6], [{"min": low, "max": high}])
            self.assertEqual(ev["create_normal_attack"]["after"], [{"min": low, "max": high}])
            slots = KIT._command_slots(tree, "CreateCondition")
            self.assertEqual(len(slots), len(KIT.CONDITIONS))
            for (parent, index), (name, ac, force) in zip(slots, KIT.CONDITIONS):
                body = parent[index][1]
                self.assertEqual(body[2], [ac], name)
                self.assertIs(body[12], force, name)
                self.assertEqual(body[10], 3, name)          # 付与对象种类原样保留
                self.assertEqual(len(body), 13, name)

    def test_conditions_stay_adjacent_and_keep_the_command_order(self):
        tree, _ev = KIT.mutate_tree(_fake_donor_tree(), "1")
        (parent, first), = [(p, i) for p, i in KIT._command_slots(tree, "CreateCondition")][:1]
        names = [child[1][0] for child in parent]
        self.assertEqual(names, ["ShakeCamera", "CreateNormalAttack"]
                         + ["CreateCondition"] * len(KIT.CONDITIONS) + ["ShowEffect"])

    def test_condition_parameter_shapes_are_slv_wrapped(self):
        """裸数值进 Array 参 = 详情页 F1034（记忆 wf-dsl-param-shape-f1034）。"""
        shapes = {"ACToleranceOfElement": ["Array", "int", "Array", "Array"],
                  "ACAttackPoint": ["Array", "Array", "Array"],
                  "ACParalysis": ["Array", "Boolean"],
                  "ACPoison": ["Array", "Array", "Array"]}
        for _name, ac, _force in KIT.CONDITIONS:
            want = shapes[ac[0]]
            self.assertEqual(len(ac) - 1, len(want), ac[0])
            for value, kind in zip(ac[1:], want):
                if kind == "Array":
                    self.assertIsInstance(value, list, ac[0])
                    self.assertTrue(value and all(isinstance(x, dict) for x in value), ac[0])
                elif kind == "int":
                    self.assertIsInstance(value, int, ac[0])
                else:
                    self.assertIsInstance(value, bool, ac[0])

    def test_tolerance_uses_the_all_element_code(self):
        """boss 的 resist_element_resistance 是白名单，只放行 254；写单元素码被静默硬拒。"""
        tolerance = {name: ac for name, ac, _f in KIT.CONDITIONS}["tolerance_all"]
        self.assertEqual(tolerance[0], "ACToleranceOfElement")
        self.assertEqual(tolerance[2], 254)
        self.assertLess(tolerance[3][0]["max"], 0)           # 负值 = 抗性降低

    def test_force_apply_only_on_the_two_stat_debuffs(self):
        """裁决 §2：麻痹不对 boss 强制付与；毒同理。"""
        forced = {name for name, _ac, force in KIT.CONDITIONS if force}
        self.assertEqual(forced, {"tolerance_all", "attack_down"})

    def test_four_distinct_debuff_families(self):
        """D136 数的是敌人身上同时存在的弱体条数 ⇒ 必须四条不同 kind。"""
        families = [ac[0] for _name, ac, _f in KIT.CONDITIONS]
        self.assertEqual(len(families), 4)
        self.assertEqual(len(set(families)), 4)

    def test_effect_refs_stay_on_official_paths(self):
        tree, ev = KIT.mutate_tree(_fake_donor_tree(), "1")
        self.assertEqual(len(ev["effect_refs"]), 5)
        for path in KIT.effect_paths(tree):
            self.assertTrue(path.startswith(KIT.OFFICIAL_EFFECT_PREFIX), path)

    def test_drifted_donor_is_rejected(self):
        tree = _fake_donor_tree()
        tree[11][1].append(["Command", ["ShakeCamera", 1]])
        with self.assertRaises(KIT.CharleneError):
            KIT.mutate_tree(tree, "1")

    def test_element_slot_must_stay_255(self):
        with self.assertRaises(KIT.CharleneError):
            KIT.mutate_tree(_fake_donor_tree(element=3), "1")

    def test_buff_target_as_must_stay_auto(self):
        with self.assertRaises(KIT.CharleneError):
            KIT.mutate_tree(_fake_donor_tree(buff_target_as=4), "1")

    def test_unexpected_condition_target_kind_is_rejected(self):
        with self.assertRaises(KIT.CharleneError):
            KIT.mutate_tree(_fake_donor_tree(target_kind=1), "1")

    def test_donor_force_apply_must_start_false(self):
        with self.assertRaises(KIT.CharleneError):
            KIT.mutate_tree(_fake_donor_tree(force_apply=True), "1")

    def test_mutate_does_not_mutate_the_caller_copy(self):
        original = _fake_donor_tree()
        snapshot = copy.deepcopy(original)
        KIT.mutate_tree(copy.deepcopy(original), "1")
        self.assertEqual(original, snapshot)


class EnergyTests(unittest.TestCase):
    def test_energy_is_the_template_supporter_tier(self):
        self.assertEqual(KIT.SKILL_ENERGY, {"1": ("500", "500"), "2": ("500", "450")})

    def test_multiplier_band(self):
        """裁决 §2：辅助技能 36–50×（单发贯通弹 ⇒ 总倍率 = CNA 倍率）。"""
        self.assertLessEqual(36, KIT.SKILL_MULTIPLIER["2"][1])
        self.assertLessEqual(KIT.SKILL_MULTIPLIER["2"][1], 50)
        self.assertLess(KIT.SKILL_MULTIPLIER["1"][1], KIT.SKILL_MULTIPLIER["2"][1])


# ---------------------------------------------------------------- 集成：官方基线

@unittest.skipUnless(_LIVE, "需要 live store 与 .cdn/cn 官方基线")
class OfficialRowTests(unittest.TestCase):
    """donor + 逐格改 → wf_client_legality 全空 → wf_describe 与登记文案逐字相同。"""

    def test_leader_rows_build_clean(self):
        for index, (donor, cells, expect) in enumerate(KIT.LEADER):
            row, ev = KL.build_row(ctx(), "leader_ability", donor, cells,
                                   expect_describe=expect, label=f"leader#{index}")
            self.assertEqual(len(row), KL.LEADER_NCOLS)
            self.assertEqual(ev["capabilities"], [])
            self.assertEqual(KL.row_problems("leader_ability", row), {})

    def test_leader_table_carries_no_patch_only_kinds(self):
        """裁决 §8 / 记忆 wf-dash-parameter-leader-table-trap：422/724/713 写队长表 = C7050。"""
        import wf_describe
        blocks = wf_describe.layout("leader_ability")["blocks"]
        banned = {"422", "724", "713"}
        for index, (donor, cells, _expect) in enumerate(KIT.LEADER):
            row, _ev = KL.build_row(ctx(), "leader_ability", donor, cells, label=f"leader#{index}")
            for name in ("instant_content", "during_content"):
                self.assertNotIn(row[int(blocks[name])], banned, f"leader#{index} {name}")

    def test_ability_rows_build_clean(self):
        for key, records in KIT.ABILITY.items():
            built = []
            for index, (donor, cells, expect) in enumerate(records):
                row, ev = KL.build_row(ctx(), "ability", donor, cells, element=KIT.ELEMENT,
                                       expect_describe=expect, label=f"{key}#{index}")
                self.assertEqual(len(row), KL.ABILITY_NCOLS)
                self.assertEqual(ev["capabilities"], [])
                self.assertEqual(KL.row_problems("ability", row, KIT.ELEMENT), {})
                built.append(row)
            KL.check_ability_key(built, key, KIT.CODE, int(key[-1]))
            self.assertEqual({r[2] for r in built}, {KIT.STATUE_GROUP}, key)

    def test_ability_main_slot_flags_are_consistent_per_key(self):
        """Ⓜ 只在词条 3（主位限制 c1=false），其余五键可副位。"""
        want = {f"{KIT.CID_S}3": "false"}
        for key, records in KIT.ABILITY.items():
            built = [KL.build_row(ctx(), "ability", donor, cells, label=f"{key}")[0]
                     for donor, cells, _expect in records]
            self.assertEqual({r[1] for r in built}, {want.get(key, "true")}, key)

    def test_no_unique_condition_key_is_written(self):
        spec = MS.get_spec(KIT.KEY)
        self.assertEqual(spec.extra_keys.get(MS.UNIQUE_CONDITION_LOGICAL, ()), ())


@unittest.skipUnless(_LIVE, "需要 live store 与 .cdn/cn 官方基线")
class OfficialSkillTreeTests(unittest.TestCase):
    def test_donor_trees_have_the_expected_shape(self):
        for level in ("1", "2"):
            tree = donor_tree(level)
            self.assertEqual(KIT._command_counts(tree), KIT.DONOR_COMMAND_COUNTS, level)
            self.assertEqual(tree[0], "ActionDsl")
            self.assertEqual((tree[1], tree[10]), (2, 0), level)

    def test_mutated_trees_carry_four_conditions_and_official_effects(self):
        for level, (low, high) in KIT.SKILL_MULTIPLIER.items():
            tree, ev = KIT.mutate_tree(donor_tree(level), level)
            self.assertEqual(KIT._command_counts(tree)["CreateCondition"], len(KIT.CONDITIONS))
            (parent, index), = KIT._command_slots(tree, "CreateNormalAttack")
            self.assertEqual(parent[index][1][6], [{"min": low, "max": high}])
            for path in ev["effect_refs"]:
                self.assertTrue(path.startswith(KIT.OFFICIAL_EFFECT_PREFIX), path)

    def test_mutated_trees_survive_the_amf3_roundtrip(self):
        """``amf_bytes`` 只吃裸树；喂 {tree, numbers} 包装壳 = 进战斗 F1034。"""
        for level in ("1", "2"):
            tree, _ev = KIT.mutate_tree(donor_tree(level), level)
            raw = ctx().amf_bytes(tree)
            self.assertEqual(ctx().amf_parse(raw), tree, level)

    def test_program_paths_are_the_new_code(self):
        for level in ("1", "2"):
            path = ctx().program_path(level)
            self.assertIn(KIT.CODE, path)
            self.assertIn("rare5", path)


@unittest.skipUnless(_LIVE, "需要 live store 与 .cdn/cn 官方基线")
class DesignCrosscheckTests(unittest.TestCase):
    def test_design_json_agrees_with_the_kit(self):
        path = MS.design_path(ctx().root, KIT.KEY)
        if not path.is_file():
            self.skipTest("design/charlene.json 不在（work/ 未恢复）")
        result = KIT.design_crosscheck(ctx())
        self.assertTrue(result["present"])
        self.assertIn("statue_group", result["checked"])

    def test_design_json_registers_the_statue_group_deviation(self):
        path = MS.design_path(ctx().root, KIT.KEY)
        if not path.is_file():
            self.skipTest("design/charlene.json 不在（work/ 未恢复）")
        design = json.loads(path.read_text(encoding="utf-8"))
        ids = {item.get("id") for item in design.get("deviations", [])}
        self.assertIn("D9", ids)


# ---------------------------------------------------------------- 集成：包产物

def _package_ready() -> bool:
    if not _LIVE:
        return False
    workspace = core.project_root() / MS.SPECS[KIT.KEY].workspace
    return (workspace / "evidence" / "kit-report.json").is_file()


@unittest.skipUnless(_package_ready(), "需要先跑 --step init,tables,kit,assets,manifest")
class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ctx = B.KitContext(MC.MAPack(MS.get_spec(KIT.KEY), record_sources=False))
        cls.report = json.loads(
            (cls.ctx.pack.evidence / "kit-report.json").read_text(encoding="utf-8"))

    def test_report_shape(self):
        self.assertEqual(self.report["cid"], KIT.CID)
        self.assertEqual(self.report["code"], KIT.CODE)
        self.assertEqual(self.report["status"], KL.DRAFT)
        self.assertEqual(self.report["required_capabilities"], [])
        self.assertEqual(len(self.report["skills"]["programs"]), 2)
        self.assertNotIn("unique_condition", self.report)
        self.assertTrue(self.report["deviations"])

    def test_package_rows_match_the_plan(self):
        leader = self.ctx.csv_split(
            self.ctx.pkg_flat(KL.LEADER)[KIT.CID_S])
        self.assertEqual(len(leader), len(KIT.LEADER))
        for row, (_donor, _cells, expect) in zip(leader, KIT.LEADER):
            self.assertEqual(KL.describe("leader_ability", row), expect)
        ability = self.ctx.pkg_flat(KL.ABILITY)
        for key, records in KIT.ABILITY.items():
            rows = self.ctx.csv_split(ability[key])
            self.assertEqual(len(rows), len(records), key)
            for row, (_donor, _cells, expect) in zip(rows, records):
                self.assertEqual(KL.describe("ability", row), expect)
            self.assertEqual({r[2] for r in rows}, {KIT.STATUE_GROUP}, key)

    def test_package_character_row_carries_the_voice_route(self):
        row = self.ctx.pack.pkg_character_row()
        self.assertEqual(row[9:17], KL.voice_route(KIT.CODE, KIT.VOICE_ROUTE))
        self.assertEqual(row[18], KIT.TEXTS["leader"])
        self.assertEqual(row[26], "Jammer")
        self.assertEqual(row[27], KIT.CID_S)

    def test_package_action_skill_names_and_energy(self):
        inner = self.ctx.pkg_nested(KIT.CODE, KL.ACTION)
        self.assertEqual(sorted(inner), ["1", "2"])
        for level, cells in inner.items():
            self.assertEqual(cells[0], KIT.TEXTS[f"skill{level}"])
            self.assertEqual(cells[1], KIT.TEXTS[f"desc{level}"])
            self.assertEqual((cells[4], cells[5]), KIT.SKILL_ENERGY[level])
            self.assertEqual(cells[7], self.ctx.program_path(level))

    def test_package_switched_action_skill_exists(self):
        inner = self.ctx.pkg_nested(KIT.VOICE_KEY, KL.SWITCHED)
        self.assertEqual(sorted(inner), ["1", "2"])

    def _package_tree(self, level: str):
        import wf_dsl
        logical = wf_dsl.dsl_logical(self.ctx.program_path(level))
        return self.ctx.amf_parse(self.ctx.pack.pkg_path("common", logical).read_bytes())

    def test_package_skill_trees_carry_four_conditions(self):
        for level in ("1", "2"):
            tree = self._package_tree(level)
            counts = KIT._command_counts(tree)
            self.assertEqual(counts["CreateCondition"], len(KIT.CONDITIONS), level)
            self.assertEqual(counts["CreateNormalAttack"], 1, level)
            for path in KIT.effect_paths(tree):
                self.assertTrue(path.startswith(KIT.OFFICIAL_EFFECT_PREFIX), path)

    def test_package_condition_nodes_keep_the_ac_list_nesting(self):
        """下标 2 是 AC **列表**；少一层嵌套往返自检抓不到，进战斗才炸。"""
        for level in ("1", "2"):
            tree = self._package_tree(level)
            slots = KIT._command_slots(tree, "CreateCondition")
            self.assertEqual(len(slots), len(KIT.CONDITIONS), level)
            for (parent, index), (name, ac, force) in zip(slots, KIT.CONDITIONS):
                body = parent[index][1]
                self.assertEqual(body[2], [ac], f"{level}/{name}")
                self.assertIs(body[12], force, f"{level}/{name}")
                self.assertEqual(body[10], 3, f"{level}/{name}")

    def test_package_skill_multiplier_matches_the_plan(self):
        for level, (low, high) in KIT.SKILL_MULTIPLIER.items():
            (parent, index), = KIT._command_slots(self._package_tree(level), "CreateNormalAttack")
            self.assertEqual(parent[index][1][6], [{"min": low, "max": high}], level)
            self.assertEqual(parent[index][1][2], 255, level)

    def test_package_has_no_effect_clones(self):
        """零克隆 ⇒ 包里不含 battle/effect 目录 ⇒ 战斗图集增量为 0。"""
        effects = self.ctx.pack.package / "roots" / "common" / "battle" / "effect"
        self.assertFalse(effects.exists())

    def test_package_has_no_custom_ability_string_claim(self):
        """零 629、零 desc_override ⇒ 本包不该认领任何 custom_ability_string。

        ``tables`` 会从母本克隆 ChangeSkillFlag 的 ``change_skill_<code>``；本套件没有
        ChangeSkillFlag 行，:func:`KIT.drop_orphan_change_skill` 必须把它撤掉。
        """
        entry = next((claim for claim in self.ctx.pack.load_claims()
                      if (claim["root"], claim["logical_path"]) == ("common", KL.CAS)), None)
        self.assertIsNone(entry, entry)

    def test_orphan_change_skill_string_is_gone_from_the_package(self):
        path = self.ctx.pack.pkg_path("common", KL.CAS)
        if not path.is_file():
            return                                   # 表已整体删除（与底表逐行相同）
        self.assertNotIn(KIT.ORPHAN_CAS_KEY, self.ctx.pkg_flat(KL.CAS))

    def test_drop_orphan_change_skill_is_idempotent(self):
        result = KIT.drop_orphan_change_skill(self.ctx)
        self.assertFalse(result["still_claimed"])
        self.assertNotIn("unclaimed", result)        # 已经撤过，重跑不再动认领
        self.assertNotIn("package_table_deleted", result)


if __name__ == "__main__":
    unittest.main()
