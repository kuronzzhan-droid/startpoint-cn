# -*- coding: utf-8 -*-
"""wf_portrait_white_matte：只删与画面边缘连通的纯白背景，其余一律保留。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_portrait_white_matte as M  # noqa: E402


def canvas(size=120):
    return np.full((size, size, 3), 255, dtype=np.int32)


def scene():
    """白底上：一个带黑描边的白色物体（本体白）、一个封闭白洞、一个 9px 小孤岛、一条浅色特效。"""
    rgb = canvas()
    rgb[20:80, 20:80] = (30, 30, 30)          # 黑描边的方块
    rgb[24:76, 24:76] = (255, 255, 255)       # 方块内部是白的（＝角色身上的白）
    rgb[40:60, 40:60] = (200, 60, 60)         # 白里面再画个红块
    rgb[95:98, 95:98] = (90, 160, 90)         # 小孤岛（花瓣/叶子）
    rgb[100:104, 10:70] = (190, 240, 225)     # 浅色特效条（离白 65）
    return rgb


class BackgroundOnly(unittest.TestCase):
    def test_border_connected_white_is_removed_and_nothing_else(self):
        rgb = scene()
        rgba, background, _pockets = M.matte(rgb, aa_radius=0)
        alpha = rgba[:, :, 3]
        self.assertTrue(background[0, 0] and alpha[0, 0] == 0)
        self.assertTrue((alpha[20:80, 20:80] == 255).all())          # 描边与围住的白色本体全保留
        self.assertTrue((alpha[95:98, 95:98] == 255).all())          # 小孤岛不清理
        self.assertTrue((alpha[100:104, 10:70] == 255).all())        # 浅色特效不删
        self.assertTrue((rgba[24:40, 24:40, :3] == 255).all())       # 本体白色的颜色不动

    def test_enclosed_white_is_kept_by_default_and_listed(self):
        rgb = scene()
        _rgba, background, pockets = M.matte(rgb)
        self.assertFalse(background[30, 30])
        self.assertEqual(len(pockets), 1)
        self.assertFalse(pockets[0]["removed"])

    def test_seed_removes_exactly_that_pocket(self):
        rgb = scene()
        rgba, background, pockets = M.matte(rgb, remove_seeds=[[30, 30]], aa_radius=0)
        self.assertTrue(background[30, 30])
        self.assertTrue(pockets[0]["removed"])
        self.assertTrue((rgba[40:60, 40:60, 3] == 255).all())        # 洞里的红块仍在
        self.assertTrue((rgba[20:24, 20:80, 3] == 255).all())        # 描边仍在

    def test_seed_on_non_white_pixel_is_an_error(self):
        with self.assertRaises(M.MatteError):
            M.matte(scene(), remove_seeds=[[50, 50]])

    def test_non_white_content_has_no_deletion_path(self):
        rng = np.random.default_rng(7)
        rgb = canvas(96)
        rgb[10:86, 10:86] = rng.integers(0, 200, size=(76, 76, 3))   # 任意非白内容
        rgba, _bg, _p = M.matte(rgb, aa_radius=2)
        report = M.audit(rgb, rgba[:, :, 3].astype(np.int32))
        self.assertEqual(report["eaten_px"], 0)
        self.assertEqual(report["leftover_bg_px"], 0)


class AntiAlias(unittest.TestCase):
    def test_blended_edge_is_unmixed_and_interior_untouched(self):
        rgb = canvas(60)
        rgb[20:40, 20:40] = (40, 80, 160)
        rgb[19, 20:40] = (148, 168, 208)                              # 上边一行 = 50% 前景 + 50% 白
        rgba, _bg, _p = M.matte(rgb, aa_radius=2)
        edge_alpha = rgba[19, 25:35, 3]
        self.assertTrue(((edge_alpha > 110) & (edge_alpha < 150)).all(), edge_alpha)
        self.assertTrue((rgba[19, 25:35, :3] == (40, 80, 160)).all())  # 半透明边缘取纯前景色，不带白
        self.assertTrue((rgba[26:34, 26:34, 3] == 255).all())
        self.assertTrue((rgba[26:34, 26:34, :3] == (40, 80, 160)).all())

    def test_near_white_foreground_edge_stays_opaque(self):
        rgb = canvas(60)
        rgb[20:40, 20:40] = (250, 250, 246)                           # 近白的本体（白毛）直接挨着背景
        rgb[19:41, 19] = rgb[19:41, 40] = rgb[19, 19:41] = rgb[40, 19:41] = (240, 240, 236)
        rgba, _bg, _p = M.matte(rgb, core_tol=4, aa_radius=2)
        self.assertTrue((rgba[22:38, 22:38, 3] == 255).all())


class AuditCatchesTheOldFailure(unittest.TestCase):
    def test_deleted_effect_is_reported(self):
        rgb = scene()
        rgba, _bg, _p = M.matte(rgb, aa_radius=0)
        alpha = rgba[:, :, 3].astype(np.int32)
        alpha[100:104, 10:70] = 0                                     # 模拟第一轮把特效删了
        report = M.audit(rgb, alpha, aa_radius=0)
        self.assertGreater(report["eaten_px"], 100)


if __name__ == "__main__":
    unittest.main()
