"""独立核验 equipment-enhanced-look 输出 SWF：结构、字节级保持、可复现、行为矩阵、负对照与变异体。

    python -X utf8 client-patch/equipment-enhanced-look/verify.py <out.swf> --base <equipment-description-override.swf>

行为矩阵直接执行 SWF 里的真实字节码（look_interp）：

* 图标：``EquipmentEnhancementLogic.getPixelart`` 整方法执行 + 唯一消费方
  ``GeneralEquipmentLogic.getPixelArtPathWithEnhancement``（真实字节码转发），按强化等级给出显示路径；
* 强化框：一格缩略图（``ItemThumbnailView`` 的 showEquipment / showItem / setRarity / replaceItemImage /
  hideRarity / replaceBackgroundImage / backgroundTextureLoadCompleted / changeBackgroundImageTexture /
  setEquipmentFrame / show|hideEnhancedEffectAnimation，``ThumbnailFrameView`` 的 setRarity / hideRarity /
  addBackgroundImage / setOrbFrame / addBackgroundEffectAnimation，``ItemThumbnailTools.getRarityFrameIndex``，
  全部真实字节码）按步骤序列复用，贴图异步回调由测试决定何时到达；最后读 rarity / background 容器得出「看到的框」；
* 探针：每次 ``getMaybe`` 的键、``getMasterTableMaybe`` 的表；假容器的 ``getMasterTable`` 一调用就报错；
* 截断执行：只执行插入段（切片 [锚点, 原生入口) 接哨兵），未命中必须到达原生入口。

负对照：同一矩阵在未打补丁的基线（equipment-description-override 产物）上全部是原生结果、从不访问
custom_ability_string；变异体（删条件 / 删返回 / 前缀写错）必须让断言变红。
另附 CSV 往返：客户端 ``format.csv.Reader.parseUtf8Bytes`` 的逐状态移植，证明带引号的一格里逗号能保留。
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import io
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


rules = _load('equipment_enhanced_look_rules', HERE / 'rules.py')
look_interp = _load('equipment_enhanced_look_interp', HERE / 'look_interp.py')
AvmThrow, Cls, LookInterp, slice_method = (look_interp.AvmThrow, look_interp.Cls, look_interp.LookInterp,
                                           look_interp.slice_method)

BASE_ABC_SHA = '4994e23d612c24a7c13072bf641b9b11ca0aa2e36561cb3d521bda16e325c38b'

BASE_ICON = 'item/equipment/mod/paradox/paradox'
LV120 = 'item/equipment/mod/paradox/paradox_lv120'
LV200 = 'item/equipment/mod/paradox/paradox_lv200'
BLUEGOLD = 'item/equipment/mod/paradox/paradox_frame_bluegold'
OTHER = 'item/equipment/weapon/other_enhanced_5star'
STONE = 'item/stone_thumbnail'
T2 = rules.tier2_key(LV120)
FK = rules.frame_key(LV200)
PIXELART0_LEVEL = 120
PINK = 11                 # getRarityFrameIndex(Some(5), true) = 5 - 1 + 7

NONE_OPTION = {'index': 1, 'params': [], '_type': 'Option'}
TOOLS = 'pinball.ui.component.item::ItemThumbnailTools'
BIND = 'pinball.common.tools._FunctionTools::BindImpl1_0'
IMAGE = 'pinball.ui.display.image::TextureReplaceableImage'

#: 设计上的方法体 header（maxstack, localcount, initscope, maxscope）。maxstack 与作用域不变。
EXPECTED_HEADERS = {rules.PIXELART: [2, 12, 1, 2], rules.FRAME: [3, 13, 1, 2]}
#: 插入段允许出现的调用（callproperty/callpropvoid 的多名全名）；getMasterTable 不在其中。
ALLOWED_CALLS = {
    rules.PIXELART: {rules.MAYBE, 'get_data', 'getMaybe', rules.SPLIT, 'Some'},
    rules.FRAME: {rules.GET_LOGIC_ASSETS, rules.MAYBE, 'get_data', 'getMaybe', 'hideRarity', 'replaceBackgroundImage'},
}
RETURNS_IN_BLOCK = {rules.PIXELART: 1, rules.FRAME: 0}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def some(value):
    return {'index': 0, 'params': [value], '_type': 'Option'}


def decode(abc, label):
    return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])


class _Cas:
    """一张 custom_ability_string（键 -> string；值 None = 行存在但 string 为 null）+ 探针记录。"""

    def __init__(self, rows, loaded=True):
        self.rows = dict(rows or {})
        self.loaded = loaded
        self.maybe_calls, self.lookups = [], []
        self.cls = Cls(rules.CAS)
        self.assets = {'_type': 'ILogicAssetContainer', 'getMasterTableMaybe': self.table_maybe,
                       'getMasterTable': self.forbidden}

    def table_maybe(self, cls):
        self.maybe_calls.append(cls.name if isinstance(cls, Cls) else repr(cls))
        if cls is not self.cls:
            raise AssertionError(f'unexpected master table {cls!r}')
        return {'get_data': lambda: {'getMaybe': self.get_maybe}} if self.loaded else None

    def get_maybe(self, key):
        self.lookups.append(key)
        return {'string': self.rows[key]} if key in self.rows else None

    @staticmethod
    def forbidden(*_args):
        raise AssertionError('getMasterTable must not be called (it throws when a table is missing)')

    def probe(self):
        return {'maybe_tables': list(self.maybe_calls), 'lookups': list(self.lookups)}


def _lex_option():
    return Cls(rules.OPTION, **{'None': NONE_OPTION, 'Some': some})


# ---------------------------------------------------------------------------
# 1. 第二图标档：getPixelart + getPixelArtPathWithEnhancement
# ---------------------------------------------------------------------------

LEVELS = (0, 1, 119, 120, 121, 150, 199, 200, 201, 250)

ICON_SCENARIOS = {
    # 名称: (表行, 表已加载, 有强化行, logicAssets 非空, 期望第二档 (等级, 路径) 或 None)
    'tier2_hit': ({T2: rules.tier2_value(200, LV200)}, True, True, True, (200, LV200)),
    'tier2_at_121': ({T2: '121,' + LV200}, True, True, True, (121, LV200)),
    'tier2_equal_to_pixelart0_level': ({T2: '120,' + LV200}, True, True, True, (120, LV200)),
    'tier2_below_pixelart0_level': ({T2: '100,' + LV200}, True, True, True, (100, LV200)),
    'missing_key': ({}, True, True, True, None),
    'empty_value': ({T2: ''}, True, True, True, None),
    'null_value': ({T2: None}, True, True, True, None),
    'malformed_no_comma': ({T2: '200'}, True, True, True, None),
    'malformed_path_only': ({T2: LV200}, True, True, True, None),
    'malformed_empty_level': ({T2: ',' + LV200}, True, True, True, None),
    'malformed_empty_path': ({T2: '200,'}, True, True, True, None),
    'malformed_non_int': ({T2: 'abc,' + LV200}, True, True, True, None),
    'malformed_decimal': ({T2: '200.5,' + LV200}, True, True, True, None),
    'malformed_decimal_zero': ({T2: '200.0,' + LV200}, True, True, True, None),
    'malformed_leading_zero': ({T2: '0200,' + LV200}, True, True, True, None),
    'malformed_plus_sign': ({T2: '+200,' + LV200}, True, True, True, None),
    'malformed_space': ({T2: ' 200,' + LV200}, True, True, True, None),
    'malformed_exponent': ({T2: '2e2,' + LV200}, True, True, True, None),
    'malformed_hex': ({T2: '0xC8,' + LV200}, True, True, True, None),
    'malformed_int_overflow': ({T2: '4294967496,' + LV200}, True, True, True, None),   # int() 回绕成 200
    'malformed_infinity': ({T2: 'Infinity,' + LV200}, True, True, True, None),
    'malformed_three_parts': ({T2: '200,' + LV200 + ',x'}, True, True, True, None),
    'malformed_semicolon': ({T2: '200;' + LV200}, True, True, True, None),
    'other_icon_key_only': ({rules.tier2_key(OTHER): '200,' + LV200}, True, True, True, None),
    'frame_key_not_an_icon_key': ({rules.frame_key(LV120): '200,' + LV200}, True, True, True, None),
    'table_not_loaded': ({T2: '200,' + LV200}, False, True, True, None),
    'logic_assets_null': ({T2: '200,' + LV200}, True, True, False, None),
    'no_enhancement_row': ({T2: '200,' + LV200}, True, False, True, None),
}


def icon_expected(name, level):
    """该项的期望：('Some', 路径) / ('None',)；以及未打补丁（原生）时的结果。"""
    _rows, _loaded, has_values, _assets, tier = ICON_SCENARIOS[name]
    if not has_values or level < PIXELART0_LEVEL:
        return ('None',)
    if tier is not None and level >= tier[0]:
        return ('Some', tier[1])
    return ('Some', LV120)


def icon_native(name, level):
    has_values = ICON_SCENARIOS[name][2]
    return ('Some', LV120) if has_values and level >= PIXELART0_LEVEL else ('None',)


def _chain_value(option):
    return ('path', option[1] if option[0] == 'Some' else BASE_ICON)


def _summarize_option(value):
    if isinstance(value, dict) and value.get('_type') == 'Option':
        return ('Some', value['params'][0]) if value['index'] == 0 else ('None',)
    return ('other', repr(value))


class IconWorld:
    def __init__(self, name):
        rows, loaded, has_values, has_assets, _tier = ICON_SCENARIOS[name]
        self.cas = _Cas(rows, loaded)
        self.lex = {rules.CAS: self.cas.cls, rules.OPTION: _lex_option()}
        values = {'_type': 'EquipmentEnhancementValues', 'pixelart0': {'level': PIXELART0_LEVEL, 'value': LV120}}
        self.logic = {'_type': 'EquipmentEnhancementLogic', 'values': some(values) if has_values else NONE_OPTION,
                      'logicAssets': self.cas.assets if has_assets else None, 'id': 5920001}


def _run(abc, lex, label, args):
    try:
        return ('ok', LookInterp(abc, lex).run(decode(abc, label), list(args)))
    except AvmThrow as thrown:
        value = thrown.value
        return ('throw', value.get('code') if isinstance(value, dict) else repr(value))
    except (AssertionError, KeyError, TypeError, ValueError, AttributeError, IndexError) as exc:
        return ('error', type(exc).__name__, str(exc)[:160])


def run_icon(abc, name, level, method):
    world = IconWorld(name)
    if method == 'pixelart':
        status = _run(abc, world.lex, rules.PIXELART, [world.logic, level])
        result = _summarize_option(status[1]) if status[0] == 'ok' else status
    else:
        code = decode(abc, rules.PIXELART)
        world.logic['getPixelart'] = lambda lv: LookInterp(abc, world.lex).run(code, [world.logic, lv])
        general = {'_type': 'GeneralEquipmentLogic', 'enhancementLogic': world.logic,
                   'values': {'pixelart': BASE_ICON}}
        status = _run(abc, world.lex, 'GeneralEquipmentLogic/getPixelArtPathWithEnhancement', [general, level])
        result = ('path', status[1]) if status[0] == 'ok' else status
    return result, world.cas.probe()


ICON_METHODS = ('pixelart', 'chain')


def icon_expected_result(key):
    name, level, method = key
    value = icon_expected(name, level)
    return value if method == 'pixelart' else _chain_value(value)


def icon_native_result(key):
    name, level, method = key
    value = icon_native(name, level)
    return value if method == 'pixelart' else _chain_value(value)


ICON_KEYS = tuple((name, level, method) for name in ICON_SCENARIOS for level in LEVELS for method in ICON_METHODS)
ICON_EXPECTED = {key: icon_expected_result(key) for key in ICON_KEYS}
ICON_HITS = frozenset(key for key in ICON_KEYS if ICON_EXPECTED[key] != icon_native_result(key))


def icon_expected_probe(key):
    """打补丁后：只有达到 pixelart0 等级、有强化行、logicAssets 非空时才取表；表加载了才查一次 T2 键。"""
    name, level, _method = key
    rows, loaded, has_values, has_assets, _tier = ICON_SCENARIOS[name]
    if not has_values or level < PIXELART0_LEVEL or not has_assets:
        return {'maybe_tables': [], 'lookups': []}
    return {'maybe_tables': [rules.CAS], 'lookups': [T2] if loaded else []}


def icon_matrix(abc):
    results, probes = {}, {}
    for key in ICON_KEYS:
        results[key], probes[key] = run_icon(abc, *key)
    return results, probes


# ---------------------------------------------------------------------------
# 2. 强化框：一格缩略图的复用序列
# ---------------------------------------------------------------------------

ROWS_HIT = {FK: BLUEGOLD}
WEAPON = {'index': 0, 'params': [], '_type': 'EquipmentKind'}

FRAME_SCENARIOS = {
    # 名称: (表行, 表已加载, 步骤)
    'hit_lv200': (ROWS_HIT, True, [('equip', LV200, 5, True), ('flush',)]),
    'hit_lv200_texture_pending': (ROWS_HIT, True, [('equip', LV200, 5, True)]),
    'lv120_icon_keeps_pink': (ROWS_HIT, True, [('equip', LV120, 5, True), ('flush',)]),
    'missing_key': ({}, True, [('equip', LV200, 5, True), ('flush',)]),
    'empty_value': ({FK: ''}, True, [('equip', LV200, 5, True), ('flush',)]),
    'null_value': ({FK: None}, True, [('equip', LV200, 5, True), ('flush',)]),
    'table_not_loaded': (ROWS_HIT, False, [('equip', LV200, 5, True), ('flush',)]),
    'not_enhanced': (ROWS_HIT, True, [('equip', LV200, 5, False), ('flush',)]),
    'item_image_none': (ROWS_HIT, True, [('set_rarity', 5, True), ('flush',)]),
    'view_null_guard': (ROWS_HIT, True, [('equip', LV200, 5, True), ('flush',), ('drop_view',),
                                         ('set_rarity', 5, True)]),
    'reuse_bluegold_then_other_enhanced': (ROWS_HIT, True, [('equip', LV200, 5, True), ('flush',),
                                                            ('equip', OTHER, 5, True), ('flush',)]),
    'reuse_texture_arrives_after_reuse': (ROWS_HIT, True, [('equip', LV200, 5, True),
                                                           ('equip', OTHER, 5, True), ('flush',)]),
    'reuse_bluegold_then_lv120': (ROWS_HIT, True, [('equip', LV200, 5, True), ('flush',),
                                                   ('equip', LV120, 5, True), ('flush',)]),
    'reuse_bluegold_then_plain_item': (ROWS_HIT, True, [('equip', LV200, 5, True), ('flush',),
                                                        ('item', STONE, 3), ('flush',)]),
    'reuse_other_then_lv200': (ROWS_HIT, True, [('equip', OTHER, 5, True), ('flush',),
                                                ('equip', LV200, 5, True), ('flush',)]),
    'reuse_bluegold_twice': (ROWS_HIT, True, [('equip', LV200, 5, True), ('flush',), ('equip', OTHER, 5, True),
                                              ('flush',), ('equip', LV200, 5, True), ('flush',)]),
    'pass_reward_stone_enhanced': (ROWS_HIT, True, [('item', STONE, 5), ('set_rarity', 5, True), ('flush',)]),
}

_BG = ('background', BLUEGOLD)
_PINK = ('rarity', PINK)
FRAME_EXPECTED = {
    'hit_lv200': (_BG, True),
    'hit_lv200_texture_pending': (('background', None), True),
    'lv120_icon_keeps_pink': (_PINK, True),
    'missing_key': (_PINK, True),
    'empty_value': (_PINK, True),
    'null_value': (_PINK, True),
    'table_not_loaded': (_PINK, True),
    'not_enhanced': (('rarity', 5), False),
    'item_image_none': (_PINK, False),
    'view_null_guard': (_PINK, True),
    'reuse_bluegold_then_other_enhanced': (_PINK, True),
    'reuse_texture_arrives_after_reuse': (_PINK, True),
    'reuse_bluegold_then_lv120': (_PINK, True),
    'reuse_bluegold_then_plain_item': (('rarity', 3), False),
    'reuse_other_then_lv200': (_BG, True),
    'reuse_bluegold_twice': (_BG, True),
    'pass_reward_stone_enhanced': (_PINK, False),
}
#: 原生（未打补丁）结果：凡是期望蓝金底的地方都是粉框，其余相同。
FRAME_NATIVE = {name: ((_PINK, value[1]) if value[0][0] == 'background' else value)
                for name, value in FRAME_EXPECTED.items()}
FRAME_HITS = frozenset(name for name in FRAME_SCENARIOS if FRAME_EXPECTED[name] != FRAME_NATIVE[name])
#: 打补丁后每个场景 getMaybe 查到的键（按调用顺序）。
FRAME_EXPECTED_LOOKUPS = {
    'hit_lv200': [FK], 'hit_lv200_texture_pending': [FK], 'lv120_icon_keeps_pink': [rules.frame_key(LV120)],
    'missing_key': [FK], 'empty_value': [FK], 'null_value': [FK], 'table_not_loaded': [],
    'not_enhanced': [], 'item_image_none': [], 'view_null_guard': [FK],
    'reuse_bluegold_then_other_enhanced': [FK, rules.frame_key(OTHER)],
    'reuse_texture_arrives_after_reuse': [FK, rules.frame_key(OTHER)],
    'reuse_bluegold_then_lv120': [FK, rules.frame_key(LV120)],
    'reuse_bluegold_then_plain_item': [FK],
    'reuse_other_then_lv200': [rules.frame_key(OTHER), FK],
    'reuse_bluegold_twice': [FK, rules.frame_key(OTHER), FK],
    'pass_reward_stone_enhanced': [rules.frame_key(STONE)],
}


class _Callback:
    """setTexture 收到的回调（BindImpl1_0.execute）：kind = 'background' | 'item'。"""

    def __init__(self, fn, kind):
        self.fn, self.kind = fn, kind

    def __call__(self):
        return self.fn()


class FrameWorld:
    """一格缩略图：ItemThumbnailView（cell）+ ThumbnailFrameView（frame_view）+ 布局容器 + 异步贴图队列。"""

    ITEM_METHODS = ('setRarity', 'showEquipment', 'showItem', 'replaceItemImage', 'hideRarity',
                    'replaceBackgroundImage', 'backgroundTextureLoadCompleted', 'changeBackgroundImageTexture',
                    'setEquipmentFrame', 'showEnhancedEffectAnimation', 'hideEnhancedEffectAnimation')
    FRAME_METHODS = ('setRarity', 'hideRarity', 'addBackgroundImage', 'setOrbFrame', 'addBackgroundEffectAnimation')

    def __init__(self, abc, rows, loaded=True):
        self.abc = abc
        self.cas = _Cas(rows, loaded)
        self.pending = []          # 未到达的 setTexture 回调（_Callback）
        self.texture_requests = []
        self.containers = {name: self._container(name) for name in
                           ('background', 'background_effect', 'orb_frame', 'body')}
        self.rarity = {'_type': 'UiDisplayObjectContainer', 'renderingEnabled': True, 'frame': None,
                       'goto': self._goto}
        self.frame_view = {'_type': 'ThumbnailFrameView', 'rarity': NONE_OPTION, 'rarityBackground': self.rarity,
                           'frame': {'getContainer': lambda name, _info: self.containers[name]},
                           'orbFrame': NONE_OPTION, 'backgroundAnimation': NONE_OPTION}
        # ThumbnailFrameView.run：background_effect 先关；末尾 setRarity(rarity, false) 关 background、开 rarity
        self.containers['background']['renderingEnabled'] = False
        self.containers['background_effect']['renderingEnabled'] = False
        self.asset = {'setTexture': self.set_texture, 'getTexture': lambda path: {'_type': 'Texture', 'path': path},
                      'getAnimation': lambda path: {'_type': 'Animation', 'path': path, 'visible': False,
                                                    'touchable': True},
                      'globalLogic': {'getLogicAssets': lambda: self.cas.assets}}
        self.cell = {'_type': 'ItemThumbnailView', 'view': {'asset': self.asset}, 'itemImagePath': NONE_OPTION,
                     'frame': self.frame_view, 'backgroundImagePath': NONE_OPTION, 'backgroundImage': NONE_OPTION,
                     'enhancedEffectAnimation': NONE_OPTION, 'gear': {'checkPhaseBeforeDispose': lambda: True},
                     # 物品图标的加载完成回调（replaceItemImage 绑给 setTexture）：本矩阵不建模图标贴图，flush 不调它
                     'textureLoadCompleted': lambda _path: None}
        tools = Cls(TOOLS, ENHANCED_FRAME_ENABLE_RARITY=[5])
        tools_code = decode(abc, 'ItemThumbnailTools$/getRarityFrameIndex')
        tools.statics['getRarityFrameIndex'] = lambda r, e: LookInterp(abc, self.lex).run(tools_code, [tools, r, e])
        self.lex = {rules.CAS: self.cas.cls, rules.OPTION: _lex_option(), TOOLS: tools,
                    'pinball.asset::AssetGroupKind': Cls('AssetGroupKind', ItemThumbnail='ItemThumbnail'),
                    BIND: Cls(BIND, ctor=self.bind),
                    IMAGE: Cls(IMAGE, ctor=self.new_image),
                    'starling.utils::Align': Cls('Align', CENTER='center')}
        for name in self.ITEM_METHODS:
            self._bind(self.cell, name, 'ItemThumbnailView/' + name)
        for name in self.FRAME_METHODS:
            self._bind(self.frame_view, name, 'ThumbnailFrameView/' + name)

    @staticmethod
    def _container(name):
        box = {'_type': 'UiDisplayObjectContainer', 'name': name, 'renderingEnabled': True, 'children': []}
        box['addChild'] = lambda child: box['children'].append(child)
        box['removeChild'] = lambda child, _dispose=False: box['children'].remove(child)
        return box

    def _goto(self, index):
        self.rarity['frame'] = index

    def _bind(self, obj, name, label):
        code = decode(self.abc, label)
        obj[name] = lambda *args: LookInterp(self.abc, self.lex).run(code, [obj, *args])

    def bind(self, fn, arg):
        """BindImpl1_0(fn, arg).execute：记住它包的是背景图还是物品图标的加载完成。"""
        kind = 'background' if fn is self.cell['backgroundTextureLoadCompleted'] else 'item'
        return {'execute': _Callback(lambda: fn(arg), kind)}

    @staticmethod
    def new_image():
        image = {'_type': 'TextureReplaceableImage', 'texture': None, 'pivot': None}
        image['changeTexture'] = lambda option: image.__setitem__('texture', option['params'][0])
        image['alignPivot'] = lambda h, v: image.__setitem__('pivot', (h, v))
        return image

    def set_texture(self, _group, path, callback):
        """view.asset.setTexture：异步，回调排队，由 flush() 决定何时到达。"""
        self.texture_requests.append(path)
        self.pending.append(callback)

    def flush(self):
        """贴图加载完成：按请求顺序回调（物品图标的回调不建模，只跑背景图的回调）。"""
        callbacks, self.pending = self.pending, []
        for callback in callbacks:
            if callback.kind == 'background':
                callback()

    def state(self):
        """看到的框：rarity 容器开 -> ('rarity', 帧号)；否则 background 开 -> ('background', 贴图路径 | None)。"""
        background = self.containers['background']
        if self.rarity['renderingEnabled']:
            seen = ('rarity', self.rarity['frame'])
        elif background['renderingEnabled']:
            images = [c for c in background['children'] if c.get('texture')]
            seen = ('background', images[-1]['texture']['path'] if images else None)
        else:
            seen = ('hidden',)
        option = self.cell['enhancedEffectAnimation']
        sweep = bool(option['index'] == 0 and option['params'][0]['visible']
                     and self.containers['background_effect']['renderingEnabled'])
        return seen, sweep


def run_frame(abc, name):
    rows, loaded, steps = FRAME_SCENARIOS[name]
    world = FrameWorld(abc, rows, loaded)
    try:
        for step in steps:
            if step[0] == 'equip':
                world.cell['showEquipment'](step[1], step[2], step[3], WEAPON)
            elif step[0] == 'item':
                world.cell['showItem'](step[1], step[2])
            elif step[0] == 'set_rarity':
                world.cell['setRarity'](some(step[1]), step[2])
            elif step[0] == 'flush':
                world.flush()
            elif step[0] == 'drop_view':
                world.cell['view'] = None
            else:
                raise ValueError(step)
        result = world.state()
    except AvmThrow as thrown:
        value = thrown.value
        result = ('throw', value.get('code') if isinstance(value, dict) else repr(value))
    except (AssertionError, KeyError, TypeError, ValueError, AttributeError, IndexError) as exc:
        result = ('error', type(exc).__name__, str(exc)[:160])
    return result, world.cas.probe(), list(world.texture_requests)


def frame_matrix(abc):
    results, probes, textures = {}, {}, {}
    for name in FRAME_SCENARIOS:
        results[name], probes[name], textures[name] = run_frame(abc, name)
    return results, probes, textures


# ---------------------------------------------------------------------------
# 3. 截断执行：只跑插入段，未命中必须到达原生入口（哨兵返回 this）
# ---------------------------------------------------------------------------

def native_entry(abc, label):
    """补丁体里原生入口的位置（=插入段末尾）；未打补丁时为锚点。"""
    ins = decode(abc, label)
    at = rules.ANCHORS[label]
    name, operand = rules.NATIVE_AT_ANCHOR[label][1]

    def native_here(index):
        x = ins[index] if index < len(ins) else None
        return x is not None and x.name == name and (operand is None or abc.mn_name(x.args[0]) == operand)

    for entry in (at, at + rules.INSERTED_COUNTS[label]):
        if native_here(entry):
            return ins, at, entry
    raise AssertionError(f'{label}: native entry not found at #{at} or after the inserted block')


def fallthrough(abc):
    """{键: 'native_entry' | 命中结果}：图标按 (场景, 等级)，框按场景的最后一步（直接调插入段）。"""
    out = {}
    epilogue = asm.assemble([('getlocal_0',), ('returnvalue',)])
    ins, at, entry = native_entry(abc, rules.PIXELART)
    code = slice_method(ins, at, entry, epilogue)
    for name in ICON_SCENARIOS:
        for level in LEVELS:
            world = IconWorld(name)
            if not ICON_SCENARIOS[name][2] or level < PIXELART0_LEVEL:
                continue                           # 原生根本不进 Some 分支
            pixelart0 = world.logic['values']['params'][0]['pixelart0']
            try:
                value = LookInterp(abc, world.lex).run(code, [world.logic, level, None, pixelart0])
            except Exception as exc:  # noqa: BLE001 —— 任何异常都是失败
                out[('icon', name, level)] = ('error', type(exc).__name__, str(exc)[:160])
                continue
            out[('icon', name, level)] = 'native_entry' if value is world.logic else _summarize_option(value)
    ins, at, entry = native_entry(abc, rules.FRAME)
    code = slice_method(ins, at, entry, epilogue)
    for name in FRAME_SCENARIOS:
        rows, loaded, _steps = FRAME_SCENARIOS[name]
        for enhanced, path in ((True, LV200), (False, LV200), (True, None)):
            world = FrameWorld(abc, rows, loaded)
            world.cell['itemImagePath'] = some(path) if path else NONE_OPTION
            calls = []
            world.cell['hideRarity'] = lambda: calls.append('hideRarity')
            world.cell['replaceBackgroundImage'] = lambda value: calls.append(('replaceBackgroundImage', value))
            try:
                value = LookInterp(abc, world.lex).run(code, [world.cell, some(5), enhanced])
            except Exception as exc:  # noqa: BLE001
                out[('frame', name, enhanced, path)] = ('error', type(exc).__name__, str(exc)[:160])
                continue
            out[('frame', name, enhanced, path)] = ('native_entry' if value is world.cell else 'escaped', calls)
    return out


def fallthrough_expected(key):
    if key[0] == 'icon':
        _kind, name, level = key
        value = icon_expected(name, level)
        return 'native_entry' if value == ('Some', LV120) else value
    _kind, name, enhanced, path = key
    rows, loaded, _steps = FRAME_SCENARIOS[name]
    hit = enhanced and path == LV200 and loaded and rows.get(FK)
    return ('native_entry', ['hideRarity', ('replaceBackgroundImage', rows[FK])] if hit else [])


# ---------------------------------------------------------------------------
# 4. 静态证明：插入段只写新局部、只调白名单、出口只有原生入口；原生部分逐字节可还原
# ---------------------------------------------------------------------------

def _stack_empty_at(body_after, entry, multinames):
    """整方法可算通；在原生入口前插一条 pop 必然在该处下溢 => 所有到达原生入口的路径栈深都为 0。"""
    patched = asm.decode(body_after[5])
    asm.simulate([asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in patched],
                 body_after[3], multinames)
    probe = list(body_after)
    try:
        _code, _exc, merged = asm.splice(probe, entry, [asm.Instruction(0x29)], incoming=asm.ENTER)
        asm.simulate(merged, body_after[3], multinames)
    except asm.AsmError as exc:
        return f'stack underflow at #{entry} ' in str(exc)
    return False


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
        written, read, calls, names, strings = set(), set(), set(), set(), []
        for x in block:
            if x.op in (0x63, 0xD4, 0xD5, 0xD6, 0xD7):
                written.add(x.args[0] if x.op == 0x63 else x.op - 0xD4)
            elif x.op in (0x62, 0xD0, 0xD1, 0xD2, 0xD3):
                read.add(x.args[0] if x.op == 0x62 else x.op - 0xD0)
            elif x.op in (0x92, 0x94, 0xC2, 0xC3, 0x08, 0x32):
                written.add(-1)                      # 不允许任何原地改局部的指令
            if x.name in ('callproperty', 'callpropvoid', 'callproplex', 'callsuper', 'callsupervoid',
                          'callmethod', 'callstatic', 'call', 'construct', 'constructsuper', 'constructprop'):
                calls.add(out_abc.mn_name(x.args[0]) if x.name.startswith(('callprop', 'constructprop'))
                          else x.name)
            if x.name in ('getproperty', 'setproperty', 'initproperty', 'getlex', 'findpropstrict', 'coerce'):
                names.add(out_abc.mn_name(x.args[0]) if x.args[0] != rules.MULTINAME_L else 'MultinameL')
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
            'new_locals_start_at_old_localcount': min(new_locals) == locks[label]['header'][1] == before[2],
            'calls': sorted(calls),
            'calls_whitelisted': calls <= ALLOWED_CALLS[label],
            'never_calls_getMasterTable': rules.GET_MASTER not in calls and rules.GET_MASTER not in names,
            'no_property_writes': not [x for x in block if x.name in ('setproperty', 'initproperty', 'setslot',
                                                                         'setsuper', 'deleteproperty')],
            'strings': strings,
            'branches_stay_in_block_or_exit_to_native_entry': all(at <= t <= entry for t in inner_targets),
            'no_outside_branch_into_block': not [i for i, x in enumerate(patched)
                                                 if not at <= i < entry and (
                                                     (x.target is not None and at < x.target < entry) or
                                                     (x.cases and any(at < t < entry for t in [x.default, *x.cases])))],
            'no_scope_or_exception_change': not [x for x in block if x.op in (0x1C, 0x1D, 0x30, 0x03)]
            and after[6] == before[6] == [] and after[7] == before[7],
            'returns_in_block': sum(1 for x in block if x.op in (0x47, 0x48)),
            'stack_empty_at_native_entry': _stack_empty_at(after, entry, out_abc.multinames),
        }
        item['ok'] = (n == rules.INSERTED_COUNTS[label] and item['native_restored_byte_identical']
                      and item['header_after'] == EXPECTED_HEADERS[label] and item['writes_only_new_locals']
                      and item['reads_only_allowed_registers'] and item['new_locals_start_at_old_localcount']
                      and item['calls_whitelisted'] and item['never_calls_getMasterTable']
                      and item['no_property_writes']
                      and item['branches_stay_in_block_or_exit_to_native_entry']
                      and item['no_outside_branch_into_block'] and item['no_scope_or_exception_change']
                      and item['returns_in_block'] == RETURNS_IN_BLOCK[label]
                      and item['stack_empty_at_native_entry'])
        ok = ok and item['ok']
        report[label] = item
    report['ok'] = ok
    return report


# ---------------------------------------------------------------------------
# 5. 结构 / 保持 / 复现
# ---------------------------------------------------------------------------

def _independent():
    return _load('equipment_enhanced_look_independent_abc', PATCH_ROOT / 'rank-scene-p2/independent/myabc.py')


def stacked_labels():
    """叠加链上必须逐字节不变的既有补丁方法体（按标签）：取各补丁自己登记的常量，不手抄。"""
    desc_verify = _load('equipment_desc_override_verify', PATCH_ROOT / 'equipment-description-override/verify.py')
    br_locks = json.loads((PATCH_ROOT / 'battle-rules/baseline.json').read_text(encoding='utf8'))
    return (tuple(desc_verify.rules.TARGETS) + desc_verify.EQUIPMENT_RULES_BODIES + desc_verify.EQUIPMENT_RULES_ADDED
            + tuple(br_locks) + desc_verify.BR_ADDED + ('MemberImpl/applyInstantAbility',)
            + desc_verify.KYUBI_BODIES)


def preservation(base: SwfAbc, out: SwfAbc):
    m = _independent()
    a, b = m.parse_abc(base.abc.serialize()), m.parse_abc(out.abc.serialize())
    locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
    locked = sorted(v['index'] for v in locks.values())
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
    overlay = _load('equipment_enhanced_look_overlay', HERE / 'overlay.py')
    rebuilt = SwfAbc(base_path)
    overlay.patch_editor(rebuilt)
    return rebuilt.abc.serialize() == out.abc.serialize()


# ---------------------------------------------------------------------------
# 6. CSV：客户端 format.csv.Reader.parseUtf8Bytes 的逐状态移植（MasterBinarySlice.getRow 取第 0 行）
# ---------------------------------------------------------------------------

class CsvReaderError(ValueError):
    pass


def client_parse_csv(data: bytes) -> list[list[str]]:
    """``format.csv.Reader.parseUtf8Bytes``（弹国服/scripts/format/csv/Reader.as）的移植：状态 1 行首/格首，
    2 普通格，3 引号内，4 引号内遇到引号，5 CR 之后；``""`` 在引号格里还原成 ``"``；validateRowWidth=true。"""
    rows, row = [[]], None
    row = rows[0]
    state, pos, start = 1, 0, 0
    quoted = escaped = False
    n = len(data)

    def cell(end):
        text = data[start:end - 1 if quoted else end].decode('utf8')
        return text.replace('""', '"') if escaped else text

    while pos < n:
        c = data[pos]
        if state == 3:
            if c == 34:
                state, pos = 4, pos + 1
            else:
                pos += 1
            continue
        if state == 4 and c not in (10, 13, 34, 44):
            raise CsvReaderError('InvalidClosingQuote')
        if state == 4 and c == 34:
            state, escaped, pos = 3, True, pos + 1
            continue
        if state == 2 and c == 34:
            raise CsvReaderError('InvalidOpeningQuote')
        if state == 5 and c == 10:
            state, pos = 1, pos + 1
            start = pos
            continue
        if c in (10, 13):
            row.append(cell(pos))
            quoted = escaped = False
            row = []
            rows.append(row)
            state = 1 if c == 10 else 5
            pos += 1
            start = pos
        elif c == 44:
            row.append(cell(pos))
            quoted = escaped = False
            state = 1
            pos += 1
            start = pos
        elif c == 34 and state in (1, 5):
            quoted, state = True, 3
            pos += 1
            start = pos
        else:
            state = 2
            pos += 1
    if state == 3:
        raise CsvReaderError('UnclosedQuote')
    row.append(cell(pos))
    if len(row) == 1 and pos == start:
        rows.pop()
    widths = {len(r) for r in rows}
    if len(widths) > 1:
        raise CsvReaderError('InvalidRowWidth')
    return rows


