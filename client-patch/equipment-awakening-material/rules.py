"""觉醒专属素材（equipment-awakening-material）的全部指令：纯函数，只依赖传入的 battle-rules Editor。

一处单方法指令插入（不回编 AS3、不走 FFDec），方法锁见 baseline.json：

``OwnedEquipmentLogic/getUseableAwakingCrystal(repo, time)``（体 19792）在 #12 插一段。#5–#8 是
``if (hasStack())`` 的判断，为真走 #9 返回 None（优先用重复本体，原样不动）；为假 ``iffalse`` 跳到 #12，
#12 起是原生「按稀有度挑觉醒道具」（``repo.getEquipmentAwakingCrystal(get_rarity())``）。
#12 是分支目标，插入用 ENTER 策略：原有的那一条 ``iffalse`` 落到插入段开头，所以「没有重复本体」的
每一条路径都先经过插入段；hasStack 为真的路径完全不经过它。

插入段查 ``custom_ability_string["awakening_material_" + this.id]``（取表只用不抛错的
``getMasterTableMaybe`` + ``getMaybe``，绝不调用会抛 8013/8014 的 ``getMasterTable``）：

* 表没加载 / 没有这一行 → 落到原生入口（原逻辑一字不改：官方装备照旧提供星铁钢）；
* **行存在 = 这件装备受限**，从这里起**永远不回落原生**（回落原生就是提供星铁钢，违背需求）：
  值必须是规范十进制正整数（``String(int(s)) === s`` 且 ``int(s) > 0``），道具表里有这一行
  （``repo.logicAssets.getMasterTableMaybe(ItemTable).get_data().getMaybe(id)`` 非 null，
  否则 ``repo.get(id)`` 的构造会取到 null 行而出错），持有数 > 0，``isAvailable(time)`` 为真
  → ``return Some(repo.get(id))``；任一条不满足 → ``return None``（显示「没有可用的觉醒素材」）。

插入段只写新局部（从原 localcount 5 起编号），只读 ``this`` / ``repo`` / ``time``；没有属性写、没有无返回值调用。
"""
from __future__ import annotations

LOGIC = 'pinball.common.data.item::OwnedEquipmentLogic'
LABEL = 'OwnedEquipmentLogic/getUseableAwakingCrystal'
#: 只有这一个目标方法。
TARGETS = (LABEL,)

CAS = 'pinball.master.generated::CustomAbilityStringTable'
ITEM_TABLE = 'pinball.master.generated::ItemTable'
MAYBE = 'pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'
#: 会抛 8013/8014 的取表；插入段里**绝不**出现。
GET_MASTER = 'pinball.asset.logic:ILogicAssetContainer::getMasterTable'
#: 原生的「按稀有度挑觉醒道具」；插入段里绝不调用（受限装备不得回落到它）。
NATIVE_PICK = 'getEquipmentAwakingCrystal'
OPTION = 'haxe.ds::Option'

PREFIX = 'awakening_material_'
#: 常量池只允许追加这 1 个字符串（全部多名复用 ABC 里已有的条目）。
ADDED_STRINGS = (PREFIX,)

CAPABILITY = 'equipment-awakening-material-v1'
#: equipment-enhanced-party-frame b 版 APK（2f085757…）声明的 12 项能力（与本机已装的 a 版 14396ce0 相同）。
INHERITED_CAPABILITIES = (
    'damage-type-rules-v1', 'dash-parameter-v1', 'equipment-description-override-v1', 'equipment-enhanced-look-v1',
    'equipment-enhanced-party-frame-v1', 'equipment-gauge-gain-rules-v1', 'equipment-rules-v1',
    'gauge-gain-rules-v1', 'kyubi-fever-ratio-v1', 'kyubi-panel-description-override-v1',
    'kyubi-pf-initial-combo-v1', 'panel-description-override-v2',
)

