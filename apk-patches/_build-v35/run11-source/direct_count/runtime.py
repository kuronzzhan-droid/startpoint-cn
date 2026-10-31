"""真实次数选优/状态查询/调度字节码；仅外围对象与调度出口为夹具。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.append(str(ROOT / 'run4'))
from direct_unique.runtime import World as UniqueWorld


class World(UniqueWorld):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.lex['AdditionalDirectAttackContent'] = {
            'getBetter': lambda a, b: self.run('AdditionalDirectAttackContent$/getBetter',
                                            self.lex['AdditionalDirectAttackContent'], a, b)}

    def additional(self, times, damage):
        value = {'directAttackTimes': times, 'directAttackDamage': damage}
        self.bind(value, 'AdditionalDirectAttackContent', ['isBetterThan'])
        return value

    def slot(self, *args, **kwargs):
        slot = super().slot(*args, **kwargs)
        self.bind(slot, 'ConditionSlot', ['getAdditionalDirectAttack'])
        return slot

    def member(self, *args, native=(1, 50000), extra=(), field=None, **kwargs):
        """native=能力来源；extra=ACAdditionalDirectAttack状态；field=场地来源。"""
        member, unit, shots, counts, combos = super().member(*args, **kwargs)
        self.bind(member, 'MemberImpl', ['wfxDirectTargetCount', 'getAdditionalDirectAttack'])
        ability = None if native is None else self.additional(*native)
        member['abilityTotalizer']['getAdditionalDirectAttack'] = lambda: ability
        member['zoneManager']['getCurrentZone'] = lambda: {
            'modifierFieldManager': {'getAdditionalDirectAttack': lambda: None if field is None else self.additional(*field)}}
        member['stats'].update(maxAdditionalDirectAttackTimes=0, maxAdditionalDirectAttackDamage=0)
        slot = member['conditionSlot']
        for at, item in enumerate(extra):
            key = 'native_' + str(at)
            slot['conditions']['_keys'].append(key)
            slot['conditions']['map']['h'][key] = {
                'content': {'index': 25, 'params': [self.additional(*item)]}}
        return member, unit, shots, counts, combos


def prepare(world, rows):
    world.table = {900000 + i: f'wfx:{code}:{arg}:{value}:{flags}:hidden_fixture_{i}'
                   for i, (code, arg, value, flags, _) in enumerate(rows)}
    return [world.condition(900000 + i, row[4]) for i, row in enumerate(rows)]


def snapshot(world, result):
    member, unit, shots, counts, combos = result
    world.run('MemberImpl/scheduleDirectAttack', member, 10, unit, 0.5)
    attacks = [shot[3]['content'] for shot in shots]
    keys = ('multiplierOfAttackPoint', 'statModifierAdditionalDirectAttackTimes',
            'statModifierAdditionalDirectAttackDamage', 'basicDetoughness', 'basicFeverPoint',
            'incrementCombo', 'incrementComboEvenIfTargetIsDead', 'createdByDirectAttack',
            'originMemberIndex', 'executionCount', 'createdByPrimarySquad', 'element')
    return {'attacks': [{key: a[key] for key in keys} for a in attacks],
            'hit_effects': [shot[3]['hitEffect'] for shot in shots],
            'scheduled_at': [shot[0] for shot in shots],
            'counts': counts, 'combo': combos[0],
            'direct_count': member['stats']['directAttackCount'],
            'fever_count': member['stats']['directAttackCountInFever'],
            'maximum_times': member['stats']['maxAdditionalDirectAttackTimes'],
            'maximum_damage': member['stats']['maxAdditionalDirectAttackDamage'],
            'execution': member['directAttackExecutionCount']}


def schedule(world, rows=(), **kwargs):
    held = prepare(world, rows)
    return snapshot(world, world.member(conditions=held, **kwargs))