def client_get_row_string(encoded: bytes) -> str:
    """CustomAbilityStringValues.string = MasterBinarySlice.getRow()[0]（getRow 取解析结果的第 0 行，空则 [""]）。"""
    rows = client_parse_csv(encoded)
    row = rows[0] if rows else None
    return (row or [''])[0]


def csv_writer_row(value: str) -> bytes:
    """mod-tools/wf_mod_tool.write_csv_lines 同款写法（csv.writer, QUOTE_MINIMAL, lineterminator=""）。"""
    buf = io.StringIO()
    csv.writer(buf, lineterminator='').writerow([value])
    return buf.getvalue().encode('utf8')


def csv_roundtrip():
    value = rules.tier2_value(200, LV200)
    encoded = csv_writer_row(value)
    unquoted = value.encode('utf8')
    multiline = 'A\nB,C'
    return {
        'value': value,
        'csv_writer_row': encoded.decode('utf8'),
        'csv_writer_quotes_the_cell': encoded.startswith(b'"') and encoded.endswith(b'"'),
        'client_reads_back_the_whole_value': client_get_row_string(encoded) == value,
        'unquoted_row_loses_the_path': client_get_row_string(unquoted) == '200',
        'multiline_cell_roundtrip': client_get_row_string(csv_writer_row(multiline)) == multiline,
        'frame_value_roundtrip': client_get_row_string(csv_writer_row(BLUEGOLD)) == BLUEGOLD,
    }


