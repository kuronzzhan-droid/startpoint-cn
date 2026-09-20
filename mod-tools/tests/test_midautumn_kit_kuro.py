# -*- coding: utf-8 -*-
"""黑（139991 ``outlaw_panther_moon``）kit 的单测。

纯静态用例（方案自洽、裁决 §8 的自查项、面板文案规则、DSL 变形器、图标绘制）永远跑；
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

import wf_client_legality as L  # noqa: E402
import wf_midautumn_common as MC  # noqa: E402
import wf_midautumn_kit_kuro as KIT  # noqa: E402
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
    return ctx().template_dsl(KIT.donor_program(ctx(), level))


def split_donor(donor: str) -> tuple[str, str]:
    """``live:1499893#1`` → ``("live", "1499893#1")``；``2310694#0`` → ``("official", …)``。"""
    head, _, tail = donor.partition("live:")
    return ("live", tail) if tail else ("official", head)


# ---------------------------------------------------------------- 静态：方案自洽

class PlanTests(unittest.TestCase):
    def test_identity_matches_the_roster(self):
        spec = MS.SPECS[KIT.KEY]
        self.assertEqual((spec.cid, spec.code, spec.element, spec.rarity),
                         (KIT.CID, KIT.CODE, KIT.ELEMENT, 5))
        self.assertEqual(spec.template_code, KIT.TEMPLATE_CODE)
        self.assertEqual(spec.template_id, KIT.TEMPLATE_ID)
        self.assertEqual(spec.pf_type, KIT.PF_TYPE)              # 1 = 拳
        self.assertEqual(spec.element_token, KIT.ELEMENT_TOKEN)
        self.assertEqual(str(spec.cid), KIT.CID_S)

    def test_unique_condition_id_is_eight_digits(self):
        """裁决 §1：固有状态 ID 一律 8 位 ``cid*100+n``（7 位撞过基诺维 1699901/02）。"""
        self.assertEqual(KIT.UID, "13999101")
        self.assertEqual(len(KIT.UID), 8)
        self.assertEqual(KIT.UID, str(KIT.CID * 100 + 1))
        self.assertTrue(MS.unique_condition_ok(KIT.CID, KIT.UID))

    def test_spec_declares_every_kit_owned_key(self):
        keys = KIT.SPEC["extra_keys"]
        self.assertEqual(set(keys), {KL.UNIQUE, KL.SWITCHED})
        self.assertEqual(keys[KL.UNIQUE], (KIT.UID,))
        self.assertEqual(keys[KL.SWITCHED], (KIT.VOICE_KEY,))
        self.assertEqual(KIT.VOICE_KEY, KIT.CODE + "_voice_ready")
        # 本套件没有 629／ability_skill 字符串键，也没有 desc_override
        self.assertNotIn(KL.CAS, keys)
        self.assertEqual(tuple(KIT.SPEC["required_capabilities"]), ("kyubi-fever-ratio-v1",))

    def test_merged_spec_carries_the_kit_overrides(self):
        spec = MS.get_spec(KIT.KEY)
        self.assertEqual(spec.stance, KIT.STANCE)
        self.assertEqual(spec.extra_keys.get(KL.UNIQUE), (KIT.UID,))
        self.assertEqual(spec.extra_keys.get(KL.SWITCHED), (KIT.VOICE_KEY,))
        self.assertEqual(tuple(spec.required_capabilities), ("kyubi-fever-ratio-v1",))

    def test_ability_keys_are_the_six_character_slots(self):
        self.assertEqual(sorted(KIT.ABILITY), [f"{KIT.CID_S}{n}" for n in range(1, 7)])
        self.assertEqual(sorted(KIT.STATUE_GROUPS), sorted(KIT.ABILITY))
        self.assertEqual(len(KIT.LEADER), 4)
        self.assertEqual(sum(len(v) for v in KIT.ABILITY.values()), 13)

    def test_every_ability_key_has_a_single_statue_group(self):
        """裁决 §8：一键内 c2 必须单值（官方 790 个多记录键 0 个混用）。"""
        for key, records in KIT.ABILITY.items():
            groups = {cells.get(2) for _donor, cells, _expect in records}
            self.assertEqual(groups, {KIT.STATUE_GROUPS[key]}, key)

    def test_every_ability_key_has_a_single_unisonable_flag(self):
        for key, records in KIT.ABILITY.items():
            flags = {cells.get(1) for _donor, cells, _expect in records}
            self.assertEqual(len(flags), 1, key)
            self.assertIn(flags.pop(), {"true", "false"})

    def test_statue_groups_are_known_enums(self):
        for key, group in KIT.STATUE_GROUPS.items():
            self.assertIn(group, L.ABILITY_STATUE_GROUPS, key)

    def test_ability_c0_is_code_underscore_slot(self):
        for key, records in KIT.ABILITY.items():
            for index, (_donor, cells, _expect) in enumerate(records):
                self.assertEqual(cells.get(0), f"{KIT.CODE}_{key[-1]}", f"{key}#{index}")

    def test_leader_c0_is_the_code(self):
        for index, (_donor, cells, _expect) in enumerate(KIT.LEADER):
            self.assertEqual(cells.get(0), KIT.CODE, index)

    def test_only_one_row_carries_the_patch_kind(self):
        """724 是 APK 补丁 kind；只许在 ability 表，且本套件只有 1399913#0 用它。"""
        rows = [(key, index) for key, records in KIT.ABILITY.items()
                for index, (_d, cells, _e) in enumerate(records)
                if "724" in {cells.get(col) for col in KIT.ABILITY_KIND_COLUMNS}]
        self.assertEqual(rows, [("1399913", 0)])

    def test_leader_plan_never_uses_the_ability_only_kinds(self):
        """422/724/713 写进队长表 = C7050（裁决 §2、框架 §10.3）。"""
        for index, (_donor, cells, _expect) in enumerate(KIT.LEADER):
            for col in KIT.LEADER_KIND_COLUMNS:
                self.assertNotIn(cells.get(col), KIT.ABILITY_ONLY_KINDS, f"leader#{index} c{col}")

    def test_ability_plan_never_uses_the_c2308_kinds(self):
        """201/202/521 与取最大值类同键会撞 C2308；段数统一走技能 DSL。"""
        for key, records in KIT.ABILITY.items():
            for index, (_donor, cells, _expect) in enumerate(records):
                for col in KIT.ABILITY_KIND_COLUMNS:
                    self.assertNotIn(cells.get(col), KIT.C2308_KINDS, f"{key}#{index} c{col}")

    def test_unique_stack_ability_uses_during_134_not_194(self):
        """按层加成用 during 134（ConditionAccumulationCountUnique）；194 数实例恒为 1。"""
        stack_rows = [cells for _d, cells, _e in KIT.ABILITY["1399913"]
                      if cells.get(104) == KIT.UID]
        self.assertEqual(len(stack_rows), 1)
        self.assertEqual(stack_rows[0].get(97), "134")
        self.assertEqual(stack_rows[0].get(102), KIT.UNIQUE_CAP)   # 上限与固有行一致

    def test_unique_cap_is_a_number_not_none(self):
        """``(None)`` 会被读成上限 1，during 134 的叠层全死（记忆 wf-unique-cap-none-trap）。"""
        self.assertEqual(KIT.UNIQUE_CAP, "6")
        self.assertNotIn(KIT.UNIQUE_CAP, ("", "(None)"))

    def test_unique_stack_sources_point_at_our_own_unique(self):
        for index, (_donor, cells, _expect) in enumerate(KIT.ABILITY["1399914"]):
            self.assertEqual(cells.get(47), "461", index)
            self.assertEqual(cells.get(68), KIT.UID, index)

    def test_element_columns_are_all_yellow(self):
        """六属性口径：套件里出现的元素组一律雷（Yellow），不留母本的 White/Green/Black。"""
        stale = {"White", "Green", "Black", "Red", "Blue"}
        for key, records in KIT.ABILITY.items():
            for index, (_donor, cells, _expect) in enumerate(records):
                bad = {v for v in cells.values() if v in stale}
                self.assertFalse(bad, f"{key}#{index}: {bad}")
        for index, (_donor, cells, _expect) in enumerate(KIT.LEADER):
            bad = {v for v in cells.values() if v in stale}
            self.assertFalse(bad, f"leader#{index}: {bad}")

    def test_voice_route_targets_the_unique_condition(self):
        self.assertEqual(KIT.VOICE_ROUTE, {"kind": 1, "condition_kind": "28",
                                           "condition_id": KIT.UID})
        cols = KL.voice_route(KIT.CODE, KIT.VOICE_ROUTE)
        self.assertEqual(len(cols), 8)
        self.assertEqual(cols[:3], ["1", "28", KIT.UID])
        self.assertIn(KIT.VOICE_KEY, cols)

    def test_skill_energy_is_the_template_value(self):
        self.assertEqual(KIT.SKILL_ENERGY, {"1": ("490", "490"), "2": ("490", "440")})


