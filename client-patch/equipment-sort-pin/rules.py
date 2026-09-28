"""装备列表置顶（equipment-sort-pin）的全部指令：纯函数，只依赖传入的 battle-rules Editor。

两处单方法指令插入（不回编 AS3、不走 FFDec），各自有方法锁（baseline.json）：

* ``EquipmentListScene/compareByEquipmentStatus(p1, p2)``（体 70204）—— 装备一览网格、一括卖出、一括强化弹窗；
  原生：重复件数 stack 降序 → 稀有度降序 → id 升序；
* ``EquipmentSelectThumbnailListRepository/sortByRarity(p1, p2)``（体 70354）—— 编成选武器（同步 / 异步两条过滤路径）；
  原生：稀有度降序 → id 升序。

两个插入段相同，都插在方法入口 #0（两个方法都没有 ``pushscope`` 序言，也没有任何分支指向 #0，FORBID）：

* ``this.globalLogic.getLogicAssets().getMasterTableMaybe(CustomAbilityStringTable).get_data()``，任一环节为 null → 原生；
* ``pin(p) = custom_ability_string["equipment_sort_pin_" + int(p.id)].string``，必须是规范十进制正整数
  （``String(int(s)) === s`` 且 ``int(s) > 0``），否则视为「无序号」；
* 两件都有且不等 → ``return pa - pb``（小者在前）；两件都有且相等 → 原生；只有 p1 有 → ``return -1``；
  只有 p2 有 → ``return 1``；两件都没有 → 原生（原逻辑一字不改）。

置顶判断在 stack / 稀有度之前，所以置顶组内是全序（序号，相等时原生以 id 收尾），AS3 不稳定排序不会让顺序跳动；
两个正 int32 相减不会溢出。取表只用不抛错的 ``getMasterTableMaybe`` + ``getMaybe``，绝不调用 ``getMasterTable``。
插入段只写新局部（从原 localcount 3 起编号），只读 ``this`` / ``p1`` / ``p2``；没有属性写、没有无返回值调用。
"""
from __future__ import annotations

LIST_SCENE = 'pinball.scene.equipmentList::EquipmentListScene'
SELECT_REPO = 'pinball.scene.equipmentSelect::EquipmentSelectThumbnailListRepository'
LIST = 'EquipmentListScene/compareByEquipmentStatus'
SELECT = 'EquipmentSelectThumbnailListRepository/sortByRarity'
#: 生成顺序固定（常量池追加顺序因此固定，产物 ABC 才可复现）。
TARGETS = (LIST, SELECT)

CAS = 'pinball.master.generated::CustomAbilityStringTable'
MAYBE = 'pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'
#: 会抛 8013/8014 的取表；插入段里**绝不**出现。
GET_MASTER = 'pinball.asset.logic:ILogicAssetContainer::getMasterTable'
#: 两个类的 globalLogic 都是 GlobalLogic；原生代码在它上面用公开名 getLogicAssets（EquipmentListScene/buttonClicked #64）。
GET_LOGIC_ASSETS = 'getLogicAssets'
GET_STACK = 'pinball.common.data.item:OwnedEquipmentPeek::get_stack'
GET_RARITY = 'pinball.common.data.item:GeneralEquipmentPeek::get_rarity'

PREFIX = 'equipment_sort_pin_'
#: 常量池只允许追加这 1 个字符串（全部多名复用 ABC 里已有的条目）。
ADDED_STRINGS = (PREFIX,)

CAPABILITY = 'equipment-sort-pin-v1'
#: 底包 = equipment-awakening-material 产物：编成槽框 b 版 APK 2f085757 的 12 项 + 觉醒专属素材 1 项。
INHERITED_CAPABILITIES = (
    'damage-type-rules-v1', 'dash-parameter-v1', 'equipment-awakening-material-v1',
    'equipment-description-override-v1', 'equipment-enhanced-look-v1', 'equipment-enhanced-party-frame-v1',
    'equipment-gauge-gain-rules-v1', 'equipment-rules-v1', 'gauge-gain-rules-v1', 'kyubi-fever-ratio-v1',
    'kyubi-panel-description-override-v1', 'kyubi-pf-initial-combo-v1', 'panel-description-override-v2',
)

#: 插入点（原方法体的指令下标）：方法入口。
ANCHORS = {LIST: 0, SELECT: 0}
#: 新局部变量从原 localcount 3 起编号，原方法体一个也读不到（两个方法相同）。
LOCALS = {'global': 3, 'assets': 4, 'table': 5, 'data': 6, 'row': 7, 'text': 8, 'value': 9, 'pa': 10, 'pb': 11}
#: 插入段只读 this / p1 / p2。
READS = frozenset({0, 1, 2})
#: 入口处原生指令的形状（名字、操作数中的多名全名）：第一比较键。形状变了就拒绝。
NATIVE_AT_ANCHOR = {
    LIST: (('getlocal_1', None), ('callproperty', GET_STACK)),
    SELECT: (('getlocal_1', None), ('callproperty', GET_RARITY)),
}
#: 原生体的指令条数与最后一条（returnvalue：id 相减）；变了就拒绝。
NATIVE_LENGTHS = {LIST: 38, SELECT: 23}
#: 插入段指令条数（设计值；测试逐一核对）。
INSERTED_COUNT = 92
INSERTED_COUNTS = {LIST: INSERTED_COUNT, SELECT: INSERTED_COUNT}
NEED_ACTIVATION = 0x02


def pin_key(equipment_id: int | str) -> str:
    """置顶序号的键（与插入段的拼接逐字相同）：键尾是 int(p.id) 的十进制串。"""
    return PREFIX + str(int(equipment_id))


# ---------------------------------------------------------------------------
# 指令片段
# ---------------------------------------------------------------------------

