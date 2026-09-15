# -*- coding: utf-8 -*-
"""泽赫尔·灯火酒馆 kit 的只读回归：设计行回放与合法性、覆盖文案、两棵技能树 = 设计定稿、
三档 PF = 设计 + 主控覆盖（每段倍率恢复官方、寿命/命中/Notify ×3、suppress 官方、叠 blaze 层）与满命中预算，
DSL 校验器的阴性对照与移植等价核对，官方签名表 sha 锁定，PF 短程序路径的 MAX_PATH 余量，旧长路径产物清理，
fx manifest 钩子与门禁状态判定。

不写包、不写 live；需要本机 live store、官方基线（.cdn/cn）与带 bundle.zip 的 APK，缺失时跳过。
"""
from __future__ import annotations

import copy
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import wf_seasonal7_kit_zehr as K  # noqa: E402


def _context():
    import wf_seasonal7_build as B
    import wf_seasonal7_common as C
    import wf_seasonal7_specs as S
    pack = C.S7Pack(S.get_spec(K.KEY))
    if pack.official_read(K.ABILITY, "common") is None:
        raise unittest.SkipTest("official baseline unavailable")
    return B.KitContext(pack)


def _family(src_dir: str, sub: str, bases) -> dict:
    """与 clone_effect_family 返回值同形的纯数据（不复制文件）。"""
    donor = src_dir.rsplit("/", 1)[-1]
    return {"src_dir": src_dir, "dst_dir": f"battle/effect/skill_unique/{K.CODE}/{sub}", "donor": donor,
            "dst_name": sub, "copied_bases": list(bases)}


FAMILIES = {sub: _family(src, sub, bases) for src, sub, bases in K.EFFECT_FAMILIES}


class ZehrKitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.ctx = _context()
        except unittest.SkipTest:
            raise
        except Exception as exc:                      # 没有 live profile 的机器
            raise unittest.SkipTest(f"live store unavailable: {exc}")
        cls.design = K.load_design(cls.ctx.root)

    # ---- spec / 文本
    def test_spec_merges_texts_capabilities_extra_keys(self):
        spec = self.ctx.spec
        self.assertEqual(spec.texts["title"], "灯火酒馆的团长")
        self.assertEqual(sorted(spec.required_capabilities), sorted(K.CAPABILITIES))
        self.assertEqual(spec.extra_keys[K.PFA], (K.PF_KEY,))
        self.assertEqual(spec.extra_keys[K.SW], (K.VOICE_KEY,))
        self.assertEqual(sorted(spec.extra_keys[K.CAS]), sorted(K.CAS_KEYS))
        self.assertEqual(K.check_texts_constant(self.design), [])

    def test_override_text_drops_segment_damage_phrase(self):
        design_value = self.design["leader_desc_override"]["value"]
        self.assertIn(K.TEXT_DROPPED_BY_OVERRIDE, design_value)
        text = K.apply_text_override(design_value, "leader")
        self.assertNotIn(K.TEXT_DROPPED_BY_OVERRIDE, text)
        self.assertIn("变为3倍", text)
        self.assertEqual(K.panel_text_problems(text), [])
        with self.assertRaises(K.KitError):
            K.apply_text_override(text, "leader")
        self.assertTrue(K.panel_text_problems("自身为队长时，攻击力＋10%"))

    # ---- 行
    def test_rows_replay_design_and_pass_client_legality(self):
        rows, evidence = K.build_rows(self.ctx, self.design)
        self.assertEqual(len(rows["leader"]), 6)
        self.assertEqual(sum(len(v) for v in rows["ability"].values()), 14)
        caps = set()
        for item in evidence:
            for field in ("client_legality_problems", "declared_block_field_problems",
                          "ability_element_column_problems"):
                self.assertEqual(item[field], [], (item["table"], item["key"], item["record"], field))
            caps.update(item["capabilities"])
        self.assertEqual(caps, {"dash-parameter-v1"})
        slot3 = rows["ability"][f"{K.CID}3"]
        self.assertEqual([r[109] for r in slot3[1:]], ["422", "422"])
        self.assertEqual({r[1] for r in slot3} | {r[6] for r in slot3[1:]}, {"false", "42"})
        slot6 = rows["ability"][f"{K.CID}6"]
        self.assertEqual((slot6[0][70], slot6[1][47], slot6[1][68], slot6[1][2]),
                         (K.CHANGE_SKILL_KEY, "461", K.UC_ID, "power_flip"))           # 按设计，不再改写成 special
        self.assertEqual(rows["leader"], [e["row"] for e in self.design["leader"]])
        for slot in range(1, 7):
            self.assertEqual(rows["ability"][f"{K.CID}{slot}"],
                             [e["row"] for e in self.design["abilities"][f"slot{slot}"]["records"]])
        self.assertIn(f"{K.CID}6", K.mixed_c1_c2(rows["ability"]))                     # 混写只是信息
        pf_row = rows["leader"][2]
        self.assertEqual((pf_row[45], pf_row[80], pf_row[81], pf_row[82]),
                         ("722", K.PF_KEY, "1,2,3", K.PF_STRING_KEY))
        self.assertTrue(all(r[0] == K.CODE for r in rows["leader"]))

    def test_legality_negative_control(self):
        import wf_client_legality as L
        import wf_describe
        rows, _ = K.build_rows(self.ctx, self.design)
        bad = list(rows["ability"][f"{K.CID}2"][0])
        bad[int(wf_describe.layout("ability")["blocks"]["precondition2"])] = ""
        self.assertTrue(L.client_legality_problems("ability", bad))

    # ---- 技能 DSL
    def _sources(self):
        return {name: K.load_program(self.ctx, name)[0] for name in K.SKILL_SOURCES}

    def test_skill_trees_equal_design_final_and_pass_checks(self):
        sources = self._sources()
        for level in (1, 2):
            tree, info = K.compose_skill(self.ctx, level, sources)
            tree, refs = self.ctx.rewrite_effect_refs(tree, FAMILIES["skill"], strict=True)
            self.assertEqual(refs["kept_donor"], [])
            design_tree = json.loads((self.ctx.root / K.DESIGN_TMP_REL / f"final_skill_{level}.json")
                                     .read_text(encoding="utf-8"))
            self.assertIsNone(K.first_difference(tree, design_tree))
            checks = K.dsl_problems(self.ctx.root, tree)
            self.assertTrue(checks["all_empty"], checks["problems"])
            self.assertTrue(checks["roundtrip"])
            self.assertEqual(info["multiplier_estimate"], {1: (39.0, 39.0), 2: (46.0, 55.0)}[level])

    # ---- PF
    def _pf_tree(self, level, sources):
        tree, info = K.compose_pf(level, sources)
        tree = K.add_blaze_layer(tree, level, FAMILIES["pf_blaze"])
        for sub in ("pf_spin", "pf_support", "pf_blaze"):
            tree, refs = self.ctx.rewrite_effect_refs(tree, FAMILIES[sub], strict=True)
            self.assertEqual(refs["kept_donor"], [])
        return tree, info

    def test_pf_trees_apply_controller_overrides(self):
        try:
            sources, _apk = K.apk_pf_sources(self.ctx.root)
        except K.KitError as exc:
            self.skipTest(str(exc))
        for level in (1, 2, 3):
            tree, _info = self._pf_tree(level, sources)
            expect = K.expected_pf_tree(self.ctx.root, level, FAMILIES["pf_blaze"]["dst_dir"])
            self.assertIsNone(K.first_difference(tree, expect))
            blk = tree[11][1]
            off = K.PF_OFFICIAL[level]
            hit = K.cmd(blk[1])
            cna = K.cmd(hit[23][1][0])
            self.assertEqual(K.cmd(blk[0])[1], off["supp"])                       # suppress 官方
            self.assertEqual((hit[13][1], hit[14][1]), (3 * off["life"], 3 * off["hits"]))
            self.assertEqual(blk[2][1][1], 3 * off["life"] - 1)                    # Wait → NotifyPowerflipEnd
            self.assertEqual(cna[6], K.slv(off["mult"]))                           # 每段倍率 = 官方
            self.assertEqual(hit[24], 0)                                           # PF 乘区归属保持
            layers = [K.cmd(n) for n in hit[20][1]]
            self.assertEqual([c[0] for c in layers], ["ShowEffect", "ShowEffect"])
            blaze, spin = layers
            self.assertTrue(blaze[2][1].endswith(f"/{K.CODE}/pf_blaze/{K.PF_BLAZE_BASE}"))
            self.assertIn(f"/{K.CODE}/pf_spin/powerflip_attack_spin_", spin[2][1])
            self.assertEqual((blaze[3], blaze[5], blaze[6]), (spin[3], ["UntilTargetTerminates"], ["AB"]))
            checks = K.dsl_problems(self.ctx.root, tree)
            self.assertTrue(checks["all_empty"], checks["problems"])
            self.assertTrue(checks["roundtrip"])
            regressed = copy.deepcopy(tree)                                         # 设计原倍率 = 覆盖回退
            K.cmd(K.cmd(regressed[11][1][1])[23][1][0])[6] = K.slv(K.DESIGN_PF_SEGMENT_MULTIPLIER[level])
            self.assertIsNotNone(K.first_difference(regressed, expect))
            with self.assertRaises(K.KitError):                                     # 预算断言：剑士段不再是 3 倍
                K.pf_budget_report(level, regressed, sources)

    def test_pf_budget_matches_review_arithmetic(self):
        try:
            sources, _apk = K.apk_pf_sources(self.ctx.root)
        except K.KitError as exc:
            self.skipTest(str(exc))
        want = {1: dict(knight=(29.25, 9.75), total=(29.25, 9.75), brk=(6.75, 4.5), fev=(18, 18)),
                2: dict(knight=(57.0, 19.0), total=(57.0, 19.0), brk=(12.0, 8.0), fev=(24, 24)),
                3: dict(knight=(94.5, 31.5), total=(98.5, 35.5), brk=(23.5, 16.0), fev=(46, 41))}
        budgets = {}
        for level in (1, 2, 3):
            tree, _ = self._pf_tree(level, sources)
            b = K.pf_budget_report(level, tree, sources)
            budgets[level] = b
            w = want[level]
            self.assertAlmostEqual(b["knight"]["new"]["damage"], w["knight"][0])
            self.assertAlmostEqual(b["knight"]["official"]["damage"], w["knight"][1])
            self.assertAlmostEqual(b["total"]["new"]["damage"], w["total"][0])
            self.assertAlmostEqual(b["total"]["official"]["damage"], w["total"][1])
            self.assertAlmostEqual(b["total"]["new"]["break"], w["brk"][0])
            self.assertAlmostEqual(b["total"]["official"]["break"], w["brk"][1])
            self.assertAlmostEqual(b["total"]["new"]["fever"], w["fev"][0])
            self.assertAlmostEqual(b["total"]["official"]["fever"], w["fev"][1])
            self.assertEqual(b["ratio"]["knight_damage"], 3.0)
        self.assertEqual(budgets[3]["ratio"]["total_damage"], 2.7746)
        note = K.pf_budget_note(budgets)
        self.assertIn("2.77", note)
        self.assertNotIn("3 倍总伤", note)

    def test_dsl_checker_negative_controls(self):
        tree, _ = K.compose_skill(self.ctx, 1, self._sources())
        bad = copy.deepcopy(tree)
        K.find_cmd(bad, "AddCombo")[1] = 15                                         # F1034：Array 参给标量
        self.assertTrue(K.dsl_problems(self.ctx.root, bad)["problems"]["typed_signature"])
        bad = copy.deepcopy(tree)                                                  # F1009：Block 内 DoNothing
        bad[11][1].append(["Command", ["ConditionalsFeverMode", ["Block", [["DoNothing"]]], ["Block", []]]])
        probs = K.dsl_problems(self.ctx.root, bad)["problems"]
        self.assertTrue(probs["donothing_in_block"] or probs["typed_signature"])
        bad = copy.deepcopy(tree)                                                  # C16103：未绑定 subject
        K.find_cmd(bad, "ShowEffect")[3] = 777
        probs = K.dsl_problems(self.ctx.root, bad)["problems"]
        self.assertTrue(probs["blueprint_check"] or probs["subject_binding"])


