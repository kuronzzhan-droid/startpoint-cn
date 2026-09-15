# -*- coding: utf-8 -*-
"""wf_seasonal7_kit_yuki：门禁函数的负向用例（变异必须变红）+ 配方锁 + 语音列约定。

包内 DSL 用例需要先跑过 ``--step kit``；包不存在时跳过（不读写 live）。
"""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import wf_seasonal7_kit_yuki as K  # noqa: E402

ROOT = HERE.parent.parent
PKG_DSL = (ROOT / "work/character_packs/s7-yuki/package/roots/common/battle/action/skill/action/rare5"
           / "psychic_yuki_swim$psychic_yuki_swim_2.action.dsl.amf3.deflate")


def _package_tree():
    import wf_seasonal7_common as C
    return C.amf_parse(PKG_DSL.read_bytes())


class PureGateTests(unittest.TestCase):
    def test_route_is_voice_tool_canonical(self):
        import wf_seasonal7_voice as V
        self.assertEqual(V.normalize_route({"kind": 3}, K.CODE), K.VOICE_ROUTE)

    def test_row_sha_matches_csv_text(self):
        row = ["a", "b,c", ""]
        self.assertEqual(K.row_sha(row), K.row_sha(list(row)))
        self.assertNotEqual(K.row_sha(row), K.row_sha(["a", "b", "c"]))

    def test_recipe_locks_are_unique_and_complete(self):
        shas = [r[4] for r in K.LEADER_RECIPE] + [r[4] for rs in K.ABILITY_RECIPE.values() for r in rs]
        self.assertEqual(len(shas), 19)
        self.assertEqual(len(set(shas)), 19)
        self.assertEqual(sum(len(v) for v in K.ABILITY_RECIPE.values()), 13)
        self.assertEqual(len(K.LEADER_RECIPE), 6)

    def test_template_provenance_rejects_live_fallback(self):
        class _Pack:
            def __init__(self, sources):
                self._s = sources

            def read_evidence(self, name, default=None):
                return self._s

        class _Ctx:
            def __init__(self, sources):
                self.pack = _Pack(sources)

        programs = [f"{K.RARE5}/{p}.action.dsl.amf3.deflate" for p in (
            "psychic_yuki_ny23$psychic_yuki_ny23_1", "psychic_yuki_ny23$psychic_yuki_ny23_2",
            "psychic_yuki$psychic_yuki_1", "psychic_yuki$psychic_yuki_2",
            "psychic_projection_smr23$psychic_projection_smr23_2",
            "sing_android_2halfanv$sing_android_2halfanv_1", "sing_android_2halfanv$sing_android_2halfanv_2")]
        good = {p: {"source": "official"} for p in programs}
        self.assertEqual(K.template_provenance_problems(_Ctx(good)), [])
        bad = dict(good)
        bad[programs[0]] = {"source": "live"}
        self.assertEqual(len(K.template_provenance_problems(_Ctx(bad))), 1)
        missing = dict(good)
        del missing[programs[-1]]
        self.assertEqual(len(K.template_provenance_problems(_Ctx(missing))), 1)

    def test_fx_manifest_forbids_fallback_mix(self):
        log = [{"sheet": "a.png", "dst_sheet": "x/x.png", "mode": "kit-fallback"},
               {"sheet": "b.png", "dst_sheet": "y/y.png", "mode": "kit-fallback"}]
        self.assertEqual(K.fx_recolor_problems(None, {}, None, log), [])      # 无 manifest：回退合法
        probs = K.fx_recolor_problems(None, {}, "manifest.json", log)
        self.assertEqual(len(probs), 2)
        self.assertTrue(all("kit-fallback" in p for p in probs))

    def test_donothing_branch_flagged(self):
        tree = ["ActionDsl", 2, ["None"], False, False, False, False, False, False, False, 0,
                ["Block", [["Command", ["ConditionalsChangeSkillFlag", 1, ["Block", []], ["DoNothing"]]]]]]
        self.assertTrue(K.donothing_branch_problems(tree))
        tree[11][1][0][1][3] = ["Block", []]
        self.assertEqual(K.donothing_branch_problems(tree), [])


