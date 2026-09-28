"""编成装备槽强化框覆盖（equipment-enhanced-party-frame）的全部指令：纯函数，只依赖传入的 battle-rules Editor。

一处单方法指令插入（不回编 AS3、不走 FFDec），方法锁见 baseline.json：

``PartyItemThumbnailView/updateEnhancedEffectAnimation()``（体 85268）在 #2 插一段（``getlocal_0; pushscope`` 之后、
原生第一条 ``findproperty isEnableEnhancedEffect`` 之前）。这个方法在 run / replaceEquipment / replaceAbilitySoul
三条流程里都是最后一步（字段与 rarity 帧都已定），不带参数、只读字段、原生部分幂等。

编成槽的粉框是布局 ``rarity`` 容器里的一张图集贴图（第 11 帧 ``party_equipment_rainbow_enhanced``），
没有 background 容器，也没有「按路径载图」的回调方法，所以 v1（``ItemThumbnailView.setRarity``）的
``hideRarity + replaceBackgroundImage`` 通路在这里不存在。插入段改为：

* ``isEnableEnhancedEffect == Some(true)`` 且 ``imagePath == Some(path)``（非空）时查
  ``custom_ability_string["enhanced_party_frame_override_" + path]``，值非空就是框图路径；
* 不抛错的探测 ``asset.forEach(asset._getTextureFunc, 值)``（= ``getTexture`` 去掉 8004 抛错那一步）：
  贴图已就绪 → 在 ``image`` 容器第 0 位（图标下面）放一张自建 ``TextureReplaceableImage``（``name`` = 前缀串，
  格子里只建一次），贴图、尺寸归一到 72×72、照抄 ``rarity`` 容器的变换矩阵、显示它并隐藏整个 ``rarity`` 容器；
  贴图未就绪 → ``asset.setTexture(ItemThumbnail, 值, this.updateEnhancedEffectAnimation)`` 请求载图，
  这一次先按未命中处理（显示粉框）。回调就是宿主方法本身：到达时按**当时**的字段重算，
  不携带任何路径，所以没有「过期回调」；
* 未命中且本格建过这张图 → 藏起它并重新显示 ``rarity`` 容器（格子复用时粉框恢复）。

所有出口都落到原生入口（段内没有 return）；插入段只写新局部（从原 localcount 2 起编号），只读 ``this``；
属性写只有自建图的 ``name / visible / transformationMatrix``（另经方法设贴图与尺寸）、``rarity`` 容器的 ``visible``
和 ``image`` 容器的子节点。本类的字段一个也不写。取表只用不抛错的 ``getMasterTableMaybe`` + ``getMaybe``。

第二处（b 版，2026-09-28「武器图标会消失」）：``PartyItemThumbnailView/setItemImage``（体 85274）的 None 分支入口
#24（lookupswitch case 1，ENTER）插 4 条 ``this.itemImage.texture = null``。原生紧接着的
``itemImage.changeTexture(Option.None)`` 于是看到 ``texture == null``，不再 ``texture.dispose()``。
原生那一步 dispose 的是 **ItemThumbnail 缓存里的共享贴图**：官方装备图标是 ``item/sprite_sheet`` 图集的 SubTexture，
dispose 是空操作；自制武器图标是独立 PNG（ConcreteTexture，trimmed_image 里没有行），dispose 直接释放 GPU 贴图，
缓存（常驻 common 组）却仍记为 Loaded —— 之后任何格子、任何画面再取这个图标都拿到已释放的贴图。
编成槽「卸下 → 换回」、同一格被刷新成空槽（出击前选队伍编辑后刷新、切到这一格为空的队伍分组、
联机房间成员面板切到空槽成员）都会触发；蓝金框是自建图、从不 changeTexture(None)，所以照常显示。
以上是代码层结论（反编译源码 + 真实字节码解释执行）：真机上画已释放的贴图是空白、黑块，还是抛 #3694 被
CrashUtil 接住，没有证据；作者看到的「有框没图标」是否就是这个原因，待真机区分性检查（见 README）。
插入的 setter 与原生 ``texture = null`` 是同一个，只少了 dispose；贴图始终归缓存所有（缓存重置时由缓存释放）。
一个边界差异：原生 changeTexture 第一行是 ``if(_disposed) return``，插入段排在它之前，所以 itemImage 已经 dispose
时补丁仍会多写一次 ``texture = null``（Image.set texture → MeshStyle.set texture(null)，只 setRequiresRedraw；
Quad.setupVertices 因 _disposed 提前返回），没有可见效果、不会抛错。
"""
from __future__ import annotations

