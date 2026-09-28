"""独立核验 item-rarity-frame-override 输出 SWF：结构、字节级保持、可复现、行为矩阵、v1 回归、负对照与变异体。

    python -X utf8 client-patch/item-rarity-frame-override/verify.py <out.swf> --base <底包.swf>

行为矩阵直接执行 SWF 里的真实字节码（v1 的 look_interp，同一模块对象）：一格缩略图（``ItemThumbnailView`` 的
showItem / showAnyThumbnail / showEquipment / replace / showEmpty / setRarity / replaceItemImage / hideRarity /
replaceBackgroundImage / backgroundTextureLoadCompleted / changeBackgroundImageTexture / changeItemImageTexture /
setEquipmentFrame / show|hideEnhancedEffectAnimation，``ThumbnailFrameView`` 的 setRarity / hideRarity /
addBackgroundImage / setOrbFrame / addBackgroundEffectAnimation，``ItemThumbnailTools.getRarityFrameIndex``，全部真实字节码）
按步骤序列复用，贴图异步回调由测试决定何时到达；最后读 rarity / background 容器得出「看到的底色」。

* 本补丁矩阵：商店商品列表 / 道具箱（showAnyThumbnail Custom）、商店格（replace）、详情（showItem）、
  强化态与 v1 的互斥、格子复用（→ 普通道具 / 空格 / 强化装备 / 称号 / 再回来）、贴图晚于复用到达、各种未命中；
* v1 回归：v1 自己的强化框矩阵（17 个场景）在产物上结果逐项不变，v1 前缀的查表序列也不变；
* 截断执行：只跑两段插入段（切片接哨兵），setRarity 段未命中必须到达 v1 段入口，replace 段必须写好 itemImagePath；
* 负对照：同一矩阵在底包上全部是原生结果、从不查本补丁的前缀；变异体必须让断言变红。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH_ROOT = HERE.parent
for path in (str(PATCH_ROOT / 'battle-rules'), str(PATCH_ROOT / 'abcasm')):
    if path not in sys.path:
        sys.path.insert(0, path)

import asm  # noqa: E402
import bodies  # noqa: E402
from swfabc import SwfAbc  # noqa: E402


def _load(name, path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


rules = _load('item_rarity_frame_override_rules', HERE / 'rules.py')
#: v1 的核验模块（同一个模块名：与 v1 / 编成槽框的测试共用一个对象）。复用它的世界模型、探针与强化框矩阵。
look_verify = _load('equipment_enhanced_look_verify', PATCH_ROOT / 'equipment-enhanced-look/verify.py')
look_interp = look_verify.look_interp
AvmThrow, Cls, LookInterp, slice_method = (look_interp.AvmThrow, look_interp.Cls, look_interp.LookInterp,
                                           look_interp.slice_method)
_Cas, some, WEAPON = look_verify._Cas, look_verify.some, look_verify.WEAPON
#: 真客户端的 haxe.ds.Option.None 是 ``new Option("None",1,null)``：params 为 null（弹国服/scripts/haxe/ds/Option.as）。
#: v1 的 NONE_OPTION 把 params 建成 []，读 None.params[0] 只得 undefined，删掉 Some 判定（#36–#39）的变异体就测不出来。
#: 本补丁的世界里一律换成 null 版；v1 模块的对象不动（v1 / 编成槽框的测试共用那个模块）。
NONE_OPTION = {'index': 1, 'params': None, '_type': 'Option'}

STEEL = 'item/materials/mod/cursed/forbidden_star_steel'      # 禁忌星铁 10000311 的 c3
BLUEGOLD = 'item/equipment/mod/paradox/paradox_frame_bluegold'
STONE = 'item/stone_thumbnail'
COIN = 'item/materials/mod/five_boss/king_coin'
LV120 = look_verify.LV120
LV200 = look_verify.LV200
OTHER = look_verify.OTHER
TITLE_BG = 'item/degree/background_gold'
RK = rules.frame_key(STEEL)
FK = look_verify.FK                     # v1：enhanced_frame_override_<lv200>
PINK = look_verify.PINK                 # getRarityFrameIndex(Some(5), true)
EMPTY_FRAME = 6                         # getRarityFrameIndex(None, false)（原生「无稀有度」帧；负对照核对）
TEXTURE_SMOOTHING = 'starling.textures::TextureSmoothing'

#: 设计上的方法体 header（maxstack, localcount, initscope, maxscope）。maxstack 与作用域不变。
EXPECTED_HEADERS = {rules.FRAME: [3, 22, 1, 2], rules.REPLACE: [3, 3, 1, 2]}
#: 插入段允许出现的调用（callproperty/callpropvoid 的多名全名）；getMasterTable 不在其中。
ALLOWED_CALLS = {
    rules.FRAME: {rules.GET_LOGIC_ASSETS, rules.MAYBE, 'get_data', 'getMaybe', 'hideRarity', 'replaceBackgroundImage'},
    rules.REPLACE: {'Some'},
}
#: 属性写：setRarity 段没有；replace 段恰好一条 initproperty itemImagePath。
PROPERTY_WRITES = {rules.FRAME: [], rules.REPLACE: ['itemImagePath']}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode(abc, label):
    return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])


def _kind(index, *params):
    return {'_type': 'ItemThumbnailKind', 'index': index, 'params': list(params)}


def _opt(value):
    return NONE_OPTION if value is None else some(value)


class RarityWorld(look_verify.FrameWorld):
    """v1 的一格缩略图世界 + 本补丁要走到的入口（replace、showAnyThumbnail、showEmpty 及其依赖）。"""

    ITEM_METHODS = look_verify.FrameWorld.ITEM_METHODS + ('replace', 'showAnyThumbnail', 'showEmpty',
                                                          'changeItemImageTexture', 'get_emptyStyle')

    def __init__(self, abc, rows, loaded=True):
        super().__init__(abc, rows, loaded)
        # v1 世界里的 None（params=[]）全部换成真客户端形状（params=null），Option.None 的 getlex 也一样
        for holder in (self.cell, self.frame_view):
            for name, value in list(holder.items()):
                if value is look_verify.NONE_OPTION:
                    holder[name] = NONE_OPTION
        self.lex[rules.OPTION] = Cls(rules.OPTION, **{'None': NONE_OPTION, 'Some': some})
        image = {'_type': 'TextureReplaceableImage', 'texture': None, 'pivot': None, 'x': 0.0, 'y': 0.0,
                 'scale': 1.0, 'textureSmoothing': None, 'color': 16777215}
        image['changeTexture'] = lambda option: image.__setitem__(
            'texture', option['params'][0] if option['index'] == 0 else None)
        image['alignPivot'] = lambda h, v: image.__setitem__('pivot', (h, v))
        self.cell['itemImage'] = image
        self.cell['_emptyStyle'] = {'_type': 'ThumbnailViewEmptyStyle', 'index': 3, 'params': []}
        self.lex[TEXTURE_SMOOTHING] = Cls('TextureSmoothing', BILINEAR='bilinear', NONE='none')

    def item_texture(self):
        texture = self.cell['itemImage']['texture']
        return texture['path'] if isinstance(texture, dict) else texture


# ---------------------------------------------------------------------------
# 1. 本补丁矩阵
# ---------------------------------------------------------------------------

HIT = {RK: BLUEGOLD}
_BG = ('background', BLUEGOLD)
_PENDING = ('background', None)


def _rarity(frame):
    return ('rarity', frame)


#: 名称: (表行, 表已加载, 步骤, 期望「看到的底色」, 原生结果)；「看到的底色」之外还核对强化扫光（最后一格）。
SCENARIOS = {
    # --- 命中：各入口 ---
    'item_hit': (HIT, True, [('item', STEEL, 5), ('flush',)], _BG, _rarity(5)),
    'item_hit_texture_pending': (HIT, True, [('item', STEEL, 5)], _PENDING, _rarity(5)),
    'item_hit_rarity_4': (HIT, True, [('item', STEEL, 4), ('flush',)], _BG, _rarity(4)),
    'custom_hit_product_list': (HIT, True, [('custom', STEEL, 5), ('flush',)], _BG, _rarity(5)),
    'custom_hit_rarity_none': (HIT, True, [('custom', STEEL, None), ('flush',)], _BG, _rarity(EMPTY_FRAME)),
    'custom_fx_not_enhanced_hit': (HIT, True, [('custom_fx', STEEL, 5, False), ('flush',)], _BG, _rarity(5)),
    'replace_hit_fresh_cell': (HIT, True, [('replace', STEEL, 5), ('flush',)], _BG, _rarity(5)),
    'replace_hit_pending': (HIT, True, [('replace', STEEL, 5)], _PENDING, _rarity(5)),
    'set_rarity_again_keeps_hit': (HIT, True, [('item', STEEL, 5), ('flush',), ('set_rarity', 4, False)],
                                   _BG, _rarity(4)),
    'equipment_not_enhanced_hit': ({rules.frame_key(LV120): BLUEGOLD}, True,
                                   [('equip', LV120, 5, False), ('flush',)], _BG, _rarity(5)),
    # --- 未命中 ---
    'missing_key': ({}, True, [('item', STEEL, 5), ('flush',)], _rarity(5), _rarity(5)),
    'empty_value': ({RK: ''}, True, [('item', STEEL, 5), ('flush',)], _rarity(5), _rarity(5)),
    'null_value': ({RK: None}, True, [('item', STEEL, 5), ('flush',)], _rarity(5), _rarity(5)),
    'table_not_loaded': (HIT, False, [('item', STEEL, 5), ('flush',)], _rarity(5), _rarity(5)),
    'other_icon_key_only': ({rules.frame_key(COIN): BLUEGOLD}, True, [('item', STEEL, 5), ('flush',)],
                            _rarity(5), _rarity(5)),
    'v1_key_not_read_when_not_enhanced': ({rules.V1_FRAME_PREFIX + STEEL: BLUEGOLD}, True,
                                          [('item', STEEL, 5), ('flush',)], _rarity(5), _rarity(5)),
    'item_image_none': (HIT, True, [('set_rarity', 5, False), ('flush',)], _rarity(5), _rarity(5)),
    'empty_cell': (HIT, True, [('custom', None, 5), ('flush',)], _rarity(5), _rarity(5)),
    'view_null_guard': (HIT, True, [('item', STEEL, 5), ('flush',), ('drop_view',), ('set_rarity', 5, False)],
                        _rarity(5), _rarity(5)),
    # --- 强化态归 v1，本补丁不碰 ---
    'enhanced_ignores_rarity_key': ({rules.frame_key(LV200): BLUEGOLD}, True,
                                    [('equip', LV200, 5, True), ('flush',)], _rarity(PINK), _rarity(PINK)),
    'enhanced_v1_key_still_v1': ({FK: BLUEGOLD, rules.frame_key(LV200): TITLE_BG}, True,
                                 [('equip', LV200, 5, True), ('flush',)], _BG, _BG),
    'custom_fx_enhanced_ignores_rarity_key': (HIT, True, [('custom_fx', STEEL, 5, True), ('flush',)],
                                              _rarity(PINK), _rarity(PINK)),
    # --- 格子复用：原生 frame.setRarity 每次都把 rarity 打开、background 关掉 ---
    'reuse_hit_then_plain_item': (HIT, True, [('item', STEEL, 5), ('flush',), ('item', STONE, 3), ('flush',)],
                                  _rarity(3), _rarity(3)),
    'reuse_texture_arrives_after_reuse': (HIT, True, [('item', STEEL, 5), ('item', STONE, 3), ('flush',)],
                                          _rarity(3), _rarity(3)),
    'reuse_plain_then_hit': (HIT, True, [('item', STONE, 3), ('flush',), ('item', STEEL, 5), ('flush',)],
                             _BG, _rarity(5)),
    'reuse_hit_twice': (HIT, True, [('item', STEEL, 5), ('flush',), ('item', STONE, 3), ('flush',),
                                    ('item', STEEL, 5), ('flush',)], _BG, _rarity(5)),
    'reuse_hit_then_empty': (HIT, True, [('custom', STEEL, 5), ('flush',), ('empty',), ('flush',)],
                             _rarity(EMPTY_FRAME), _rarity(EMPTY_FRAME)),
    'reuse_hit_then_enhanced_equipment': (HIT, True, [('item', STEEL, 5), ('flush',), ('equip', OTHER, 5, True),
                                                      ('flush',)], _rarity(PINK), _rarity(PINK)),
    'reuse_hit_then_title': (HIT, True, [('item', STEEL, 5), ('flush',), ('title', STONE, TITLE_BG), ('flush',)],
                             ('background', TITLE_BG), ('background', TITLE_BG)),
    'reuse_title_then_hit': (HIT, True, [('title', STONE, TITLE_BG), ('flush',), ('item', STEEL, 5), ('flush',)],
                             _BG, _rarity(5)),
    'reuse_title_then_plain': (HIT, True, [('title', STONE, TITLE_BG), ('flush',), ('item', STONE, 3),
                                           ('flush',)], _rarity(3), _rarity(3)),
    # --- replace：原生 setRarity 先于 replaceItemImage；入口先写 itemImagePath ---
    'replace_reuse_hit_then_plain': (HIT, True, [('replace', STEEL, 5), ('flush',), ('replace', STONE, 3),
                                                 ('flush',)], _rarity(3), _rarity(3)),
    'replace_reuse_plain_then_hit': (HIT, True, [('replace', STONE, 3), ('flush',), ('replace', STEEL, 5),
                                                 ('flush',)], _BG, _rarity(5)),
    'replace_reuse_hit_twice': (HIT, True, [('replace', STEEL, 5), ('flush',), ('replace', STONE, 3), ('flush',),
                                            ('replace', STEEL, 4), ('flush',)], _BG, _rarity(4)),
}
EXPECTED = {name: s[3] for name, s in SCENARIOS.items()}
NATIVE = {name: s[4] for name, s in SCENARIOS.items()}
HITS = frozenset(name for name in SCENARIOS if EXPECTED[name] != NATIVE[name])
#: 最后一步显示的图标（验证 replace 段不改变图标流程）。
EXPECTED_ICON = {}
for _name, (_rows, _loaded, _steps, _exp, _nat) in SCENARIOS.items():
    _icon = None
    for _step in _steps:
        if _step[0] in ('item', 'replace', 'equip'):
            _icon = _step[1]
        elif _step[0] in ('custom', 'custom_fx'):
            _icon = _step[1] if _step[1] is not None else 'scene/general/sprite_sheet/vector_icon-assets/empty_equipment'
        elif _step[0] == 'title':
            _icon = _step[1]
        elif _step[0] == 'empty':
            _icon = 'scene/general/sprite_sheet/vector_icon-assets/empty_equipment'
    EXPECTED_ICON[_name] = _icon


def _run_steps(world, steps):
    cell = world.cell
    for step in steps:
        kind = step[0]
        if kind == 'item':
            cell['showItem'](step[1], step[2])
        elif kind == 'custom':
            cell['showAnyThumbnail'](_kind(14, _opt(step[1]), _opt(step[2])))
        elif kind == 'custom_fx':
            cell['showAnyThumbnail'](_kind(16, _opt(step[1]), _opt(step[2]), step[3]))
        elif kind == 'replace':
            cell['replace'](step[1], step[2])
        elif kind == 'equip':
            cell['showEquipment'](step[1], step[2], step[3], WEAPON)
        elif kind == 'title':
            cell['showAnyThumbnail'](_kind(11, step[1], step[2]))
        elif kind == 'empty':
            cell['showEmpty']()
        elif kind == 'set_rarity':
            cell['setRarity'](some(step[1]), step[2])
        elif kind == 'flush':
            world.flush()
        elif kind == 'drop_view':
            cell['view'] = None
        else:
            raise ValueError(step)


def _icon_seen(world):
    """图标：最后一次 replaceItemImage 请求的路径（异步图标不建模），或空格直接换上的贴图。"""
    path = world.cell['itemImagePath']
    if path['index'] == 0:
        return path['params'][0]
    return world.item_texture()


def run_scenario(abc, name):
    rows, loaded, steps, _expected, _native = SCENARIOS[name]
    world = RarityWorld(abc, rows, loaded)
    try:
        _run_steps(world, steps)
        seen, _sweep = world.state()
        result = (seen, _icon_seen(world))
    except AvmThrow as thrown:
        value = thrown.value
        result = ('throw', value.get('code') if isinstance(value, dict) else repr(value))
    except (AssertionError, KeyError, TypeError, ValueError, AttributeError, IndexError) as exc:
        result = ('error', type(exc).__name__, str(exc)[:160])
    return result, world.cas.probe()


def expected_result(name):
    return (EXPECTED[name], EXPECTED_ICON[name])


def native_result(name):
    return (NATIVE[name], EXPECTED_ICON[name])


def matrix(abc):
    results, probes = {}, {}
    for name in SCENARIOS:
        results[name], probes[name] = run_scenario(abc, name)
    return results, probes


def own_lookups(probe):
    return [key for key in probe['lookups'] if key.startswith(rules.PREFIX)]


def expected_own_lookups(name):
    """打补丁后本补丁前缀的查表序列：每次非强化态 setRarity 且 itemImagePath 是非空 Some、view 链与表都在时查一次。"""
    rows, loaded, steps, _e, _n = SCENARIOS[name]
    if not loaded:
        return []
    path, keys, view = None, [], True
    for step in steps:
        kind = step[0]
        if kind in ('item', 'replace'):
            path = step[1]
            if view:
                keys.append(rules.frame_key(path))
        elif kind == 'custom':
            path = step[1]
            if path is not None and view:
                keys.append(rules.frame_key(path))
        elif kind == 'custom_fx':
            path = step[1]
            if not step[3] and view:
                keys.append(rules.frame_key(path))
        elif kind == 'equip':
            path = step[1]
            if not step[3] and view:
                keys.append(rules.frame_key(path))
        elif kind == 'title':
            path = step[1]
        elif kind == 'empty':
            path = None
        elif kind == 'set_rarity':
            if not step[2] and path and view:
                keys.append(rules.frame_key(path))
        elif kind == 'drop_view':
            view = False
    return keys


# ---------------------------------------------------------------------------
# 2. v1 回归：v1 自己的强化框矩阵在产物上逐项不变
# ---------------------------------------------------------------------------

def v1_regression(abc):
    frame, probes, _textures = look_verify.frame_matrix(abc)
    mismatches = {name: [frame[name], value] for name, value in look_verify.FRAME_EXPECTED.items()
                  if frame[name] != value}
    lookups = {name: [key for key in probes[name]['lookups'] if key.startswith(rules.V1_FRAME_PREFIX)]
               for name in look_verify.FRAME_SCENARIOS}
    lookup_mismatches = {name: [lookups[name], value] for name, value in look_verify.FRAME_EXPECTED_LOOKUPS.items()
                         if lookups[name] != value}
    return {'size': len(frame), 'mismatches': mismatches, 'v1_lookup_mismatches': lookup_mismatches,
            'ok': not mismatches and not lookup_mismatches}


# ---------------------------------------------------------------------------
# 3. 截断执行：只跑插入段（哨兵返回 this）
# ---------------------------------------------------------------------------

def native_entry(abc, label):
    """补丁体里原生入口的位置（=插入段末尾）；未打补丁时为锚点。"""
    ins = decode(abc, label)
    at = rules.ANCHORS[label]
    probe = ('getlocal_2', None) if label == rules.FRAME else ('findproperty', 'setRarity')

    def native_here(index):
        x = ins[index] if index < len(ins) else None
        if x is None or x.name != probe[0]:
            return False
        return probe[1] is None or abc.mn_name(x.args[0]) == probe[1]

    for entry in (at, at + rules.INSERTED_COUNTS[label]):
        if native_here(entry) and (label != rules.FRAME or entry + 19 < len(ins)
                                   and ins[entry + 19].name == 'pushstring'
                                   and abc.strings[ins[entry + 19].args[0]] == rules.V1_FRAME_PREFIX.encode()):
            return ins, at, entry
    raise AssertionError(f'{label}: native entry not found at #{at} or after the inserted block')


FALL_CASES = [
    # (表行, 表已加载, enhanced, itemImagePath) -> 期望命中值或 None
    (HIT, True, False, STEEL), (HIT, True, True, STEEL), (HIT, True, False, None), (HIT, True, False, STONE),
    (HIT, False, False, STEEL), ({RK: ''}, True, False, STEEL), ({RK: None}, True, False, STEEL),
    ({}, True, False, STEEL), ({rules.V1_FRAME_PREFIX + STEEL: BLUEGOLD}, True, False, STEEL),
    ({rules.frame_key(''): BLUEGOLD}, True, False, ''),
]


def fallthrough(abc):
    out = {}
    epilogue = asm.assemble([('getlocal_0',), ('returnvalue',)])
    ins, at, entry = native_entry(abc, rules.FRAME)
    code = slice_method(ins, at, entry, epilogue)
    for index, (rows, loaded, enhanced, path) in enumerate(FALL_CASES):
        world = RarityWorld(abc, rows, loaded)
        world.cell['itemImagePath'] = NONE_OPTION if path is None else some(path)
        calls = []
        world.cell['hideRarity'] = lambda: calls.append('hideRarity')
        world.cell['replaceBackgroundImage'] = lambda value: calls.append(('replaceBackgroundImage', value))
        try:
            value = LookInterp(abc, world.lex).run(code, [world.cell, some(5), enhanced])
        except Exception as exc:  # noqa: BLE001 —— 任何异常都是失败
            out[('frame', index)] = ('error', type(exc).__name__, str(exc)[:160])
            continue
        out[('frame', index)] = ('native_entry' if value is world.cell else 'escaped', calls)
    ins, at, entry = native_entry(abc, rules.REPLACE)
    code = slice_method(ins, at, entry, epilogue)
    for index, path in enumerate((STEEL, STONE, '')):
        world = RarityWorld(abc, {}, True)
        world.cell['itemImagePath'] = some('previous/icon')
        try:
            value = LookInterp(abc, world.lex).run(code, [world.cell, path, 5])
        except Exception as exc:  # noqa: BLE001
            out[('replace', index)] = ('error', type(exc).__name__, str(exc)[:160])
            continue
        option = world.cell['itemImagePath']
        out[('replace', index)] = ('native_entry' if value is world.cell else 'escaped',
                                   (option['index'], list(option['params'])))
    return out


def fallthrough_expected(key, patched=True):
    kind, index = key
    if kind == 'frame':
        rows, loaded, enhanced, path = FALL_CASES[index]
        hit = patched and loaded and not enhanced and path and rows.get(rules.frame_key(path))
        return ('native_entry', ['hideRarity', ('replaceBackgroundImage', rows[rules.frame_key(path)])] if hit else [])
    path = (STEEL, STONE, '')[index]
    return ('native_entry', (0, [path]) if patched else (0, ['previous/icon']))


# ---------------------------------------------------------------------------
# 4. 静态证明
# ---------------------------------------------------------------------------

def _operand(abc, x):
    return abc.mn_name(x.args[0]) if x.args and x.args[0] != rules.MULTINAME_L else 'MultinameL'


def static_proof(base_abc, out_abc):
    locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
    report, ok = {}, True
    for label in rules.TARGETS:
        before = base_abc.bodies[bodies.resolve(base_abc, label)]
        after = out_abc.bodies[bodies.resolve(out_abc, label)]
        native, patched = asm.decode(before[5]), asm.decode(after[5])
        n = len(patched) - len(native)
        at = rules.ANCHORS[label]
        entry = at + n
        block = patched[at:entry]
        restored = asm.unsplice(after[5], at, n)
        written, read, calls, strings, writes = set(), set(), set(), [], []
        for x in block:
            if x.op in (0x63, 0xD4, 0xD5, 0xD6, 0xD7):
                written.add(x.args[0] if x.op == 0x63 else x.op - 0xD4)
            elif x.op in (0x62, 0xD0, 0xD1, 0xD2, 0xD3):
                read.add(x.args[0] if x.op == 0x62 else x.op - 0xD0)
            elif x.op in (0x92, 0x94, 0xC2, 0xC3, 0x08, 0x32):
                written.add(-1)
            if x.name in ('callproperty', 'callpropvoid', 'callproplex', 'callsuper', 'callsupervoid',
                          'callmethod', 'callstatic', 'call', 'construct', 'constructsuper', 'constructprop'):
                calls.add(out_abc.mn_name(x.args[0]) if x.name.startswith(('callprop', 'constructprop'))
                          else x.name)
            if x.name in ('setproperty', 'initproperty', 'setslot', 'setsuper', 'deleteproperty'):
                writes.append(_operand(out_abc, x).rsplit(':', 1)[-1] if x.args else x.name)
            if x.name == 'pushstring':
                strings.append(out_abc.strings[x.args[0]].decode('utf8'))
        new_locals = set(rules.LOCALS[label].values())
        inner_targets = [x.target for x in block if x.target is not None]
        item = {
            'anchor': at, 'inserted': n,
            'native_restored_byte_identical': sha(restored) == locks[label]['sha'] == sha(before[5]),
            'header_before': list(before[1:5]), 'header_after': list(after[1:5]),
            'writes_only_new_locals': written == new_locals,
            'reads_only_allowed_registers': read <= rules.READS[label] | new_locals,
            'new_locals_start_at_old_localcount': (not new_locals
                                                   or min(new_locals) == locks[label]['header'][1] == before[2]),
            'calls': sorted(calls),
            'calls_whitelisted': calls <= ALLOWED_CALLS[label],
            'never_calls_getMasterTable': rules.GET_MASTER not in calls,
            'property_writes': writes,
            'property_writes_as_designed': writes == PROPERTY_WRITES[label],
            'strings': strings,
            'branches_stay_in_block_or_exit_to_native_entry': all(at <= t <= entry for t in inner_targets),
            'no_outside_branch_into_block': not [i for i, x in enumerate(patched)
                                                 if not at <= i < entry and (
                                                     (x.target is not None and at < x.target <= entry - 1) or
                                                     (x.cases and any(at < t < entry
                                                                      for t in [x.default, *x.cases])))],
            'no_branch_targets_anchor': not [i for i, x in enumerate(patched)
                                             if not at <= i < entry and (x.target == at or (
                                                 x.cases and at in [x.default, *x.cases]))],
            'no_scope_or_exception_change': not [x for x in block if x.op in (0x1C, 0x1D, 0x30, 0x03)]
            and after[6] == before[6] == [] and after[7] == before[7],
            'returns_in_block': sum(1 for x in block if x.op in (0x47, 0x48)),
            'stack_empty_at_native_entry': look_verify._stack_empty_at(after, entry, out_abc.multinames),
        }
        if label == rules.REPLACE:
            source = decode(out_abc, rules.HOIST_SOURCE)[slice(*rules.HOIST_RANGE)]
            item['byte_identical_to_replaceItemImage_2_7'] = \
                asm.encode(block)[0] == asm.encode(source)[0]
        else:
            item['v1_block_follows_intact'] = (
                patched[entry].name == 'getlocal_2' and patched[entry + 19].name == 'pushstring'
                and out_abc.strings[patched[entry + 19].args[0]] == rules.V1_FRAME_PREFIX.encode()
                and patched[-1].name == 'returnvoid')
        item['ok'] = (n == rules.INSERTED_COUNTS[label] and item['native_restored_byte_identical']
                      and item['header_after'] == EXPECTED_HEADERS[label] and item['writes_only_new_locals']
                      and item['reads_only_allowed_registers'] and item['new_locals_start_at_old_localcount']
                      and item['calls_whitelisted'] and item['never_calls_getMasterTable']
                      and item['property_writes_as_designed']
                      and item['branches_stay_in_block_or_exit_to_native_entry']
                      and item['no_outside_branch_into_block'] and item['no_branch_targets_anchor']
                      and item['no_scope_or_exception_change']
                      and item['returns_in_block'] == 0
                      and item['stack_empty_at_native_entry']
                      and item.get('byte_identical_to_replaceItemImage_2_7', True)
                      and item.get('v1_block_follows_intact', True))
        ok = ok and item['ok']
        report[label] = item
    report['ok'] = ok
    return report


# ---------------------------------------------------------------------------
# 5. 结构 / 保持 / 复现
# ---------------------------------------------------------------------------

def stacked_labels():
    """叠加链上必须逐字节不变的既有补丁方法体（按标签，取各补丁自己登记的常量，不手抄）：
    v1 登记的整条叠加链 + v1 的第二图标档（v1 的强化框段与本补丁同体，另由 unsplice 证明逐字节保留）
    + 编成槽框两体 + 觉醒专属素材 + 装备列表置顶。"""
    party = _load('equipment_enhanced_party_frame_rules', PATCH_ROOT / 'equipment-enhanced-party-frame/rules.py')
    labels = list(look_verify.stacked_labels()) + [look_verify.rules.PIXELART] + list(party.TARGETS)
    for directory, name in (('equipment-awakening-material', 'equipment_awakening_material_rules'),
                            ('equipment-sort-pin', 'equipment_sort_pin_rules')):
        path = PATCH_ROOT / directory / 'rules.py'
        if path.exists():
            labels += list(_load(name, path).TARGETS)
    return tuple(dict.fromkeys(labels))


def preservation(base: SwfAbc, out: SwfAbc):
    m = look_verify._independent()
    a, b = m.parse_abc(base.abc.serialize()), m.parse_abc(out.abc.serialize())
    locked = sorted(bodies.resolve(base.abc, label) for label in rules.TARGETS)
    changed = [i for i, (x, y) in enumerate(zip(a['bodies'], b['bodies'])) if x != y]
    labels = {}
    for label in stacked_labels():
        try:
            index = bodies.resolve(base.abc, label)
        except asm.AsmError:
            labels[label] = 'absent'
            continue
        labels[label] = 'identical' if a['bodies'][index] == b['bodies'][index] else 'CHANGED'
    pools = {}
    for key, values in a['pools'].items():
        after = b['pools'][key]
        pools[key] = {'prefix_identical': repr(values) == repr(after[:len(values)]),
                      'appended': [v.decode('utf8', 'replace') if isinstance(v, bytes) else v
                                   for v in after[len(values):]]}
    tables = {k: a[k] == b[k] for k in ('methods', 'instances', 'classes', 'scripts', 'metadata', 'minor', 'major')}
    same_container = (base.body[:base._offset] == out.body[:out._offset]
                      and base.body[base._offset + base._length:] == out.body[out._offset + out._length:])
    appended_ok = all(v['prefix_identical'] for v in pools.values()) and \
        pools['strs']['appended'] == list(rules.ADDED_STRINGS) and \
        all(not v['appended'] for k, v in pools.items() if k != 'strs')
    return {'changed_bodies': changed, 'locked_bodies': locked, 'total_bodies': len(b['bodies']),
            'added_bodies': len(b['bodies']) - len(a['bodies']),
            'unchanged_bodies': len(a['bodies']) - len(changed),
            'tables_identical': tables, 'pools': pools, 'non_abc_tags_identical': same_container,
            'stacked_patch_bodies': labels,
            'ok': changed == locked and len(a['bodies']) == len(b['bodies']) and all(tables.values())
            and appended_ok and same_container and set(labels.values()) == {'identical'}}


def reproduce(base_path: Path, out: SwfAbc):
    overlay = _load('item_rarity_frame_override_overlay', HERE / 'overlay.py')
    rebuilt = SwfAbc(base_path)
    overlay.patch_editor(rebuilt)
    return rebuilt.abc.serialize() == out.abc.serialize()


# ---------------------------------------------------------------------------
# 6. 变异体（负对照）
# ---------------------------------------------------------------------------

def _drop(label, sequence):
    """删掉 label 插入段里第一处与 sequence 完全相同的连续片段（找不到就报错，变异体不许静默落空）。"""
    def mutate(e, current, code):
        if current != label:
            return code
        seq = sequence(e)
        for i in range(len(code) - len(seq) + 1):
            if code[i:i + len(seq)] == seq:
                return code[:i] + code[i + len(seq):]
        raise AssertionError(f'{label}: mutant sequence not found: {seq}')
    return mutate


def mutant_text_guard(e, label, code):
    """删掉「string 为空串 / null」这一道（只删第二次出现的 text 判空）。"""
    if label != rules.FRAME:
        return code
    text = rules.LOCALS[rules.FRAME]['text']
    guard = [('getlocal', text), ('iffalse', 'SKIP')]
    hits = [i for i in range(len(code) - 1) if code[i:i + 2] == guard]
    if len(hits) != 2:
        raise AssertionError(f'expected two text guards, found {hits}')
    return code[:hits[1]] + code[hits[1] + 2:]


def mutant_enhanced_inverted(e, label, code):
    """enhanced 判定写反（iftrue → iffalse）：强化态换底、非强化态不换。"""
    if label != rules.FRAME:
        return code
    if code[:2] != [('getlocal_2',), ('iftrue', 'SKIP')]:
        raise AssertionError('enhanced guard not at the head of the block')
    return [('getlocal_2',), ('iffalse', 'SKIP')] + code[2:]


def mutant_v1_prefix(e, label, code):
    """前缀写成 v1 的（键拼错：非强化态会去读强化框的键）。"""
    swap = {e.string(rules.PREFIX): e.string(rules.V1_FRAME_PREFIX)}
    return [swap.get(item, item) for item in code]


def mutant_replace_hoist_dropped(e, label, code):
    """replace 不先写 itemImagePath（段换成一条 nop，方法体仍算「改过」）：setRarity 看到的是上一件物品的路径。"""
    return [('nop',)] if label == rules.REPLACE else code


def mutant_replace_hoists_wrong_param(e, label, code):
    """replace 段写成 Some(param2)（rarity）：键尾变成数字。"""
    if label != rules.REPLACE:
        return code
    return [('getlocal_2',) if item == ('getlocal_1',) else item for item in code]


MUTANTS = {
    'enhanced_condition_deleted': _drop(rules.FRAME, lambda e: [('getlocal_2',), ('iftrue', 'SKIP')]),
    'enhanced_condition_inverted': mutant_enhanced_inverted,
    'text_guard_deleted': mutant_text_guard,
    # 删掉 #36–#39 的 Some 判定：itemImagePath 为 None（空格 showEmpty / 无图标）时读 null.params[0] → TypeError #1009
    'some_check_deleted': _drop(rules.FRAME, lambda e: [('getlocal', rules.LOCALS[rules.FRAME]['option']),
                                                        ('getproperty', e.q('index')), ('pushbyte', 0),
                                                        ('ifne', 'SKIP')]),
    'hide_rarity_deleted': _drop(rules.FRAME, lambda e: [('getlocal_0',), ('callpropvoid', e.q('hideRarity'), 0)]),
    'v1_prefix_instead_of_own': mutant_v1_prefix,
    'replace_hoist_dropped': mutant_replace_hoist_dropped,
    'replace_hoists_rarity_param': mutant_replace_hoists_wrong_param,
}
#: 每个变异体至少要让这些断言变红（其余变红项也记录）。
MUTANT_TARGETS = {
    'enhanced_condition_deleted': [('scenario', 'enhanced_ignores_rarity_key')],
    'enhanced_condition_inverted': [('scenario', 'item_hit'), ('scenario', 'enhanced_ignores_rarity_key')],
    'text_guard_deleted': [('scenario', 'empty_value')],
    'some_check_deleted': [('scenario', 'item_image_none'), ('scenario', 'empty_cell'),
                           ('scenario', 'reuse_hit_then_empty')],
    'hide_rarity_deleted': [('scenario', 'item_hit'), ('scenario', 'custom_hit_product_list')],
    'v1_prefix_instead_of_own': [('scenario', 'item_hit'), ('scenario', 'v1_key_not_read_when_not_enhanced')],
    'replace_hoist_dropped': [('scenario', 'replace_hit_fresh_cell'), ('scenario', 'replace_reuse_hit_then_plain'),
                              ('scenario', 'replace_reuse_plain_then_hit')],
    'replace_hoists_rarity_param': [('scenario', 'replace_hit_fresh_cell')],
}


def red_assertions(abc):
    """在给定 ABC 上跑本补丁矩阵 + v1 回归，返回所有与期望不符的断言键。"""
    red = []
    results, probes = matrix(abc)
    for name, value in results.items():
        if value != expected_result(name):
            red.append(('scenario', name))
        if own_lookups(probes[name]) != expected_own_lookups(name):
            red.append(('lookups', name))
    regression = v1_regression(abc)
    red += [('v1', name) for name in regression['mismatches']]
    red += [('v1_lookups', name) for name in regression['v1_lookup_mismatches']]
    return red


def mutant_matrix(base_path: Path):
    overlay = _load('item_rarity_frame_override_overlay', HERE / 'overlay.py')
    out = {}
    for name, mutate in MUTANTS.items():
        swf = SwfAbc(base_path)
        overlay.patch_editor(swf, mutate=mutate)
        red = red_assertions(swf.abc)
        out[name] = {'red': [list(k) for k in red], 'red_count': len(red),
                     'targets_red': all(t in red for t in MUTANT_TARGETS[name])}
    return out


# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------

def _key(key):
    return ':'.join(str(k) for k in key) if isinstance(key, tuple) else str(key)


def verify(out_path, base_path=None, mutants=True):
    out_path = Path(out_path)
    out = SwfAbc(out_path)
    report = {'output': str(out_path), 'output_sha256': sha(out_path.read_bytes()),
              'output_abc_sha256': sha(out.abc.serialize())}
    results, probes = matrix(out.abc)
    report['matrix_size'], report['hit_count'] = len(results), len(HITS)
    report['mismatches'] = {k: [results[k], expected_result(k)] for k in SCENARIOS
                            if results[k] != expected_result(k)}
    report['lookup_mismatches'] = {k: [own_lookups(probes[k]), expected_own_lookups(k)] for k in SCENARIOS
                                   if own_lookups(probes[k]) != expected_own_lookups(k)}
    report['never_calls_getMasterTable'] = True       # _Cas.forbidden 一调用就 AssertionError → 进 mismatches
    report['v1_regression'] = v1_regression(out.abc)
    fall = fallthrough(out.abc)
    report['fallthrough_size'] = len(fall)
    report['fallthrough_mismatches'] = {_key(k): [v, fallthrough_expected(k)] for k, v in fall.items()
                                        if v != fallthrough_expected(k)}
    ok = not (report['mismatches'] or report['lookup_mismatches'] or report['fallthrough_mismatches']) \
        and report['v1_regression']['ok']
    if base_path is not None:
        base_path = Path(base_path)
        base = SwfAbc(base_path)
        report['base_sha256'] = sha(base_path.read_bytes())
        report['base_abc_sha256'] = sha(base.abc.serialize())
        report['base_listed'] = report['base_abc_sha256'] in rules.KNOWN_BASES
        report['preservation'] = preservation(base, out)
        report['static_proof'] = static_proof(base.abc, out.abc)
        report['reproducible_from_base'] = reproduce(base_path, out)
        target = rules.KNOWN_BASES.get(report['base_abc_sha256'], {}).get('target_abc_sha256')
        report['output_matches_pinned_target'] = None if target is None else target == report['output_abc_sha256']
        native, native_probes = matrix(base.abc)
        report['negative_control'] = {
            'hits_passing_on_base': sorted(k for k in HITS if native[k] == expected_result(k)),
            'base_not_native': {k: [native[k], native_result(k)] for k in SCENARIOS if native[k] != native_result(k)},
            'base_touches_own_prefix': sorted(k for k, v in native_probes.items() if own_lookups(v)),
            'base_v1_regression_ok': v1_regression(base.abc)['ok'],
        }
        neg = report['negative_control']
        ok = ok and report['preservation']['ok'] and report['static_proof']['ok'] \
            and report['reproducible_from_base'] and report['output_matches_pinned_target'] is not False \
            and not neg['hits_passing_on_base'] and not neg['base_not_native'] \
            and not neg['base_touches_own_prefix'] and neg['base_v1_regression_ok']
        if mutants:
            report['mutants'] = mutant_matrix(base_path)
            ok = ok and all(m['red_count'] and m['targets_red'] for m in report['mutants'].values())
    report['ok'] = ok
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('output', type=Path)
    p.add_argument('--base', type=Path)
    p.add_argument('--no-mutants', action='store_true', help='跳过变异体（需要 --base）')
    a = p.parse_args()
    report = verify(a.output, a.base, mutants=not a.no_mutants)
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main()
