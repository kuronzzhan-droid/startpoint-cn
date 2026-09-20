# -*- coding: utf-8 -*-
"""丝缇涅尔 kit（159995 ``still_obstinator_moon``）：设计稿自查 + 行装配 + 技能树门禁。

三组用例：

1. **纯静态**（不需要 live / 官方基线）：模块常量与设计稿 JSON 的互锁、裁决 §8 的设计自查
   （队长表禁 422/724/713、零固有状态、c1/c2 每键单值、面板禁词、``donor`` 地址 1 基→0 基
   换算、536 的 string_id 已注册），以及本模块的小工具（``_check_full_row``、
   ``_write_dsl_checked`` 的包装壳拦截、四块嫁接的纯树变换）。
2. **官方基线**（缺 ``.cdn/cn`` 或 live store 时跳过）：7+14 行逐行装配并与设计登记的
   ``wf_describe`` 回读逐字比对；两棵技能树的嫁接、主体重映射与四道门。
3. **已构建的 workspace**（``work/character_packs/ma-stinel`` 不存在时跳过）：包内自有键、
   认领、kit-report、技能能量、语音路由、特效族。

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
import wf_midautumn_kit_stinel as K  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_mod_tool as core  # noqa: E402
import wf_seasonal7_build as B  # noqa: E402
import wf_seasonal7_common as C  # noqa: E402

ROOT = core.project_root()
DESIGN = MS.load_design(ROOT, "stinel")
WORKSPACE = ROOT / "work/character_packs/ma-stinel"


def _baseline_available() -> bool:
    profile = core.resolve_profile()
    return profile is not None and profile.store.is_dir() and (ROOT / ".cdn" / "cn").is_dir()


_BASELINE = _baseline_available()
_CTX = None


def ctx():
    """只读上下文：``record_sources=False`` ⇒ 母本取数不写 workspace（框架 §10.2）。"""
    global _CTX
    if _CTX is None:
        _CTX = B.KitContext(MC.MAPack(MS.get_spec("stinel"), record_sources=False))
    return _CTX


def fake_family() -> dict:
    """``clone_effect_family`` 结果的只读替身（测树装配时不往包里写特效）。"""
    return {"src_dir": K.FX_SRC_DIR, "dst_dir": K.FX_DST_DIR, "donor": K.TEMPLATE_CODE,
            "dst_name": K.FX_SUBDIR, "copied_bases": [K.FX_FUNNEL, K.FX_EXPLOSION]}


def graft_parts():
    return K.pick_graft_blocks(ctx().template_dsl(K.GRAFT_PROGRAM.format(lv="2")))


# ---------------------------------------------------------------- 1. 纯静态

class ConstantTests(unittest.TestCase):
    def test_identity_matches_the_registry(self):
        spec = MS.get_spec("stinel")
        self.assertEqual((spec.cid, spec.code), (K.CID, K.CODE))
        self.assertEqual((spec.template_id, spec.template_code), (K.TEMPLATE_ID, K.TEMPLATE_CODE))
        self.assertEqual(spec.element, K.ELEMENT)
        self.assertEqual(spec.pf_type, K.PF_TYPE)      # 4 特殊型（保持母本，设计 §2 / 偏离 V7）
        self.assertEqual(spec.stance, K.STANCE)        # 技伤辅助 ⇒ Supporter

    def test_ability_keys_are_the_six_slots(self):
        self.assertEqual(K.ABILITY_KEYS, tuple(f"{K.CID}{n}" for n in range(1, 7)))

    def test_spec_declares_every_self_owned_key(self):
        keys = MS.get_spec("stinel").extra_keys
        self.assertEqual(keys[KL.CAS], (K.CAS_CHANGE_SKILL,))
        self.assertEqual(keys[KL.SWITCHED], (K.VOICE_KEY,))
        # 零新固有状态（裁决 §2「取零新件方案优先」）
        self.assertNotIn(MS.UNIQUE_CONDITION_LOGICAL, keys)

    def test_effect_family_naming(self):
        self.assertEqual(K.FX_SRC_DIR, f"battle/effect/skill_unique/{K.TEMPLATE_CODE}")
        self.assertEqual(K.FX_DST_DIR, f"battle/effect/skill_unique/{K.CODE}/{K.FX_SUBDIR}")
        self.assertEqual((K.FX_FUNNEL, K.FX_EXPLOSION),
                         (f"{K.TEMPLATE_CODE}_funnel", f"{K.TEMPLATE_CODE}_explosion"))

    def test_subject_remap_offsets_the_graft_by_four(self):
        # 母本树已占 0（参考点）与 1/2/3（判定区）；诺瓦块整体 +4
        self.assertEqual(K.SUBJECT_BASE, 4)
        self.assertEqual(K.SUBJECT_REMAP, {n: n + 4 for n in range(5)})

    def test_light_values_differ_between_the_two_lamps(self):
        """A/B 两盏灯的时长与数值**都**不能相同 —— 相同 ⇒ 条件 gid 相同 ⇒ 互相覆盖，

        D40 计数只数 1 层，队长 L6 与能力 3#2 收益减半（设计 §6.2 / 风险 R1）。
        """
        for level, values in K.LIGHT_VALUES.items():
            frames_a, value_a = values["a"]
            frames_b, value_b = values["b"]
            self.assertNotEqual(frames_a, frames_b, level)
            self.assertNotEqual(value_a, value_b, level)
            self.assertGreater(value_a["max"], value_b["max"], level)
        self.assertEqual(sorted(K.LIGHT_VALUES), ["1", "2"])

    def test_voice_route_is_change_skill_flag(self):
        self.assertEqual(K.VOICE_ROUTE, {"kind": 3})
        self.assertEqual(K.VOICE_KEY, f"{K.CODE}_voice_ready")
        self.assertEqual(KL.voice_route(K.CODE, K.VOICE_ROUTE)[0], "3")

    def test_parse_donor_converts_one_based_to_zero_based(self):
        self.assertEqual(K._parse_donor("official o:leader:151182#L1"),
                         ("official", "leader_ability", "151182#0"))
        self.assertEqual(K._parse_donor("official o:ability:1511822#L2"),
                         ("official", "ability", "1511822#1"))
        self.assertEqual(K._parse_donor("live s:ability:1599981#L1"),
                         ("live", "ability", "1599981#0"))
        for bad in ("official o:leader:151182#L0",      # 1 基，0 非法
                    "official s:leader:151182#L1",      # 前缀词与来源字母自相矛盾
                    "official o:status:151182#L1",      # 未知表名
                    "official o:leader:151182",          # 缺记录号
                    "official o:leader:151182#1"):       # 记录号缺 L 前缀
            with self.assertRaises(K.KitError, msg=bad):
                K._parse_donor(bad)

    def test_check_full_row_catches_drift_in_both_directions(self):
        row = ["a", "", "b"] + [""] * 3
        K._check_full_row(row, {"0": "a", "2": "b"}, 6, "t")          # 一致 ⇒ 不抛
        with self.assertRaises(K.KitError):
            K._check_full_row(row, {"0": "a", "2": "c"}, 6, "t")      # 值不同
        with self.assertRaises(K.KitError):
            K._check_full_row(row, {"0": "a"}, 6, "t")                # 设计稿漏登记的非空列
        with self.assertRaises(K.KitError):
            K._check_full_row(row, {"0": "a", "2": "b", "4": "x"}, 6, "t")   # 该空却被登记

    def test_write_dsl_checked_rejects_the_wrapper_shape(self):
        # 记忆卡 wf-dsl-encode-wrapper-trap：喂 {tree, numbers} 包装壳 = 进战斗 F1034
        with self.assertRaises(K.KitError):
            K._write_dsl_checked(None, "x", {"tree": ["ActionDsl"], "numbers": []})

    def test_forbidden_leader_kinds_are_rejected(self):
        row = [""] * KL.LEADER_NCOLS
        K.ban_forbidden_leader_kinds([list(row)])
        for col in (45, 107):
            for kind in K.FORBIDDEN_LEADER_KINDS:
                bad = list(row)
                bad[col] = kind
                with self.assertRaises(K.KitError, msg=f"c{col}={kind}"):
                    K.ban_forbidden_leader_kinds([bad])


class DesignSelfCheckTests(unittest.TestCase):
    """裁决 §8：kit 实现前对设计稿的硬自查。"""

    def setUp(self):
        if not DESIGN:
            self.skipTest("design/stinel.json missing")
        self.leader = DESIGN["plan"]["leader_ability"]["rows"]
        self.ability = DESIGN["plan"]["ability"]["keys"]

    def test_design_identity_matches_the_module(self):
        self.assertEqual(DESIGN.get("schema"), "ma-design/1")
        self.assertEqual(DESIGN.get("cid"), K.CID)
        self.assertEqual(DESIGN.get("code"), K.CODE)
        self.assertEqual(str(DESIGN["plan"]["leader_ability"]["key"]), str(K.CID))

    def test_spec_block_has_no_loader_warnings(self):
        """``--step check`` 的 spec_warnings 必须为空：形状写错的字段会被静默忽略，

        图标底色圈会悄悄退回注册表默认（本轮 backdrop_colors 写成调色板 dict 被抓，已改）。
        """
        self.assertEqual(MS.spec_warnings("stinel", ROOT), [])
        backdrop = DESIGN["spec"]["backdrop_colors"]
        self.assertEqual(len(backdrop), 2)
        for circle in backdrop:
            self.assertEqual(len(circle), 3)
            self.assertTrue(all(0 <= int(v) <= 255 for v in circle))

    def test_leader_has_seven_rows_and_no_patched_kinds(self):
        self.assertEqual(len(self.leader), K.LEADER_ROWS)
        self.assertEqual([e["index"] for e in self.leader], list(range(K.LEADER_ROWS)))
        for entry in self.leader:
            for col in ("45", "107"):
                self.assertNotIn(entry["cells"].get(col), K.FORBIDDEN_LEADER_KINDS, entry["index"])
            self.assertTrue(entry["donor"])
            self.assertTrue(entry["desc_tool"])
            self.assertTrue(entry["desc_expected"])

    def test_fever_and_dash_kinds_live_in_the_ability_table_only(self):
        """724（Fever 比例）只许写词条表，且必须落在主位限定键里（裁决 §2）。"""
        layout = DESIGN["plan"]["ability"]["layout"]
        instant, during = str(layout["instant_content"]), str(layout["during_content"])
        holders = [(name, rec) for name, block in self.ability.items()
                   for rec in block["records"]
                   if "724" in (rec["cells"].get(instant), rec["cells"].get(during))]
        self.assertEqual(len(holders), 1)
        name, _ = holders[0]
        self.assertEqual(self.ability[name]["unisonable_per_record"][0], "false")

    def test_no_unique_condition_is_added(self):
        self.assertEqual(DESIGN["plan"]["unique_conditions"]["add"], [])

    def test_statue_group_and_unisonable_are_single_valued_per_key(self):
        for name, block in self.ability.items():
            groups = {r["cells"]["2"] for r in block["records"]}
            self.assertEqual(len(groups), 1, f"{name} mixed statue groups {groups}")
            self.assertEqual(groups.pop(), block["statue_group"], name)
            self.assertIn(block["statue_group"], L.ABILITY_STATUE_GROUPS, name)
            flags = {r["cells"]["1"] for r in block["records"]}
            self.assertEqual(len(flags), 1, f"{name} mixed unisonable flags {flags}")
            self.assertEqual(sorted(set(block["unisonable_per_record"])), [flags.pop()], name)

    def test_ability_has_six_keys_fourteen_records(self):
        self.assertEqual(tuple(sorted(self.ability)), tuple(sorted(K.ABILITY_KEYS)))
        self.assertEqual(sum(len(b["records"]) for b in self.ability.values()), K.ABILITY_RECORDS)
        for slot, key_name in enumerate(K.ABILITY_KEYS, start=1):
            self.assertEqual(int(self.ability[key_name]["slot"]), slot)
            for record in self.ability[key_name]["records"]:
                self.assertEqual(record["cells"]["0"], f"{K.CODE}_{slot}", key_name)

    def test_change_skill_string_id_is_registered(self):
        """536 的 c70 string_id 不注册 = C8601。"""
        rows = DESIGN["plan"]["texts"]["custom_ability_string"]["rows"]
        self.assertEqual({r["key"] for r in rows}, {K.CAS_CHANGE_SKILL})
        instant = str(DESIGN["plan"]["ability"]["layout"]["instant_content"])
        holder = [rec for block in self.ability.values() for rec in block["records"]
                  if rec["cells"].get(instant) == "536"]
        self.assertEqual(len(holder), 1)
        self.assertEqual(holder[0]["cells"]["70"], K.CAS_CHANGE_SKILL)

    def test_all_donor_addresses_parse_and_point_at_the_right_table(self):
        for entry in self.leader:
            self.assertEqual(K._parse_donor(entry["donor"])[1], "leader_ability", entry["index"])
        for name, block in self.ability.items():
            for record in block["records"]:
                self.assertEqual(K._parse_donor(record["donor"])[1], "ability", name)

    def test_panel_texts_obey_the_batch_rules(self):
        for entry in self.leader:
            self.assertEqual(KL.panel_problems(entry["desc_expected"]), [], entry["donor"])
        for block in self.ability.values():
            for record in block["records"]:
                self.assertEqual(KL.panel_problems(record["desc_expected"]), [], record["donor"])
        for row in DESIGN["plan"]["texts"]["custom_ability_string"]["rows"]:
            # 「技能强化」条目不写数字与时间（裁决 §3）
            self.assertEqual(KL.panel_problems(row["text"], skill_flag=True), [], row["key"])

    def test_no_desc_override_is_planned(self):
        self.assertIsNone(DESIGN["plan"]["texts"]["desc_override"]["value"])

    def test_skill_energy_and_programs(self):
        skills = DESIGN["plan"]["skills"]
        self.assertEqual(skills["energy"]["level_1"], [550, 550])
        self.assertEqual(skills["energy"]["level_2"], [550, 500])
        self.assertEqual(skills["programs"],
                         [f"battle/action/skill/action/rare5/{K.CODE}${K.CODE}_{n}" for n in (1, 2)])

    def test_voice_block_is_complete(self):
        voice = DESIGN["voice"]
        self.assertEqual(int(voice["route"]["kind"]), K.VOICE_ROUTE["kind"])
        self.assertEqual(len(voice["lines"]), 22)
        for line in voice["lines"]:
            self.assertTrue(line.get("ja") and line.get("zh"), line.get("slot"))
            self.assertLessEqual(len(line["zh"]), 82, line.get("slot"))

    def test_deviations_are_registered_with_reasons(self):
        self.assertTrue(DESIGN.get("deviations"))
        for item in DESIGN["deviations"]:
            want = item.get("planned") or item.get("原设想") or item.get("want")
            got = item.get("actual") or item.get("实际落法") or item.get("got")
            why = item.get("why") or item.get("原因")
            self.assertTrue(want and got and why, item)


# ---------------------------------------------------------------- 2. 官方基线

@unittest.skipUnless(_BASELINE and bool(DESIGN), "needs the official .cdn/cn baseline + live store")
class RowAssemblyTests(unittest.TestCase):
    def test_leader_and_ability_rows_assemble_and_describe_as_designed(self):
        leader_rows, leader_evidence = K.build_leader_rows(ctx(), DESIGN)
        self.assertEqual(len(leader_rows), K.LEADER_ROWS)
        for row in leader_rows:
            self.assertEqual(row[0], K.CODE)
            self.assertEqual(len(row), KL.LEADER_NCOLS)
        K.ban_forbidden_leader_kinds(leader_rows)
        ability_rows, ability_evidence = K.build_ability_rows(ctx(), DESIGN)
        self.assertEqual(sum(len(v) for v in ability_rows.values()), K.ABILITY_RECORDS)
        self.assertEqual(len(leader_evidence) + len(ability_evidence),
                         K.LEADER_ROWS + K.ABILITY_RECORDS)
        for slot, key_name in enumerate(K.ABILITY_KEYS, start=1):
            KL.check_ability_key(ability_rows[key_name], key_name, K.CODE, slot)

    def test_only_the_fever_row_needs_a_client_capability(self):
        _, ability_evidence = K.build_ability_rows(ctx(), DESIGN)
        caps = {c for ev in ability_evidence for c in ev["capabilities"]}
        self.assertEqual(caps, {"kyubi-fever-ratio-v1"})
        _, leader_evidence = K.build_leader_rows(ctx(), DESIGN)
        self.assertEqual({c for ev in leader_evidence for c in ev["capabilities"]}, set())

    def test_row_assembly_rejects_a_tampered_design_row(self):
        design = copy.deepcopy(DESIGN)
        design["plan"]["leader_ability"]["rows"][1]["edits"]["49"] = "999000"
        with self.assertRaises(K.KitError):          # cells 对不上 ⇒ 当场报错
            K.build_leader_rows(ctx(), design)


@unittest.skipUnless(_BASELINE, "needs the official .cdn/cn baseline")
class SkillTreeTests(unittest.TestCase):
    def test_both_levels_assemble_and_pass_the_gates(self):
        for level in ("1", "2"):
            tree, gates = K.build_skill_tree(ctx(), level, fake_family())
            self.assertEqual(tree[0], "ActionDsl")
            self.assertEqual(tree[1], 2)               # 母本 movementPriority
            self.assertEqual(tree[10], 0)              # 自动档＝技能伤害归属（donor 原值不动）
            self.assertEqual(K._dsl_problems(tree, element=K.ELEMENT), [])
            self.assertEqual(gates["grafted"], 4)
            self.assertEqual(gates["buff_target_as"], 0)

    def test_donor_multipliers_and_element_are_untouched(self):
        donor = ctx().template_dsl(
            f"battle/action/skill/action/rare5/{K.TEMPLATE_CODE}${K.TEMPLATE_CODE}_2")
        want = [cna[6] for cna in wf_dsl.iter_dsl_commands(donor, "CreateNormalAttack")]
        tree, gates = K.build_skill_tree(ctx(), "2", fake_family())
        got = [cna[6] for cna in wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack")]
        self.assertEqual(got, want)
        self.assertEqual(gates["cna_multipliers"], want)
        for cna in wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack"):
            self.assertEqual(cna[2], 255)              # 元素继承，不写显式元素码

    def test_two_skill_damage_conditions_coexist_with_different_ids(self):
        for level in ("1", "2"):
            tree, _ = K.build_skill_tree(ctx(), level, fake_family())
            lamps = [cc for cc in wf_dsl.iter_dsl_commands(tree, "CreateCondition")
                     if cc[2] and cc[2][0][0] == "ACSkillDamage"]
            self.assertEqual(len(lamps), 2, level)
            frames = [lamp[2][0][1] for lamp in lamps]
            values = [lamp[2][0][2] for lamp in lamps]
            self.assertNotEqual(frames[0], frames[1], level)   # gid 不同 ⇒ 两条并存并累加
            self.assertNotEqual(values[0], values[1], level)
            for lamp in lamps:
                self.assertEqual(lamp[10], 1)                  # 付与对象种类＝角色状态

    def test_graft_subject_ids_do_not_collide_with_the_donor(self):
        tree, _ = K.build_skill_tree(ctx(), "2", fake_family())
        binds = sorted(cmd[1] for cmd in wf_dsl.iter_dsl_commands(tree, "FindAllSubjects"))
        self.assertEqual(binds, [K.SUBJECT_BASE, K.SUBJECT_BASE + 1])
        for cmd in wf_dsl.iter_dsl_commands(tree, "FindAllSubjects"):
            inner = cmd[9][1][0][1]
            self.assertEqual(inner[1], cmd[1])         # CreateCondition p1 == FindAll 绑定 id
        dispel = [c for c in wf_dsl.iter_dsl_commands(tree, "CreateHitArea")
                  if c[9][0] == "Rectangle"]
        self.assertEqual(len(dispel), 1)
        self.assertEqual([dispel[0][s] for s in K.HIT_AREA_SUBJECT_SLOTS], [6, 7, 8])
        delete = dispel[0][K.HIT_AREA_ONHIT_SLOT][1][0][1]
        self.assertEqual((delete[0], delete[1]), ("DeleteCondition", 8))

    def test_light_block_filter_only_narrows_the_full_team_one(self):
        parts = graft_parts()
        full = K.make_light_block(parts, bind=5, light_only=False, frames=900,
                                  value={"min": 0.25, "max": 0.5})
        light = K.make_light_block(parts, bind=4, light_only=True, frames=1200,
                                   value={"min": 0.6, "max": 1.2})
        self.assertEqual(full[1][3], [])                       # 主队全员
        self.assertEqual(light[1][3], parts["unique"][1][3])   # 光属性过滤照抄同树 ACUnique 块
        self.assertEqual(full[1][2], light[1][2])              # selector 不变

    def test_fx_block_anchors_on_self_and_points_at_the_cloned_family(self):
        tree, _ = K.build_skill_tree(ctx(), "1", fake_family())
        shows = [c for c in wf_dsl.iter_dsl_commands(tree, "ShowEffect") if c[1] == K.FX_LABEL]
        self.assertEqual(len(shows), 1)
        self.assertEqual(shows[0][3], K.FX_ANCHOR)             # -17 自身
        self.assertEqual(shows[0][2], ["SpecifyEffectDirectly", f"{K.FX_DST_DIR}/{K.FX_FUNNEL}"])

    def test_every_effect_ref_lands_inside_the_cloned_family(self):
        for level in ("1", "2"):
            tree, _ = K.build_skill_tree(ctx(), level, fake_family())
            paths = K._effect_paths(tree)
            self.assertTrue(paths)
            for path in paths:
                self.assertTrue(path.startswith(K.FX_DST_DIR + "/"), path)

    def test_graft_picker_needs_all_four_blocks(self):
        parts = graft_parts()
        self.assertEqual(sorted(parts), ["dispel", "skill_damage", "sparkle", "unique"])
        empty = ["ActionDsl", 1, ["None"], False, False, False, False, False, False, False, 0,
                 ["Block", []]]
        with self.assertRaises(K.KitError):
            K.pick_graft_blocks(empty)


# ---------------------------------------------------------------- 3. 已构建的 workspace

@unittest.skipUnless((WORKSPACE / "evidence/kit-report.json").is_file(),
                     "workspace ma-stinel has not been built yet")
class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = MC.MAPack(MS.get_spec("stinel"), record_sources=False)
        cls.report = json.loads((WORKSPACE / "evidence/kit-report.json").read_text("utf-8"))
        cls.claims = json.loads((WORKSPACE / "evidence/table_claims.json").read_text("utf-8"))

    def claimed(self, logical: str) -> set[str]:
        return {key for entry in self.claims if entry["logical_path"] == logical
                for key in entry["outer_keys"]}

    def test_package_carries_the_self_owned_keys(self):
        self.assertIn(K.CAS_CHANGE_SKILL, self.pack.pkg_flat(KL.CAS))
        switched = C.core.load_nested_table_bytes(
            self.pack.pkg_path("common", KL.SWITCHED).read_bytes(), KL.SWITCHED)
        self.assertIn(K.VOICE_KEY, switched.rows)

    def test_every_self_owned_key_is_claimed(self):
        self.assertIn(K.CAS_CHANGE_SKILL, self.claimed(KL.CAS))
        self.assertIn(K.VOICE_KEY, self.claimed(KL.SWITCHED))
        self.assertEqual(self.claimed(KL.ABILITY), set(K.ABILITY_KEYS))
        self.assertEqual(self.claimed(KL.LEADER), {str(K.CID)})
        self.assertEqual(self.claimed(KL.CHARACTER), {str(K.CID)})

    def test_no_unique_condition_key_was_added(self):
        unique = self.pack.pkg_path("common", MS.UNIQUE_CONDITION_LOGICAL)
        if unique.is_file():
            self.assertFalse([k for k in self.pack.pkg_flat(MS.UNIQUE_CONDITION_LOGICAL)
                              if k.startswith(str(K.CID))])
        self.assertEqual(self.claimed(MS.UNIQUE_CONDITION_LOGICAL), set())

    def test_written_dsl_round_trips_and_keeps_the_attribution(self):
        for level in ("1", "2"):
            logical = wf_dsl.dsl_logical(f"battle/action/skill/action/rare5/{K.CODE}${K.CODE}_{level}")
            tree = C.amf_parse(self.pack.pkg_path("common", logical).read_bytes())
            self.assertEqual(tree[0], "ActionDsl", logical)
            self.assertEqual(tree[10], 0, logical)
            lamps = [cc for cc in wf_dsl.iter_dsl_commands(tree, "CreateCondition")
                     if cc[2] and cc[2][0][0] == "ACSkillDamage"]
            self.assertEqual(len(lamps), 2, logical)

    def test_action_skill_energy_matches_the_design(self):
        rows = B.KitContext(self.pack).pkg_nested(K.CODE)
        self.assertEqual(sorted(rows), ["1", "2"])
        for level, want in (("1", ("550", "550")), ("2", ("550", "500"))):
            cells = list(rows[level])
            self.assertEqual((cells[4], cells[5]), want, level)

    def test_character_row_routes_the_voice(self):
        row = self.pack.pkg_character_row()
        self.assertEqual(row[9:17], KL.voice_route(K.CODE, K.VOICE_ROUTE))
        self.assertEqual(row[6], str(K.PF_TYPE))
        self.assertEqual(row[26], K.STANCE)
        self.assertEqual(row[27], str(K.CID))

    def test_report_status_and_gate(self):
        gate = self.report["kit_gate"]
        self.assertEqual(gate["rows"], K.LEADER_ROWS + K.ABILITY_RECORDS)
        self.assertEqual(gate["programs"], 2)
        ready = gate["fx_lut_applied"] and gate["pixel_present"] and not gate["pixel_missing"]
        self.assertEqual(self.report["status"], KL.READY if ready else KL.DRAFT)
        if not ready:
            self.assertTrue(gate["reason"])

    def test_report_panel_and_capabilities(self):
        self.assertEqual(self.report["cid"], K.CID)
        self.assertEqual(len(self.report["panel"]), K.LEADER_ROWS + K.ABILITY_RECORDS + 1)
        for text in self.report["panel"]:
            self.assertEqual(KL.panel_problems(text), [], text)
        self.assertEqual(self.report["required_capabilities"], ["kyubi-fever-ratio-v1"])
        self.assertTrue(self.report["deviations"])

    def test_effect_family_is_the_only_cloned_one(self):
        families = json.loads((WORKSPACE / "evidence/effect-families.json").read_text("utf-8"))
        self.assertEqual(sorted(families), [K.FX_DST_DIR])
        self.assertEqual(sorted(families[K.FX_DST_DIR]["copied_bases"]),
                         sorted((K.FX_FUNNEL, K.FX_EXPLOSION)))
        self.assertEqual(families[K.FX_DST_DIR]["missing_effects"], [])
        self.assertTrue(families[K.FX_DST_DIR]["complete_family"])


if __name__ == "__main__":
    unittest.main()
