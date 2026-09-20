# -*- coding: utf-8 -*-
"""芙拉菲 kit（149987 ``combat_animal_moon``）：设计稿自查 + 行装配 + DSL 嫁接门禁。

三组用例：

1. **纯静态**（不需要 live / 官方基线）：模块常量与 ``design/fluffy.json`` 的互锁、裁决 §8 的
   设计自查（队长表禁 422/724/713、c2 雕像组每键单值、面板禁词、``donor_ref`` 1 基→0 基换算、
   536/704 的 c70 字符串键登记）、以及本模块的 DSL 小工具（``signature_problems`` 能抓住裸数值
   塞进 Array 参与构造名写错、``roundtrip_problems`` 能抓住 ``{tree,numbers}`` 包装壳）。
2. **官方基线**（缺 ``.cdn/cn`` 或 live store 时跳过）：7+15 行逐行装配并与设计登记的
   ``wf_describe`` / ``row_final`` 逐字比对；两档技能树的嫁接（帧号、主体 id 重映射、倍率、
   终结段 Conditionals 两支）与全部 DSL 门禁。
3. **已构建的 workspace**（``work/character_packs/ma-fluffy`` 不存在时跳过）：包内自有键、
   kit-report、DSL 程序清单、语音路由、特效族与图集预算回执。

不写 live store / ``assets/`` / ``.cdn``，不跑发布；官方基线只读。
"""
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_dsl  # noqa: E402
import wf_midautumn_common as MC  # noqa: E402
import wf_midautumn_kit_fluffy as K  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_mod_tool as core  # noqa: E402
import wf_seasonal7_build as B  # noqa: E402

ROOT = core.project_root()
DESIGN = MS.load_design(ROOT, "fluffy")
WORKSPACE = ROOT / "work/character_packs/ma-fluffy"


def _baseline_available() -> bool:
    profile = core.resolve_profile()
    return profile is not None and profile.store.is_dir() and (ROOT / ".cdn" / "cn").is_dir()


_BASELINE = _baseline_available()
_CTX = None


def ctx():
    """只读上下文：``record_sources=False`` ⇒ 母本取数不写 workspace（框架 §10.2）。"""
    global _CTX
    if _CTX is None:
        _CTX = B.KitContext(MC.MAPack(MS.get_spec("fluffy"), record_sources=False))
    return _CTX


def fake_family(subdir: str, src_dir: str, members) -> dict:
    """``clone_effect_family`` 结果的只读替身（测树装配时不往包里写特效）。"""
    return {"src_dir": src_dir, "dst_dir": f"battle/effect/skill_unique/{K.CODE}/{subdir}",
            "donor": src_dir.rsplit("/", 1)[-1], "dst_name": subdir,
            "copied_bases": list(members)}


def fake_families() -> list[dict]:
    return [fake_family(subdir, src, members) for subdir, src, members, _lut in K.FX_FAMILIES]


# ---------------------------------------------------------------- 1. 纯静态

