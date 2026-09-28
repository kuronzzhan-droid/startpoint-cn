"""装备详情文案覆盖（equipment-description-override）的全部指令：纯函数，只依赖传入的 battle-rules Editor。

三个方法各在 #2（``getlocal_0; pushscope`` 之后、原生第一条指令之前）插一段前缀：

* ``AbilitySoulAbilityLogic/getDescriptionsWithoutAdditional`` —— 持有 / 图鉴详情的本体说明（行数组）；
* ``AbilitySoulAbilityLogic/getDescriptionWithoutAdditional(param1)`` —— 图鉴「最大」那一行（整串）；
* ``EquipmentEnhancementAbilityLogic/getAllDescriptionsToMapForDialog`` —— 强化块（两级 IntMap）。

前缀只调用 ``getMasterTableMaybe``（不抛异常的取表）+ ``MasterMap.getMaybe``（缺行返回 null），
任何一道闸不满足（表没加载、没有这一行、``string`` 为 null 或空串）都落到原生第一条指令，原方法体逐字节照旧执行。

覆盖键由对象自己的 ``id`` 拼出（武器魂 id = 装备 id，强化能力 id = 装备 id）::

    desc_override_equipment_<id>                        本体说明，"\\n" 分行
    desc_override_equipment_enhancement_<id>            强化成长块（开关键）
    desc_override_equipment_enhancement_<id>_final      强化满级块（可缺）

插入点与方法锁见 baseline.json；锚点要求唯一且形状不变。
"""
from __future__ import annotations

SOUL = 'pinball.common.data.ability::AbilitySoulAbilityLogic'
ENH = 'pinball.common.data.ability::EquipmentEnhancementAbilityLogic'

BASE_LINES = 'AbilitySoulAbilityLogic/getDescriptionsWithoutAdditional'
BASE_TEXT = 'AbilitySoulAbilityLogic/getDescriptionWithoutAdditional'
ENH_BLOCKS = 'EquipmentEnhancementAbilityLogic/getAllDescriptionsToMapForDialog'
#: 生成顺序固定（常量池追加顺序因此固定，产物 ABC 才可复现）。
TARGETS = (BASE_LINES, BASE_TEXT, ENH_BLOCKS)

CAS = 'pinball.master.generated::CustomAbilityStringTable'
MAYBE = 'pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'
#: 会抛 8014 / 缺表崩溃的取表；前缀里**绝不**出现（verify 静态核对 + 行为探针双重把关）。
GET_MASTER = 'pinball.asset.logic:ILogicAssetContainer::getMasterTable'
UI_STRING = 'pinball.asset.logic:ILogicAssetContainer::getUiString'
SPLIT = 'http://adobe.com/AS3/2006/builtin::split'
JOIN = 'http://adobe.com/AS3/2006/builtin::join'
INTMAP = 'haxe.ds::IntMap'
IMAP = 'haxe::IMap'
MULTINAME_L = 14          # 原生体里 IntMap.h[k] 读写用的同一个 MultinameL

BASE_PREFIX = 'desc_override_equipment_'
ENH_PREFIX = 'desc_override_equipment_enhancement_'
FINAL_SUFFIX = '_final'
LINE_SEPARATOR = '\n'
DELIM_NEWLINE = 'ability_description_delimiter_newline'
DELIM_INLINE = 'ability_description_delimiter'
#: 常量池只允许追加这 3 个字符串（其余全部复用已有条目）。
ADDED_STRINGS = (BASE_PREFIX, ENH_PREFIX, FINAL_SUFFIX)

CAPABILITY = 'equipment-description-override-v1'
#: 已安装的 equipment-rules APK（e03bc22b…）声明的 9 项能力。
INHERITED_CAPABILITIES = (
    'damage-type-rules-v1', 'dash-parameter-v1', 'equipment-gauge-gain-rules-v1', 'equipment-rules-v1',
    'gauge-gain-rules-v1', 'kyubi-fever-ratio-v1', 'kyubi-panel-description-override-v1',
    'kyubi-pf-initial-combo-v1', 'panel-description-override-v2',
)

