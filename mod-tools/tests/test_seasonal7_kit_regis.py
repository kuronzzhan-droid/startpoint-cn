"""雷吉斯 kit 的纯函数与特效换色钩子（需要 live store / 官方基线的用例自动跳过）。

- fx manifest 三种写法解析、缺文件报错、越界 sheet 报错；
- 换色钩子：尺寸不符报错；按 manifest 替换后包内 sheet 像素 = 染色 PNG（临时 workspace，不碰真实包）；
- kit-report 状态只在 gates.json 全过且指纹一致时为 ready-for-review；换色未落包 / 缺 manifest 时强制 draft；
- recolor_problems：审查复现态（manifest 已出、包内仍母本原色）、report 陈旧、alpha 被改、manifest 不全；
- 指纹换色输入随染色 PNG 字节变化；未跟踪 work/ 输入清单；移植的设计期静态校验与原模块逐字相同；
- 严格树比较区分 int/float；面板禁词；
- 像素小人：产物就绪判定（report/复核/sha 漂移）、装包幂等与母本字节负向对照（临时 workspace）。
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_assets  # noqa: E402
import wf_seasonal7_build as B  # noqa: E402
import wf_seasonal7_common as C  # noqa: E402
import wf_seasonal7_kit_regis as K  # noqa: E402
import wf_seasonal7_specs as S  # noqa: E402


def _png_bytes(size=(4, 3), color=(10, 20, 30, 255)) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGBA", size, color).save(buf, format="PNG")
    return buf.getvalue()


class _Ctx:
    png_open = staticmethod(C.png_open)


def _live_available() -> bool:
    try:
        pack = C.S7Pack(S.get_spec("regis", with_kit=False))
        return pack.store.is_dir() and pack.official_read(
            "battle/effect/skill_unique/rec_android/rec_android.atlas.amf3.deflate") is not None
    except Exception:
        return False


class FxManifestTests(unittest.TestCase):
    def _write(self, root: Path, payload) -> Path:
        path = root / K.FX_MANIFEST_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_absent_manifest_is_noop(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(K.load_fx_manifest(Path(tmp)), ({}, None))

    def test_three_layouts(self):
        sheet = "battle/effect/skill_unique/rec_android/rec_android.png"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for payload in ({sheet: "dyed.png"}, {"sheets": {sheet: "dyed.png"}},
                            {"sheets": [{"source": sheet, "png": "dyed.png"}]}):
                path = self._write(root, payload)
                (path.parent / "dyed.png").write_bytes(_png_bytes())
                mapping, info = K.load_fx_manifest(root)
                self.assertEqual(list(mapping), [sheet])
                self.assertEqual(mapping[sheet], path.parent / "dyed.png")
                self.assertEqual(info["entries"], 1)

    def test_missing_png_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write(Path(tmp), {"battle/effect/skill_unique/rec_android/rec_android.png": "nope.png"})
            with self.assertRaises(K.KitError):
                K.load_fx_manifest(Path(tmp))

    def test_transform_rejects_size_mismatch_and_logs(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            dyed = Path(tmp) / "d.png"
            dyed.write_bytes(wf_assets.png_encode(_png_bytes((4, 3), (1, 2, 3, 128))))   # 存储态魔数也接受
            log: list = []
            fn = K.recolor_transform(_Ctx(), "s.png", {"s.png": dyed}, log)
            out = fn(Image.new("RGBA", (4, 3), (0, 0, 0, 255)))
            self.assertEqual(out.getpixel((0, 0)), (1, 2, 3, 128))
            self.assertEqual(log[0]["alpha_pixels_changed"], 12)
            with self.assertRaises(K.KitError):
                fn(Image.new("RGBA", (5, 3)))
            self.assertIsNone(K.recolor_transform(_Ctx(), "other.png", {"s.png": dyed}, log))


class _FakePack:
    """recolor_problems 只用到 pkg_has / pkg_path / template_asset。"""

    def __init__(self, base: Path, donors: dict[str, bytes]):
        self.base, self.donors = base, donors

    def pkg_path(self, root: str, logical: str) -> Path:
        return self.base / root / logical

    def pkg_has(self, root: str, logical: str) -> bool:
        return self.pkg_path(root, logical).is_file()

    def template_asset(self, logical: str):
        return "common", self.donors[logical], "official"


class _FakeCtx:
    png_open = staticmethod(C.png_open)

    def __init__(self, root: Path, pack: _FakePack):
        self.root, self.pack = root, pack


class RecolorFreshnessTests(unittest.TestCase):
    """审查 major/minor：染色产物晚于 kit 出现时，包内 sheet 仍是母本原色，旧指纹与状态都看不出来。"""

    def setUp(self):
        from PIL import Image
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.sheets = K.family_sheets()
        self.donor_img, self.dyed_img, donors = {}, {}, {}
        for i, src in enumerate(self.sheets):
            alpha = Image.new("L", (6, 4), 0)
            alpha.putpixel((1, 1), 255)
            alpha.putpixel((2 + i, 2), 128)
            donor = Image.new("RGBA", (6, 4), (0, 255, 255, 255))
            donor.putalpha(alpha)
            dyed = Image.new("RGBA", (6, 4), (242, 193, 78, 255))
            dyed.putalpha(alpha)
            self.donor_img[src], self.dyed_img[src] = donor, dyed
            donors[src] = C.png_store_bytes(donor)
        self.ctx = _FakeCtx(self.root, _FakePack(self.root / "pkg", donors))

    def tearDown(self):
        self.tmp.cleanup()

    def _manifest(self, sheets=None, **extra):
        out = (self.root / K.FX_MANIFEST_REL).parent
        out.mkdir(parents=True, exist_ok=True)
        mapping = {}
        for src in (sheets if sheets is not None else self.sheets):
            path = out / src.replace("/", "__")
            self.dyed_img[src].save(path)
            mapping[src] = str(path)
        (out / "manifest.json").write_text(json.dumps({"sheets": mapping, **extra}), encoding="utf-8")

    def _package(self, which: str):
        for src, dst in self.sheets.items():
            path = self.ctx.pack.pkg_path("common", dst)
            path.parent.mkdir(parents=True, exist_ok=True)
            img = self.dyed_img[src] if which == "dyed" else self.donor_img[src]
            path.write_bytes(C.png_store_bytes(img))

    def _report(self):
        fx_map, info = K.load_fx_manifest(self.root)
        return {"effects": {"fx_manifest": info,
                            "recolor": [{"source_sheet": s, "png_sha256": info["png_sha256"][s]} for s in fx_map]}}

    def test_manifest_absent_blocks(self):
        self._package("donor")
        probs = K.recolor_problems(self.ctx)
        self.assertTrue(probs and "absent" in probs[0])
        self.assertEqual(K.fx_input_state(self.root), None)

    def test_review_state_donor_sheets_with_manifest_is_caught(self):
        self._manifest()
        self._package("donor")
        probs = K.recolor_problems(self.ctx)
        self.assertEqual(len([p for p in probs if "still donor colours" in p]), 2, probs)

    def test_applied_recolor_passes_and_report_freshness_checked(self):
        self._manifest()
        self._package("dyed")
        self.assertEqual(K.recolor_problems(self.ctx), [])
        self.assertEqual(K.recolor_problems(self.ctx, report=self._report()), [])
        stale = {"effects": {"fx_manifest": None, "recolor": []}}
        probs = K.recolor_problems(self.ctx, report=stale)
        self.assertTrue(any("fx_manifest sha256" in p for p in probs))
        self.assertEqual(len([p for p in probs if "lacks" in p]), 2)

    def test_sheet_bytes_override_and_alpha_change(self):
        from PIL import Image
        self._manifest()
        self._package("dyed")
        src, dst = next(iter(self.sheets.items()))
        donor_raw = self.ctx.pack.template_asset(src)[1]
        self.assertTrue(K.recolor_problems(self.ctx, sheet_bytes={dst: donor_raw}))
        bad = self.dyed_img[src].copy()
        bad.putalpha(Image.new("L", bad.size, 255))
        probs = K.recolor_problems(self.ctx, sheet_bytes={dst: C.png_store_bytes(bad)})
        self.assertTrue(any("alpha differs" in p for p in probs), probs)

    def test_partial_manifest_blocks(self):
        first = next(iter(self.sheets))
        self._manifest(sheets=[first])
        self._package("dyed")
        self.assertTrue(any("does not cover" in p for p in K.recolor_problems(self.ctx)))

    def test_fx_input_state_changes_with_png_bytes(self):
        self._manifest()
        before = K.fx_input_state(self.root)
        src = next(iter(self.sheets))
        Path(K.load_fx_manifest(self.root)[0][src]).write_bytes(_png_bytes((6, 4), (1, 1, 1, 255)))
        after = K.fx_input_state(self.root)
        self.assertEqual(before["manifest_sha256"], after["manifest_sha256"])
        self.assertNotEqual(before["png_sha256"][src], after["png_sha256"][src])

    def test_gates_false_manifest_rejected(self):
        self._manifest(gates_ok=False)
        with self.assertRaises(K.KitError):
            K.load_fx_manifest(self.root)

    def test_clone_section_must_match_families(self):
        self._manifest(clone=[{"src": s, "dst": d, "fx_names": sorted(b)} for (s, d), (_x, _y, b)
                              in zip(self.sheets.items(), K.EFFECT_FAMILIES)])
        self.assertEqual(K.fx_manifest_clone_problems(self.root), [])
        src = next(iter(self.sheets))
        self._manifest(clone=[{"src": src, "dst": "battle/effect/skill_unique/rec_android_seaside_beam/x.png"}])
        self.assertTrue(K.fx_manifest_clone_problems(self.root))


class UntrackedInputsTests(unittest.TestCase):
    def test_lists_missing_work_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(len(K.untracked_input_problems(root)), 4)
            for rel in (K.DESIGN_REL, K.DESIGN_TREE_REL.format(level="1"), K.DESIGN_TREE_REL.format(level="2"),
                        K.OFFICIAL_SIG_REL):
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text("{}", encoding="utf-8")
            self.assertEqual(K.untracked_input_problems(root), [])
            with self.assertRaises(K.KitError):
                K.load_official_sig(root / "nowhere")

    def test_ported_checker_matches_design_blueprint(self):
        """移植的 blueprint_check 与 research/_tmp/blueprint_build.check 输出逐字相同（子进程：原模块会换 stdout）。"""
        import subprocess
        root = Path(__file__).resolve().parents[2]
        bp = root / K.BATCH / "research/_tmp/blueprint_build.py"
        if not bp.is_file() or not (root / K.DESIGN_TREE_REL.format(level="1")).is_file():
            self.skipTest("design _tmp blueprint / final trees absent")
        script = (
            "import sys, json, copy\n"
            f"sys.path.insert(0, {str(root / 'mod-tools')!r}); sys.path.insert(0, {str(bp.parent)!r})\n"
            "import wf_seasonal7_kit_regis as K\n"          # 先导入被测模块：blueprint_build 会把 cwd 下 mod-tools 插到 sys.path 首位
            "import blueprint_build as BP\n"
            "from pathlib import Path\n"
            f"root = Path({str(root)!r}); sig = K.load_official_sig(root)\n"
            "trees = [json.loads((root / K.DESIGN_TREE_REL.format(level=lv)).read_text(encoding='utf-8')) for lv in '12']\n"
            "t = copy.deepcopy(trees[0])\n"
            "for c in K.iter_commands(t, 'CreateNormalAttack'):\n"
            "    c[1] = 99 if c[1] == 11 else c[1]\n"
            "trees += [t, BP.blueprint_a(), BP.blueprint_b(), BP.blueprint_c()]\n"
            "out = [[list(BP.check(x)[0]), K.blueprint_check_with_sig(x, sig)[0]] for x in trees]\n"
            "print(json.dumps(out, ensure_ascii=False))\n")
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        proc = subprocess.run([sys.executable, "-c", script], cwd=root, capture_output=True, env=env, timeout=300)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        pairs = json.loads(proc.stdout.decode("utf-8").strip().splitlines()[-1])
        for original, ported in pairs:
            self.assertEqual(original, ported)
        self.assertEqual(pairs[0][1], [])
        self.assertTrue(pairs[2][1], "negative control (scope 99) must be caught")


class StatusAndHelpersTests(unittest.TestCase):
    def test_blockers_force_draft(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / K.GATES_REL
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"all_pass": True, "kit_fingerprint": "abc"}), encoding="utf-8")
            self.assertEqual(K.gates_status(root, "abc", ["fx manifest absent"])[0], "draft")
            self.assertEqual(K.gates_status(root, "abc", [])[0], "ready-for-review")

    def test_gates_status_requires_matching_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(K.gates_status(root, "abc")[0], "draft")
            path = root / K.GATES_REL
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"all_pass": True, "kit_fingerprint": "abc"}), encoding="utf-8")
            self.assertEqual(K.gates_status(root, "abc")[0], "ready-for-review")
            self.assertEqual(K.gates_status(root, "xyz")[0], "draft")
            path.write_text(json.dumps({"all_pass": False, "kit_fingerprint": "abc"}), encoding="utf-8")
            self.assertEqual(K.gates_status(root, "abc")[0], "draft")

    def test_strict_equal_distinguishes_int_float_bool(self):
        self.assertTrue(K.strict_equal([{"min": 1.0}], [{"min": 1.0}]))
        self.assertFalse(K.strict_equal([{"min": 1}], [{"min": 1.0}]))
        self.assertFalse(K.strict_equal([True], [1]))
        self.assertIn("$[0].min", K.first_difference([{"min": 1}], [{"min": 1.0}]))

    def test_panel_forbidden_words(self):
        self.assertTrue(K.panel_text_problems("自身为队长时，攻击力＋10%"))
        self.assertTrue(K.panel_text_problems("生命值100%以下时"))
        self.assertEqual(K.panel_text_problems("雷属性共鸣时，FEVER时间＋50%"), [])

    def test_texts_constant_matches_design(self):
        root = Path(__file__).resolve().parents[2]
        if not (root / K.DESIGN_REL).is_file():
            self.skipTest("design json absent")
        self.assertEqual(K.check_texts_constant(K.load_design(root)), [])


class PixelInputsTests(unittest.TestCase):
    """像素产物就绪判定：report 门禁 + 复核 verify_all + sha 与盘上一致，任一不符 = pending。"""

    def _stage(self, root: Path, *, gates_passed=True, review_pass=True, drift=None):
        base = root / K.PIXEL_DIR_REL
        (base / "out").mkdir(parents=True, exist_ok=True)
        outputs, detail = {}, {}
        for i, name in enumerate(K.PIXEL_SHEETS):
            raw = _png_bytes((4 + i, 3))
            (base / "out" / f"{name}.png").write_bytes(raw)
            digest = C.sha256(raw)
            outputs[name] = {"sha256": digest}
            detail[name] = {"sha256": digest}
        (base / "report.json").write_text(json.dumps({
            "key": "regis", "gates_passed": gates_passed, "gates": {"G1": {"ok": gates_passed}},
            "outputs": outputs}), encoding="utf-8")
        verify = root / K.PIXEL_VERIFY_REL
        verify.parent.mkdir(parents=True, exist_ok=True)
        verify.write_text(json.dumps({"regis": {"pass": review_pass, "hard": {
            "H1_size": {"ok": review_pass}, "H8_png_roundtrip": {"ok": True, "detail": detail}}}}), encoding="utf-8")
        if drift:
            (base / "out" / f"{drift}.png").write_bytes(_png_bytes((9, 9)))

    def test_absent_report_is_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            pngs, probs = K.pixel_inputs(Path(tmp))
            self.assertEqual(pngs, {})
            self.assertTrue(probs and "absent" in probs[0])

    def test_ready_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._stage(Path(tmp))
            pngs, probs = K.pixel_inputs(Path(tmp))
            self.assertEqual(probs, [])
            self.assertEqual(sorted(pngs), sorted(K.PIXEL_SHEETS))

    def test_gate_or_review_failure_and_sha_drift_block(self):
        for kw, needle in (({"gates_passed": False}, "gates"), ({"review_pass": False}, "review failed"),
                           ({"drift": "sprite_sheet"}, "sha256")):
            with tempfile.TemporaryDirectory() as tmp:
                self._stage(Path(tmp), **kw)
                _pngs, probs = K.pixel_inputs(Path(tmp))
                self.assertTrue(any(needle in p for p in probs), (kw, probs))


def _pixel_ready() -> bool:
    root = Path(__file__).resolve().parents[2]
    try:
        return _live_available() and not K.pixel_inputs(root)[1]
    except Exception:
        return False


@unittest.skipUnless(_pixel_ready(), "live store or reviewed pixel outputs unavailable")
class PixelInstallIntegrationTests(unittest.TestCase):
    def test_install_is_idempotent_and_checks_donor(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec = S.get_spec("regis")
            pack = C.S7Pack(spec, workspace=Path(tmp) / "s7-regis")
            B.step_init(pack)
            ctx = B.KitContext(pack)
            prefix = {f"character/{spec.template_code}/": f"character/{spec.code}/"}
            for name, metas in K.PIXEL_SHEETS.items():
                for meta in metas:
                    raw = pack.template_asset(f"character/{spec.template_code}/pixelart/{meta}")[1]
                    pack.write_pkg("common", f"character/{spec.code}/pixelart/{meta}",
                                   C.amf_bytes(C.replace_strings(C.amf_parse(raw), prefix)))
            first = K.install_pixel(ctx)
            self.assertEqual(first["status"], "installed")
            self.assertEqual(K.pixel_problems(ctx), [])
            logical = f"character/{spec.code}/pixelart/sprite_sheet.png"
            mtime = pack.pkg_path("common", logical).stat().st_mtime_ns
            self.assertEqual(K.install_pixel(ctx)["sheets"], first["sheets"])
            self.assertEqual(pack.pkg_path("common", logical).stat().st_mtime_ns, mtime)
            self.assertEqual(pack.owner_of("common", logical), "pixel")
            donor = pack.template_asset(f"character/{spec.template_code}/pixelart/sprite_sheet.png")[1]
            self.assertTrue(K.pixel_problems(ctx, sheet_bytes={logical: donor}))
            # 元数据仍带母本路径（未改写前缀）→ 必须报
            meta = f"character/{spec.code}/pixelart/pixelart.frame.amf3.deflate"
            pack.write_pkg("common", meta, pack.template_asset(
                f"character/{spec.template_code}/pixelart/pixelart.frame.amf3.deflate")[1])
            self.assertTrue(any("metadata" in p for p in K.pixel_problems(ctx)))
            self.assertTrue(str(pack.workspace).startswith(tmp))


@unittest.skipUnless(_live_available(), "live store / official baseline unavailable")
class RecolorCloneIntegrationTests(unittest.TestCase):
    def test_manifest_png_replaces_cloned_sheet(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            spec = S.get_spec("regis")
            pack = C.S7Pack(spec, workspace=Path(tmp) / "s7-regis")
            B.step_init(pack)
            ctx = B.KitContext(pack)
            src_dir, sub, bases = K.EFFECT_FAMILIES[1]
            sheet = f"{src_dir}/rec_android.png"
            _root, raw, _src = pack.template_asset(sheet)
            donor = C.png_open(raw)
            dyed = Image.new("RGBA", donor.size, (200, 150, 50, 255))
            dyed.putalpha(donor.getchannel("A"))
            dyed_path = Path(tmp) / "dyed.png"
            dyed.save(dyed_path)
            log: list = []
            fam = ctx.clone_effect_family(src_dir, sub, fx_names=list(bases),
                                          png_transform=K.recolor_transform(ctx, sheet, {sheet: dyed_path}, log))
            out = C.png_open(pack.pkg_path("common", f"{fam['dst_dir']}/{sub}.png").read_bytes())
            self.assertEqual(out.tobytes(), dyed.tobytes())
            self.assertEqual(log[0]["alpha_pixels_changed"], 0)
            self.assertTrue(str(pack.workspace).startswith(tmp))


if __name__ == "__main__":
    unittest.main()