THUMB = 'pinball.ui.component.item.party::PartyItemThumbnailView'
LABEL = 'PartyItemThumbnailView/updateEnhancedEffectAnimation'
#: b 版第二处：setItemImage 的 None 分支先把图标贴图置空，原生 changeTexture(None) 就不会 dispose 缓存里的共享贴图。
SET_IMAGE_LABEL = 'PartyItemThumbnailView/setItemImage'
TARGETS = (LABEL, SET_IMAGE_LABEL)

CAS = 'pinball.master.generated::CustomAbilityStringTable'
MAYBE = 'pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'
#: 会抛 8013/8014 的取表；插入段里**绝不**出现。
GET_MASTER = 'pinball.asset.logic:ILogicAssetContainer::getMasterTable'
GET_LOGIC_ASSETS = 'pinball.context.global:GlobalLogicForSection::getLogicAssets'
OPTION = 'haxe.ds::Option'
IMAGE = 'pinball.ui.display.image::TextureReplaceableImage'
GROUP = 'pinball.asset::AssetGroupKind'
MULTINAME_L = 14          # 原生体里 Option.params[0] 用的同一个 MultinameL
#: 会抛 8004 的取图；插入段只用 forEach(_getTextureFunc, path) 这个不抛错的探测。
GET_TEXTURE = 'getTexture'

PREFIX = 'enhanced_party_frame_override_'
RARITY_CONTAINER = 'rarity'
IMAGE_CONTAINER = 'image'
#: 粉框贴图 party_equipment_rainbow_enhanced 的尺寸：任何分辨率的框图都归一到这个框，再套 rarity 容器的矩阵（≈2.028 倍）。
FRAME_SIZE = 72
#: 常量池只允许追加这 1 个字符串（"rarity"、"image" 与全部多名复用已有条目）。
ADDED_STRINGS = (PREFIX,)

CAPABILITY = 'equipment-enhanced-party-frame-v1'
#: 已安装的 equipment-enhanced-look APK（7056f7dc…）声明的 11 项能力。
INHERITED_CAPABILITIES = (
    'damage-type-rules-v1', 'dash-parameter-v1', 'equipment-description-override-v1', 'equipment-enhanced-look-v1',
    'equipment-gauge-gain-rules-v1', 'equipment-rules-v1', 'gauge-gain-rules-v1', 'kyubi-fever-ratio-v1',
    'kyubi-panel-description-override-v1', 'kyubi-pf-initial-combo-v1', 'panel-description-override-v2',
)

#: 插入点（原方法体的指令下标）。
ANCHOR = 2
#: setItemImage 的 #24 = lookupswitch 的 case 1（Option.None）入口：原生 findproperty itemImage … changeTexture(None)。
SET_IMAGE_ANCHOR = 24
ANCHORS = {LABEL: ANCHOR, SET_IMAGE_LABEL: SET_IMAGE_ANCHOR}
#: 新局部变量从原 localcount 起编号，原方法体一个也读不到。asset 先存 view、再存 view.asset。
LOCALS = {'layout': 2, 'rarity': 3, 'holder': 4, 'img': 5, 'option': 6, 'path': 7, 'key': 8, 'asset': 9,
          'global': 10, 'assets': 11, 'table': 12, 'text': 13, 'tex': 14}
#: 插入段只读 this 这一个原有寄存器（方法没有参数）。
READS = frozenset({0})
#: 锚点处原生指令的形状（名字、操作数中的多名全名）；锚点前一条也钉住。形状变了就拒绝。
NATIVE_AT_ANCHOR = (('pushscope', None), ('findproperty', 'isEnableEnhancedEffect'))
#: 插入段指令条数（设计值；测试逐一核对）。
INSERTED_COUNT = 161
SET_IMAGE_INSERTED_COUNT = 4
INSERTED_COUNTS = {LABEL: INSERTED_COUNT, SET_IMAGE_LABEL: SET_IMAGE_INSERTED_COUNT}
#: setItemImage 原生形状（整条方法只有 30 条：逐条核对指令名与操作数多名的短名）。
SET_IMAGE_NATIVE = (
    ('getlocal_0', None), ('pushscope', None), ('findproperty', 'imagePath'), ('getlocal_1', None),
    ('initproperty', 'imagePath'), ('getlocal_1', None), ('getproperty', 'index'), ('lookupswitch', None),
    ('jump', None), ('findproperty', 'view'), ('getproperty', 'view'), ('getproperty', 'asset'),
    ('getlex', 'AssetGroupKind'), ('getproperty', 'ItemThumbnail'), ('getlocal_1', None), ('getproperty', 'params'),
    ('pushbyte', None), ('getproperty', None), ('coerce', 'String'), ('findproperty', 'textureLoadCompleted'),
    ('getproperty', 'textureLoadCompleted'), ('coerce', 'Function'), ('callpropvoid', 'setTexture'), ('jump', None),
    ('findproperty', 'itemImage'), ('getproperty', 'itemImage'), ('getlex', 'Option'), ('getproperty', 'None'),
    ('callpropvoid', 'changeTexture'), ('returnvoid', None),
)
#: lookupswitch（#7）：default → #8，case 0（Some）→ #9，case 1（None）→ #24。
SET_IMAGE_SWITCH = (8, [9, 24])
#: 插入段允许的属性写（setproperty 的名字）与写入对象（新局部）：只写自建图与 rarity 容器。
PROPERTY_WRITES = {'name': 'img', 'visible': ('img', 'rarity'), 'transformationMatrix': 'img'}
NEED_ACTIVATION = 0x02


