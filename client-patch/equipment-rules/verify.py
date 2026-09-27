"""独立核验 equipment-rules 输出 SWF：结构、字节级保持、可复现、行为矩阵与负对照。

    python -X utf8 client-patch/equipment-rules/verify.py <out.swf> --base <1047 base.swf>

行为矩阵直接执行 SWF 里的真实字节码（avm_interp）：
* getAvailableAbilities 从「questKind 判定之后」到原生 if(_loc14_) 的切片（含深渊 v4-rs 门控与本补丁插入段）；
* 新增的 6 个方法（由切片内的调用触发）；
* EquipmentEnhancementAbilityValues / AbilitySoulValues 的持续内容解析器整方法；
* battle-rules 的 MemberAbilityTotalizerImpl/wfBlocksGauge（R3 掩码语义）。
同一矩阵在未打补丁的基线上必须**不满足**规则（负对照），否则说明测试不敏感。
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
for path in (str(HERE), str(PATCH_ROOT / 'battle-rules'), str(PATCH_ROOT / 'abcasm')):
    if path not in sys.path:
        sys.path.insert(0, path)

import asm  # noqa: E402
import bodies  # noqa: E402
from swfabc import SwfAbc  # noqa: E402
import rules  # noqa: E402
from avm_interp import AvmThrow, Cls, Interp, slice_method  # noqa: E402

NONE_OPTION = {'index': 1, 'params': [], '_type': 'Option'}
PARADOX = 5920001
BR_ADDED = ('MemberAbilityTotalizerImpl/wfBlocksGauge', 'MemberImpl/wfAllowsGauge',
            'MemberAbilityTotalizerImpl/wfResolveDamageType', 'MemberImpl$/wfConvertNormalAttack',
            'MemberImpl$/wfGaugeFromAddress', 'MemberImpl$/wfGaugeFromAction')


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def some(value):
    return {'index': 0, 'params': [value], '_type': 'Option'}


# ---------------------------------------------------------------------------
# 模拟对象（字段名与反编译源码一致）
# ---------------------------------------------------------------------------

class World:
    """一局装配所需的类、主表与工厂。soul_keys / enh_keys = AbilitySoulTable / EquipmentEnhancementAbilityTable 的键。"""

    def __init__(self, soul_keys=(), enh_keys=()):
        self.keys = {rules.SOUL_TABLE: set(soul_keys), rules.ENH_TABLE: set(enh_keys)}
        self.constructed = []

        def table(cls):
            keys = self.keys[cls.name]
            return {'get_data': lambda: {rules.EXISTS: lambda key: key in keys}}

        self.assets = {rules.GET_MASTER: table, '_type': 'ILogicAssetContainer'}
        self.lex = {
            rules.SOUL: Cls(rules.SOUL, ctor=self.new_soul),
            rules.EQUIP: Cls(rules.EQUIP, ctor=self.new_equipment_ability),
            rules.ENH: Cls(rules.ENH, createForEquipment=self.new_enhancement),
            rules.OPTION: Cls(rules.OPTION, **{'Some': some, 'None': NONE_OPTION}),
            rules.SOUL_TABLE: Cls(rules.SOUL_TABLE),
            rules.ENH_TABLE: Cls(rules.ENH_TABLE),
        }

    # 原生构造语义 ------------------------------------------------------------
    def new_soul(self, number, sid, calc, is_equipment, assets):
        soul = {'_type': 'AbilitySoulAbilityLogic', 'number': number, 'id': sid,
                'power': {'calculateMethod': calc}, 'isEquipment': is_equipment, 'logicAssets': assets,
                'ownerElement': 6, 'questKind': NONE_OPTION}
        self.constructed.append(('soul', sid))
        return soul

    def new_enhancement(self, eid, current, maximum, assets):
        if eid not in self.keys[rules.ENH_TABLE]:
            raise AvmThrow({'code': 8601, 'key': eid})             # MasterMap.get 缺键
        enh = {'_type': 'EquipmentEnhancementAbilityLogic', 'id': eid, 'currentLevel': current,
               'maxLevel': maximum, 'logicAssets': assets, 'number': 41, 'ownerElement': 6,
               'questKind': NONE_OPTION}
        self.constructed.append(('enh', eid))
        return enh

    def new_equipment_ability(self, soul, enhancement, assets):
        if enhancement['index'] == 0:
            enh = enhancement['params'][0]
            for field in ('number', 'ownerElement'):
                if soul[field] != enh[field]:
                    raise AvmThrow({'code': 2301, 'field': field})
            if soul['questKind'] is not enh['questKind']:
                raise AvmThrow({'code': 2301, 'field': 'questKind'})
        return {'_type': 'EquipmentAbilityLogic', 'abilitySoulAbility': soul, 'enhancementAbility': enhancement,
                'logicAssets': assets, 'number': soul['number'], 'ownerElement': soul['ownerElement'],
                'questKind': soul['questKind']}

    # 装备 / 队伍 ---------------------------------------------------------------
    def equipment_soul(self, sid, level=5, max_level=5):
        return {'_type': 'AbilitySoulAbilityLogic', 'number': 41, 'id': sid,
                'power': {'calculateMethod': ('LevelScale', level, max_level)}, 'isEquipment': True,
                'logicAssets': self.assets, 'ownerElement': 6, 'questKind': NONE_OPTION}

    def orb_soul(self, sid):
        return {'_type': 'AbilitySoulAbilityLogic', 'number': 31, 'id': sid,
                'power': {'calculateMethod': ('MinimumLevel',)}, 'isEquipment': False,
                'logicAssets': self.assets, 'ownerElement': 6, 'questKind': NONE_OPTION}

    def weapon(self, sid, enhancement_level=None, max_enhancement=120):
        soul = self.equipment_soul(sid)
        option = NONE_OPTION
        if enhancement_level is not None:
            option = some({'_type': 'EquipmentEnhancementAbilityLogic', 'id': sid,
                           'currentLevel': enhancement_level, 'maxLevel': max_enhancement,
                           'logicAssets': self.assets, 'number': 41, 'ownerElement': 6,
                           'questKind': NONE_OPTION})
        return self.new_equipment_ability(soul, option, self.assets)

    @staticmethod
    def party(weapons=(None, None, None), orbs=(None, None, None)):
        def slot(ids, index):
            sid = ids[index]
            return some({'get_abilitySoulId': lambda: sid}) if sid else NONE_OPTION
        return {'getBattleEquipment': lambda i: slot(weapons, i), 'getAbilitySoul': lambda i: slot(orbs, i)}


# ---------------------------------------------------------------------------
# 执行 SWF 字节码
# ---------------------------------------------------------------------------

def added_method_bodies(abc):
    """BattleCharacterLogic 上 wf* 实例方法 → 指令表。"""
    out = {}
    for position, instance in enumerate(abc.instances):
        if abc.mn_name(instance[0]) != rules.CHAR:
            continue
        body_of = {body[0]: index for index, body in enumerate(abc.bodies)}
        for trait in instance[6]:
            name = abc.mn_name(trait.name).split('::')[-1]
            if trait.data[0] == 'method' and name.startswith('wf'):
                out[name] = asm.decode(abc.bodies[body_of[trait.data[2]]][5])
    return out


def character(abc, world, interp, **fields):
    this = dict(fields)
    this['_type'] = 'BattleCharacterLogic'
    for name, code in added_method_bodies(abc).items():
        this[name] = (lambda code: lambda *args: interp.run(code, [this, *args]))(code)
    return this


def gate_slice(abc):
    ins = asm.decode(abc.bodies[bodies.resolve(abc, rules.GAA)][5])
    starts = [i + 7 for i in range(len(ins) - 6)
              if ins[i].name == 'getlocal' and ins[i].args == [5] and ins[i + 1].name == 'getglobalscope'
              and ins[i + 2].name == 'getlocal' and ins[i + 2].args == [13]
              and ins[i + 3].name == 'getproperty' and abc.mn_name(ins[i + 3].args[0]) == 'questKind'
              and ins[i + 4].name == 'call' and ins[i + 5].name == 'convert_b'
              and ins[i + 6].name == 'setlocal' and ins[i + 6].args == [14]]
    ends = [i for i in range(len(ins) - 3)
            if ins[i].name == 'getlocal' and ins[i].args == [14] and ins[i + 1].name == 'iffalse'
            and ins[i + 2].name == 'getlocal' and ins[i + 2].args == [13]
            and ins[i + 3].name == 'callproperty' and abc.mn_name(ins[i + 3].args[0]) == 'getTriggers']
    if len(starts) != 1 or len(ends) != 1:
        raise AssertionError(f'gate slice anchors not unique: {starts} {ends}')
    epilogue = asm.assemble([('getlocal', 14), ('getlocal', 13), ('newarray', 2), ('returnvalue',)])
    return slice_method(ins, starts[0], ends[0], epilogue)


QUEST_PRACTICE = {'index': 0, 'params': [{'index': 10, 'params': [5]}]}     # 练习 quest 5
QUEST_STORY = {'index': 0, 'params': [{'index': 0, 'params': [1001]}]}      # 深渊白名单外


def run_gate(abc, world, peek, party, quest=QUEST_PRACTICE):
    interp = Interp(abc, world.lex)
    this = character(abc, world, interp)
    soul_unused = None
    regs = [this, party, 0, quest, [], None, None, None, None, None, None, None, soul_unused, peek, True]
    regs += [None] * 7
    active, result = interp.run(gate_slice(abc), regs)
    return active, result


def summarize(peek, active, result):
    if not active:
        return ('off',)
    if result is None:
        return ('active_with_null_ability',)       # 真机上随后 null.getTriggers() 即崩
    if result is peek:
        return ('keep',)
    if result.get('_type') == 'EquipmentAbilityLogic':
        soul, option = result['abilitySoulAbility'], result['enhancementAbility']
        enh = option['params'][0] if option['index'] == 0 else None
        return ('tier', soul['id'], soul['number'], soul['power']['calculateMethod'],
                enh and enh['id'], enh and enh['currentLevel'], enh and enh['maxLevel'])
    return ('tier_soul', result['id'], result['number'], result['isEquipment'], result['power']['calculateMethod'])


TIER_KEYS = {PARADOX + 1000 * n for n in (1, 2, 3)}
OTHER_A, OTHER_B, OTHER_C = 5020042, 5020043, 5020044
ORB_A, ORB_B, ORB_C = 1000001, 1000002, 1000003


def _gate_case(abc, *, peek_kind, sid, weapons, orbs=(None, None, None), enhancement_level=120,
               soul_keys=TIER_KEYS, enh_keys=TIER_KEYS, quest=QUEST_PRACTICE):
    world = World(soul_keys=soul_keys | {PARADOX}, enh_keys=enh_keys | {PARADOX})
    if peek_kind == 'weapon':
        peek = world.weapon(sid, enhancement_level)
    elif peek_kind == 'orb':
        peek = world.orb_soul(sid)
    else:
        peek = {'_type': 'AbilityLogic', 'number': 1, 'id': sid, 'questKind': NONE_OPTION}
    active, result = run_gate(abc, world, peek, World.party(weapons, orbs), quest)
    return summarize(peek, active, result)


LV = ('LevelScale', 5, 5)
MIN = ('MinimumLevel',)


def gate_matrix(abc):
    """场景 → 结果摘要。"""
    c = _gate_case
    x1, x2, x3 = 5910101, 5910124, 5910150
    return {
        'r2_single_cursed': c(abc, peek_kind='weapon', sid=x1, weapons=(x1, OTHER_A, None), orbs=(ORB_A, None, None)),
        'r2_two_cursed_first': c(abc, peek_kind='weapon', sid=x1, weapons=(x1, x2, None)),
        'r2_two_cursed_second': c(abc, peek_kind='weapon', sid=x2, weapons=(x1, x2, None)),
        'r2_reserved_range_counts': c(abc, peek_kind='weapon', sid=x3, weapons=(x3, x1, None)),
        'r2_cursed_orb_counts': c(abc, peek_kind='weapon', sid=x1, weapons=(x1, None, None), orbs=(None, x2, None)),
        'r2_three_cursed': c(abc, peek_kind='weapon', sid=x2, weapons=(x1, x2, x3)),
        'r2_normal_weapon_untouched': c(abc, peek_kind='weapon', sid=OTHER_A, weapons=(x1, x2, OTHER_A)),
        'r2_paradox_is_not_cursed': c(abc, peek_kind='weapon', sid=x1, weapons=(x1, PARADOX, None)),
        'r1_n0': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, None, None)),
        'r1_n1': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, OTHER_A, None)),
        'r1_n2': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, OTHER_A, None), orbs=(ORB_A, None, None)),
        'r1_n3': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, OTHER_A, OTHER_B), orbs=(ORB_A, None, None)),
        'r1_n4': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, OTHER_A, OTHER_B), orbs=(ORB_A, ORB_B, None)),
        'r1_n5': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, OTHER_A, OTHER_B), orbs=(ORB_A, ORB_B, ORB_C)),
        'r1_enhancement_level_37': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, OTHER_A, None),
                                     enhancement_level=37),
        'r1_without_enhancement_part': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, OTHER_A, None),
                                         enhancement_level=None),
        'r1_orb_slot': c(abc, peek_kind='orb', sid=PARADOX, weapons=(OTHER_A, None, None), orbs=(PARADOX, ORB_A, None)),
        'r1_two_paradox': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, PARADOX, None)),
        'r1_cursed_counts_as_other': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, x1, None)),
        'r1_missing_soul_tier_fails_open': c(abc, peek_kind='weapon', sid=PARADOX, weapons=(PARADOX, OTHER_A, None),
                                             soul_keys=set()),
        'r1_missing_enhancement_tier_fails_open': c(abc, peek_kind='weapon', sid=PARADOX,
                                                    weapons=(PARADOX, OTHER_A, None), enh_keys=set()),
        'character_ability_untouched': c(abc, peek_kind='character', sid=1, weapons=(x1, x2, None)),
        'abyss_practice_native': c(abc, peek_kind='weapon', sid=8000101, weapons=(8000101, None, None),
                                   enhancement_level=None),
        'abyss_story_native_off': c(abc, peek_kind='weapon', sid=8000101, weapons=(8000101, None, None),
                                    enhancement_level=None, quest=QUEST_STORY),
    }


EXPECTED_GATE = {
    'r2_single_cursed': ('keep',),
    'r2_two_cursed_first': ('off',),
    'r2_two_cursed_second': ('off',),
    'r2_reserved_range_counts': ('off',),
    'r2_cursed_orb_counts': ('off',),
    'r2_three_cursed': ('off',),
    'r2_normal_weapon_untouched': ('keep',),
    'r2_paradox_is_not_cursed': ('keep',),
    'r1_n0': ('keep',),
    'r1_n1': ('tier', 5921001, 41, LV, 5921001, 120, 120),
    'r1_n2': ('tier', 5922001, 41, LV, 5922001, 120, 120),
    'r1_n3': ('tier', 5923001, 41, LV, 5923001, 120, 120),
    'r1_n4': ('off',),
    'r1_n5': ('off',),
    'r1_enhancement_level_37': ('tier', 5921001, 41, LV, 5921001, 37, 120),
    'r1_without_enhancement_part': ('tier', 5921001, 41, LV, None, None, None),
    'r1_orb_slot': ('tier_soul', 5922001, 31, False, MIN),
    'r1_two_paradox': ('tier', 5921001, 41, LV, 5921001, 120, 120),
    'r1_cursed_counts_as_other': ('tier', 5921001, 41, LV, 5921001, 120, 120),
    'r1_missing_soul_tier_fails_open': ('keep',),
    'r1_missing_enhancement_tier_fails_open': ('keep',),
    'character_ability_untouched': ('keep',),
    'abyss_practice_native': ('keep',),
    'abyss_story_native_off': ('off',),
}
#: 未打补丁时这些场景必须与 EXPECTED_GATE 不同（负对照）；其余场景两边必须相同（控制组）。
RULE_SCENARIOS = frozenset({
    'r2_two_cursed_first', 'r2_two_cursed_second', 'r2_reserved_range_counts', 'r2_cursed_orb_counts',
    'r2_three_cursed', 'r1_n1', 'r1_n2', 'r1_n3', 'r1_n4', 'r1_n5', 'r1_enhancement_level_37',
    'r1_without_enhancement_part', 'r1_orb_slot', 'r1_two_paradox', 'r1_cursed_counts_as_other',
})


# ---------------------------------------------------------------------------
# R3：两张装备表的持续内容解析器
# ---------------------------------------------------------------------------

def _parser_world(values_class, target_at, uid_at, strength_at):
    built = {}

    def master(tag, index, params):
        return {'_type': 'CommonAbilityContentMasterValue', 'tag': tag, 'index': index, 'params': params}

    master_cls = Cls(rules.MASTER, ctor=master,
                     AttackPoint=lambda obj: master('AttackPoint', 0, [obj]))
    parsers = {f'parseAt{target_at}': lambda row: ('target', row[target_at], row[target_at + 1]),
               f'parseAt{uid_at}': lambda row: int(row[uid_at]),
               f'parseAt{strength_at}': lambda row: ('strength', row[strength_at], row[strength_at + 1])}
    lex = {rules.MASTER: master_cls, values_class: Cls(values_class, **parsers),
           'flash::Boot': built, 'Error': Cls('Error', ctor=lambda: {'error': True}),
           'pinball.error::ClientError': Cls('ClientError', ctor=lambda code, message: {'code': code, 'message': message})}
    return lex


PARSE_TABLES = {
    'ability': ('AbilityValues$/parseAt109', 'pinball.master.generated::AbilityValues', 109, 110, 118, 113, 126),
    'equipment_enhancement_ability': (rules.EA_PARSE, 'pinball.master.generated::EquipmentEnhancementAbilityValues',
                                      109, 110, 118, 113, 126),
    'ability_soul': (rules.SOUL_PARSE, 'pinball.master.generated::AbilitySoulValues', 106, 107, 115, 110, 123),
}


def run_parser(abc, table, kind, *, target='1', code='8'):
    label, values_class, content_at, target_at, uid_at, strength_at, width = PARSE_TABLES[table]
    row = [''] * width
    row[content_at], row[target_at], row[target_at + 1], row[uid_at] = kind, target, '(None)', code
    row[strength_at], row[strength_at + 1] = '1000', '1000'
    interp = Interp(abc, _parser_world(values_class, target_at, uid_at, strength_at), max_steps=400000)
    ins = asm.decode(abc.bodies[bodies.resolve(abc, label)][5])
    try:
        value = interp.run(ins, [None, row])
    except AvmThrow as thrown:
        return ('throw', thrown.value.get('code'))
    params = value['params'][0]
    return ('master', value['tag'], value['index'], params.get('target'), params.get('unique_condition_id'),
            params.get('strength'))


def parse_matrix(abc):
    return {
        'ea_423': run_parser(abc, 'equipment_enhancement_ability', '423'),
        'soul_423': run_parser(abc, 'ability_soul', '423'),
        'ea_attack_point_native': run_parser(abc, 'equipment_enhancement_ability', '0'),
        'soul_attack_point_native': run_parser(abc, 'ability_soul', '0'),
        'ability_423_battle_rules': run_parser(abc, 'ability', '423'),
    }


GAUGE_MASTER = ('master', rules.GAUGE_TAG, rules.GAUGE_KIND, ('target', '1', '(None)'), 8, None)
EXPECTED_PARSE = {
    'ea_423': GAUGE_MASTER,
    'soul_423': GAUGE_MASTER,
    'ea_attack_point_native': ('master', 'AttackPoint', 0, ('target', '1', '(None)'), None, ('strength', '1000', '1000')),
    'soul_attack_point_native': ('master', 'AttackPoint', 0, ('target', '1', '(None)'), None, ('strength', '1000', '1000')),
    'ability_423_battle_rules': GAUGE_MASTER,
}
UNPATCHED_PARSE = dict(EXPECTED_PARSE, ea_423=('throw', 7050), soul_423=('throw', 7050))


# ---------------------------------------------------------------------------
# R3 掩码语义：执行 1047 里 battle-rules 的 wfBlocksGauge（来源位先筛，再求活动条件）
# ---------------------------------------------------------------------------

GAIN = {'opening': 1, 'movement': 2, 'skill': 4, 'ability': 8, 'combo_ability': 24,
        'skill_triggered_ability': 40, 'other_action': 64}
ORIGIN = {'character': 256, 'leader': 512, 'weapon': 1024, 'soul': 2048, 'ex': 4096}
GAUGE_EVENTS = {
    'opening': GAIN['opening'],
    'movement': GAIN['movement'],
    'skill_direct': GAIN['skill'] | ORIGIN['character'],
    'character_ability': GAIN['ability'] | ORIGIN['character'],
    'leader_ability': GAIN['ability'] | ORIGIN['leader'],
    'weapon_ability': GAIN['ability'] | ORIGIN['weapon'],
    'weapon_enhancement_combo': GAIN['combo_ability'] | ORIGIN['weapon'],
    'soul_skill_triggered': GAIN['skill_triggered_ability'] | ORIGIN['soul'],
    'ex_ability': GAIN['ability'] | ORIGIN['ex'],
    'invoke_skill_629_snapshot_weapon': GAIN['ability'] | ORIGIN['weapon'] | 32768 | 131072,
    'invoke_skill_629_no_snapshot': GAIN['ability'] | ORIGIN['character'],
    'initial_629_timer_dsl': GAIN['opening'] | ORIGIN['weapon'],
    'other_action_pf_or_item': GAIN['other_action'] | ORIGIN['character'],
    'ability_without_origin': GAIN['ability'],
}


def gauge_matrix(abc, mask):
    ins = asm.decode(abc.bodies[bodies.resolve(abc, 'MemberAbilityTotalizerImpl/wfBlocksGauge')][5])
    checker = {'value': float(mask), 'getActiveCount': lambda _arg: 1}
    totalizer = {'wfGaugeRules': [checker]}
    return {name: bool(Interp(abc).run(ins, [totalizer, event])) for name, event in GAUGE_EVENTS.items()}


# ---------------------------------------------------------------------------
# 结构 / 保持 / 复现
# ---------------------------------------------------------------------------

def _independent():
    path = PATCH_ROOT / 'rank-scene-p2/independent/myabc.py'
    spec = importlib.util.spec_from_file_location('equipment_rules_independent_abc', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def preservation(base: SwfAbc, out: SwfAbc):
    m = _independent()
    a, b = m.parse_abc(base.abc.serialize()), m.parse_abc(out.abc.serialize())
    locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
    locked = sorted(v['index'] for v in locks.values())
    changed = [i for i, (x, y) in enumerate(zip(a['bodies'], b['bodies'])) if x != y]
    added = len(b['bodies']) - len(a['bodies'])
    labels = {}
    br_locks = json.loads((PATCH_ROOT / 'battle-rules/baseline.json').read_text(encoding='utf8'))
    for label in list(br_locks) + list(BR_ADDED) + ['MemberImpl/applyInstantAbility']:
        try:
            index = bodies.resolve(base.abc, label)
        except asm.AsmError:
            labels[label] = 'absent'
            continue
        labels[label] = 'identical' if a['bodies'][index] == b['bodies'][index] else 'CHANGED'
    same_container = (base.body[:base._offset] == out.body[:out._offset]
                      and base.body[base._offset + base._length:] == out.body[out._offset + out._length:])
    return {'changed_bodies': changed, 'locked_bodies': locked, 'added_bodies': added,
            'unchanged_bodies': len(a['bodies']) - len(changed),
            'non_abc_tags_identical': same_container, 'battle_rules_and_gauge_perf_bodies': labels,
            'ok': changed == locked and added == len(rules.METHODS) and same_container
            and all(v in ('identical', 'absent') for v in labels.values())}


def reproduce(base_path: Path, out: SwfAbc, config=rules.DEFAULT):
    import overlay
    rebuilt = SwfAbc(base_path)
    overlay.patch_editor(rebuilt, config)
    return rebuilt.abc.serialize() == out.abc.serialize()


def verify(out_path, base_path=None, config=rules.DEFAULT):
    out_path = Path(out_path)
    out = SwfAbc(out_path)
    report = {'output': str(out_path), 'output_sha256': sha(out_path.read_bytes()),
              'output_abc_sha256': sha(out.abc.serialize())}
    gate = gate_matrix(out.abc)
    parse = parse_matrix(out.abc)
    report['gate_mismatches'] = {k: [gate[k], v] for k, v in EXPECTED_GATE.items() if gate[k] != v}
    report['parse_mismatches'] = {k: [parse[k], v] for k, v in EXPECTED_PARSE.items() if parse[k] != v}
    report['gauge_mask_8'] = gauge_matrix(out.abc, 8)
    ok = not report['gate_mismatches'] and not report['parse_mismatches']
    if base_path is not None:
        base_path = Path(base_path)
        base = SwfAbc(base_path)
        report['base_sha256'] = sha(base_path.read_bytes())
        report['preservation'] = preservation(base, out)
        report['reproducible_from_base'] = reproduce(base_path, out, config)
        native_gate, native_parse = gate_matrix(base.abc), parse_matrix(base.abc)
        report['negative_control'] = {
            'rule_scenarios_failing_on_base': sorted(k for k in RULE_SCENARIOS if native_gate[k] != EXPECTED_GATE[k]),
            'rule_scenarios_passing_on_base': sorted(k for k in RULE_SCENARIOS if native_gate[k] == EXPECTED_GATE[k]),
            'control_scenarios_differing': sorted(k for k in EXPECTED_GATE if k not in RULE_SCENARIOS
                                                  and native_gate[k] != EXPECTED_GATE[k]),
            'parse_on_base': native_parse,
        }
        neg = report['negative_control']
        ok = ok and report['preservation']['ok'] and report['reproducible_from_base'] \
            and not neg['rule_scenarios_passing_on_base'] and not neg['control_scenarios_differing'] \
            and native_parse == UNPATCHED_PARSE
    report['ok'] = ok
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('output', type=Path)
    p.add_argument('--base', type=Path)
    a = p.parse_args()
    report = verify(a.output, a.base)
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main()
