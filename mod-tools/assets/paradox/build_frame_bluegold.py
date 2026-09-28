#!/usr/bin/env python
"""Build the PARADOX Lv200 blue-gold enhanced frame (deterministic, no AI).

Output: paradox_frame_bluegold.png next to this script, 144x144 opaque RGBA.

It replaces the official pink 5-star enhanced frame
(scene/general/sprite_sheet/thumbnail-assets/item_rainbow_enhanced, a 72x72
atlas texture shown at 2x) for PARADOX at Lv200 via
ItemThumbnailView.replaceBackgroundImage, which draws the PNG at native size
with its pivot centred on the thumbnail (the same -72..72 square the rarity
frame covers).  So the art is drawn on the official 72x72 texel grid and
upscaled nearest-neighbour x2 (crisp 2x2 blocks).

Layout on the 72 grid (same as the official frame):
  0..5    rim (6 texels = 12 screen px)
  6..7    transition (official: 2-texel soft edge; here: dark line + inner
          shadow under the top/left lip)
  8..63   interior with the official diamond lattice (period 16, diamonds
          12 wide x 16 tall, touching tip to tip vertically)
The item icon (20x20, scale 6, pivot centre) covers texels 6..65, so what
stays visible is the rim, the transition line and the gaps around the icon.

Design: bevelled gold rim with a sapphire stud in each corner and a small gold
lozenge in the middle of each side; deep void-blue interior lit by an
"eclipse" glow behind the icon (stretched along the blade diagonal so the tip
and pommel stay on lit ground, while the free corners holding the icon's
sparkles sink into the void) and a faint corona ring that only shows in the
gaps around the icon.  Gold and sapphire colours are the paradox_lv200.png
ramps.

Usage:  python build_frame_bluegold.py [--out PATH] [--x72 PATH]
"""
from __future__ import annotations

import argparse
import hashlib
import math
from pathlib import Path

from PIL import Image

N = 72          # official texture size
SCALE = 2       # official display scale (rarity_frame matrix a=d=2)
RIM = 6         # rim thickness in texels
INNER = 8       # first interior texel (6..7 = transition)
C = 36.0        # centre of the texel grid (a pixel boundary: symmetric)

# ---- palette ---------------------------------------------------------------
G_EDGE = (120, 64, 18)     # outer bronze edge
G_DEEP = (150, 86, 22)     # = lv200 icon gold[0]
G_SHADE = (214, 142, 34)   # = icon gold[1]
G_BASE = (250, 198, 62)    # = icon gold[2]
G_LIGHT = (255, 222, 104)
G_HI = (255, 240, 150)     # = icon gold[3]
G_SPEC = (255, 252, 222)

GEM_DEEP = (28, 50, 150)
GEM = (40, 86, 220)        # = icon royal_blue[0]
GEM_MID = (86, 150, 255)   # = icon royal_blue[1]
GEM_HI = (160, 214, 255)   # = icon royal_blue[2]

LINE = (12, 12, 34)        # transition line between rim and interior
VOID = [                   # interior ramp: void (violet-black) -> glow
    (18, 14, 50),
    (24, 22, 74),
    (28, 36, 104),
    (36, 54, 138),
    (46, 76, 170),
    (58, 98, 200),
    (76, 124, 224),
]

# ---- interior parameters ------------------------------------------------------
LATTICE = 16
DIAMOND_HW = [6, 5, 5, 4, 3, 3, 2, 1]  # half-width per |row| from the centre
BG_LEVELS = 5              # background uses VOID[0..4]; diamonds one step up
GLOW_R0 = 16.0             # full glow inside this (stretched) radius, texels
GLOW_FALL = 24.0           # ... fading to void over this distance
GLOW_ALONG = 0.7           # < 1 stretches the glow along the blade diagonal
CORONA_R = (24.5, 25.5)    # corona ring band (a clean 8-connected circle)


def in_diamond(x: int, y: int) -> tuple[bool, float, float]:
    """Is texel (x, y) inside a lattice diamond?  Returns (hit, cx, cy)."""
    px, py = x + 0.5, y + 0.5
    cx = C + LATTICE * round((px - C) / LATTICE)
    cy = C + LATTICE * round((py - C) / LATTICE)
    dx, dy = abs(px - cx), abs(py - cy)
    row = int(dy - 0.5)
    return row < len(DIAMOND_HW) and dx <= DIAMOND_HW[row], cx, cy


def light(px: float, py: float) -> float:
    """0 (void) .. <1 (glow) at point (px, py) of the texel grid."""
    u = ((px - C) + (py - C)) / math.sqrt(2)   # along the blade (TL -> BR)
    v = ((px - C) - (py - C)) / math.sqrt(2)   # across the blade
    r = math.hypot(u * GLOW_ALONG, v)
    return max(0.0, min(0.999, 1.0 - max(0.0, r - GLOW_R0) / GLOW_FALL))