class PfBudgetSyntheticTest(unittest.TestCase):
    """纯数据：同一判定区多条攻击都要乘命中数；不建模的攻击种类与非 MaxNumOfHits 命中数直接报错。"""

    @staticmethod
    def _cna(mult, brk, fev):
        # wf_dsl_sig：p1 int, p2 int, p3/p4 Array, p5 int, p6 倍率, p7 Array, p8-12 Boolean, p13 削韧, p14 Fever
        return ["Command", ["CreateNormalAttack", 1, 0, [], [], 0, K.slv(mult), K.slv(1), False, False, False, False,
                            False, K.slv(brk), K.slv(fev), ["None"], False]]

    @staticmethod
    def _area(subject, hits, attacks, hit_form="CalculatedUsingMaxNumOfHits"):
        return ["Command", ["CreateHitArea", "*", subject, ["CD"], 0, 0, 0.0, True, False, ["Circle", K.slv(10)],
                            ["Center"], ["Bottom"], ["Single"], ["SpecifyHitAreaLifetimeDirectly", 30],
                            [hit_form, hits], ["None"], False, True, ["None"], 90, ["Block", []], 91, 92,
                            ["Block", attacks], 0, 0, ["None"]]]

    def test_multiple_attacks_and_areas(self):
        tree = ["ActionDsl", 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                ["Block", [self._area(-18, 4, [self._cna(2.0, 0.5, 1), self._cna(1.0, 0.25, 2)]),
                           self._area(-17, 1, [self._cna(4.0, 1, 1)]),
                           self._area(-17, 7, [])]]]
        got = K.pf_attack_budget(tree)
        self.assertEqual([(e["subject"], e["hits"], e["damage"], e["break"], e["fever"]) for e in got],
                         [(-18, 4, 12.0, 3.0, 12.0), (-17, 1, 4.0, 1.0, 1.0)])

    def test_unmodelled_forms_raise(self):
        bad_hits = ["ActionDsl", 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    ["Block", [self._area(-18, 4, [self._cna(2.0, 0.5, 1)], hit_form="Unlimited")]]]
        with self.assertRaises(K.KitError):
            K.pf_attack_budget(bad_hits)
        ratio = ["ActionDsl", 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                 ["Block", [self._area(-18, 1, [["Command", ["CreateRatioAttack", 1, 2, 0.05]]])]]]
        with self.assertRaises(K.KitError):
            K.pf_attack_budget(ratio)