ANCHOR = 2
#: 新局部变量从原 localcount 起编号，原方法体一个也读不到。
LOCALS = {
    BASE_LINES: {'key': 6, 'table': 7, 'text': 8},
    BASE_TEXT: {'key': 3, 'table': 4, 'text': 5},
    ENH_BLOCKS: {'key': 26, 'table': 27, 'text': 28, 'result': 29, 'block': 30},
}
#: 锚点 #2 处原生第一条指令（名字、操作数中的多名短名）。形状变了就拒绝。
NATIVE_FIRST = {
    BASE_LINES: ('pushbyte', 0),
    BASE_TEXT: ('findpropstrict', 'pinball.common.data.ability.description::AbilityGroupingDescriptionGenerator'),
    ENH_BLOCKS: ('pushbyte', 0),
}
#: 各插入段指令条数（设计值；测试逐一核对）。
INSERTED_COUNTS = {BASE_LINES: 29, BASE_TEXT: 38, ENH_BLOCKS: 77}
NEED_ACTIVATION = 0x02


def override_keys(equipment_id: int) -> dict:
    """某件装备的三个覆盖键（数据侧写表 / 测试共用；与前缀里的拼接逐字相同）。"""
    growth = f'{ENH_PREFIX}{int(equipment_id)}'
    return {'base': f'{BASE_PREFIX}{int(equipment_id)}', 'growth': growth, 'final': growth + FINAL_SUFFIX}


# ---------------------------------------------------------------------------
# 指令片段
# ---------------------------------------------------------------------------

def row_text(e, table, key_code, text, miss):
    """栈 [] -> []：``table.get_data().getMaybe(key)`` 的 ``string`` 存进 ``text``；缺行 / null / 空串跳 ``miss``。"""
    q = e.q
    return [('getlocal', table), ('callproperty', q('get_data'), 0)] + list(key_code) + [
        ('callproperty', q('getMaybe'), 1), ('setlocal', text),
        ('getlocal', text), ('iffalse', miss),
        ('getlocal', text), ('getproperty', q('string')), ('setlocal', text),
        ('getlocal', text), ('iffalse', miss)]


def probe(e, prefix, key, table, text, miss='SKIP'):
    """键 = prefix + this.id；表 = logicAssets.getMasterTableMaybe(CustomAbilityStringTable)；表为 null 跳 ``miss``。"""
    q = e.q
    return [e.string(prefix), ('getlocal_0',), ('getproperty', q('id')), ('add',), ('setlocal', key),
            ('getlocal_0',), ('getproperty', q('logicAssets')), ('getlex', q(CAS)),
            ('callproperty', q(MAYBE), 1), ('setlocal', table),
            ('getlocal', table), ('iffalse', miss)] + row_text(e, table, [('getlocal', key)], text, miss)


def split_lines(e, text):
    """栈 [] -> [Array]：``text.split("\\n")``（"\\n" 复用常量池已有条目）。"""
    return [('getlocal', text), e.string(LINE_SEPARATOR), ('callproperty', e.q(SPLIT), 1)]


def base_lines_insertion(e):
    """getDescriptionsWithoutAdditional():Array —— 命中返回 ``text.split("\\n")``。"""
    loc = LOCALS[BASE_LINES]
    return probe(e, BASE_PREFIX, loc['key'], loc['table'], loc['text']) + split_lines(e, loc['text']) + [
        ('coerce', e.q('Array')), ('returnvalue',), ('label', 'SKIP')]


def base_text_insertion(e):
    """getDescriptionWithoutAdditional(param1:Boolean):String —— 命中按 UI 分隔符拼回整串，
    与 ``AbilityGroupingDescriptionGenerator.stringfy`` 同一取法（param1 ? 换行分隔 : 行内分隔）。"""
    q, loc = e.q, LOCALS[BASE_TEXT]
    return probe(e, BASE_PREFIX, loc['key'], loc['table'], loc['text']) + split_lines(e, loc['text']) + [
        ('getlocal_0',), ('getproperty', q('logicAssets')),
        ('getlocal_1',), ('iffalse', 'PLAIN'),
        e.string(DELIM_NEWLINE), ('jump', 'DELIM'),
        ('label', 'PLAIN'), e.string(DELIM_INLINE),
        ('label', 'DELIM'), ('callproperty', q(UI_STRING), 1),
        ('callproperty', q(JOIN), 1), ('coerce', q('String')), ('returnvalue',),
        ('label', 'SKIP')]


