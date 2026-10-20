"""本轮公式和原生结算等价检查，不用Python替代补丁或原生业务代码。"""
import itertools
import math
from .runtime import World, prepare, schedule, snapshot


def same(a, b):
    if isinstance(a, (int, float)) and not isinstance(a, bool):
        return isinstance(b, (int, float)) and math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-8)
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, (tuple, list)) and isinstance(b, (tuple, list)):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


class Checks(list):
    def eq(self, name, actual, expected):
        assert same(actual, expected), (name, actual, expected)
        self.append({'name': name, 'actual': actual, 'expected': expected})


def contribution(rows, k):
    if k < 1:
        return 0
    return max(0, sum(base * held + per * held * (min(k-1, cap) if cap > 0 else k-1)
                      for code, base, per, cap, held in rows if code == 33))


def behavior(abc, overrides=None):
    checks = Checks()

    def helper(name, rows, k, expected=None, **kw):
        world = World(abc, overrides=overrides)
        held = prepare(world, rows)
        member, unit, *_ = world.member(conditions=held, debuffs=k, **kw)
        got = world.run('MemberImpl/wfxDirectTargetCount', member, unit)
        checks.eq(name, got, contribution(rows, k) if expected is None else expected)
        return world, member, unit

    bel = [(33, 10, 1, 5, 1)]
    for k, expected in ((0, 0), (1, 10), (2, 11), (6, 15), (10, 15)):
        helper(f'bel.k{k}', bel, k, expected)
    for cap, k in itertools.product((-2147483648, -3, -1, 0, 1, 2, 5, 2147483647), (0, 1, 2, 6, 10)):
        helper(f'cap{cap}.k{k}', [(33, 3, 2, cap, 2)], k)
    for base, per, held, k in itertools.product((-9, 0, 10), (-3, 0, 2), (1, 3), (0, 1, 2, 6)):
        helper(f'signed.base{base}.per{per}.held{held}.k{k}', [(33, base, per, 2, held)], k)
    mixed = [(33, 10, 1, 2, 2), (33, 3, 2, 5, 3), (33, -2, -1, 0, 1)]
    for k in (0, 1, 2, 3, 6, 10):
        helper(f'multiple_independent_caps.k{k}', mixed, k)
    helper('clamp_after_sum_not_each_row', [(33, -30, -2, 0, 1), (33, 20, 1, 2, 2)], 2, 10)
    for source in ('own', 'invisible', 'squad', 'target_only'):
        world = World(abc, overrides=overrides)
        held = prepare(world, bel)
        member, unit, *_ = world.member(conditions=held if source == 'own' else [], debuffs=2)
        if source == 'invisible':
            member['conditionSlot']['invisibleSlot'] = world.slot(held, invisible=True)
        elif source == 'squad':
            member['conditionSlot']['squadSlot'] = {'index': 0, 'params': [world.slot(held)]}
        elif source == 'target_only':
            unit['parent']['conditionSlot'] = world.slot(held)
        checks.eq('holder_scope.' + source, world.run('MemberImpl/wfxDirectTargetCount', member, unit),
                  0 if source == 'target_only' else 11)
    for stackable, held, expected in ((True, 0, 0), (True, 4, 44), (False, 19, 11)):
        world = World(abc, overrides=overrides)
        cond = prepare(world, bel)[0]
        cond['maxAccumulation'] = 99 if stackable else 1
        cond['magnificationFromPrimary'] = cond['magnificationFromOther'] = held
        member, unit, *_ = world.member(conditions=[cond], debuffs=2)
        checks.eq(f'actual_accumulation.{stackable}.{held}', world.run('MemberImpl/wfxDirectTargetCount', member, unit), expected)
    # 官方弱体接口读的是native ConditionSlot；持有层和目标层不能混为一谈。
    world, member, unit = helper('native_debuff_count_called', bel, 2)
    checks.eq('native_debuff_count_once', world.calls['debuff'], 1)
    checks.eq('native_debuff_chain_executed',
              {'EnemyImpl/getTotalDebuffCounts', 'ConditionSlot/getTotalDebuffCounts'} <= world.executed, True)
    for target in (None, {'parent': None}):
        checks.eq('null_target.' + str(target), world.run('MemberImpl/wfxDirectTargetCount', member, target), 0)
    class UnreadableTarget(dict):
        def __contains__(self, key):
            raise AssertionError('无码33时读取目标: ' + str(key))
    empty = World(abc, overrides=overrides)
    member, *_ = empty.member()
    checks.eq('no_rows.no_target_access', empty.run('MemberImpl/wfxDirectTargetCount', member, UnreadableTarget()), 0)
    for text in ('wfx:33::1:5:x', 'wfx:33:1.5:1:5:x', 'wfx:33:1:1.5:5:x',
                 'wfx:33:1:1:5.5:x', 'wfx:33:2147483648:1:5:x',
                 'wfx:33:1:2147483648:5:x', 'wfx:33:1:1:-2147483649:x'):
        invalid = World(abc, {1: text}, overrides=overrides)
        m, target, *_ = invalid.member(conditions=[invalid.condition(1)], debuffs=2)
        checks.eq('invalid_spec.' + text, invalid.run('MemberImpl/wfxDirectTargetCount', m, target), 0)
    native_parity(abc, overrides, checks)
    return checks