class PortedBlueprintCheckTest(unittest.TestCase):
    """移植版 blueprint_check_with_sig 与 research/_tmp/blueprint_build.check 逐字等价（原模块不在时跳过）。"""

    def test_ported_checker_matches_design_blueprint(self):
        root = HERE.parents[1]
        original = root / K.DESIGN_BLUEPRINT_REL
        if not original.is_file():
            self.skipTest("research/_tmp/blueprint_build.py not present")
        try:
            ctx = _context()
        except Exception as exc:
            self.skipTest(f"live store unavailable: {exc}")
        trees = []
        for logical in K.program_logicals(ctx):
            path = ctx.pack.pkg_path("common", logical)
            if path.is_file():
                trees.append(ctx.amf_parse(path.read_bytes()))
        for name in K.SKILL_SOURCES:
            trees.append(K.load_program(ctx, name)[0])
        base = copy.deepcopy(K.load_program(ctx, "guildknight_leader_1")[0])
        injected_hit_area = ["Command", ["CreateHitArea", "*", -18, ["CD"], 0, 0, 0.0, True, False,
                                         ["Rectangle", K.slv(10)], ["Center"], ["Bottom"], ["Single"],
                                         ["SpecifyHitAreaLifetimeDirectly", 5], ["CalculatedUsingMaxNumOfHits", 1],
                                         ["None"], False, True, ["None"], 90, ["Block", []], 91, 92, ["Block", []],
                                         0, 0, ["None"]]]
        for mutate in (lambda t: K.find_cmd(t, "ShowEffect").__setitem__(3, 777),
                       lambda t: K.find_cmd(t, "AddCombo").__setitem__(1, 15),
                       lambda t: t[11][1].append(copy.deepcopy(injected_hit_area))):
            bad = copy.deepcopy(base)
            mutate(bad)
            trees.append(bad)
        off, _src = K.load_official_sig(root)
        ported = [list(K.blueprint_check_with_sig(t, off)) for t in trees]
        self.assertTrue(all(p[0] for p in ported[-3:]), "negative injections must produce problems")
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "trees.json"
            dst = Path(tmp) / "out.json"
            src.write_text(json.dumps(trees, ensure_ascii=False), encoding="utf-8")
            script = ("import sys, json; sys.path.insert(0, %r); import blueprint_build as BP; "
                      "trees = json.load(open(%r, encoding='utf-8')); "
                      "json.dump([list(BP.check(t)) for t in trees], open(%r, 'w', encoding='utf-8'), ensure_ascii=False)"
                      % (str(original.parent), str(src), str(dst)))
            proc = subprocess.run([sys.executable, "-c", script], cwd=str(root), capture_output=True, timeout=300)
            self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace")[-800:])
            expect = json.loads(dst.read_text(encoding="utf-8"))
        self.assertEqual(len(expect), len(trees))
        for i, (a, b) in enumerate(zip(ported, expect)):
            self.assertEqual(a, b, f"tree #{i}")


