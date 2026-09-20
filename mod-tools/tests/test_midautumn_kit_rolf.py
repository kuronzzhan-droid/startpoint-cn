# -*- coding: utf-8 -*-
"""罗尔夫 kit（149986 ``black_wolf_knight_moon``）：设计稿自查 + 行装配 + 技能树门禁。

三组用例：

1. **纯静态**（不需要 live / 官方基线）：模块常量与 ``design/rolf.json`` 的互锁、裁决 §8 的
   设计自查（队长表禁 422/724/713、套件禁 201/202/521/252/45/629/536、during puller 列、
   零固有状态、零 722/422、c1/c2 每键单值、面板禁词），以及本模块的小工具
   （``parse_donor`` 的 1 基→0 基换算、``full_row``/``derive_edits``、``num``/``span``
   的整数归一、``write_dsl_checked`` 的包装壳拦截）。
2. **官方基线**（缺 ``.cdn/cn`` 或 live store 时跳过）：5+12 行逐行装配并与设计登记的
   ``wf_describe`` 回读逐字比对、``required_client_capabilities`` 全空、c2 雕像组逐 kind
   官方先例；两棵技能树的删 PF 块／判定区改直击池／两块嫁接／四道门。
3. **已构建的 workspace**（``work/character_packs/ma-rolf`` 不存在时跳过）：kit-report、
   技能能量、语音路由与三层镜像、包内 DSL 回读、特效仍指官方路径、像素成品。

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

ROOT = core.project_root()
DESIGN = MS.load_design(ROOT, "rolf")
WORKSPACE = ROOT / "work/character_packs/ma-rolf"


def _baseline_available() -> bool:
    profile = core.resolve_profile()
    return profile is not None and profile.store.is_dir() and (ROOT / ".cdn" / "cn").is_dir()


_BASELINE = _baseline_available()
_CTX = None


def ctx():
    """只读上下文：``record_sources=False`` ⇒ 母本取数不写 workspace（框架 §10.2）。"""
    global _CTX
    if _CTX is None:
        _CTX = B.KitContext(MC.MAPack(MS.get_spec("rolf"), record_sources=False))
    return _CTX


def leader_entries() -> list[dict]:
    return DESIGN["plan"]["leader_ability"]["rows"]


def ability_blocks() -> dict[str, dict]:
    return DESIGN["plan"]["ability"]["keys"]


def level_values(level: str) -> dict:
    values = DESIGN["plan"]["skills"]["values"]
    out = dict(values[level])
    out["hit_area_damage_kind"] = values["hit_area_damage_kind"]
    return out


# ---------------------------------------------------------------- 1. 纯静态

class ConstantTests(unittest.TestCase):
    def test_identity_matches_the_registry(self):
        spec = MS.get_spec("rolf")
        self.assertEqual((spec.cid, spec.code), (K.CID, K.CODE))
        self.assertEqual((spec.template_id, spec.template_code), (K.TEMPLATE_ID, K.TEMPLATE_CODE))
        self.assertEqual(spec.element, K.ELEMENT)                 # 风 = 3（Green）
        self.assertEqual((spec.pf_type, spec.stance), (K.PF_TYPE, K.STANCE))
        self.assertEqual((DESIGN["cid"], DESIGN["code"]), (K.CID, K.CODE))

    def test_ability_keys_are_the_six_slots(self):
        self.assertEqual(K.ABILITY_KEYS, tuple(f"{K.CID}{n}" for n in range(1, 7)))
        self.assertEqual(tuple(sorted(ability_blocks())), tuple(sorted(K.ABILITY_KEYS)))

    def test_spec_declares_only_the_voice_ready_key(self):
        keys = MS.get_spec("rolf").extra_keys
        self.assertEqual(keys[KL.SWITCHED], (K.VOICE_KEY,))
        # 零固有状态（设计 deviations D1：避开 149950 的浮游＋固有层数轴）
        self.assertNotIn(MS.UNIQUE_CONDITION_LOGICAL, keys)
        # 无 629/536/722/422 ⇒ 不需要自有 custom_ability_string
        self.assertNotIn(KL.CAS, keys)

    def test_voice_route_is_the_shipped_primula_shape(self):
        # kind 1 ConditionExist + 贯通 31；普莉姆拉 169992 已上线同形
        self.assertEqual(K.VOICE_ROUTE_COLS,
                         ["1", "31", "0", "", "", K.VOICE_KEY, "false", "false"])
        self.assertEqual(list(DESIGN["voice"]["route"]["columns"]), K.VOICE_ROUTE_COLS)
        self.assertEqual(KL.voice_route(K.CODE, K.VOICE_ROUTE_COLS), K.VOICE_ROUTE_COLS)

    def test_effect_paths_stay_on_the_official_template(self):
        # 裁决 §4「优先直接引用官方路径」；风→风零染色 ⇒ 图集增量 0
        self.assertEqual(K.FX_SRC_DIR, f"battle/effect/skill_unique/{K.TEMPLATE_CODE}")
        self.assertEqual(sorted(K.OFFICIAL_FX_PATHS),
                         sorted(f"{K.FX_SRC_DIR}/{name}" for name in K.FX_BASES))
        self.assertEqual(sorted(DESIGN["plan"]["skills"]["effects_reference"]),
                         sorted(K.OFFICIAL_FX_PATHS))
        self.assertEqual(DESIGN["plan"]["skills"]["effects_clone"], [])

    def test_dsl_element_code_is_internal_plus_one(self):
        self.assertEqual(K.DSL_WIND, K.ELEMENT + 1)    # 记忆卡 wf-dsl-element-code-offset

    def test_bindings_do_not_collide_with_the_template(self):
        # 母本判定区占 2–7；删掉的 PF 块原本占 8/9，正好让给两块嫁接
        self.assertEqual((K.BIND_TEAM, K.BIND_WIND), (8, 9))
        bindings = DESIGN["plan"]["skills"]["subject_bindings"]
        self.assertEqual(bindings["piercing_fixed_speed"], K.BIND_TEAM)
        self.assertEqual(bindings["direct_damage"], K.BIND_WIND)


class DonorAddressTests(unittest.TestCase):
    def test_record_number_is_one_based_in_the_design(self):
        self.assertEqual(K.parse_donor("official ability 2410331#L1"), ("ability", "2410331#0"))
        self.assertEqual(K.parse_donor("official leader_ability 141189#L2"),
                         ("leader_ability", "141189#1"))

    def test_store_and_malformed_addresses_are_rejected(self):
        for bad in ("live ability 2410331#L1", "official ability 2410331", "o:ability:2410331#L1",
                    "official ability 2410331#L0", "official unique 2410331#L1"):
            with self.assertRaises(K.KitError):
                K.parse_donor(bad)

    def test_every_design_donor_points_at_the_official_baseline(self):
        for entry in leader_entries():
            self.assertEqual(K.parse_donor(entry["donor"])[0], "leader_ability")
        for block in ability_blocks().values():
            for record in block["records"]:
                self.assertEqual(K.parse_donor(record["donor"])[0], "ability")


class RowHelperTests(unittest.TestCase):
    def test_full_row_expands_the_sparse_cells(self):
        row = K.full_row({"0": "a", "3": 7}, 5, "t")
        self.assertEqual(row, ["a", "", "", "7", ""])

    def test_full_row_rejects_empty_values_and_out_of_range_columns(self):
        with self.assertRaises(K.KitError):
            K.full_row({"0": ""}, 5, "t")
        with self.assertRaises(K.KitError):
            K.full_row({"9": "x"}, 5, "t")

    def test_derive_edits_includes_blanking_a_donor_cell(self):
        donor = ["a", "b", "c"]
        want = ["a", "", "z"]
        self.assertEqual(K.derive_edits(donor, want), {1: "", 2: "z"})

    def test_apply_cells_on_the_derived_edits_reproduces_the_design_row(self):
        donor = ["a", "b", "c", "d"]
        want = ["a", "", "z", "d"]
        self.assertEqual(KL.apply_cells(donor, K.derive_edits(donor, want), 4), want)


class NumberShapeTests(unittest.TestCase):
    def test_integral_values_become_amf3_integers(self):
        # 官方树里整数值都是整数，只有真小数才是 double（设计 deviations D12）
        self.assertIsInstance(K.num(25.0), int)
        self.assertIsInstance(K.num(1), int)
        self.assertIsInstance(K.num(0.9), float)
        self.assertEqual(K.span(33, 38), [{"min": 33, "max": 38}])
        self.assertEqual(K.span(1.13, 1.3), [{"min": 1.13, "max": 1.3}])

    def test_span_wraps_a_bare_number_in_the_min_max_shell(self):
        # 裸数值进 Array 参 = 详情页 F1034（记忆卡 wf-dsl-param-shape-f1034）
        self.assertEqual(K.span(720), [{"min": 720, "max": 720}])


class DesignSelfCheckTests(unittest.TestCase):
    """裁决 §8：kit 实现前先自查设计稿。"""

    def test_no_unique_conditions_and_no_power_flip_or_dash(self):
        self.assertEqual(DESIGN["plan"]["unique_conditions"]["add"], [])
        self.assertIsNone(DESIGN["plan"]["pf_override"])       # 不做 722
        self.assertIsNone(DESIGN["plan"]["dash_parameter"])    # 422 留给马格努斯

    def test_leader_block_never_carries_422_724_713(self):
        self.assertEqual(K.FORBIDDEN_LEADER_KINDS, ("422", "724", "713"))
        rows = [K.full_row(e["cells"], KL.LEADER_NCOLS, e["label"]) for e in leader_entries()]
        self.assertEqual(len(rows), K.LEADER_ROWS)
        K.check_leader_kinds(rows)                             # 不抛 = 通过
        poisoned = copy.deepcopy(rows)
        poisoned[0][K.LEADER_DURING_KIND] = "724"
        with self.assertRaises(K.KitError):
            K.check_leader_kinds(poisoned)

    def test_ability_block_never_carries_the_forbidden_kinds(self):
        rows = self._ability_rows()
        K.check_ability_kinds(rows)
        for kind in ("201", "202", "521", "252", "45", "629", "536"):
            poisoned = copy.deepcopy(rows)
            poisoned[K.ABILITY_KEYS[0]][0][K.ABILITY_INSTANT_KIND] = kind
            with self.assertRaises(K.KitError):
                K.check_ability_kinds(poisoned)

    def test_during_pullers_follow_the_parse_at_98_rule(self):
        """D214/D30 留空、D204 写 9＋元素组；写错 ⇒ parseAt98 C7050。"""
        leader = [K.full_row(e["cells"], KL.LEADER_NCOLS, e["label"]) for e in leader_entries()]
        seen = K.check_during_pullers(leader, K.LEADER_DURING_TRIGGER,
                                      K.LEADER_DURING_PULLER, "leader")
        self.assertEqual(sorted(x["trigger"] for x in seen), ["204", "214", "30"])
        for key, rows in self._ability_rows().items():
            K.check_during_pullers(rows, K.ABILITY_DURING_TRIGGER, K.ABILITY_DURING_PULLER, key)
        poisoned = copy.deepcopy(leader)
        for row in poisoned:
            if row[K.LEADER_DURING_TRIGGER] == "214":
                row[K.LEADER_DURING_PULLER] = "9"
        with self.assertRaises(K.KitError):
            K.check_during_pullers(poisoned, K.LEADER_DURING_TRIGGER,
                                   K.LEADER_DURING_PULLER, "leader")

    def test_c1_and_c2_are_single_valued_per_key(self):
        for slot, key in enumerate(K.ABILITY_KEYS, start=1):
            block = ability_blocks()[key]
            rows = [K.full_row(r["cells"], KL.ABILITY_NCOLS, r["label"])
                    for r in block["records"]]
            KL.check_ability_key(rows, key, K.CODE, slot)
            self.assertEqual({r[1] for r in rows}, {str(block["c1_unisonable"])})
            self.assertEqual({r[2] for r in rows}, {str(block["statue_group_c2"])})
            self.assertIn(block["statue_group_c2"], L.ABILITY_STATUE_GROUPS)

    def test_panel_texts_obey_the_batch_rules(self):
        texts = [e["desc_expected"] for e in leader_entries()]
        texts += [r["desc_expected"] for b in ability_blocks().values() for r in b["records"]]
        self.assertEqual(len(texts), K.LEADER_ROWS + K.ABILITY_RECORDS)
        for text in texts:
            self.assertEqual(KL.panel_problems(text), [], text)

    def test_skill_texts_do_not_promise_a_form_switch(self):
        # 536 整条删掉 ⇒ 文案里不许出现「切换技能形态」（裁决 §3：死行不上面板）
        for name in ("desc1", "desc2", "profile", "leader"):
            self.assertNotIn("切换技能形态", DESIGN["texts"][name])

    def test_fixed_speed_charge_stays_inside_the_official_range(self):
        # 官方实读 940 棵树：充能参数只有 -0.65~-0.1，0 零先例（设计 D6）
        self.assertEqual(K.OFFICIAL_FIXED_SPEED_CHARGES,
                         (-0.65, -0.3, -0.2, -0.15, -0.12, -0.1))
        for level in ("1", "2"):
            charge = DESIGN["plan"]["skills"]["values"][level]["fixed_speed_charge"]
            self.assertIn(charge, K.OFFICIAL_FIXED_SPEED_CHARGES)

    def test_every_deviation_carries_all_three_parts(self):
        ids = []
        for entry in DESIGN["deviations"]:
            self.assertTrue(entry.get("from") and entry.get("to") and entry.get("why"), entry)
            ids.append(entry["id"])
        self.assertEqual(len(ids), len(set(ids)))
        for wanted in ("D6", "D10", "D11", "D12"):     # kit 阶段补登记的四条
            self.assertIn(wanted, ids)

    def _ability_rows(self) -> dict[str, list[list[str]]]:
        return {key: [K.full_row(r["cells"], KL.ABILITY_NCOLS, r["label"])
                      for r in ability_blocks()[key]["records"]]
                for key in K.ABILITY_KEYS}


class WriteGuardTests(unittest.TestCase):
    def test_write_dsl_rejects_the_wrapper_shell(self):
        """``write_dsl`` 只吃裸树；喂 ``{tree, numbers}`` = 进战斗 F1034。"""
        with self.assertRaises(K.KitError):
            K.write_dsl_checked(None, "p", {"tree": ["ActionDsl"], "numbers": []})
        with self.assertRaises(K.KitError):
            K.write_dsl_checked(None, "p", ["NotAnActionDsl"])


# ---------------------------------------------------------------- 2. 官方基线

@unittest.skipUnless(_BASELINE, "官方基线 .cdn/cn 或 live store 不可用")
class OfficialRowTests(unittest.TestCase):
    def test_leader_rows_assemble_and_render_as_designed(self):
        rows, evidence = K.build_leader_rows(ctx(), DESIGN)
        self.assertEqual(len(rows), K.LEADER_ROWS)
        for row, entry, ev in zip(rows, leader_entries(), evidence):
            self.assertEqual(row[0], K.CODE)
            self.assertEqual(ev["describe"], entry["desc_expected"])
            self.assertEqual(KL.row_problems("leader_ability", row), {})
            self.assertEqual(ev["capabilities"], [])

    def test_ability_rows_assemble_and_render_as_designed(self):
        rows_by_key, evidence = K.build_ability_rows(ctx(), DESIGN)
        self.assertEqual(sum(len(r) for r in rows_by_key.values()), K.ABILITY_RECORDS)
        for ev in evidence:
            self.assertEqual(ev["capabilities"], [])           # 零客户端补丁
        for slot, key in enumerate(K.ABILITY_KEYS, start=1):
            for row in rows_by_key[key]:
                self.assertEqual(row[0], f"{K.CODE}_{slot}")
                self.assertEqual(KL.row_problems("ability", row, K.ELEMENT), {})
                self.assertNotIn("change_skill_", "".join(row))

    def test_a_drifted_design_cell_is_caught_by_the_full_row_check(self):
        entry = copy.deepcopy(leader_entries()[0])
        entry["cells"]["111"] = "999999"               # 与 desc_expected 不再自洽
        with self.assertRaises(K.KitError):
            K.assemble(ctx(), "leader_ability", entry, "leader#0(drift)")

    def test_statue_groups_have_official_precedent_on_every_kind(self):
        rows_by_key, _ = K.build_ability_rows(ctx(), DESIGN)
        report = K.check_statue_group_precedent(ctx(), rows_by_key)
        self.assertTrue(report)
        for item in report:
            self.assertGreater(item["official_rows"], 0, item)
        # attack_common × during 46 是 0 行先例（正是 D10 要躲开的那一格）
        poisoned = copy.deepcopy(rows_by_key)
        for row in poisoned[K.ABILITY_KEYS[2]]:
            row[2] = "attack_common"
        with self.assertRaises(K.KitError):
            K.check_statue_group_precedent(ctx(), poisoned)


@unittest.skipUnless(_BASELINE, "官方基线 .cdn/cn 或 live store 不可用")
class SkillTreeTests(unittest.TestCase):
    def trees(self):
        return {lv: K.build_skill_tree(ctx(), lv, level_values(lv), None) for lv in ("1", "2")}

    def test_power_flip_block_is_removed_and_two_blocks_are_grafted(self):
        for level, (tree, gates) in self.trees().items():
            body = K.statements(tree)
            self.assertEqual(len(body), 3, level)               # 本体 + 两块嫁接
            self.assertEqual(gates["removed_power_flip"]["freed_bindings"], [8, 9])
            self.assertEqual(gates["team_conditions"], ["ACPiercing", "ACFixedSpeed"])
            names = [c[2][0][0] for c in wf_dsl.iter_dsl_commands(tree, "CreateCondition")]
            self.assertNotIn("ACPowerFlipDamage", names)        # 本角色一条 PF kind 都不写
            self.assertNotIn("ACFlying", names)                 # 浮游是 149950 的轴

    def test_both_hit_areas_switch_to_the_direct_attack_pool(self):
        for level, (tree, gates) in self.trees().items():
            areas = list(wf_dsl.iter_dsl_commands(tree, "CreateHitArea"))
            self.assertEqual(len(areas), 2, level)
            for area in areas:
                self.assertEqual(area[K.HIT_AREA_DAMAGE_SLOT], 4)   # params[23] = 直接攻击伤害
            self.assertEqual(gates["attacks"]["hit_area_damage_kind"], 4)
            self.assertEqual(tree[10], 0)                           # 根 bta 保持自动档

    def test_multipliers_and_condition_values_match_the_design(self):
        for level, (_tree, gates) in self.trees().items():
            values = level_values(level)
            self.assertEqual(gates["attacks"]["multipliers"]["slash"],
                             [K.num(v) for v in values["slash"]])
            self.assertEqual(gates["attacks"]["multipliers"]["burst"],
                             [K.num(v) for v in values["burst"]])
            self.assertEqual(gates["wind_direct_damage"]["frames"], values["direct_damage_frames"])
            self.assertEqual(gates["wind_direct_damage"]["value"],
                             [K.num(v) for v in values["direct_damage"]])

    def test_grafted_conditions_keep_the_official_target_kinds(self):
        for level, (tree, _g) in self.trees().items():
            values = level_values(level)
            by_name = {c[2][0][0]: c for c in wf_dsl.iter_dsl_commands(tree, "CreateCondition")}
            for name in ("ACPiercing", "ACFixedSpeed"):
                cmd = by_name[name]
                self.assertEqual(cmd[1], K.BIND_TEAM)               # p1 == 所在 FindAllSubjects 绑定
                self.assertEqual(cmd[10], 3)                        # 付与对象种类 3 = Member
            self.assertEqual(by_name["ACPiercing"][2][0][1],
                             K.span(values["piercing_frames"]), level)
            fixed = by_name["ACFixedSpeed"][2][0]
            self.assertEqual(fixed[1], K.span(values["fixed_speed_frames"]))
            self.assertEqual(fixed[2], K.span(values["fixed_speed_speed"]))
            self.assertEqual(fixed[3], K.span(values["fixed_speed_charge"]))
            direct = by_name["ACDirectDamage"]
            self.assertEqual(direct[1], K.BIND_WIND)
            self.assertEqual(direct[10], 1)                         # 113 官方配 1，不是 3

    def test_selectors_and_element_filter(self):
        for level, (tree, _g) in self.trees().items():
            found = {}
            for cmd in wf_dsl.iter_dsl_commands(tree, "FindAllSubjects"):
                found[cmd[2]] = cmd
            self.assertIn(K.SELECTOR_MAIN_PARTY, found, level)
            self.assertIn(K.SELECTOR_ELEMENT, found, level)
            self.assertEqual(found[K.SELECTOR_MAIN_PARTY][1], K.BIND_TEAM)
            self.assertEqual(found[K.SELECTOR_ELEMENT][1], K.BIND_WIND)
            self.assertEqual(found[K.SELECTOR_ELEMENT][3], [K.DSL_WIND])
            # FindAllSubjects 的 IfTargetNotFound 槽用 DoNothing 是对的（Conditionals 分支才不许）
            self.assertEqual(found[K.SELECTOR_MAIN_PARTY][8], ["DoNothing"])

    def test_effects_stay_on_the_official_paths(self):
        for level, (tree, gates) in self.trees().items():
            self.assertEqual(set(gates["effect_paths"]), set(K.OFFICIAL_FX_PATHS), level)
            self.assertIsNone(gates["effect_rewrites"])

    def test_all_four_dsl_gates_pass(self):
        for level, (tree, _g) in self.trees().items():
            self.assertEqual(K.dsl_problems(tree), [], level)

    def test_a_rebound_condition_is_caught_by_the_subject_gate(self):
        tree, _gates = K.build_skill_tree(ctx(), "2", level_values("2"), None)
        for cmd in wf_dsl.iter_dsl_commands(tree, "CreateCondition"):
            if cmd[2][0][0] == "ACPiercing":
                cmd[1] = 99                                       # p1 != 所在 FindAllSubjects
        self.assertNotEqual(L.action_dsl_subject_binding_problems(tree), [])


# ---------------------------------------------------------------- 3. 已构建的 workspace

@unittest.skipUnless(WORKSPACE.is_dir() and (WORKSPACE / "evidence/kit-report.json").is_file(),
                     "work/character_packs/ma-rolf 还没跑过 kit")
class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads((WORKSPACE / "evidence/kit-report.json").read_text("utf-8"))
        cls.gates = json.loads((WORKSPACE / "evidence/kit-gates.json").read_text("utf-8"))
        cls.pack = MC.MAPack(MS.get_spec("rolf"), record_sources=False)
        cls.ctx = B.KitContext(cls.pack)

    def test_report_is_a_zero_patch_kit(self):
        self.assertEqual(self.report["required_capabilities"], [])
        self.assertEqual(self.report["kit_gate"]["capabilities"], [])
        self.assertEqual(self.report["cid"], K.CID)
        self.assertEqual(len(self.report["panel"]), K.LEADER_ROWS + K.ABILITY_RECORDS)
        self.assertEqual(len(self.report["skills"]["programs"]), 2)

    def test_statue_groups_landed_as_designed(self):
        want = {key: str(ability_blocks()[key]["statue_group_c2"]) for key in K.ABILITY_KEYS}
        self.assertEqual(self.report["statue_groups"], want)
        self.assertEqual(want[K.ABILITY_KEYS[2]], "condition")     # D10
        self.assertEqual(want[K.ABILITY_KEYS[4]], "condition")     # D10

    def test_package_ability_rows_have_no_change_skill_cell(self):
        rows = self.ctx.pkg_flat(KL.ABILITY)
        for key in K.ABILITY_KEYS:
            self.assertIn(key, rows)
            for line in self.ctx.csv_split(rows[key]):
                self.assertNotIn("change_skill_", "".join(line))

    def test_action_skill_energy_matches_the_design(self):
        energy = DESIGN["plan"]["skills"]["energy"]
        inner = self.ctx.pkg_nested(K.CODE)
        self.assertEqual(set(inner), {"1", "2"})
        for level, cells in inner.items():
            block = energy[f"inner{level}"]
            self.assertEqual((cells[4], cells[5], cells[6]),
                             (str(block["c4"]), str(block["c5"]), str(block["c6"])))

    def test_voice_route_is_mirrored_into_the_character_row(self):
        row = self.ctx.csv_split(self.ctx.pkg_flat(KL.CHARACTER)[str(K.CID)])[0]
        self.assertEqual(row[9:17], K.VOICE_ROUTE_COLS)
        self.assertEqual(row[6], str(K.PF_TYPE))
        self.assertEqual(row[26], K.STANCE)
        self.assertEqual(row[27], str(K.CID))          # c27 identity 写自身 cid
        self.assertEqual(self.gates["voice_ready"]["key"], K.VOICE_KEY)

    def test_written_trees_read_back_and_still_point_at_the_official_effects(self):
        base = self.pack.pkg_path("common", "battle/action/skill/action/rare5")
        for level in ("1", "2"):
            path = base / f"{K.CODE}${K.CODE}_{level}.action.dsl.amf3.deflate"
            self.assertTrue(path.is_file(), path)
            tree = self.ctx.amf_parse(path.read_bytes())
            self.assertEqual(tree[0], "ActionDsl")
            self.assertEqual(tree[10], 0)
            self.assertEqual(len(K.statements(tree)), 3)
            self.assertEqual(K.effect_paths(tree), set(K.OFFICIAL_FX_PATHS))
            self.assertEqual(K.dsl_problems(tree), [])

    def test_pixel_products_are_installed_or_honestly_reported(self):
        pixel = self.gates["pixel"]
        if not pixel["present"]:
            self.assertEqual(self.report["status"], KL.DRAFT)
            return
        self.assertEqual(pixel["skipped"], [])
        for item in pixel["installed"]:
            self.assertTrue(item["logical"].startswith(f"character/{K.CODE}/"), item)


if __name__ == "__main__":
    unittest.main()