class ConstantTests(unittest.TestCase):
    def test_identity_matches_the_registry(self):
        spec = MS.get_spec("fluffy")
        self.assertEqual((spec.cid, spec.code), (K.CID, K.CODE))
        self.assertEqual((spec.template_id, spec.template_code), (K.TEMPLATE_ID, K.TEMPLATE_CODE))
        self.assertEqual(spec.element, K.ELEMENT)
        self.assertEqual(spec.pf_type, 1)                 # 拳型（母本 141033 c6=1）
        self.assertEqual(spec.stance, "Attacker")
        self.assertEqual(int(spec.rarity), 5)

    def test_no_unique_condition_is_declared(self):
        """连击轴不建固有状态（设计稿 D2）⇒ SPEC 里不许出现 unique_condition 键。"""
        self.assertNotIn(MS.UNIQUE_CONDITION_LOGICAL, K.SPEC["extra_keys"])
        self.assertEqual(DESIGN["plan"]["unique_conditions"]["add"], [])

    def test_spec_declares_every_self_owned_key(self):
        declared = {table: set(keys) for table, keys in K.SPEC["extra_keys"].items()}
        self.assertEqual(declared[KL.CAS], {K.CAS_FLAG1, K.CAS_FLAG2})
        self.assertEqual(declared[KL.SWITCHED], {K.VOICE_KEY})
        design_keys = {t: set(v) for t, v in (DESIGN["spec"].get("extra_keys") or {}).items()}
        self.assertEqual(design_keys, declared, "kit SPEC 与设计稿 spec.extra_keys 必须一致")

    def test_no_apk_capability_is_required(self):
        """整套 22 行不依赖任何补丁 kind（设计稿 §1）。"""
        self.assertEqual(tuple(K.SPEC["required_capabilities"]), ())
        self.assertEqual(list(DESIGN["spec"].get("required_capabilities") or []), [])

    def test_ability_keys_and_record_counts_match_the_design(self):
        plan = DESIGN["plan"]["ability"]
        self.assertEqual(tuple(plan["keys_order"]), K.ABILITY_KEYS)
        total = sum(len(plan["keys"][key]["records"]) for key in K.ABILITY_KEYS)
        self.assertEqual(total, K.ABILITY_RECORD_TOTAL)
        self.assertEqual(len(DESIGN["plan"]["leader_ability"]["rows"]), K.LEADER_ROW_COUNT)


