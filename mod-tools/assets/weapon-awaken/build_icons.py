#!/usr/bin/env python
"""武器觉醒与新掉落：官方风格材料图标（设计稿 D:/WF/out/武器觉醒与新掉落-20260928/设计.md §6）。

每张 c3 缩略图是下面手摆的 20×20 像素格（字符 → 调色板），c4 小图标 = c3 ×2 最近邻（40×40）。
不读网络、不读 store、无随机数：同一份源码跑几次，输出像素逐字节相同（--check 回读核对）。

规范（§6.2，门禁在 gate() 里，测试 mod-tools/tests/test_weapon_awaken_icons.py 固化）：
  20×20 透明画布；alpha 只有 0/255；包围盒长边不小于稀有度下限（★3 14 / ★4 16 / ★5 19，代币与券 19）；
  主体外描边 = 物件主色压暗（不是纯黑）：最大通道 ≥40、饱和度 ≥0.4、明度 0.2–0.5，主体有彩像素至少 20% 落在
  描边色相 ±45° 内；前两种描边色占比 ≥ 0.9；色数 ≤ 17；孤立杂色 ≤ 0.10；左上受光；c4 恰好等于 c3 ×2 最近邻。
  描边各阈值与构建器 wf_weapon_awaken.py 的 icon_problems（非彩虹件）逐项相同，测试核对两边一致。

用法：
  python mod-tools/assets/weapon-awaken/build_icons.py            # 写 icons/ 与 manifest.json
  python mod-tools/assets/weapon-awaken/build_icons.py --check    # 只核对：像素与源码一致、门禁全过
只写本目录；不碰 store、.cdn、item_icon 图集与五重 / PARADOX 的源图（交接件放 icons/five-boss-v2-handoff/）。
"""
from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ICON_DIR = HERE / "icons"
HANDOFF_DIR = ICON_DIR / "five-boss-v2-handoff"
MANIFEST = HERE / "manifest.json"

SIZE = 20
C4_SCALE = 2
MAX_COLORS = 17
MAX_SPECKLE = 0.10
MIN_OUTLINE_TOP2 = 0.9
#: 描边 = 主色相压暗（§6.2「压暗到约 25–45% 明度，不是纯黑」）。与构建器 wf_weapon_awaken.py 同名常量逐项相同：
#: 旧悖论之核的 (24,24,42) 明度 0.16，必须在这里就报红，不能留到 E1 才被构建器拒掉。
OUTLINE_MIN_CHANNEL = 40            # 最大通道 < 40 = 近纯黑
OUTLINE_SAT_MIN = 0.4               # 要有彩度（灰描边不合格）
OUTLINE_VAL_RANGE = (0.2, 0.5)      # 明度
OUTLINE_HUE_TOL = 45                # 描边色相与主体有彩像素的色相差上限（度）
OUTLINE_HUE_SHARE_MIN = 0.2         # 主体有彩像素里落在描边色相 ±45° 内的占比下限
HUE_SAMPLE = (0.25, 0.2)            # 「有彩像素」：饱和度 ≥0.25 且明度 ≥0.2（高光白、暗部黑不算）
#: 包围盒长边下限（§6.2 表：★3 约 14–16，★4 约 16–18，★5 约 19–20；代币、券、凭证撑满到 19–20）
BBOX_FLOOR = {3: 14, 4: 16, 5: 19}
TOKEN_FLOOR = 19

