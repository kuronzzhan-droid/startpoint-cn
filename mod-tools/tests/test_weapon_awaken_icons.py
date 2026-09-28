# -*- coding: utf-8 -*-
"""武器觉醒与新掉落：官方风格材料图标（mod-tools/assets/weapon-awaken/build_icons.py）回归。

固化设计稿 §6.5 的自动门禁：20×20、alpha 只有 0/255、包围盒达稀有度下限、描边是主色压暗、
色数 ≤17、孤立杂色 ≤0.10、c4 = c3 ×2 最近邻；五重交接件 ticket_icon_41 = 40×40 贴 (0,1)。
本文件不读 store；只核对源码里的像素格、仓库里的 PNG 与 manifest.json 三者一致。

负向对照：每条门禁配一条「把图弄坏必须变红」的用例，证明门禁在测东西。
两套门禁一致性：交付件必须同时过构建器 wf_weapon_awaken.icon_problems 的全部非彩虹门禁，描边阈值逐项相同，
负向样本两边都报红（否则图能过 build_icons --check、到 E1 才被构建器拒掉）。
"""
from __future__ import annotations

import dataclasses
import importlib.util
import json
import sys
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "mod-tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))
BUILDER_PATH = ROOT / "mod-tools/assets/weapon-awaken/build_icons.py"
SPEC = importlib.util.spec_from_file_location("weapon_awaken_icons", BUILDER_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - importlib guard
    raise ImportError(f"cannot load icon builder: {BUILDER_PATH}")
B = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = B
SPEC.loader.exec_module(B)

EXPECTED = {
    # 道具 ID → (key, 稀有度, c3, c4)；设计稿 §5.2 / §6.4
    "10000310": ("king_coin", 4, "item/materials/mod/five_boss/king_coin", "item_icon/materials/mod/five_boss/king_coin"),
    "10000311": ("forbidden_star_steel", 5, "item/materials/mod/cursed/forbidden_star_steel",
                 "item_icon/materials/mod/cursed/forbidden_star_steel"),
    "10000144": ("deathbringer_blueprint_v2", 3, "item/materials/mod/five_boss/deathbringer_blueprint_v2",
                 "item_icon/materials/mod/five_boss/deathbringer_blueprint_v2"),
    "10000145": ("deep_crystal_v2", 4, "item/materials/mod/five_boss/deep_crystal_v2",
                 "item_icon/materials/mod/five_boss/deep_crystal_v2"),
    "10000146": ("fivefold_clear_badge_v2", 3, "item/materials/mod/five_boss/fivefold_clear_badge_v2",
                 "item_icon/materials/mod/five_boss/fivefold_clear_badge_v2"),
    "10000147": ("five_king_core_v2", 5, "item/materials/mod/five_boss/five_king_core_v2",
                 "item_icon/materials/mod/five_boss/five_king_core_v2"),
    "10000143": ("deep_realm_ticket", 5, "item/materials/mod/five_boss/deep_realm_ticket",
                 "item_icon/materials/mod/five_boss/deep_realm_ticket"),
    "10000301": ("contradiction_crystal", 4, "item/materials/mod/paradox/contradiction_crystal_v2",
                 "item_icon/materials/mod/paradox/contradiction_crystal"),
    "10000302": ("paradox_core", 5, "item/materials/mod/paradox/paradox_core_v2",
                 "item_icon/materials/mod/paradox/paradox_core"),
}


def icon(key: str) -> dict:
    return next(i for i in B.ICONS if i["key"] == key)


def rendered(key: str) -> Image.Image:
    return B.render(icon(key))


def recolor(key: str, char: str, rgb: tuple) -> Image.Image:
    """把调色板里一个字符的全部像素换成 rgb（用来造坏描边）。"""
    c3 = rendered(key)
    px = c3.load()
    old = tuple(icon(key)["palette"][char]) + (255,)
    for y in range(20):
        for x in range(20):
            if px[x, y] == old:
                px[x, y] = tuple(rgb) + (255,)
    return c3


#: 描边负向样本：(说明, 道具 key, 描边字符, 换成的颜色)。旧 PARADOX 的 (24,24,42) 明度 0.16，设计 §6.2 口径是
#: 「压暗到约 25–45% 明度，不是纯黑」；(20,14,40) 是更暗的近黑紫；暗绿描边套在靛紫晶上是色相不符。
BAD_OUTLINES = (
    ("old PARADOX near-black", "deep_crystal_v2", "k", (24, 24, 42)),
    ("darker near-black violet", "deep_crystal_v2", "k", (20, 14, 40)),
    ("pure black", "deep_crystal_v2", "k", (0, 0, 0)),
    ("off-hue dark green", "deep_crystal_v2", "k", (20, 90, 40)),
    ("near-black on paradox_core", "paradox_core", "K", (24, 24, 42)),
)


class IconSpecTest(unittest.TestCase):
    def test_catalogue_matches_design(self):
        got = {i["item_id"]: (i["key"], i["rarity"], i["c3"], i["c4"]) for i in B.ICONS}
        self.assertEqual(got, EXPECTED)

    def test_every_icon_passes_gate(self):
        for i in B.ICONS:
            with self.subTest(i["key"]):
                c3 = B.render(i)
                self.assertEqual(B.gate(i, c3, B.to_c4(c3)), [])

    def test_hard_alpha_and_size(self):
        for i in B.ICONS:
            with self.subTest(i["key"]):
                m = B.metrics(B.render(i))
                self.assertEqual(m["size"], [20, 20])
                self.assertLessEqual(set(m["alphas"]), {0, 255})

    def test_render_is_deterministic(self):
        for i in B.ICONS:
            with self.subTest(i["key"]):
                self.assertEqual(B.render(i).tobytes(), B.render(i).tobytes())
        self.assertEqual(json.dumps(B.manifest()), json.dumps(B.manifest()))

    def test_repo_files_match_source(self):
        self.assertEqual(B.check(), [])

    def test_c4_files_are_c3_doubled(self):
        for i in B.ICONS:
            if i["key"] == B.TICKET_KEY:
                continue
            with self.subTest(i["key"]):
                c3 = Image.open(B.ICON_DIR / f"{i['key']}.png").convert("RGBA")
                c4 = Image.open(B.ICON_DIR / f"{i['key']}_c4.png").convert("RGBA")
                self.assertEqual(c4.size, (40, 40))
                self.assertEqual(c4.tobytes(), c3.resize((40, 40), Image.NEAREST).tobytes())

    def test_ticket_handoff_shapes(self):
        t20 = Image.open(B.HANDOFF_DIR / "ticket_icon_20.png").convert("RGBA")
        t41 = Image.open(B.HANDOFF_DIR / "ticket_icon_41.png").convert("RGBA")
        self.assertEqual(t20.size, (20, 20))
        self.assertEqual(t41.size, (41, 41))   # live 子纹理 41×41，尺寸不同五重 plan_item_icons 会拒绝
        self.assertEqual(t41.crop((0, 1, 40, 41)).tobytes(), t20.resize((40, 40), Image.NEAREST).tobytes())
        top_row = [t41.getpixel((x, 0))[3] for x in range(41)]
        right_col = [t41.getpixel((40, y))[3] for y in range(41)]
        self.assertEqual(set(top_row) | set(right_col), {0})

    def test_manifest_records_files(self):
        m = json.loads(B.MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual({e["item_id"] for e in m["icons"]}, set(EXPECTED))
        for e in m["icons"]:
            with self.subTest(e["key"]):
                self.assertTrue((B.HERE / e["c3_file"]).exists())
                self.assertTrue((B.HERE / e["c4_file"]).exists())

    def test_ticket_is_not_a_horizontal_ticket(self):
        """凭证与同店的武器扭蛋券 ticket_equipment_001/002（横票，★5 同底框）必须撞不了形：徽记轮廓近方、四角透明。"""
        c3 = rendered(B.TICKET_KEY)
        px = c3.load()
        main = B._main_component({(x, y) for y in range(20) for x in range(20) if px[x, y][3]})
        w = max(p[0] for p in main) - min(p[0] for p in main) + 1
        h = max(p[1] for p in main) - min(p[1] for p in main) + 1
        self.assertGreaterEqual(h / w, 0.9, (w, h))
        self.assertEqual({px[xy][3] for xy in ((0, 0), (19, 0), (0, 19), (19, 19))}, {0})
        self.assertIn("extreme_multi_battle_token", icon(B.TICKET_KEY)["mother"])

    def test_builder_writes_only_its_own_directory(self):
        for rel in B.outputs():
            self.assertFalse(Path(rel).is_absolute())
            self.assertTrue(rel.startswith("icons/"), rel)
            self.assertNotIn("..", rel)


class GateNegativeControlTest(unittest.TestCase):
    """把合格图弄坏，门禁必须报错。"""

    def gate_of(self, key: str, c3: Image.Image, c4: Image.Image | None = None) -> list[str]:
        return B.gate(icon(key), c3, B.to_c4(c3) if c4 is None else c4)

    def test_semi_transparent_pixel_fails(self):
        c3 = rendered("king_coin")
        r, g, b, _ = c3.getpixel((10, 10))
        c3.putpixel((10, 10), (r, g, b, 128))
        self.assertTrue(any(p.startswith("alpha") for p in self.gate_of("king_coin", c3)))

    def test_pure_black_outline_fails(self):
        c3 = rendered("deep_crystal_v2")
        px = c3.load()
        outline = tuple(icon("deep_crystal_v2")["palette"]["k"]) + (255,)
        for y in range(20):
            for x in range(20):
                if px[x, y] == outline:
                    px[x, y] = (0, 0, 0, 255)
        self.assertTrue(any(p.startswith("outline") for p in self.gate_of("deep_crystal_v2", c3)))

    def test_near_black_and_off_hue_outlines_fail(self):
        for label, key, char, rgb in BAD_OUTLINES:
            with self.subTest(label):
                self.assertTrue(any(p.startswith("outline") for p in self.gate_of(key, recolor(key, char, rgb))))

    def test_speckle_noise_fails(self):
        c3 = rendered("forbidden_star_steel")
        px = c3.load()
        for y in range(6, 16):
            for x in range(3 + y % 2, 17, 2):
                if px[x, y][3]:
                    px[x, y] = (0, 255, 0, 255)
        self.assertTrue(any(p.startswith("speckle") for p in self.gate_of("forbidden_star_steel", c3)))

    def test_too_many_colours_fails(self):
        c3 = rendered("deep_crystal_v2")
        px = c3.load()
        n = 0
        for y in range(20):
            for x in range(20):
                if px[x, y][3] and n < 30:
                    r, g, b, a = px[x, y]
                    px[x, y] = ((r + n) % 256, g, b, a)
                    n += 1
        self.assertTrue(any(p.startswith("colors") for p in self.gate_of("deep_crystal_v2", c3)))

    def test_small_bbox_fails(self):
        c3 = rendered("five_king_core_v2").resize((10, 10), Image.NEAREST)
        canvas = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
        canvas.paste(c3, (5, 5))
        self.assertTrue(any(p.startswith("bbox") for p in self.gate_of("five_king_core_v2", canvas)))

    def test_c4_mismatch_fails(self):
        c3 = rendered("paradox_core")
        wrong = c3.resize((40, 40), Image.BILINEAR)
        self.assertIn("c4 != c3 x2 nearest", self.gate_of("paradox_core", c3, wrong))

    def test_lower_right_light_fails(self):
        c3 = rendered("forbidden_star_steel").rotate(180)
        self.assertTrue(any(p.startswith("light") for p in self.gate_of("forbidden_star_steel", c3)))

    def test_unknown_palette_char_rejected(self):
        bad = dict(icon("king_coin"))
        bad["grid"] = ("?" + bad["grid"][0][1:],) + tuple(bad["grid"][1:])
        with self.assertRaises(ValueError):
            B.render(bad)


class BuilderGateAgreementTest(unittest.TestCase):
    """图标单元门禁与构建器 wf_weapon_awaken.icon_problems 一致：阈值相同、交付件两边都过、坏样本两边都红。"""

    @classmethod
    def setUpClass(cls):
        import wf_weapon_awaken as W
        cls.W = W

    def strict(self, i: dict):
        """构建器里的同一件、强制按非彩虹件跑（交付件没有彩虹配色，全部非彩虹门禁都要过）。"""
        W = self.W
        found = W.ICON_BY_ITEM.get(i["item_id"])
        if found is None:       # 凭证归五重线，构建器不登记；按同样的合同造一件
            found = W.Icon(i["item_id"], i["key"], i["c3"], i["c4"], B.TOKEN_FLOOR, False)
        return dataclasses.replace(found, rainbow=False)

    def test_thresholds_match(self):
        W = self.W
        pairs = {
            "OUTLINE_MIN_CHANNEL": "OUTLINE_MIN_CHANNEL", "OUTLINE_SAT_MIN": "OUTLINE_SAT_MIN",
            "OUTLINE_VAL_RANGE": "OUTLINE_VAL_RANGE", "OUTLINE_HUE_TOL": "OUTLINE_HUE_TOL",
            "OUTLINE_HUE_SHARE_MIN": "OUTLINE_HUE_SHARE_MIN", "HUE_SAMPLE": "HUE_SAMPLE",
            "MAX_COLORS": "COLORS_MAX", "MAX_SPECKLE": "SPECKLE_MAX", "MIN_OUTLINE_TOP2": "OUTLINE_TOP2_MIN",
        }
        for mine, theirs in pairs.items():
            with self.subTest(mine):
                self.assertEqual(getattr(B, mine), getattr(W, theirs))
        self.assertEqual((B.SIZE, B.SIZE), W.ICON_SIZE)

    def test_deliverables_pass_builder_non_rainbow_gates(self):
        for i in B.ICONS:
            with self.subTest(i["key"]):
                c3 = B.render(i)
                self.assertEqual(self.W.icon_problems(self.strict(i), self.W.icon_metrics(c3)), [])
                m, wm = B.metrics(c3), self.W.icon_metrics(c3)
                self.assertEqual((m["outline_sat"], m["outline_val"], m["outline_hue_share"], m["colors"], m["speckle"]),
                                 (wm["outline_sat"], wm["outline_val"], wm["outline_hue_share"], wm["colors"], wm["speckle"]))

    def test_bad_outlines_red_in_both(self):
        for label, key, char, rgb in BAD_OUTLINES:
            with self.subTest(label):
                c3 = recolor(key, char, rgb)
                self.assertTrue(B.gate(icon(key), c3, B.to_c4(c3)))
                self.assertTrue(self.W.icon_problems(self.strict(icon(key)), self.W.icon_metrics(c3)))


if __name__ == "__main__":
    unittest.main()