class DesignSelfCheckTests(unittest.TestCase):
    """裁决 §8：kit 实现前对设计稿的自查，全部做成断言。"""

    def test_donor_addresses_are_one_based(self):
        source, kind, donor = K._parse_donor("o:leader:141165:3")
        self.assertEqual((source, kind, donor), ("official", "leader_ability", "141165#2"))
        source, kind, donor = K._parse_donor("s:ability:1599983:7")
        self.assertEqual((source, kind, donor), ("live", "ability", "1599983#6"))
        for bad in ("o:leader:141165", "x:leader:141165:1", "o:weapon:1:1", "o:leader:141165:0"):
            with self.assertRaises(KL.KitError):
                K._parse_donor(bad)

    def test_leader_rows_carry_no_forbidden_kind(self):
        """422（冲刺参数）/724（Fever 比例）/713 写进队长表 = C7050（裁决 §2/§8）。"""
        rows = [[str(c) for c in row["row_final"]] for row in DESIGN["plan"]["leader_ability"]["rows"]]
        K._ban_forbidden_leader_kinds(rows)                    # 不抛即通过
        poisoned = copy.deepcopy(rows)
        poisoned[0][45] = "422"
        with self.assertRaises(KL.KitError):
            K._ban_forbidden_leader_kinds(poisoned)
        poisoned = copy.deepcopy(rows)
        poisoned[0][107] = "724"
        with self.assertRaises(KL.KitError):
            K._ban_forbidden_leader_kinds(poisoned)

    def test_statue_group_and_unisonable_are_single_valued_per_key(self):
        """ability c2 雕像组、c1 主位限制每个键必须单值（裁决 §8：官方 790 个多记录键 0 个混用）。"""
        for slot, key in enumerate(K.ABILITY_KEYS, start=1):
            block = DESIGN["plan"]["ability"]["keys"][key]
            rows = [[str(c) for c in rec["row_final"]] for rec in block["records"]]
            KL.check_ability_key(rows, key, K.CODE, slot)
            self.assertEqual({r[1] for r in rows}, {block["unisonable_c1"]})
            self.assertEqual({r[2] for r in rows}, {block["statue_group_c2"]})

    def test_skill_flag_rows_reference_a_registered_string_key(self):
        """536/704 的 c70 查找键漏登记 ⇒ 详情页 C8601「资源损坏」假象。"""
        rows = [[str(c) for c in rec["row_final"]]
                for key in K.ABILITY_KEYS
                for rec in DESIGN["plan"]["ability"]["keys"][key]["records"]]
        keys = {entry["key"] for entry in
                DESIGN["plan"]["texts"]["custom_ability_string"]["rows"]}
        self.assertEqual(keys, {K.CAS_FLAG1, K.CAS_FLAG2})
        used = K.check_skill_flag_strings(rows, keys)
        self.assertEqual(sorted(used), sorted(keys))
        with self.assertRaises(KL.KitError):
            K.check_skill_flag_strings(rows, {K.CAS_FLAG1})     # 少登记一条就必须炸

    def test_panel_texts_obey_the_batch_rules(self):
        for row in DESIGN["plan"]["leader_ability"]["rows"]:
            self.assertEqual(KL.panel_problems(row["panel_expected"]), [], row["id"])
        for key in K.ABILITY_KEYS:
            for rec in DESIGN["plan"]["ability"]["keys"][key]["records"]:
                flag = str(rec["row_final"][47]) in K.SKILL_FLAG_KINDS
                self.assertEqual(KL.panel_problems(rec["panel_expected"], skill_flag=flag),
                                 [], rec["id"])
        for entry in DESIGN["plan"]["texts"]["custom_ability_string"]["rows"]:
            # 能力里的「技能强化」条目不写数字与时间（裁决 §3）
            self.assertEqual(KL.panel_problems(entry["text"], skill_flag=True), [], entry["key"])

    def test_design_does_not_write_desc_override(self):
        """没有 422/724/413、也没有恒真 HpLow 行 ⇒ 不写 desc_override（裁决 §3）。"""
        self.assertIsNone(DESIGN["plan"]["texts"]["desc_override"]["value"])
        self.assertFalse([k for k in K.SPEC["extra_keys"][KL.CAS] if k.startswith("desc_override")])

    def test_row_final_lengths_match_the_table_layouts(self):
        for row in DESIGN["plan"]["leader_ability"]["rows"]:
            self.assertEqual(len(row["row_final"]), KL.LEADER_NCOLS, row["id"])
        for key in K.ABILITY_KEYS:
            for rec in DESIGN["plan"]["ability"]["keys"][key]["records"]:
                self.assertEqual(len(rec["row_final"]), KL.ABILITY_NCOLS, rec["id"])

    def test_row_final_checker_catches_drift(self):
        entry = DESIGN["plan"]["leader_ability"]["rows"][0]
        row = [str(c) for c in entry["row_final"]]
        K._check_row_final(entry, row, "L0")                   # 一致：不抛
        row[49] = "999999"
        with self.assertRaises(KL.KitError):
            K._check_row_final(entry, row, "L0")