# ---------------------------------------------------------------- icons
# 每项：key（输出文件名）、道具 ID、名、稀有度 c17、kind（token = 代币/券，包围盒按 19 算）、
# c3 / c4 逻辑路径（设计稿 §5.2 / §6.4）、母本、像素格、调色板。
ICONS: list[dict] = [
    dict(
        key="king_coin", item_id="10000310", name="深界王币", rarity=4, kind="token",
        c3="item/materials/mod/five_boss/king_coin", c4="item_icon/materials/mod/five_boss/king_coin",
        mother="领主币 item/materials/boss_coin/owl_3 的八角币形与环形倒角；币面换成五尖王冠（五王纹章）",
        grid=(
            '.....0000000000.....',
            '....0LLLLLLLLLL0....',
            '...0LggggggggggM0...',
            '..0LgffffffffffGM0..',
            '.0LgffffffffffffGM0.',
            '0LgffffffffffffffGD0',
            '0LgfaffffaaffffafGD0',
            '0LgfbffafbbfaffbsGD0',
            '0LgfbbfbbbbbbfbbsGD0',
            '0LgfabbbbbbbbbbcsGD0',
            '0LgfabbbbbbbbbbcsGD0',
            '0LgfccccccccccccsGD0',
            '0LgfbbrbbrrbbrbbsGD0',
            '0LgfccccccccccccsGD0',
            '0LgffssssssssssssGD0',
            '.0MgffffffffffffGD0.',
            '..0MGffffffffffGDM..',
            '...0MGGGGGGGGGGDMwM.',
            '....0DDDDDDDDDD0.M..',
            '.....0000000000.....',
        ),
        palette={'0': (36, 16, 84), 'D': (116, 76, 196), 'G': (150, 116, 226), 'L': (236, 222, 255),
                 'M': (182, 150, 238), 'a': (255, 248, 196), 'b': (255, 206, 72), 'c': (206, 128, 26),
                 'f': (98, 64, 176), 'g': (70, 42, 140), 'r': (236, 60, 110), 's': (58, 32, 118),
                 'w': (255, 255, 255)},
    ),
    dict(
        key="forbidden_star_steel", item_id="10000311", name="禁忌星铁", rarity=5, kind="material",
        c3="item/materials/mod/cursed/forbidden_star_steel", c4="item_icon/materials/mod/cursed/forbidden_star_steel",
        mother="★4 星铁钢 equipment_awaking_crystal_4 的锭形逐色映射（与 ★5 星铁钢同一轮廓 20×17），"
               "左侧面嵌金色星纹、右侧面一道绯红禁纹",
        grid=(
            '....................',
            '....................',
            '.......000..........',
            '.....0066600........',
            '...00666666600......',
            '..06666666666600....',
            '.05477777777777700..',
            '.054337777777777880.',
            '.054433388777788110.',
            '0544a43333888811c10.',
            '05bbbbb333336111c110',
            '054bbb4433336111cc10',
            '055b4b4443336111c120',
            '.0055444443361111c20',
            '...0054444436111c220',
            '.....00554436112200.',
            '.......0055461100...',
            '.........005500.....',
            '...........00.......',
            '....................',
        ),
        palette={'0': (44, 16, 60), '1': (70, 30, 96), '2': (96, 44, 120), '3': (104, 52, 140),
                 '4': (122, 66, 162), '5': (152, 98, 192), '6': (180, 130, 222), '7': (216, 180, 246),
                 '8': (255, 246, 255), 'a': (255, 250, 200), 'b': (255, 206, 72), 'c': (214, 36, 84)},
    ),
    dict(
        key="deathbringer_blueprint_v2", item_id="10000144", name="终式武装图纸", rarity=3, kind="material",
        c3="item/materials/mod/five_boss/deathbringer_blueprint_v2",
        c4="item_icon/materials/mod/five_boss/deathbringer_blueprint_v2",
        mother="支线解锁证书 side_story_event_quest_unlock_certificate 的上下卷轴错位结构；纸面换成蓝图与剑形线稿",
        grid=(
            '....................',
            '.....kkkkkkkkkkkk...',
            '....kwwwwwwwwwwwpk..',
            '....kppppppppppssk..',
            '...kddddddddddddk...',
            '...kcbbbbbbbbbbdk...',
            '...kcccccccccccdk...',
            '...kcbbbbbbbbwcdk...',
            '...kcbbbbbbbwwcdk...',
            '...kcbbbbbbwwbcdk...',
            '...kcbbwbbwwbbcdk...',
            '...kcbbbwwwbbbcdk...',
            '...kcbbbwwbbmmcdk...',
            '...kcbbwbbwbmmcdk...',
            '...kcccccccccccdk...',
            '..kwwwwwwwwwwwpkk...',
            '..kppppppppppssk....',
            '...kkkkkkkkkkkk.....',
            '....................',
            '....................',
        ),
        palette={'b': (46, 104, 204), 'c': (106, 162, 240), 'd': (30, 70, 160), 'k': (20, 36, 96),
                 'm': (214, 64, 150), 'p': (196, 214, 238), 's': (132, 156, 196), 'w': (250, 252, 255)},
    ),
    dict(
        key="deep_crystal_v2", item_id="10000145", name="深界结晶", rarity=4, kind="material",
        c3="item/materials/mod/five_boss/deep_crystal_v2", c4="item_icon/materials/mod/five_boss/deep_crystal_v2",
        mother="记忆晶 equipment_enhancement_material_*_r5 的晶簇构图（主晶柱 + 左右小晶），靛紫配色，底部压暗表「深」",
        grid=(
            '....................',
            '..........kk........',
            '....h....khmk.......',
            '...hwh..khhmdk......',
            '....h..klwhmddk.....',
            '.......kllhmddk.....',
            '...k...kllhmddk.....',
            '..klk..kllhmddk.....',
            '..klmk.kllhmddk.k...',
            '..klmdkkllhmddkkhk..',
            '..klmddkllhmddkhmk..',
            '...klmdkllhmddkhmdk.',
            '...klmdkllhmddkmddk.',
            '...klmdkllhmddkmddk.',
            '....klmkllhmddkmdk..',
            '....kmdkmmldeekdek..',
            '....kmdkmmldeekdek..',
            '.....kmkmmldeekek...',
            '......kkkkkkkkkk....',
            '....................',
        ),
        palette={'d': (54, 40, 150), 'e': (38, 26, 112), 'h': (200, 216, 255), 'k': (26, 16, 84),
                 'l': (136, 138, 246), 'm': (88, 76, 208), 'w': (255, 255, 255)},
    ),
    dict(
        key="fivefold_clear_badge_v2", item_id="10000146", name="五重决战之证", rarity=3, kind="material",
        c3="item/materials/mod/five_boss/fivefold_clear_badge_v2",
        c4="item_icon/materials/mod/five_boss/fivefold_clear_badge_v2",
        mother="称号勋章 etc/degree 与埴轮奖牌的「绶带 + 圆章」结构；章面浮雕五角星",
        grid=(
            '...vvvvv....vvvvv...',
            '...vRrrv....vRrdv...',
            '....vRrrv..vRrdv....',
            '....vRrrv..vRrdv....',
            '.....vRrrvvRrdv.....',
            '.....vRrkkkkrdv.....',
            '......kkaaaakk......',
            '.....kaaffffbbk.....',
            '....kafffwweffck....',
            '....kafffwweffck....',
            '...kafffwwwweffck...',
            '...kafwwwwwwwWeck...',
            '...kaffwwwwwWeeck...',
            '...kafffwwwweefck...',
            '....kafwWeewweck....',
            '....kbfWeeffWeck....',
            '.....kbcefffcck.....',
            '......kkcccckk......',
            '........kkkk........',
            '....................',
        ),
        palette={'R': (186, 130, 244), 'W': (255, 222, 112), 'a': (255, 234, 140), 'b': (240, 184, 56),
                 'c': (170, 100, 16), 'd': (92, 40, 150), 'e': (168, 98, 16), 'f': (214, 146, 30),
                 'k': (104, 56, 8), 'r': (128, 60, 196), 'v': (56, 20, 94), 'w': (255, 252, 226)},
    ),
    dict(
        key="five_king_core_v2", item_id="10000147", name="五王心核", rarity=5, kind="material",
        c3="item/materials/mod/five_boss/five_king_core_v2", c4="item_icon/materials/mod/five_boss/five_king_core_v2",
        mother="歼灭心核 / 深渊物质的「核心 + 外凸」构图：五角金座托绯红心核（五尖 = 五王）",
        grid=(
            '.........kk.........',
            '........k42k........',
            '........k42k........',
            '.......k4421k.......',
            '.......k4421k.......',
            '.......kooook.......',
            '....kkoodcccookk....',
            'kkkk3odwccccbbo4kkkk',
            'k4333oddcccbbbo4441k',
            '.k22odcccccbbbao11k.',
            '..k2occcccbbbaao1k..',
            '...koccccbbbbaaok...',
            '....occbbbbbaaao....',
            '....kobbbbbaaaok....',
            '....kobbbaaaaaok....',
            '....k4ooaaaaoo2k....',
            '....k411oooo332k....',
            '....k11kk..kk33k....',
            '....kkk......kkk....',
            '....................',
        ),
        palette={'1': (150, 92, 16), '2': (196, 132, 30), '3': (236, 186, 60), '4': (255, 236, 150),
                 'a': (120, 16, 56), 'b': (226, 44, 96), 'c': (255, 130, 160), 'd': (255, 240, 244),
                 'k': (84, 44, 8), 'o': (92, 8, 44), 'w': (255, 255, 255)},
    ),
    dict(
        key="deep_realm_ticket", item_id="10000143", name="深界连战凭证", rarity=5, kind="token",
        # 五重线所有：c3 / c4 都是原位替换（five_boss_v2_spec.json art.files / art.atlas_icons），交图不改对方文件
        c3="item/materials/mod/five_boss/deep_realm_ticket", c4="item_icon/materials/mod/five_boss/deep_realm_ticket",
        mother="高难多人勋章 extreme_multi_battle_token（设计 §6.4 母本）的「交叉双剑 + 中央纹章」徽记结构："
               "紫盾金边嵌紫水晶（沿用旧图母题），剑尖出左右上角、护手与剑柄出左右下角；"
               "轮廓与同店的武器扭蛋券 ticket_equipment_001/002（横票）明显不同",
        grid=(
            '.k................k.',
            'kSk..............ksk',
            'kSsk............kSsk',
            '.kSskkkkkkkkkkkkSsk.',
            '..kSskggggggggkSsk..',
            '...kSkgVVVVVVGksk...',
            '....kkgVVlmVvGkk....',
            '.....kgVllmmvGk.....',
            '.....kgVlymdvGk.....',
            '.....kgvmmddbGk.....',
            '.....kgvvmdbbGk.....',
            '...kkkgvvvbbbGkkk...',
            '..kggkkgvvbbGkkggk..',
            '...kggkgvbbbGkggk...',
            '...kkggkgbbGkggkk...',
            '..kppkk.kGGk.kkppk..',
            '.kppk....kk....kppk.',
            'kggk............kggk',
            'kGgk............kgGk',
            '.kk..............kk.',
        ),
        palette={'G': (196, 128, 30), 'S': (228, 232, 252), 'V': (150, 108, 232), 'b': (72, 38, 140),
                 'd': (126, 36, 176), 'g': (255, 214, 90), 'k': (36, 14, 66), 'l': (236, 156, 255),
                 'm': (196, 84, 232), 'p': (122, 82, 208), 's': (204, 210, 240), 'v': (112, 72, 196),
                 'y': (255, 244, 255)},
    ),
    dict(
        key="contradiction_crystal", item_id="10000301", name="矛盾结晶", rarity=4, kind="material",
        # c3 现为 mod-tools/assets/paradox/paradox_shard.png（PARADOX 线所有，本单元不改）；换用本图时 c3 与 c4 须同一条边一起换
        c3="item/materials/mod/paradox/contradiction_crystal_v2",
        c4="item_icon/materials/mod/paradox/contradiction_crystal",
        mother="旧图 paradox_shard.png 的「光影各半 + 金缝」菱晶，按规范重画：加宽到 12×17、上下晶面分明、杂色 0.188→≤0.10",
        grid=(
            '....................',
            '.........Kk.........',
            '........KgBk........',
            '.......KwgBbk.......',
            '......KwwgbBbk......',
            '......KwwgBwBk......',
            '.....KwwwgbBbbk.....',
            '....KwwwwgBbbbbk....',
            '....KssssGnnnnnk....',
            '.....KsssGnnnnk.....',
            '.....KsbsGnnnnk.....',
            '......KbSGnnNk......',
            '......KSSGnNNk......',
            '.......KSGnNk.......',
            '.......KSGNNk.......',
            '........KGNk........',
            '........KGNk........',
            '.........Kk.........',
            '....................',
            '....................',
        ),
        palette={'B': (156, 204, 255), 'G': (206, 140, 30), 'K': (100, 60, 16), 'N': (34, 56, 150),
                 'S': (170, 176, 214), 'b': (88, 144, 240), 'g': (252, 206, 72), 'k': (22, 30, 96),
                 'n': (64, 108, 218), 's': (204, 210, 240), 'w': (255, 255, 255)},
    ),
    dict(
        key="paradox_core", item_id="10000302", name="悖论之核", rarity=5, kind="material",
        c3="item/materials/mod/paradox/paradox_core_v2", c4="item_icon/materials/mod/paradox/paradox_core",
        mother="旧图 paradox_core.png 的「金蓝对半环 + 白核 + 四向尖」，按规范重画：金半边改深褐描边、左右亮度差 107→约 60",
        grid=(
            '.........Kk.........',
            '........KaBk.....B..',
            '......KKKaBkkk..BwB.',
            '.....KaaaaBBBBk..B..',
            '....KaaaaaBBBbbk....',
            '...KaaaaaaBBbbbbk...',
            '..Kaaaaavvvvbbbbbk..',
            '..Kaaaavvwwvvbbbnk..',
            '.KKaaavvwwccvvbnnkk.',
            'KaaaaavwwcccCvnnnnnk',
            'KaaaaavwcccCCvnnnnnk',
            '.KKaagvvccCCvvnnnkk.',
            '..KagggvvCCvvnnnnk..',
            '..Kgggggvvvvnnnnnk..',
            '...KggggGGnnnnnnk...',
            '....KggGGGnnnnnk....',
            '..a..KGGGGnnnnk.....',
            '.awa..KKKGnkkk......',
            '..a.....KGnk........',
            '.........Kk.........',
        ),
        palette={'B': (170, 212, 255), 'C': (170, 160, 236), 'G': (196, 130, 28), 'K': (100, 60, 16),
                 'a': (255, 228, 124), 'b': (112, 166, 248), 'c': (226, 218, 255), 'g': (240, 186, 54),
                 'k': (24, 40, 118), 'n': (74, 122, 226), 'v': (40, 34, 90), 'w': (255, 255, 255)},
    ),
]