# ---------------------------------------------------------------------------
# 7. 变异体（负对照）
# ---------------------------------------------------------------------------

def _drop(sequence):
    """删掉插入段里第一处与 sequence 完全相同的连续片段（找不到就报错，变异体不许静默落空）。"""
    def mutate(e, label, code):
        seq = sequence(e, label)
        if seq is None:
            return code
        for i in range(len(code) - len(seq) + 1):
            if code[i:i + len(seq)] == seq:
                return code[:i] + code[i + len(seq):]
        raise AssertionError(f'{label}: mutant sequence not found: {seq}')
    return mutate


def _frame_only(build):
    return lambda e, label: build(e) if label == rules.FRAME else None


def _pixelart_only(build):
    return lambda e, label: build(e) if label == rules.PIXELART else None


def mutant_frame_text_guard(e, label, code):
    """删掉「string 为空串 / null」这一道（只删第二次出现的 text 判空）。"""
    if label != rules.FRAME:
        return code
    text = rules.LOCALS[rules.FRAME]['text']
    guard = [('getlocal', text), ('iffalse', 'SKIP')]
    hits = [i for i in range(len(code) - 1) if code[i:i + 2] == guard]
    if len(hits) != 2:
        raise AssertionError(f'expected two text guards, found {hits}')
    return code[:hits[1]] + code[hits[1] + 2:]