class DslToolTests(unittest.TestCase):
    def test_wait_event_shape(self):
        node = K.wait_event(20, [["ShakeCamera", 1]])
        self.assertEqual(node[0], "Event")
        self.assertEqual(node[1][:3], ["Wait", 20, "*"])
        self.assertEqual(node[1][3], ["Block", [["Command", ["ShakeCamera", 1]]]])
        self.assertEqual(K.signature_problems(node), [])

    def test_signature_gate_rejects_bare_number_in_array_param(self):
        """裸数值塞进 Array 参 = 详情页/进战斗 F1034，AMF3 往返自检抓不到。"""
        good = ["Command", ["CreateNormalAttack", 7, 255, [], [], 3, [{"min": 1, "max": 1}],
                            [{"min": 0, "max": 0}], False, False, False, False, False,
                            [{"min": 1, "max": 1}], [{"min": 1, "max": 1}], ["Fine"], True]]
        self.assertEqual(K.signature_problems(good), [])
        bad = copy.deepcopy(good)
        bad[1][6] = 1.0                                        # p6 应是 Array
        problems = K.signature_problems(bad)
        self.assertTrue(any("p6" in p and "Array" in p for p in problems), problems)

    def test_signature_gate_rejects_unknown_construct_names(self):
        """构造名写错不报错也不崩，节点被静默吞掉（记忆卡 wf-dsl-command-wait-trace-trap）。"""
        self.assertTrue(K.signature_problems(["Command", ["Wait", 30]]))
        self.assertTrue(K.signature_problems(["Command", ["ShakeCamara", 1]]))
        self.assertTrue(K.signature_problems(["Command", ["ShakeCamera", 1, 2]]))

    def test_signature_gate_rejects_donothing_branch(self):
        """``["DoNothing"]`` 是 IfTargetNotFound 的枚举，写进 Conditionals 分支 = F1009。"""
        bad = ["Command", ["ConditionalsChangeSkillFlag", 1, ["Block", []], ["DoNothing"]]]
        problems = K.signature_problems(bad)
        self.assertTrue(any("p3" in p and "ActionDslExpression" in p for p in problems), problems)
        good = ["Command", ["ConditionalsChangeSkillFlag", 1, ["Block", []], ["Block", []]]]
        self.assertEqual(K.signature_problems(good), [])

    def test_roundtrip_gate_rejects_the_wrapper_shell(self):
        """``encode_amf3`` 只吃裸树；喂 ``{tree, numbers}`` 壳 = 进战斗 F1034。"""
        tree = ["ActionDsl", 3, ["None"], True, False, False, False, False, False, False, 0,
                ["Block", [["Command", ["ShakeCamera", 1]]]]]
        self.assertEqual(K.roundtrip_problems(tree), [])       # 裸树自身往返一致
        shell = {"tree": tree, "numbers": []}
        # 壳自己也「往返一致」——这正是往返自检抓不到它的原因（记忆卡原话）
        self.assertEqual(K.roundtrip_problems(shell), [])
        # 真正拦住它的是落盘前的形状断言与落盘后的回读比对
        with self.assertRaises(KL.KitError):
            K._write_dsl_checked(None, "x$y", shell)
        self.assertNotEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(shell))["tree"], tree)
        self.assertGreater(K.MIN_ENCODED_BYTES, K.encoded_size(tree))

    def test_effect_refs_collects_both_resolver_shapes(self):
        tree = ["Block", [
            ["Command", ["ShowEffect", "a", ["SpecifyEffectDirectly", "x/y"], 1]],
            ["Command", ["ShowEffect", "b", ["ResolveByElement", "p/q", 4], 2]],
        ]]
        self.assertEqual(K.effect_refs(tree), ["x/y", "p/q"])

    def test_jab_family_is_direct_referenced_by_default(self):
        """设计稿 §5 退路（偏离 D7'）：jab 族不克隆，走官方路径直接引用。"""
        self.assertFalse(K.CLONE_JAB_FAMILY)
        self.assertEqual([f[0] for f in K.FX_FAMILIES], ["rush"])
        for base in K.FX_JAB[2]:
            self.assertIn(f"{K.FX_JAB[1]}/{base}", K.FX_DIRECT_REFERENCE)


# ---------------------------------------------------------------- 2. 官方基线

