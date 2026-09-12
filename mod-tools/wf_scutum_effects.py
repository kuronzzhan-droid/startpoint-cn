"""盾牌座特效：只用原生 Flatomo 根颜色变换，完整保留官方图集像素。"""
from copy import deepcopy
import hashlib
import zlib

import wf_dsl
from wf_character_revision import encode_tree

SOURCE_CODE, CODE = 'prince_zero', 'scutum_valentine'
SOURCE = f'battle/effect/skill_unique/{SOURCE_CODE}/{SOURCE_CODE}'
TARGET = f'battle/effect/skill_unique/{CODE}/{CODE}'
SUFFIXES = ('.png', '.atlas.amf3.deflate', '.parts.amf3.deflate', '.timeline.amf3.deflate')
# Native uint: multiplier-percent <<24 | red-offset <<16 | green-offset <<8 | blue-offset.
# This is a data-side shader transform. It never decodes, recolours or writes a PNG.
TINT = 0x231E7864


def remap(value):
    if isinstance(value, str):
        return value.replace(SOURCE_CODE, CODE)
    if isinstance(value, list):
        return [remap(item) for item in value]
    if isinstance(value, dict):
        return {remap(key): remap(item) for key, item in value.items()}
    return value


def tint_parts(tree):
    expected = {'t': 66, 's': [{'s': -2147483648.0, 'i': 1,
        'l': [{'m': 255, 't': 66, 'r': 1073741824.0}]}]}
    if not isinstance(tree, dict) or tree.get('g', [None])[0] != expected:
        raise ValueError('prince_zero root topology changed')
    if tree.get('m') != []:
        raise ValueError('unexpected movie resource')
    if any('c' in frame for graphic in tree['g'] for segment in graphic['s'] for frame in segment['l']):
        raise ValueError('source already contains a colour transform')
    result = remap(deepcopy(tree))
    # A single root transform composes once onto every leaf. Setting every nested
    # record would multiply the tint repeatedly and destroy the original shading.
    result['g'][0]['s'][0]['l'][0]['c'] = TINT
    return result


def native_rgb(rgb):
    multiplier = (TINT >> 24 & 255) / 100
    offsets = (TINT >> 16 & 255, TINT >> 8 & 255, TINT & 255)
    return tuple(max(0, min(255, int(channel * multiplier + offset)))
                 for channel, offset in zip(rgb, offsets))


def assets(official_loader):
    outputs = {}
    for suffix in SUFFIXES:
        raw = official_loader(SOURCE + suffix)
        if suffix in ('.png', '.timeline.amf3.deflate'):
            output = raw
        else:
            tree = wf_dsl.parse_dsl(zlib.decompress(raw, -15))['tree']
            output = encode_tree(tint_parts(tree) if suffix == '.parts.amf3.deflate' else remap(tree))
        outputs['common', TARGET + suffix] = output
    return outputs


def build(seed):
    outputs = assets(seed.official)
    for (tier, logical), raw in outputs.items():
        seed.emit(tier, logical, raw)
    return {**metadata(), 'assets': [dict(root=tier, logical_path=logical,
                sha256=hashlib.sha256(raw).hexdigest()) for (tier, logical), raw in outputs.items()]}


def metadata():
    return dict(source=SOURCE, target=TARGET, native_colour_field='g[0].s[0].l[0].c',
                packed_colour=f'0x{TINT:08x}', rgb_multiplier=.35, rgb_offsets=[30,120,100],
                source_png_bytes_unchanged=True, atlas_rectangles_unchanged=True,
                timeline_bytes_unchanged=True, alpha_blend_geometry_unchanged=True,
                frame_count=66, requires_new_apk=False,
                fixed_rgb_probes=[{'input': list(rgb), 'output': list(native_rgb(rgb))}
                                  for rgb in ((255,255,255),(255,200,0),(0,0,0))])