#: 五重线交接件（five_boss_v2_spec.json：art.files 的 ticket_icon_20.png 原位 20×20；
#: art.atlas_icons 的 ticket_icon_41.png 原位替换 live 41×41 子纹理，尺寸不同会被 plan_item_icons 拒绝）。
#: 41×41 = c3×2（40×40）贴在 (0, 1)：顶行与右列透明。掉落条 DropItemContentsView 以左下角对齐（alignPivot LEFT/BOTTOM），
#: 这样内容与 40×40 的新式 c4 落在同一位置。
TICKET_KEY = "deep_realm_ticket"
TICKET_41 = 41
TICKET_41_OFFSET = (0, 1)

N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


# ---------------------------------------------------------------- render
def render(icon: dict) -> Image.Image:
    grid, pal = icon["grid"], icon["palette"]
    if len(grid) != SIZE or any(len(r) != SIZE for r in grid):
        raise ValueError(f"{icon['key']}: grid must be {SIZE}x{SIZE}")
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            if ch not in pal:
                raise ValueError(f"{icon['key']}: char {ch!r} at ({x},{y}) not in palette")
            px[x, y] = tuple(pal[ch]) + (255,)
    unused = set(pal) - {c for r in grid for c in r}
    if unused:
        raise ValueError(f"{icon['key']}: unused palette entries {sorted(unused)}")
    return img


