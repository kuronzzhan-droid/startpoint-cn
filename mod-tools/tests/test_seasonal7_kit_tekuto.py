# -*- coding: utf-8 -*-
"""特克托 kit 的离线单元测试（不写包、不读 live store 大表）。

python -m unittest mod-tools/tests/test_seasonal7_kit_tekuto.py
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import wf_assets  # noqa: E402
import wf_seasonal7_common as C  # noqa: E402
import wf_seasonal7_kit_tekuto as K  # noqa: E402
import wf_seasonal7_specs as S  # noqa: E402

ROOT = TOOLS.parent
DESIGN = ROOT / K.DESIGN_REL


def fake_families():
    """与 clone_effect_family 返回形状一致（只含 rewrite_effect_refs 需要的键）。"""
    out = []
    for src_dir, sub, fx in K.FAMILIES:
        donor = src_dir.rsplit("/", 1)[-1]
        out.append({"src_dir": src_dir, "dst_dir": f"battle/effect/skill_unique/{K.CODE}/{sub}",
                    "donor": donor, "dst_name": sub, "copied_bases": sorted(fx)})
    return out


def png_bytes(size, color, store=True):
    from PIL import Image
    img = Image.new("RGBA", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw = buf.getvalue()
    return wf_assets.png_encode(raw) if store else raw


@unittest.skipUnless(DESIGN.is_file(), "design json not present")
class TreeAssemblyTest(unittest.TestCase):
    def setUp(self):
        self.design = json.loads(DESIGN.read_text(encoding="utf-8"))

    def test_donor_tree_rewrites_to_design_composed_tree(self):
        for lv in ("1", "2"):
            tree = K.donor_tree(lv)
            for fam in fake_families():
                tree, _info = C.rewrite_effect_refs(tree, fam)
            composed, fixes = K.design_composed_tree(self.design, lv)
            self.assertEqual(K.strict_diff(tree, composed), [])
            self.assertEqual(K.dsl_quick_problems(tree), [])
            self.assertEqual(K.cooldown_width_problems(tree), [])
            self.assertEqual([f["id"] for f in fixes], [f["id"] for f in K.DESIGN_TREE_FIXES])

    def test_design_tree_fix_states(self):
        raw = self.design["skills"]["tree_plan_2"]["composed_tree"]
        node = K._command_nodes(raw, "ShowEffect", "cannon_cooldown")
        self.assertEqual(len(node), 1)
        # 原设计值 3.8 → applied；已同步 7.6 → already-in-design；其他值 → 报错
        fixed, rep = K.apply_design_tree_fixes(raw)
        self.assertIn(rep[0]["state"], ("applied", "already-in-design"))
        self.assertEqual(K._command_nodes(fixed, "ShowEffect", "cannon_cooldown")[0][12],
                         ["Some", [{"min": 7.6, "max": 7.6}]])
        synced = K.apply_design_tree_fixes(fixed)[1]
        self.assertEqual(synced[0]["state"], "already-in-design")
        other = K._command_nodes(fixed, "ShowEffect", "cannon_cooldown")[0]
        other[12] = ["Some", [{"min": 5, "max": 5}]]
        with self.assertRaises(K.KitError):
            K.apply_design_tree_fixes(fixed)

    def test_amf_roundtrip(self):
        tree = K.donor_tree("2")
        self.assertEqual(C.amf_parse(C.amf_bytes(tree)), tree)

    def test_texts_match_design(self):
        row = self.design["text"]["character_text_row"]
        self.assertEqual(K.TEXTS["profile"], row[2])
        self.assertEqual((K.TEXTS["skill1"], K.TEXTS["desc1"]), (row[4], row[5]))
        self.assertEqual((K.TEXTS["skill2"], K.TEXTS["desc2"]), (row[6], row[7]))
        self.assertEqual(K.TEXTS["cv"], row[11])

    def test_spec_merge_extra_keys(self):
        spec = S.get_spec("tekuto")
        self.assertEqual(spec.extra_keys[K.CAS], (K.CHANGE_SKILL_KEY,))
        self.assertEqual(spec.extra_keys[K.SWITCHED], (K.VOICE_READY_KEY,))
        self.assertEqual(spec.required_capabilities, ())


class PureHelpersTest(unittest.TestCase):
    def test_strict_diff_types(self):
        self.assertTrue(K.strict_diff([1], [1.0]))
        self.assertTrue(K.strict_diff([True], [1]))
        self.assertEqual(K.strict_diff({"a": [1.5]}, {"a": [1.5]}), [])

    def test_cooldown_width_pairing(self):
        tree = K.donor_tree("2")
        self.assertEqual(K.cooldown_width_problems(tree), [])
        node = K._command_nodes(tree, "ShowEffect", "cannon_cooldown")[0]
        self.assertEqual(node[12], ["Some", [{"min": 7.6, "max": 7.6}]])
        node[12] = ["Some", [{"min": 3.8, "max": 3.8}]]           # 设计原值：≈380px，只有 LLL 一半
        self.assertTrue(K.cooldown_width_problems(tree))

    def test_donothing_detected(self):
        tree = K.donor_tree("1")
        body = tree[11][1][2][1][6][1][0][1][11][1]
        csf = next(x for x in body if x[0] == "Command" and x[1][0] == "ConditionalsChangeSkillFlag")
        csf[1][3] = ["DoNothing"]
        self.assertTrue(K.donothing_problems(tree))

    def test_fx_manifest_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            mapping, info = K.load_fx_manifest(Path(tmp))
            self.assertEqual(mapping, {})
            self.assertFalse(info["present"])

    def _write_manifest(self, tmp: Path, payload) -> Path:
        path = tmp / K.FX_MANIFEST_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_fx_manifest_forms(self):
        sheet = f"{K.CANNON_SRC}/super_robot.png"
        laser_dir = K.laser_src("l")
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            path = self._write_manifest(tmp, {"sheets": {sheet: "cannon.png", laser_dir: {"png": "l.png"}}})
            (path.parent / "cannon.png").write_bytes(png_bytes((4, 4), (1, 2, 3, 255)))
            (path.parent / "l.png").write_bytes(png_bytes((4, 4), (1, 2, 3, 255), store=False))
            mapping, info = K.load_fx_manifest(tmp)
            self.assertEqual(set(mapping), {sheet, f"{laser_dir}/enemy_shot_laser_l_yellow.png"})
            path.write_text(json.dumps([{"source": sheet, "file": "cannon.png"}]), encoding="utf-8")
            mapping, _ = K.load_fx_manifest(tmp)
            self.assertEqual(set(mapping), {sheet})

    def test_fx_manifest_rejects_unknown_and_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            self._write_manifest(tmp, {"battle/effect/skill_unique/other/other.png": "x.png"})
            with self.assertRaises(K.KitError):
                K.load_fx_manifest(tmp)
            self._write_manifest(tmp, {f"{K.CANNON_SRC}/super_robot.png": "missing.png"})
            with self.assertRaises(K.KitError):
                K.load_fx_manifest(tmp)

    def test_pixel_review_verdict_reads_fix_round_only(self):
        head = "# R\n\n## 2. 初审\n\n| tekuto 特克托 | 12/12 过 | **PASS** | 无 |\n\n"
        fix = "## 5. 修复轮复核（x）\n\n| 角色 | a | b | c | 最终判定 |\n|---|---|---|---|---|\n"
        self.assertFalse(K.pixel_review_verdict(head)[0])                     # 只有初审段 → 不算
        self.assertTrue(K.pixel_review_verdict(head + fix + "| tekuto 特克托 | 未改 | 12/12 过 | 无声明 | **PASS** |\n")[0])
        self.assertFalse(K.pixel_review_verdict(head + fix + "| tekuto 特克托 | 未改 | 11/12 | 无 | **FAIL** |\n")[0])
        self.assertFalse(K.pixel_review_verdict(head + fix + "| zehr 泽赫尔 | 改 | 12/12 过 | 无 | **PASS** |\n")[0])
        # 修复轮段之后的新 ## 段里的 PASS 不算
        self.assertFalse(K.pixel_review_verdict(head + fix + "\n## 6. 其他\n| tekuto | **PASS** |\n")[0])

    def test_pixel_sheet_problems(self):
        import numpy as np
        tpl = np.zeros((4, 3, 4), dtype=np.uint8)
        tpl[1, 1] = (10, 20, 30, 255)
        tpl[0, 0] = (5, 5, 5, 0)                                                # 透明但 RGB 非零
        dyed = tpl.copy()
        dyed[1, 1, :3] = (200, 100, 0)
        self.assertEqual(K.pixel_sheet_problems(dyed, tpl), [])
        bad = dyed.copy(); bad[1, 1, 3] = 128
        self.assertTrue(K.pixel_sheet_problems(bad, tpl))                    # alpha 变了
        bad = dyed.copy(); bad[0, 0, :3] = 0
        self.assertTrue(K.pixel_sheet_problems(bad, tpl))                    # 透明像素 RGB 变了
        self.assertTrue(K.pixel_sheet_problems(dyed[:3], tpl))               # 尺寸

    def test_atlas_bounds(self):
        atlas = [{"n": "a", "x": 0, "y": 0, "w": 10, "h": 5}, {"n": "b", "x": 5, "y": 5, "w": 5, "h": 5, "r": True}]
        self.assertEqual(K.atlas_bounds_problems(atlas, (10, 10)), [])
        self.assertTrue(K.atlas_bounds_problems(atlas, (9, 10)))

    def test_png_transform_size_and_stats(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            dyed = Path(tmp) / "d.png"
            dyed.write_bytes(png_bytes((4, 4), (255, 214, 40, 255)))
            stats = {}
            fn = K.make_png_transform("x.png", dyed, stats)
            out = fn(Image.new("RGBA", (4, 4), (0, 0, 0, 255)))
            self.assertEqual(out.getpixel((0, 0)), (255, 214, 40, 255))
            self.assertIsNone(stats["x.png"]["alpha_changed_bbox"])
            with self.assertRaises(K.KitError):
                fn(Image.new("RGBA", (5, 4), (0, 0, 0, 255)))


if __name__ == "__main__":
    unittest.main()
