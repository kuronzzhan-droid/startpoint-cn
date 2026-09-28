"""独立核验 equipment-description-override 输出 SWF：结构、字节级保持、可复现、行为矩阵、负对照与变异体。

    python -X utf8 client-patch/equipment-description-override/verify.py <out.swf> --base <equipment-rules.swf>

行为矩阵直接执行 SWF 里的真实字节码（desc_interp）：

* 三个被改方法**整方法**执行：命中返回设计形状；未命中时原生体照旧跑完，结果与原生相同
  （原生体所需的生成器、IntMap 迭代器、排序闭包、ClientError 2324 全部按反编译源码的语义模拟）；
* 消费链：``EquipmentAbilityLogic`` 的两个转发方法、``getEnhancementSlotDescriptionsForDialog`` →
  ``getSlotDescriptionsForDialog`` → ``viewableFilter``（全部真实字节码），按强化等级给出「已习得 / 未习得（灰）」；
* 探针记录：每次 ``getMaybe`` 的键、``getMasterTableMaybe`` 的表；假容器的 ``getMasterTable`` 一调用就报错；
* 截断执行：切到插入段末尾接哨兵（返回 this），未命中必须到达原生第一条指令。

负对照：同一矩阵在未打补丁的基线（equipment-rules 产物）上，所有命中项必须不满足、所有控制项必须相同；
变异体（去掉 returnvalue / 前缀写错）在命中项上必须变红。
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


rules = _load('equipment_desc_override_rules', HERE / 'rules.py')
desc_interp = _load('equipment_desc_override_desc_interp', HERE / 'desc_interp.py')
AvmThrow, Cls, DescInterp, slice_method = (desc_interp.AvmThrow, desc_interp.Cls, desc_interp.DescInterp,
                                           desc_interp.slice_method)

BASE_ABC_SHA = 'd99246d9ced7b7e81c81d27ad436347cb2a1b02b861558776f566ef091773b22'
PARADOX = 5920001
TIERS = (5921001, 5922001, 5923001)
OFFICIAL = 5020042
KEYS = rules.override_keys(PARADOX)
TEXT = {'base': 'B1\nB2\nB3', 'growth': 'G1\nG2', 'final': 'F1\nF2\nF3'}
ALL_ROWS = {KEYS[k]: TEXT[k] for k in ('base', 'growth', 'final')}
UI = {rules.DELIM_NEWLINE: '<NL>', rules.DELIM_INLINE: '<D>'}
METHOD_LABELS = {'lines': rules.BASE_LINES, 'text_newline': rules.BASE_TEXT, 'text_inline': rules.BASE_TEXT,
                 'blocks': rules.ENH_BLOCKS}
METHOD_ARGS = {'lines': (), 'text_newline': (True,), 'text_inline': (False,), 'blocks': ()}

AGDG = 'pinball.common.data.ability.description::AbilityGroupingDescriptionGenerator'
KEYS_ITERATOR = 'haxe.ds._IntMap::IntMapKeysIterator'
CALC = 'pinball.common.data.ability::AbilityPowerValueCalculateMethod'
POWER = 'pinball.common.data.ability::AbilityPowerValue'
TOOLS = 'pinball.common.data.ability::AbilityTriggerTools'
DIFFERENCE = 'pinball.common.data.ability::AbilityTriggerDifference'
OPTION = 'haxe.ds::Option'
NONE_OPTION = {'index': 1, 'params': [], '_type': 'Option'}

#: 设计上的方法体 header（maxstack, localcount, initscope, maxscope）与插入条数。
EXPECTED_HEADERS = {rules.BASE_LINES: [2, 9, 1, 2], rules.BASE_TEXT: [3, 6, 1, 2], rules.ENH_BLOCKS: [6, 31, 1, 2]}
#: 插入段允许出现的调用（callproperty 的多名全名）；getMasterTable 不在其中。
ALLOWED_CALLS = {rules.MAYBE, 'get_data', 'getMaybe', rules.SPLIT, rules.UI_STRING, rules.JOIN}
#: 叠加链上必须逐字节不变的既有补丁方法体（按标签）。
EQUIPMENT_RULES_BODIES = ('BattleCharacterLogic/getAvailableAbilities', 'BattleCharacterLogic/resolvePathCollection',
                          'EquipmentEnhancementAbilityValues$/parseAt109', 'AbilitySoulValues$/parseAt106')
EQUIPMENT_RULES_ADDED = tuple(f'BattleCharacterLogic/{n}' for n in (
    'wfIsCursedSoul', 'wfIsDecaySoul', 'wfCountEquipment', 'wfTierAbility', 'wfEquipmentRule',
    'wfPreloadEquipmentTiers'))
BR_ADDED = ('MemberAbilityTotalizerImpl/wfBlocksGauge', 'MemberImpl/wfAllowsGauge',
            'MemberAbilityTotalizerImpl/wfResolveDamageType', 'MemberImpl$/wfConvertNormalAttack',
            'MemberImpl$/wfGaugeFromAddress', 'MemberImpl$/wfGaugeFromAction')
KYUBI_BODIES = ('AbilityLogic/getDescriptions', 'AbilityLogic/getDescriptionWithSimplify',
                'LeaderAbilityLogic/getDescriptions', 'LeaderAbilityLogic/getDescriptionWithSimplify')


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def some(value):
    return {'index': 0, 'params': [value], '_type': 'Option'}


# ---------------------------------------------------------------------------
# 模拟世界（字段名与反编译源码一致）
# ---------------------------------------------------------------------------

class World:
    """一张 custom_ability_string（键 -> string；值 None = 行存在但 string 为 null）+ 原生生成器所需的类。"""

    def __init__(self, rows=None, loaded=True):
        self.rows = dict(rows or {})
        self.loaded = loaded
        self.maybe_calls, self.lookups, self.ui_calls = [], [], []
        self.lex = {
            rules.CAS: Cls(rules.CAS),
            rules.INTMAP: Cls(rules.INTMAP, ctor=lambda: {'_type': 'IntMap', 'h': {}}),
            AGDG: Cls(AGDG, ctor=self.generator),
            KEYS_ITERATOR: Cls(KEYS_ITERATOR, ctor=self.keys_iterator),
            CALC: Cls(CALC, MinToMaxLevelScale=lambda level, lo, hi: ('MinToMaxLevelScale', level, lo, hi)),
            POWER: Cls(POWER, ctor=lambda method: {'_type': 'AbilityPowerValue', 'method': method}),
            TOOLS: Cls(TOOLS, resolve=lambda master, power, _assets: f'{master}@{power["method"][1]}'),
            DIFFERENCE: Cls(DIFFERENCE, ctor=lambda a, b, _assets: {'isSameAbility': lambda: a == b}),
            OPTION: Cls(OPTION, **{'None': NONE_OPTION, 'Some': some}),
            'flash::Boot': {'lastError': None},
            'Error': Cls('Error', ctor=lambda: {'error': True}),
            'pinball.error::ClientError': Cls('ClientError', ctor=lambda code, message: {'code': code,
                                                                                         'message': message}),
        }
        self.assets = {'_type': 'ILogicAssetContainer', 'getMasterTableMaybe': self.table_maybe,
                       'getMasterTable': self.forbidden, 'getUiString': self.ui_string}

    def table_maybe(self, cls):
        self.maybe_calls.append(cls.name if isinstance(cls, Cls) else repr(cls))
        if cls is not self.lex[rules.CAS]:
            raise AssertionError(f'unexpected master table {cls!r}')
        return {'get_data': lambda: {'getMaybe': self.get_maybe}} if self.loaded else None

    def get_maybe(self, key):
        self.lookups.append(key)
        return {'string': self.rows[key]} if key in self.rows else None

    @staticmethod
    def forbidden(*_args):
        raise AssertionError('getMasterTable must not be called (it throws when a table is missing)')

    def ui_string(self, key):
        self.ui_calls.append(key)
        return UI[key]

    def generator(self, assets):
        if assets is not self.assets:
            raise AssertionError('generator built with a foreign container')
        return {'_type': 'AbilityGroupingDescriptionGenerator',
                'stringfy': lambda sources, newline: self.ui_string(
                    rules.DELIM_NEWLINE if newline else rules.DELIM_INLINE).join(sources),
                'stringfyWithoutJoin': lambda sources: [f'desc:{s}' for s in sources]}

    @staticmethod
    def keys_iterator(h):
        keys = list(h)
        return {'hasNext': lambda: bool(keys), 'next': lambda: keys.pop(0)}

    # 被覆盖对象 ------------------------------------------------------------
    def soul(self, sid):
        """AbilitySoulAbilityLogic：原生本体说明 = N1 / N2。"""
        return {'_type': 'AbilitySoulAbilityLogic', 'id': sid, 'logicAssets': self.assets,
                'getActiveDescriptionsToMapForAbilitySoul': lambda: {'_type': 'IntMap', 'h': {1: ['N1', 'N2']}},
                'getTriggersWithoutAdditional': lambda: ['trigger1', 'trigger2'],
                'createDescriptionSources': lambda triggers: [f'N{i + 1}' for i in range(len(triggers))]}

    def enhancement(self, eid, native='plain', max_level=120, current=0):
        """EquipmentEnhancementAbilityLogic。native='plain'：slot0 Lv1 随等级变化（上限 119），slot1 Lv120 固定；
        native='throws_2324'：slot0 Lv1 随等级变化之后还有 Lv50 —— 原生在 2324 处抛错。"""
        def intmap(mapping):
            return {'_type': 'IntMap', 'h': {k: {'_type': 'IntMap', 'h': dict(v)} for k, v in mapping.items()}}
        if native == 'plain':
            triggers, maxima, masters = {0: {1: 'trigA'}, 1: {120: 'trigB'}}, {0: {1: 119}, 1: {120: 120}}, \
                {0: {1: 'mvA'}, 1: {120: 'mvB'}}
        elif native == 'throws_2324':
            triggers, maxima, masters = {0: {1: 'trigA', 50: 'trigC'}}, {0: {1: 119, 50: 50}}, \
                {0: {1: 'mvA', 50: 'mvC'}}
        else:
            raise ValueError(native)
        return {'_type': 'EquipmentEnhancementAbilityLogic', 'id': eid, 'maxLevel': max_level,
                'currentLevel': current, 'logicAssets': self.assets, 'triggers': intmap(triggers),
                'maxPowerLevels': intmap(maxima), 'triggerMasterValues': intmap(masters),
                'createDescriptionSources': lambda items: list(items)}


# ---------------------------------------------------------------------------
# 执行
# ---------------------------------------------------------------------------

def decode(abc, label):
    return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])


def summarize(value):
    if isinstance(value, list):
        return ('lines', list(value))
    if isinstance(value, str):
        return ('text', value)
    if isinstance(value, dict) and 'h' in value:
        return ('blocks', {slot: {level: list(lines) for level, lines in sorted(block['h'].items())}
                           for slot, block in sorted(value['h'].items())})
    return ('other', repr(value))


def execute(abc, world, label, this, args=()):
    try:
        return summarize(DescInterp(abc, world.lex).run(decode(abc, label), [this, *args]))
    except AvmThrow as thrown:
        value = thrown.value
        return ('throw', value.get('code') if isinstance(value, dict) else repr(value))
    except (AssertionError, KeyError, TypeError, ValueError, AttributeError, IndexError) as exc:
        return ('error', type(exc).__name__, str(exc)[:160])


SCENARIOS = {
    # 名称: (装备 id, 表行, 表已加载, 强化原生数据, maxLevel)
    'paradox_all_keys': (PARADOX, ALL_ROWS, True, 'plain', 120),
    'paradox_growth_without_final': (PARADOX, {KEYS['base']: TEXT['base'], KEYS['growth']: TEXT['growth']},
                                     True, 'plain', 120),
    'paradox_final_empty': (PARADOX, dict(ALL_ROWS, **{KEYS['final']: ''}), True, 'plain', 120),
    'paradox_final_null': (PARADOX, dict(ALL_ROWS, **{KEYS['final']: None}), True, 'plain', 120),
    'paradox_max_level_80': (PARADOX, ALL_ROWS, True, 'plain', 80),
    'paradox_native_would_throw_2324': (PARADOX, ALL_ROWS, True, 'throws_2324', 120),
    'paradox_single_lines': (PARADOX, {KEYS['base']: 'ONE', KEYS['growth']: 'GROW', KEYS['final']: 'FIN'},
                             True, 'plain', 120),
    'paradox_enhancement_keys_only': (PARADOX, {KEYS['growth']: TEXT['growth'], KEYS['final']: TEXT['final']},
                                      True, 'plain', 120),
    'paradox_base_key_only': (PARADOX, {KEYS['base']: TEXT['base']}, True, 'plain', 120),
    'paradox_final_key_only': (PARADOX, {KEYS['final']: TEXT['final']}, True, 'plain', 120),
    'tier_5921001': (TIERS[0], ALL_ROWS, True, 'plain', 120),
    'tier_5922001': (TIERS[1], ALL_ROWS, True, 'plain', 120),
    'tier_5923001': (TIERS[2], ALL_ROWS, True, 'plain', 120),
    'official_5020042': (OFFICIAL, ALL_ROWS, True, 'plain', 120),
    'table_not_loaded': (PARADOX, ALL_ROWS, False, 'plain', 120),
    'rows_missing': (PARADOX, {}, True, 'plain', 120),
    'empty_strings': (PARADOX, {k: '' for k in ALL_ROWS}, True, 'plain', 120),
    'null_strings': (PARADOX, {k: None for k in ALL_ROWS}, True, 'plain', 120),
    'v2_panel_key_namespace': (PARADOX, {f'desc_override_{PARADOX}': 'X',
                                         f'desc_override_enhancement_{PARADOX}': 'Y'}, True, 'plain', 120),
    'tier_miss_keeps_native_2324': (TIERS[0], ALL_ROWS, True, 'throws_2324', 120),
}

NATIVE = {
    'lines': ('lines', ['N1', 'N2']),
    'text_newline': ('text', 'N1<NL>N2'),
    'text_inline': ('text', 'N1<D>N2'),
    'blocks': ('blocks', {0: {1: ['desc:trigA'], 119: ['desc:mvA@119']}, 1: {120: ['desc:trigB']}}),
}
NATIVE_2324 = ('throw', 2324)


def _override(lines):
    return {'lines': ('lines', lines), 'text_newline': ('text', '<NL>'.join(lines)),
            'text_inline': ('text', '<D>'.join(lines))}


BASE_HIT = _override(['B1', 'B2', 'B3'])
TWO_BLOCKS = ('blocks', {0: {1: ['G1', 'G2']}, 1: {120: ['F1', 'F2', 'F3']}})
GROWTH_ONLY = ('blocks', {0: {1: ['G1', 'G2']}})


def _expected():
    out = {}
    for name, (_sid, _rows, _loaded, native, _max) in SCENARIOS.items():
        for method in METHOD_LABELS:
            out[(name, method)] = NATIVE_2324 if method == 'blocks' and native == 'throws_2324' else NATIVE[method]
    for name in ('paradox_all_keys', 'paradox_growth_without_final', 'paradox_final_empty', 'paradox_final_null',
                 'paradox_max_level_80', 'paradox_native_would_throw_2324', 'paradox_base_key_only'):
        for method, value in BASE_HIT.items():
            out[(name, method)] = value
    for method, value in _override(['ONE']).items():
        out[('paradox_single_lines', method)] = value
    out[('paradox_all_keys', 'blocks')] = TWO_BLOCKS
    out[('paradox_native_would_throw_2324', 'blocks')] = TWO_BLOCKS
    out[('paradox_enhancement_keys_only', 'blocks')] = TWO_BLOCKS
    for name in ('paradox_growth_without_final', 'paradox_final_empty', 'paradox_final_null'):
        out[(name, 'blocks')] = GROWTH_ONLY
    out[('paradox_max_level_80', 'blocks')] = ('blocks', {0: {1: ['G1', 'G2']}, 1: {80: ['F1', 'F2', 'F3']}})
    out[('paradox_single_lines', 'blocks')] = ('blocks', {0: {1: ['GROW']}, 1: {120: ['FIN']}})
    return out


def native_expected(key):
    """未打补丁时（或未命中时）该项的原生结果。"""
    name, method = key
    return NATIVE_2324 if method == 'blocks' and SCENARIOS[name][3] == 'throws_2324' else NATIVE[method]


EXPECTED = _expected()
#: 命中项 = 期望值不是原生结果的项；其余为控制项（两边都必须等于原生结果）。
HITS = frozenset(k for k, v in EXPECTED.items() if v != native_expected(k))


def matrix_key(key):
    return f'{key[0]}:{key[1]}'


def run_scenario(abc, name, method):
    sid, rows, loaded, native, max_level = SCENARIOS[name]
    world = World(rows, loaded)
    if method == 'blocks':
        this = world.enhancement(sid, native, max_level)
    else:
        this = world.soul(sid)
    result = execute(abc, world, METHOD_LABELS[method], this, METHOD_ARGS[method])
    return result, {'maybe_tables': list(world.maybe_calls), 'lookups': list(world.lookups)}


def behaviour_matrix(abc):
    """{(场景, 方法): 结果摘要}，以及同键的探针记录。"""
    results, probes = {}, {}
    for name in SCENARIOS:
        for method in METHOD_LABELS:
            results[(name, method)], probes[(name, method)] = run_scenario(abc, name, method)
    return results, probes


#: 打补丁后的探针：取表只经 getMasterTableMaybe(CustomAbilityStringTable)，键由 id 拼出。
EXPECTED_PROBES = {
    ('paradox_all_keys', 'lines'): {'maybe_tables': [rules.CAS], 'lookups': [KEYS['base']]},
    ('paradox_all_keys', 'text_newline'): {'maybe_tables': [rules.CAS], 'lookups': [KEYS['base']]},
    ('paradox_all_keys', 'blocks'): {'maybe_tables': [rules.CAS], 'lookups': [KEYS['growth'], KEYS['final']]},
    ('paradox_final_key_only', 'blocks'): {'maybe_tables': [rules.CAS], 'lookups': [KEYS['growth']]},
    ('tier_5921001', 'lines'): {'maybe_tables': [rules.CAS], 'lookups': [f'{rules.BASE_PREFIX}{TIERS[0]}']},
    ('tier_5921001', 'blocks'): {'maybe_tables': [rules.CAS], 'lookups': [f'{rules.ENH_PREFIX}{TIERS[0]}']},
    ('official_5020042', 'text_inline'): {'maybe_tables': [rules.CAS],
                                          'lookups': [f'{rules.BASE_PREFIX}{OFFICIAL}']},
    ('table_not_loaded', 'lines'): {'maybe_tables': [rules.CAS], 'lookups': []},
    ('table_not_loaded', 'blocks'): {'maybe_tables': [rules.CAS], 'lookups': []},
}


# ---------------------------------------------------------------------------
# 截断执行：未命中必须到达原生第一条指令（哨兵返回 this）
# ---------------------------------------------------------------------------

def native_entry(abc, label):
    """补丁体里原生第一条指令的位置（=插入段末尾）；未打补丁时为锚点。"""
    ins = decode(abc, label)
    first = ins[rules.ANCHOR]
    patched = first.name == 'pushstring' and abc.strings[first.args[0]].startswith(b'desc_override_')
    entry = rules.ANCHOR + rules.INSERTED_COUNTS[label] if patched else rules.ANCHOR
    name, operand = rules.NATIVE_FIRST[label]
    x = ins[entry]
    if x.name != name or (abc.mn_name(x.args[0]) if name == 'findpropstrict' else x.args[0]) != operand:
        raise AssertionError(f'{label}: native entry #{entry} not found ({x})')
    if any(y.target is not None and y.target > entry for y in ins[rules.ANCHOR:entry]):
        raise AssertionError(f'{label}: inserted block branches past the native entry')
    return ins, entry


def fallthrough_matrix(abc):
    """{(场景, 方法): 'native_entry' | 命中结果摘要}。"""
    out = {}
    epilogue = asm.assemble([('getlocal_0',), ('returnvalue',)])
    for name, (sid, rows, loaded, native, max_level) in SCENARIOS.items():
        for method, label in METHOD_LABELS.items():
            ins, entry = native_entry(abc, label)
            world = World(rows, loaded)
            this = world.enhancement(sid, native, max_level) if method == 'blocks' else world.soul(sid)
            code = slice_method(ins, 0, entry, epilogue)
            try:
                value = DescInterp(abc, world.lex).run(code, [this, *METHOD_ARGS[method]])
            except Exception as exc:  # noqa: BLE001 —— 任何异常都是失败，记录下来
                out[(name, method)] = ('error', type(exc).__name__, str(exc)[:160])
                continue
            out[(name, method)] = 'native_entry' if value is this else summarize(value)
    return out


# ---------------------------------------------------------------------------
# 消费链：真实的转发方法与 viewableFilter
# ---------------------------------------------------------------------------

def _bind(abc, world, this, name, label):
    code = decode(abc, label)
    this[name] = lambda *args: DescInterp(abc, world.lex).run(code, [this, *args])


def _filtered(value):
    out = {}
    for slot, entry in sorted(value['h'].items()):
        learned = entry['learned']
        out[slot] = {'learned': None if learned['index'] == 1 else
                     (learned['params'][0]['level'], list(learned['params'][0]['value'])),
                     'unlearned': {k: list(v) for k, v in sorted(entry['unlearned']['h'].items())}}
    return out


def dialog_chain(abc, rows=ALL_ROWS, sid=PARADOX, levels=(0, 1, 119, 120)):
    """装备详情 / 强化弹窗实际走的路径（全部真实字节码）。"""
    world = World(rows)
    out = {}
    equipment = {'_type': 'EquipmentAbilityLogic', 'abilitySoulAbility': world.soul(sid)}
    soul = equipment['abilitySoulAbility']
    _bind(abc, world, soul, 'getDescriptionsWithoutAdditional', rules.BASE_LINES)
    _bind(abc, world, soul, 'getDescriptionWithoutAdditional', rules.BASE_TEXT)
    for key, label, args in (('weapon_lines', 'EquipmentAbilityLogic/getDescriptionsWithoutAdditional', ()),
                             ('weapon_max_line', 'EquipmentAbilityLogic/getDescriptionWithoutAdditional', (True,))):
        out[key] = execute(abc, world, label, equipment, args)
    for level in levels:
        enh = world.enhancement(sid, 'plain', 120, level)
        for name, label in (('getSlotDescriptionsForDialog', 'EquipmentEnhancementAbilityLogic/getSlotDescriptionsForDialog'),
                            ('viewableFilter', 'EquipmentEnhancementAbilityLogic/viewableFilter'),
                            ('getAllDescriptionsToMapForDialog', rules.ENH_BLOCKS),
                            ('getCurrentLevel', 'EquipmentEnhancementAbilityLogic/getCurrentLevel')):
            _bind(abc, world, enh, name, label)
        holder = {'_type': 'EquipmentAbilityLogic', 'enhancementAbility': some(enh)}
        try:
            value = DescInterp(abc, world.lex).run(
                decode(abc, 'EquipmentAbilityLogic/getEnhancementSlotDescriptionsForDialog'), [holder])
            out[f'enhancement_lv{level}'] = _filtered(value)
        except Exception as exc:  # noqa: BLE001
            out[f'enhancement_lv{level}'] = ('error', type(exc).__name__, str(exc)[:160])
    return out


G, F = ['G1', 'G2'], ['F1', 'F2', 'F3']
EXPECTED_CHAIN = {
    'weapon_lines': ('lines', ['B1', 'B2', 'B3']),
    'weapon_max_line': ('text', 'B1<NL>B2<NL>B3'),
    # Lv0：两块都未习得（块 0 标 强化Lv1，块 1 标 强化Lv120，灰色）
    'enhancement_lv0': {0: {'learned': None, 'unlearned': {1: G}}, 1: {'learned': None, 'unlearned': {120: F}}},
    # Lv1–119：成长块已习得，满级块灰色
    'enhancement_lv1': {0: {'learned': (1, G), 'unlearned': {}}, 1: {'learned': None, 'unlearned': {120: F}}},
    'enhancement_lv119': {0: {'learned': (1, G), 'unlearned': {}}, 1: {'learned': None, 'unlearned': {120: F}}},
    # Lv120：两块都已习得（结果弹窗的已习得块数 1 → 2）
    'enhancement_lv120': {0: {'learned': (1, G), 'unlearned': {}}, 1: {'learned': (120, F), 'unlearned': {}}},
}
NATIVE_CHAIN = {
    'weapon_lines': ('lines', ['N1', 'N2']),
    'weapon_max_line': ('text', 'N1<NL>N2'),
    'enhancement_lv0': {0: {'learned': None, 'unlearned': {1: ['desc:trigA'], 119: ['desc:mvA@119']}},
                        1: {'learned': None, 'unlearned': {120: ['desc:trigB']}}},
    'enhancement_lv1': {0: {'learned': (1, ['desc:trigA']), 'unlearned': {119: ['desc:mvA@119']}},
                        1: {'learned': None, 'unlearned': {120: ['desc:trigB']}}},
    'enhancement_lv119': {0: {'learned': (119, ['desc:mvA@119']), 'unlearned': {}},
                          1: {'learned': None, 'unlearned': {120: ['desc:trigB']}}},
    'enhancement_lv120': {0: {'learned': (119, ['desc:mvA@119']), 'unlearned': {}},
                          1: {'learned': (120, ['desc:trigB']), 'unlearned': {}}},
}


# ---------------------------------------------------------------------------
# 静态证明：插入段只写新局部、只调白名单、出口只有原生入口；原生部分逐字节可还原
# ---------------------------------------------------------------------------

def _depth_zero_at(ins, entry, scope, multinames):
    """到达原生入口的所有路径栈深都为 0：接 returnvoid 可算通，接 pop 必然下溢。"""
    head = ins[:entry]
    asm.simulate(head + [asm.Instruction(0x47)], scope, multinames)
    try:
        asm.simulate(head + [asm.Instruction(0x29), asm.Instruction(0x47)], scope, multinames)
    except asm.AsmError as exc:
        return 'underflow' in str(exc)
    return False


def static_proof(base_abc, out_abc):
    locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
    report, ok = {}, True
    for label in rules.TARGETS:
        before = base_abc.bodies[bodies.resolve(base_abc, label)]
        after = out_abc.bodies[bodies.resolve(out_abc, label)]
        native, patched = asm.decode(before[5]), asm.decode(after[5])
        n = len(patched) - len(native)
        entry = rules.ANCHOR + n
        block = patched[rules.ANCHOR:entry]
        restored = asm.unsplice(after[5], rules.ANCHOR, n)
        first_new = locks[label]['header'][1]
        written, read, calls, names = set(), set(), set(), set()
        for x in block:
            if x.op in (0x63, 0xD4, 0xD5, 0xD6, 0xD7):
                written.add(x.args[0] if x.op == 0x63 else x.op - 0xD4)
            elif x.op in (0x62, 0xD0, 0xD1, 0xD2, 0xD3):
                read.add(x.args[0] if x.op == 0x62 else x.op - 0xD0)
            elif x.op in (0x92, 0x94, 0xC2, 0xC3, 0x08, 0x32):
                written.add(-1)                      # 不允许任何原地改局部的指令
            if x.name in ('callproperty', 'callpropvoid', 'callproplex', 'callsuper', 'callsupervoid',
                          'callmethod', 'callstatic', 'call', 'construct', 'constructsuper'):
                calls.add(out_abc.mn_name(x.args[0]) if x.name.startswith('callprop') else x.name)
            if x.name in ('getproperty', 'setproperty', 'getlex', 'findpropstrict', 'constructprop', 'coerce'):
                names.add(out_abc.mn_name(x.args[0]) if x.args[0] != rules.MULTINAME_L else 'MultinameL')
        params = {0} | ({1} if label == rules.BASE_TEXT else set())
        new_locals = set(rules.LOCALS[label].values())
        inner_targets = [x.target for x in block if x.target is not None]
        entry_state = _depth_zero_at(patched, entry, after[3], out_abc.multinames)
        item = {
            'inserted': n,
            'native_restored_byte_identical': sha(restored) == locks[label]['sha'] == sha(before[5]),
            'header_before': list(before[1:5]), 'header_after': list(after[1:5]),
            'writes_only_new_locals': written == new_locals,
            'reads_only_params_and_new_locals': read <= params | new_locals,
            'new_locals_start_at_old_localcount': min(new_locals) == first_new == before[2],
            'calls': sorted(calls),
            'calls_whitelisted': calls <= ALLOWED_CALLS,
            'never_calls_getMasterTable': rules.GET_MASTER not in calls and rules.GET_MASTER not in names,
            'branches_stay_in_block_or_exit_to_native_entry': all(rules.ANCHOR <= t <= entry for t in inner_targets),
            'no_outside_branch_into_block': not [i for i, x in enumerate(patched)
                                                 if not rules.ANCHOR <= i < entry and x.target is not None
                                                 and rules.ANCHOR <= x.target < entry],
            'no_scope_or_exception_change': not [x for x in block if x.op in (0x1C, 0x1D, 0x30, 0x03)]
            and after[6] == before[6] == [] and after[7] == before[7],
            'returns_in_block': sum(1 for x in block if x.op == 0x48),
            'stack_empty_and_scope_same_at_native_entry': entry_state,
        }
        item['ok'] = (n == rules.INSERTED_COUNTS[label] and item['native_restored_byte_identical']
                      and item['header_after'] == EXPECTED_HEADERS[label] and item['writes_only_new_locals']
                      and item['reads_only_params_and_new_locals'] and item['new_locals_start_at_old_localcount']
                      and item['calls_whitelisted'] and item['never_calls_getMasterTable']
                      and item['branches_stay_in_block_or_exit_to_native_entry']
                      and item['no_outside_branch_into_block'] and item['no_scope_or_exception_change']
                      and item['returns_in_block'] == 1 and entry_state)
        ok = ok and item['ok']
        report[label] = item
    report['ok'] = ok
    return report


# ---------------------------------------------------------------------------
# 结构 / 保持 / 复现
# ---------------------------------------------------------------------------

def _independent():
    return _load('equipment_desc_override_independent_abc', PATCH_ROOT / 'rank-scene-p2/independent/myabc.py')


def preservation(base: SwfAbc, out: SwfAbc):
    m = _independent()
    a, b = m.parse_abc(base.abc.serialize()), m.parse_abc(out.abc.serialize())
    locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
    locked = sorted(v['index'] for v in locks.values())
    changed = [i for i, (x, y) in enumerate(zip(a['bodies'], b['bodies'])) if x != y]
    labels = {}
    br_locks = json.loads((PATCH_ROOT / 'battle-rules/baseline.json').read_text(encoding='utf8'))
    for label in (EQUIPMENT_RULES_BODIES + EQUIPMENT_RULES_ADDED + tuple(br_locks) + BR_ADDED
                  + ('MemberImpl/applyInstantAbility',) + KYUBI_BODIES):
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
        [v for v in pools['strs']['appended']] == list(rules.ADDED_STRINGS) and \
        all(not v['appended'] for k, v in pools.items() if k != 'strs')
    return {'changed_bodies': changed, 'locked_bodies': locked, 'total_bodies': len(b['bodies']),
            'added_bodies': len(b['bodies']) - len(a['bodies']),
            'unchanged_bodies': len(a['bodies']) - len(changed),
            'tables_identical': tables, 'pools': pools, 'non_abc_tags_identical': same_container,
            'stacked_patch_bodies': labels,
            'ok': changed == locked and len(a['bodies']) == len(b['bodies']) and all(tables.values())
            and appended_ok and same_container and set(labels.values()) == {'identical'}}


def reproduce(base_path: Path, out: SwfAbc):
    overlay = _load('equipment_desc_override_overlay', HERE / 'overlay.py')
    rebuilt = SwfAbc(base_path)
    overlay.patch_editor(rebuilt)
    return rebuilt.abc.serialize() == out.abc.serialize()


# ---------------------------------------------------------------------------
# 变异体（负对照）
# ---------------------------------------------------------------------------

def mutant_return_dropped(e, label, code):
    """命中后不返回（returnvalue → pop），落回原生体。"""
    return [('pop',) if item == ('returnvalue',) else item for item in code]


def mutant_wrong_prefix(e, label, code):
    """前缀写成 V2 面板覆盖的 desc_override_（键拼错）。"""
    wrong = e.string('desc_override_')
    good = {e.string(rules.BASE_PREFIX), e.string(rules.ENH_PREFIX)}
    return [wrong if item in good else item for item in code]


MUTANTS = {'return_dropped': mutant_return_dropped, 'wrong_prefix': mutant_wrong_prefix}


def mutant_matrix(base_path: Path):
    """每个变异体：命中项中仍等于期望值的项（必须为空）。"""
    overlay = _load('equipment_desc_override_overlay', HERE / 'overlay.py')
    out = {}
    for name, mutate in MUTANTS.items():
        swf = SwfAbc(base_path)
        overlay.patch_editor(swf, mutate=mutate)
        still_passing = []
        for key in sorted(HITS):
            result, _probe = run_scenario(swf.abc, *key)
            if result == EXPECTED[key]:
                still_passing.append(matrix_key(key))
        out[name] = {'hits_checked': len(HITS), 'hits_still_passing': still_passing}
    return out


def verify(out_path, base_path=None, mutants=True):
    out_path = Path(out_path)
    out = SwfAbc(out_path)
    report = {'output': str(out_path), 'output_sha256': sha(out_path.read_bytes()),
              'output_abc_sha256': sha(out.abc.serialize())}
    results, probes = behaviour_matrix(out.abc)
    report['matrix_size'] = len(results)
    report['hit_count'] = len(HITS)
    report['matrix_mismatches'] = {matrix_key(k): [results[k], v] for k, v in EXPECTED.items() if results[k] != v}
    report['probe_mismatches'] = {matrix_key(k): [probes[k], v] for k, v in EXPECTED_PROBES.items()
                                  if probes[k] != v}
    report['getMasterTable_called'] = sorted(matrix_key(k) for k, v in results.items()
                                             if v[0] == 'error' and 'getMasterTable' in v[-1])
    fall = fallthrough_matrix(out.abc)
    report['fallthrough_mismatches'] = {
        matrix_key(k): [fall[k], 'native_entry' if k not in HITS else EXPECTED[k]]
        for k in EXPECTED if fall[k] != ('native_entry' if k not in HITS else EXPECTED[k])}
    chain = dialog_chain(out.abc)
    report['chain_mismatches'] = {k: [chain[k], v] for k, v in EXPECTED_CHAIN.items() if chain[k] != v}
    ok = not (report['matrix_mismatches'] or report['probe_mismatches'] or report['getMasterTable_called']
              or report['fallthrough_mismatches'] or report['chain_mismatches'])
    if base_path is not None:
        base_path = Path(base_path)
        base = SwfAbc(base_path)
        report['base_sha256'] = sha(base_path.read_bytes())
        report['base_abc_sha256'] = sha(base.abc.serialize())
        report['preservation'] = preservation(base, out)
        report['static_proof'] = static_proof(base.abc, out.abc)
        report['reproducible_from_base'] = reproduce(base_path, out)
        native, native_probes = behaviour_matrix(base.abc)
        native_fall = fallthrough_matrix(base.abc)
        native_chain = dialog_chain(base.abc)
        report['negative_control'] = {
            'hits_passing_on_base': sorted(matrix_key(k) for k in HITS if native[k] == EXPECTED[k]),
            'base_not_native': {matrix_key(k): [native[k], native_expected(k)] for k in EXPECTED
                                if native[k] != native_expected(k)},
            'controls_differing_on_base': {matrix_key(k): [native[k], EXPECTED[k]] for k in EXPECTED
                                           if k not in HITS and native[k] != EXPECTED[k]},
            'base_touches_custom_ability_string': sorted(matrix_key(k) for k, v in native_probes.items()
                                                         if v['maybe_tables'] or v['lookups']),
            'base_fallthrough_not_native_entry': sorted(matrix_key(k) for k, v in native_fall.items()
                                                        if v != 'native_entry'),
            'base_chain': native_chain,
            'base_chain_matches_native': native_chain == NATIVE_CHAIN,
        }
        neg = report['negative_control']
        ok = ok and report['base_abc_sha256'] == BASE_ABC_SHA and report['preservation']['ok'] \
            and report['static_proof']['ok'] and report['reproducible_from_base'] \
            and not neg['hits_passing_on_base'] and not neg['controls_differing_on_base'] \
            and not neg['base_not_native'] \
            and not neg['base_touches_custom_ability_string'] and not neg['base_fallthrough_not_native_entry'] \
            and neg['base_chain_matches_native']
        if mutants:
            report['mutants'] = mutant_matrix(base_path)
            ok = ok and all(not m['hits_still_passing'] for m in report['mutants'].values())
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