def to_c4(c3: Image.Image) -> Image.Image:
    return c3.resize((c3.width * C4_SCALE, c3.height * C4_SCALE), Image.NEAREST)


def ticket_41(c3: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (TICKET_41, TICKET_41), (0, 0, 0, 0))
    out.paste(to_c4(c3), TICKET_41_OFFSET)
    return out


# ---------------------------------------------------------------- gate
def _lum(c) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def _hue_distance(a: float, b: float) -> float:
    d = abs(a - b) % 1.0
    return min(d, 1.0 - d) * 360


def _main_component(op: set) -> set:
    comps, seen = [], set()
    for p in sorted(op):
        if p in seen:
            continue
        stack, comp = [p], set()
        seen.add(p)
        while stack:
            q = stack.pop()
            comp.add(q)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    r = (q[0] + dx, q[1] + dy)
                    if r in op and r not in seen:
                        seen.add(r)
                        stack.append(r)
        comps.append(comp)
    return max(comps, key=len)


def metrics(img: Image.Image) -> dict:
    """同设计稿 scratch/metrics.py 的口径：杂色 = 有 ≥3 个不透明四邻、且与每个四邻 RGB 曼哈顿距离都 > 60 的像素。
    描边只看最大连通块（角上的十字星点是独立小块，不算描边）。"""
    px = img.load()
    w, h = img.size
    op = {(x, y) for y in range(h) for x in range(w) if px[x, y][3] > 0}
    alphas = sorted({px[x, y][3] for y in range(h) for x in range(w)})
    colors = {px[p][:3] for p in op}
    xs = [p[0] for p in op]
    ys = [p[1] for p in op]
    speck = 0
    for (x, y) in op:
        c = px[x, y]
        nbs = [px[x + dx, y + dy] for dx, dy in N4 if (x + dx, y + dy) in op]
        if len(nbs) >= 3 and all(sum(abs(a - b) for a, b in zip(c[:3], n[:3])) > 60 for n in nbs):
            speck += 1
    main = _main_component(op)
    border = [p for p in main if any((p[0] + dx, p[1] + dy) not in op for dx, dy in N4)]
    bc = Counter(px[p][:3] for p in border)
    top = bc.most_common(1)[0][0]
    hsv = colorsys.rgb_to_hsv(*[v / 255 for v in top])
    border_set = set(border)
    inner = [p for p in main if p not in border_set]
    sample = [h for h in (colorsys.rgb_to_hsv(*[v / 255 for v in px[p][:3]]) for p in inner)
              if h[1] >= HUE_SAMPLE[0] and h[2] >= HUE_SAMPLE[1]]
    near = sum(1 for h in sample if _hue_distance(h[0], hsv[0]) <= OUTLINE_HUE_TOL)
    cx = sum(p[0] for p in main) / len(main)
    cy = sum(p[1] for p in main) / len(main)
    ul = [_lum(px[p]) for p in inner if (p[0] - cx) + (p[1] - cy) < 0]
    lr = [_lum(px[p]) for p in inner if (p[0] - cx) + (p[1] - cy) > 0]
    mean = lambda a: sum(a) / len(a) if a else 0.0
    return {
        "size": [w, h],
        "alphas": alphas,
        "bbox": [max(xs) - min(xs) + 1, max(ys) - min(ys) + 1],
        "colors": len(colors),
        "speckle": round(speck / len(op), 3),
        "outline": list(top),
        "outline_colors": len(bc),
        "outline_top2": round(sum(v for _, v in bc.most_common(2)) / len(border), 3),
        "outline_sat": round(hsv[1], 2),
        "outline_val": round(hsv[2], 2),
        "outline_hue_share": round(near / len(sample), 2) if sample else None,
        "light_ul_minus_lr": round(mean(ul) - mean(lr)),
    }


