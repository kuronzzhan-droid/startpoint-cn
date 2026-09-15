# -*- coding: utf-8 -*-
"""wf_seasonal7_kit_philia：纯函数门禁负向用例 + 与设计/包产物的只读集成用例（不写 workspace）。"""
from __future__ import annotations

import copy
import io
import json
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_client_legality as L  # noqa: E402
import wf_dsl  # noqa: E402
import wf_seasonal7_common as C  # noqa: E402
import wf_seasonal7_kit_philia as K  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PROTO = ROOT / K.BATCH / "design/_tmp/philia/proto"
WORKSPACE = ROOT / "work/character_packs/s7-philia"


def _proto(name: str):
    return json.loads((PROTO / name).read_text(encoding="utf-8"))


class ReadOnlyCtx:
    """build_skill_tree / build_pf_tree / derive_rows 需要的最小只读上下文（不写 template_sources）。"""

    def __init__(self):
        import wf_seasonal7_specs as S
        self.pack = C.S7Pack(S.get_spec(K.KEY))
        self.root = self.pack.root

    def official_read(self, logical, root=None):
        return self.pack.official_read(logical, root)

    def live_read(self, logical):
        return self.pack.live_read(logical)

    def template_dsl(self, program):
        raw = self.pack.official_read(wf_dsl.dsl_logical(program), "common")
        return C.amf_parse(raw if raw is not None else self.pack.live_read(wf_dsl.dsl_logical(program)))

    def official_flat(self, logical):
        return C.core.read_orderedmap_file_from_bytes(self.pack.official_read(logical, "common"))

    def live_flat(self, logical):
        return self.pack.live_flat(logical)

    def rewrite_effect_refs(self, tree, family, *, strict=False):
        return C.rewrite_effect_refs(tree, family, strict=strict)


@unittest.skipUnless((PROTO / f"{K.CODE}_2.json").is_file(), "design prototypes absent")
class DslGateNegatives(unittest.TestCase):
    def test_prototypes_are_clean(self):
        for name in (f"{K.CODE}_1.json", f"{K.CODE}_2.json", *[f"{K.CODE}_pf_lv{n}.json" for n in (1, 2, 3)]):
            gates = K.dsl_gates(_proto(name))
            self.assertEqual(K.dsl_gate_failures(gates), [], name)

    def test_scalar_in_array_param_is_f1034(self):
        tree = _proto(f"{K.CODE}_2.json")
        hit = K.cmds(tree, "CreateHitArea")[0]
        self.assertEqual(hit[9][0], "Circle")
        hit[9] = ["Circle", 30]                          # 裸数值进 Array 参
        probs = K.signature_problems(tree)
        self.assertTrue(any("Circle#1" in p and "want Array" in p for p in probs), probs)

    def test_donothing_branch_is_f1009(self):
        tree = _proto(f"{K.CODE}_2.json")
        tree[11][1].append(["ConditionalsFeverMode", ["DoNothing"], ["Block", []]])
        self.assertTrue(any("DoNothing" in p for p in K.signature_problems(tree)))

    def test_unbound_lookup_is_c16103(self):
        tree = _proto(f"{K.CODE}_2.json")
        rain = [c for c in K.cmds(tree, "CreateNormalAttack") if c[1] == 103]
        self.assertEqual(len(rain), 1)
        rain[0][1] = 3                                   # 漏重映射
        self.assertTrue(K.scope_problems(tree))
        self.assertTrue(K.dsl_gate_failures(K.dsl_gates(tree)))

    def test_wrapper_is_rejected(self):
        with self.assertRaises(Exception):
            C.amf_bytes({"tree": _proto(f"{K.CODE}_1.json"), "numbers": []})