def mutant_return_dropped(e, label, code):
    """命中后不返回（returnvalue → pop），落回原生 Some(path0)。"""
    return [('pop',) if item == ('returnvalue',) else item for item in code]


def mutant_wrong_prefixes(e, label, code):
    """两个前缀互换（键拼错）。"""
    swap = {e.string(rules.TIER2_PREFIX): e.string(rules.FRAME_PREFIX),
            e.string(rules.FRAME_PREFIX): e.string(rules.TIER2_PREFIX)}
    return [swap.get(item, item) for item in code]


MUTANTS = {
    # 删掉「enhanced 参数为真」这道条件：非强化态也换蓝金底
    'frame_enhanced_condition_deleted': _drop(_frame_only(lambda e: [('getlocal_2',), ('iffalse', 'SKIP')])),
    'frame_text_guard_deleted': mutant_frame_text_guard,
    # 删掉「level >= 第二档等级」这道条件：Lv120–199 也显示 lv200 图标
    'pixelart_level_condition_deleted': _drop(_pixelart_only(lambda e: [
        ('getlocal_1',), ('getlocal', rules.LOCALS[rules.PIXELART]['level']), ('convert_i',), ('iflt', 'SKIP')])),
    # 删掉规范整数校验：abc / 小数 / 前导 0 等被当成 0 或截断值
    'pixelart_int_condition_deleted': _drop(_pixelart_only(lambda e: [
        ('getlocal', rules.LOCALS[rules.PIXELART]['level']), ('convert_i',), ('convert_s',),
        ('getlocal', rules.LOCALS[rules.PIXELART]['level']), ('ifstrictne', 'SKIP')])),
    # 删掉「恰好两段」：三段值被接受
    'pixelart_two_parts_condition_deleted': _drop(_pixelart_only(lambda e: [
        ('getlocal', rules.LOCALS[rules.PIXELART]['parts']), ('getproperty', e.q('length')), ('pushbyte', 2),
        ('ifne', 'SKIP')])),
    'pixelart_return_dropped': mutant_return_dropped,
    'wrong_prefixes': mutant_wrong_prefixes,
}
#: 每个变异体至少要让这些断言变红（其余变红项也记录）。
MUTANT_TARGETS = {
    'frame_enhanced_condition_deleted': [('frame', 'not_enhanced')],
    'frame_text_guard_deleted': [('frame', 'empty_value')],
    'pixelart_level_condition_deleted': [('icon', 'tier2_hit', 150, 'pixelart'), ('icon', 'tier2_hit', 199, 'chain')],
    'pixelart_int_condition_deleted': [('icon', 'malformed_non_int', 120, 'pixelart'),
                                       ('icon', 'malformed_decimal', 200, 'chain')],
    'pixelart_two_parts_condition_deleted': [('icon', 'malformed_three_parts', 200, 'pixelart')],
    'pixelart_return_dropped': [('icon', 'tier2_hit', 200, 'pixelart')],
    'wrong_prefixes': [('icon', 'tier2_hit', 200, 'pixelart'), ('frame', 'hit_lv200')],
}