def party_frame_key(icon_path: str) -> str:
    """编成槽框覆盖的键（与插入段的拼接逐字相同）：键尾是编成槽正在显示的图标路径（imagePath）。"""
    return PREFIX + icon_path


# ---------------------------------------------------------------------------
# 指令片段
# ---------------------------------------------------------------------------

def _guarded(local, source, miss='MISS'):
    """栈 [] -> []：``local = <source>``；null / 空串 / false 跳 miss。"""
    return list(source) + [('setlocal', local), ('getlocal', local), ('iffalse', miss)]


def _find_own_image(e, loc):
    """``img = holder.numChildren && holder.getChildAt(0).name === PREFIX ? holder.getChildAt(0) : null``。"""
    q = e.q
    return [('pushnull',), ('setlocal', loc['img']),
            ('getlocal', loc['holder']), ('getproperty', q('numChildren')), ('iffalse', 'FOUND'),
            ('getlocal', loc['holder']), ('pushbyte', 0), ('callproperty', q('getChildAt'), 1),
            ('setlocal', loc['img']),
            ('getlocal', loc['img']), ('getproperty', q('name')), e.string(PREFIX), ('ifstricteq', 'FOUND'),
            ('pushnull',), ('setlocal', loc['img']),
            ('label', 'FOUND')]


def _option_some(e, loc, field):
    """栈 [] -> []：``option = this.<field>``；不是 Some 就跳 MISS。"""
    q = e.q
    return (_guarded(loc['option'], [('getlocal_0',), ('getproperty', q(field))])
            + [('getlocal', loc['option']), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'MISS')])


def _option_value(e, loc):
    """栈 [] -> [option.params[0]]。"""
    return [('getlocal', loc['option']), ('getproperty', e.q('params')), ('pushbyte', 0), ('getproperty', MULTINAME_L)]