class FxManifestHook(unittest.TestCase):
    def _root(self, tmp: Path, manifest: dict, images: dict):
        out = tmp / K.FX_MANIFEST_REL
        out.parent.mkdir(parents=True)
        for name, img in images.items():
            img.save(out.parent / name)
        out.write_text(json.dumps(manifest), encoding="utf-8")
        return tmp

    def test_formats_and_transform_gates(self):
        from PIL import Image
        src = Image.new("RGBA", (8, 4), (10, 200, 30, 255))
        src.putpixel((0, 0), (0, 0, 0, 0))
        same_alpha = src.copy()
        same_alpha.putpixel((1, 1), (200, 10, 30, 255))
        alpha_changed = same_alpha.copy()
        alpha_changed.putpixel((0, 0), (5, 5, 5, 128))
        sheet = "battle/effect/skill_unique/wind_oracle_1anv/wind_oracle_1anv.png"
        with tempfile.TemporaryDirectory() as tmp:
            root = self._root(Path(tmp), {"sheets": {"battle/effect/skill_unique/wind_oracle_1anv": "a.png"},
                                          "entries": []},
                              {"a.png": same_alpha, "b.png": alpha_changed, "c.png": Image.new("RGBA", (9, 4))})
            overrides, info = K.load_fx_manifest(root)
            self.assertEqual(list(overrides), [sheet])
            log: dict = {}
            got = K.make_png_transform(sheet, overrides[sheet], log)(src)
            self.assertEqual(got.getpixel((1, 1)), (200, 10, 30, 255))
            self.assertEqual(log[sheet]["alpha_changed_pixels"], 0)
            base = Path(tmp) / K.FX_MANIFEST_REL
            with self.assertRaises(K.KitError):
                K.make_png_transform(sheet, {"file": base.parent / "b.png", "allow_alpha_change": False}, {})(src)
            K.make_png_transform(sheet, {"file": base.parent / "b.png", "allow_alpha_change": True}, {})(src)
            with self.assertRaises(K.KitError):
                K.make_png_transform(sheet, {"file": base.parent / "c.png", "allow_alpha_change": True}, {})(src)
            self.assertIsNone(K.make_png_transform(sheet, None, {}))

    def test_effects_stage_fingerprints_are_enforced(self):
        import hashlib
        from PIL import Image
        src = Image.new("RGBA", (4, 4), (10, 200, 30, 255))
        new = src.copy()
        new.putpixel((2, 2), (120, 130, 255, 255))
        sheet = "battle/effect/skill_unique/wind_oracle/wind_oracle.png"
        good = {"source_rgba_sha256": hashlib.sha256(src.tobytes()).hexdigest(),
                "out_rgba_sha256": hashlib.sha256(new.tobytes()).hexdigest(), "gates_all_ok": True}
        with tempfile.TemporaryDirectory() as tmp:
            root = self._root(Path(tmp), {"sheets": {sheet: "n.png"}, "details": {sheet: good}}, {"n.png": new})
            overrides, _ = K.load_fx_manifest(root)
            K.make_png_transform(sheet, overrides[sheet], {})(src)
            drifted = src.copy()
            drifted.putpixel((0, 0), (1, 2, 3, 255))
            with self.assertRaises(K.KitError):
                K.make_png_transform(sheet, overrides[sheet], {})(drifted)
            manifest = Path(tmp) / K.FX_MANIFEST_REL
            manifest.write_text(json.dumps({"sheets": {sheet: "n.png"}, "all_gates_ok": False}), encoding="utf-8")
            with self.assertRaises(K.KitError):
                K.load_fx_manifest(root)

    def test_absent_manifest_means_official_colors(self):
        with tempfile.TemporaryDirectory() as tmp:
            overrides, info = K.load_fx_manifest(Path(tmp))
            self.assertEqual(overrides, {})
            self.assertFalse(info["present"])


def _live_available() -> bool:
    try:
        return (ROOT / K.DESIGN_REL).is_file() and ReadOnlyCtx().pack.official_read(K.ABILITY, "common") is not None
    except Exception:                                       # noqa: BLE001
        return False


