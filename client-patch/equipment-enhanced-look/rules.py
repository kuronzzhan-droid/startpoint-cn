"""装备强化外观（equipment-enhanced-look）的全部指令：纯函数，只依赖传入的 battle-rules Editor。

两处单方法指令插入（不回编 AS3、不走 FFDec），各自有方法锁（baseline.json）：

* ``EquipmentEnhancementLogic/getPixelart(level)`` —— 第二图标档。插在原方法「达到 pixelart0 等级、
  即将返回 ``Some(pixelart0.value)``」那条分支的入口（#27：``iffalse`` 的落空后继、``getlex Option`` 之前，
  此处栈为空）。查 ``custom_ability_string["enhanced_pixelart_tier2_" + pixelart0.value]``，
  值形如 ``"<等级>,<路径>"``：等级是规范十进制整数（``String(int(s)) === s``）、路径非空、恰好一个逗号，
  且 ``level >= 等级`` 时返回 ``Some(<路径>)``；任一条件不满足都落回原生的 ``Some(pixelart0.value)``。
  原方法其余分支（未达 pixelart0 等级、没有强化行）完全不经过插入段。
* ``ItemThumbnailView/setRarity(rarity, enhanced)`` —— 强化框覆盖。插在方法唯一的 ``returnvoid`` 之前（#29），
  原生 ``frame.setRarity`` 已经执行完（粉框、``frame.rarity``、background 容器关闭照旧）。
  ``enhanced`` 为真且 ``itemImagePath`` 是 ``Some(path)`` 时查
  ``custom_ability_string["enhanced_frame_override_" + path]``；非空就 ``hideRarity(); replaceBackgroundImage(值)``
  （与称号缩略图 showAnyThumbnail case 11 同一通路）。其余情况等于原方法。

取表只用 ``ILogicAssetContainer.getMasterTableMaybe``（表没加载返回 null）+ ``MasterMap.getMaybe``（缺行返回 null），
绝不调用会抛 8013/8014 的 ``getMasterTable``。插入段只写新局部（从原 localcount 起编号）。
"""
from __future__ import annotations

ENH_LOGIC = 'pinball.common.data.equipmentEnhancement::EquipmentEnhancementLogic'
THUMB = 'pinball.ui.component.item::ItemThumbnailView'

PIXELART = 'EquipmentEnhancementLogic/getPixelart'
FRAME = 'ItemThumbnailView/setRarity'
#: 生成顺序固定（常量池追加顺序因此固定，产物 ABC 才可复现）。
TARGETS = (PIXELART, FRAME)

CAS = 'pinball.master.generated::CustomAbilityStringTable'
MAYBE = 'pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'
#: 会抛 8013/8014 的取表；插入段里**绝不**出现（verify 静态核对 + 行为探针双重把关）。
GET_MASTER = 'pinball.asset.logic:ILogicAssetContainer::getMasterTable'
GET_LOGIC_ASSETS = 'pinball.context.global:GlobalLogicForSection::getLogicAssets'
SPLIT = 'http://adobe.com/AS3/2006/builtin::split'
OPTION = 'haxe.ds::Option'
MULTINAME_L = 14          # 原生体里 Option.params[0] 用的同一个 MultinameL（数组下标读取）

TIER2_PREFIX = 'enhanced_pixelart_tier2_'
FRAME_PREFIX = 'enhanced_frame_override_'
TIER2_SEPARATOR = ','
#: 常量池只允许追加这 2 个字符串（"," 与全部多名复用已有条目）。
ADDED_STRINGS = (TIER2_PREFIX, FRAME_PREFIX)

CAPABILITY = 'equipment-enhanced-look-v1'
#: 已安装的 equipment-description-override APK（cf91b29b…）声明的 10 项能力。
INHERITED_CAPABILITIES = (
    'damage-type-rules-v1', 'dash-parameter-v1', 'equipment-description-override-v1',
    'equipment-gauge-gain-rules-v1', 'equipment-rules-v1', 'gauge-gain-rules-v1', 'kyubi-fever-ratio-v1',
    'kyubi-panel-description-override-v1', 'kyubi-pf-initial-combo-v1', 'panel-description-override-v2',
)