def red_assertions(abc):
    """在给定 ABC 上跑两张矩阵，返回所有与期望不符的断言键。"""
    red = []
    icon, _ = icon_matrix(abc)
    for key, value in icon.items():
        if value != ICON_EXPECTED[key]:
            red.append(('icon', *key))
    frame, _, _ = frame_matrix(abc)
    for name, value in frame.items():
        if value != FRAME_EXPECTED[name]:
            red.append(('frame', name))
    return red


def mutant_matrix(base_path: Path):
    overlay = _load('equipment_enhanced_look_overlay', HERE / 'overlay.py')
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
    icon, icon_probes = icon_matrix(out.abc)
    frame, frame_probes, frame_textures = frame_matrix(out.abc)
    report['icon_matrix_size'], report['icon_hit_count'] = len(icon), len(ICON_HITS)
    report['frame_matrix_size'], report['frame_hit_count'] = len(frame), len(FRAME_HITS)
    report['icon_mismatches'] = {_key(k): [icon[k], v] for k, v in ICON_EXPECTED.items() if icon[k] != v}
    report['icon_probe_mismatches'] = {_key(k): [icon_probes[k], icon_expected_probe(k)] for k in ICON_KEYS
                                       if icon_probes[k] != icon_expected_probe(k)}
    report['frame_mismatches'] = {k: [frame[k], v] for k, v in FRAME_EXPECTED.items() if frame[k] != v}
    report['frame_lookup_mismatches'] = {k: [frame_probes[k]['lookups'], v] for k, v in FRAME_EXPECTED_LOOKUPS.items()
                                         if frame_probes[k]['lookups'] != v}
    report['frame_background_requests'] = {k: [p for p in v if p == BLUEGOLD] for k, v in frame_textures.items()}
    fall = fallthrough(out.abc)
    report['fallthrough_mismatches'] = {_key(k): [v, fallthrough_expected(k)] for k, v in fall.items()
                                        if v != fallthrough_expected(k)}
    report['csv'] = csv_roundtrip()
    ok = not (report['icon_mismatches'] or report['icon_probe_mismatches'] or report['frame_mismatches']
              or report['frame_lookup_mismatches'] or report['fallthrough_mismatches']) \
        and all(v for k, v in report['csv'].items() if k not in ('value', 'csv_writer_row'))
    if base_path is not None:
        base_path = Path(base_path)
        base = SwfAbc(base_path)
        report['base_sha256'] = sha(base_path.read_bytes())
        report['base_abc_sha256'] = sha(base.abc.serialize())
        report['preservation'] = preservation(base, out)
        report['static_proof'] = static_proof(base.abc, out.abc)
        report['reproducible_from_base'] = reproduce(base_path, out)
        native_icon, native_icon_probes = icon_matrix(base.abc)
        native_frame, native_frame_probes, _ = frame_matrix(base.abc)
        report['negative_control'] = {
            'icon_hits_passing_on_base': sorted(_key(k) for k in ICON_HITS if native_icon[k] == ICON_EXPECTED[k]),
            'icon_base_not_native': {_key(k): [native_icon[k], icon_native_result(k)] for k in ICON_KEYS
                                     if native_icon[k] != icon_native_result(k)},
            'frame_hits_passing_on_base': sorted(k for k in FRAME_HITS if native_frame[k] == FRAME_EXPECTED[k]),
            'frame_base_not_native': {k: [native_frame[k], FRAME_NATIVE[k]] for k in FRAME_SCENARIOS
                                      if native_frame[k] != FRAME_NATIVE[k]},
            'base_touches_custom_ability_string': sorted(
                [_key(k) for k, v in native_icon_probes.items() if v['maybe_tables'] or v['lookups']]
                + [k for k, v in native_frame_probes.items() if v['maybe_tables'] or v['lookups']]),
        }
        neg = report['negative_control']
        ok = ok and report['base_abc_sha256'] == BASE_ABC_SHA and report['preservation']['ok'] \
            and report['static_proof']['ok'] and report['reproducible_from_base'] \
            and not any(neg.values())
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