#: 插入点（原方法体的指令下标）：hasStack() 为假时 iffalse 的落点、原生按稀有度查询的第一条。
ANCHOR = 12
ANCHORS = {LABEL: ANCHOR}
#: 指向锚点的原有分支：只有 #8（hasStack 的 iffalse）。ENTER：它落到插入段开头。
INCOMING = (8,)
#: 新局部变量从原 localcount 起编号，原方法体一个也读不到。
LOCALS = {'key': 5, 'assets': 6, 'table': 7, 'row': 8, 'text': 9, 'item_id': 10, 'repo_assets': 11,
          'items': 12, 'item': 13}
#: 插入段只读这些原有寄存器：this / repo / time。
READS = frozenset({0, 1, 2})
#: 锚点前后原生指令的形状（名字、操作数中的多名全名）。形状变了就拒绝。
NATIVE_AT_ANCHOR = (('returnvalue', None), ('getlocal_1', None), ('findproperty', 'get_rarity'))
#: 插入段指令条数（设计值；测试逐一核对）。
INSERTED_COUNT = 76
INSERTED_COUNTS = {LABEL: INSERTED_COUNT}
NEED_ACTIVATION = 0x02


def material_key(equipment_id: int | str) -> str:
    """专属觉醒素材的键（与插入段的拼接逐字相同）：键尾是装备 ID 的十进制串（``this.id`` 是 int）。"""
    return PREFIX + str(int(equipment_id))


# ---------------------------------------------------------------------------
# 指令片段
# ---------------------------------------------------------------------------

def _guarded(local, source, miss):
    """栈 [] -> []：``local = <source>``；null / 空串 / false 跳 miss。"""
    return list(source) + [('setlocal', local), ('getlocal', local), ('iffalse', miss)]


def insertion(e):
    """getUseableAwakingCrystal(repo, time) 的 #12。键不存在 → 原生；键存在 → 只返回专属素材或 None。"""
    q, loc = e.q, LOCALS
    # 1. key = "awakening_material_" + this.id
    code = [e.string(PREFIX), ('getlocal_0',), ('getproperty', q('id')), ('add',), ('setlocal', loc['key'])]
    # 2. 行 = custom_ability_string[key]；表没加载 / 没有这一行 → 原生
    code += _guarded(loc['assets'], [('getlocal_0',), ('getproperty', q('logicAssets'))], 'NATIVE')
    code += _guarded(loc['table'], [('getlocal', loc['assets']), ('getlex', q(CAS)), ('callproperty', q(MAYBE), 1)],
                     'NATIVE')
    code += _guarded(loc['row'], [('getlocal', loc['table']), ('callproperty', q('get_data'), 0),
                                  ('getlocal', loc['key']), ('callproperty', q('getMaybe'), 1)], 'NATIVE')
    # ---- 从这里起这件装备受限：只返回专属素材或 None，绝不回落原生（原生 = 星铁钢） ----
    # 3. id = int(row.string)；必须是规范十进制正整数
    code += [('getlocal', loc['row']), ('getproperty', q('string')), ('setlocal', loc['text']),
             ('getlocal', loc['text']), ('convert_i',), ('setlocal', loc['item_id']),
             ('getlocal', loc['item_id']), ('convert_s',), ('getlocal', loc['text']), ('ifstrictne', 'NONE'),
             ('getlocal', loc['item_id']), ('pushbyte', 0), ('ifngt', 'NONE')]
    # 4. 道具表里有这一行（repo.get 用的就是 repo.logicAssets 这张表；缺行时它的构造会取到 null 行）
    code += [('getlocal_1',), ('iffalse', 'NONE')]
    code += _guarded(loc['repo_assets'], [('getlocal_1',), ('getproperty', q('logicAssets'))], 'NONE')
    code += _guarded(loc['items'], [('getlocal', loc['repo_assets']), ('getlex', q(ITEM_TABLE)),
                                    ('callproperty', q(MAYBE), 1)], 'NONE')
    code += [('getlocal', loc['items']), ('callproperty', q('get_data'), 0), ('getlocal', loc['item_id']),
             ('callproperty', q('getMaybe'), 1), ('iffalse', 'NONE')]
    # 5. item = repo.get(id)；持有数 > 0 且在有效期内 → Some(item)
    code += _guarded(loc['item'], [('getlocal_1',), ('getlocal', loc['item_id']), ('callproperty', q('get'), 1)],
                     'NONE')
    code += [('getlocal', loc['item']), ('getproperty', q('number')), ('pushbyte', 0), ('ifngt', 'NONE'),
             ('getlocal', loc['item']), ('getlocal_2',), ('callproperty', q('isAvailable'), 1), ('iffalse', 'NONE'),
             ('getlex', q(OPTION)), ('getlocal', loc['item']), ('callproperty', q('Some'), 1),
             ('coerce', q(OPTION)), ('returnvalue',),
             ('label', 'NONE'),
             ('getlex', q(OPTION)), ('getproperty', q('None')), ('returnvalue',),
             ('label', 'NATIVE')]
    return code