@unittest.skipUnless(_live_available(), "design / official baseline unavailable")
class DesignIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ctx = ReadOnlyCtx()
        cls.design = K.load_design(ROOT)

    def test_rows_derive_and_pass_legality(self):
        cache: dict = {}
        leader, _ = K.derive_rows(self.ctx, self.design["leader"], "leader_ability", "leader", cache)
        caps = set()
        for row in leader:
            self.assertEqual(K.row_problems("leader_ability", row), [])
            caps.update(L.required_client_capabilities("leader_ability", row))
        total = 0
        for slot, entries in self.design["abilities"].items():
            rows, _ = K.derive_rows(self.ctx, entries, "ability", slot, cache)
            total += len(rows)
            for row in rows:
                self.assertEqual(K.row_problems("ability", row), [])
                caps.update(L.required_client_capabilities("ability", row))
        self.assertEqual(total, 13)
        self.assertEqual(sorted(caps), ["kyubi-fever-ratio-v1"])

    def test_kit_parameters_track_both_design_levels(self):
        self.assertEqual(K.skill_param_drift(self.design), [])
        self.assertEqual(K.pf_param_drift(self.design), [])
        d1 = copy.deepcopy(self.design)                   # SLv1 档漂移也必须被拦（旧实现只核对 ＋档）
        [e for e in d1["skills"]["tree_plan_1"]["blocks"][10]["param_edits"] if "倍率" in e["param"]][0]["new"] = \
            [{"min": 0.66, "max": 0.66}]
        self.assertTrue(any(p.startswith("skill1.sword") for p in K.skill_param_drift(d1)))
        d2 = copy.deepcopy(self.design)
        d2["skills"]["tree_plan_1"]["blocks"][4]["param_edits"][0]["new"] = [4]
        self.assertTrue(any("heal_slayer" in p for p in K.skill_param_drift(d2)))
        d3 = copy.deepcopy(self.design)
        d3["pf_override"]["lv3"]["donor"]["locate"] = d3["pf_override"]["lv3"]["donor"]["locate"].replace("前 8 个", "前 7 个")
        self.assertTrue(any(p.startswith("pf lv3") for p in K.pf_param_drift(d3)))
        d4 = copy.deepcopy(self.design)
        d4["pf_override"]["lv1"]["donor"]["transform"] = [t for t in d4["pf_override"]["lv1"]["donor"]["transform"]
                                                          if "enablesBuffCountBonus" not in t]
        self.assertTrue(any("buff-count" in p for p in K.pf_param_drift(d4)))

    def test_edit_without_full_row_is_rejected(self):
        entries = copy.deepcopy(self.design["leader"][:1])
        entries[0]["edits"]["49"] = "150000"
        with self.assertRaises(K.KitError):
            K.derive_rows(self.ctx, entries, "leader_ability", "leader", {})

    @unittest.skipUnless((WORKSPACE / "evidence/effect-families.json").is_file(), "package not built")
    def test_trees_rebuild_equal_package(self):
        registry = json.loads((WORKSPACE / "evidence/effect-families.json").read_text(encoding="utf-8"))
        families = [registry[f"battle/effect/skill_unique/{K.CODE}/{sub}"] for sub in ("sword", "rain", "heal")]
        hashes = K.design_source_hashes(self.design)
        pkg = WORKSPACE / "package/roots/common"

        def package_tree(program):
            return wf_dsl.parse_dsl(zlib.decompress((pkg / wf_dsl.dsl_logical(program)).read_bytes(), -15))["tree"]

        for level in ("1", "2"):
            tree, _ = K.build_skill_tree(self.ctx, level, K.SKILL_PARAMS[level], families, hashes)
            self.assertEqual(K.dsl_gate_failures(K.dsl_gates(tree)), [])
            program = f"battle/action/skill/action/rare5/{K.CODE}${K.CODE}_{level}"
            self.assertEqual(tree, package_tree(program), level)
        donor = K._source_tree(self.ctx, f"{K.SKILL_SRC}wind_oracle_1anv$wind_oracle_1anv_2",
                               hashes[f"{K.SKILL_SRC}wind_oracle_1anv$wind_oracle_1anv_2"])
        for level in (1, 2, 3):
            tree, _ = K.build_pf_tree(self.ctx, level, donor, families)
            self.assertEqual(K.dsl_gate_failures(K.dsl_gates(tree)), [])
            self.assertEqual(tree, package_tree(K.PF_PROGRAMS[level - 1]), level)
            attacks = K.cmds(tree, "CreateNormalAttack")
            swords = [c for c in attacks if c[1] >= K.PF_SUBJECT_OFFSET]
            self.assertEqual(len(swords), K.PF_PARAMS[level][0])
            self.assertTrue(all(c[10] is False for c in swords))


@unittest.skipUnless((WORKSPACE / "evidence/pixel-report.json").is_file()
                     and (ROOT / K.PIXEL_DIR_REL / "report.json").is_file(), "pixel not integrated")
class MediaIntegration(unittest.TestCase):
    """Integrate 阶段只读用例：像素 / 语音已装包的核对函数在真实包上为绿，篡改输入（进程内）必须变红。"""

    @classmethod
    def setUpClass(cls):
        import wf_seasonal7_build as B
        import wf_seasonal7_specs as S
        cls.pack = C.S7Pack(S.get_spec(K.KEY))
        cls.ctx = B.KitContext(cls.pack)

    def test_pixel_green_then_red_on_tamper(self):
        if K.pixel_inputs(self.ctx.root)[1]:
            self.skipTest("pixel inputs pending")
        self.assertEqual(K.pixel_problems(self.ctx), [])
        orig_inputs, orig_prefix = K.pixel_inputs, K._pixel_prefix
        try:
            def native_sheet(root):
                pngs, probs = orig_inputs(root)
                return dict(pngs, sprite_sheet=WORKSPACE / "evidence/native-sprite_sheet.png"), probs
            K.pixel_inputs = native_sheet
            self.assertTrue(any("store form" in p for p in K.pixel_problems(self.ctx)))
            K.pixel_inputs = orig_inputs
            K._pixel_prefix = lambda spec: {}
            self.assertTrue(any("donor metadata" in p for p in K.pixel_problems(self.ctx)))
        finally:
            K.pixel_inputs, K._pixel_prefix = orig_inputs, orig_prefix

    def test_voice_state_green_then_red_on_slot_drift(self):
        import wf_seasonal7_voice as V
        state = K.voice_state(self.ctx)
        if not state["packed"]:
            self.skipTest("voice not packed")
        slots = V.SLOTS
        try:
            V.SLOTS = (*slots, "battle/skill_9")
            self.assertEqual(K.voice_state(self.ctx)["missing_slots"], ["battle/skill_9"])
            V.SLOTS = tuple(s for s in slots if s != "battle/win_1")
            self.assertEqual(K.voice_state(self.ctx)["extra_voice_files"], ["battle/win_1"])
        finally:
            V.SLOTS = slots


if __name__ == "__main__":
    unittest.main()