def insertion(e):
    """updateEnhancedEffectAnimation() 的 #2。命中显示框图并隐藏 rarity 容器；未命中恢复；最后落到原生入口。"""
    q, loc = e.q, LOCALS
    # 0. 视图还活着（载图回调可能在 dispose 之后才到），拿到两个容器与本格的自建图
    code = [('getlocal_0',), ('getproperty', q('gear')), ('callproperty', q('checkPhaseBeforeDispose'), 0),
            ('iffalse', 'SKIP')]
    code += _guarded(loc['layout'], [('getlocal_0',), ('getproperty', q('layout'))], miss='SKIP')
    code += [('getlocal', loc['layout']), e.string(RARITY_CONTAINER), ('callproperty', q('getContainer'), 1),
             ('setlocal', loc['rarity']),
             ('getlocal', loc['layout']), e.string(IMAGE_CONTAINER), ('callproperty', q('getContainer'), 1),
             ('setlocal', loc['holder'])]
    code += _find_own_image(e, loc)
    # 1. 强化态：isEnableEnhancedEffect == Some(true)
    code += _option_some(e, loc, 'isEnableEnhancedEffect') + _option_value(e, loc) + [('iffalse', 'MISS')]
    # 2. 图标路径：imagePath == Some(path)，path 非空；key = PREFIX + path
    code += _option_some(e, loc, 'imagePath')
    code += _guarded(loc['path'], _option_value(e, loc) + [('coerce_s',)])
    code += [e.string(PREFIX), ('getlocal', loc['path']), ('add',), ('setlocal', loc['key'])]
    # 3. custom_ability_string[key].string（绝不调用 getMasterTable）
    code += _guarded(loc['asset'], [('getlocal_0',), ('getproperty', q('view'))])
    code += _guarded(loc['asset'], [('getlocal', loc['asset']), ('getproperty', q('asset'))])
    code += _guarded(loc['global'], [('getlocal', loc['asset']), ('getproperty', q('globalLogic'))])
    code += _guarded(loc['assets'], [('getlocal', loc['global']), ('callproperty', q(GET_LOGIC_ASSETS), 0)])
    code += _guarded(loc['table'], [('getlocal', loc['assets']), ('getlex', q(CAS)), ('callproperty', q(MAYBE), 1)])
    code += _guarded(loc['text'], [('getlocal', loc['table']), ('callproperty', q('get_data'), 0),
                                   ('getlocal', loc['key']), ('callproperty', q('getMaybe'), 1)])
    code += _guarded(loc['text'], [('getlocal', loc['text']), ('getproperty', q('string'))])
    # 4. 贴图就绪？不抛错的探测（getTexture 去掉 8004）。未就绪：请求载图，回调 = 本方法，先显示粉框
    code += [('getlocal', loc['asset']), ('getlocal', loc['asset']), ('getproperty', q('_getTextureFunc')),
             ('getlocal', loc['text']), ('callproperty', q('forEach'), 2), ('setlocal', loc['tex']),
             ('getlocal', loc['tex']), ('iftrue', 'APPLY'),
             ('getlocal', loc['asset']), ('getlex', q(GROUP)), ('getproperty', q('ItemThumbnail')),
             ('getlocal', loc['text']), ('getlocal_0',), ('getproperty', q('updateEnhancedEffectAnimation')),
             ('callpropvoid', q('setTexture'), 3),
             ('jump', 'MISS'),
             # 5. 命中：本格第一次命中时建图放到 image 容器第 0 位（图标下面）
             ('label', 'APPLY'),
             ('getlocal', loc['img']), ('iftrue', 'HAVE'),
             ('findpropstrict', q(IMAGE)), ('constructprop', q(IMAGE), 0), ('setlocal', loc['img']),
             ('getlocal', loc['img']), e.string(PREFIX), ('setproperty', q('name')),
             ('getlocal', loc['holder']), ('getlocal', loc['img']), ('pushbyte', 0),
             ('callpropvoid', q('addChildAt'), 2),
             ('label', 'HAVE'),
             ('getlocal', loc['img']), ('getlex', q(OPTION)), ('getlocal', loc['tex']), ('callproperty', q('Some'), 1),
             ('callpropvoid', q('changeTexture'), 1),
             ('getlocal', loc['img']), ('pushbyte', FRAME_SIZE), ('pushbyte', FRAME_SIZE),
             ('callpropvoid', q('readjustSize'), 2),
             ('getlocal', loc['img']), ('getlocal', loc['rarity']), ('getproperty', q('transformationMatrix')),
             ('setproperty', q('transformationMatrix')),
             ('getlocal', loc['img']), ('pushtrue',), ('setproperty', q('visible')),
             ('getlocal', loc['rarity']), ('pushfalse',), ('setproperty', q('visible')),
             ('jump', 'SKIP'),
             # 6. 未命中：只在本格建过图时才动 rarity 容器
             ('label', 'MISS'),
             ('getlocal', loc['img']), ('iffalse', 'SKIP'),
             ('getlocal', loc['img']), ('pushfalse',), ('setproperty', q('visible')),
             ('getlocal', loc['rarity']), ('pushtrue',), ('setproperty', q('visible')),
             ('label', 'SKIP')]
    return code


def set_image_insertion(e):
    """setItemImage() 的 #24（None 分支入口，ENTER）：``this.itemImage.texture = null``。

    栈 [] -> []，只读 this，不新增局部 / 常量 / 多名。随后原生 ``itemImage.changeTexture(Option.None)`` 看到
    ``texture == null``，跳过 ``texture.dispose()``，再把 null 赋一遍（同一个 setter、同一个值，什么也不做）。

    与原生唯一的边界差异：插入段排在 changeTexture 的 ``if(_disposed) return`` 之前。itemImage 已经 dispose 时，
    原生什么都不做，补丁仍会写一次 ``texture = null``（Image.set texture → MeshStyle.set texture(null)，只触发
    setRequiresRedraw；Quad.setupVertices 因 _disposed 提前返回）——多写一次 style.texture = null，无害：
    不可见、不抛错。
    """
    q = e.q
    return [('getlocal_0',), ('getproperty', q('itemImage')), ('pushnull',), ('setproperty', q('texture'))]


# ---------------------------------------------------------------------------
# 锚点与登记
# ---------------------------------------------------------------------------

def _operand_name(abc, x):
    return abc.mn_name(x.args[0]) if x.args else None