def native_parity(abc, overrides, checks):
    """把码33产生的n与同n原生候选的完整调度出口逐项对照。"""
    bel = [(33, 10, 1, 5, 1)]
    for k, native, merged, kyle in itertools.product((0, 1, 2, 6, 10), (None, (2, 50000), (3, 90000)),
                                                     (False, True), (False, True)):
        delta = contribution(bel, k)
        n, damage = native if native is not None else (1, 0)
        extras = [(25, 4, 1, 0, 1)] if merged else []
        kwargs = dict(debuffs=k, leader=kyle, name='kyle_moon' if kyle else 'other',
                      legacy={13999011: 3, 13999012: 625}, combo=8)
        actual = schedule(World(abc, overrides=overrides), bel+extras, native=native, **kwargs)
        expected_native = (n + delta, damage) if delta else native
        expected = schedule(World(abc, overrides=overrides), extras, native=expected_native, **kwargs)
        checks.eq(f'native_schedule.k{k}.native{native}.merged{merged}.kyle{kyle}', actual, expected)
    # ACAdditionalDirectAttack、能力DirectAttack2/3与场地的原生择优路径必须仍执行。
    for base, extra, field, winner in (
            ((2, 20000), [(3, 50000)], None, (3, 50000)),
            ((3, 50000), [(2, 90000)], None, (3, 50000)),
            ((3, 20000), [(3, 90000)], (2, 99999), (3, 90000)),
            ((2, 90000), [(3, 50000), (4, 10000)], (5, 70000), (5, 70000)),
            (None, [(2, 10000), (3, 30000)], None, (3, 30000))):
        for merged in (False, True):
            rows = bel + ([(25, 4, 1, 0, 1)] if merged else [])
            world = World(abc, overrides=overrides)
            actual = schedule(world, rows, debuffs=2, native=base, extra=extra, field=field)
            expected = schedule(World(abc, overrides=overrides), rows[1:], debuffs=2,
                                native=(winner[0]+11, winner[1]))
            checks.eq(f'native_winner.{base}.{extra}.{field}.merged{merged}', actual, expected)
            checks.eq(f'native_winner.executed.{base}.{extra}.{field}.merged{merged}',
                      {'MemberImpl/getAdditionalDirectAttack', 'ConditionSlot/getAdditionalDirectAttack',
                       'AdditionalDirectAttackContent$/getBetter', 'AdditionalDirectAttackContent/isBetterThan'}
                      <= world.executed, True)