def interior_level(x: int, y: int) -> int:
    hit, cx, cy = in_diamond(x, y)
    if hit:  # diamonds are flat per cell, lit at their own centre
        return int(light(cx, cy) * BG_LEVELS) + 1
    return int(light(x + 0.5, y + 0.5) * BG_LEVELS)


def on_corona(x: int, y: int) -> bool:
    r = math.hypot(x + 0.5 - C, y + 0.5 - C)
    return CORONA_R[0] <= r < CORONA_R[1]


def despeckle(lv: dict) -> dict:
    """A lone texel that differs from all four neighbours, three or more of
    which agree, takes their level (removes quantisation crumbs).  Works on a
    snapshot, so the result does not depend on scan order."""
    out = dict(lv)
    for (x, y), me in lv.items():
        nb = [lv.get(p) for p in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))]
        if None in nb or me in nb:
            continue
        best = max(set(nb), key=nb.count)
        if nb.count(best) >= 3:
            out[x, y] = best
    return out


def rim(x: int, y: int) -> tuple[int, int, int]:
    dt, db, dl, dr = y, N - 1 - y, x, N - 1 - x
    k = min(dt, db, dl, dr)
    # mitred bevel: top/left faces are lit, bottom/right faces are shaded
    lit = (dt == k and dt <= dr) or (dl == k and dl <= db)
    return {
        0: (G_SHADE, G_EDGE),
        1: (G_HI, G_DEEP),
        2: (G_LIGHT, G_SHADE),
        3: (G_BASE, G_BASE),
        4: (G_SHADE, G_BASE),
        5: (G_DEEP, G_LIGHT),   # inner lip: reversed bevel, recessed panel
    }[k][0 if lit else 1]


STUD = [  # sapphire stud in each rim corner (light from the top-left)
    "..oo..",
    ".ohmo.",
    "ohmggo",
    "omggdo",
    ".ogdo.",
    "..oo..",
]
STUD_COL = {"o": G_EDGE, "h": GEM_HI, "m": GEM_MID, "g": GEM, "d": GEM_DEEP}

LOZENGE = [  # gold lozenge centred on each side of the rim
    "..oo..",
    ".ohho.",
    "ohsbho",
    ".obbo.",
    "..oo..",
]
LOZENGE_COL = {"o": G_DEEP, "h": G_HI, "s": G_SPEC, "b": G_LIGHT}


def stamp(px, sprite: list[str], col: dict, ox: int, oy: int) -> None:
    for sy, row in enumerate(sprite):
        for sx, ch in enumerate(row):
            if ch != ".":
                px[ox + sx, oy + sy] = col[ch] + (255,)


def build72() -> Image.Image:
    img = Image.new("RGBA", (N, N))
    px = img.load()
    lv = {}
    for y in range(N):
        for x in range(N):
            k = min(x, y, N - 1 - x, N - 1 - y)
            if k < RIM:
                px[x, y] = rim(x, y) + (255,)
            elif k == RIM:
                px[x, y] = LINE + (255,)
            else:
                lv[x, y] = interior_level(x, y)
    lv = despeckle(lv)
    for (x, y), level in lv.items():
        if on_corona(x, y):
            level += 1
        if (x == RIM + 1 or y == RIM + 1) and x <= N - 2 - RIM and y <= N - 2 - RIM:
            level = 0  # inner shadow under the top/left lip
        px[x, y] = VOID[min(level, len(VOID) - 1)] + (255,)
    for oy in (0, N - len(STUD)):
        for ox in (0, N - len(STUD)):
            stamp(px, STUD, STUD_COL, ox, oy)
    h, w = len(LOZENGE), len(LOZENGE[0])
    vert = ["".join(r[i] for r in LOZENGE) for i in range(w)]
    stamp(px, LOZENGE, LOZENGE_COL, (N - w) // 2, 0)
    stamp(px, LOZENGE, LOZENGE_COL, (N - w) // 2, N - h)
    stamp(px, vert, LOZENGE_COL, 0, (N - w) // 2)
    stamp(px, vert, LOZENGE_COL, N - h, (N - w) // 2)
    return img


def build(out: Path, x72: Path | None = None) -> str:
    img72 = build72()
    img = img72.resize((N * SCALE, N * SCALE), Image.NEAREST)
    assert img.size == (144, 144) and img.mode == "RGBA"
    assert img.getextrema()[3] == (255, 255), "frame must be fully opaque"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=False)
    if x72 is not None:
        img72.save(x72, optimize=False)
    return hashlib.sha256(out.read_bytes()).hexdigest()


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=here / "paradox_frame_bluegold.png")
    ap.add_argument("--x72", type=Path, default=None,
                    help="also write the 72x72 master texture here")
    a = ap.parse_args()
    digest = build(a.out, a.x72)
    print(f"{a.out}  144x144 RGBA opaque  sha256={digest}")


if __name__ == "__main__":
    main()