# ---------------------------------------------------------------- 静态：面板文案

class PanelTests(unittest.TestCase):
    def test_registered_panel_text_obeys_the_batch_rules(self):
        for key, records in KIT.ABILITY.items():
            for index, (_donor, _cells, expect) in enumerate(records):
                self.assertEqual(KL.panel_problems(expect), [], f"{key}#{index}: {expect}")
        for index, (_donor, _cells, expect) in enumerate(KIT.LEADER):
            self.assertEqual(KL.panel_problems(expect), [], f"leader#{index}: {expect}")

    def test_texts_obey_the_batch_rules(self):
        for name in ("title", "skill1", "desc1", "skill2", "desc2", "leader", "profile"):
            self.assertEqual(KL.panel_problems(KIT.TEXTS[name]), [], name)

    def test_no_always_true_hp_condition_text(self):
        """裁决 §3：禁出「生命值100%以下」这类恒真条件文本。"""
        for _donor, _cells, expect in KIT.LEADER:
            self.assertNotIn("生命值100%以下", expect)
        for records in KIT.ABILITY.values():
            for _donor, _cells, expect in records:
                self.assertNotIn("生命值100%以下", expect)

    def test_skill_description_names_the_direct_attack_judgement(self):
        """S1 把判定区改成按直接攻击伤害判定 ⇒ 面板必须说出来（裁决 §3 文案与机制一致）。"""
        for level in ("1", "2"):
            self.assertIn("以直接攻击伤害判定", KIT.TEXTS[f"desc{level}"])
            self.assertIn("追加直接攻击", KIT.TEXTS[f"desc{level}"])
        self.assertEqual(KIT.TEXTS["desc1"], KIT.TEXTS["desc2"])

    def test_texts_have_the_ten_design_keys(self):
        self.assertEqual(sorted(KIT.TEXTS), sorted(
            ["name", "furigana", "title", "profile", "skill1", "desc1",
             "skill2", "desc2", "leader", "cv"]))