def gate(icon: dict, c3: Image.Image, c4: Image.Image) -> list[str]:
    m = metrics(c3)
    bad = []
    if m["size"] != [SIZE, SIZE]:
        bad.append(f"size {m['size']}")
    if not set(m["alphas"]) <= {0, 255}:
        bad.append(f"alpha {m['alphas']}")
    floor = TOKEN_FLOOR if icon["kind"] == "token" else BBOX_FLOOR[icon["rarity"]]
    if max(m["bbox"]) < floor:
        bad.append(f"bbox {m['bbox']} < {floor}")
    if m["colors"] > MAX_COLORS:
        bad.append(f"colors {m['colors']} > {MAX_COLORS}")
    if m["speckle"] > MAX_SPECKLE:
        bad.append(f"speckle {m['speckle']} > {MAX_SPECKLE}")
    if m["outline_top2"] < MIN_OUTLINE_TOP2:
        bad.append(f"outline top2 {m['outline_top2']} < {MIN_OUTLINE_TOP2}")
    # 描边是主色相压暗：不是近纯黑、有彩度、明度 0.2–0.5，且色相跟着物件走（口径同构建器 icon_problems）
    if max(m["outline"]) < OUTLINE_MIN_CHANNEL:
        bad.append(f"outline {m['outline']} near black (max channel < {OUTLINE_MIN_CHANNEL})")
    low, high = OUTLINE_VAL_RANGE
    if not (m["outline_sat"] >= OUTLINE_SAT_MIN and low <= m["outline_val"] <= high):
        bad.append(f"outline {m['outline']} not a darkened hue (got s={m['outline_sat']} v={m['outline_val']}; "
                   f"need s>={OUTLINE_SAT_MIN}, v in {low}-{high})")
    share = m["outline_hue_share"]
    if share is not None and share < OUTLINE_HUE_SHARE_MIN:
        bad.append(f"outline hue off the object: share {share} < {OUTLINE_HUE_SHARE_MIN} within ±{OUTLINE_HUE_TOL}°")
    if m["light_ul_minus_lr"] < -30:
        bad.append(f"light {m['light_ul_minus_lr']}: lit from lower-right")
    if c4.size != (SIZE * C4_SCALE, SIZE * C4_SCALE) or c4.tobytes() != to_c4(c3).tobytes():
        bad.append("c4 != c3 x2 nearest")
    return bad