@unittest.skipUnless(PKG_DSL.is_file(), "yuki package DSL not built")
class PackageTreeMutationTests(unittest.TestCase):
    """包内定稿树为绿；每个变异都必须被对应门禁杀死。"""

    @classmethod
    def setUpClass(cls):
        cls.tree = _package_tree()

    def _scope(self, tree):
        return K.scope_problems(tree)

    def test_baseline_green(self):
        self.assertEqual(self._scope(self.tree), [])
        self.assertEqual(K.acskilldamage_gid_problems(self.tree)[0], [])
        self.assertEqual(K.donothing_branch_problems(self.tree), [])
        self.assertEqual(K.arity_problems(self.tree), [])

    def test_hit_area_p1_unbound_killed(self):
        t = copy.deepcopy(self.tree)
        next(c for c in K.walk_cmds(t) if c[0] == "CreateHitArea")[2] = 77
        self.assertTrue(any("CreateHitArea" in p for p in self._scope(t)))

    def test_gh_coordinate_unbound_killed(self):
        t = copy.deepcopy(self.tree)
        next(c for c in K.walk_cmds(t) if c[0] == "StopBall")[4] = ["GH", 55]
        self.assertTrue(any("GH" in p for p in self._scope(t)))

    def test_show_effect_subject_unbound_killed(self):
        t = copy.deepcopy(self.tree)
        next(c for c in K.walk_cmds(t) if c[0] == "ShowEffect" and c[3] == 1)[3] = 66
        self.assertTrue(any("ShowEffect" in p for p in self._scope(t)))

    def test_target_mate_removal_killed(self):
        t = copy.deepcopy(self.tree)
        root = t[11][1]
        del root[next(i for i, n in enumerate(root) if K.cmd(n) and K.cmd(n)[0] == "TargetMate")]
        self.assertTrue(self._scope(t))

    def test_equal_skill_damage_gid_killed(self):
        t = copy.deepcopy(self.tree)
        cc = next(c for c in K.walk_cmds(t) if c[0] == "CreateCondition" and c[1] == 12)
        cc[2][0][2] = [{"min": 0.85, "max": 1}]           # 与 113 非水块完全相同 → 同 gid 覆盖
        self.assertTrue(K.acskilldamage_gid_problems(t)[0])

    def test_scalar_into_slv_param_killed(self):
        t = copy.deepcopy(self.tree)
        next(c for c in K.walk_cmds(t) if c[0] == "AddCombo")[1] = 12
        self.assertTrue(K.arity_problems(t))


if __name__ == "__main__":
    unittest.main()


def _png(size=(8, 6), opaque_rect=(0, 0, 4, 3)):
    import io
    from PIL import Image
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    x0, y0, x1, y1 = opaque_rect
    for y in range(y0, y1):
        for x in range(x0, x1):
            img.putpixel((x, y), (40, 120, 220, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class PngStorageMagicTests(unittest.TestCase):
    """审查 minor：像素产物标准魔数 PNG 直接拷进包 = 大写魔数；转码器与包级门禁必须拦住。"""

    def test_standard_magic_is_transcoded_without_touching_pixels(self):
        raw = _png()
        self.assertEqual(raw[:8], K.STD_PNG_MAGIC)
        native = K.wf_assets.png_encode(_png(opaque_rect=(1, 1, 2, 2)))
        out, info = K.pixel_sheet_store_bytes(raw, native, [(0, 0, 4, 3), (4, 3, 4, 3)])
        self.assertEqual(out[:8], K.WF_PNG_MAGIC)
        self.assertEqual(out[8:], raw[8:])
        self.assertEqual(info["magic_in"], "standard")
        self.assertEqual(info["size"], [8, 6])
        again, info2 = K.pixel_sheet_store_bytes(out, native)
        self.assertEqual(again, out)
        self.assertEqual(info2["magic_in"], "wf-storage")

    def test_size_atlas_alpha_and_magic_mutations_rejected(self):
        raw, native = _png(), K.wf_assets.png_encode(_png())
        with self.assertRaisesRegex(ValueError, "size"):
            K.pixel_sheet_store_bytes(_png(size=(9, 6), opaque_rect=(0, 0, 4, 3)), native)
        with self.assertRaisesRegex(ValueError, "atlas rects"):
            K.pixel_sheet_store_bytes(raw, native, [(5, 0, 4, 3)])      # x+w=9 > 8
        with self.assertRaisesRegex(ValueError, "alpha==0"):
            K.pixel_sheet_store_bytes(_png(opaque_rect=(0, 0, 8, 6)), native)
        with self.assertRaisesRegex(ValueError, "not a PNG"):
            K.pixel_sheet_store_bytes(b"GIF89a" + raw[6:], native)

    def test_package_scan_flags_standard_magic(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            pkg = Path(tmp)
            good = pkg / "roots/common" / K.PIXEL_DIR / "special_sprite_sheet.png"
            bad = pkg / "roots/common" / K.PIXEL_DIR / "sprite_sheet.png"
            medium = pkg / "roots/medium/character/x/ui/icon.PNG"
            server = pkg / "roots/server/ignored.png"
            for path, data in ((good, K.wf_assets.png_encode(_png())), (bad, _png()),
                               (medium, _png()), (server, _png())):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            problems, checked = K.package_png_storage_problems(pkg)
            self.assertEqual(checked, 3)                                  # server 根不在客户端根内
            self.assertEqual(len(problems), 2)
            self.assertTrue(any("sprite_sheet.png has standard PNG magic" in p for p in problems))
            self.assertTrue(any(p.startswith("medium:") for p in problems))
            bad.write_bytes(K.wf_assets.png_encode(_png()))
            medium.write_bytes(K.wf_assets.png_encode(_png()))
            self.assertEqual(K.package_png_storage_problems(pkg), ([], 3))