# ---------------------------------------------------------------- 静态：图标

class IconTests(unittest.TestCase):
    def _frame(self):
        from PIL import Image
        frame = Image.new("RGBA", (48, 48), (255, 255, 255, 255))
        for xy in ((0, 0), (47, 0), (0, 47), (47, 47)):
            frame.putpixel(xy, (255, 255, 255, 0))
        return frame

    def test_icon_keeps_the_frame_size_and_alpha(self):
        frame = self._frame()
        icon = KIT.draw_icon(frame)
        self.assertEqual(icon.size, (48, 48))
        self.assertEqual(icon.mode, "RGBA")
        self.assertEqual(icon.getchannel("A").tobytes(), frame.getchannel("A").tobytes())

    def test_icon_rejects_a_frame_of_the_wrong_size(self):
        from PIL import Image
        with self.assertRaises(KL.KitError):
            KIT.draw_icon(Image.new("RGBA", (32, 32)))

    def test_icon_is_gold_on_ink_and_has_a_bright_pip(self):
        icon = KIT.draw_icon(self._frame())
        pixels = [icon.getpixel((x, y)) for x in range(48) for y in range(48)]
        self.assertTrue(any(p[0] > 200 and p[1] > 200 and p[2] > 150 for p in pixels),
                        "看不到骰点/月牙的亮色")
        self.assertTrue(any(sum(p[:3]) < 150 for p in pixels), "看不到夜靛底")


# ---------------------------------------------------------------- 静态：DSL 变形器

