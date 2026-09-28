"""独立核验 equipment-enhanced-party-frame 输出 SWF：结构、字节级保持、可复现、行为矩阵、负对照与变异体。

    python -X utf8 client-patch/equipment-enhanced-party-frame/verify.py <out.swf> --base <equipment-enhanced-look.swf>

行为矩阵直接执行 SWF 里的真实字节码（party_interp = v1 的 look_interp）：一格编成装备槽
（``PartyItemThumbnailView`` 的 run / setItemImage / setRarity / updateEmpty / updateEnhancedEffectAnimation /
replaceEquipment / replaceAbilitySoul / textureLoadCompleted / show|hideEnhancedEffectAnimation /
add|removeBackgroundEffectAnimation / removeEnhancedEffect / dispose，``ItemThumbnailTools.getRarityFrameIndex``，
全部真实字节码）先经 run() 建起来，再按步骤序列复用；贴图异步回调由测试决定何时到达，已就绪的贴图同步回调
（与 ``ViewAssetCache.listenLoadTexture`` 的 Loaded 分支相同）。显示对象是带属性的 Python 对象（Starling 语义：
``getChildAt`` 越界抛 RangeError、``transformationMatrix`` 的 setter 复制矩阵）。最后读 rarity 容器与
image 容器第 0 位的自建图得出「看到的框」。

探针：每次 ``getMaybe`` 的键、``getMasterTableMaybe`` 的调用、框图载图请求、自建图个数；
假容器的 ``getMasterTable`` 一调用就报错；``setTexture`` 同步重入超过 8 层按「真机会栈溢出」判失败；
自建图一旦被 ``changeTexture(None)``（会 dispose 共享贴图）就报错。

负对照：同一矩阵在未打补丁的基线（equipment-enhanced-look 产物 e87371b7）上全部是原生结果、从不访问
custom_ability_string、从不建图、从不请求框图；变异体（删条件 / 删恢复 / 不藏粉框 / 删探测 / 删尺寸 / 删矩阵 /
不认名字 / 放到图标上面 / 前缀写错 / 删空串判定 / 删 dispose 判定）必须让断言变红。
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


rules = _load('equipment_enhanced_party_frame_rules', HERE / 'rules.py')
party_interp = _load('equipment_enhanced_party_frame_interp', HERE / 'party_interp.py')
AvmThrow, Cls, PartyInterp, slice_method = (party_interp.AvmThrow, party_interp.Cls, party_interp.PartyInterp,
                                            party_interp.slice_method)

BASE_ABC_SHA = 'e87371b709c41b661a48834a40feb10e7379324470ec98f8e3eaf157c148ecce'

LV200 = 'item/equipment/mod/paradox/paradox_lv200'
LV120 = 'item/equipment/mod/paradox/paradox_lv120'
OTHER = 'item/equipment/weapon/other_enhanced_5star'
OTHER2 = 'item/equipment/weapon/other_enhanced_5star_2'
SOUL = 'item/ability_soul/some_soul'
FRAME = 'item/equipment/mod/paradox/paradox_party_frame_bluegold'
FRAME2 = 'item/equipment/weapon/other_party_frame'
V1_FRAME = 'item/equipment/mod/paradox/paradox_frame_bluegold'
V1_FRAME_KEY = 'enhanced_frame_override_' + LV200
PK = rules.party_frame_key(LV200)
PINK, RAINBOW, EMPTY = 11, 5, 6          # getRarityFrameIndex(Some(5), true) / (Some(5), false) / (None, false)

NONE_OPTION = {'index': 1, 'params': [], '_type': 'Option'}
TOOLS = 'pinball.ui.component.item::ItemThumbnailTools'
EMPTY_TYPE = 'pinball.ui.component.item.party::PartyItemThumbnailEmptyType'
UI_TOOLS = 'pinball.ui.provider::UiProviderTools'
SMOOTHING = 'starling.textures::TextureSmoothing'
ALIGN = 'starling.utils::Align'
METHODS = ('run', 'setItemImage', 'setRarity', 'updateEmpty', 'updateEnhancedEffectAnimation', 'replaceEquipment',
           'replaceAbilitySoul', 'textureLoadCompleted', 'showEnhancedEffectAnimation', 'hideEnhancedEffectAnimation',
           'addBackgroundEffectAnimation', 'removeBackgroundEffectAnimation', 'removeEnhancedEffect', 'dispose')
LAYOUT_CONTAINERS = ('rarity', 'image', 'background_effect', 'empty_text', 'empty_plus', 'empty_ability_soul_text',
                     'empty_ability_soul_plus', 'used_overlay')
#: 设计上的方法体 header（maxstack, localcount, initscope, maxscope）。
EXPECTED_HEADERS = {rules.LABEL: [4, 15, 1, 2]}
#: 插入段允许出现的调用（callproperty/callpropvoid/constructprop 的多名全名）；getMasterTable / getTexture 不在其中。
ALLOWED_CALLS = {'checkPhaseBeforeDispose', 'getContainer', 'getChildAt', rules.GET_LOGIC_ASSETS, rules.MAYBE,
                 'get_data', 'getMaybe', 'forEach', 'setTexture', rules.IMAGE, 'addChildAt', 'Some', 'changeTexture',
                 'readjustSize'}
ALLOWED_LEX = {rules.CAS, rules.GROUP, rules.OPTION, rules.IMAGE}
#: 段内的属性写与方法副作用：(名字, 接收者局部)。只准写自建图与 rarity 容器，只准往 image 容器加子节点。
EXPECTED_WRITES = {('name', 'img'), ('visible', 'img'), ('visible', 'rarity'), ('transformationMatrix', 'img')}
EXPECTED_VOID_CALLS = {('setTexture', 'asset'), ('addChildAt', 'holder'), ('changeTexture', 'img'),
                       ('readjustSize', 'img')}
EXPECTED_STRINGS = [rules.RARITY_CONTAINER, rules.IMAGE_CONTAINER, rules.PREFIX, rules.PREFIX, rules.PREFIX]
REENTRY_LIMIT = 8


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def some(value):
    return {'index': 0, 'params': [value], '_type': 'Option'}


def decode(abc, label):
    return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])


# ---------------------------------------------------------------------------
# Starling 显示对象替身
# ---------------------------------------------------------------------------

class Matrix:
    """flash.geom.Matrix（只比较六个分量）。"""

    def __init__(self, a=1.0, b=0.0, c=0.0, d=1.0, tx=0.0, ty=0.0):
        self.a, self.b, self.c, self.d, self.tx, self.ty = a, b, c, d, tx, ty

    def values(self):
        return (self.a, self.b, self.c, self.d, self.tx, self.ty)

    def __eq__(self, other):
        return isinstance(other, Matrix) and self.values() == other.values()

    def __hash__(self):
        return hash(self.values())

    def __repr__(self):
        return 'Matrix%r' % (self.values(),)


#: 布局 party_equipment_thumbnail 里 rarity 容器的矩阵（item_thumbnail.ui：a = d = 2.02777099609375，tx = ty = -73）。
RARITY_MATRIX = Matrix(2.02777099609375, 0, 0, 2.02777099609375, -73, -73)


class DisplayObject:
    def __init__(self, kind, name=None):
        self._kind = kind
        self.name = name
        self.visible = True
        self.touchable = True
        self.alpha = 1.0
        self._matrix = Matrix()
        self._disposed = False
        self.parent = None

    @property
    def transformationMatrix(self):
        return self._matrix

    @transformationMatrix.setter
    def transformationMatrix(self, value):
        """Starling ``set transformationMatrix``：``_transformationMatrix.copyFrom(matrix)``。"""
        if not isinstance(value, Matrix):
            raise AvmThrow({'code': 'TypeError', 'message': f'transformationMatrix = {value!r}'})
        self._matrix = Matrix(*value.values())

    def dispose(self):
        self._disposed = True

    def __repr__(self):
        return f'<{self._kind} {self.name!r}>'


class Container(DisplayObject):
    def __init__(self, kind, name=None):
        super().__init__(kind, name)
        self.children = []
        self.renderingEnabled = True

    @property
    def numChildren(self):
        return len(self.children)

    def getChildAt(self, index):
        n = len(self.children)
        if index < 0:
            index += n
        if not 0 <= index < n:
            raise AvmThrow({'code': 'RangeError', 'message': 'Invalid child index'})
        return self.children[index]

    def addChildAt(self, child, index):
        if not 0 <= index <= len(self.children):
            raise AvmThrow({'code': 'RangeError', 'message': 'Invalid child index'})
        if child.parent is not None:
            child.parent.children.remove(child)
        self.children.insert(index, child)
        child.parent = self
        return child

    def addChild(self, child):
        return self.addChildAt(child, len(self.children))

    def removeChild(self, child, dispose=False):
        if child in self.children:
            self.children.remove(child)
            child.parent = None
            if dispose:
                child.dispose()
        return child


class RarityContainer(Container):
    """``rarity`` 容器：``goto`` 只切换**声明过的**子图（这里用帧号代表），从不改容器自身的 visible。"""

    def __init__(self):
        super().__init__('UiDisplayObjectContainer', 'rarity')
        self.frame = 1
        self.requiresTransform = False
        self._matrix = Matrix(*RARITY_MATRIX.values())

    def goto(self, index):
        if index < 1 or (not self.requiresTransform and self.frame == index):
            return
        self.frame = index
        self.requiresTransform = False


class Layout(Container):
    def __init__(self, world):
        super().__init__('UiDisplayObjectContainer', 'layout/party_equipment_thumbnail')
        self.world = world
        self.containers = {}
        for name in LAYOUT_CONTAINERS:
            box = RarityContainer() if name == 'rarity' else Container('UiDisplayObjectContainer', name)
            self.containers[name] = box
            self.addChild(box)

    def getContainer(self, name, _info=None):
        if name not in self.containers:
            raise AvmThrow({'code': 7700, 'message': name})
        return self.containers[name]

    @staticmethod
    def getGuideRectangle(name, _info=None):
        return {'_type': 'Rectangle', 'name': name, 'x': -80, 'y': -80, 'width': 160, 'height': 160}


class Image(DisplayObject):
    """``TextureReplaceableImage``（Starling ``Image(null)`` 子类）。"""

    def __init__(self, world):
        super().__init__('TextureReplaceableImage')
        self.world = world
        self.texture = None
        self.size = (0, 0)
        self.scale = 1
        self.textureSmoothing = 'bilinear'          # Starling 默认；粉图 smoothing=true 同为双线性
        self.pivot = None

    def changeTexture(self, option):
        if self._disposed:
            return
        if option['index'] == 0:
            self.texture = option['params'][0]
            self.readjustSize()
        else:
            if self.name == rules.PREFIX:
                raise AssertionError('changeTexture(None) disposes the shared frame texture; the patch must not call it')
            if self.texture is not None:
                self.texture['disposed'] = True
            self.texture = None

    def readjustSize(self, width=-1, height=-1):
        if self._disposed:
            return
        frame = self.texture['size'] if self.texture else self.size
        self.size = (width if width > 0 else frame[0], height if height > 0 else frame[1])

    def alignPivot(self, horizontal, vertical):
        self.pivot = (horizontal, vertical)


class _Cas:
    """一张 custom_ability_string（键 -> string；值 None = 行存在但 string 为 null）+ 探针记录。"""

    def __init__(self, rows, loaded=True):
        self.rows = dict(rows or {})
        self.loaded = loaded
        self.maybe_calls, self.lookups = 0, []
        self.cls = Cls(rules.CAS)
        self.assets = {'_type': 'ILogicAssetContainer', 'getMasterTableMaybe': self.table_maybe,
                       'getMasterTable': self.forbidden}

    def table_maybe(self, cls):
        self.maybe_calls += 1
        if cls is not self.cls:
            raise AssertionError(f'unexpected master table {cls!r}')
        return {'get_data': lambda: {'getMaybe': self.get_maybe}} if self.loaded else None

    def get_maybe(self, key):
        self.lookups.append(key)
        return {'string': self.rows[key]} if key in self.rows else None

    @staticmethod
    def forbidden(*_args):
        raise AssertionError('getMasterTable must not be called (it throws when a table is missing)')


# ---------------------------------------------------------------------------
# 一格编成装备槽
# ---------------------------------------------------------------------------

class PartyWorld:
    """PartyItemThumbnailView（cell）+ 布局 + 一个 ItemThumbnail 贴图缓存（异步，回调排队）。"""

    def __init__(self, abc, rows=None, table_loaded=True, preloaded=(), icon=None, rarity=None, enhanced=None):
        self.abc = abc
        self.cas = _Cas(rows, table_loaded)
        self.loaded = {}
        for item in preloaded:
            path, size = (item, (72, 72)) if isinstance(item, str) else item
            self.loaded[path] = self._texture(path, size)
        self.pending = []                       # [(path, callback)]
        self.requests = []
        self.depth = 0
        self.alive = True
        self.images = []                        # 全部 new TextureReplaceableImage()
        self.layout = Layout(self)
        self.layer = Container('Sprite', 'layer')
        self.asset = {
            'setTexture': self.set_texture, 'getTexture': self.get_texture,
            '_getTextureFunc': self.get_texture_func, 'forEach': self.for_each,
            'getAnimation': lambda path: DisplayObject('Animation', path),
            'globalLogic': {'getLogicAssets': lambda: self.cas.assets},
        }
        self.cell = {'_type': 'PartyItemThumbnailView', 'view': {'asset': self.asset},
                     'uiProvider': {'build': lambda _spec: self.layout}, 'layer': self.layer,
                     'touchObject': None, 'layout': None, 'itemImage': None,
                     'imagePath': some(icon) if icon else NONE_OPTION,
                     'rarity': some(rarity) if rarity else NONE_OPTION,
                     'isEnableEnhancedEffect': NONE_OPTION if enhanced is None else some(enhanced),
                     'emptyStyle': {'index': 0, 'params': []}, 'emptyType': {'index': 0, 'params': []},
                     'enhancedEffectManager': None, 'enhancedEffectAnimation': NONE_OPTION,
                     'backgroundAnimation': NONE_OPTION,
                     'gear': {'checkPhaseBeforeDispose': lambda: self.alive}}
        tools = Cls(TOOLS, ENHANCED_FRAME_ENABLE_RARITY=[5])
        tools_code = decode(abc, 'ItemThumbnailTools$/getRarityFrameIndex')
        tools.statics['getRarityFrameIndex'] = lambda r, e: PartyInterp(abc, self.lex).run(tools_code, [tools, r, e])
        self.lex = {rules.CAS: self.cas.cls,
                    rules.OPTION: Cls(rules.OPTION, **{'None': NONE_OPTION, 'Some': some}),
                    TOOLS: tools,
                    rules.GROUP: Cls(rules.GROUP, ItemThumbnail='ItemThumbnail'),
                    rules.IMAGE: Cls(rules.IMAGE, ctor=self.new_image),
                    EMPTY_TYPE: Cls(EMPTY_TYPE, Equipment={'index': 0, 'params': []},
                                    AbilitySoul={'index': 1, 'params': []}),
                    UI_TOOLS: Cls(UI_TOOLS, createQuadFromRectangle=lambda rect, _x, _y: DisplayObject('Quad', 'touch')),
                    SMOOTHING: Cls(SMOOTHING, NONE='none'),
                    ALIGN: Cls(ALIGN, CENTER='center')}
        for name in METHODS:
            code = decode(abc, 'PartyItemThumbnailView/' + name)
            self.cell[name] = (lambda c: (lambda *args: PartyInterp(abc, self.lex).run(c, [self.cell, *args])))(code)
        self.cell['run']()                       # gear.addRunHandler(run)

    # -------------------------------------------------------------- 载图
    @staticmethod
    def _texture(path, size=(72, 72)):
        return {'_type': 'Texture', 'path': path, 'size': size, 'disposed': False}

    def new_image(self):
        image = Image(self)
        self.images.append(image)
        return image

    def set_texture(self, group, path, callback):
        """ViewAssetContainer.setTexture：已就绪 = 同步回调（listenLoadTexture 的 Loaded / subtextures 分支），否则排队。"""
        if group != 'ItemThumbnail':
            raise AssertionError(f'unexpected asset group {group!r}')
        self.requests.append(path)
        if path in self.loaded:
            self.depth += 1
            try:
                if self.depth > REENTRY_LIMIT:
                    raise AssertionError('setTexture re-entered synchronously (a device would overflow the stack)')
                callback()
            finally:
                self.depth -= 1
            return
        self.pending.append((path, callback))

    def get_texture(self, path):
        if path not in self.loaded:
            raise AvmThrow({'code': 8004, 'message': f'{path} not loaded'})
        return self.loaded[path]

    def get_texture_func(self, _cache, path):
        return self.loaded.get(path)

    def for_each(self, fn, arg):
        for cache in reversed(('ItemThumbnail',)):
            value = fn(cache, arg)
            if value is not None:
                return value
        return None

    def flush(self, only=None, sizes=None):
        """贴图加载完成：先全部登记为 Loaded，再按请求顺序回调（AssetMap.setContent 的顺序）。"""
        todo, self.pending = self.pending, []
        arrived = []
        for path, callback in todo:
            if only is not None and path not in only:
                self.pending.append((path, callback))
                continue
            if path not in self.loaded:
                self.loaded[path] = self._texture(path, (sizes or {}).get(path, (72, 72)))
            arrived.append(callback)
        for callback in arrived:
            callback()

    # -------------------------------------------------------------- 步骤
    def equip(self, icon, rarity=5, enhanced=True):
        peek = {'get_pixelArtPath': lambda: icon, 'get_rarity': lambda: rarity,
                'get_isEnableEnhancedEffect': lambda: enhanced}
        self.cell['replaceEquipment'](some(peek))

    def unequip(self):
        self.cell['replaceEquipment'](NONE_OPTION)

    def soul(self, thumb=SOUL, rarity=5):
        peek = {'get_thumbnailId': lambda: thumb, 'get_rarity': lambda: rarity}
        self.cell['replaceAbilitySoul'](some(peek))

    def dispose(self):
        self.cell['dispose']()
        self.alive = False

    # -------------------------------------------------------------- 看到的框
    def own_images(self):
        return [image for image in self.images if image.name == rules.PREFIX]

    def state(self):
        """(看到的框, 扫光)。框：rarity 容器开 -> ('rarity', 帧号)；自建图开 -> ('frame', 贴图路径)。"""
        rarity = self.layout.containers['rarity']
        holder = self.layout.containers['image']
        ours = [c for c in holder.children if c.name == rules.PREFIX]
        if len(ours) > 1 or len(self.own_images()) > 1:
            raise AssertionError('more than one frame image in the cell')
        if ours and holder.children.index(ours[0]) != 0:
            raise AssertionError('frame image is not under the item icon')
        if self.cell['itemImage'] not in holder.children:
            raise AssertionError('item icon left the image container')
        shown = bool(ours and ours[0].visible)
        if shown:
            image = ours[0]
            if image.transformationMatrix != rarity.transformationMatrix:
                raise AssertionError(f'frame matrix {image.transformationMatrix} != rarity {rarity.transformationMatrix}')
            if image.size != (rules.FRAME_SIZE, rules.FRAME_SIZE):
                raise AssertionError(f'frame size {image.size}')
            if image.texture is None or image.texture['disposed'] or image.textureSmoothing != 'bilinear':
                raise AssertionError('frame texture missing, disposed or not bilinear')
        if rarity.visible and not shown:
            seen = ('rarity', rarity.frame)
        elif shown and not rarity.visible:
            seen = ('frame', ours[0].texture['path'])
        else:
            seen = ('BOTH' if rarity.visible else 'NONE', rarity.frame)
        option = self.cell['enhancedEffectAnimation']
        sweep = bool(option['index'] == 0 and option['params'][0].visible
                     and self.layout.containers['background_effect'].renderingEnabled)
        return seen, sweep

    def probe(self):
        frames = [p for p in self.requests if p not in (LV200, LV120, OTHER, OTHER2, SOUL)]
        return {'lookups': list(self.cas.lookups), 'maybe_tables': self.cas.maybe_calls,
                'frame_requests': frames, 'frames_created': len(self.own_images())}


# ---------------------------------------------------------------------------
# 场景矩阵
# ---------------------------------------------------------------------------

ROWS = {PK: FRAME}
ROWS_SOUL = {PK: FRAME, rules.party_frame_key(SOUL): FRAME2}
ROWS_TWO = {PK: FRAME, rules.party_frame_key(OTHER2): FRAME2}
K120, KOTHER, K2 = rules.party_frame_key(LV120), rules.party_frame_key(OTHER), rules.party_frame_key(OTHER2)

#: 名称: dict(rows, table_loaded, preloaded, build=(icon, rarity, enhanced), steps)
SCENARIOS = {
    'hit_then_load': dict(steps=[('equip', LV200), ('flush',)]),
    'hit_texture_pending': dict(steps=[('equip', LV200)]),
    'hit_preloaded': dict(preloaded=(FRAME,), steps=[('equip', LV200), ('flush',)]),
    'hit_png_144': dict(preloaded=((FRAME, (144, 144)),), steps=[('equip', LV200), ('flush',)]),
    'hit_via_run': dict(build=(LV200, 5, True), steps=[('flush',)]),
    'hit_repeat_same_key': dict(steps=[('equip', LV200), ('flush',), ('equip', LV200), ('flush',)]),
    'lv120_icon_keeps_pink': dict(steps=[('equip', LV120), ('flush',)]),
    'missing_key': dict(rows={}, steps=[('equip', LV200), ('flush',)]),
    'empty_value': dict(rows={PK: ''}, steps=[('equip', LV200), ('flush',)]),
    'null_value': dict(rows={PK: None}, steps=[('equip', LV200), ('flush',)]),
    'table_not_loaded': dict(table_loaded=False, steps=[('equip', LV200), ('flush',)]),
    'v1_key_only': dict(rows={V1_FRAME_KEY: V1_FRAME}, preloaded=(V1_FRAME,), steps=[('equip', LV200), ('flush',)]),
    'not_enhanced': dict(steps=[('equip', LV200, 5, False), ('flush',)]),
    'no_image_path': dict(build=(None, 5, True), steps=[('flush',)]),
    'empty_slot': dict(steps=[('unequip',), ('flush',)]),
    'ability_soul': dict(rows=ROWS_SOUL, preloaded=(FRAME2,), steps=[('soul',), ('flush',)]),
    'reuse_to_other_enhanced': dict(steps=[('equip', LV200), ('flush',), ('equip', OTHER), ('flush',)]),
    'reuse_to_lv120': dict(steps=[('equip', LV200), ('flush',), ('equip', LV120), ('flush',)]),
    'reuse_to_empty': dict(steps=[('equip', LV200), ('flush',), ('unequip',), ('flush',)]),
    'reuse_to_soul': dict(rows=ROWS_SOUL, steps=[('equip', LV200), ('flush',), ('soul',), ('flush',)]),
    'reuse_to_not_enhanced_same_icon': dict(steps=[('equip', LV200), ('flush',), ('equip', LV200, 5, False),
                                                   ('flush',)]),
    'late_load_after_reuse': dict(steps=[('equip', LV200), ('equip', OTHER), ('flush',)]),
    'late_load_after_reuse_to_empty': dict(steps=[('equip', LV200), ('unequip',), ('flush',)]),
    'late_load_after_reuse_with_image': dict(rows=ROWS_TWO, steps=[('equip', OTHER2), ('flush',), ('equip', LV200),
                                                                   ('equip', OTHER), ('flush',)]),
    'switch_back_and_forth_after_load': dict(steps=[('equip', LV200), ('flush',), ('equip', OTHER),
                                                       ('equip', LV200), ('equip', OTHER), ('flush',)]),
    'other_then_bluegold': dict(steps=[('equip', OTHER), ('flush',), ('equip', LV200), ('flush',)]),
    'round_trip_twice': dict(steps=[('equip', LV200), ('flush',), ('equip', OTHER), ('flush',), ('equip', LV200),
                                    ('equip', OTHER), ('equip', LV200), ('flush',)]),
    'two_keys_switch_before_load': dict(rows=ROWS_TWO, steps=[('equip', LV200), ('equip', OTHER2), ('flush',)]),
    'two_keys_stale_arrives_first': dict(rows=ROWS_TWO, steps=[('equip', LV200), ('equip', OTHER2),
                                                               ('flush', [FRAME]), ('mark',), ('flush',)]),
    'callback_after_dispose': dict(steps=[('equip', LV200), ('dispose',), ('flush',)]),
}

_FRAME, _FRAME2 = ('frame', FRAME), ('frame', FRAME2)
_PINK, _RAINBOW, _EMPTY = ('rarity', PINK), ('rarity', RAINBOW), ('rarity', EMPTY)
#: 打补丁后的期望：看到的框、扫光、getMaybe 键序列、框图载图请求、自建图个数、中途快照。
EXPECTED = {
    'hit_then_load': (_FRAME, True, [PK, PK], [FRAME], 1),
    'hit_texture_pending': (_PINK, True, [PK], [FRAME], 0),
    'hit_preloaded': (_FRAME, True, [PK], [], 1),
    'hit_png_144': (_FRAME, True, [PK], [], 1),
    'hit_via_run': (_FRAME, True, [PK, PK], [FRAME], 1),
    'hit_repeat_same_key': (_FRAME, True, [PK, PK, PK], [FRAME], 1),
    'lv120_icon_keeps_pink': (_PINK, True, [K120], [], 0),
    'missing_key': (_PINK, True, [PK], [], 0),
    'empty_value': (_PINK, True, [PK], [], 0),
    'null_value': (_PINK, True, [PK], [], 0),
    'table_not_loaded': (_PINK, True, [], [], 0),
    'v1_key_only': (_PINK, True, [PK], [], 0),
    'not_enhanced': (_RAINBOW, False, [], [], 0),
    'no_image_path': (_PINK, True, [], [], 0),
    'empty_slot': (_EMPTY, False, [], [], 0),
    'ability_soul': (_RAINBOW, False, [], [], 0),
    'reuse_to_other_enhanced': (_PINK, True, [PK, PK, KOTHER], [FRAME], 1),
    'reuse_to_lv120': (_PINK, True, [PK, PK, K120], [FRAME], 1),
    'reuse_to_empty': (_EMPTY, False, [PK, PK], [FRAME], 1),
    'reuse_to_soul': (_RAINBOW, False, [PK, PK], [FRAME], 1),
    'reuse_to_not_enhanced_same_icon': (_RAINBOW, False, [PK, PK], [FRAME], 1),
    'late_load_after_reuse': (_PINK, True, [PK, KOTHER, KOTHER], [FRAME], 0),
    'late_load_after_reuse_to_empty': (_EMPTY, False, [PK], [FRAME], 0),
    'late_load_after_reuse_with_image': (_PINK, True, [K2, K2, PK, KOTHER, KOTHER], [FRAME2, FRAME], 1),
    'switch_back_and_forth_after_load': (_PINK, True, [PK, PK, KOTHER, PK, KOTHER], [FRAME], 1),
    'other_then_bluegold': (_FRAME, True, [KOTHER, PK, PK], [FRAME], 1),
    'round_trip_twice': (_FRAME, True, [PK, PK, KOTHER, PK, KOTHER, PK], [FRAME], 1),
    'two_keys_switch_before_load': (_FRAME2, True, [PK, K2, K2, K2], [FRAME, FRAME2], 1),
    'two_keys_stale_arrives_first': (_FRAME2, True, [PK, K2, K2, K2, K2], [FRAME, FRAME2, FRAME2], 1),
    'callback_after_dispose': (_PINK, False, [PK], [FRAME], 0),
}
#: 中途快照（('mark',) 步骤处看到的框）：旧键贴图先到时仍是粉框。
EXPECTED_MARKS = {'two_keys_stale_arrives_first': [(_PINK, True)]}
FIELDS = ('seen', 'sweep', 'lookups', 'frame_requests', 'frames_created')


def expected(name):
    return dict(zip(FIELDS, EXPECTED[name]), marks=EXPECTED_MARKS.get(name, []))


def native(name):
    """原生（未打补丁）结果：凡是期望自建框的地方都是粉框；从不查表、不请求框图、不建图。"""
    want = expected(name)
    seen = _PINK if want['seen'][0] == 'frame' else want['seen']
    marks = [(_PINK if s[0] == 'frame' else s, sweep) for s, sweep in want['marks']]
    return dict(want, seen=seen, lookups=[], frame_requests=[], frames_created=0, marks=marks)


#: 与原生结果有任何不同（含只多查一次表）的场景。
DIFFERS_FROM_NATIVE = frozenset(name for name in SCENARIOS if expected(name) != native(name))
#: 看得见的命中：最终或中途显示的框与原生不同（原生是粉框、补丁显示自建框）。
HITS = frozenset(name for name in SCENARIOS
                 if (expected(name)['seen'], expected(name)['marks']) != (native(name)['seen'], native(name)['marks']))


def run_scenario(abc, name):
    spec = SCENARIOS[name]
    marks = []
    world = None
    try:
        world = PartyWorld(abc, spec.get('rows', ROWS), spec.get('table_loaded', True), spec.get('preloaded', ()),
                           *spec.get('build', (None, None, None)))
        for step in spec['steps']:
            kind = step[0]
            if kind == 'equip':
                world.equip(*step[1:])
            elif kind == 'unequip':
                world.unequip()
            elif kind == 'soul':
                world.soul()
            elif kind == 'flush':
                world.flush(step[1] if len(step) > 1 else None)
            elif kind == 'dispose':
                world.dispose()
            elif kind == 'mark':
                marks.append(world.state())
            else:
                raise ValueError(step)
        seen, sweep = world.state()
        result = dict(seen=seen, sweep=sweep, marks=marks)
    except AvmThrow as thrown:
        value = thrown.value
        result = dict(seen=('throw', value.get('code') if isinstance(value, dict) else repr(value)), sweep=None,
                      marks=marks)
    except (AssertionError, KeyError, TypeError, ValueError, AttributeError, IndexError, RecursionError) as exc:
        result = dict(seen=('error', type(exc).__name__, str(exc)[:160]), sweep=None, marks=marks)
    probe = world.probe() if world is not None else {'lookups': [], 'maybe_tables': 0, 'frame_requests': [],
                                                    'frames_created': 0}
    result.update({k: probe[k] for k in ('lookups', 'frame_requests', 'frames_created')})
    return result, probe


def party_matrix(abc):
    results, probes = {}, {}
    for name in SCENARIOS:
        results[name], probes[name] = run_scenario(abc, name)
    return results, probes


# ---------------------------------------------------------------------------
# 截断执行：只跑插入段，所有路径必须到达原生入口（哨兵返回 this）
# ---------------------------------------------------------------------------

def native_entry(abc):
    """补丁体里原生入口的位置（=插入段末尾）；未打补丁时为锚点。"""
    ins = decode(abc, rules.LABEL)
    name, operand = rules.NATIVE_AT_ANCHOR[1]
    for entry in (rules.ANCHOR, rules.ANCHOR + rules.INSERTED_COUNT):
        x = ins[entry] if entry < len(ins) else None
        if x is not None and x.name == name and abc.mn_name(x.args[0]) == operand:
            return ins, rules.ANCHOR, entry
    raise AssertionError('native entry not found')


def fallthrough(abc):
    """{场景: ('native_entry', 看到的框) | 错误}：每个场景跑完步骤后，再单独执行一次插入段。"""
    ins, at, entry = native_entry(abc)
    code = slice_method(ins, at, entry, asm.assemble([('getlocal_0',), ('returnvalue',)]))
    out = {}
    for name, spec in SCENARIOS.items():
        try:
            world = PartyWorld(abc, spec.get('rows', ROWS), spec.get('table_loaded', True), spec.get('preloaded', ()),
                               *spec.get('build', (None, None, None)))
            for step in spec['steps']:
                if step[0] == 'equip':
                    world.equip(*step[1:])
                elif step[0] == 'unequip':
                    world.unequip()
                elif step[0] == 'soul':
                    world.soul()
                elif step[0] == 'flush':
                    world.flush(step[1] if len(step) > 1 else None)
                elif step[0] == 'dispose':
                    world.dispose()
            before = world.state()
            value = PartyInterp(abc, world.lex).run(code, [world.cell])
            out[name] = ('native_entry' if value is world.cell else 'escaped', world.state() == before)
        except Exception as exc:  # noqa: BLE001 —— 任何异常都是失败
            out[name] = ('error', type(exc).__name__, str(exc)[:160])
    return out


def fallthrough_expected(_name):
    """插入段幂等：步骤跑完后再执行一次，只会到达原生入口，看到的框不变。"""
    return ('native_entry', True)


# ---------------------------------------------------------------------------
# 静态证明：只写新局部、只调白名单、属性写只落在自建图与 rarity 容器、出口只有原生入口；原生部分逐字节可还原
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


_LOCAL_NAMES = {number: name for name, number in rules.LOCALS.items()}


def receivers(block, at, abc):
    """段内逐条追踪栈上每个值来自哪个局部（本段在每个分支与标签处栈都为空，线性走一遍即可）。

    返回 (属性写 {(名字, 接收者)}, 无返回值调用 {(名字, 接收者)}, 标签处栈非空的位置)。接收者是局部名，
    ``this`` 记为 'this'，其余来源记为 '?'。
    """
    targets = {x.target - at for x in block if x.target is not None}
    stack, writes, calls, dirty = [], set(), set(), []
    for i, x in enumerate(block):
        if i in targets and stack:
            dirty.append(i)
            stack = []
        pops, pushes = asm._effect(x, abc.multinames)
        if pops > len(stack):
            raise AssertionError(f'block #{i} {x.name} pops {pops} from a stack of {len(stack)}')
        popped = stack[len(stack) - pops:] if pops else []
        del stack[len(stack) - pops:]
        receiver = popped[0] if popped else None
        if x.name == 'setproperty':
            writes.add((abc.mn_name(x.args[0]), receiver))
        elif x.name == 'callpropvoid':
            calls.add((abc.mn_name(x.args[0]), receiver))
        if x.name == 'getlocal_0':
            stack.append('this')
        elif x.name in ('getlocal_1', 'getlocal_2', 'getlocal_3'):
            stack.append(_LOCAL_NAMES.get(int(x.name[-1]), '?'))
        elif x.name == 'getlocal':
            stack.append(_LOCAL_NAMES.get(x.args[0], '?'))
        else:
            stack.extend(['?'] * pushes)
        if x.target is not None and stack:
            dirty.append(i)
    return writes, calls, dirty


def static_proof(base_abc, out_abc):
    locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
    label = rules.LABEL
    before = base_abc.bodies[bodies.resolve(base_abc, label)]
    after = out_abc.bodies[bodies.resolve(out_abc, label)]
    native_ins, patched = asm.decode(before[5]), asm.decode(after[5])
    n = len(patched) - len(native_ins)
    at = rules.ANCHOR
    entry = at + n
    block = patched[at:entry]
    restored = asm.unsplice(after[5], at, n)
    written, read, calls, lex, strings = set(), set(), set(), set(), []
    for x in block:
        if x.op in (0x63, 0xD4, 0xD5, 0xD6, 0xD7):
            written.add(x.args[0] if x.op == 0x63 else x.op - 0xD4)
        elif x.op in (0x62, 0xD0, 0xD1, 0xD2, 0xD3):
            read.add(x.args[0] if x.op == 0x62 else x.op - 0xD0)
        elif x.op in (0x92, 0x94, 0xC2, 0xC3, 0x08, 0x32):
            written.add(-1)                          # 不允许任何原地改局部的指令
        if x.name in ('callproperty', 'callpropvoid', 'callproplex', 'constructprop'):
            calls.add(out_abc.mn_name(x.args[0]))
        elif x.name in ('callsuper', 'callsupervoid', 'callmethod', 'callstatic', 'call', 'construct',
                        'constructsuper', 'newfunction', 'newclass'):
            calls.add(x.name)
        if x.name in ('getlex', 'findpropstrict', 'findproperty'):
            lex.add(out_abc.mn_name(x.args[0]))
        if x.name == 'pushstring':
            strings.append(out_abc.strings[x.args[0]].decode('utf8'))
    writes, void_calls, dirty = receivers(block, at, out_abc)
    new_locals = set(rules.LOCALS.values())
    inner_targets = [x.target for x in block if x.target is not None]
    item = {
        'anchor': at, 'inserted': n,
        'native_restored_byte_identical': sha(restored) == locks[label]['sha'] == sha(before[5]),
        'header_before': list(before[1:5]), 'header_after': list(after[1:5]),
        'writes_only_new_locals': written == new_locals,
        'reads_only_this_and_new_locals': read <= set(rules.READS) | new_locals,
        'new_locals_start_at_old_localcount': min(new_locals) == locks[label]['header'][1] == before[2],
        'calls': sorted(calls),
        'calls_whitelisted': calls <= ALLOWED_CALLS,
        'never_calls_throwing_getters': not {rules.GET_MASTER, rules.GET_TEXTURE} & calls,
        'lex': sorted(lex),
        'lex_whitelisted': lex <= ALLOWED_LEX,
        'property_writes': sorted(writes),
        'property_writes_only_own_image_and_rarity': writes == EXPECTED_WRITES,
        'void_calls': sorted(void_calls),
        'void_calls_on_expected_receivers': void_calls == EXPECTED_VOID_CALLS,
        'stack_empty_at_every_branch': not dirty,
        'no_other_property_writes': not [x for x in block if x.name in ('initproperty', 'setslot', 'setsuper',
                                                                         'deleteproperty', 'setglobalslot')],
        'strings': strings,
        'strings_expected': strings == EXPECTED_STRINGS,
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
    item['ok'] = (n == rules.INSERTED_COUNT and item['native_restored_byte_identical']
                  and item['header_after'] == EXPECTED_HEADERS[label] and item['writes_only_new_locals']
                  and item['reads_only_this_and_new_locals'] and item['new_locals_start_at_old_localcount']
                  and item['calls_whitelisted'] and item['never_calls_throwing_getters'] and item['lex_whitelisted']
                  and item['property_writes_only_own_image_and_rarity'] and item['void_calls_on_expected_receivers']
                  and item['stack_empty_at_every_branch'] and item['no_other_property_writes']
                  and item['strings_expected']
                  and item['branches_stay_in_block_or_exit_to_native_entry']
                  and item['no_outside_branch_into_block'] and item['no_scope_or_exception_change']
                  and item['returns_in_block'] == 0 and item['stack_empty_at_native_entry'])
    return {label: item, 'ok': item['ok']}


# ---------------------------------------------------------------------------
# 结构 / 保持 / 复现
# ---------------------------------------------------------------------------

def _independent():
    return _load('equipment_enhanced_party_frame_independent_abc', PATCH_ROOT / 'rank-scene-p2/independent/myabc.py')


def stacked_labels():
    """叠加链上必须逐字节不变的既有补丁方法体：v1（equipment-enhanced-look）自己登记的叠加链 + v1 的两个体。"""
    look_verify = _load('equipment_enhanced_look_verify', PATCH_ROOT / 'equipment-enhanced-look/verify.py')
    return tuple(look_verify.stacked_labels()) + tuple(look_verify.rules.TARGETS)


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
    overlay = _load('equipment_enhanced_party_frame_overlay', HERE / 'overlay.py')
    rebuilt = SwfAbc(base_path)
    overlay.patch_editor(rebuilt)
    return rebuilt.abc.serialize() == out.abc.serialize()


# ---------------------------------------------------------------------------
# 变异体（负对照）
# ---------------------------------------------------------------------------

def _drop(sequence, occurrence=0):
    """删掉插入段里第 occurrence 处与 sequence 完全相同的连续片段（找不到就报错，变异体不许静默落空）。"""
    def mutate(e, label, code):
        seq = sequence(e)
        hits = [i for i in range(len(code) - len(seq) + 1) if code[i:i + len(seq)] == seq]
        if len(hits) <= occurrence:
            raise AssertionError(f'{label}: mutant sequence not found: {seq}')
        i = hits[occurrence]
        return code[:i] + code[i + len(seq):]
    return mutate


def _replace(old, new):
    """把插入段里唯一一处 old 片段换成 new。"""
    def mutate(e, label, code):
        a, b = old(e), new(e)
        hits = [i for i in range(len(code) - len(a) + 1) if code[i:i + len(a)] == a]
        if len(hits) != 1:
            raise AssertionError(f'{label}: expected one {a}, found {hits}')
        i = hits[0]
        return code[:i] + b + code[i + len(a):]
    return mutate


L = rules.LOCALS


def _enhanced_guard(e):
    return rules._option_some(e, L, 'isEnableEnhancedEffect') + rules._option_value(e, L) + [('iffalse', 'MISS')]


def mutant_no_probe(e, label, code):
    """贴图已就绪也照样请求（探测结果不看）：已就绪时同步回调重入本方法。"""
    return _replace(lambda e: [('getlocal', L['tex']), ('iftrue', 'APPLY')],
                    lambda e: [('pushfalse',), ('iftrue', 'APPLY')])(e, label, code)


def mutant_wrong_prefix(e, label, code):
    """键前缀写成 v1 的 enhanced_frame_override_（第 2 处 PREFIX 是拼键那一处）。"""
    hits = [i for i, item in enumerate(code) if item == e.string(rules.PREFIX)]
    if len(hits) != 3:
        raise AssertionError(f'expected three PREFIX pushes, found {hits}')
    out = list(code)
    out[hits[1]] = e.string(V1_FRAME_KEY[:-len(LV200)])
    return out


MUTANTS = {
    # 删掉「isEnableEnhancedEffect == Some(true)」：非强化态 / 魂珠也换框
    'drop_enhanced': _drop(_enhanced_guard),
    # 删掉 dispose 判定：dispose 之后才到的回调仍然建图
    'drop_gear_guard': _drop(lambda e: [('getlocal_0',), ('getproperty', e.q('gear')),
                                        ('callproperty', e.q('checkPhaseBeforeDispose'), 0), ('iffalse', 'SKIP')]),
    # 未命中不恢复：格子复用后仍显示蓝金框
    'drop_restore': _drop(lambda e: [('getlocal', L['img']), ('pushfalse',), ('setproperty', e.q('visible')),
                                     ('getlocal', L['rarity']), ('pushtrue',), ('setproperty', e.q('visible'))]),
    # 命中不藏粉框：粉框与蓝金框同时显示
    'no_hide_pink': _drop(lambda e: [('getlocal', L['rarity']), ('pushfalse',), ('setproperty', e.q('visible'))]),
    # 删掉探测：已就绪时同步重入（真机栈溢出）
    'no_probe': mutant_no_probe,
    # 删掉尺寸归一：144 的图撑大
    'no_size': _drop(lambda e: [('getlocal', L['img']), ('pushbyte', rules.FRAME_SIZE), ('pushbyte', rules.FRAME_SIZE),
                                ('callpropvoid', e.q('readjustSize'), 2)]),
    # 删掉矩阵：框不在粉框的位置 / 缩放
    'no_matrix': _drop(lambda e: [('getlocal', L['img']), ('getlocal', L['rarity']),
                                  ('getproperty', e.q('transformationMatrix')),
                                  ('setproperty', e.q('transformationMatrix'))]),
    # 不认名字：把第 0 位的物品图标当成自建图（图标被换成框图）
    'no_name_check': _drop(lambda e: [('getlocal', L['img']), ('getproperty', e.q('name')), e.string(rules.PREFIX),
                                      ('ifstricteq', 'FOUND'), ('pushnull',), ('setlocal', L['img'])]),
    # 放到图标上面：框盖住图标
    'frame_above_icon': _replace(lambda e: [('getlocal', L['holder']), ('getlocal', L['img']), ('pushbyte', 0)],
                                 lambda e: [('getlocal', L['holder']), ('getlocal', L['img']), ('pushbyte', 1)]),
    # 前缀写错（v1 的键）：PARADOX 行查不到，v1 行被当成编成槽框
    'wrong_prefix': mutant_wrong_prefix,
    # 删掉「string 为空串 / null」这一道（第 2 处 text 判空）：空值被当成路径请求载图
    'drop_text_guard': _drop(lambda e: [('getlocal', L['text']), ('iffalse', 'MISS')], occurrence=1),
}
#: 每个变异体至少要让这些场景变红（其余变红项也记录）。
MUTANT_TARGETS = {
    'drop_enhanced': ['not_enhanced', 'ability_soul', 'reuse_to_not_enhanced_same_icon'],
    'drop_gear_guard': ['callback_after_dispose'],
    'drop_restore': ['reuse_to_other_enhanced', 'reuse_to_lv120', 'reuse_to_empty', 'reuse_to_soul',
                     'switch_back_and_forth_after_load', 'late_load_after_reuse_with_image'],
    'no_hide_pink': ['hit_then_load', 'hit_preloaded', 'hit_via_run'],
    'no_probe': ['hit_then_load', 'hit_preloaded'],
    'no_size': ['hit_png_144'],
    'no_matrix': ['hit_then_load', 'hit_preloaded'],
    'no_name_check': ['hit_then_load', 'hit_preloaded'],
    'frame_above_icon': ['hit_then_load', 'hit_preloaded'],
    'wrong_prefix': ['hit_then_load', 'v1_key_only'],
    'drop_text_guard': ['empty_value', 'null_value'],
}


def red_assertions(abc):
    """在给定 ABC 上跑矩阵，返回所有与期望不符的场景名。"""
    results, _ = party_matrix(abc)
    return [name for name in SCENARIOS if results[name] != expected(name)]


def mutant_matrix(base_path: Path):
    overlay = _load('equipment_enhanced_party_frame_overlay', HERE / 'overlay.py')
    out = {}
    for name, mutate in MUTANTS.items():
        swf = SwfAbc(base_path)
        overlay.patch_editor(swf, mutate=mutate)
        red = red_assertions(swf.abc)
        out[name] = {'red': red, 'red_count': len(red),
                     'targets_red': all(t in red for t in MUTANT_TARGETS[name])}
    return out


# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------

def verify(out_path, base_path=None, mutants=True):
    out_path = Path(out_path)
    out = SwfAbc(out_path)
    report = {'output': str(out_path), 'output_sha256': sha(out_path.read_bytes()),
              'output_abc_sha256': sha(out.abc.serialize())}
    results, probes = party_matrix(out.abc)
    report['matrix_size'], report['hit_count'] = len(results), len(HITS)
    report['differs_from_native_count'] = len(DIFFERS_FROM_NATIVE)
    report['mismatches'] = {k: [results[k], expected(k)] for k in SCENARIOS if results[k] != expected(k)}
    report['never_calls_get_master_table'] = True          # _Cas.forbidden 一调用就让场景报错
    fall = fallthrough(out.abc)
    report['fallthrough_mismatches'] = {k: [v, fallthrough_expected(k)] for k, v in fall.items()
                                        if v != fallthrough_expected(k)}
    ok = not (report['mismatches'] or report['fallthrough_mismatches'])
    if base_path is not None:
        base_path = Path(base_path)
        base = SwfAbc(base_path)
        report['base_sha256'] = sha(base_path.read_bytes())
        report['base_abc_sha256'] = sha(base.abc.serialize())
        report['preservation'] = preservation(base, out)
        report['static_proof'] = static_proof(base.abc, out.abc)
        report['reproducible_from_base'] = reproduce(base_path, out)
        native_results, native_probes = party_matrix(base.abc)
        report['negative_control'] = {
            'hits_passing_on_base': sorted(k for k in DIFFERS_FROM_NATIVE if native_results[k] == expected(k)),
            'base_not_native': {k: [native_results[k], native(k)] for k in SCENARIOS
                                if native_results[k] != native(k)},
            'base_touches_custom_ability_string': sorted(k for k, v in native_probes.items()
                                                         if v['maybe_tables'] or v['lookups']),
            'base_requests_frames_or_creates_images': sorted(k for k, v in native_probes.items()
                                                             if v['frame_requests'] or v['frames_created']),
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
