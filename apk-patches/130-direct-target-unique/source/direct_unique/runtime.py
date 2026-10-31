"""真实直击与原生 Unique 计数链；仅对象、枚举构造和调度边界使用夹具。"""
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2] / 'run1'))
from core_combat.runtime import Harness


def unique_uid(kind):
    return kind['params'][0] if isinstance(kind, dict) else kind


class World(Harness):
    def __init__(self, abc, table=None, loaded=True, overrides=None):
        super().__init__(abc, table, loaded, overrides)
        self.calls['target_unique'] = 0
        self.unique_requests = []
        self.executed = set()
        self.lex['ConditionTargetKind']['Unique'] = lambda uid: {'index': 23, 'params': [uid]}
        for cls in ('ConditionTools', 'ConditionChangeContentTools'):
            self.lex.setdefault(cls, {})['matchTarget'] = lambda *a, c=cls: self.run(
                c + '$/matchTarget', self.lex[c], *a)

    def run(self, label, this, *args):
        self.executed.add(label)
        return super().run(label, this, *args)

    def slot(self, *args, **kwargs):
        result = super().slot(*args, **kwargs)
        self.bind(result, 'ConditionSlot', ['getConditionAccumulationCount', '_getConditionAccumulationCount'])
        return result

    def member(self, *args, targets=None, target_conditions=None, **kwargs):
        result = super().member(*args, **kwargs)
        member, unit, *_ = result
        legacy = kwargs.get('legacy') or {}
        member['getConditionAccumulationCount'] = lambda kind: legacy.get(unique_uid(kind), 0)
        self.bind(member, 'MemberImpl', ['wfxDirectTargetUnique'])
        enemy = unit['parent']
        conditions = [self.condition(uid, layers) for uid, layers in (targets or {}).items()]
        for condition in conditions:
            if condition['content']['params'][0] == 129997:
                condition['maxAccumulation'] = 20  # TASK4 的原状态c4=20。
        if target_conditions is not None:
            conditions.extend(target_conditions)
        previous = enemy['conditionSlot']['conditions']
        conditions.extend(previous['map']['h'].values())
        enemy['conditionSlot'] = self.slot(conditions)

        def count(kind):
            self.calls['target_unique'] += 1
            self.unique_requests.append(unique_uid(kind))
            return self.run('EnemyImpl/getConditionAccumulationCount', enemy, kind)

        enemy['getConditionAccumulationCount'] = count
        return result


def schedule(world, **kwargs):
    """完整 scheduleDirectAttack，保留调度、次数、连击和伤害相关全部可观察值。"""
    member, unit, shots, counts, combos = world.member(**kwargs)
    world.run('MemberImpl/scheduleDirectAttack', member, 10, unit, 0.5)
    attacks = [shot[3]['content'] for shot in shots]
    return {
        'multipliers': [a['multiplierOfAttackPoint'] for a in attacks],
        'segments': [a['statModifierAdditionalDirectAttackTimes'] for a in attacks],
        'tough': [a['basicDetoughness'] for a in attacks],
        'fever': [a['basicFeverPoint'] for a in attacks],
        'scheduled_at': [s[0] for s in shots], 'counts': counts,
        'combo': combos[0], 'count': member['stats']['directAttackCount'],
        'fever_count': member['stats']['directAttackCountInFever'],
        'execution': member['directAttackExecutionCount'],
    }


def prepare(world, rows):
    """rows = [(code, U或arg, value, flags, 持有层数), ...]。"""
    world.table = {900000 + i: f'wfx:{code}:{arg}:{value}:{flags}:fixture_{i}'
                   for i, (code, arg, value, flags, _) in enumerate(rows)}
    return [world.condition(900000 + i, row[4]) for i, row in enumerate(rows)]
