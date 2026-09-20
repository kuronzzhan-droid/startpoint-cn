# -*- coding: utf-8 -*-
"""澄波响 kit（169988 ``psychic_teleport_moon``）：设计稿自查 + 行装配 + DSL 门禁。

三组用例：

1. **纯静态**（不需要 live / 官方基线）：模块常量与设计稿 JSON 的互锁、裁决 §8 的设计自查
   （队长表禁 422/724/713、固有 ID 8 位与上限非 ``(None)``、c2 雕像组每键单值、面板禁词）、
   以及本模块补的 DSL 小工具（DeleteCondition 主体重映射、``ConditionalsNumExecutions`` 拦截、
   ``write_dsl`` 包装壳拦截）。
2. **官方基线**（缺 ``.cdn/cn`` 或 live store 时跳过）：22 行逐行装配并与设计登记的 ``wf_describe``
   回读逐字比对；两棵技能树与三棵 722 树的装配与门禁；固有状态图标。
3. **已构建的 workspace**（``work/character_packs/ma-hibiki`` 不存在时跳过）：包内 5 个自有键、
   认领、kit-report 与 DSL 程序清单。

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
import wf_midautumn_common as MC  # noqa: E402
import wf_midautumn_kit_hibiki as K  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_mod_tool as core  # noqa: E402
import wf_seasonal7_build as B  # noqa: E402
import wf_seasonal7_common as C  # noqa: E402
import wf_seasonal7_kit_philia as PH  # noqa: E402

ROOT = core.project_root()
DESIGN = MS.load_design(ROOT, "hibiki")
WORKSPACE = ROOT / "work/character_packs/ma-hibiki"


def _baseline_available() -> bool:
    profile = core.resolve_profile()
    return (profile is not None and profile.store.is_dir() and (ROOT / ".cdn" / "cn").is_dir()
            and (ROOT / "work/codex_out/newchars-r2-20260906/gerald-native-pf").is_dir())


_BASELINE = _baseline_available()
_CTX = None


def ctx():
    """只读上下文：``record_sources=False`` ⇒ 母本取数不写 workspace（框架 §10.2）。"""
    global _CTX
    if _CTX is None:
        _CTX = B.KitContext(MC.MAPack(MS.get_spec("hibiki"), record_sources=False))
    return _CTX


def fake_family() -> dict:
    """``clone_effect_family`` 结果的只读替身（测树装配时不往包里写特效）。"""
    return {"src_dir": K.FX_SRC_DIR, "dst_dir": K.FX_DST_DIR, "donor": K.TEMPLATE_CODE,
            "dst_name": K.FX_SUBDIR, "copied_bases": [K.FX_BACK, K.FX_EF]}


# ---------------------------------------------------------------- 1. 纯静态

class ConstantTests(unittest.TestCase):
    def test_identity_matches_the_registry(self):
        spec = MS.get_spec("hibiki")
        self.assertEqual((spec.cid, spec.code), (K.CID, K.CODE))
        self.assertEqual((spec.template_id, spec.template_code), (K.TEMPLATE_ID, K.TEMPLATE_CODE))
        self.assertEqual(spec.element, K.ELEMENT)
        self.assertEqual(spec.pf_type, 3)            # 辅助型 ⇒ 722 是硬需求（原生 Lv1/Lv2 零伤害）
        self.assertEqual(spec.stance, "Attacker")

    def test_unique_condition_id_is_eight_digits(self):
        self.assertEqual(K.UID, str(K.CID * 100 + 1))
        self.assertEqual(len(K.UID), 8)
        self.assertTrue(MS.unique_condition_ok(K.CID, K.UID))

    def test_spec_declares_every_self_owned_key(self):
        keys = MS.get_spec("hibiki").extra_keys
        self.assertEqual(keys[MS.UNIQUE_CONDITION_LOGICAL], (K.UID,))
        self.assertEqual(keys[K.PFA], (K.PF_KEY,))
        self.assertEqual(set(keys[KL.CAS]), {K.CAS_PF, K.CAS_DASH})
        self.assertEqual(keys[KL.SWITCHED], (K.VOICE_KEY,))
        declared = {k: set(v) for k, v in DESIGN["plan"]["kit_declarations"]["SPEC.extra_keys"].items()}
        for logical, names in declared.items():
            self.assertTrue(names <= set(keys.get(logical, ())), logical)

    def test_pf_programs_match_the_design_value(self):
        block = DESIGN["plan"]["pf_override"]["power_flip_action"]
        self.assertEqual(block["key"], K.PF_KEY)
        self.assertEqual(block["value"].split(","), list(K.PF_PROGRAMS))
        self.assertEqual(float(DESIGN["plan"]["pf_override"]["scale_scalar"]), K.PF_SCALE)
        self.assertEqual(sorted(K.SPECIAL_SHA), [1, 2, 3])

    def test_donor_table_matches_the_design_record_counts(self):
        leader, ability = K._plan_rows(DESIGN)
        self.assertEqual(len(leader), len(K.LEADER_DONORS))
        self.assertEqual(tuple(ability), K.ABILITY_KEYS)
        for name, donors in K.ABILITY_DONORS.items():
            self.assertEqual(len(ability[name]["records"]), len(donors), name)
        for entry, (source, donor) in zip(leader, K.LEADER_DONORS):
            self.assertEqual(entry["donor_address"], f"{source}:{donor}")
        for name, donors in K.ABILITY_DONORS.items():
            for entry, (source, donor) in zip(ability[name]["records"], donors):
                self.assertEqual(entry["donor_address"], f"{source}:{donor}", name)


class DesignSelfCheckTests(unittest.TestCase):
    """裁决 §8：kit 实现前对设计稿的硬自查。"""

    def setUp(self):
        self.leader, self.ability = K._plan_rows(DESIGN)

    def test_leader_table_carries_no_patched_kinds(self):
        # 422 冲刺参数 / 724 Fever 比例 / 713 只许写 ability 表；写进队长表 = C7050
        for entry in self.leader:
            for col in ("45", "107"):
                self.assertNotIn(entry["cells"].get(col), ("422", "724", "713"), entry["index"])

    def test_leader_722_row_has_no_precondition(self):
        row = self.leader[0]["cells"]
        self.assertEqual(row["45"], "722")
        self.assertEqual(row["80"], K.PF_KEY)
        self.assertEqual(row["82"], K.CAS_PF)
        self.assertEqual(row["81"], "1,2,3")
        for col in ("4", "11", "18"):
            self.assertIn(row.get(col, "0"), ("", "0"), f"722 行挂了前置 c{col}")

    def test_unique_condition_cap_is_not_none(self):
        add = DESIGN["plan"]["unique_conditions"]["add"]
        self.assertEqual(len(add), 1)
        self.assertEqual(add[0]["key"], K.UID)
        self.assertEqual(add[0]["row"][4], K.UNIQUE_CAP)
        self.assertNotIn(add[0]["row"][4], ("", "(None)"))    # (None) = 上限 1 层，按层加成全死
        self.assertEqual(add[0]["row"][2], K.UNIQUE_ICON_ROW)

    def test_statue_group_is_single_valued_per_key(self):
        for name, plan in self.ability.items():
            groups = {r["cells"]["2"] for r in plan["records"]}
            self.assertEqual(len(groups), 1, f"{name} mixed statue groups {groups}")
            self.assertEqual(groups.pop(), plan["statue_group_c2"], name)
            self.assertIn(plan["statue_group_c2"], L.ABILITY_STATUE_GROUPS, name)
            flags = {r["cells"]["1"] for r in plan["records"]}
            self.assertEqual(len(flags), 1, f"{name} mixed unisonable flags {flags}")

    def test_during_puller_columns(self):
        # during 134 / during 1 的 puller 写 '0'；during 30 留空。写反 = 点「角色」C7050
        for name, plan in self.ability.items():
            for record in plan["records"]:
                cells = record["cells"]
                if cells.get("5") != "1":
                    continue
                want = "0" if cells.get("97") in ("134", "1") else ""
                self.assertEqual(cells.get("98", ""), want, f"{name}#{record['index']}")

    def test_dash_rows_are_scoped_to_the_leader(self):
        for record in self.ability[f"{K.CID}5"]["records"]:
            self.assertEqual(record["cells"]["109"], "422")
            self.assertEqual(record["cells"]["6"], "42")     # 前置 42 = 队长，避免与基诺维/泽赫尔相加
        self.assertIn(K.CAS_DASH, {e["key"] for e in
                                   DESIGN["plan"]["texts"]["custom_ability_string"]["rows"]})

    def test_panel_texts_obey_the_batch_rules(self):
        for entry in self.leader[1:]:
            self.assertEqual(KL.panel_problems(entry["desc_expected"]), [], entry["index"])
        for name, plan in self.ability.items():
            if name == f"{K.CID}5":
                continue                                     # 整槽走 desc_override
            for record in plan["records"]:
                self.assertEqual(KL.panel_problems(record["desc_expected"]), [],
                                 f"{name}#{record['index']}")
        for entry in DESIGN["plan"]["texts"]["custom_ability_string"]["rows"]:
            self.assertEqual(KL.panel_problems(entry["value"]), [], entry["key"])

    def test_every_row_carries_a_describe_readback(self):
        rows = list(self.leader) + [r for p in self.ability.values() for r in p["records"]]
        self.assertEqual(len(rows), 22)
        for entry in rows:
            self.assertTrue(entry.get("describe"), entry.get("donor_address"))

    def test_voice_route_targets_the_switch_key(self):
        cols = list(DESIGN["plan"]["kit_declarations"]["character_c9_c16"])
        self.assertEqual(cols, KL.voice_route(K.CODE, K.VOICE_ROUTE))
        self.assertEqual(cols[5], K.VOICE_KEY)
        self.assertEqual(cols[2], K.UID)

    def test_deviations_are_registered(self):
        ids = [item["id"] for item in DESIGN["deviations"]]
        self.assertEqual(len(ids), len(set(ids)))
        for item in DESIGN["deviations"]:
            self.assertTrue(item["intended"] and item["actual"] and item["reason"], item["id"])
        for wanted in ("D-9", "D-10", "D-11"):               # kit 实现阶段自查改出来的三条
            self.assertIn(wanted, ids)


class TreeHelperTests(unittest.TestCase):
    def test_remap_subjects_covers_delete_condition(self):
        node = ["Command", ["FindAllSubjects", 1, 113, [6], [], [], [], [], ["DoNothing"],
                            ["Block", [["Command", ["DeleteCondition", 1, ["DCAll", 3], 1, 0, "",
                                                    ["Default"]]]]]]]
        plain = copy.deepcopy(node)
        PH.remap_subjects(plain, {1: 201}.__getitem__)
        self.assertEqual(PH.cmds(plain, "DeleteCondition")[0][1], 1)   # philia 的版本不收录它
        fixed = copy.deepcopy(node)
        K.remap_subjects(fixed, {1: 201}.__getitem__)
        self.assertEqual(fixed[1][1], 201)
        self.assertEqual(PH.cmds(fixed, "DeleteCondition")[0][1], 201)

    def test_one_cmd_and_ac_node(self):
        cc = ["CreateCondition", -17, [["ACPiercing", [{"min": 60, "max": 60}]]]]
        self.assertEqual(K.ac_node(cc, "ACPiercing")[1][0]["min"], 60)
        with self.assertRaises(K.KitError):
            K.ac_node(cc, "ACFlying")
        with self.assertRaises(K.KitError):
            K.one_cmd(["Block", []], "ShowEffect")

    def test_conditional_names(self):
        tree = ["Block", [["Command", ["ConditionalsNumExecutionsOfPowerflip", 1, ["Block", []],
                                       ["Block", []]]]]]
        self.assertEqual(K.conditional_names(tree), {"ConditionalsNumExecutionsOfPowerflip"})

    def test_dsl_problems_rejects_num_executions_and_duplicate_binds(self):
        def find_all(bind):
            return ["Command", ["FindAllSubjects", bind, 33, [], [], [], [], [], ["DoNothing"],
                                ["Block", []]]]
        tree = ["ActionDsl", 1, ["None"], False, False, False, False, False, False, False, 0,
                ["Block", [find_all(1), find_all(1)]]]
        self.assertTrue(any("duplicate bound subject ids" in p
                            for p in K.dsl_problems(tree, element=None)))
        tree2 = ["ActionDsl", 1, ["None"], False, False, False, False, False, False, False, 0,
                 ["Block", [["Command", ["ConditionalsNumExecutionsOfPowerflip", 1, ["Block", []],
                                         ["Block", []]]]]]]
        self.assertTrue(any("ConditionalsNumExecutions" in p
                            for p in K.dsl_problems(tree2, element=None)))

    def test_write_dsl_checked_rejects_the_wrapper_shape(self):
        # 记忆卡 wf-dsl-encode-wrapper-trap：喂 {tree, numbers} 包装壳 = 进战斗 F1034
        with self.assertRaises(K.KitError):
            K.write_dsl_checked(None, "x", {"tree": ["ActionDsl"], "numbers": []})

    def test_draw_icon_keeps_the_donor_alpha(self):
        from PIL import Image
        frame = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
        for y in range(6, 42):
            for x in range(6, 42):
                frame.putpixel((x, y), (10, 10, 10, 255))
        icon = K.draw_icon(frame)
        self.assertEqual(icon.size, (48, 48))
        self.assertEqual(icon.getchannel("A").tobytes(), frame.getchannel("A").tobytes())
        with self.assertRaises(K.KitError):
            K.draw_icon(Image.new("RGBA", (64, 64)))


# ---------------------------------------------------------------- 2. 官方基线

@unittest.skipUnless(_BASELINE, "needs the official .cdn/cn baseline + live store + supporter sources")
class RowAssemblyTests(unittest.TestCase):
    def test_every_row_is_legal_and_describes_as_designed(self):
        leader, ability = K._plan_rows(DESIGN)
        checked = 0
        for entry, (source, donor) in zip(leader, K.LEADER_DONORS):
            row = KL.apply_cells(KL.donor_row(ctx(), KL.LEADER, donor, source=source),
                                 entry["cells"], KL.LEADER_NCOLS)
            self.assertEqual(KL.row_problems("leader_ability", row), {}, entry["donor_address"])
            self.assertEqual(KL.describe("leader_ability", row), entry["describe"])
            self.assertEqual(row[0], K.CODE)
            checked += 1
        for slot, name in enumerate(K.ABILITY_KEYS, start=1):
            rows = []
            for entry, (source, donor) in zip(ability[name]["records"], K.ABILITY_DONORS[name]):
                row = KL.apply_cells(KL.donor_row(ctx(), KL.ABILITY, donor, source=source),
                                     entry["cells"], KL.ABILITY_NCOLS)
                self.assertEqual(KL.row_problems("ability", row, K.ELEMENT), {},
                                 entry["donor_address"])
                self.assertEqual(KL.describe("ability", row), entry["describe"])
                rows.append(row)
                checked += 1
            KL.check_ability_key(rows, name, K.CODE, slot)
        self.assertEqual(checked, 22)

    def test_required_capabilities(self):
        leader, ability = K._plan_rows(DESIGN)
        caps = set()
        for entry, (source, donor) in zip(leader, K.LEADER_DONORS):
            row = KL.apply_cells(KL.donor_row(ctx(), KL.LEADER, donor, source=source),
                                 entry["cells"], KL.LEADER_NCOLS)
            caps.update(KL.capabilities("leader_ability", row))
        for name in K.ABILITY_KEYS:
            for entry, (source, donor) in zip(ability[name]["records"], K.ABILITY_DONORS[name]):
                row = KL.apply_cells(KL.donor_row(ctx(), KL.ABILITY, donor, source=source),
                                     entry["cells"], KL.ABILITY_NCOLS)
                caps.update(KL.capabilities("ability", row))
        self.assertIn("dash-parameter-v1", caps)
        self.assertEqual(L.panel_override_capability(K.CAS_DASH), "panel-description-override-v2")
        self.assertLessEqual(caps, set(K.SPEC["required_capabilities"]))

    def test_unique_row_rejects_a_none_cap(self):
        spec = MS.get_spec("hibiki")
        with self.assertRaises(KL.KitError):
            KL.unique_row(ctx(), spec, 1, donor=K.UNIQUE_DONOR,
                          cells={0: K.UNIQUE_STRING_ID, 4: "(None)"}, name=K.UNIQUE_NAME)


@unittest.skipUnless(_BASELINE, "needs the official .cdn/cn baseline + supporter sources")
class SkillTreeTests(unittest.TestCase):
    def test_both_levels_assemble_and_pass_the_gates(self):
        for level, want_field in (("1", 2.4), ("2", 3.0)):
            tree, gates = K.build_skill_tree(ctx(), level, fake_family())
            self.assertEqual(tree[0], "ActionDsl")
            self.assertEqual(tree[1], 1)
            self.assertEqual(tree[10], 0)                     # 技能伤害归属（设计 D-1）
            self.assertEqual(K.dsl_problems(tree), [])
            self.assertEqual(gates["n_attacks"], 1)           # 唯一伤害块 = 月光音场
            cna = PH.cmds(tree, "CreateNormalAttack")[0]
            self.assertEqual(cna[2], 255)                     # 继承角色属性，不写显式元素
            self.assertEqual(cna[6][0]["max"], want_field)
            self.assertEqual(cna[15], ["Fine"])
            self.assertEqual([p for p in gates["fx_paths"]
                              if not p.startswith(K.FX_DST_DIR + "/")], [])
            for path in PH.spec_paths(tree):
                self.assertFalse(path.startswith(K.FORBIDDEN_FX_PREFIXES), path)

    def test_team_block_and_echo(self):
        tree, _ = K.build_skill_tree(ctx(), "2", fake_family())
        conds = {c[2][0][0]: c for c in PH.cmds(tree, "CreateCondition")}
        self.assertEqual(set(conds), {"ACAttackPoint", "ACPowerFlipDamage", "ACPiercing", "ACUnique"})
        self.assertEqual(conds["ACPowerFlipDamage"][2][0][1][0]["min"], K.TEAM_PFDMG_FRAMES)
        self.assertEqual(conds["ACPowerFlipDamage"][2][0][2][0]["min"], 1.2)
        self.assertEqual(conds["ACPiercing"][2][0][1][0]["min"], 810)
        self.assertEqual(conds["ACPowerFlipDamage"][10], 2)   # 97 = 球 ⇒ 付与对象种类 2
        echo = conds["ACUnique"]
        self.assertEqual(echo[1], -17)
        self.assertEqual(echo[10], 3)                         # 自身/Member ⇒ 3
        self.assertEqual(K.ac_node(echo, "ACUnique")[1], int(K.UID))
        self.assertEqual(len(PH.cmds(tree, "DeleteCondition")), 2)
        self.assertEqual(len(PH.cmds(tree, "StopBall")), 1)

    def test_removed_template_blocks_are_gone(self):
        tree, _ = K.build_skill_tree(ctx(), "1", fake_family())
        self.assertEqual(PH.cmds(tree, "CreateRatioAttack"), [])     # 自伤（裁决 §2：零先例不用）
        self.assertEqual(PH.cmds(tree, "CreateRatioHeal"), [])
        self.assertEqual(K.conditional_names(tree), set())
        self.assertEqual([c for c in PH.cmds(tree, "CreateCondition")
                          if c[2][0][0] == "ACSkillDamage"], [])

    def test_subject_ids_land_in_the_planned_bands(self):
        _tree, gates = K.build_skill_tree(ctx(), "1", fake_family())
        self.assertEqual(gates["bound_ids"], [100, 101, 102, 200, 201, 202])


@unittest.skipUnless(_BASELINE, "needs the official .cdn/cn baseline + supporter sources")
class PowerFlipTests(unittest.TestCase):
    TOTALS = {1: 24.0, 2: 36.8, 3: 62.4}

    def test_three_levels_scale_and_keep_the_lifecycle(self):
        for level in (1, 2, 3):
            tree, gates = K.build_pf_tree(ctx(), level)
            self.assertEqual(tree[10], 0)
            self.assertEqual(K.dsl_problems(tree, element=None), [])
            self.assertAlmostEqual(gates["total"], self.TOTALS[level], places=6)
            self.assertTrue(PH.cmds(tree, "SetPowerFilpSuppress"))
            self.assertTrue(PH.cmds(tree, "NotifyPowerflipEnd"))
            for cha in PH.cmds(tree, "CreateHitArea"):
                self.assertEqual(cha[24], 0)   # p23=4 会按直击算，整块 PF 乘区被跳过
            self.assertEqual(gates["pierce_frames"], K.PF_PIERCE_FRAMES[level])

    def test_support_block_is_appended_once(self):
        for level in (1, 2, 3):
            tree, _ = K.build_pf_tree(ctx(), level)
            kinds = [c[2][0][0] for c in PH.cmds(tree, "CreateCondition")]
            self.assertEqual(kinds, ["ACAttackPoint", "ACPiercing", "ACFlying"])
            pierce = next(c for c in PH.cmds(tree, "CreateCondition")
                          if c[2][0][0] == "ACPiercing")
            self.assertEqual(K.ac_node(pierce, "ACPiercing")[1][0]["min"],
                             K.PF_PIERCE_FRAMES[level])
            self.assertIn(K.PF_SUPPORT_BIND, PH.bound_ids(tree))

    def test_official_effects_are_referenced_not_packaged(self):
        for level in (1, 2, 3):
            tree, gates = K.build_pf_tree(ctx(), level)
            self.assertTrue(gates["official_effects"])
            for path in gates["official_effects"]:
                self.assertFalse(path.startswith(f"battle/effect/skill_unique/{K.CODE}/"), path)

    def test_source_fingerprint_is_locked(self):
        with self.assertRaises(K.KitError):
            K.source_tree(ctx(), K.SPECIAL_PROGRAMS[1], "0" * 64)


# ---------------------------------------------------------------- 3. 已构建的 workspace

@unittest.skipUnless((WORKSPACE / "evidence/kit-report.json").is_file(),
                     "workspace ma-hibiki has not been built yet")
class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = MC.MAPack(MS.get_spec("hibiki"), record_sources=False)
        cls.report = json.loads((WORKSPACE / "evidence/kit-report.json").read_text("utf-8"))
        cls.claims = json.loads((WORKSPACE / "evidence/table_claims.json").read_text("utf-8"))

    def claimed(self, logical: str) -> set[str]:
        return {key for entry in self.claims if entry["logical_path"] == logical
                for key in entry["outer_keys"]}

    def test_package_carries_the_five_self_owned_keys(self):
        self.assertIn(K.UID, self.pack.pkg_flat(MS.UNIQUE_CONDITION_LOGICAL))
        self.assertIn(K.PF_KEY, self.pack.pkg_flat(K.PFA))
        cas = self.pack.pkg_flat(KL.CAS)
        self.assertIn(K.CAS_PF, cas)
        self.assertIn(K.CAS_DASH, cas)
        switched = C.core.load_nested_table_bytes(
            self.pack.pkg_path("common", KL.SWITCHED).read_bytes(), KL.SWITCHED)
        self.assertIn(K.VOICE_KEY, switched.rows)            # 嵌套表，不能用 pkg_flat
        inner = switched.rows[K.VOICE_KEY].text_rows()
        self.assertEqual(sorted(inner), ["1", "2"])
        for cells in inner.values():
            self.assertEqual(len(C.csv_split(cells)[0]), 17)  # = action_skill c7..c23

    def test_every_self_owned_key_is_claimed(self):
        # 漏认领 = rebase 静默回滚（记忆卡 wf-unison-slot-mechanics）
        self.assertIn(K.UID, self.claimed(MS.UNIQUE_CONDITION_LOGICAL))
        self.assertIn(K.PF_KEY, self.claimed(K.PFA))
        self.assertLessEqual({K.CAS_PF, K.CAS_DASH}, self.claimed(KL.CAS))
        self.assertIn(K.VOICE_KEY, self.claimed(KL.SWITCHED))
        self.assertEqual(self.claimed(KL.ABILITY), set(K.ABILITY_KEYS))
        self.assertEqual(self.claimed(KL.LEADER), {str(K.CID)})

    def test_power_flip_action_points_at_the_three_programs(self):
        row = C.csv_split(self.pack.pkg_flat(K.PFA)[K.PF_KEY])[0]
        self.assertEqual(row, list(K.PF_PROGRAMS))
        programs = set(self.report["skills"]["programs"])
        import wf_dsl
        for program in K.PF_PROGRAMS:
            self.assertIn(wf_dsl.dsl_logical(program), programs)

    def test_written_dsl_round_trips(self):
        import wf_dsl
        for program in list(K.PF_PROGRAMS) + [f"battle/action/skill/action/rare5/{K.CODE}${K.CODE}_{n}"
                                              for n in (1, 2)]:
            logical = wf_dsl.dsl_logical(program)
            tree = C.amf_parse(self.pack.pkg_path("common", logical).read_bytes())
            self.assertEqual(tree[0], "ActionDsl", logical)
            self.assertEqual(K.dsl_problems(tree, element=None), [], logical)

    def test_character_row_routes_the_voice(self):
        row = self.pack.pkg_character_row()
        self.assertEqual(row[9:17], KL.voice_route(K.CODE, K.VOICE_ROUTE))
        self.assertEqual(row[26], "Attacker")
        self.assertEqual(row[27], str(K.CID))

    def test_action_skill_energy_and_icon(self):
        energy = DESIGN["plan"]["skills"]["energy"]
        table = C.core.load_nested_table_bytes(
            self.pack.pkg_path("common", KL.ACTION).read_bytes(), KL.ACTION)
        rows = {k: C.csv_split(v)[0] for k, v in table.rows[K.CODE].text_rows().items()}
        self.assertEqual(sorted(rows), ["1", "2"])
        for level, cells in rows.items():
            self.assertEqual(cells[2], K.SKILL_ICON)
            self.assertEqual(cells[4], str(energy[level]["c4"]))
            self.assertEqual(cells[5], str(energy[level]["c5"]))

    def test_report_status_gate_only_covers_kit_owned_work(self):
        gate = self.report["kit_gate"]
        self.assertEqual(gate["rows"], 22)
        self.assertEqual(gate["programs"], 5)               # 技能 2 档 + 722 三档
        expected = KL.READY if gate["pixel_present"] and not gate["pixel_missing"] else KL.DRAFT
        self.assertEqual(self.report["status"], expected)

    def test_report_panel_and_deviations(self):
        self.assertEqual(self.report["cid"], K.CID)
        for text in self.report["panel"]:
            self.assertEqual(KL.panel_problems(text), [], text)
        self.assertEqual(len(self.report["deviations"]), len(DESIGN["deviations"]))
        self.assertEqual(set(self.report["required_capabilities"]),
                         set(K.SPEC["required_capabilities"]))
        self.assertEqual(self.report["unique_condition"][K.UID]["cap"], K.UNIQUE_CAP)

    def test_effect_family_is_the_only_cloned_one(self):
        families = json.loads((WORKSPACE / "evidence/effect-families.json").read_text("utf-8"))
        self.assertEqual(sorted(families), [K.FX_DST_DIR])
        self.assertEqual(sorted(families[K.FX_DST_DIR]["copied_bases"]),
                         sorted([K.FX_BACK, K.FX_EF]))
        self.assertEqual(families[K.FX_DST_DIR]["missing_effects"], [])


if __name__ == "__main__":
    unittest.main()