DONOR_LEVEL_2 = ["ActionDsl", 2, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                 ["Block", [
                     ["Command", ["StopBall", -18, 75, ["Stop"], ["AB"], 0]],
                     ["Command", ["ShowEffect", "扇子を開く",
                                  ["SpecifyEffectDirectly",
                                   "battle/effect/skill_unique/outlaw_panther_ny22/"
                                   "outlaw_panther_ny22_open"],
                                  -18, ["ForesideOfCharacter"], ["PlayOnlyFirstSequence"],
                                  ["AB"], 0, 0, 0, True, False, ["None"]]],
                     ["Command", ["CreateHitArea", "*", -18, ["AB"], 0, 0, 0, True, False,
                                  ["Circle", [{"min": 300, "max": 300}]], ["Center"], ["Center"],
                                  ["Single"], ["SpecifyHitAreaLifetimeDirectly", 60],
                                  ["CalculatedUsingMaxNumOfHits", 15],
                                  ["Some", [{"min": 15, "max": 15}]], False, True, ["None"], 0,
                                  ["Block", [
                                      ["Command", ["ShowEffect", "回転演出",
                                                   ["SpecifyEffectDirectly",
                                                    "battle/effect/skill_unique/"
                                                    "outlaw_panther_ny22/"
                                                    "outlaw_panther_ny22_rotation"],
                                                   -18, ["ForesideOfCharacter"],
                                                   ["SpecifyEffectLifetimeDirectly", 60], ["AB"],
                                                   0, 0, 0, True, False,
                                                   ["Some", [{"min": 6, "max": 6}]]]],
                                      ["Command", ["ShowEffect", "紙吹雪演出",
                                                   ["SpecifyEffectDirectly",
                                                    "battle/effect/skill_unique/"
                                                    "outlaw_panther_ny22/"
                                                    "outlaw_panther_ny22_kamihubuki"],
                                                   -18, ["ForesideOfCharacter"],
                                                   ["SpecifyEffectLifetimeDirectly", 60], ["AB"],
                                                   0, 0, 0, True, False, ["None"]]]]],
                                  1, 2,
                                  ["Block", [
                                      ["Command", ["ShakeCamera", 1]],
                                      ["Command", ["CreateNormalAttack", 2, 255, [], [], 5,
                                                   [{"min": 0.6933333333333334, "max": 0.8}],
                                                   [{"min": 0, "max": 0}], False, False, False,
                                                   False, False,
                                                   [{"min": 0.8, "max": 0.8}],
                                                   [{"min": 0.8, "max": 0.8}], ["Fine"], True]]]],
                                  0, 0, ["None"]]],
                     ["Command", ["ShowEffect", "終了演出",
                                  ["SpecifyEffectDirectly",
                                   "battle/effect/skill_unique/outlaw_panther_ny22/"
                                   "outlaw_panther_ny22_close"],
                                  -18, ["ForesideOfCharacter"], ["PlayOnlyFirstSequence"],
                                  ["AB"], 0, 0, 0, True, False, ["None"]]],
                     ["Command", ["FindAllSubjects", 3, 33, [], [], [], [], [], ["DoNothing"],
                                  ["Block", [
                                      ["Command", ["CreateCondition", 3,
                                                   [["ACPowerFlipDamage",
                                                     [{"min": 900, "max": 900}],
                                                     [{"min": 0.4, "max": 0.5}],
                                                     [{"min": 1, "max": 1}]]],
                                                   [{"min": 1, "max": 1}],
                                                   ["GenericConditionHitEffect"], True, False,
                                                   "", None, False, 3,
                                                   [{"min": 1, "max": 1}], False]]]]]]]]]