class OfficialSigAndInputsTest(unittest.TestCase):
    def setUp(self):
        K._OFFICIAL_SIG_CACHE.clear()

    def tearDown(self):
        K._OFFICIAL_SIG_CACHE.clear()

    def test_missing_and_drifted_signature_table_is_reported(self):
        real_root = HERE.parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            probs = K.official_sig_problems(root)
            self.assertEqual(len(probs), 2)
            self.assertTrue(all("missing" in p for p in probs))
            with self.assertRaises(K.KitError) as cm:
                K.load_official_sig(root)
            self.assertIn("official_sig.py", str(cm.exception))
            inputs = K.required_input_problems(root)
            self.assertTrue(any("official_sig" in p for p in inputs))
            self.assertTrue(any(K.DESIGN_REL in p for p in inputs))
            drifted = root / K.OFFICIAL_SIG_CANDIDATES[0]
            drifted.parent.mkdir(parents=True)
            drifted.write_text("{}", encoding="utf-8")
            self.assertTrue(any("!= pin" in p for p in K.official_sig_problems(root)))
            with self.assertRaises(K.KitError):
                K.load_official_sig(root)
            fallback = real_root / K.OFFICIAL_SIG_CANDIDATES[1]
            if fallback.is_file() and K.sha256(fallback.read_bytes()) == K.OFFICIAL_SIG_PIN:
                good = root / K.OFFICIAL_SIG_CANDIDATES[1]
                good.parent.mkdir(parents=True, exist_ok=True)
                good.write_bytes(fallback.read_bytes())
                self.assertEqual(K.official_sig_problems(root), [])
                table, source = K.load_official_sig(root)
                self.assertEqual(source, K.OFFICIAL_SIG_CANDIDATES[1])
                self.assertIn("CreateHitArea#2", table)