# ---------------------------------------------------------------------------
# 锚点与登记
# ---------------------------------------------------------------------------

def _operand_name(abc, x):
    return abc.mn_name(x.args[0]) if x.args else None


def find_anchor(e, asm, bodies, label=LABEL):
    """要求：无活动对象 / 异常表 / 体内 trait；指向锚点的原有分支恰好是 #8 的 iffalse（hasStack 为假）；
    原 localcount 恰好等于新局部起点；锚点前后指令形状不变，#16 仍是按稀有度查询；尚未打过本补丁。"""
    abc = e.abc
    body = abc.bodies[bodies.resolve(abc, label)]
    ins = asm.decode(body[5])
    at = ANCHORS[label]
    if [x.name for x in ins[:2]] != ['getlocal_0', 'pushscope']:
        raise asm.AsmError(f'{label} prologue changed')
    if abc.methods[body[0]][3] & NEED_ACTIVATION or body[6] or body[7]:
        raise asm.AsmError(f'{label} gained an activation, exception table or body traits')
    incoming = [i for i, x in enumerate(ins) if x.target == at or (x.cases and at in [x.default, *x.cases])]
    if tuple(incoming) != INCOMING:
        raise asm.AsmError(f'{label} anchor #{at} incoming branches {incoming} != {list(INCOMING)}')
    guard = ins[INCOMING[0]]
    if guard.name != 'iffalse' or _operand_name(abc, ins[INCOMING[0] - 2]) != 'hasStack' \
            or ins[INCOMING[0] - 2].name != 'callproperty':
        raise asm.AsmError(f'{label} #{INCOMING[0]} is no longer the hasStack() guard')
    first_new = min(LOCALS.values())
    if body[2] != first_new or asm.block_locals(ins) > first_new:
        raise asm.AsmError(f'{label} localcount {body[2]} != first new local {first_new}')
    for offset, (name, operand) in zip((-1, 0, 1), NATIVE_AT_ANCHOR):
        x = ins[at + offset]
        got = _operand_name(abc, x) if operand is not None else None
        if x.name != name or (operand is not None and got != operand):
            raise asm.AsmError(f'{label} native #{at + offset} changed: {x}')
    pick = ins[at + 4]
    if pick.name != 'callproperty' or _operand_name(abc, pick) != NATIVE_PICK:
        raise asm.AsmError(f'{label} native #{at + 4} is no longer {NATIVE_PICK}: {pick}')
    for x in ins:
        if x.name == 'pushstring' and abc.strings[x.args[0]] == PREFIX.encode():
            raise asm.AsmError(f'{label} already probes {PREFIX}')
    return at


def install(e, asm, bodies, mutate=None):
    """在 Editor 上登记插入段；返回 {标签: 锚点}。调用方负责 ``e.apply()``。

    ``mutate(e, label, code) -> code`` 只供测试 / verify 构造变异体（负对照），交付构建不传。
    """
    anchors = {LABEL: find_anchor(e, asm, bodies, LABEL)}
    code = insertion(e)
    if mutate is not None:
        code = mutate(e, LABEL, code)
    e.insert(LABEL, anchors[LABEL], code, asm.ENTER)
    return anchors