# ---------------------------------------------------------------- outputs
def outputs() -> dict[str, Image.Image]:
    """相对 HERE 的路径 → 图。"""
    out = {}
    for icon in ICONS:
        c3 = render(icon)
        if icon["key"] == TICKET_KEY:
            out["icons/five-boss-v2-handoff/ticket_icon_20.png"] = c3
            out["icons/five-boss-v2-handoff/ticket_icon_41.png"] = ticket_41(c3)
        else:
            out[f"icons/{icon['key']}.png"] = c3
            out[f"icons/{icon['key']}_c4.png"] = to_c4(c3)
    return out


def rgba_sha(img: Image.Image) -> str:
    return hashlib.sha256(img.convert("RGBA").tobytes()).hexdigest()


def manifest() -> dict:
    items = []
    for icon in ICONS:
        c3 = render(icon)
        c4 = to_c4(c3)
        entry = {
            "key": icon["key"], "item_id": icon["item_id"], "name": icon["name"], "rarity": icon["rarity"],
            "kind": icon["kind"], "c3_logical": icon["c3"], "c4_logical": icon["c4"], "mother": icon["mother"],
            "metrics": metrics(c3), "c3_rgba_sha256": rgba_sha(c3), "c4_rgba_sha256": rgba_sha(c4),
        }
        if icon["key"] == TICKET_KEY:
            t41 = ticket_41(c3)
            entry.update({
                "c3_file": "icons/five-boss-v2-handoff/ticket_icon_20.png",
                "c4_file": "icons/five-boss-v2-handoff/ticket_icon_41.png",
                "c4_size": [TICKET_41, TICKET_41], "c4_offset": list(TICKET_41_OFFSET),
                "c4_rgba_sha256": rgba_sha(t41), "owner": "five-boss-v2 (copy into mod-tools/assets/five-boss-v2/)",
            })
        else:
            entry.update({"c3_file": f"icons/{icon['key']}.png", "c4_file": f"icons/{icon['key']}_c4.png",
                          "c4_size": [SIZE * C4_SCALE] * 2})
        items.append(entry)
    return {"_doc": "build_icons.py 生成，勿手改。sha256 为解码后 RGBA 像素（与 PNG 压缩实现无关）。", "icons": items}