#: 插入点（原方法体的指令下标）。
ANCHORS = {PIXELART: 27, FRAME: 29}
#: 新局部变量从原 localcount 起编号，原方法体一个也读不到。
LOCALS = {
    PIXELART: {'path0': 4, 'key': 5, 'assets': 6, 'table': 7, 'text': 8, 'parts': 9, 'level': 10, 'path': 11},
    FRAME: {'option': 4, 'path': 5, 'key': 6, 'view': 7, 'asset': 8, 'global': 9, 'assets': 10, 'table': 11,
            'text': 12},
}
#: 插入段只读这些原有寄存器（this / 参数 / getPixelart 的 _loc3_ = pixelart0）。
READS = {PIXELART: {0, 1, 3}, FRAME: {0, 2}}
#: 锚点处原生指令的形状（名字、操作数中的多名全名）；锚点前一条也钉住。形状变了就拒绝。
NATIVE_AT_ANCHOR = {
    PIXELART: (('iffalse', None), ('getlex', OPTION)),
    FRAME: (('callpropvoid', 'setRarity'), ('returnvoid', None)),
}
#: 各插入段指令条数（设计值；测试逐一核对）。
INSERTED_COUNTS = {PIXELART: 67, FRAME: 66}
NEED_ACTIVATION = 0x02


def tier2_key(icon_path: str) -> str:
    """第二图标档的键（与插入段的拼接逐字相同）：键尾是 pixelart0 的图标路径。"""
    return TIER2_PREFIX + icon_path


def frame_key(icon_path: str) -> str:
    """强化框覆盖的键：键尾是缩略图正在显示的图标路径（itemImagePath）。"""
    return FRAME_PREFIX + icon_path


def tier2_value(level: int, icon_path: str) -> str:
    """第二图标档的值：``"<等级>,<路径>"``（写入 CSV 时这一格必须带引号，csv.writer 会自动加）。"""
    return f'{int(level)}{TIER2_SEPARATOR}{icon_path}'


# ---------------------------------------------------------------------------
# 指令片段
# ---------------------------------------------------------------------------

def _guarded(local, source):
    """栈 [] -> []：``local = <source>``；null / 空串跳 SKIP。"""
    return list(source) + [('setlocal', local), ('getlocal', local), ('iffalse', 'SKIP')]


def _row_text(e, table, key, text):
    """栈 [] -> []：``text = table.get_data().getMaybe(key).string``；缺行 / null / 空串跳 SKIP。"""
    q = e.q
    return (_guarded(text, [('getlocal', table), ('callproperty', q('get_data'), 0),
                            ('getlocal', key), ('callproperty', q('getMaybe'), 1)])
            + _guarded(text, [('getlocal', text), ('getproperty', q('string'))]))


def pixelart_insertion(e):
    """getPixelart(param1:int):Option 的 Some 分支入口。命中返回 ``Some(<路径>)``，否则落回原生 ``Some(path0)``。"""
    q, loc = e.q, LOCALS[PIXELART]
    code = _guarded(loc['path0'], [('getlocal_3',), ('getproperty', q('value')), ('coerce_s',)])
    code += [e.string(TIER2_PREFIX), ('getlocal', loc['path0']), ('add',), ('setlocal', loc['key'])]
    code += _guarded(loc['assets'], [('getlocal_0',), ('getproperty', q('logicAssets'))])
    code += _guarded(loc['table'], [('getlocal', loc['assets']), ('getlex', q(CAS)), ('callproperty', q(MAYBE), 1)])
    code += _row_text(e, loc['table'], loc['key'], loc['text'])
    # parts = text.split(",")；恰好两段
    code += [('getlocal', loc['text']), e.string(TIER2_SEPARATOR), ('callproperty', q(SPLIT), 1),
             ('setlocal', loc['parts']),
             ('getlocal', loc['parts']), ('getproperty', q('length')), ('pushbyte', 2), ('ifne', 'SKIP'),
             ('getlocal', loc['parts']), ('pushbyte', 0), ('getproperty', MULTINAME_L), ('coerce_s',),
             ('setlocal', loc['level'])]
    code += _guarded(loc['path'], [('getlocal', loc['parts']), ('pushbyte', 1), ('getproperty', MULTINAME_L),
                                   ('coerce_s',)])
    # 等级必须是规范十进制整数：String(int(s)) === s（拒绝空串、小数、前导 0/空白/+、指数、十六进制、溢出）
    code += [('getlocal', loc['level']), ('convert_i',), ('convert_s',), ('getlocal', loc['level']),
             ('ifstrictne', 'SKIP'),
             # param1 < int(s) -> 未达第二档
             ('getlocal_1',), ('getlocal', loc['level']), ('convert_i',), ('iflt', 'SKIP'),
             ('getlex', q(OPTION)), ('getlocal', loc['path']), ('callproperty', q('Some'), 1),
             ('coerce', q(OPTION)), ('returnvalue',),
             ('label', 'SKIP')]
    return code