def _guarded(local, source, miss='NATIVE'):
    """栈 [] -> []：``local = <source>``；null / 空串 / false 跳 miss。"""
    return list(source) + [('setlocal', local), ('getlocal', local), ('iffalse', miss)]


def _pin(e, loc, param, out, done):
    """栈 [] -> []：``out = 规范正整数(custom_ability_string[PREFIX + int(param.id)].string)``，否则 0。"""
    q = e.q
    return [('pushbyte', 0), ('setlocal', loc[out]),
            ('getlocal', loc['data']), e.string(PREFIX), (param,), ('getproperty', q('id')), ('convert_i',), ('add',),
            ('callproperty', q('getMaybe'), 1), ('setlocal', loc['row']),
            ('getlocal', loc['row']), ('iffalse', done),
            ('getlocal', loc['row']), ('getproperty', q('string')), ('setlocal', loc['text']),
            ('getlocal', loc['text']), ('convert_i',), ('setlocal', loc['value']),
            ('getlocal', loc['value']), ('convert_s',), ('getlocal', loc['text']), ('ifstrictne', done),
            ('getlocal', loc['value']), ('pushbyte', 0), ('ifngt', done),
            ('getlocal', loc['value']), ('setlocal', loc[out]),
            ('label', done)]


def insertion(e):
    """compareByEquipmentStatus / sortByRarity(p1, p2):int 的入口。有置顶序号的在前，其余落到原生。"""
    q, loc = e.q, LOCALS
    # 1. data = this.globalLogic.getLogicAssets().getMasterTableMaybe(CAS).get_data()；任一环节 null → 原生
    code = _guarded(loc['global'], [('getlocal_0',), ('getproperty', q('globalLogic'))])
    code += _guarded(loc['assets'], [('getlocal', loc['global']), ('callproperty', q(GET_LOGIC_ASSETS), 0)])
    code += _guarded(loc['table'], [('getlocal', loc['assets']), ('getlex', q(CAS)), ('callproperty', q(MAYBE), 1)])
    code += _guarded(loc['data'], [('getlocal', loc['table']), ('callproperty', q('get_data'), 0)])
    # 2. 两件的序号（无 / 不合法 = 0）
    code += _pin(e, loc, 'getlocal_1', 'pa', 'PA_DONE')
    code += _pin(e, loc, 'getlocal_2', 'pb', 'PB_DONE')
    # 3. 比较
    code += [('getlocal', loc['pa']), ('iffalse', 'NO_A'),
             ('getlocal', loc['pb']), ('iffalse', 'ONLY_A'),
             ('getlocal', loc['pa']), ('getlocal', loc['pb']), ('ifeq', 'NATIVE'),
             ('getlocal', loc['pa']), ('getlocal', loc['pb']), ('subtract_i',), ('returnvalue',),
             ('label', 'ONLY_A'),
             e.number(-1), ('returnvalue',),
             ('label', 'NO_A'),
             ('getlocal', loc['pb']), ('iffalse', 'NATIVE'),
             e.number(1), ('returnvalue',),
             ('label', 'NATIVE')]
    return code


# ---------------------------------------------------------------------------
# 锚点与登记
# ---------------------------------------------------------------------------

def _operand_name(abc, x):
    return abc.mn_name(x.args[0]) if x.args else None


def find_anchor(e, asm, bodies, label):
    """要求：无活动对象 / 异常表 / 体内 trait；没有任何原有分支指向入口；原 localcount 恰好等于新局部起点；
    入口两条指令形状不变、原生体长度与收尾（id 相减 returnvalue）不变；尚未打过本补丁。"""
    abc = e.abc
    body = abc.bodies[bodies.resolve(abc, label)]
    ins = asm.decode(body[5])
    at = ANCHORS[label]
    if abc.methods[body[0]][3] & NEED_ACTIVATION or body[6] or body[7]:
        raise asm.AsmError(f'{label} gained an activation, exception table or body traits')
    incoming = [i for i, x in enumerate(ins) if x.target == at or (x.cases and at in [x.default, *x.cases])]
    if incoming:
        raise asm.AsmError(f'{label} anchor #{at} is a branch target: {incoming}')
    first_new = min(LOCALS.values())
    if body[2] != first_new or asm.block_locals(ins) > first_new:
        raise asm.AsmError(f'{label} localcount {body[2]} != first new local {first_new}')
    for offset, (name, operand) in enumerate(NATIVE_AT_ANCHOR[label]):
        x = ins[at + offset]
        got = _operand_name(abc, x) if operand is not None else None
        if x.name != name or (operand is not None and got != operand):
            raise asm.AsmError(f'{label} native #{at + offset} changed: {x}')
    tail = [x.name for x in ins[-3:]]
    if len(ins) != NATIVE_LENGTHS[label] or tail != ['convert_i', 'subtract_i', 'returnvalue'] \
            or _operand_name(abc, ins[-4]) != 'id':
        raise asm.AsmError(f'{label} native body no longer ends with the id comparison')
    for x in ins:
        if x.name == 'pushstring' and abc.strings[x.args[0]] == PREFIX.encode():
            raise asm.AsmError(f'{label} already probes {PREFIX}')
    return at


def install(e, asm, bodies, mutate=None):
    """在 Editor 上登记两段插入；返回锚点。调用方负责 ``e.apply()``。

    ``mutate(e, label, code) -> code`` 只供测试 / verify 构造变异体（负对照），交付构建不传。
    """
    anchors = {label: find_anchor(e, asm, bodies, label) for label in TARGETS}
    for label in TARGETS:
        code = insertion(e)
        if mutate is not None:
            code = mutate(e, label, code)
        e.insert(label, anchors[label], code, asm.FORBID)
    return anchors
