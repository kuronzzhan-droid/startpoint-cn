# -*- coding: utf-8 -*-
"""斩铁·白梅 kit 的只读回归：设计行回放（含主控 F1 覆盖）、技能树拼装与门禁、作用域补充检查的阴性对照。

不写包、不写 live；需要本机 live store 与官方基线（.cdn/cn），缺失时跳过。
"""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import wf_seasonal7_kit_zantetsu as K  # noqa: E402


def _context():
    import wf_seasonal7_build as B
    import wf_seasonal7_common as C
    import wf_seasonal7_specs as S
    spec = S.get_spec(K.KEY)
    pack = C.S7Pack(spec)
    if pack.official_read(K.ABILITY, "common") is None:
        raise unittest.SkipTest("official baseline unavailable")
    return B.KitContext(pack)


class ZantetsuKitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.ctx = _context()
        except unittest.SkipTest:
            raise
        except Exception as exc:                      # 没有 live profile 的机器
            raise unittest.SkipTest(f"live store unavailable: {exc}")
        cls.design = K.load_design(cls.ctx.root)

    def test_spec_merges_texts_and_extra_keys(self):
        spec = self.ctx.spec
        self.assertEqual(spec.texts["title"], "白梅羽织的忍者武士")
        self.assertEqual(tuple(spec.required_capabilities), K.REQUIRED_CAPABILITIES)
        self.assertEqual(spec.extra_keys[K.CAS], (K.CAS_KEY,))
        self.assertEqual(spec.extra_keys[K.SWITCHED], (K.VOICE_READY,))

    def test_rows_replay_design_with_f1_override(self):
        rows = K.design_rows(self.ctx, self.design)
        slot4 = rows["abilities"]["1599984"]
        self.assertEqual(slot4[0], self.design["fallbacks"][K.SLOT4_OVERRIDE]["row_final"])
        self.assertEqual(slot4[0][47], "507")
        self.assertNotIn("112", [r[47] for r in slot4])
        self.assertEqual(len(rows["leader"]), 6)
        self.assertEqual(sum(len(v) for v in rows["abilities"].values()), 12)
        caps = set()
        for row in rows["leader"]:
            gate = K.row_gate("leader_ability", row, {K.CAS_KEY})
            self.assertFalse(K._row_gate_failed(gate), gate)
            caps.update(gate["required_client_capabilities"])
        for key, lines in rows["abilities"].items():
            for row in lines:
                gate = K.row_gate("ability", row, {K.CAS_KEY})
                self.assertFalse(K._row_gate_failed(gate), (key, gate))
                caps.update(gate["required_client_capabilities"])
        self.assertEqual(sorted(caps), sorted(K.REQUIRED_CAPABILITIES))

    def test_row_gate_catches_missing_string_and_fever_puller(self):
        rows = K.design_rows(self.ctx, self.design)
        self.assertTrue(K._row_gate_failed(K.row_gate("ability", rows["abilities"]["1599983"][2], set())))
        bad = list(rows["leader"][5])
        bad[96] = "0"
        self.assertTrue(K._row_gate_failed(K.row_gate("leader_ability", bad, {K.CAS_KEY})))

    def _composed(self, level):
        import wf_dsl
        donors = {code: self.ctx.amf_parse(self.ctx.official_read(
            wf_dsl.dsl_logical(K.DONOR_PROGRAM.format(code=code, level=level)), "common"))
            for code in (K.D2_CODE, K.D1_CODE)}
        tree = K.compose_tree(donors[K.D2_CODE], donors[K.D1_CODE], level)
        for fam in K.FAMILIES:                      # 与 build 同口径：只按已复制基名重定向（纯函数，不写包）
            donor = fam["src_dir"].rsplit("/", 1)[-1]
            dst = f"battle/effect/skill_unique/{K.CODE}_{fam['subdir']}"
            tree, _refs = self.ctx.rewrite_effect_refs(tree, {
                "src_dir": fam["src_dir"], "dst_dir": dst, "donor": donor, "dst_name": dst.rsplit("/", 1)[-1],
                "copied_bases": list(fam["fx"])}, strict=True)
        return tree

    def test_composed_trees_pass_gates(self):
        for level in (1, 2):
            tree = self._composed(level)
            gate = K.dsl_gates(tree, self.ctx.amf_bytes(tree), level, self.ctx.root)
            gate_view = {k: v for k, v in gate.items() if isinstance(v, list) and v}
            self.assertFalse(K._dsl_gate_failed(gate), gate_view)
            flags = K._find_cmds(tree, "ConditionalsChangeSkillFlag")
            self.assertEqual(len(flags), 1)
            self.assertEqual([b[0] for b in flags[0][2:]], ["Block", "Block"])

    def test_lookup_scope_negative_controls(self):
        tree = self._composed(1)
        self.assertEqual(K.lookup_scope_problems(tree), [])
        broken = copy.deepcopy(tree)
        K._one(broken, "CreateHitArea", lambda a: a[19] == 9)[2] = 12
        self.assertTrue(K.lookup_scope_problems(broken))
        broken = copy.deepcopy(tree)
        [s for s in K._find_cmds(broken, "ShowEffect") if s[3] == 11][0][3] = 3
        self.assertTrue(K.lookup_scope_problems(broken))
        broken = copy.deepcopy(tree)
        K._find_cmds(broken, "ConditionalsChangeSkillFlag")[0][3] = ["DoNothing"]
        self.assertTrue(K.sig_problems(broken))