class PfProgramPathTest(unittest.TestCase):
    def test_short_program_paths_fit_framework_inspect_copy(self):
        import wf_dsl
        import wf_seasonal7_common as C
        import wf_seasonal7_specs as S
        self.assertEqual(K.pf_program(1), "battle/action/power_flip/action/override/"
                                          "guildknight_leader_tavern_pf$guildknight_leader_tavern_pf_lv1")
        self.assertNotEqual(K.pf_program(1), K.design_pf_program(1))
        self.assertIn(K.PF_KEY, K.design_pf_program(3))
        pack = C.S7Pack(S.get_spec(K.KEY))
        short = tuple(f"package/roots/common/{wf_dsl.dsl_logical(K.pf_program(lv))}" for lv in (1, 2, 3))
        long = tuple(f"package/roots/common/{wf_dsl.dsl_logical(K.design_pf_program(lv))}" for lv in (1, 2, 3))
        with tempfile.TemporaryDirectory() as tmp:
            empty_ws = Path(tmp) / pack.workspace.name
            empty_ws.mkdir()
            ok = K.workspace_path_budget(empty_ws, pack.batch_dir, extra_rel=short)
            bad = K.workspace_path_budget(empty_ws, pack.batch_dir, extra_rel=long)
            excluded = K.workspace_path_budget(empty_ws, pack.batch_dir, extra_rel=short + long, exclude_rel=())
        # 同一副本前缀下估算：短路径有余量，设计长路径必然超限（负向对照，证明检查不空转）
        self.assertEqual(ok["copy_prefix"], bad["copy_prefix"])
        self.assertGreaterEqual(ok["headroom"], 0, ok)
        self.assertLess(bad["headroom"], 0, bad)
        self.assertLess(excluded["headroom"], 0, excluded)
        if pack.workspace.is_dir():
            real = K.workspace_path_budget(pack.workspace, pack.batch_dir,
                                           exclude_rel=long)
            self.assertGreaterEqual(real["headroom"], 0, real)

    def test_drop_stale_pf_programs_only_touches_kit_outputs(self):
        import wf_dsl

        class FakePack:
            def __init__(self, base: Path):
                self.base = base

            def pkg_path(self, root, logical):
                return self.base / "roots" / root / logical

            def _owned_raw(self):
                path = self.base / "owned_outputs.json"
                return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}

            def write_evidence(self, name, value):
                (self.base / name).write_text(json.dumps(value), encoding="utf-8")

        class FakeCtx:
            def __init__(self, pack):
                self.pack = pack

        with tempfile.TemporaryDirectory() as tmp:
            pack = FakePack(Path(tmp))
            owned = {}
            for lv in (1, 2, 3):
                old = wf_dsl.dsl_logical(K.design_pf_program(lv))
                path = pack.pkg_path("common", old)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"x")
                owned[f"common:{old}"] = {"owner": "kit", "sha256": None}
            owned["common:battle/other.png"] = {"owner": "art", "sha256": None}
            pack.write_evidence("owned_outputs.json", owned)
            removed = K.drop_stale_pf_programs(FakeCtx(pack))
            self.assertEqual(len(removed), 3)
            self.assertEqual(list(pack._owned_raw()), ["common:battle/other.png"])
            self.assertFalse(any(pack.pkg_path("common", r).exists() for r in removed))
            self.assertEqual(K.drop_stale_pf_programs(FakeCtx(pack)), [])             # 幂等
            old = wf_dsl.dsl_logical(K.design_pf_program(2))
            pack.pkg_path("common", old).write_bytes(b"y")
            pack.write_evidence("owned_outputs.json", {f"common:{old}": {"owner": "effects", "sha256": None}})
            with self.assertRaises(K.KitError):
                K.drop_stale_pf_programs(FakeCtx(pack))
            self.assertTrue(pack.pkg_path("common", old).exists())