@unittest.skipUnless(_BASELINE, "需要 .cdn/cn 官方归档与 live store")
class RowAssemblyTests(unittest.TestCase):
    def test_leader_rows_render_exactly_as_designed(self):
        rows, evidence = K.build_leader_rows(ctx(), DESIGN)
        self.assertEqual(len(rows), K.LEADER_ROW_COUNT)
        for row, entry in zip(rows, DESIGN["plan"]["leader_ability"]["rows"]):
            self.assertEqual(row, [str(c) for c in entry["row_final"]])
        self.assertEqual([e["describe"] for e in evidence],
                         [r["desc_expected"] for r in DESIGN["plan"]["leader_ability"]["rows"]])
        self.assertEqual(sorted({c for e in evidence for c in e["capabilities"]}), [])

    def test_ability_rows_render_exactly_as_designed(self):
        rows_by_key, evidence = K.build_ability_rows(ctx(), DESIGN)
        self.assertEqual(sorted(rows_by_key), sorted(K.ABILITY_KEYS))
        self.assertEqual(len(evidence), K.ABILITY_RECORD_TOTAL)
        for slot, key in enumerate(K.ABILITY_KEYS, start=1):
            block = DESIGN["plan"]["ability"]["keys"][key]
            for row, rec in zip(rows_by_key[key], block["records"]):
                self.assertEqual(row, [str(c) for c in rec["row_final"]], rec["id"])
                self.assertEqual(row[0], f"{K.CODE}_{slot}")
        self.assertEqual(sorted({c for e in evidence for c in e["capabilities"]}), [])

    def test_a6_wind_token_is_set_in_all_three_columns(self):
        """A6#1 的 c11/c29/c49 三处都要换成 Green，漏 c49 会筛成光属性角色（设计稿 §3 ⚠）。"""
        rows_by_key, _ = K.build_ability_rows(ctx(), DESIGN)
        row = rows_by_key[f"{K.CID}6"][1]
        self.assertEqual([row[11], row[29], row[49]], ["Green", "Green", "Green"])