class IntegrateGuardTest(unittest.TestCase):
    """审查修复：stance_detail 被 tables 回写的诊断、指纹逐项差异、特效小人与像素小人同色核对（阴性对照）。

    对照组先用现有像素/fx 产物的同步副本跑一次，变异组只比对照组「多出」的问题，不依赖当前 live 产物全绿。
    """

    @classmethod
    def setUpClass(cls):
        try:
            cls.ctx = _context()
        except unittest.SkipTest:
            raise
        except Exception as exc:
            raise unittest.SkipTest(f"live store unavailable: {exc}")
        root = cls.ctx.root
        needed = [root / K.FX_REPORT_REL, root / K.FX_ANALYSIS_REL, root / K.PIXEL_REPORT_REL, root / K.FX_MANIFEST_REL]
        needed += [root / K.PIXEL_OUT_REL / f"{name}.png" for name in K.PIXEL_SHEETS]
        if not all(p.is_file() for p in needed):
            raise unittest.SkipTest("fx / pixel outputs not present")
        cls.templates = {name: K._rgba_array(cls.ctx.pack.template_asset(
            K.PIXEL_SHEET.format(code=K.D1_CODE, name=name))[1]) for name in K.PIXEL_SHEETS}

    def test_fingerprint_part_changes(self):
        before = ["a#1=x", "b=y", "c=<missing>"]
        self.assertEqual(K.fingerprint_part_changes(before, before), [])
        self.assertEqual(K.fingerprint_part_changes(before, ["a#1=x", "b=z", "d=w"]), ["b", "c", "d"])
        parts = K.kit_fingerprint_parts(self.ctx.pack)
        self.assertEqual(K.kit_fingerprint(self.ctx.pack), K._sha("\n".join(parts).encode("utf-8")))
        self.assertIn(f"{K.STANCE}#{K.CID}", [p.rpartition("=")[0] for p in parts])

    def test_stance_detail_distinguishes_tables_rewrite(self):
        check = K.stance_detail_check(self.ctx, K.load_design(self.ctx.root))
        self.assertEqual(check["design"], ',1,"1,5",1,,1,"1,5",1')
        self.assertEqual(check["tables_template_value"], ",1,1,1,,1,1,1")
        self.assertEqual(check["ok"], check["package"] == check["design"])
        self.assertEqual(check["reverted_by_tables"], check["package"] == check["tables_template_value"])
        design, tables = check["design"], check["tables_template_value"]
        self.assertEqual((K.classify_stance_detail(design, design, tables)["ok"],
                          K.classify_stance_detail(design, design, tables)["reverted_by_tables"]), (True, False))
        self.assertEqual((K.classify_stance_detail(tables, design, tables)["ok"],
                          K.classify_stance_detail(tables, design, tables)["reverted_by_tables"]), (False, True))
        self.assertEqual((K.classify_stance_detail(None, design, tables)["ok"],
                          K.classify_stance_detail(None, design, tables)["reverted_by_tables"]), (False, False))

    # ---- 小人同色
    def _fixture(self, tmp: Path, recolor: dict | None = None, sync_dependency: bool = True,
                 s1_provenance: dict | None = None) -> dict:
        """复制 pixel/out 与两份报告到临时目录；recolor={源色hex: 新目标RGB} 改像素小人里该源色的输出色。"""
        import io
        import json
        from PIL import Image
        root = self.ctx.root
        out = tmp / "out"
        out.mkdir()
        px_report = json.loads((root / K.PIXEL_REPORT_REL).read_text(encoding="utf-8"))
        fx_report = json.loads((root / K.FX_REPORT_REL).read_text(encoding="utf-8"))
        for name in K.PIXEL_SHEETS:
            raw = (root / K.PIXEL_OUT_REL / f"{name}.png").read_bytes()
            if recolor:
                arr = K._rgba_array(raw).copy()
                tpl = self.templates[name]
                for src, new in recolor.items():
                    rgb = [int(src[i:i + 2], 16) for i in (0, 2, 4)]
                    sel = (tpl[..., :3] == rgb).all(-1) & (tpl[..., 3] == 255)
                    arr[sel, :3] = new
                buf = io.BytesIO()
                Image.fromarray(arr, "RGBA").save(buf, format="PNG")
                raw = buf.getvalue()
            (out / f"{name}.png").write_bytes(raw)
            px_report["outputs"][name]["sha256"] = K._sha(raw)
        px_path = tmp / "pixel_report.json"
        px_path.write_text(json.dumps(px_report, ensure_ascii=False), encoding="utf-8")
        if sync_dependency:
            fx_report["pixel_dependency"]["sha256"] = K._sha(px_path.read_bytes())
        fx_report["sheets"]["S1_ittou"]["doll"]["provenance"].update(s1_provenance or {})
        fx_path = tmp / "fx_report.json"
        fx_path.write_text(json.dumps(fx_report, ensure_ascii=False), encoding="utf-8")
        return {"pixel_out": out, "pixel_report": px_path, "fx_report": fx_path}

    def _run(self, **kw) -> tuple[dict, set]:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            result = K.doll_color_checks(self.ctx.pack, self._fixture(Path(tmp), **kw))
        return result, set(result["problems"])

    def test_doll_colors_negative_controls(self):
        control, base = self._run()
        fams = {f["family"]: f for f in control["families"]}
        s1 = [r for r in fams["S1_ittou"]["colors"] if r["rule"] == "pixel_same_source" and r["source"] not in K.DOLL_KEEP]
        s1_analog = [r for r in fams["S1_ittou"]["colors"] if r["rule"] == "old_doll_analog"]
        s2_pixel = [r for r in fams["S2_kanbai"]["colors"] if r["rule"] == "pixel_mapping"]
        self.assertTrue(s1 and s1_analog and s2_pixel, control["families"])

        # 1) smr22 小人某源色在像素里改色，特效没跟 → S1 同色门禁报错
        victim = s1[0]["source"]
        _r, got = self._run(recolor={victim: (1, 2, 3)})
        self.assertTrue(any("S1_ittou" in p and f"#{victim}" in p for p in got - base), got - base)

        # 2) 旧小人同类源色在像素里改色 → 两族 analog 核对报错
        analog = s1_analog[0]["analog_source"]
        _r, got = self._run(recolor={analog: (4, 5, 6)})
        self.assertTrue(any(f"同类源色 #{analog}" in p for p in got - base), got - base)

        # 3) 旧小人 pixel_mapping 色在像素里改色 → S2 报错
        victim = s2_pixel[0]["source"]
        _r, got = self._run(recolor={victim: (7, 8, 9)})
        self.assertTrue(any("S2_kanbai" in p and f"#{victim}" in p for p in got - base), got - base)

        # 3b) smr22 族不认 fx 报告的「同类源色」说辞：像素里有的源色一律直接比像素
        by_target: dict = {}
        for r in s1:
            by_target.setdefault(r["fx"], []).append(r["source"])
        pair = next(v for v in by_target.values() if len(v) >= 2)
        victim, alibi = pair[0], pair[1]
        fx_target = next(r["fx"] for r in s1 if r["source"] == victim)
        _r, got = self._run(recolor={victim: (10, 11, 12)}, s1_provenance={victim: {
            "rule": "old_doll_analog", "analog_source": alibi, "analog_target": fx_target, "target": fx_target}})
        self.assertTrue(any("S1_ittou" in p and f"#{victim}" in p for p in got - base), got - base)

        # 4) 像素报告变了但 fx 没重跑（依赖 sha 不同步）→ 依赖链报错
        _r, got = self._run(sync_dependency=False)
        self.assertTrue(any("像素报告已变" in p for p in got - base), got - base)

    def test_doll_colors_missing_inputs_fail(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            result = K.doll_color_checks(self.ctx.pack, {"pixel_report": Path(tmp) / "absent.json"})
        self.assertTrue(result["problems"])


class FxManifestHookTest(unittest.TestCase):
    def test_manifest_shapes_and_transform(self):
        import io
        import json
        import tempfile
        from PIL import Image
        import wf_assets
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = root / Path(K.FX_MANIFEST_REL).parent
            out.mkdir(parents=True)
            template = Image.new("RGBA", (8, 4), (10, 20, 30, 128))
            dyed = Image.new("RGBA", (8, 4), (200, 100, 50, 128))
            buf = io.BytesIO()
            dyed.save(buf, format="PNG")
            (out / "kanbai.png").write_bytes(wf_assets.png_encode(buf.getvalue()))   # 店内小写魔数也要能读
            src = "battle/effect/skill_unique/samurai_robot/samurai_robot.png"
            for payload in ({src: "kanbai.png"}, {"sheets": [{"source": src, "png": "kanbai.png"}]}):
                (out / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
                mapping, info = K.fx_manifest(root)
                self.assertEqual(list(mapping), [src])
                log = []
                transform = K._png_transform_for(src, "x/x.png", mapping, log)
                result = transform(template)
                self.assertEqual(result.getpixel((0, 0)), (200, 100, 50, 128))
                self.assertTrue(log[0]["alpha_identical"])
            self.assertIsNone(K._png_transform_for("other.png", "y/y.png", mapping, []))
            with self.assertRaises(K.KitError):
                K._png_transform_for(src, "x/x.png", mapping, [])(Image.new("RGBA", (9, 4)))
            with self.assertRaises(K.KitError):            # alpha 不等 = 几何漂移，硬失败
                K._png_transform_for(src, "x/x.png", mapping, [])(Image.new("RGBA", (8, 4), (10, 20, 30, 255)))


class MediaIntegrateTest(unittest.TestCase):
    """Integrate：特效 sheet 存储态原字节、像素复核判定、像素包内核对与语音状态（只读 + 阴性对照）。"""

    def test_store_bytes_forms(self):
        import io
        import tempfile
        from PIL import Image
        import wf_assets
        buf = io.BytesIO()
        Image.new("RGBA", (3, 2), (1, 2, 3, 255)).save(buf, format="PNG")
        real = buf.getvalue()
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "a.png"
            p.write_bytes(real)
            store = K.fx_store_bytes(p)
            self.assertEqual(store[:8], wf_assets.PNG_FAKE)
            self.assertEqual(store[8:], real[8:])                    # 只换魔数，不重编码
            p.write_bytes(store)
            self.assertEqual(K.fx_store_bytes(p), store)             # 已是存储态原样返回
            p.write_bytes(b"GIF89a....")
            with self.assertRaises(K.KitError):
                K.fx_store_bytes(p)

    def test_pixel_review_verdict(self):
        section = ("## 4. 初审\n| zantetsu 斩铁 | x | **PASS** |\n"
                   "## 5. 修复轮复核（04:0x）\n| 角色 | 改动 | 判定 |\n|---|---|---|\n"
                   "| zantetsu 斩铁 | 未改 | {verdict} |\n| yuki 见岛勇希 | 未改 | **PASS** |\n")
        self.assertTrue(K.pixel_review_verdict(section.format(verdict="**PASS**"))[0])
        self.assertFalse(K.pixel_review_verdict(section.format(verdict="**FAIL**（必修）"))[0])
        self.assertFalse(K.pixel_review_verdict("## 4. 初审\n| zantetsu 斩铁 | x | **PASS** |\n")[0])   # 只有初审段不算
        self.assertFalse(K.pixel_review_verdict(section.format(verdict="**PASS**").replace("| zantetsu 斩铁 | 未改", "| tekuto | 未改"))[0])


class MediaPackageStateTest(unittest.TestCase):
    """真实包只读核对：已装像素 = pixel/out 存储态；篡改字节 / alpha 的阴性对照必须报问题；语音状态已装包。"""

    @classmethod
    def setUpClass(cls):
        try:
            cls.ctx = _context()
        except unittest.SkipTest:
            raise
        except Exception as exc:
            raise unittest.SkipTest(f"live store unavailable: {exc}")
        cls.state = K.pixel_inputs(cls.ctx.root)
        if not cls.state["ready"]:
            raise unittest.SkipTest(f"pixel inputs pending: {cls.state['problems']}")

    def _store(self):
        return {K.PIXEL_SHEET.format(code=K.CODE, name=n): K.fx_store_bytes(Path(o["file"]))
                for n, o in self.state["outputs"].items()}

    def test_pixel_prewrite_control_and_mutations(self):
        import io
        import numpy as np
        from PIL import Image
        import wf_seasonal7_common as C
        store = self._store()
        self.assertEqual(K.pixel_package_problems(self.ctx.pack, store), [])
        logical = K.PIXEL_SHEET.format(code=K.CODE, name="sprite_sheet")
        arr = np.asarray(C.png_open(store[logical])).copy()
        ys, xs = np.nonzero(arr[..., 3] == 0)
        arr[ys[0], xs[0], 3] = 255                                  # 透明像素变不透明 = alpha 漂移
        mutated = C.png_store_bytes(Image.fromarray(arr, "RGBA"))
        problems = K.pixel_package_problems(self.ctx.pack, {**store, logical: mutated})
        self.assertTrue(any("bytes != store form" in p for p in problems))
        self.assertTrue(any("alpha differs" in p for p in problems))
        reenc = C.png_store_bytes(C.png_open(store[logical]))       # 像素相同但 PIL 重编码：字节门禁仍拦
        if reenc != store[logical]:
            self.assertTrue(any("bytes != store form" in p
                                for p in K.pixel_package_problems(self.ctx.pack, {**store, logical: reenc})))

    def test_voice_state_reports(self):
        state = K.voice_state(self.ctx.pack)
        self.assertIn("packed", state)
        if state["packed"]:
            self.assertEqual(state["extra_voice_files"], [])
            self.assertEqual(state["speech_refs"][:6], [f"home/home_{i}" for i in range(6)])


if __name__ == "__main__":
    unittest.main()