class SkillMutationTests(unittest.TestCase):
    def setUp(self):
        self.tree = copy.deepcopy(DONOR_LEVEL_2)

    def mutated(self):
        return KIT.mutate_tree(self.tree, "2")

    def test_the_stub_donor_matches_the_command_fingerprint(self):
        self.assertEqual(KIT._command_counts(self.tree), KIT.DONOR_COMMAND_COUNTS)

    def test_s1_switches_the_hit_area_to_direct_attack_damage(self):
        tree, ev = self.mutated()
        (parent, index), = KIT._command_slots(tree, "CreateHitArea")
        self.assertEqual(parent[index][1][KIT.HITAREA_BUFF_TARGET_SLOT],
                         KIT.HITAREA_BUFF_TARGET_AS)
        self.assertEqual(ev["hit_area_buff_target_as"]["before"], 0)

    def test_s1_leaves_the_root_header_alone(self):
        """根头 tree[10] 是另一个 buffTargetAs（记忆 wf-dsl-damage-attribution-bufftargetas）。"""
        tree, _ev = self.mutated()
        self.assertEqual(tree[1], 2)
        self.assertEqual(tree[10], 0)

    def test_s2_rewrites_only_the_multiplier_slot(self):
        tree, ev = self.mutated()
        (parent, index), = KIT._command_slots(tree, "CreateNormalAttack")
        cna = parent[index][1]
        self.assertEqual(cna[6], KIT.SKILL_MULTIPLIER["2"][1])
        self.assertEqual(cna[2], 255)                      # 元素哨兵不动
        self.assertEqual(ev["create_normal_attack"]["before"], KIT.SKILL_MULTIPLIER["2"][0])

    def test_s3_replaces_the_pf_condition_with_a_direct_damage_one(self):
        tree, _ev = self.mutated()
        slots = KIT._command_slots(tree, "CreateCondition")
        self.assertEqual(len(slots), 2)
        parent, index = slots[0]
        self.assertEqual(parent[index][1][2], [KIT.SKILL_DIRECT_AC["2"][1]])
        self.assertEqual(parent[index][1][2][0][0], "ACDirectDamage")

    def test_s4_appends_the_additional_direct_attack_condition(self):
        tree, _ev = self.mutated()
        slots = KIT._command_slots(tree, "CreateCondition")
        parent, index = slots[1]
        body = parent[index][1]
        self.assertEqual(body[2], [KIT.SKILL_ADDITIONAL_AC["2"]])
        self.assertEqual(len(body), 13)
        self.assertEqual(body[1], 3)          # subject = FindAllSubjects 的绑定 id
        self.assertEqual(body[10], 3)         # 付与对象种类：选择器 33 写 3
        self.assertIs(body[12], False)        # 不强制付与

    def test_s4_keeps_the_ac_wrapped_in_a_list(self):
        """下标 2 是 AC **列表**；塞裸 AC 会吃掉一层嵌套，往返自检抓不到、进战斗才炸。"""
        tree, _ev = self.mutated()
        for parent, index in KIT._command_slots(tree, "CreateCondition"):
            ac_list = parent[index][1][2]
            self.assertIsInstance(ac_list, list)
            self.assertEqual(len(ac_list), 1)
            self.assertIsInstance(ac_list[0], list)
            self.assertIsInstance(ac_list[0][0], str)

    def test_the_two_conditions_stay_distinguishable(self):
        """区分键都是 ``""`` ⇒ condition id 由数值推导；两条 AC 不同名就不会互相覆盖。"""
        tree, _ev = self.mutated()
        names, keys = [], []
        for parent, index in KIT._command_slots(tree, "CreateCondition"):
            body = parent[index][1]
            names.append(body[2][0][0])
            keys.append(body[7])
        self.assertEqual(names, ["ACDirectDamage", "ACAdditionalDirectAttack"])
        self.assertEqual(keys, ["", ""])

    def test_mutation_keeps_the_command_count_fingerprint(self):
        tree, _ev = self.mutated()
        self.assertEqual(KIT._command_counts(tree),
                         dict(KIT.DONOR_COMMAND_COUNTS, CreateCondition=2))

    def test_effects_stay_on_the_official_paths(self):
        tree, ev = self.mutated()
        self.assertEqual(len(ev["effect_refs"]), 4)
        for path in ev["effect_refs"]:
            self.assertTrue(path.startswith(KIT.OFFICIAL_EFFECT_PREFIX), path)

    def test_no_donothing_branch_is_introduced(self):
        """``["DoNothing"]`` 只合法在 FindAllSubjects 的 IfTargetNotFound 位；空分支写 ``["Block", []]``。"""
        tree, _ev = self.mutated()
        for parent, index in KIT._command_slots(tree, "FindAllSubjects"):
            self.assertEqual(parent[index][1][8], ["DoNothing"])
            self.assertEqual(parent[index][1][9][0], "Block")

    def test_a_drifted_donor_is_rejected(self):
        (parent, index), = KIT._command_slots(self.tree, "CreateHitArea")
        parent[index][1][KIT.HITAREA_BUFF_TARGET_SLOT] = 3
        with self.assertRaises(KL.KitError):
            self.mutated()

    def test_a_drifted_multiplier_is_rejected(self):
        (parent, index), = KIT._command_slots(self.tree, "CreateNormalAttack")
        parent[index][1][6] = [{"min": 1.0, "max": 1.0}]
        with self.assertRaises(KL.KitError):
            self.mutated()

    def test_a_drifted_condition_target_kind_is_rejected(self):
        (parent, index), = KIT._command_slots(self.tree, "CreateCondition")
        parent[index][1][10] = 1
        with self.assertRaises(KL.KitError):
            self.mutated()

    def test_a_missing_command_is_rejected(self):
        (parent, index), = KIT._command_slots(self.tree, "ShakeCamera")
        del parent[index]
        with self.assertRaises(KL.KitError):
            self.mutated()


