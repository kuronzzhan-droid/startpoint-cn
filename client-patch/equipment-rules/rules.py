"""装备规则补丁（equipment-rules）的全部指令：纯函数，只依赖传入的 battle-rules Editor。

三条规则：

* R2 诅咒互斥：本方 3 个主位的武器槽 + 魂珠槽里，诅咒段装备 ≥ ``cursed_threshold`` 件时，
  所有诅咒装备的整件能力（本体 + 强化）失效。
* R1 衰减分档：衰减段装备（PARADOX）按「其他装备件数 n」换成分档键 id+stride·n；
  n ≥ ``decay_off`` 时整件失效。武器换档时本体魂与强化能力一起换（v2）。
* R3 装备表 423：battle-rules 的「限制技能槽增加」（持续内容 423）原本只扩展了
  ability 表解析器；这里给 equipment_enhancement_ability（c109）与 ability_soul（c106）
  各插一段同构解析，其后的解析结果、战斗汇总、说明与面板消费点全部复用 battle-rules。

插入点与方法锁见 baseline.json；锚点一律按指令模式查找并要求唯一。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

CHAR = 'pinball.common.data.character::BattleCharacterLogic'
SOUL = 'pinball.common.data.ability::AbilitySoulAbilityLogic'
EQUIP = 'pinball.common.data.ability::EquipmentAbilityLogic'
ENH = 'pinball.common.data.ability::EquipmentEnhancementAbilityLogic'
SOUL_TABLE = 'pinball.master.generated::AbilitySoulTable'
ENH_TABLE = 'pinball.master.generated::EquipmentEnhancementAbilityTable'
GET_MASTER = 'pinball.asset.logic:ILogicAssetContainer::getMasterTable'
EXISTS = 'pinball.master.runtime:MasterMap::exists'
OPTION = 'haxe.ds::Option'
MASTER = 'pinball.common.data.ability.during::CommonAbilityContentMasterValue'

GAA = 'BattleCharacterLogic/getAvailableAbilities'
RPC = 'BattleCharacterLogic/resolvePathCollection'
EA_PARSE = 'EquipmentEnhancementAbilityValues$/parseAt109'
SOUL_PARSE = 'AbilitySoulValues$/parseAt106'

#: R3：与 battle-rules content.SPECS[0] 同一构造（测试逐项比对，防止两边漂移）。
GAUGE_KIND, GAUGE_CHARACTER_INDEX, GAUGE_TAG = 423, 37, 'GaugeGainRestriction'
#: 表 → (解析器方法, 值类, 目标列 parseAt, 规则码列 parseAt)
GAUGE_PARSERS = {
    'equipment_enhancement_ability': (EA_PARSE, 'pinball.master.generated::EquipmentEnhancementAbilityValues', 110, 118),
    'ability_soul': (SOUL_PARSE, 'pinball.master.generated::AbilitySoulValues', 107, 115),
}

CAPABILITY_RULES = 'equipment-rules-v1'                 # R1/R2：行为型，旧客户端读到分档键不崩、只是不生效
CAPABILITY_GAUGE = 'equipment-gauge-gain-rules-v1'      # R3：装备两表的 423，旧客户端读到即 C7050
#: 1047 客户端（SWF 6e7b2db7…）已具备的能力；来源 D:/WF/out/q1056/…/客户端前提.json 的 required_capabilities。
INHERITED_CAPABILITIES = (
    'damage-type-rules-v1', 'dash-parameter-v1', 'gauge-gain-rules-v1', 'kyubi-fever-ratio-v1',
    'kyubi-panel-description-override-v1', 'kyubi-pf-initial-combo-v1', 'panel-description-override-v2',
)

INT_MAX = 2147483647


@dataclass(frozen=True)
class Config:
    """构建参数。改任何一项都会改变输出 SWF；apply 脚本只接受 DEFAULT。"""
    cursed: tuple = ((5910101, 5910199),)       # 诅咒段（保留段）
    cursed_extra: tuple = ()                    # 额外计为诅咒的 id 或 (lo, hi)；作者 0928 定：PARADOX 不算诅咒
    decay: tuple = ((5920001, 5920999),)        # 衰减段
    tier_stride: int = 1000                     # 分档键 = 原键 + stride × n
    cursed_threshold: int = 2                   # R2：诅咒 ≥ 此件数时全部失效
    decay_off: int = 4                          # R1：其他装备 n ≥ 此数时整件失效
    full_decay_key: bool = False                # True：n ≥ decay_off 时若存在 id+stride×decay_off 键则用它（如只留诅咒）
    gauge_tables: tuple = ('equipment_enhancement_ability', 'ability_soul')

    def cursed_ranges(self):
        return tuple(_as_range(x) for x in self.cursed + self.cursed_extra)

    def decay_ranges(self):
        return tuple(_as_range(x) for x in self.decay)

    def tier_numbers(self):
        last = self.decay_off if self.full_decay_key else self.decay_off - 1
        return tuple(range(1, last + 1))

    def as_dict(self):
        return asdict(self)


DEFAULT = Config()


def _as_range(value):
    if isinstance(value, int):
        return (value, value)
    lo, hi = value
    return (int(lo), int(hi))


def validate(config: Config) -> None:
    ranges = config.cursed_ranges() + config.decay_ranges()
    for lo, hi in ranges:
        if not 0 < lo <= hi <= INT_MAX:
            raise ValueError(f'invalid id range {(lo, hi)}')
    if not 2 <= config.cursed_threshold <= 6:
        raise ValueError('cursed_threshold must be 2..6')
    if not 1 <= config.decay_off <= 6:
        raise ValueError('decay_off must be 1..6')
    if config.tier_stride <= 0:
        raise ValueError('tier_stride must be positive')
    for lo, hi in config.decay_ranges():
        for n in config.tier_numbers():
            tlo, thi = lo + config.tier_stride * n, hi + config.tier_stride * n
            if thi > INT_MAX:
                raise ValueError('tier id overflows int32')
            for alo, ahi in ranges:
                if tlo <= ahi and alo <= thi:
                    raise ValueError(f'tier ids {tlo}..{thi} overlap a rule range {alo}..{ahi}')
    unknown = set(config.gauge_tables) - set(GAUGE_PARSERS)
    if unknown:
        raise ValueError(f'unsupported gauge tables: {sorted(unknown)}')


# ---------------------------------------------------------------------------
# 新增方法（BattleCharacterLogic 实例方法）。全部无循环、无向后跳转。
# ---------------------------------------------------------------------------

def _membership(e, ranges, local):
    code = []
    for k, (lo, hi) in enumerate(ranges):
        nxt = f'NEXT{k}'
        if lo == hi:
            code += [('getlocal', local), e.number(lo), ('ifne', nxt)]
        else:
            code += [('getlocal', local), e.number(lo), ('iflt', nxt),
                     ('getlocal', local), e.number(hi), ('ifgt', nxt)]
        code += [('pushtrue',), ('returnvalue',), ('label', nxt)]
    return code + [('pushfalse',), ('returnvalue',)]


def is_cursed_body(e, c):
    """wfIsCursedSoul(id:int):Boolean"""
    return [('getlocal_0',), ('pushscope',)] + _membership(e, c.cursed_ranges(), 1)


def is_decay_body(e, c):
    """wfIsDecaySoul(id:int):Boolean"""
    return [('getlocal_0',), ('pushscope',)] + _membership(e, c.decay_ranges(), 1)


def count_body(e, c):
    """wfCountEquipment(party:Object, cursedOnly:Boolean):int —— 3 个主位的武器槽 + 魂珠槽。

    主位为空时原生 getBattleEquipment/getAbilitySoul 已返回 None；cursedOnly 时按魂 id 判诅咒段。
    """
    q, cursed = e.q, e.newq('wfIsCursedSoul')
    code = [('getlocal_0',), ('pushscope',), ('pushbyte', 0), ('setlocal_3',)]
    for slot in (0, 1, 2):
        for getter in ('getBattleEquipment', 'getAbilitySoul'):
            nxt, hit = f'N{slot}{getter}', f'C{slot}{getter}'
            code += [('getlocal_1',), ('pushbyte', slot), ('callproperty', q(getter), 1), ('setlocal', 4),
                     ('getlocal', 4), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', nxt),
                     ('getlocal_2',), ('iffalse', hit),
                     ('getlocal_0',), ('getlocal', 4), ('getproperty', q('params')), ('pushbyte', 0),
                     ('getproperty', 14), ('callproperty', q('get_abilitySoulId'), 0), ('convert_i',),
                     ('callproperty', cursed, 1), ('iffalse', nxt),
                     ('label', hit), ('inclocal_i', 3), ('label', nxt)]
    return code + [('getlocal_3',), ('returnvalue',)]


def _exists(e, table, key_local):
    """栈：[] -> [Boolean]；assets 在 local 5。"""
    q = e.q
    return [('getlocal', 5), ('getlex', q(table)), ('callproperty', q(GET_MASTER), 1),
            ('callproperty', q('get_data'), 0), ('getlocal', key_local), ('callproperty', q(EXISTS), 1)]


def tier_body(e, c):
    """wfTierAbility(peek, soul, n):Object —— 分档能力；分档键缺失返回 null（调用方保留原能力）。

    locals: 1 peek 2 soul 3 n 4 tier soul id 5 assets 6 tier soul 7 enhancement Option
            8 原强化能力 9 tier 强化 id
    * peek === soul（魂珠槽、调试魂）：返回分档 AbilitySoulAbilityLogic；
    * 否则 peek 是 EquipmentAbilityLogic：本体换 id+stride·n；强化 Some 时同样换成
      EquipmentEnhancementAbilityLogic.createForEquipment(强化 id+stride·n, 原 currentLevel, 原 maxLevel)，
      再按原生 GeneralEquipmentLogic.getAbility 的方式包成 EquipmentAbilityLogic。
    """
    q = e.q
    stride = e.number(c.tier_stride)
    return [('getlocal_0',), ('pushscope',),
            ('getlocal_2',), ('getproperty', q('id')), ('convert_i',), stride, ('getlocal_3',),
            ('multiply_i',), ('add_i',), ('setlocal', 4),
            ('getlocal_2',), ('getproperty', q('logicAssets')), ('setlocal', 5)] + \
        _exists(e, SOUL_TABLE, 4) + [
            ('iftrue', 'HAVE_SOUL'), ('pushnull',), ('returnvalue',), ('label', 'HAVE_SOUL'),
            ('findpropstrict', q(SOUL)), ('getlocal_2',), ('getproperty', q('number')), ('getlocal', 4),
            ('getlocal_2',), ('getproperty', q('power')), ('getproperty', q('calculateMethod')),
            ('getlocal_2',), ('getproperty', q('isEquipment')), ('getlocal', 5),
            ('constructprop', q(SOUL), 5), ('setlocal', 6),
            ('getlocal_1',), ('getlocal_2',), ('ifstrictne', 'EQUIPMENT'), ('getlocal', 6), ('returnvalue',),
            ('label', 'EQUIPMENT'),
            ('getlocal_1',), ('getproperty', q('enhancementAbility')), ('setlocal', 7),
            ('getlocal', 7), ('getproperty', q('index')), ('pushbyte', 0), ('ifeq', 'HAVE_ENH_PART'),
            ('findpropstrict', q(EQUIP)), ('getlocal', 6), ('getlocal', 7),
            ('getlocal_1',), ('getproperty', q('logicAssets')), ('constructprop', q(EQUIP), 3), ('returnvalue',),
            ('label', 'HAVE_ENH_PART'),
            ('getlocal', 7), ('getproperty', q('params')), ('pushbyte', 0), ('getproperty', 14), ('setlocal', 8),
            ('getlocal', 8), ('getproperty', q('id')), ('convert_i',), stride, ('getlocal_3',),
            ('multiply_i',), ('add_i',), ('setlocal', 9)] + \
        _exists(e, ENH_TABLE, 9) + [
            ('iftrue', 'HAVE_ENH'), ('pushnull',), ('returnvalue',), ('label', 'HAVE_ENH'),
            ('findpropstrict', q(EQUIP)), ('getlocal', 6),
            ('getlex', q(OPTION)), ('getlex', q(ENH)), ('getlocal', 9),
            ('getlocal', 8), ('getproperty', q('currentLevel')), ('getlocal', 8), ('getproperty', q('maxLevel')),
            ('getlocal', 8), ('getproperty', q('logicAssets')), ('callproperty', q('createForEquipment'), 4),
            ('callproperty', q('Some'), 1),
            ('getlocal_1',), ('getproperty', q('logicAssets')), ('constructprop', q(EQUIP), 3), ('returnvalue',)]


def rule_body(e, c):
    """wfEquipmentRule(peek, soul, party):Object —— 原 peek / 分档能力 / null（失效）。

    locals: 1 peek 2 soul 3 party 4 id 5 n 6 tier
    """
    q = e.q
    count, tier = e.newq('wfCountEquipment'), e.newq('wfTierAbility')
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_2',), ('getproperty', q('id')), ('convert_i',), ('setlocal', 4),
            # R2
            ('getlocal_0',), ('getlocal', 4), ('callproperty', e.newq('wfIsCursedSoul'), 1), ('iffalse', 'NOT_CURSED'),
            ('getlocal_0',), ('getlocal_3',), ('pushtrue',), ('callproperty', count, 2),
            e.number(c.cursed_threshold), ('iflt', 'NOT_CURSED'),
            ('pushnull',), ('returnvalue',),
            ('label', 'NOT_CURSED'),
            # R1
            ('getlocal_0',), ('getlocal', 4), ('callproperty', e.newq('wfIsDecaySoul'), 1), ('iffalse', 'KEEP'),
            ('getlocal_0',), ('getlocal_3',), ('pushfalse',), ('callproperty', count, 2),
            ('decrement_i',), ('setlocal', 5),
            ('getlocal', 5), ('pushbyte', 0), ('ifle', 'KEEP'),
            ('getlocal', 5), e.number(c.decay_off), ('iflt', 'TIER')]
    if c.full_decay_key:
        code += [('getlocal_0',), ('getlocal_1',), ('getlocal_2',), e.number(c.decay_off),
                 ('callproperty', tier, 3), ('setlocal', 6), ('getlocal', 6), ('iftrue', 'RETURN_TIER')]
    code += [('pushnull',), ('returnvalue',),
             ('label', 'TIER'),
             ('getlocal_0',), ('getlocal_1',), ('getlocal_2',), ('getlocal', 5),
             ('callproperty', tier, 3), ('setlocal', 6),
             ('getlocal', 6), ('iffalse', 'KEEP'),
             ('label', 'RETURN_TIER'), ('getlocal', 6), ('returnvalue',),
             ('label', 'KEEP'), ('getlocal_1',), ('returnvalue',)]
    return code


def preload_body(e, c):
    """wfPreloadEquipmentTiers(fn:Function):void —— 把武器槽 / 魂珠槽的衰减装备的全部分档能力交给
    resolvePathCollection 原生预载闭包，保证分档专用 DSL、固有状态等资源开战前已登记。

    locals: 1 fn 2 装备 Option→EquipmentAbilityLogic / 魂 Option 3 soul 4 tier
    """
    q, tier, decay = e.q, e.newq('wfTierAbility'), e.newq('wfIsDecaySoul')

    def feed(prefix, peek_local, end):
        code = [('getlocal_0',), ('getlocal_3',), ('getproperty', q('id')), ('convert_i',),
                ('callproperty', decay, 1), ('iffalse', end)]
        for n in c.tier_numbers():
            code += [('getlocal_0',), ('getlocal', peek_local), ('getlocal_3',), e.number(n),
                     ('callproperty', tier, 3), ('setlocal', 4),
                     ('getlocal', 4), ('iffalse', f'{prefix}{n}'),
                     ('getlocal_1',), ('pushnull',), ('getlocal', 4), ('call', 1), ('pop',),
                     ('label', f'{prefix}{n}')]
        return code

    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('getproperty', q('equipment')), ('setlocal_2',),
            ('getlocal_2',), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'SOUL_SLOT'),
            ('getlocal_2',), ('getproperty', q('params')), ('pushbyte', 0), ('getproperty', 14),
            ('callproperty', q('getCurrentAbility'), 0), ('setlocal_2',),
            ('getlocal_2',), ('getproperty', q('abilitySoulAbility')), ('setlocal_3',)]
    code += feed('W', 2, 'SOUL_SLOT')
    code += [('label', 'SOUL_SLOT'),
             ('getlocal_0',), ('callproperty', q('getAbilitySoulAbility'), 0), ('setlocal_2',),
             ('getlocal_2',), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'DONE'),
             ('getlocal_2',), ('getproperty', q('params')), ('pushbyte', 0), ('getproperty', 14), ('setlocal_3',)]
    code += feed('S', 3, 'DONE')
    return code + [('label', 'DONE'), ('returnvoid',)]


#: (名称, 返回类型, 参数类型, 生成函数, locals)
METHODS = (
    ('wfIsCursedSoul', 'Boolean', ['int'], is_cursed_body, 2),
    ('wfIsDecaySoul', 'Boolean', ['int'], is_decay_body, 2),
    ('wfCountEquipment', 'int', ['Object', 'Boolean'], count_body, 5),
    ('wfTierAbility', 'Object', ['Object', 'Object', 'int'], tier_body, 10),
    ('wfEquipmentRule', 'Object', ['Object', 'Object', 'Object'], rule_body, 7),
    ('wfPreloadEquipmentTiers', 'void', ['Function'], preload_body, 5),
)


# ---------------------------------------------------------------------------
# 插入段与锚点
# ---------------------------------------------------------------------------

def gate_insertion(e):
    """getAvailableAbilities：深渊门控之后、原生 if(_loc14_) 之前。
    locals: 1 party 12 解包后的魂（非装备能力为 null）13 能力 peek 14 是否生效。"""
    return [('getlocal', 14), ('iffalse', 'SKIP'),
            ('getlocal', 12), ('iffalse', 'SKIP'),
            ('getlocal_0',), ('getlocal', 13), ('getlocal', 12), ('getlocal_1',),
            ('callproperty', e.newq('wfEquipmentRule'), 3), ('coerce_a',), ('setlocal', 13),
            ('getlocal', 13), ('iftrue', 'SKIP'),
            ('pushfalse',), ('setlocal', 14),
            ('label', 'SKIP')]


def preload_insertion(e):
    """resolvePathCollection：装备预载 switch 的汇合点；激活对象槽 7 = 原生预载闭包 _loc13_。"""
    return [('getlocal_0',), ('getscopeobject', 1), ('getslot', 7),
            ('callpropvoid', e.newq('wfPreloadEquipmentTiers'), 1)]


def gauge_parse_insertion(e, values_class, target_at, uid_at):
    """与 battle-rules content.install 对 AbilityValues$/parseAt109 的 423 分支逐指令同构。"""
    q, end = e.q, 'NOT_GAUGE'
    return [('getlocal_2',), e.string(str(GAUGE_KIND)), ('ifne', end),
            ('getlex', q(MASTER)), e.string(GAUGE_TAG), e.number(GAUGE_KIND), e.string('target'),
            ('getlex', q(values_class)), ('getlocal_1',), ('callproperty', q(f'parseAt{target_at}'), 1),
            e.string('unique_condition_id'),
            ('getlex', q(values_class)), ('getlocal_1',), ('callproperty', q(f'parseAt{uid_at}'), 1),
            ('newobject', 2), ('newarray', 1), ('construct', 3), ('coerce', q(MASTER)), ('returnvalue',),
            ('label', end)]


def find_gate_point(e, asm, bodies):
    ins = asm.decode(e.abc.bodies[bodies.resolve(e.abc, GAA)][5])
    hits = [i for i in range(len(ins) - 3)
            if ins[i].name == 'getlocal' and ins[i].args == [14]
            and ins[i + 1].name == 'iffalse'
            and ins[i + 2].name == 'getlocal' and ins[i + 2].args == [13]
            and ins[i + 3].name == 'callproperty' and e.abc.mn_name(ins[i + 3].args[0]) == 'getTriggers']
    if len(hits) != 1:
        raise asm.AsmError(f'getAvailableAbilities if(_loc14_) boundary not unique: {hits}')
    return hits[0]


def find_preload_point(e, asm, bodies):
    ins = asm.decode(e.abc.bodies[bodies.resolve(e.abc, RPC)][5])
    calls = [i for i, x in enumerate(ins) if x.name == 'callproperty'
             and e.abc.mn_name(x.args[0]) == 'getCurrentAbility']
    if len(calls) != 1 or ins[calls[0] + 1].name != 'callpropvoid' or ins[calls[0] + 2].name != 'jump':
        raise asm.AsmError('resolvePathCollection equipment preload shape changed')
    merge = ins[calls[0] + 2].target
    nxt = ins[merge:merge + 3]
    if [x.name for x in nxt] != ['getscopeobject', 'pushbyte', 'setslot']:
        raise asm.AsmError('resolvePathCollection equipment merge point changed')
    return merge


def find_parse_point(e, asm, bodies, label):
    ins = asm.decode(e.abc.bodies[bodies.resolve(e.abc, label)][5])
    shape = [x.name for x in ins[:7]]
    if shape != ['getlocal_1', 'pushbyte', 'getproperty', 'coerce', 'coerce', 'setlocal_2', 'getlocal_2']:
        raise asm.AsmError(f'{label} prologue changed: {shape}')
    if any(x.name == 'pushstring' and e.abc.strings[x.args[0]] == str(GAUGE_KIND).encode() for x in ins):
        raise asm.AsmError(f'{label} already parses {GAUGE_KIND}')
    return 6


def install(e, asm, bodies, config: Config = DEFAULT):
    """在 Editor 上登记全部新增方法与插入；返回锚点报告。调用方负责 e.apply()。"""
    validate(config)
    anchors = {GAA: find_gate_point(e, asm, bodies), RPC: find_preload_point(e, asm, bodies)}
    for table in config.gauge_tables:
        label = GAUGE_PARSERS[table][0]
        anchors[label] = find_parse_point(e, asm, bodies, label)
    for name, returns, args, body, locals_ in METHODS:
        e.add_method(CHAR, name, returns, args, body(e, config), locals_)
    e.insert(GAA, anchors[GAA], gate_insertion(e), asm.ENTER)
    e.insert(RPC, anchors[RPC], preload_insertion(e), asm.ENTER)
    for table in config.gauge_tables:
        label, values_class, target_at, uid_at = GAUGE_PARSERS[table]
        e.insert(label, anchors[label], gauge_parse_insertion(e, values_class, target_at, uid_at), asm.ENTER)
    return anchors