def find_anchor(e, asm, bodies, label=LABEL):
    """要求：无活动对象 / 异常表 / 体内 trait；没有任何原有分支指向锚点；原 localcount 恰好等于新局部起点；
    锚点前后两条指令形状不变；尚未打过本补丁。"""
    abc = e.abc
    body = abc.bodies[bodies.resolve(abc, label)]
    ins = asm.decode(body[5])
    at = ANCHORS[label]
    if [x.name for x in ins[:2]] != ['getlocal_0', 'pushscope']:
        raise asm.AsmError(f'{label} prologue changed')
    if abc.methods[body[0]][3] & NEED_ACTIVATION or body[6] or body[7]:
        raise asm.AsmError(f'{label} gained an activation, exception table or body traits')
    incoming = [i for i, x in enumerate(ins) if x.target == at or (x.cases and at in [x.default, *x.cases])]
    if incoming:
        raise asm.AsmError(f'{label} anchor #{at} is a branch target: {incoming}')
    first_new = min(LOCALS.values())
    if body[2] != first_new or asm.block_locals(ins) > first_new:
        raise asm.AsmError(f'{label} localcount {body[2]} != first new local {first_new}')
    for offset, (name, operand) in zip((-1, 0), NATIVE_AT_ANCHOR):
        x = ins[at + offset]
        got = _operand_name(abc, x) if operand is not None else None
        if x.name != name or (operand is not None and got != operand):
            raise asm.AsmError(f'{label} native #{at + offset} changed: {x}')
    for x in ins:
        if x.name == 'pushstring' and abc.strings[x.args[0]] == PREFIX.encode():
            raise asm.AsmError(f'{label} already probes {PREFIX}')
    return at


def _short(abc, index):
    return abc.mn_name(index).rsplit(':', 1)[-1]


def find_set_image_anchor(e, asm, bodies, label=SET_IMAGE_LABEL):
    """setItemImage：无活动对象 / 异常表 / 体内 trait；30 条原生指令逐条同形；lookupswitch 的 case 1 恰好是锚点，
    全方法只有这一条分支指向锚点（ENTER：None 分支必经插入段）；localcount 仍是 2。已打过补丁（多了 4 条）直接拒绝。"""
    abc = e.abc
    body = abc.bodies[bodies.resolve(abc, label)]
    ins = asm.decode(body[5])
    if abc.methods[body[0]][3] & NEED_ACTIVATION or body[6] or body[7]:
        raise asm.AsmError(f'{label} gained an activation, exception table or body traits')
    if len(ins) != len(SET_IMAGE_NATIVE):
        raise asm.AsmError(f'{label} has {len(ins)} instructions, expected {len(SET_IMAGE_NATIVE)} '
                           '(already patched or changed)')
    for i, (x, (name, operand)) in enumerate(zip(ins, SET_IMAGE_NATIVE)):
        if x.name != name or (operand is not None and _short(abc, x.args[0]) != operand):
            raise asm.AsmError(f'{label} native #{i} changed: {x}')
    switch = ins[7]
    if (switch.default, list(switch.cases)) != (SET_IMAGE_SWITCH[0], list(SET_IMAGE_SWITCH[1])):
        raise asm.AsmError(f'{label} lookupswitch targets changed: {switch.default} {switch.cases}')
    at = SET_IMAGE_ANCHOR
    incoming = [i for i, x in enumerate(ins) if x.target == at or (x.cases and at in [x.default, *x.cases])]
    if incoming != [7]:
        raise asm.AsmError(f'{label} anchor #{at} incoming branches {incoming} != [7]')
    if body[2] != 2 or asm.block_locals(ins) > 2:
        raise asm.AsmError(f'{label} localcount changed: {body[2]}')
    return at


def install(e, asm, bodies, mutate=None):
    """在 Editor 上登记两处插入段；返回 {标签: 锚点}。调用方负责 ``e.apply()``。

    ``mutate(e, label, code) -> code`` 只供测试 / verify 构造变异体（负对照），交付构建不传。
    变异体函数带 ``label`` 属性时只改那个方法，否则只改 updateEnhancedEffectAnimation。
    """
    anchors = {LABEL: find_anchor(e, asm, bodies, LABEL),
               SET_IMAGE_LABEL: find_set_image_anchor(e, asm, bodies, SET_IMAGE_LABEL)}
    blocks = {LABEL: (insertion(e), asm.FORBID), SET_IMAGE_LABEL: (set_image_insertion(e), asm.ENTER)}
    for label, (code, incoming) in blocks.items():
        if mutate is not None and getattr(mutate, 'label', LABEL) == label:
            code = mutate(e, label, code)
        e.insert(label, anchors[label], code, incoming)
    return anchors