# ---------------------------------------------------------------- 静态：donor 记法

class DonorNotationTests(unittest.TestCase):
    def test_design_donor_notation_normalises_to_the_kit_form(self):
        self.assertEqual(KIT._norm_donor("151171#L2"), "151171#1")
        self.assertEqual(KIT._norm_donor("live 1499893#L2"), "live:1499893#1")
        self.assertEqual(KIT._norm_donor("1611231#L1 + trigger block from live 1699893#L5"),
                         "1611231#0")
        self.assertEqual(KIT._norm_donor("331004"), "331004")

    def test_only_the_patch_kind_row_comes_from_live(self):
        """官方基线优先；live 只用于官方全表零行的补丁 kind 724。"""
        live = [(key, index) for key, records in KIT.ABILITY.items()
                for index, (donor, _c, _e) in enumerate(records)
                if split_donor(donor)[0] == "live"]
        self.assertEqual(live, [("1399913", 0)])
        for donor, _cells, _expect in KIT.LEADER:
            self.assertEqual(split_donor(donor)[0], "official")


# ---------------------------------------------------------------- 集成（需要官方基线 / live store）

@unittest.skipUnless(_LIVE, "需要 .cdn/cn 官方基线与 live store")
class RowIntegrationTests(unittest.TestCase):
    def test_every_leader_row_builds_and_renders_as_registered(self):
        for index, (donor, cells, expect) in enumerate(KIT.LEADER):
            row, ev = KL.build_row(ctx(), "leader_ability", donor, cells,
                                   expect_describe=expect, label=f"leader#{index}")
            self.assertEqual(len(row), KL.LEADER_NCOLS)
            self.assertEqual(ev["describe"], expect)
            self.assertEqual(ev["capabilities"], [])

    def test_every_ability_row_builds_and_renders_as_registered(self):
        for key, records in KIT.ABILITY.items():
            built = []
            for index, (donor, cells, expect) in enumerate(records):
                source, donor_key = split_donor(donor)
                row, ev = KL.build_row(ctx(), "ability", donor_key, cells, source=source,
                                       element=KIT.ELEMENT, expect_describe=expect,
                                       label=f"{key}#{index}")
                self.assertEqual(len(row), KL.ABILITY_NCOLS)
                self.assertEqual(ev["describe"], expect)
                built.append(row)
            KL.check_ability_key(built, key, KIT.CODE, int(key[-1]))

    def test_the_patch_row_is_the_only_one_needing_a_client_capability(self):
        caps = {}
        for key, records in KIT.ABILITY.items():
            for index, (donor, cells, _expect) in enumerate(records):
                source, donor_key = split_donor(donor)
                row = KL.apply_cells(KL.donor_row(ctx(), KL.ABILITY, donor_key, source=source),
                                     cells, KL.ABILITY_NCOLS)
                got = KL.capabilities("ability", row)
                if got:
                    caps[f"{key}#{index}"] = got
        self.assertEqual(caps, {"1399913#0": ["kyubi-fever-ratio-v1"]})
        self.assertEqual(sorted(set(sum(caps.values(), []))),
                         sorted(KIT.SPEC["required_capabilities"]))

    def test_guard_rows_passes_on_the_real_rows(self):
        leader = [KL.build_row(ctx(), "leader_ability", d, c, expect_describe=e)[0]
                  for d, c, e in KIT.LEADER]
        ability = {}
        for key, records in KIT.ABILITY.items():
            rows = []
            for donor, cells, expect in records:
                source, donor_key = split_donor(donor)
                rows.append(KL.build_row(ctx(), "ability", donor_key, cells, source=source,
                                         element=KIT.ELEMENT, expect_describe=expect)[0])
            ability[key] = rows
        guards = KIT.guard_rows(leader, ability)
        self.assertEqual(guards["kind_724_rows"], ["1399913#0"])
        self.assertTrue(guards["leader_clean"])

    def test_unique_row_matches_the_design(self):
        key, row = KL.unique_row(ctx(), MS.get_spec(KIT.KEY), 1, donor=KIT.UNIQUE_DONOR,
                                 cells={0: f"unique_{KIT.CODE}_dice_luck", 3: "99999999",
                                        4: KIT.UNIQUE_CAP},
                                 name=KIT.UNIQUE_NAME, icon=KIT.UNIQUE_ICON)
        self.assertEqual(key, KIT.UID)
        self.assertEqual(len(row), KL.UNIQUE_NCOLS)
        self.assertEqual(row[0], f"unique_{KIT.CODE}_dice_luck")
        self.assertEqual(row[1], KIT.UNIQUE_NAME)
        self.assertEqual(row[2], KIT.UNIQUE_ICON)
        self.assertEqual(row[3], "99999999")               # 常驻
        self.assertEqual(row[4], KIT.UNIQUE_CAP)

    def test_identity_is_unoccupied(self):
        # 发布后自己的键被自己占用是预期（与 test_midautumn_framework 同口径）
        ledger = ctx().root / ".cdn" / "cn" / "character-releases" / "active.json"
        if ledger.is_file() and MS.get_spec(KIT.KEY).pkg_id in ledger.read_text(encoding="utf-8"):
            self.skipTest("already published: own keys are expected to be occupied")
        problems = MS.occupancy_problems([MS.get_spec(KIT.KEY)], repo_root=ctx().root,
                                         store=ctx().store)
        self.assertEqual(problems, {KIT.KEY: []})

    def test_statue_group_has_official_precedent_for_every_kind_in_the_key(self):
        """裁决 §8：跨 kind 组键前先确认所选组在每个 kind 上都有官方先例。"""
        import wf_seasonal7_common as S7C
        flat = ctx().official_flat(KL.ABILITY)
        seen: dict[tuple[str, str], int] = {}
        for raw in flat.values():
            for row in S7C.csv_split(raw):
                if len(row) < KL.ABILITY_NCOLS:
                    continue
                for col, tag in ((47, "I"), (109, "D")):
                    if row[col]:
                        seen[(row[2], tag + row[col])] = seen.get((row[2], tag + row[col]), 0) + 1
        for key, records in KIT.ABILITY.items():
            group = KIT.STATUE_GROUPS[key]
            for _donor, cells, _expect in records:
                for col, tag in ((47, "I"), (109, "D")):
                    kind = cells.get(col)
                    if not kind or kind == "724":      # 补丁 kind 官方全表零行
                        continue
                    self.assertGreater(seen.get((group, tag + kind), 0), 0,
                                       f"{key}: {group} × {tag}{kind} 官方零先例")

    def test_donor_program_points_at_the_rare4_template(self):
        for level in ("1", "2"):
            path = KIT.donor_program(ctx(), level)
            self.assertEqual(path, f"battle/action/skill/action/rare4/{KIT.TEMPLATE_CODE}$"
                                   f"{KIT.TEMPLATE_CODE}_{level}")
            self.assertNotEqual(path, ctx().program_path(level))

    def test_the_real_donor_trees_mutate_cleanly(self):
        for level in ("1", "2"):
            tree, ev = KIT.mutate_tree(donor_tree(level), level)
            self.assertEqual(KIT._command_counts(tree),
                             dict(KIT.DONOR_COMMAND_COUNTS, CreateCondition=2))
            self.assertEqual(ev["create_normal_attack"]["after"], KIT.SKILL_MULTIPLIER[level][1])
            self.assertEqual(len(ev["effect_refs"]), 4)

    def test_the_mutated_trees_survive_an_amf_round_trip(self):
        for level in ("1", "2"):
            tree, _ev = KIT.mutate_tree(donor_tree(level), level)
            blob = ctx().amf_bytes(tree)
            self.assertEqual(ctx().amf_parse(blob), tree)

    def test_the_icon_frame_donor_is_a_48px_official_asset(self):
        raw = ctx().official_read(KIT.UNIQUE_ICON_FRAME)
        self.assertIsNotNone(raw)
        frame = ctx().png_open(raw)
        self.assertEqual(frame.size, (48, 48))
        icon = KIT.draw_icon(frame)
        self.assertEqual(icon.getchannel("A").tobytes(), frame.getchannel("A").tobytes())