@unittest.skipUnless(_BASELINE, "需要 .cdn/cn 官方归档")
class SkillTreeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.trees = {}
        cls.evidence = {}
        for level in ("1", "2"):
            base = ctx().template_dsl(f"{K.PROGRAM_DIR}/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_{level}")
            xm = ctx().template_dsl(f"{K.PROGRAM_DIR}/{K.GRAFT_CODE}${K.GRAFT_CODE}_{level}")
            cls.trees[level], cls.evidence[level] = K.graft_tree(base, xm, level)

    def test_root_head_is_untouched(self):
        """``tree[1]=3``（有 MoveBall）、``tree[3]=true``、``tree[10]=0``（自动归属＝技能伤害）。"""
        for level, tree in self.trees.items():
            self.assertEqual(tree[:2], ["ActionDsl", 3], level)
            self.assertIs(tree[3], True, level)
            self.assertEqual(tree[10], 0, level)

    def test_timing_and_reference_point_lifetime(self):
        for level, tree in self.trees.items():
            rp = next(iter(wf_dsl.iter_dsl_commands(tree, "CreateReferencePoint")))
            self.assertEqual(rp[9], K.RP_LIFETIME, level)
            self.assertEqual(rp[10], K.BASE_RP_ID, level)
            waits = [node[1][1] for node in rp[11][1] if node[0] == "Event"]
            self.assertEqual(waits, [K.FRAME_JAB, *K.FRAMES_PESTLE, K.FRAME_FINAL,
                                     K.FRAME_FINISHER], level)
            # 参考点寿命必须 ≥ 最后一个 Wait 帧 + 判定区寿命，否则伤害静默消失
            self.assertGreaterEqual(K.RP_LIFETIME, K.FRAME_FINISHER + K.FINISHER_LIFETIME)
            stop = next(iter(wf_dsl.iter_dsl_commands(tree, "StopBall")))
            self.assertEqual(stop[2], K.STOP_BALL_FRAMES, level)
            hide = next(iter(wf_dsl.iter_dsl_commands(tree, "HideCharacter")))
            self.assertEqual(hide[2], K.HIDE_CHARACTER_FRAMES, level)

    def test_grafted_subject_ids_are_remapped(self):
        """xm21 子树 1..12 → 11..22；漏一处 lookup 位即 C16103。"""
        for level, tree in self.trees.items():
            areas = list(wf_dsl.iter_dsl_commands(tree, "CreateHitArea"))
            ids = sorted(a[19] for a in areas)
            self.assertEqual(ids, [1, 5, 8, 11, 14, 17, 20], level)
            for area in areas:
                if area[19] < K.ID_SHIFT + 1:
                    continue                                    # 底座的三个区不动
                self.assertEqual(area[2], K.BASE_RP_ID, level)  # 改挂敌侧参考点
                self.assertEqual([area[19], area[21], area[22]],
                                 [area[19], area[19] + 1, area[19] + 2], level)
                cna = next(iter(wf_dsl.iter_dsl_commands(area[23], "CreateNormalAttack")))
                self.assertEqual(cna[1], area[22], level)       # 伤害挂 node[22]（命中目标）

    def test_multipliers_and_alv_supplies(self):
        for level, tree in self.trees.items():
            want = K.SKILL_MULT[level]
            found = [cna[6][0] for cna in wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack")]
            self.assertEqual(len(found), 1 + 4 + 2, level)      # rush + 4 重击 + 终结两支
            self.assertIn(want["rush"], found, level)
            self.assertIn(want["pestle"], found, level)
            self.assertIn(want["finisher"], found, level)
            self.assertEqual(found.count(want["pestle"]), 4, level)
            # 536 供 alv 给四连重击，704 供 alv2 给精准连击；没供值时 ALv 项返回 0
            self.assertIn("alv_min", want["pestle"])
            self.assertIn("alv2_min", want["rush"])
            self.assertNotIn("alv_min", want["finisher"])

    def test_totals_land_in_the_decided_band(self):
        """裁决 §2：主 C 技能周期总倍率 78–95×（满级名义值）。"""
        ev = self.evidence["2"]
        self.assertAlmostEqual(ev["total_no_flag"], 78.0, places=2)
        self.assertAlmostEqual(ev["total_flag2_only"], 84.0, places=2)
        self.assertAlmostEqual(ev["total_both_flags"], 88.0, places=2)
        self.assertLessEqual(ev["total_both_flags"], 95.0)
        self.assertGreaterEqual(ev["total_no_flag"], 78.0)

    def test_finisher_branches_are_complete_blocks(self):
        """``ConditionalsChangeSkillFlag`` 两支都是完整 CNA；空分支才写 ``["Block", []]``。"""
        for level, tree in self.trees.items():
            cond = next(iter(wf_dsl.iter_dsl_commands(tree, "ConditionalsChangeSkillFlag")))
            self.assertEqual(cond[1], 1, level)
            for branch, p8 in ((cond[2], True), (cond[3], False)):
                self.assertEqual(branch[0], "Block", level)
                cna = next(iter(wf_dsl.iter_dsl_commands(branch, "CreateNormalAttack")))
                self.assertIs(cna[8], p8, level)
                self.assertEqual(cna[2], 255, level)            # 继承角色属性，不写显式元素码

    def test_finisher_hit_area_was_widened(self):
        for level, tree in self.trees.items():
            area = next(a for a in wf_dsl.iter_dsl_commands(tree, "CreateHitArea")
                        if a[19] == K.BASE_FINISH_AREA_ID)
            self.assertEqual(area[9], ["Circle", [{"min": K.FINISHER_RADIUS,
                                                   "max": K.FINISHER_RADIUS}]], level)
            self.assertEqual(area[13], ["SpecifyHitAreaLifetimeDirectly", K.FINISHER_LIFETIME], level)
            names = [s[1] for s in wf_dsl.iter_dsl_commands(area[20], "ShowEffect")]
            self.assertEqual(names, [K.EFFECT_CRACK_LABEL], level)

    def test_all_dsl_gates_pass_after_effect_rewrite(self):
        for level in ("1", "2"):
            tree = copy.deepcopy(self.trees[level])
            for family in fake_families():
                tree, _info = ctx().rewrite_effect_refs(tree, family, strict=True)
            self.assertEqual(K.dsl_problems(tree, element=K.ELEMENT), [], level)
            self.assertEqual(K.roundtrip_problems(tree), [], level)

    def test_every_effect_reference_is_cloned_or_whitelisted(self):
        allowed = {f["dst_dir"] for f in fake_families()}
        for level in ("1", "2"):
            tree = copy.deepcopy(self.trees[level])
            for family in fake_families():
                tree, _info = ctx().rewrite_effect_refs(tree, family, strict=True)
            for ref in K.effect_refs(tree):
                self.assertTrue(ref.rsplit("/", 1)[0] in allowed or ref in K.FX_DIRECT_REFERENCE,
                                f"{level}: {ref}")

    def test_graft_rejects_a_drifted_donor(self):
        base = copy.deepcopy(ctx().template_dsl(
            f"{K.PROGRAM_DIR}/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_2"))
        xm = ctx().template_dsl(f"{K.PROGRAM_DIR}/{K.GRAFT_CODE}${K.GRAFT_CODE}_2")
        next(iter(wf_dsl.iter_dsl_commands(base, "StopBall")))[2] = 31
        with self.assertRaises(KL.KitError):
            K.graft_tree(base, xm, "2")


# ---------------------------------------------------------------- 3. 已构建的 workspace

@unittest.skipUnless((WORKSPACE / "evidence" / "kit-report.json").is_file(),
                     "需要先跑 --step init,tables,kit,assets,manifest")
class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads((WORKSPACE / "evidence" / "kit-report.json").read_text("utf-8"))
        cls.gates = json.loads((WORKSPACE / "evidence" / "kit-gates.json").read_text("utf-8"))

    def test_report_identity_and_capabilities(self):
        self.assertEqual((self.report["cid"], self.report["code"]), (K.CID, K.CODE))
        self.assertEqual(self.report["required_capabilities"], [])
        self.assertEqual(sorted(self.report["custom_ability_string"]),
                         sorted((K.CAS_FLAG1, K.CAS_FLAG2)))

    def test_two_skill_programs_are_written(self):
        programs = self.report["skills"]["programs"]
        self.assertEqual(len(programs), 2)
        for level in ("1", "2"):
            self.assertTrue(any(f"{K.CODE}${K.CODE}_{level}." in p for p in programs), programs)

    def test_voice_route_is_change_skill_flag(self):
        route = self.gates["voice_route"]
        self.assertEqual(route[0], "3")                     # kind 3 = ChangeSkillFlag
        self.assertEqual(route[5], K.VOICE_KEY)
        self.assertEqual(self.gates["voice_ready"]["levels"], ["1", "2"])

    def test_effect_family_layout(self):
        families = self.gates["effect_families"]
        self.assertEqual([f["dst_dir"] for f in families],
                         [f"battle/effect/skill_unique/{K.CODE}/rush"])
        self.assertEqual(sorted(families[0]["copied_bases"]), sorted(K.FX_RUSH[2]))

    def test_action_skill_energy_matches_the_design(self):
        energy = DESIGN["plan"]["skills"]["energy"]
        for level, cells in self.gates["action_skill"].items():
            self.assertEqual([cells[4], cells[5]],
                             [str(energy[level]["c4"]), str(energy[level]["c5"])], level)

    def test_package_carries_only_its_own_ability_and_leader_keys(self):
        rows = self.gates["ability"]["rows"]
        self.assertEqual(sorted(rows), sorted(K.ABILITY_KEYS))
        self.assertEqual(len(self.gates["leader"]["rows"]), K.LEADER_ROW_COUNT)

    def test_panel_block_obeys_the_batch_rules(self):
        for text in self.report["panel"]:
            self.assertEqual(KL.panel_problems(text), [], text)

    def test_deviations_are_registered(self):
        """做不到／主动不做的条目不许静默降级（裁决 §6）。"""
        self.assertTrue(self.report["deviations"])
        blob = json.dumps(self.report["deviations"], ensure_ascii=False)
        self.assertIn("jab", blob)                            # 图集退路必须留痕


if __name__ == "__main__":
    unittest.main()
