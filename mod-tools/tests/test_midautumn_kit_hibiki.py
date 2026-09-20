# -*- coding: utf-8 -*-
"""澄波响 kit（169988 ``psychic_teleport_moon``）rework1：计划自查 + 行装配 + DSL 门禁。

三组用例：

1. **纯静态**（不需要 live / 官方基线）：模块常量、``design/hibiki.json`` 的 ``plan_rework1``
   镜像互锁、裁决 §8 的计划自查（队长表禁 422/724/713、前置白名单、629 必配字符串键与动作路径、
   固有 ID 8 位与上限非 ``(None)``、c2 雕像组每键单值、during puller 契约、面板禁词），
   以及本模块补的 DSL 小工具。
2. **官方基线**（缺 ``.cdn/cn`` 或 live store 时跳过）：27 行逐行装配并与模块登记的 ``wf_describe``
   回读逐字比对；两棵技能树、三棵 722 树、一棵 629 PF 追击树的装配与门禁；固有状态图标。
3. **已构建的 workspace**（``work/character_packs/ma-hibiki`` 不存在时跳过）：包内自有键、认领、
   kit-report、DSL 程序清单、面板接管文案的 CSV 往返（多行 ``\\n`` 必须活下来）。

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
PANEL_JSON = ROOT / "work/character_packs/midautumn-20260920/rework1/panel/hibiki.json"


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


def assembled_rows():
    """27 行成品（leader 9 + ability 18），只装配不写包。"""
    leader = [KL.apply_cells(KL.donor_row(ctx(), KL.LEADER, addr, source=src), cells,
                             KL.LEADER_NCOLS)
              for addr, src, cells, _expect in K.LEADER]
    ability = {}
    for slot in range(1, 7):
        rows = []
        for addr, src, cells, _expect in K.PLAN[slot]:
            merged = {0: f"{K.CODE}_{slot}", 1: K._UNISONABLE[slot], 2: K._STATUE[slot], **cells}
            rows.append(KL.apply_cells(KL.donor_row(ctx(), KL.ABILITY, addr, source=src),
                                       merged, KL.ABILITY_NCOLS))
        ability[f"{K.CID}{slot}"] = rows
    return leader, ability


# ---------------------------------------------------------------- 1. 纯静态

class ConstantTests(unittest.TestCase):
    def test_identity_matches_the_registry(self):
        spec = MS.get_spec("hibiki")
        self.assertEqual((spec.cid, spec.code), (K.CID, K.CODE))
        self.assertEqual((spec.template_id, spec.template_code), (K.TEMPLATE_ID, K.TEMPLATE_CODE))
        self.assertEqual(spec.element, K.ELEMENT)
        self.assertEqual(spec.pf_type, 3)            # 辅助型 ⇒ 722 是硬需求（原生 Lv1/Lv2 零伤害）
        self.assertEqual(spec.stance, "Attacker")

    def test_unique_condition_id_is_eight_digits_and_uncapped(self):
        self.assertEqual(K.UID, str(K.CID * 100 + 1))
        self.assertEqual(len(K.UID), 8)
        self.assertTrue(MS.unique_condition_ok(K.CID, K.UID))
        # rework1：作者「不设置上限」= 官方写法 99；(None) 是上限 1 层，按层加成会全死
        self.assertEqual(K.UNIQUE_CAP, "99")
        self.assertNotIn(K.UNIQUE_CAP, ("", "(None)"))

    def test_spec_declares_every_self_owned_key(self):
        keys = MS.get_spec("hibiki").extra_keys
        self.assertEqual(keys[MS.UNIQUE_CONDITION_LOGICAL], (K.UID,))
        self.assertEqual(keys[K.PFA], (K.PF_KEY,))
        self.assertEqual(set(keys[KL.CAS]), set(K.CAS_TEXTS))
        self.assertEqual(len(K.CAS_TEXTS), 10)       # 722 + 两条 629 + 队长块 + 6 槽
        self.assertEqual(keys[KL.SWITCHED], (K.VOICE_KEY,))

    def test_pf_and_invoke_programs(self):
        self.assertEqual(sorted(K.SPECIAL_SHA), [1, 2, 3])
        self.assertEqual(len(K.PF_PROGRAMS), 3)
        self.assertTrue(K.INVOKE_PROGRAM.startswith("battle/action/skill/action/ability_skill/"))
        self.assertEqual(K.INVOKE_BTA, 3)            # 629 载荷按 PF 伤害结算（偏离 D-15）
        self.assertEqual(K.INVOKE_SCALE, 1.0)        # 官方 special_lv3 原值，不叠 PF_SCALE（D-16）

    def test_plan_counts(self):
        self.assertEqual(K.LEADER_ROWS, 9)
        self.assertEqual(K.ABILITY_RECORDS, 18)
        self.assertEqual({slot: len(rows) for slot, rows in K.PLAN.items()},
                         {1: 2, 2: 2, 3: 3, 4: 3, 5: 5, 6: 3})
        self.assertEqual(K.ABILITY_KEYS, tuple(f"{K.CID}{n}" for n in range(1, 7)))

    def test_design_mirror_is_in_sync(self):
        self.assertEqual(K.design_problems(DESIGN), [])
        self.assertIn("plan", DESIGN)                # 首建版计划原样保留作历史
        self.assertEqual(DESIGN["plan_rework1"]["leader_rows"], K.LEADER_ROWS)

    def test_design_mirror_catches_drift(self):
        broken = copy.deepcopy(DESIGN)
        broken["plan_rework1"]["leader_rows"] = 6
        self.assertTrue(any("leader row count" in p for p in K.design_problems(broken)))
        self.assertEqual(K.design_problems({}), ["design has no plan_rework1 block"])


class PlanSelfCheckTests(unittest.TestCase):
    """裁决 §8：装配前对行计划的硬自查（不需要 donor 表，只看本模块登记的格子）。"""

    def test_leader_plan_carries_no_patched_kinds(self):
        # 422 冲刺参数 / 724 Fever 比例 / 713 只许写 ability 表；写进队长表 = C7050
        for index, (_addr, _src, cells, _expect) in enumerate(K.LEADER):
            for col in (K.LEADER_INSTANT_KIND, K.LEADER_DURING_KIND):
                self.assertNotIn(str(cells.get(col, "")), K.FORBIDDEN_LEADER_KINDS, index)

    def test_dash_rows_stay_in_the_ability_table_and_are_leader_scoped(self):
        dash = [cells for _a, _s, cells, _e in K.PLAN[5] if cells.get(109) == "422"]
        self.assertEqual(len(dash), 4)               # 速度 / CD / 蓄力 / 发动高度
        for cells in dash:
            self.assertEqual(cells[6], "42")         # 前置 42 = 队长，避免与基诺维/泽赫尔相加
        self.assertEqual(sorted(c[118] for c in dash), ["0", "1", "3", "6"])

    def test_leader_722_row_has_no_precondition(self):
        cells = K.LEADER[0][2]
        self.assertEqual(cells[45], "722")
        self.assertEqual(cells[80], K.PF_KEY)
        self.assertEqual(cells[82], K.CAS_PF)
        self.assertEqual(cells[81], "1,2,3")
        for col in (4, 11, 18):
            self.assertIn(cells.get(col, "0"), ("", "0"), f"722 行挂了前置 c{col}")

    def test_the_two_invoke_rows(self):
        invoke = [(n, cells) for n, (_a, _s, cells, _e) in enumerate(K.LEADER)
                  if cells.get(45) == "629"]
        self.assertEqual(len(invoke), 2)
        by_trigger = {cells[25]: cells for _n, cells in invoke}
        self.assertEqual(sorted(by_trigger), ["23", "4"])
        skill_row = by_trigger["23"]                 # 暗属性角色发动技能时（官方同形 141111#1）
        self.assertEqual((skill_row[26], skill_row[27]), ("5", K.ELEMENT_TOKEN))
        self.assertEqual(skill_row[4], "2")          # 暗共鸣门
        self.assertEqual(skill_row[68], K.CAS_INVOKE_SKILL)
        dash_row = by_trigger["4"]                   # 冲刺时 CT 5 秒
        self.assertEqual(dash_row[33], "300")
        self.assertEqual(dash_row[68], K.CAS_INVOKE_DASH)
        for _n, cells in invoke:
            self.assertEqual(cells[69], K.INVOKE_PROGRAM)
            self.assertEqual(cells[32], "(None)")    # 触发次数无上限
            self.assertEqual(cells[46], "0")         # target = 自身

    def test_uncapped_hit_row(self):
        """L7「强化弹射Lv1命中每达到4次，自身攻击力＋50%」与 L5 并行，且不设触发上限。"""
        l5, l7 = K.LEADER[5][2], K.LEADER[7][2]
        self.assertEqual((l5[25], l7[25]), ("15", "15"))
        self.assertEqual((l5[28], l7[28]), ("400000", "400000"))
        self.assertEqual(l5[32], "10")               # 官方原行：限 10 次、赋全队
        self.assertEqual(l7[32], "(None)")           # 新行：无上限、只给自身
        self.assertEqual((l7[46], l7[47]), ("0", ""))
        self.assertEqual((l7[49], l7[50]), ("50000", "50000"))

    def test_echo_rows(self):
        """回响：461 挂暗共鸣门；PF 伤害/攻击力按 99 层，独立乘区与全队暗攻仍封顶 5 层。"""
        gain = K.PLAN[3][0][2]
        self.assertEqual(gain[47], "461")
        self.assertEqual((gain[6], gain[11]), ("2", K.ELEMENT_TOKEN))
        self.assertEqual(gain[68], K.UID)
        caps = {}
        for slot in (3, 4, 6):
            for _a, _s, cells, _e in K.PLAN[slot]:
                if cells.get(97) == "134":
                    caps[(slot, cells[109])] = cells[102]
        self.assertEqual(caps[(3, "23")], K.UNIQUE_CAP)      # PF 伤害 +25%/层，99 层
        self.assertEqual(caps[(4, "0")], K.UNIQUE_CAP)       # 自身攻击力 +25%/层，99 层（D-13）
        self.assertEqual(caps[(3, "413")], "5")              # 独立乘区 +5%/层，作者「最大 25%」
        self.assertEqual(caps[(6, "0")], "5")                # 全队暗攻 +15%/层
        for cells in (K.PLAN[3][1][2], K.PLAN[3][2][2], K.PLAN[4][2][2], K.PLAN[6][2][2]):
            self.assertEqual(cells[104], K.UID)

    def test_ability_2_values_are_doubled(self):
        self.assertEqual((K.PLAN[2][0][2][51], K.PLAN[2][0][2][52]), ("8000", "8000"))
        self.assertEqual((K.PLAN[2][1][2][51], K.PLAN[2][1][2][52]), ("12000", "12000"))

    def test_ability_5_gains_the_flat_independent_multiplier(self):
        first = K.PLAN[5][0][2]
        self.assertEqual(first[109], "413")
        self.assertEqual((first[113], first[114]), ("30000", "30000"))
        self.assertEqual(first[118], "")             # 不是 422 行，冲刺参数 id 必须留空
        self.assertEqual(first[6], "0")              # 常驻，不挂队长前置

    def test_statue_group_and_unisonable_are_single_valued(self):
        self.assertEqual(sorted(K._STATUE), [1, 2, 3, 4, 5, 6])
        for group in K._STATUE.values():
            self.assertIn(group, L.ABILITY_STATUE_GROUPS)
        self.assertEqual(K._UNISONABLE[3], "false")  # 槽 3 仅主位（面板 main_only）

    def test_precondition_kinds_are_whitelisted(self):
        for index, (_a, _s, cells, _e) in enumerate(K.LEADER):
            for col in (4, 11, 18):
                self.assertIn(str(cells.get(col, "")), K.ALLOWED_PRECONDITION_KINDS, index)
        for slot, rows in K.PLAN.items():
            for index, (_a, _s, cells, _e) in enumerate(rows):
                for col in (6, 13, 20):
                    self.assertIn(str(cells.get(col, "")), K.ALLOWED_PRECONDITION_KINDS,
                                  f"{slot}#{index}")

    def test_during_puller_columns(self):
        # during 134 / during 1 的 puller 写 '0'；during 30 留空。写反 = 点「角色」C7050
        for slot, rows in K.PLAN.items():
            for index, (_a, _s, cells, _e) in enumerate(rows):
                if cells.get(5) != "1":
                    continue
                want = "0" if cells.get(97) in ("134", "1") else ""
                self.assertEqual(cells.get(98, ""), want, f"{slot}#{index}")
        for index, (_a, _s, cells, _e) in enumerate(K.LEADER):
            if cells.get(3) != "1":
                continue
            want = "0" if cells.get(95) in ("134", "1") else ""
            self.assertEqual(cells.get(96, ""), want, index)

    def test_row_self_check_rejects_a_leader_422(self):
        rows = [[""] * KL.LEADER_NCOLS]
        rows[0][3] = "1"
        rows[0][K.LEADER_DURING_KIND] = "422"
        with self.assertRaises(K.KitError):
            K._row_self_check("leader_ability", rows, "leader")

    def test_row_self_check_rejects_a_629_without_a_string_key(self):
        rows = [[""] * KL.LEADER_NCOLS]
        rows[0][3] = "0"
        rows[0][K.LEADER_INSTANT_KIND] = "629"
        rows[0][K.LEADER_ACTION_PATH] = K.INVOKE_PROGRAM
        with self.assertRaises(K.KitError):
            K._row_self_check("leader_ability", rows, "leader")


class PanelTextTests(unittest.TestCase):
    def test_panel_obeys_the_batch_rules(self):
        for key, text in K.CAS_TEXTS.items():
            self.assertEqual(KL.panel_problems(text), [], key)

    def test_panel_is_transcribed_from_the_authors_sheet(self):
        """逐行等于 rework1/panel/hibiki.json（作者已过目的那一版）。"""
        if not PANEL_JSON.is_file():
            self.skipTest("rework1/panel/hibiki.json missing")
        want = json.loads(PANEL_JSON.read_text(encoding="utf-8"))
        self.assertEqual(K.PANEL_LEADER.split("\n"),
                         [line["text"] for line in want["leader"]["lines"]])
        for block in want["abilities"]:
            slot = int(block["index"])
            self.assertEqual(K.PANEL_ABILITY[slot].split("\n"),
                             [line["text"] for line in block["lines"]], slot)
            self.assertEqual(K._UNISONABLE[slot], "false" if block["main_only"] else "true", slot)

    def test_leader_and_slot_override_keys(self):
        # desc_override 的键 = 该块第 0 行的 string_id（队长块 = c0，能力槽 = <code>_<slot>）
        self.assertEqual(K.CAS_LEADER, f"desc_override_{K.CODE}")
        self.assertEqual(K.LEADER[0][2][0], K.CODE)
        for slot in range(1, 7):
            self.assertEqual(K.CAS_ABILITY[slot], f"desc_override_{K.CODE}_{slot}")
            self.assertEqual(L.panel_override_capability(K.CAS_ABILITY[slot]),
                             "panel-description-override-v2")
        self.assertIn("panel-description-override-v2", K.SPEC["required_capabilities"])

    def test_deviations_are_registered(self):
        ids = [item["id"] for item in DESIGN["deviations"]]
        self.assertEqual(len(ids), len(set(ids)))
        for item in DESIGN["deviations"]:
            self.assertTrue(item["intended"] and item["actual"] and item["reason"], item["id"])
        for wanted in DESIGN["rework1"]["deviations_new"]:
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
    def test_every_row_is_legal_and_describes_as_planned(self):
        leader, ability = assembled_rows()
        checked = 0
        for row, (addr, _src, _cells, expect) in zip(leader, K.LEADER):
            self.assertEqual(KL.row_problems("leader_ability", row), {}, addr)
            self.assertEqual(KL.describe("leader_ability", row), expect, addr)
            self.assertEqual(row[0], K.CODE)
            checked += 1
        K._row_self_check("leader_ability", leader, "leader")
        for slot in range(1, 7):
            key = f"{K.CID}{slot}"
            rows = ability[key]
            for row, (addr, _src, _cells, expect) in zip(rows, K.PLAN[slot]):
                self.assertEqual(KL.row_problems("ability", row, K.ELEMENT), {}, addr)
                self.assertEqual(KL.describe("ability", row), expect, addr)
                checked += 1
            KL.check_ability_key(rows, key, K.CODE, slot)
            K._row_self_check("ability", rows, key)
        self.assertEqual(checked, K.LEADER_ROWS + K.ABILITY_RECORDS)
        self.assertEqual(checked, 27)

    def test_required_capabilities(self):
        leader, ability = assembled_rows()
        caps = set()
        for row in leader:
            caps.update(KL.capabilities("leader_ability", row))
        for rows in ability.values():
            for row in rows:
                caps.update(KL.capabilities("ability", row))
        self.assertIn("dash-parameter-v1", caps)
        self.assertLessEqual(caps, set(K.SPEC["required_capabilities"]))

    def test_statue_group_precedent_report_only_flags_the_known_gaps(self):
        _leader, ability = assembled_rows()
        report = K.statue_group_report(ctx(), ability)
        zero = sorted({f"{e['group']}×{e['trigger']}{e['kind']}"
                       for e in report if e["official_rows"] == 0})
        # 422 是官方全表 0 行的补丁 kind；413×attack_common 官方 0 行（power_flip / action_skill
        # 上才有先例，rework1 新增，偏离 D-18）；461×power_flip 官方 0 行（live 有先例，首建版就在）。
        # c2 只喂 ability_statue_group 的外观三列，记录而非阻断。
        self.assertEqual(zero, ["attack_common×during413", "attack_common×during422",
                                "power_flip×instant461"])

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


@unittest.skipUnless(_BASELINE, "needs the official .cdn/cn baseline")
class InvokeTreeTests(unittest.TestCase):
    """rework1 的 629 PF 追击树（斩铁式：官方 PF 底座只留命中块）。"""

    def test_tree_shape_and_gates(self):
        tree, gates = K.build_invoke_tree(ctx())
        self.assertEqual(tree[0], "ActionDsl")
        self.assertEqual(tree[1], 1)
        self.assertEqual(tree[10], K.INVOKE_BTA)           # 3 = 按强化弹射伤害结算
        self.assertEqual(K.dsl_problems(tree, element=None), [])
        self.assertEqual(gates["total"], 13.0)             # 官方 special_lv3 原值 4 + 9
        self.assertEqual(gates["multipliers"], [4.0, 9.0])

    def test_power_flip_lifecycle_commands_are_gone(self):
        # SetPowerFilpSuppress 会压掉玩家真正的拍板；NotifyPowerflipEnd 在非 PF 上下文不计数
        tree, _ = K.build_invoke_tree(ctx())
        for name in ("SetPowerFilpSuppress", "NotifyPowerflipEnd", "RemoveEvent", "HideEffect"):
            self.assertEqual(PH.cmds(tree, name), [], name)
        self.assertEqual(len(PH.cmds(tree, "CreateHitArea")), 2)

    def test_only_official_powerflip_effects_are_referenced(self):
        _tree, gates = K.build_invoke_tree(ctx())
        self.assertTrue(gates["official_effects"])
        for path in gates["official_effects"]:
            self.assertTrue(path.startswith("battle/effect/powerflip/"), path)

    def test_coordinate_systems_stay_ab(self):
        """主体是球/敌人的 ShowEffect 与判定区坐标系只能 AB 或 GH（U_4f5401 教训）。"""
        tree, _ = K.build_invoke_tree(ctx())
        ref = PH.cmds(tree, "CreateReferencePoint")[0]
        self.assertEqual((ref[1], ref[2]), (-18, ["AB"]))
        for show in PH.cmds(tree, "ShowEffect"):
            self.assertIn(show[6], (["AB"], ["GH"]))
        for cha in PH.cmds(tree, "CreateHitArea"):
            self.assertIn(cha[3], (["AB"], ["GH"]))


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

    def test_package_carries_every_self_owned_key(self):
        self.assertIn(K.UID, self.pack.pkg_flat(MS.UNIQUE_CONDITION_LOGICAL))
        self.assertIn(K.PF_KEY, self.pack.pkg_flat(K.PFA))
        cas = self.pack.pkg_flat(KL.CAS)
        for key in K.CAS_TEXTS:
            self.assertIn(key, cas, key)
        switched = C.core.load_nested_table_bytes(
            self.pack.pkg_path("common", KL.SWITCHED).read_bytes(), KL.SWITCHED)
        self.assertIn(K.VOICE_KEY, switched.rows)            # 嵌套表，不能用 pkg_flat
        inner = switched.rows[K.VOICE_KEY].text_rows()
        self.assertEqual(sorted(inner), ["1", "2"])
        for cells in inner.values():
            self.assertEqual(len(C.csv_split(cells)[0]), 17)  # = action_skill c7..c23

    def test_panel_override_survives_the_csv_round_trip(self):
        """多行 desc_override 的 ``\\n`` 必须活过 orderedmap 的 CSV 编解码。"""
        cas = self.pack.pkg_flat(KL.CAS)
        for key, text in K.CAS_TEXTS.items():
            self.assertEqual(C.csv_split(cas[key])[0][0], text, key)
        self.assertEqual(len(K.PANEL_LEADER.split("\n")), 10)

    def test_every_self_owned_key_is_claimed(self):
        # 漏认领 = rebase 静默回滚（记忆卡 wf-unison-slot-mechanics）
        self.assertIn(K.UID, self.claimed(MS.UNIQUE_CONDITION_LOGICAL))
        self.assertIn(K.PF_KEY, self.claimed(K.PFA))
        self.assertLessEqual(set(K.CAS_TEXTS), self.claimed(KL.CAS))
        self.assertIn(K.VOICE_KEY, self.claimed(KL.SWITCHED))
        self.assertEqual(self.claimed(KL.ABILITY), set(K.ABILITY_KEYS))
        self.assertEqual(self.claimed(KL.LEADER), {str(K.CID)})

    def test_written_tables_match_the_plan(self):
        leader = C.csv_split(self.pack.pkg_flat(KL.LEADER)[str(K.CID)])
        self.assertEqual(len(leader), K.LEADER_ROWS)
        ability = self.pack.pkg_flat(KL.ABILITY)
        for slot in range(1, 7):
            rows = C.csv_split(ability[f"{K.CID}{slot}"])
            self.assertEqual(len(rows), len(K.PLAN[slot]), slot)
            self.assertEqual({r[2] for r in rows}, {K._STATUE[slot]}, slot)
            self.assertEqual({r[1] for r in rows}, {K._UNISONABLE[slot]}, slot)
        unique = C.csv_split(self.pack.pkg_flat(MS.UNIQUE_CONDITION_LOGICAL)[K.UID])[0]
        self.assertEqual(unique[4], K.UNIQUE_CAP)
        self.assertEqual(unique[1], K.UNIQUE_NAME)

    def test_power_flip_action_points_at_the_three_programs(self):
        row = C.csv_split(self.pack.pkg_flat(K.PFA)[K.PF_KEY])[0]
        self.assertEqual(row, list(K.PF_PROGRAMS))
        programs = set(self.report["skills"]["programs"])
        import wf_dsl
        for program in K.PF_PROGRAMS:
            self.assertIn(wf_dsl.dsl_logical(program), programs)
        self.assertIn(wf_dsl.dsl_logical(K.INVOKE_PROGRAM), programs)

    def test_written_dsl_round_trips(self):
        import wf_dsl
        programs = list(K.PF_PROGRAMS) + [K.INVOKE_PROGRAM] + [
            f"battle/action/skill/action/rare5/{K.CODE}${K.CODE}_{n}" for n in (1, 2)]
        for program in programs:
            logical = wf_dsl.dsl_logical(program)
            tree = C.amf_parse(self.pack.pkg_path("common", logical).read_bytes())
            self.assertEqual(tree[0], "ActionDsl", logical)
            self.assertEqual(K.dsl_problems(tree, element=None), [], logical)
        invoke = C.amf_parse(self.pack.pkg_path("common", wf_dsl.dsl_logical(K.INVOKE_PROGRAM))
                             .read_bytes())
        self.assertEqual(invoke[10], K.INVOKE_BTA)

    def test_character_row_routes_the_voice(self):
        row = self.pack.pkg_character_row()
        self.assertEqual(row[9:17], KL.voice_route(K.CODE, K.VOICE_ROUTE))
        self.assertEqual(row[26], "Attacker")
        self.assertEqual(row[27], str(K.CID))

    def test_action_skill_energy_and_icon(self):
        table = C.core.load_nested_table_bytes(
            self.pack.pkg_path("common", KL.ACTION).read_bytes(), KL.ACTION)
        rows = {k: C.csv_split(v)[0] for k, v in table.rows[K.CODE].text_rows().items()}
        self.assertEqual(sorted(rows), ["1", "2"])
        for level, cells in rows.items():
            self.assertEqual(cells[2], K.SKILL_ICON)
            self.assertEqual(cells[4], str(K.SKILL_ENERGY[level]["c4"]))
            self.assertEqual(cells[5], str(K.SKILL_ENERGY[level]["c5"]))

    def test_report_status_gate_only_covers_kit_owned_work(self):
        gate = self.report["kit_gate"]
        self.assertEqual(gate["rows"], 27)
        self.assertEqual(gate["programs"], 6)               # 技能 2 档 + 722 三档 + 629 追击
        expected = KL.READY if gate["pixel_present"] and not gate["pixel_missing"] else KL.DRAFT
        self.assertEqual(self.report["status"], expected)

    def test_report_panel_and_deviations(self):
        self.assertEqual(self.report["cid"], K.CID)
        self.assertEqual(self.report["panel"],
                         [K.PANEL_LEADER] + [K.PANEL_ABILITY[s] for s in range(1, 7)])
        for text in self.report["panel"]:
            self.assertEqual(KL.panel_problems(text), [], text)
        self.assertEqual(len(self.report["deviations"]), len(DESIGN["deviations"]))
        self.assertEqual(set(self.report["required_capabilities"]),
                         set(K.SPEC["required_capabilities"]))
        self.assertEqual(self.report["unique_condition"][K.UID]["cap"], K.UNIQUE_CAP)
        self.assertEqual(self.report["ability_skill_programs"], [K.INVOKE_PROGRAM])

    def test_effect_family_is_the_only_cloned_one(self):
        families = json.loads((WORKSPACE / "evidence/effect-families.json").read_text("utf-8"))
        self.assertEqual(sorted(families), [K.FX_DST_DIR])
        self.assertEqual(sorted(families[K.FX_DST_DIR]["copied_bases"]),
                         sorted([K.FX_BACK, K.FX_EF]))
        self.assertEqual(families[K.FX_DST_DIR]["missing_effects"], [])


if __name__ == "__main__":
    unittest.main()