class FxManifestHookTest(unittest.TestCase):
    def test_manifest_shapes_and_missing_png(self):
        from PIL import Image
        import wf_assets
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = root / Path(K.FX_MANIFEST_REL).parent
            out.mkdir(parents=True)
            buf = io.BytesIO()
            Image.new("RGBA", (4, 4), (200, 100, 50, 128)).save(buf, format="PNG")
            (out / "blaze.png").write_bytes(wf_assets.png_encode(buf.getvalue()))
            src = "battle/effect/skill_unique/master_knight/master_knight.png"
            self.assertEqual(K.load_fx_manifest(root), ({}, None))
            for payload in ({src: "blaze.png", "not/an/effect.png": "blaze.png"},
                            {"sheets": {src: str(out / "blaze.png")}},
                            {"sheets": [{"source": src, "png": "blaze.png"}]}):
                (out / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
                mapping, info = K.load_fx_manifest(root)
                self.assertEqual(list(mapping), [src])
                self.assertEqual(mapping[src].read_bytes()[:8], b"\x89png\r\n\x1a\n")
                self.assertEqual(info["entries"], 1)
            (out / "manifest.json").write_text(json.dumps({src: "gone.png"}), encoding="utf-8")
            with self.assertRaises(K.KitError):
                K.load_fx_manifest(root)


class GatesStatusTest(unittest.TestCase):
    def test_ready_only_with_passing_gates_and_matching_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(K.gates_status(root, "abc")[0], "draft")
            path = root / K.GATES_REL
            path.parent.mkdir(parents=True)
            for payload, want in (({"all_pass": False, "kit_fingerprint": "abc"}, "draft"),
                                  ({"all_pass": True, "kit_fingerprint": "zzz"}, "draft"),
                                  ({"all_pass": True, "kit_fingerprint": "abc"}, "ready-for-review")):
                path.write_text(json.dumps(payload), encoding="utf-8")
                self.assertEqual(K.gates_status(root, "abc")[0], want)
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(K.gates_status(root, "abc")[0], "draft")


class PixelInputsTest(unittest.TestCase):
    """像素装包闸门：产物缺失 / report 门禁不过 / 复核缺失 / sha 漂移都判 pending（不写包）。"""

    def _write(self, root: Path, *, gates_ok=True, review_pass=True, drift=None):
        import hashlib
        base = root / K.PIXEL_DIR_REL
        (base / "out").mkdir(parents=True)
        outputs, detail = {}, {}
        for name in K.PIXEL_SHEETS:
            data = f"png-{name}".encode()
            (base / "out" / f"{name}.png").write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            outputs[name] = {"sha256": digest}
            detail[name] = {"sha256": digest}
        if drift:
            (base / "out" / f"{drift}.png").write_bytes(b"changed")
        (base / "report.json").write_text(json.dumps({
            "key": K.KEY, "gates_passed": gates_ok, "gates": {"G1": {"ok": gates_ok}}, "outputs": outputs}),
            encoding="utf-8")
        verify = root / K.PIXEL_VERIFY_REL
        verify.parent.mkdir(parents=True, exist_ok=True)
        verify.write_text(json.dumps({K.KEY: {"pass": review_pass, "hard": {
            "H1": {"ok": review_pass}, "H8_png_roundtrip": {"ok": True, "detail": detail}}}}), encoding="utf-8")

    def test_ready_and_pending_cases(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertTrue(K.pixel_inputs(root)[1])                      # 缺 report
        for kwargs, ready in (({}, True), ({"gates_ok": False}, False), ({"review_pass": False}, False),
                              ({"drift": "special_sprite_sheet"}, False)):
            with self.subTest(**kwargs), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self._write(root, **kwargs)
                pngs, probs = K.pixel_inputs(root)
                self.assertEqual(not probs, ready, probs)
                if ready:
                    self.assertEqual(sorted(pngs), sorted(K.PIXEL_SHEETS))

    def test_install_pending_does_not_write(self):
        class Ctx:
            root = Path(tempfile.gettempdir()) / "zehr-pixel-absent-root"

            def write_asset(self, *a, **k):
                raise AssertionError("pending install must not write")
        self.assertEqual(K.install_pixel(Ctx())["status"], "pending")


if __name__ == "__main__":
    unittest.main()