@unittest.skipUnless(_LIVE, "需要 .cdn/cn 官方基线与 live store")
class DesignCrosscheckTests(unittest.TestCase):
    def test_design_json_agrees_with_the_kit(self):
        path = MS.design_path(ctx().root, KIT.KEY)
        if not path.is_file():
            self.skipTest("设计稿不在（work/ 未恢复）")
        result = KIT.design_crosscheck(ctx())
        self.assertTrue(result["present"])
        self.assertIn("statue_group", result["checked"])

    def test_a_drifted_design_is_rejected(self):
        path = MS.design_path(ctx().root, KIT.KEY)
        if not path.is_file():
            self.skipTest("设计稿不在（work/ 未恢复）")
        design = json.loads(path.read_text(encoding="utf-8"))
        design["texts"]["title"] = "月下博饼的花豹"
        import tempfile

        class _Probe:
            root = ctx().root
            spec = ctx().spec

        with tempfile.TemporaryDirectory() as tmp:
            fake_root = Path(tmp)
            target = MS.design_path(fake_root, KIT.KEY)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(design, ensure_ascii=False), encoding="utf-8")
            _Probe.root = fake_root
            with self.assertRaises(KL.KitError):
                KIT.design_crosscheck(_Probe())


# ---------------------------------------------------------------- workspace 产物

