# -*- coding: utf-8 -*-
"""玛格诺斯（119990 lion_swordman_moon）kit 的单测。

三层：
1. 纯静态（无 IO）：行计划的硬约束——队长表禁 422/724/713、629 排在 525 之前、
   固有 ID 8 位、自有键全部声明、面板文案规则；
2. 设计稿对账：``B/design/magnus.json`` 与 kit 常量逐项一致；
3. 集成（需要 live store + ``.cdn/cn`` 官方归档）：用 kitlib 的真实代码路径回放 20 行
   （``build_row`` 的 ``expect_describe`` 逐字比对），并从官方 donor 树重建三棵 DSL。
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_dsl  # noqa: E402
import wf_midautumn_kit_magnus as KM  # noqa: E402
import wf_midautumn_kitlib as KL  # noqa: E402
import wf_midautumn_specs as MS  # noqa: E402
import wf_mod_tool as core  # noqa: E402


def _live_available() -> bool:
    profile = core.resolve_profile()
    return (profile is not None and profile.store.is_dir()
            and (core.project_root() / ".cdn" / "cn").is_dir())


_LIVE = _live_available()

# 队长表写这三个 kind = 角色页 C7050（裁决 §8 / 记忆卡 wf-dash-parameter-leader-table-trap）
LEADER_FORBIDDEN_KINDS = ("422", "724", "713")
ABILITY_CONTENT_COL = 47
LEADER_CONTENT_COL = 45


class PlanStaticTests(unittest.TestCase):
    """不碰任何表，只看 kit 常量自身的一致性。"""

    def test_identity_matches_the_registry(self):
        spec = MS.SPECS["magnus"]
        self.assertEqual((spec.cid, spec.code), (KM.CID, KM.CODE))
        self.assertEqual((spec.template_id, spec.template_code),
                         (KM.TEMPLATE_ID, KM.TEMPLATE_CODE))
        self.assertEqual(spec.element, 0, "玛格诺斯改口为火，不翻属性")

    def test_unique_id_is_eight_digits_under_cid(self):
        self.assertEqual(KM.UID, str(KM.CID * 100 + 1))
        self.assertEqual(len(KM.UID), 8)

    def test_unique_cap_is_not_the_none_sentinel(self):
        cap = KM.UNIQUE_CELLS[4]
        self.assertNotIn(cap, ("", "(None)"), "(None) 会被读成上限 1，叠层全死")
        self.assertEqual(int(cap), 5, "能力3 的 3 层 + 队长 L4 的 2 层")

    def test_every_self_owned_key_is_declared(self):
        declared = {logical: set(keys) for logical, keys in SPEC_KEYS().items()}
        self.assertIn(KM.UID, declared[MS.UNIQUE_CONDITION_LOGICAL])
        self.assertEqual(set(KM.CAS_TEXTS),
                         declared["master/string/custom_ability_string.orderedmap"])
        self.assertIn(KM.VOICE_KEY,
                      declared["master/skill/switched_action_skill.orderedmap"])

    def test_ability_key_c0_c1_c2_are_uniform_per_key(self):
        for slot, records in KM.PLAN.items():
            c0 = {cells.get(0) for _d, _s, cells, _e in records}
            self.assertEqual(c0, {f"{KM.CODE}_{slot}"}, f"slot {slot} c0")
            c2 = {cells.get(2) for _d, _s, cells, _e in records}
            self.assertEqual(len(c2), 1, f"slot {slot} 雕像组必须单值: {c2}")
            self.assertLessEqual(c2 - set(_statue_groups()), set(), f"slot {slot} 雕像组不认识")

    def test_invoke_row_precedes_the_consume_row(self):
        """629 发动追击必须排在同触发的 525 消耗行之前，否则最后一层先被吃掉。"""
        slot3 = KM.PLAN[3]
        cells = [c for _d, _s, c, _e in slot3]
        kinds = [c.get(ABILITY_CONTENT_COL) for c in cells]
        self.assertIn(None, kinds, "槽 3 里有沿用 donor kind 的行（461/525 不改 c47）")
        invoke = next(i for i, c in enumerate(slot3) if KM.CHASE_STRING in str(c[2].get(70)))
        consume = next(i for i, (_d, _s, c, e) in enumerate(slot3) if "消耗固有状态" in e)
        self.assertLess(invoke, consume)

    def test_invoke_and_consume_share_precondition_and_trigger(self):
        by_desc = {e: c for _d, _s, c, e in KM.PLAN[3]}
        invoke = next(c for e, c in by_desc.items() if "发动技能动作" in e)
        consume = next(c for e, c in by_desc.items() if "消耗固有状态" in e)
        for col in (6, 7, 9, 10, 12, 27):
            self.assertEqual(invoke.get(col), consume.get(col), f"c{col} 必须同形")
        self.assertEqual(invoke[6], "188", "前置 188 = 固有状态实例数")
        self.assertEqual(invoke[9], "100000",
                         "188 数的是实例数（恒为 1）：阈值只能写 ≥1，写 ≥2 永不成立")

    def test_629_row_carries_both_the_string_key_and_the_program(self):
        invoke = next(c for _d, _s, c, e in KM.PLAN[3] if "发动技能动作" in e)
        self.assertEqual(invoke[70], KM.CHASE_STRING)
        self.assertEqual(invoke[71], KM.CHASE_PROGRAM)
        self.assertIn(KM.CHASE_STRING, KM.CAS_TEXTS, "629 必须配一条面板字符串")

    def test_leader_rows_never_carry_dash_fever_or_713(self):
        for index, (_donor, _source, cells, _expect) in enumerate(KM.LEADER):
            value = cells.get(LEADER_CONTENT_COL)
            if value is not None:
                self.assertNotIn(str(value), LEADER_FORBIDDEN_KINDS, f"leader#{index}")

    def test_panel_strings_follow_the_batch_rules(self):
        self.assertEqual(KL.panel_problems(KM.CAS_TEXTS[KM.CHASE_STRING]), [])
        self.assertEqual(KL.panel_problems(KM.CAS_TEXTS[KM.SWITCH_STRING], skill_flag=True), [],
                         "「技能强化」条目不写数字与时间")
        for value in KM.TEXTS.values():
            self.assertEqual(KL.panel_problems(value), [], value)

    def test_energy_keeps_the_official_invariant(self):
        self.assertEqual(KM.ENERGY["1"][0], KM.ENERGY["2"][0],
                         "官方 492 个双档技能的 c4 两档恒同值")
        self.assertLessEqual(int(KM.ENERGY["2"][1]), int(KM.ENERGY["1"][1]),
                             "二档消耗不得高于一档")
        self.assertLessEqual(int(KM.ENERGY["1"][1]), int(KM.ENERGY["1"][0]))

    def test_voice_route_avoids_the_always_on_change_skill_flag(self):
        self.assertEqual(KM.VOICE_ROUTE["kind"], 1,
                         "kind 3 会因 536 常驻而让 skill_ready 永不播")
        self.assertEqual(KM.VOICE_ROUTE["condition_id"], KM.UID)

    def test_effects_reference_the_official_donor_family(self):
        self.assertTrue(KM.FLAME.startswith(f"battle/effect/skill_unique/{KM.TEMPLATE_CODE}/"),
                        "不克隆 ⇒ 直接引用官方路径，图集零增量")
        self.assertNotIn(KM.CODE, KM.FLAME)

    def test_deviations_are_registered(self):
        self.assertTrue(KM.DEVIATIONS)
        for item in KM.DEVIATIONS:
            self.assertEqual({"want", "got", "why"}, set(item))


def SPEC_KEYS() -> dict[str, tuple[str, ...]]:
    return dict(KM.SPEC["extra_keys"])


def _statue_groups() -> tuple[str, ...]:
    import wf_client_legality as L
    return tuple(L.ABILITY_STATUE_GROUPS)


class DesignDocumentTests(unittest.TestCase):
    """kit 常量必须与设计稿逐项一致（设计稿漂移会让 build 直接报错）。"""

    @classmethod
    def setUpClass(cls):
        path = (Path(__file__).resolve().parents[2] / "work/character_packs"
                / "midautumn-20260920/design/magnus.json")
        if not path.is_file():
            raise unittest.SkipTest(f"design document absent: {path}")
        cls.design = json.loads(path.read_text(encoding="utf-8"))

    def test_kit_matches_the_design_document(self):
        self.assertEqual(KM._design_problems(self.design), [])

    def test_design_texts_match_the_kit(self):
        for key, value in KM.TEXTS.items():
            self.assertEqual(self.design["texts"][key], value, key)


class InstallStagedAssetsTests(unittest.TestCase):
    """kitlib 的向后兼容小补丁：像素交付件若是标准 PNG，装包时换成 WF 存储态魔数。"""

    class _Pack:
        def __init__(self, batch_dir):
            self.batch_dir = Path(batch_dir)

    class _Ctx:
        def __init__(self, pack):
            self.pack = pack
            self.written = {}

        def write_asset(self, root, logical, data, owner=None):
            self.written[(root, logical)] = (data, owner)

    def _run(self, payload: bytes, logical: str):
        with tempfile.TemporaryDirectory() as tmp:
            batch = Path(tmp)
            staged = batch / "pixel" / "magnus"
            staged.mkdir(parents=True)
            (staged / "sheet.png").write_bytes(payload)
            (staged / "install.json").write_text(json.dumps(
                [{"root": "common", "logical": logical, "file": "sheet.png"}]), encoding="utf-8")
            ctx = self._Ctx(self._Pack(batch))
            result = KL.install_staged_assets(ctx, staged / "install.json")
            return ctx, result

    def test_standard_png_gets_the_store_signature(self):
        payload = b"\x89PNG\r\n\x1a\n" + b"rest-of-the-file"
        ctx, result = self._run(payload, "character/x/pixelart/sprite_sheet.png")
        data, owner = ctx.written[("common", "character/x/pixelart/sprite_sheet.png")]
        self.assertEqual(data, b"\x89png\r\n\x1a\n" + b"rest-of-the-file")
        self.assertEqual(owner, "pixel")
        self.assertTrue(result["installed"][0]["store_signature_applied"])

    def test_store_png_is_passed_through_untouched(self):
        payload = b"\x89png\r\n\x1a\n" + b"already-store"
        ctx, result = self._run(payload, "character/x/pixelart/sprite_sheet.png")
        data, _owner = ctx.written[("common", "character/x/pixelart/sprite_sheet.png")]
        self.assertEqual(data, payload)
        self.assertFalse(result["installed"][0]["store_signature_applied"])

    def test_non_png_payloads_are_untouched(self):
        payload = b"\x89PNG\r\n\x1a\nnot-really"
        ctx, _result = self._run(payload, "character/x/pixelart/pixelart.frame.amf3.deflate")
        data, _owner = ctx.written[("common", "character/x/pixelart/pixelart.frame.amf3.deflate")]
        self.assertEqual(data, payload)

    def test_missing_install_json_is_silently_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = self._Ctx(self._Pack(tmp))
            result = KL.install_staged_assets(ctx, Path(tmp) / "nope.json")
        self.assertFalse(result["present"])
        self.assertEqual(ctx.written, {})


# ---------------------------------------------------------------- 集成（只读）

class _ReadOnlyCtx:
    """kitlib.build_row / unique_row 与 kit 的 DSL 构建只用到这几个口，全部只读。"""

    def __init__(self):
        from wf_enhancement_policy import OfficialBaseline
        import wf_seasonal7_common as C
        self.root = core.project_root()
        self.spec = MS.get_spec("magnus", with_kit=False)
        self._baseline = OfficialBaseline(self.root / ".cdn/cn",
                                          cache_dir=self.root / "mod-tools/work/official-baseline",
                                          write_cache=False)
        self._store = core.resolve_profile().store
        self._cache: dict = {}
        self.walk = C.walk
        self.csv_split = core.read_csv_lines

    def official_read(self, logical: str, root: str | None = None):
        digest = core.sha1_path(logical)
        try:
            return self._baseline.get(root or "common", digest[:2] + "/" + digest[2:])
        except Exception:
            return None

    def official_flat(self, table: str) -> dict[str, str]:
        if ("o", table) not in self._cache:
            self._cache[("o", table)] = core.read_orderedmap_file_from_bytes(
                self.official_read(table))
        return self._cache[("o", table)]

    def live_flat(self, table: str) -> dict[str, str]:
        if ("s", table) not in self._cache:
            self._cache[("s", table)] = core.load_table(table, self._store).text_rows()
        return self._cache[("s", table)]

    template_flat = official_flat
    pkg_flat = official_flat

    def template_dsl(self, program: str):
        logical = program if program.endswith(".deflate") else wf_dsl.dsl_logical(program)
        raw = self.official_read(logical)
        if raw is None:
            raise AssertionError(f"official baseline lacks {logical}")
        return wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"]

    def program_path(self, level: str) -> str:
        import wf_seasonal7_tables as T
        return T.program_path(self.spec, level)


@unittest.skipUnless(_LIVE, "requires live store and .cdn/cn official archives")
class RowIntegrationTests(unittest.TestCase):
    """用 kitlib 的真实代码路径回放全部行：donor 漂移 / 列改动写错 / 描述器漂移都会红。"""

    @classmethod
    def setUpClass(cls):
        cls.ctx = _ReadOnlyCtx()

    def test_leader_rows_build_and_render_as_designed(self):
        for index, (donor, source, cells, expect) in enumerate(KM.LEADER):
            with self.subTest(leader=index):
                row, evidence = KL.build_row(self.ctx, "leader_ability", donor, cells,
                                             source=source, element=0,
                                             expect_describe=expect, label=f"L{index}")
                self.assertEqual(len(row), KL.LEADER_NCOLS)
                self.assertEqual(row[0], KM.CODE)
                self.assertEqual(evidence["describe"], expect)
                self.assertNotIn(row[LEADER_CONTENT_COL], LEADER_FORBIDDEN_KINDS)

    def test_ability_rows_build_and_pass_the_key_contract(self):
        for slot, records in KM.PLAN.items():
            rows = []
            for index, (donor, source, cells, expect) in enumerate(records):
                with self.subTest(slot=slot, record=index):
                    row, evidence = KL.build_row(self.ctx, "ability", donor, cells,
                                                 source=source, element=0,
                                                 expect_describe=expect,
                                                 label=f"{KM.CID}{slot}#{index}")
                    self.assertEqual(len(row), KL.ABILITY_NCOLS)
                    self.assertEqual(evidence["describe"], expect)
                    rows.append(row)
            KL.check_ability_key(rows, f"{KM.CID}{slot}", KM.CODE, slot)

    def test_slot3_order_contract_holds_on_the_built_rows(self):
        rows = [KL.build_row(self.ctx, "ability", d, c, source=s, element=0)[0]
                for d, s, c, _e in KM.PLAN[3]]
        KM._order_problems(rows)                       # 顺序错会抛
        kinds = [row[ABILITY_CONTENT_COL] for row in rows]
        self.assertLess(kinds.index("629"), kinds.index("525"))

    def test_unique_condition_row(self):
        key, row = KL.unique_row(self.ctx, self.ctx.spec, 1, KM.UNIQUE_DONOR,
                                 KM.UNIQUE_CELLS, name=KM.UNIQUE_NAME)
        self.assertEqual(key, KM.UID)
        self.assertEqual(len(row), KL.UNIQUE_NCOLS)
        self.assertEqual(row[1], KM.UNIQUE_NAME)
        self.assertEqual(row[2], KM.UC_ICON_ROW)
        self.assertEqual(row[3], "1200")
        self.assertEqual(row[4], "5")
        self.assertEqual(row[14], KM.CODE, "PF 语音独占 code = 自身")

    def test_kit_needs_no_client_patch_capability(self):
        caps = set()
        for slot, records in KM.PLAN.items():
            for donor, source, cells, _expect in records:
                _row, evidence = KL.build_row(self.ctx, "ability", donor, cells,
                                              source=source, element=0)
                caps.update(evidence["capabilities"])
        for donor, source, cells, _expect in KM.LEADER:
            _row, evidence = KL.build_row(self.ctx, "leader_ability", donor, cells,
                                          source=source, element=0)
            caps.update(evidence["capabilities"])
        self.assertEqual(sorted(caps), [])

    def test_custom_ability_string_keys_are_free_officially(self):
        official = self.ctx.official_flat(KL.CAS)
        for key in KM.CAS_TEXTS:
            self.assertNotIn(key, official)


@unittest.skipUnless(_LIVE, "requires live store and .cdn/cn official archives")
class SkillTreeIntegrationTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.ctx = _ReadOnlyCtx()

    def _effects(self, tree):
        return list(wf_dsl.iter_dsl_commands(tree, "ShowEffect"))

    def test_main_tree_merges_the_riding_window(self):
        for level in ("1", "2"):
            with self.subTest(level=level):
                tree, meta = KM.build_main_tree(self.ctx, level)
                self.assertEqual(tree[10], 0, "根头 buffTargetAs=0 ⇒ 按技能伤害结算")
                ids = KM._declared_ids(tree)
                self.assertEqual(sorted(ids), list(range(9)))
                self.assertEqual(len(ids), len(set(ids)))
                self.assertEqual(meta["ride"]["hit_area_ids"], [6, 7, 8])
                self.assertEqual(meta["ride"]["multiplier"], list(KM.RIDE_MULT[level]))
                self.assertEqual(sorted(meta["ride"]["effects"]), ["ride_aura", "ride_hit"])
                self.assertEqual(wf_dsl.player_side_dsl_problems(tree), [])
                self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree)

    def test_main_tree_keeps_the_template_slash_untouched(self):
        expected = {"1": 28.0, "2": 42.0}
        for level in ("1", "2"):
            tree, meta = KM.build_main_tree(self.ctx, level)
            self.assertEqual(float(meta["slash"]["max"]), expected[level])
            self.assertEqual(meta["slash"]["alv_min"], 1.75)
            self.assertEqual(meta["slash"]["alv_max"], 3.5)
            del tree

    def test_riding_attacks_use_the_builtin_hit_effect(self):
        tree, _meta = KM.build_main_tree(self.ctx, "2")
        riding = [c for c in wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack")
                  if c[6][0].get("max", 0) <= 1]
        self.assertEqual(len(riding), 2)
        for cna in riding:
            self.assertEqual(cna[6][0]["min"], 0.19)
            self.assertEqual(cna[6][0]["max"], 0.225)
            self.assertIn(cna[15], (["Fine"], ["None"]),
                          "不引用情娅族命中特效（图集零增量）")

    def test_main_tree_never_references_a_foreign_effect_family(self):
        for level in ("1", "2"):
            tree, _meta = KM.build_main_tree(self.ctx, level)
            for show in self._effects(tree):
                self.assertTrue(str(show[2][1]).startswith(
                    f"battle/effect/skill_unique/{KM.TEMPLATE_CODE}/"), show[2][1])
            self.assertEqual(KM._effect_ref_problems(self.ctx, tree), [])

    def test_chase_tree(self):
        tree, meta = KM.build_chase_tree(self.ctx)
        self.assertEqual(tree[10], 0, "629 以 AbilitySkill 执行 ⇒ 自动按技能伤害结算")
        attacks = list(wf_dsl.iter_dsl_commands(tree, "CreateNormalAttack"))
        self.assertEqual(len(attacks), 1)
        self.assertEqual((attacks[0][6][0]["min"], attacks[0][6][0]["max"]),
                         (KM.CHASE_MULT, KM.CHASE_MULT))
        names = sorted(show[1] for show in self._effects(tree))
        self.assertEqual(names, ["ignite_aura", "ignite_burst"])
        for show in self._effects(tree):
            self.assertEqual(show[2][1], KM.FLAME)
        burst = next(s for s in self._effects(tree) if s[1] == "ignite_burst")
        self.assertEqual(burst[12], ["Some", [{"min": KM.CHASE_BURST_SCALE,
                                               "max": KM.CHASE_BURST_SCALE}]])
        aura = next(s for s in self._effects(tree) if s[1] == "ignite_aura")
        self.assertEqual(aura[5], ["PlayOnlyFirstSequence"], "母本 _flame 是 once/70 帧")
        self.assertEqual(meta["multiplier"], KM.CHASE_MULT)
        self.assertEqual(wf_dsl.player_side_dsl_problems(tree), [])
        self.assertEqual(wf_dsl.parse_dsl(wf_dsl.encode_amf3(tree))["tree"], tree)
        self.assertEqual(KM._effect_ref_problems(self.ctx, tree), [])

    def test_chase_damage_lands_in_four_hits(self):
        tree, _meta = KM.build_chase_tree(self.ctx)
        areas = list(wf_dsl.iter_dsl_commands(tree, "CreateHitArea"))
        self.assertEqual(len(areas), 2)
        burst = areas[1]
        self.assertEqual(burst[14], ["CalculatedUsingMaxNumOfHits", 4])
        self.assertEqual(KM.CHASE_MULT * 4, 8.0, "每次追击 8.0 倍（设计稿配平值）")

    def test_icon_keeps_the_official_frame_alpha(self):
        import wf_seasonal7_common as C
        raw = self.ctx.official_read(KM.UC_ICON_FRAME_DONOR)
        self.assertIsNotNone(raw)
        frame = C.png_open(raw)
        icon = KM.draw_icon(frame)
        self.assertEqual(icon.size, (48, 48))
        self.assertEqual(icon.getchannel("A").tobytes(), frame.getchannel("A").tobytes())


@unittest.skipUnless(_LIVE, "requires a built workspace at work/character_packs/ma-magnus")
class WorkspaceTests(unittest.TestCase):
    """装配后的 workspace 回读（没跑过 build 时跳过）。"""

    @classmethod
    def setUpClass(cls):
        cls.ws = core.project_root() / "work/character_packs/ma-magnus"
        cls.report = cls.ws / "evidence/kit-report.json"
        if not cls.report.is_file():
            raise unittest.SkipTest("run wf_midautumn_build.py --char magnus --step ...,kit first")
        cls.value = json.loads(cls.report.read_text(encoding="utf-8"))

    def test_report_is_ready_and_declares_the_three_programs(self):
        self.assertEqual(self.value["status"], KL.READY)
        programs = self.value["skills"]["programs"]
        for level in ("1", "2"):
            self.assertIn(f"battle/action/skill/action/rare5/{KM.CODE}${KM.CODE}_{level}",
                          programs)
        self.assertIn(KM.CHASE_PROGRAM, programs)
        self.assertEqual(self.value["required_capabilities"], [])
        self.assertTrue(self.value["deviations"])

    def test_written_trees_round_trip_and_keep_skill_damage_attribution(self):
        base = self.ws / "package/roots/common"
        for program in (f"battle/action/skill/action/rare5/{KM.CODE}${KM.CODE}_1",
                        f"battle/action/skill/action/rare5/{KM.CODE}${KM.CODE}_2",
                        KM.CHASE_PROGRAM):
            path = base / wf_dsl.dsl_logical(program)
            with self.subTest(program=program):
                self.assertTrue(path.is_file(), path)
                tree = wf_dsl.parse_dsl(zlib.decompress(path.read_bytes(), -15))["tree"]
                self.assertEqual(tree[10], 0)
                self.assertEqual(wf_dsl.player_side_dsl_problems(tree), [])

    def test_unique_condition_icon_is_stored_with_the_wf_signature(self):
        path = self.ws / "package/roots/common" / KM.UC_ICON_LOGICAL
        self.assertTrue(path.is_file(), path)
        self.assertEqual(path.read_bytes()[:8], b"\x89png\r\n\x1a\n")

    def test_package_ability_and_leader_rows_match_the_plan(self):
        rows = json.loads((self.ws / "evidence/kit-rows.json").read_text(encoding="utf-8"))
        self.assertEqual(len(rows["leader"]), len(KM.LEADER))
        for slot, records in KM.PLAN.items():
            key = f"{KM.CID}{slot}"
            self.assertEqual(len(rows["ability"][key]), len(records), key)
        self.assertEqual(sorted(rows["custom_ability_string"]), sorted(KM.CAS_TEXTS))
        for level in ("1", "2"):
            cells = rows["action_skill"][level]
            self.assertEqual(tuple(cells[4:7]), KM.ENERGY[level])
        self.assertEqual(rows["voice_route"][0], "1")
        self.assertEqual(rows["voice_route"][2], KM.UID)


if __name__ == "__main__":
    unittest.main()