def frame_insertion(e):
    """setRarity(param1:Option, param2:Boolean):void 的 returnvoid 之前。命中时 hideRarity + replaceBackgroundImage。"""
    q, loc = e.q, LOCALS[FRAME]
    code = [('getlocal_2',), ('iffalse', 'SKIP')]
    code += _guarded(loc['option'], [('getlocal_0',), ('getproperty', q('itemImagePath'))])
    code += [('getlocal', loc['option']), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'SKIP')]
    code += _guarded(loc['path'], [('getlocal', loc['option']), ('getproperty', q('params')), ('pushbyte', 0),
                                   ('getproperty', MULTINAME_L), ('coerce_s',)])
    code += [e.string(FRAME_PREFIX), ('getlocal', loc['path']), ('add',), ('setlocal', loc['key'])]
    code += _guarded(loc['view'], [('getlocal_0',), ('getproperty', q('view'))])
    code += _guarded(loc['asset'], [('getlocal', loc['view']), ('getproperty', q('asset'))])
    code += _guarded(loc['global'], [('getlocal', loc['asset']), ('getproperty', q('globalLogic'))])
    code += _guarded(loc['assets'], [('getlocal', loc['global']), ('callproperty', q(GET_LOGIC_ASSETS), 0)])
    code += _guarded(loc['table'], [('getlocal', loc['assets']), ('getlex', q(CAS)), ('callproperty', q(MAYBE), 1)])
    code += _row_text(e, loc['table'], loc['key'], loc['text'])
    code += [('getlocal_0',), ('callpropvoid', q('hideRarity'), 0),
             ('getlocal_0',), ('getlocal', loc['text']), ('callpropvoid', q('replaceBackgroundImage'), 1),
             ('label', 'SKIP')]
    return code


BUILDERS = {PIXELART: pixelart_insertion, FRAME: frame_insertion}


# ---------------------------------------------------------------------------
# 锚点与登记
# ---------------------------------------------------------------------------

def _operand_name(abc, x):
    return abc.mn_name(x.args[0]) if x.args else None


def find_anchor(e, asm, bodies, label):
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
    first_new = min(LOCALS[label].values())
    if body[2] != first_new or asm.block_locals(ins) > first_new:
        raise asm.AsmError(f'{label} localcount {body[2]} != first new local {first_new}')
    for offset, (name, operand) in zip((-1, 0), NATIVE_AT_ANCHOR[label]):
        x = ins[at + offset]
        got = _operand_name(abc, x) if operand is not None else None
        if x.name != name or (operand is not None and got != operand):
            raise asm.AsmError(f'{label} native #{at + offset} changed: {x}')
    if label == PIXELART and ins[at - 1].target != 35:
        raise asm.AsmError(f'{label} level check no longer branches to the None return')
    if label == FRAME and at != len(ins) - 1:
        raise asm.AsmError(f'{label} returnvoid is not the last instruction')
    for x in ins:
        if x.name == 'pushstring' and abc.strings[x.args[0]] in (TIER2_PREFIX.encode(), FRAME_PREFIX.encode()):
            raise asm.AsmError(f'{label} already probes {abc.strings[x.args[0]].decode()}')
    return at


def install(e, asm, bodies, mutate=None):
    """在 Editor 上登记两段插入；返回锚点。调用方负责 ``e.apply()``。

    ``mutate(e, label, code) -> code`` 只供测试 / verify 构造变异体（负对照），交付构建不传。
    """
    anchors = {label: find_anchor(e, asm, bodies, label) for label in TARGETS}
    for label in TARGETS:
        code = BUILDERS[label](e)
        if mutate is not None:
            code = mutate(e, label, code)
        e.insert(label, anchors[label], code, asm.FORBID)
    return anchors
