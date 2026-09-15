"""普莉姆拉·浴衣 kit：官方 donor 行 / 技能树拼装与设计一致，静态门禁负向用例，特效 sheet 钩子解析。

只读：不写 workspace（需要 live store 与官方基线时自动跳过对应用例）。
框架 ``S7Pack.template_dsl`` 读取时会顺手改写 ``evidence/template_sources.json``（框架问题，已上报），
本模块给共享 PACK 关掉来源登记，保证测试不改 workspace 证据；门禁负向用例的 gates.json 写到临时目录。
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_seasonal7_kit_primula as K  # noqa: E402


def _pack():
    import wf_seasonal7_common as C
    import wf_seasonal7_specs as S
    try:
        pack = C.S7Pack(S.get_spec("primula"))
        if pack.official_read(K.ABILITY, "common") is None:
            return None
        pack._record_source = lambda *a, **k: None     # 读接口不写 evidence/template_sources.json
        return pack
    except Exception:            # noqa: BLE001
        return None


PACK = _pack()
ROOT = Path(__file__).resolve().parents[2]


def _families():
    out = []
    for fam in K.EFFECT_FAMILIES:
        donor = fam["src_dir"].rsplit("/", 1)[-1]
        dst = f"battle/effect/skill_unique/{K.CODE}_{fam['dst_subdir']}"
        out.append({"src_dir": fam["src_dir"], "dst_dir": dst, "donor": donor,
                    "dst_name": dst.rsplit("/", 1)[-1], "copied_bases": sorted(fam["fx_names"])})
    return out


class PureTests(unittest.TestCase):
    def test_timeline_sound_report_flags_unresolved_and_malformed(self):
        have = {"sound_effect/element/se_resistance_quick.mp3"}
        tl = {"sounds": [{"path": "sound_effect/element/se_resistance_quick", "begin": 2},
                         {"path": "sound_effect/magic/se_resistance_quick", "begin": 5},   # 前缀写错
                         {"begin": 9}, "sound_effect/element/se_energy_inhalation"]}
        resolved, probs = K.timeline_sound_report(tl, have.__contains__)
        self.assertEqual(resolved, {"sound_effect/element/se_resistance_quick": True,
                                    "sound_effect/magic/se_resistance_quick": False})
        self.assertTrue(any("unresolved: sound_effect/magic/se_resistance_quick.mp3" in p for p in probs), probs)
        self.assertEqual(sum("has no path" in p for p in probs), 2, probs)
        self.assertEqual(K.timeline_sound_report({"sounds": []}, have.__contains__), ({}, []))
        self.assertEqual(K.timeline_sound_report({"sequences": []}, have.__contains__), ({}, []))
        self.assertTrue(K.timeline_sound_report({"sounds": {"path": "x"}}, have.__contains__)[1])
        self.assertTrue(K.timeline_sound_report(["not", "a", "timeline"], have.__contains__)[1])
        # 带扩展名的 path 会被拼成 .mp3.mp3，同样拦下
        self.assertTrue(K.timeline_sound_report({"sounds": [{"path": "sound_effect/element/se_resistance_quick.mp3"}]},
                                                have.__contains__)[1])

    def test_integration_pending_template_placeholders_vs_integrated(self):
        import wf_seasonal7_voice as V
        voice = {s: f"character/{K.CODE}/voice/{s}.mp3" for s in V.SLOTS}
        # 母本占位：13 条 battle/ally + 6 条母本 home 名，speech 指向母本名，全部 owner=assets
        template_home = [f"home/tpl_{i}" for i in range(6)]
        placeholder_files = {lg for s, lg in voice.items()
                             if not s.startswith("home/") and s not in ("battle/matched_skill_ready", "battle/skill_2",
                                                                         "battle/skill_3")}
        placeholder_files |= {f"character/{K.CODE}/voice/{h}.mp3" for h in template_home} | set(K.PIXEL_SHEETS)
        owners = {f"common:{lg}": "assets" for lg in placeholder_files}
        speech = [["0", "2", "", "泳装台词", h] for h in template_home] +                  [["2", "", "", "j", "ally/join"], ["1", "", "1", "e", "ally/evolution"]]
        got = K.integration_pending(speech, owners, placeholder_files)
        self.assertFalse(got["clear"])
        self.assertEqual(set(got["voice"]["slots_missing"]),
                         {*V.HOME_SLOTS, "battle/matched_skill_ready", "battle/skill_2", "battle/skill_3"})
        self.assertEqual(got["voice"]["speech_paths_outside_plan"], template_home)
        self.assertFalse(got["pixel"]["clear"])
        # 装好：22 条 owner=voice、speech 走规划槽、像素 owner=pixel
        files = set(voice.values()) | set(K.PIXEL_SHEETS) | {f"character/{K.CODE}/voice/{template_home[0]}.mp3"}
        owners = {f"common:{lg}": "voice" for lg in voice.values()}
        owners.update({f"common:{lg}": "pixel" for lg in K.PIXEL_SHEETS})
        speech = [["0", "2", "", "浴衣台词", h] for h in V.HOME_SLOTS] + speech[6:]
        got = K.integration_pending(speech, owners, files)
        # 母本旧语音残留：报告且 voice 不 clear（Integrate 必须删掉不再被 speech 引用的母本语音）
        self.assertFalse(got["voice"]["clear"], got)
        self.assertEqual(got["voice"]["template_voice_files_left"], [f"character/{K.CODE}/voice/{template_home[0]}.mp3"])
        files.discard(f"character/{K.CODE}/voice/{template_home[0]}.mp3")
        got = K.integration_pending(speech, owners, files)
        self.assertTrue(got["clear"], got)
        # 像素内容问题（pixel_problems 非空）→ 不 clear；空列表 → clear
        self.assertFalse(K.integration_pending(speech, owners, files, ["x != store form"])["pixel"]["clear"])
        self.assertTrue(K.integration_pending(speech, owners, files, [])["clear"])
        # 任一缺项都回到 not clear
        owners[f"common:{voice['battle/skill_3']}"] = "assets"
        self.assertFalse(K.integration_pending(speech, owners, files)["clear"])
        owners[f"common:{voice['battle/skill_3']}"] = "voice"
        owners[f"common:{K.PIXEL_SHEETS[1]}"] = "assets"
        self.assertFalse(K.integration_pending(speech, owners, files)["clear"])
        owners[f"common:{K.PIXEL_SHEETS[1]}"] = "pixel"
        self.assertFalse(K.integration_pending(speech[:7], owners, files)["clear"])

    def test_review_md_verdict_reads_fix_round_section_only(self):
        md = chr(10).join(["## 2. 逐角色", "### primula 普莉姆拉 — FAIL（待主控拍板）",
                           "## 5. 修复轮复核（独立复核）", "#### zehr — PASS",
                           "#### primula 普莉姆拉 — PASS（豁免条件成立）", ""])
        self.assertEqual(K._review_md_verdict(md), "PASS")
        self.assertIsNone(K._review_md_verdict(md.split("## 5.")[0]))           # 修复轮复核段还没出现 → pending
        self.assertEqual(K._review_md_verdict(md.replace("— PASS（豁免", "— FAIL（豁免")), "FAIL")

    def test_fx_store_bytes_is_magic_swap_not_reencode(self):
        import wf_assets
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "a.png"
            body = bytes([0]) + b"IHDR-not-really-decoded"
            f.write_bytes(wf_assets.PNG_REAL + body)
            self.assertEqual(K.fx_store_bytes(f), wf_assets.PNG_FAKE + body)
            f.write_bytes(wf_assets.PNG_FAKE + body)
            self.assertEqual(K.fx_store_bytes(f), wf_assets.PNG_FAKE + body)
            f.write_bytes(b"GIF89a")
            with self.assertRaises(K.KitError):
                K.fx_store_bytes(f)

    def test_apply_edits_asserts_old_value(self):
        with self.assertRaises(K.KitError):
            K._apply_edits(["a", "b"], {1: ("x", "y")}, "t")
        self.assertEqual(K._apply_edits(["a", "b"], {1: ("b", "y")}, "t"), ["a", "y"])

    def test_signature_flags_donothing_in_expression_slot(self):
        tree = ["ActionDsl", 1, ["None"], False, False, False, False, False, False, False, 0,
                ["Block", [["Command", ["ConditionalsConditionAccumulationNumber", ["DCUnique", 1], 5,
                                        ["Block", []], ["DoNothing"]]]]]]
        probs = K.signature_problems(tree, None)
        self.assertTrue(any("F1009" in p for p in probs), probs)

    def test_vlv_condition_without_key_fails(self):
        cc = ["Command", ["CreateCondition", 30, [["ACDirectDamage", [{"min": 1, "max": 1}],
                                                   [{"min": 1, "max": 1, "vlv": [{"vid": 1, "min": 0, "max": 1}]}],
                                                   [{"min": 1, "max": 1}]]],
                          [], ["None"], True, True, "", ["None"], False, 0, 3, False]]
        found = K.create_conditions(["Block", [cc]])
        self.assertEqual(found[0]["key"], "")
        self.assertTrue(found[0]["vlv"])

    def test_fx_manifest_variants(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = root / K.FX_MANIFEST
            out.parent.mkdir(parents=True)
            (out.parent / "a.png").write_bytes(b"x")
            src = "battle/effect/skill_unique/blackflower_wiz/blackflower_wiz.png"
            for payload in ({"sheets": {src: "a.png"}}, {src: {"png": "a.png"}},
                            [{"source": src, "file": "a.png"}]):
                out.write_text(json.dumps(payload), encoding="utf-8")
                self.assertEqual(K.fx_sheet_overrides(root), {src: out.parent / "a.png"})
            out.write_text(json.dumps({"sheets": {src: "missing.png"}}), encoding="utf-8")
            with self.assertRaises(K.KitError):
                K.fx_sheet_overrides(root)
            out.unlink()
            self.assertEqual(K.fx_sheet_overrides(root), {})


@unittest.skipIf(PACK is None, "live store / official baseline unavailable")
class OfficialBaselineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT / K.DESIGN_JSON
        cls.design = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None

    def test_rows_legal_and_match_design(self):
        leader = K.build_leader_rows(PACK)
        ability = K.build_ability_rows(PACK)
        self.assertTrue(K.row_gates("leader_ability", leader)["ok"])
        flat = [r for k in sorted(ability) for r in ability[k]]
        gate = K.row_gates("ability", flat)
        self.assertTrue(gate["ok"])
        self.assertEqual(gate["required_capabilities"], [])
        self.assertEqual((len(leader), len(flat)), (6, 11))
        if self.design is not None:
            self.assertEqual(leader, [r["row"] for r in self.design["leader"]])
            for slot in range(1, 7):
                self.assertEqual(ability[f"{K.CID}{slot}"], [r["row"] for r in self.design["abilities"][f"slot{slot}"]])
            self.assertEqual(K.build_unique_row(PACK), self.design["unique_conditions"][0]["row"])
            self.assertEqual(K.text_row(), self.design["text"]["character_text_row"])

    def test_shared_pack_reads_do_not_write_evidence(self):
        """审查 #3 规避：共享 PACK 读官方 DSL 不得改写 workspace 的 evidence（框架读接口带登记副作用）。"""
        with mock.patch.object(PACK, "write_evidence", side_effect=AssertionError("read wrote evidence")):
            tree = PACK.template_dsl("battle/action/skill/action/rare5/combat_soldier_smr22$combat_soldier_smr22_2")
        self.assertEqual(tree[0], "ActionDsl")

    def test_unique_cap_is_ten(self):
        self.assertEqual(K.build_unique_row(PACK)[4], "10")

    def test_trees_match_prototype_and_pass_static_checks(self):
        sig_path = ROOT / K.OFFICIAL_SIG
        sig = json.loads(sig_path.read_text(encoding="utf-8")) if sig_path.is_file() else None
        import wf_seasonal7_common as C
        for level in ("1", "2"):
            tree, log = K.compose_tree(PACK, level)
            self.assertEqual(len(log), 48)
            for fam in _families():
                tree, refs = C.rewrite_effect_refs(tree, fam, strict=True)
            checks = K.tree_checks(tree, sig)
            if sig is not None:
                self.assertTrue(checks["ok"], {k: checks[k] for k in ("element", "subject_binding",
                                                                     "hit_area_target", "player_side", "signature")})
            proto = ROOT / K.DESIGN_TREES[level]
            if proto.is_file():
                self.assertEqual(json.loads(proto.read_text(encoding="utf-8")), tree)
            broken = copy.deepcopy(tree)
            broken[11][1][2][1][3][1][2][1][4] = ["DoNothing"]       # ≥5 层否分支 → DoNothing
            self.assertTrue(any("F1009" in p for p in K.signature_problems(broken, sig)))

    def test_switched_rows_follow_voice_convention(self):
        import wf_seasonal7_voice as V
        rows = K.build_action_rows(PACK)
        self.assertEqual({lv: r[7:24] for lv, r in rows.items()}, V.switched_rows(rows))
        self.assertEqual(V.normalize_route(K.ROUTE_COLS, K.CODE), K.ROUTE_COLS)

    def test_gates_fail_when_effect_timeline_sound_unresolved(self):
        """审查 #1 负向：SE 解析不到时 run_gates 必须记失败（旧实现只写证据、all_pass 仍为 true）。"""
        import wf_seasonal7_common as C
        if not (PACK.read_evidence("effect-families.json", {}) or {}):
            self.skipTest("package has no cloned effect families (kit step not run)")
        orig = C.S7Pack.live_locate

        def no_se(self_, logical):
            return None if logical.startswith("sound_effect/") else orig(self_, logical)

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(K, "GATES_FILE", str(Path(tmp) / "neg.json")),                     mock.patch.object(C.S7Pack, "live_locate", no_se):
                neg = K.run_gates(write_status=False)
            gates = json.loads((Path(tmp) / "neg.json").read_text(encoding="utf-8"))
            with mock.patch.object(K, "GATES_FILE", str(Path(tmp) / "pos.json")):
                pos = K.run_gates(write_status=False)
        se_fail = [f for f in neg["failures"] if f.startswith("effect timeline:") and "sound unresolved" in f]
        self.assertFalse(neg["all_pass"])
        self.assertGreaterEqual(len(se_fail), 5, neg["failures"])
        self.assertTrue(gates["effect_timeline_problems"])
        self.assertFalse(gates["release_ready_after_integration"])
        self.assertEqual([f for f in pos["failures"] if f.startswith("effect timeline:")], [])

    def test_icon_keeps_official_frame_alpha(self):
        import wf_seasonal7_common as C
        frame = C.png_open(PACK.official_read(K.ICON_FRAME_DONOR))
        icon = K.draw_icon(frame)
        self.assertEqual(icon.size, (48, 48))
        self.assertEqual(icon.getchannel("A").tobytes(), frame.getchannel("A").tobytes())
        self.assertEqual(C.png_store_bytes(icon)[:4], b"\x89png")


if __name__ == "__main__":
    unittest.main()