@unittest.skipUnless(_LIVE, "需要 .cdn/cn 官方基线与 live store")
class WorkspaceTests(unittest.TestCase):
    """已经跑过 ``--step kit`` 的 workspace 在场时，核对落盘结果；没跑过就跳过。"""

    def setUp(self):
        self.report = core.project_root() / "work" / "character_packs" / "ma-kuro" \
            / "evidence" / "kit-report.json"
        if not self.report.is_file():
            self.skipTest("work/character_packs/ma-kuro 还没跑过 --step kit")
        self.value = json.loads(self.report.read_text(encoding="utf-8"))

    def test_report_identity_and_capabilities(self):
        self.assertEqual((self.value["cid"], self.value["code"]), (KIT.CID, KIT.CODE))
        self.assertEqual(self.value["required_capabilities"], ["kyubi-fever-ratio-v1"])
        self.assertIn(self.value["status"], (KL.DRAFT, KL.READY))

    def test_report_programs_are_the_two_rare5_skills(self):
        programs = self.value["skills"]["programs"]
        self.assertEqual(len(programs), 2)
        for program in programs:
            self.assertIn(f"rare5/{KIT.CODE}", program)

    def test_report_panel_text_obeys_the_rules(self):
        self.assertEqual(len(self.value["panel"]), 17)
        for text in self.value["panel"]:
            self.assertEqual(KL.panel_problems(text), [], text)

    def test_report_guards_and_statue_groups(self):
        self.assertEqual(self.value["guards"]["kind_724_rows"], ["1399913#0"])
        self.assertEqual(self.value["statue_group"], KIT.STATUE_GROUPS)

    def test_written_rows_match_the_plan(self):
        rows = json.loads((self.report.parent / "kit-rows.json").read_text(encoding="utf-8"))
        self.assertEqual(len(rows["leader"]), 4)
        self.assertEqual(sum(len(v["records"]) for v in rows["ability"].values()), 13)
        self.assertEqual(rows["unique_condition"][KIT.UID][4], KIT.UNIQUE_CAP)


if __name__ == "__main__":
    unittest.main(verbosity=2)
