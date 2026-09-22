"""Compile the accepted API ring into native Flatomo; no image generation here."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

import wf_flatomo_capacity as capacity
import wf_generated_vfx as vfx
import wf_seasonal7_common as common

DIRECTORY = 'battle/effect/skill_unique/kyle_moon/pf_thunder_ring'
SHEET = DIRECTORY + '/pf_thunder_ring'
SOURCE = Path('work/character_packs/midautumn-20260920/rework3/fx/kyle_pf')
NAMES = ('birth', 'ring', 'fade')
LIFETIMES = (70, 90, 110)


def effect(level):
    if level not in (1, 2, 3):
        raise ValueError('PF level must be 1, 2 or 3')
    return f'{DIRECTORY}/ring_lv{level}'


def native_animation(frames):
    """One rotation every 30 frames, with birth and fade inside hit-area life."""
    if frames not in LIFETIMES:
        raise ValueError('unsupported native sword lifetime')
    matrices, strips = [], []
    for frame in range(frames):
        end = max(0.0, (frame - (frames - 13)) / 12)
        begin = min(1.0, (frame + 1) / 8)
        angle = frame * math.tau / 30
        layers = [(1, begin * (1-end), .82 + .18*begin + .08*end)]
        if frame < 12:
            layers.append((0, (1-frame/12)*begin, .8 + .2*begin))
        if end > 0:
            layers.append((2, math.sin(end*math.pi), 1 + .20*end))
        for image, alpha, scale in layers:
            a, b = math.cos(angle)*scale, math.sin(angle)*scale
            matrix = dict(a=round(a*4096), b=round(b*4096),
                          c=round(-b*4096), d=round(a*4096),
                          x=round((-64*a + 64*b)*4096),
                          y=round((-64*b - 64*a)*4096))
            index = len(matrices)
            matrices.append(matrix)
            strips.append({'s': frame, 'i': image,
                           'l': [{'m': (index << 12) | round(255*alpha), 't': 1}]})
    parts = {'i': [{'s': False, 'p': f'{DIRECTORY}/.gen/ring/{name}'} for name in NAMES],
             'g': [{'t': frames, 's': strips}], 'm': [], 'a': [1, 1, 1],
             'o': [], 't': matrices, 'c': [], 's': 1}
    timeline = {'sequences': [{'begin': 1, 'end': frames, 'name': 'neutral', 'kind': 'once'}],
                'sounds': [], 'points': [], 'circles': [], 'rectangles': [], 'matrices': []}
    capacity.validate_image_capacities(parts)
    return parts, timeline


def build_assets(root):
    import hashlib
    import json
    source = Path(root) / SOURCE
    receipt = json.loads((source/'accepted.json').read_bytes())
    path = source/'sprites.png'
    if hashlib.sha256(path.read_bytes()).hexdigest() != receipt['sprites_sha256']:
        raise ValueError('accepted API sprites have changed')
    sheet = Image.open(path).convert('RGBA')
    if sheet.size != (384, 128) or sheet.getchannel('A').getextrema() != (0, 255):
        raise ValueError('sprites must be three transparent 128px cells')
    tiles = [sheet.crop((i*128, 0, (i+1)*128, 128)) for i in range(3)]
    # The center stays empty, including birth/fade. Never pack an opaque orb.
    if any(tile.getchannel('A').crop((51, 51, 77, 77)).getbbox() for tile in tiles):
        raise ValueError('ring center is not empty')
    names = [f'{DIRECTORY}/.gen/ring/{name}' for name in NAMES]
    packed, atlas = vfx.pack_images(tiles, names, trim=True)
    assets = {SHEET+'.png': common.png_store_bytes(packed),
              SHEET+'.atlas.amf3.deflate': common.amf_bytes(atlas)}
    for level, lifetime in enumerate(LIFETIMES, 1):
        parts, timeline = native_animation(lifetime)
        assets[effect(level)+'.parts.amf3.deflate'] = common.amf_bytes(parts)
        assets[effect(level)+'.timeline.amf3.deflate'] = common.amf_bytes(timeline)
    return assets, {'source': str(SOURCE), 'api': receipt, 'atlas_size': list(packed.size),
                    'rotation_frames': 30, 'lifetimes': list(LIFETIMES),
                    'birth_frames': 8, 'fade_frames': 12, 'center_empty': True}