def check() -> list[str]:
    problems = []
    for icon in ICONS:
        c3 = render(icon)
        for p in gate(icon, c3, to_c4(c3)):
            problems.append(f"{icon['key']}: {p}")
    for rel, img in outputs().items():
        path = HERE / rel
        if not path.exists():
            problems.append(f"missing {rel}")
            continue
        disk = Image.open(path)
        if disk.mode != "RGBA" or disk.size != img.size or disk.tobytes() != img.tobytes():
            problems.append(f"stale {rel}: rerun build_icons.py")
    want = (json.dumps(manifest(), ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    if not MANIFEST.exists() or MANIFEST.read_bytes() != want:
        problems.append("stale manifest.json: rerun build_icons.py")
    return problems


def build() -> list[str]:
    problems = []
    for icon in ICONS:
        c3 = render(icon)
        for p in gate(icon, c3, to_c4(c3)):
            problems.append(f"{icon['key']}: {p}")
    if problems:
        return problems
    for rel, img in outputs().items():
        path = HERE / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, format="PNG", optimize=False, compress_level=9)
    MANIFEST.write_bytes((json.dumps(manifest(), ensure_ascii=False, indent=1) + "\n").encode("utf-8"))  # LF
    return []


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="只核对，不写文件")
    args = ap.parse_args(argv)
    problems = check() if args.check else build()
    for p in problems:
        print("FAIL", p)
    if not problems:
        print(("ok" if args.check else "wrote") + f" {len(outputs())} files, {len(ICONS)} icons")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