def _new_map(e, local):
    q = e.q
    return [('findpropstrict', q(INTMAP)), ('constructprop', q(INTMAP), 0), ('coerce', q(IMAP)), ('setlocal', local)]


def _put(e, map_local, key_code, value_code):
    """``map.h[key] = value``（与原生体同一个 MultinameL）。"""
    return [('getlocal', map_local), ('getproperty', e.q('h'))] + list(key_code) + list(value_code) + [
        ('setproperty', MULTINAME_L)]


def enhancement_insertion(e):
    """getAllDescriptionsToMapForDialog():IMap —— 命中返回 ``{0: {1: 成长行}, 1: {this.maxLevel: 满级行}}``；
    满级键缺失 / 为空时只返回块 0。在 IntMap 迭代、排序闭包和 ClientError 2324 检查之前返回。"""
    q, loc = e.q, LOCALS[ENH_BLOCKS]
    key, table, text, result, block = loc['key'], loc['table'], loc['text'], loc['result'], loc['block']
    lines = split_lines(e, text)
    code = probe(e, ENH_PREFIX, key, table, text) + _new_map(e, result) + _new_map(e, block)
    code += _put(e, block, [('pushbyte', 1)], lines)
    code += _put(e, result, [('pushbyte', 0)], [('getlocal', block)])
    code += row_text(e, table, [('getlocal', key), e.string(FINAL_SUFFIX), ('add',)], text, 'DONE')
    code += _new_map(e, block)
    code += _put(e, block, [('getlocal_0',), ('getproperty', q('maxLevel'))], lines)
    code += _put(e, result, [('pushbyte', 1)], [('getlocal', block)])
    return code + [('label', 'DONE'), ('getlocal', result), ('returnvalue',), ('label', 'SKIP')]


BUILDERS = {BASE_LINES: base_lines_insertion, BASE_TEXT: base_text_insertion, ENH_BLOCKS: enhancement_insertion}


# ---------------------------------------------------------------------------
# 锚点与登记
# ---------------------------------------------------------------------------

def find_anchor(e, asm, bodies, label):
    """#2：``getlocal_0; pushscope`` 之后。要求无活动对象、无异常表、无分支指向 #2、
    原 localcount 恰好等于新局部的起点、原生第一条指令形状不变、尚未打过本补丁。"""
    abc = e.abc
    body = abc.bodies[bodies.resolve(abc, label)]
    ins = asm.decode(body[5])
    if [x.name for x in ins[:ANCHOR]] != ['getlocal_0', 'pushscope']:
        raise asm.AsmError(f'{label} prologue changed')
    if abc.methods[body[0]][3] & NEED_ACTIVATION or body[6] or body[7]:
        raise asm.AsmError(f'{label} gained an activation, exception table or body traits')
    incoming = [i for i, x in enumerate(ins) if x.target == ANCHOR or (x.cases and ANCHOR in [x.default, *x.cases])]
    if incoming:
        raise asm.AsmError(f'{label} anchor #{ANCHOR} is a branch target: {incoming}')
    first_new = min(LOCALS[label].values())
    if body[2] != first_new or asm.block_locals(ins) > first_new:
        raise asm.AsmError(f'{label} localcount {body[2]} != first new local {first_new}')
    name, operand = NATIVE_FIRST[label]
    first = ins[ANCHOR]
    got = abc.mn_name(first.args[0]) if name == 'findpropstrict' else first.args[0]
    if first.name != name or got != operand:
        raise asm.AsmError(f'{label} native #{ANCHOR} changed: {first}')
    if any(x.name == 'pushstring' and abc.strings[x.args[0]] == BASE_PREFIX.encode() for x in ins):
        raise asm.AsmError(f'{label} already probes {BASE_PREFIX}')
    return ANCHOR


def install(e, asm, bodies, mutate=None):
    """在 Editor 上登记三段插入；返回锚点。调用方负责 ``e.apply()``。

    ``mutate(e, label, code) -> code`` 只供测试 / verify 构造变异体（负对照），交付构建不传。
    """
    anchors = {label: find_anchor(e, asm, bodies, label) for label in TARGETS}
    for label in TARGETS:
        code = BUILDERS[label](e)
        if mutate is not None:
            code = mutate(e, label, code)
        e.insert(label, anchors[label], code, asm.FORBID)
    return anchors
