# -*- coding: utf-8 -*-
"""凯尔 kit（139990 ``kyle_moon``）：设计稿自查 + 行装配 + DSL 门禁。

三组用例：

1. **纯静态**（不需要 live / 官方基线）：模块常量与 ``design/kyle.json`` 的互锁、裁决 §8 的
   设计自查（队长表禁 422/724/713、前置 kind 白名单、固有 ID 8 位且上限非 ``(None)``、
   c2 雕像组每键单值、``desc_expected`` 不许带括注、面板禁词），以及本模块的小工具
   （donor 地址 1 基↔0 基互校、设计稿速记数值解析、判定区/CNA 改格、图标绘制）。
2. **官方基线**（缺 ``.cdn/cn`` 或 live store 时跳过）：6＋13 行逐行装配并与设计登记的
   ``wf_describe`` 回读逐字比对；两棵技能树的 S0–S9 装配与全部 DSL 门禁（元素、主体绑定、
   判定区归属、方向、坐标系）。
3. **已构建的 workspace**（``work/character_packs/ma-kyle`` 不存在时跳过）：包内自有键、
   认领、kit-report、DSL 程序清单与特效引用、语音路由、孤儿字符串已清。

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
import wf_seasonal7_common as C  # noqa: E402

ROOT = core.project_root()
DESIGN = MS.load_design(ROOT, "kyle")
WORKSPACE = ROOT / "work/character_packs/ma-kyle"


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


def fake_family() -> dict:
    """``clone_effect_family`` 结果的只读替身（测树装配时不往包里写特效）。"""
    bases = [f"{K.TEMPLATE_CODE}_slash", f"{K.TEMPLATE_CODE}_smash", f"{K.TEMPLATE_CODE}_explosion"]
    return {"src_dir": K.FX_SRC_DIR, "dst_dir": K.FX_DST_DIR, "donor": K.TEMPLATE_CODE,
            "dst_name": K.FX_SUBDIR, "copied_bases": bases}


# ---------------------------------------------------------------- 1. 纯静态

class ConstantTests(unittest.TestCase):
    def test_identity_matches_the_registry(self):
        spec = MS.get_spec("kyle")
        self.assertEqual((spec.cid, spec.code), (K.CID, K.CODE))
        self.assertEqual((spec.template_id, spec.template_code), (K.TEMPLATE_ID, K.TEMPLATE_CODE))
        self.assertEqual((spec.element, spec.element_token), (K.ELEMENT, K.ELEMENT_TOKEN))
        self.assertEqual(spec.pf_type, 0)             # APK 原生剑型 PF；本角色不做 722
        self.assertEqual(spec.stance, "Attacker")
        self.assertEqual(spec.rarity, 5)

    def test_element_is_not_colorless(self):
        # element=6（Colorless）是敌专属，可玩角色写 6 会 C7050（记忆 wf-element6-colorless-crash）
        self.assertNotEqual(K.ELEMENT, 6)

    def test_unique_condition_id_is_eight_digits(self):
        self.assertEqual(K.UID, str(K.CID * 100 + 1))
        self.assertEqual(len(K.UID), 8)
        self.assertTrue(MS.unique_condition_ok(K.CID, K.UID))

    def test_spec_declares_every_self_owned_key(self):
        keys = MS.get_spec("kyle").extra_keys
        self.assertEqual(keys[MS.UNIQUE_CONDITION_LOGICAL], (K.UID,))
        self.assertEqual(keys[KL.SWITCHED], (K.VOICE_KEY,))
        self.assertNotIn(KL.CAS, keys)                # 无 629 / 536 ⇒ 不认领任何字符串键

    def test_ability_keys_are_the_six_slots(self):
        self.assertEqual(K.ABILITY_KEYS, tuple(f"{K.CID}{n}" for n in range(1, 7)))

    def test_every_design_row_has_a_machine_readable_donor(self):
        rows = DESIGN["plan"]["leader_ability"]["rows"]
        self.assertEqual({int(row["index"]) for row in rows}, set(K.LEADER_DONORS))
        pairs = {(key, int(record["index"]))
                 for key, block in DESIGN["plan"]["ability"]["keys"].items()
                 for record in block["records"]}
        self.assertEqual(pairs, set(K.ABILITY_DONORS))

    def test_design_donor_prose_and_kit_addresses_agree(self):
        for row in DESIGN["plan"]["leader_ability"]["rows"]:
            index = int(row["index"])
            K._check_design_donor(row["donor"], K.LEADER_DONORS[index], f"leader#{index}")
        for key, block in DESIGN["plan"]["ability"]["keys"].items():
            for record in block["records"]:
                index = int(record["index"])
                K._check_design_donor(record["donor"], K.ABILITY_DONORS[(key, index)],
                                      f"{key}#{index}")

    def test_check_design_donor_rejects_a_zero_based_record_number(self):
        # 设计稿写 1 基（#L1），kit 写 0 基（#0）；两边写反了必须当场报错
        with self.assertRaises(KL.KitError):
            K._check_design_donor("161123#L1", ("161123#1",), "probe")
        with self.assertRaises(KL.KitError):
            K._check_design_donor("161123#L1", ("999999#0",), "probe")


class DesignSelfCheckTests(unittest.TestCase):
    """裁决 §8：kit 实现前对设计稿的自查，全部固化成用例。"""

    def test_leader_table_carries_no_dash_fever_or_independent_multiplier_kinds(self):
        # 422 冲刺参数 / 724 Fever 比例 / 713 独立乘区 写进队长表 = C7050
        for row in DESIGN["plan"]["leader_ability"]["rows"]:
            cells = {int(col): str(value) for col, value in row["cells"].items()}
            for col in (45, 107):
                self.assertNotIn(cells.get(col, ""), ("422", "724", "713"),
                                 f"leader#{row['index']} c{col}")

    def test_ability_content_kinds_stay_out_of_the_blacklist(self):
        for key, block in DESIGN["plan"]["ability"]["keys"].items():
            for record in block["records"]:
                cells = {int(col): str(value) for col, value in record["cells"].items()}
                for col in (47, 109):
                    self.assertNotIn(cells.get(col, ""), K.FORBIDDEN_CONTENT_KINDS,
                                     f"{key}#{record['index']} c{col}")

    def test_precondition_kinds_stay_inside_the_vetted_set(self):
        for row in DESIGN["plan"]["leader_ability"]["rows"]:
            cells = {int(col): str(value) for col, value in row["cells"].items()}
            for col in (4, 11, 18):
                self.assertIn(cells.get(col, ""), K.ALLOWED_PRECONDITION_KINDS,
                              f"leader#{row['index']} c{col}")
        for key, block in DESIGN["plan"]["ability"]["keys"].items():
            for record in block["records"]:
                cells = {int(col): str(value) for col, value in record["cells"].items()}
                for col in (6, 13, 20):
                    self.assertIn(cells.get(col, ""), K.ALLOWED_PRECONDITION_KINDS,
                                  f"{key}#{record['index']} c{col}")

    def test_statue_group_is_single_valued_per_ability_key(self):
        for key, block in DESIGN["plan"]["ability"]["keys"].items():
            groups = {str(record["cells"]["2"]) for record in block["records"]}
            unisonable = {str(record["cells"]["1"]) for record in block["records"]}
            self.assertEqual(len(groups), 1, f"{key}: mixed statue groups {groups}")
            self.assertEqual(len(unisonable), 1, f"{key}: mixed c1 {unisonable}")
            self.assertIn(groups.pop(), L.ABILITY_STATUE_GROUPS)

    def test_unique_condition_cap_is_a_number_not_none(self):
        row = DESIGN["plan"]["unique_conditions"]["add"][0]["row"]
        self.assertEqual(row[4], K.UNIQUE_CAP)
        self.assertNotIn(row[4], ("", "(None)"))      # (None) = 上限 1 ⇒ D134 按层加成全死
        self.assertTrue(row[4].isdigit())
        self.assertEqual(row[13], "false")            # 入棺不清层

    def test_expected_panel_text_has_no_hand_written_annotation(self):
        """``desc_expected`` 是 ``wf_describe`` 的逐字回读，不能带设计注解（设计稿 D14）。"""
        texts = [row["desc_expected"] for row in DESIGN["plan"]["leader_ability"]["rows"]]
        texts += [record["desc_expected"] for block in DESIGN["plan"]["ability"]["keys"].values()
                  for record in block["records"]]
        for text in texts:
            self.assertNotIn("（", text, f"annotation leaked into desc_expected: {text}")
            self.assertEqual(KL.panel_problems(text), [], text)

    def test_design_texts_pass_the_panel_rules(self):
        for name in ("title", "profile", "leader", "skill1", "desc1", "skill2", "desc2"):
            self.assertEqual(KL.panel_problems(DESIGN["texts"][name]), [], name)

    def test_design_declares_no_override_string_and_no_dash_parameters(self):
        self.assertIsNone(DESIGN["plan"]["texts_tables"]["desc_override"]["value"])
        self.assertIsNone(DESIGN["plan"]["texts_tables"]["custom_ability_string"]["value"])
        self.assertIsNone(DESIGN["plan"]["dash"]["kind_422"])
        self.assertIsNone(DESIGN["plan"]["power_flip"]["pf_override"])

    def test_skill_description_matches_the_two_level_texts(self):
        desc = DESIGN["plan"]["texts_tables"]["action_skill_desc"]
        self.assertEqual(desc["outer_key"], K.CODE)
        self.assertEqual(desc["value"], DESIGN["texts"]["desc1"])
        self.assertEqual(desc["value"], DESIGN["texts"]["desc2"])
        self.assertLessEqual(len(desc["value"]), 142)     # live p99 技能说明长度


class SkillPlanParsingTests(unittest.TestCase):
    def test_shorthand_number_groups(self):
        self.assertEqual(K._groups("{600,600}"), [{"min": 600, "max": 600}])
        self.assertEqual(K._groups("[{960}],[{1.0,1.0}]"),
                         [{"min": 960, "max": 960}, {"min": 1.0, "max": 1.0}])
        self.assertEqual(K._groups("[{600,720}],[{0.25,0.3}]"),
                         [{"min": 600, "max": 720}, {"min": 0.25, "max": 0.3}])

    def test_create_normal_attack_multiplier(self):
        self.assertEqual(K._cna_mult("[4,255,[],[],200,[{min:20.8,max:24.0}],…]", "probe"),
                         {"min": 20.8, "max": 24.0})
        with self.assertRaises(KL.KitError):
            K._cna_mult("[4,255,[],[],200,[],…]", "probe")

    def test_read_skill_plan_matches_the_design(self):
        plan = K.read_skill_plan(DESIGN)
        self.assertEqual(plan["energy"], {"1": ("560", "560", "1"), "2": ("560", "510", "1")})
        level1 = plan["levels"]["1"]
        self.assertEqual(level1["cna"], [{"min": 16.3, "max": 16.3}, {"min": 1.63, "max": 1.63},
                                         {"min": 20.4, "max": 20.4}])
        self.assertEqual(level1["piercing"], {"min": 600, "max": 600})
        self.assertEqual(level1["speedup"][0], {"min": 480, "max": 480})
        level2 = plan["levels"]["2"]
        self.assertEqual(level2["cna"][0], {"min": 20.8, "max": 24.0})
        self.assertEqual(level2["direct"], [{"min": 1200, "max": 1200}, {"min": 1.2, "max": 1.5}])
        # 升档只能更强，不能更弱
        for index in range(3):
            self.assertGreaterEqual(level2["cna"][index]["max"], level1["cna"][index]["max"])

    def test_read_skill_plan_rejects_a_truncated_design(self):
        broken = copy.deepcopy(DESIGN)
        broken["plan"]["skills"]["structural_changes"] = [
            entry for entry in broken["plan"]["skills"]["structural_changes"]
            if entry["id"] != "S5"]
        with self.assertRaises(KL.KitError):
            K.read_skill_plan(broken)


class RowAuditTests(unittest.TestCase):
    """donor 逐列审计：写进去的值必须有官方出处，漏抄的 donor 格必须被 ``edits`` 点名。"""

    def test_value_without_a_donor_or_an_edit_is_rejected(self):
        donors = [["a", "b", "c"]]
        with self.assertRaises(KL.KitError):
            K._audit_against_donors(donors, {0: "a", 1: "X"}, {}, 3, "probe")
        K._audit_against_donors(donors, {0: "a", 1: "X"}, {"c1": "b→X", "c2": "c→空"}, 3, "probe")

    def test_silently_dropping_a_donor_cell_is_rejected(self):
        donors = [["a", "b", "c"]]
        with self.assertRaises(KL.KitError):
            K._audit_against_donors(donors, {0: "a", 1: "b"}, {}, 3, "probe")
        audit = K._audit_against_donors(donors, {0: "a", 1: "b"}, {"c2": "c→空"}, 3, "probe")
        self.assertEqual(audit["donor_cells_dropped"], {"c2": "c"})

    def test_a_composite_row_may_take_each_block_from_a_different_donor(self):
        donors = [["a", "", "c"], ["a", "b", ""]]
        audit = K._audit_against_donors(donors, {0: "a", 1: "b", 2: "c"}, {}, 3, "probe")
        self.assertEqual(audit["donor_cells_dropped"], {})


class KindGuardTests(unittest.TestCase):
    def test_forbidden_content_kind_in_the_leader_table_is_rejected(self):
        row = [""] * KL.LEADER_NCOLS
        row[45] = "422"
        with self.assertRaises(KL.KitError):
            K._ban_kinds("leader_ability", [row], "leader")

    def test_unvetted_precondition_kind_is_rejected(self):
        row = [""] * KL.ABILITY_NCOLS
        row[6] = "188"          # 188 数的是固有「实例数」（恒 1），阈值 ≥2 永不成立（裁决 §8）
        with self.assertRaises(KL.KitError):
            K._ban_kinds("ability", [row], "1399901")


class DslHelperTests(unittest.TestCase):
    def test_hit_area_setter_writes_the_direct_attack_attribution(self):
        body = ["CreateHitArea", "*", 1, ["CD"], 0, 0, 0, False, False,
                ["Circle", [{"min": 225, "max": 225}]], ["Center"], ["Center"], ["Single"],
                ["SpecifyHitAreaLifetimeDirectly", 10], ["CalculatedUsingMaxNumOfHits", 1],
                ["None"], False, True, ["None"], 2, ["Block", []], 3, 4, ["Block", []], 0, 0,
                ["None"]]
        K._set_hitarea(body, radius=320, lifetime=20, max_hits=2, break_weak_point=True,
                       binds=(8, 9, 10), label="probe")
        self.assertEqual(body[9], ["Circle", [{"min": 320, "max": 320}]])
        self.assertEqual(body[13], ["SpecifyHitAreaLifetimeDirectly", 20])
        self.assertEqual(body[14], ["CalculatedUsingMaxNumOfHits", 2])
        self.assertEqual(body[24], K.BUFF_TARGET_AS_DIRECT)
        self.assertIs(body[7], True)
        self.assertEqual((body[19], body[21], body[22]), (8, 9, 10))

    def test_hit_area_setter_rejects_a_drifted_shape(self):
        with self.assertRaises(KL.KitError):
            K._set_hitarea(["CreateHitArea"], radius=1, lifetime=1, max_hits=1, label="probe")

    def test_create_normal_attack_keeps_the_inherited_element_slot(self):
        body = ["CreateNormalAttack", 4, 255, [], [], 200, [{"min": 20, "max": 20}],
                [{"min": 0, "max": 0}], False, False, False, False, False,
                [{"min": 10, "max": 10}], [{"min": 5, "max": 5}], ["Fine"], True]
        K._set_cna(body, K.CNA_SHAPE[2], {"min": 20.4, "max": 20.4}, "probe")
        self.assertEqual(body[1], 10)
        self.assertEqual(body[2], 255)
        self.assertEqual(body[6], [{"min": 20.4, "max": 20.4}])
        self.assertEqual(body[13], [{"min": 12, "max": 12}])
        body[2] = 3
        with self.assertRaises(KL.KitError):
            K._set_cna(body, K.CNA_SHAPE[2], {"min": 1, "max": 1}, "probe")

    def test_finish_hit_area_binds_do_not_collide_with_the_team_block(self):
        """S5 判定区占 8/9/10 ⇒ 全队块只能用 donor 原来的 11（设计稿 D15）。"""
        self.assertNotIn(11, K.FINISH_BINDS)
        self.assertEqual(K.CNA_SHAPE[2]["subject"], K.FINISH_BINDS[-1])

    def test_finish_effect_is_referenced_not_cloned(self):
        self.assertTrue(K.FINISH_EFFECT.startswith("battle/effect/skill_unique/light_adventurer_4anv/"))
        self.assertNotIn("player", K.FINISH_EFFECT)     # 「キャラドット」件会把别人的小人烤进来
        self.assertFalse(K.FINISH_EFFECT.startswith(K.FX_DST_DIR))


class IconTests(unittest.TestCase):
    def test_icon_keeps_the_official_alpha_and_size(self):
        try:
            from PIL import Image
        except ImportError:                              # pragma: no cover
            self.skipTest("Pillow not installed")
        frame = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
        for y in range(6, 42):
            for x in range(6, 42):
                frame.putpixel((x, y), (255, 255, 255, 255))
        icon = K.draw_icon(frame)
        self.assertEqual(icon.size, (48, 48))
        self.assertEqual(icon.getchannel("A").tobytes(), frame.getchannel("A").tobytes())
        self.assertGreater(len({icon.getpixel((x, y))[:3] for x in range(48) for y in range(48)}), 4)

    def test_icon_rejects_a_wrong_sized_frame(self):
        try:
            from PIL import Image
        except ImportError:                              # pragma: no cover
            self.skipTest("Pillow not installed")
        with self.assertRaises(KL.KitError):
            K.draw_icon(Image.new("RGBA", (32, 32)))


# ---------------------------------------------------------------- 2. 官方基线

@unittest.skipUnless(_BASELINE, "需要 live store 与 .cdn/cn 官方归档")
class RowBuildTests(unittest.TestCase):
    def test_leader_rows_render_exactly_as_the_design_says(self):
        rows, evidence = K.build_leader_rows(ctx(), DESIGN)
        self.assertEqual(len(rows), 6)
        for row, entry in zip(rows, DESIGN["plan"]["leader_ability"]["rows"]):
            self.assertEqual(len(row), KL.LEADER_NCOLS)
            self.assertEqual(row[0], K.CODE)
            self.assertEqual(KL.describe("leader_ability", row), entry["desc_expected"])
        self.assertTrue(all(not ev["capabilities"] for ev in evidence))

    def test_ability_rows_render_exactly_as_the_design_says(self):
        rows_by_key, evidence = K.build_ability_rows(ctx(), DESIGN)
        self.assertEqual(sorted(rows_by_key), sorted(K.ABILITY_KEYS))
        self.assertEqual(sum(len(rows) for rows in rows_by_key.values()), 13)
        for slot, key in enumerate(K.ABILITY_KEYS, start=1):
            rows = rows_by_key[key]
            self.assertEqual({row[0] for row in rows}, {f"{K.CODE}_{slot}"})
            self.assertEqual(len({row[1] for row in rows}), 1)
            self.assertEqual(len({row[2] for row in rows}), 1)
            for row in rows:
                self.assertEqual(len(row), KL.ABILITY_NCOLS)
                self.assertEqual(KL.row_problems("ability", row, K.ELEMENT), {})
        self.assertTrue(all(not ev["capabilities"] for ev in evidence))

    def test_only_the_third_ability_key_is_main_slot_only(self):
        rows_by_key, _ = K.build_ability_rows(ctx(), DESIGN)
        unisonable = {key: rows[0][1] for key, rows in rows_by_key.items()}
        self.assertEqual(unisonable[f"{K.CID}3"], "false")
        self.assertEqual({v for k, v in unisonable.items() if k != f"{K.CID}3"}, {"true"})

    def test_a_drifted_expected_panel_text_is_caught(self):
        broken = copy.deepcopy(DESIGN)
        broken["plan"]["leader_ability"]["rows"][0]["desc_expected"] = "赋予全队(雷) 攻击力 999%"
        with self.assertRaises(KL.KitError):
            K.build_leader_rows(ctx(), broken)

    def test_a_cell_that_no_donor_backs_is_caught(self):
        broken = copy.deepcopy(DESIGN)
        broken["plan"]["leader_ability"]["rows"][0]["cells"]["49"] = "999000"
        with self.assertRaises(KL.KitError):
            K.build_leader_rows(ctx(), broken)

    def test_unique_condition_row_equals_the_design_row(self):
        row = KL.apply_cells(KL.donor_row(ctx(), KL.UNIQUE, K.UNIQUE_DONOR),
                             {0: K.UNIQUE_STRING_ID, 1: K.UNIQUE_NAME,
                              2: K.UNIQUE_ICON_ROW, 4: K.UNIQUE_CAP}, KL.UNIQUE_NCOLS)
        self.assertEqual(row, [str(cell) for cell in
                               DESIGN["plan"]["unique_conditions"]["add"][0]["row"]])


@unittest.skipUnless(_BASELINE, "需要 live store 与 .cdn/cn 官方归档")
class SkillTreeTests(unittest.TestCase):
    def _tree(self, level: str):
        plan = K.read_skill_plan(DESIGN)
        donor = f"battle/action/skill/action/rare5/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_{level}"
        tree, evidence = K.mutate_tree(ctx(), ctx().template_dsl(donor), level,
                                       plan["levels"][level])
        return tree, evidence

    def test_donor_tree_shape_is_still_what_the_kit_expects(self):
        donor = f"battle/action/skill/action/rare5/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_1"
        tree = ctx().template_dsl(donor)
        self.assertEqual(K._command_counts(tree), K.DONOR_COMMAND_COUNTS)
        self.assertEqual(tree[0], "ActionDsl")
        self.assertEqual(tree[10], 0)          # 根头 buffTargetAs 保持 0（自动）

    def test_three_slashes_land_on_the_designed_frames(self):
        for level in ("1", "2"):
            tree, evidence = self._tree(level)
            self.assertEqual(evidence["waits"], [9, 49, K.FINISH_WAIT])
            self.assertEqual(evidence["reference_point_lifetime"]["after"], K.RP_LIFETIME)
            self.assertEqual(evidence["stop_ball"]["after"], K.STOPBALL_FRAMES)
            # 最后一段的寿命必须落在参照点寿命之内
            self.assertLessEqual(K.FINISH_WAIT + K.FINISH_HITAREA["lifetime"], K.RP_LIFETIME)

    def test_every_hit_area_settles_as_direct_attack_damage(self):
        for level in ("1", "2"):
            tree, evidence = self._tree(level)
            self.assertEqual(len(evidence["hit_areas"]), 3)
            for area in evidence["hit_areas"]:
                self.assertEqual(area["buff_target_as"], K.BUFF_TARGET_AS_DIRECT)
            self.assertEqual([area["radius"] for area in evidence["hit_areas"]], [260, 280, 320])
            self.assertEqual([area["max_hits"] for area in evidence["hit_areas"]], [1, 14, 1])

    def test_subject_binding_ids_are_unique_across_the_tree(self):
        for level in ("1", "2"):
            tree, evidence = self._tree(level)
            binds = [bind for area in evidence["hit_areas"] for bind in area["binds"]]
            binds.append(evidence["team_conditions"]["bind"])
            self.assertEqual(len(binds), len(set(binds)), f"level {level}: duplicate binds {binds}")

    def test_power_flip_block_is_replaced_by_the_three_team_conditions(self):
        for level in ("1", "2"):
            tree, evidence = self._tree(level)
            self.assertEqual(K._command_counts(tree), K.RESULT_COMMAND_COUNTS)
            self.assertEqual(evidence["team_conditions"]["selector"], 33)   # 33 = 含自身的己方全体
            kinds = [body[2][0][0] for body in K._bodies(tree, "CreateCondition")]
            self.assertEqual(kinds, ["ACPiercing", "ACDirectDamage", "ACSpeedup"])
            for body in K._bodies(tree, "CreateCondition"):
                self.assertEqual(body[10], 3)     # 付与对象种类；错配 = 施法 C16102
                self.assertEqual(body[1], evidence["team_conditions"]["bind"])

    def test_no_power_flip_damage_survives(self):
        for level in ("1", "2"):
            tree, _ = self._tree(level)
            self.assertNotIn("ACPowerFlipDamage", json.dumps(tree, ensure_ascii=False))

    def test_dsl_gates_are_clean(self):
        for level in ("1", "2"):
            tree, _ = self._tree(level)
            self.assertEqual(K._dsl_problems(tree), [], f"level {level}")

    def test_effect_refs_become_the_cloned_family_plus_one_official_path(self):
        for level in ("1", "2"):
            tree, _ = self._tree(level)
            tree, _rewrite = ctx().rewrite_effect_refs(tree, fake_family())
            paths = sorted(K.effect_paths(tree))
            self.assertEqual(paths, sorted([f"{K.FX_DST_DIR}/{K.TEMPLATE_CODE}_slash",
                                            f"{K.FX_DST_DIR}/{K.TEMPLATE_CODE}_smash",
                                            f"{K.FX_DST_DIR}/{K.TEMPLATE_CODE}_explosion",
                                            K.FINISH_EFFECT]))

    def test_the_second_level_hits_harder_than_the_first(self):
        first, _ = self._tree("1")
        second, _ = self._tree("2")
        for body_1, body_2 in zip(K._bodies(first, "CreateNormalAttack"),
                                  K._bodies(second, "CreateNormalAttack")):
            self.assertGreaterEqual(body_2[6][0]["max"], body_1[6][0]["max"])

    def test_a_drifted_donor_tree_is_caught(self):
        donor = f"battle/action/skill/action/rare5/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_1"
        tree = ctx().template_dsl(donor)
        tree[10] = 3                                   # 有人把根头 buffTargetAs 改成了 PF
        with self.assertRaises(KL.KitError):
            K.mutate_tree(ctx(), tree, "1", K.read_skill_plan(DESIGN)["levels"]["1"])


# ---------------------------------------------------------------- 3. 已构建的 workspace

@unittest.skipUnless(WORKSPACE.is_dir() and (WORKSPACE / "evidence/kit-report.json").is_file(),
                     "需要先跑 --step init,tables,kit")
class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads((WORKSPACE / "evidence/kit-report.json").read_text(encoding="utf-8"))
        cls.claims = json.loads((WORKSPACE / "evidence/table_claims.json").read_text(encoding="utf-8"))
        cls.pack = MC.MAPack(MS.get_spec("kyle"), record_sources=False)

    def _claim(self, logical: str):
        return next((entry for entry in self.claims
                     if entry["logical_path"] == logical and entry["root"] == "common"), None)

    def test_kit_report_is_ready_for_review(self):
        self.assertEqual(self.report["status"], KL.READY)
        self.assertEqual((self.report["cid"], self.report["code"]), (K.CID, K.CODE))
        self.assertEqual(self.report["required_capabilities"], [])
        self.assertTrue(self.report["deviations"])
        for text in self.report["panel"]:
            self.assertEqual(KL.panel_problems(text), [], text)

    def test_package_carries_the_six_ability_keys_and_the_leader_key(self):
        ability = self.pack.pkg_flat(KL.ABILITY)
        leader = self.pack.pkg_flat(KL.LEADER)
        for key in K.ABILITY_KEYS:
            self.assertIn(key, ability)
        self.assertIn(K.CID_S, leader)
        self.assertEqual(len(C.csv_split(leader[K.CID_S])), 6)

    def test_package_carries_the_unique_condition_and_its_icon(self):
        unique = self.pack.pkg_flat(MS.UNIQUE_CONDITION_LOGICAL)
        self.assertIn(K.UID, unique)
        row = C.csv_split(unique[K.UID])[0]
        self.assertEqual(row[0], K.UNIQUE_STRING_ID)
        self.assertEqual(row[1], K.UNIQUE_NAME)
        self.assertEqual(row[4], K.UNIQUE_CAP)
        self.assertTrue(self.pack.pkg_path("common", K.UNIQUE_ICON_LOGICAL).is_file())

    def test_claims_cover_every_self_owned_key(self):
        self.assertEqual(self._claim(MS.UNIQUE_CONDITION_LOGICAL)["outer_keys"], [K.UID])
        self.assertIn(K.VOICE_KEY, self._claim(KL.SWITCHED)["outer_keys"])
        self.assertEqual(sorted(self._claim(KL.ABILITY)["outer_keys"]), sorted(K.ABILITY_KEYS))

    def test_the_orphan_change_skill_string_is_gone(self):
        self.assertIsNone(self._claim(KL.CAS))
        self.assertFalse(self.pack.pkg_path("common", KL.CAS).is_file())

    def test_package_skill_programs_and_energy(self):
        programs = self.report["skills"]["programs"]
        self.assertEqual(len(programs), 2)
        for level in ("1", "2"):
            self.assertTrue(any(f"{K.CODE}_{level}." in program for program in programs))
        inner = B.KitContext(self.pack).pkg_nested(K.CODE, KL.ACTION)
        energy = K.read_skill_plan(DESIGN)["energy"]
        for level, cells in inner.items():
            self.assertEqual((cells[4], cells[5], cells[6]), energy[level])
            self.assertEqual(cells[0], DESIGN["texts"][f"skill{level}"])
            self.assertEqual(cells[1], DESIGN["texts"][f"desc{level}"])

    def test_package_dsl_reads_back_and_keeps_the_direct_attack_attribution(self):
        for level in ("1", "2"):
            logical = wf_dsl.dsl_logical(
                f"battle/action/skill/action/rare5/{K.CODE}${K.CODE}_{level}")
            raw = self.pack.pkg_path("common", logical).read_bytes()
            tree = C.amf_parse(raw)
            self.assertEqual(tree[0], "ActionDsl")
            self.assertEqual(K._command_counts(tree), K.RESULT_COMMAND_COUNTS)
            for body in K._bodies(tree, "CreateHitArea"):
                self.assertEqual(body[24], K.BUFF_TARGET_AS_DIRECT)
            self.assertEqual(K._dsl_problems(tree), [])

    def test_character_row_carries_the_voice_route_and_the_leader_name(self):
        row = self.pack.pkg_character_row()
        self.assertEqual(list(row[9:17]), KL.voice_route(K.CODE, K.VOICE_ROUTE))
        self.assertEqual(row[18], DESIGN["texts"]["leader"])
        self.assertEqual(row[3], str(K.ELEMENT))
        self.assertEqual(row[27], K.CID_S)

    def test_package_does_not_leak_into_live_or_assets(self):
        owned = json.loads((WORKSPACE / "evidence/owned_outputs.json").read_text(encoding="utf-8"))
        for name in owned:
            self.assertFalse(name.startswith("live:"), name)
        self.assertTrue(str(WORKSPACE).replace("\\", "/").endswith("work/character_packs/ma-kyle"))


if __name__ == "__main__":                              # pragma: no cover
    unittest.main()
