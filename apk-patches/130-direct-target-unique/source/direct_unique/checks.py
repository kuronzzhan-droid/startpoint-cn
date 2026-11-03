"""新码真实调用链、公式组合和原生目标口径边界。"""
import itertools
import math
from .runtime import World, prepare, schedule


def addition(rows, targets):
    total = 0
    for code, uid, value, flags, held in rows:
        levels = targets.get(uid, 0)
        if code == 28 and levels >= max(1, flags):
            total += value * held
        if code == 29:
            total += value * held * (min(levels, flags) if flags > 0 else levels)
    return total


def behavior(abc, overrides=None):
    checks = []

    def same(actual, expected):
        if isinstance(actual, (int, float)) and not isinstance(actual, bool):
            return math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-7)
        if isinstance(actual, (list, tuple)) and isinstance(expected, (list, tuple)):
            return len(actual) == len(expected) and all(same(a, b) for a, b in zip(actual, expected))
        if isinstance(actual, dict) and isinstance(expected, dict):
            return actual.keys() == expected.keys() and all(same(v, expected[k]) for k, v in actual.items())
        return actual == expected

    def eq(name, actual, expected):
        assert same(actual, expected), (name, actual, expected)
        checks.append({'name': name, 'actual': actual, 'expected': expected})

    def world(rows=(), loaded=True):
        w = World(abc, loaded=loaded, overrides=overrides)
        return w, prepare(w, rows)

    def factor(case_name, rows, targets, expected=None, **kw):
        w, cond = world(rows)
        got = schedule(w, conditions=cond, targets=targets, **kw)
        if expected is None:
            expected = max(0, 1 + addition(rows, targets) / 10000)
        eq(case_name, got['multipliers'][0], expected * 100000)
        return w, got

    klaus = [(28, 129997, 2700, 1, 1), (29, 129997, 300, 11, 1)]
    for levels, multiplier in ((0, 1), (1, 1.3), (2, 1.33), (11, 1.6), (20, 1.6)):
        w, got = factor(f'klaus.level{levels}', klaus, {129997: levels}, multiplier)
        eq(f'klaus.level{levels}.only_requested_uid', sorted(set(w.unique_requests)), [129997])
        assert {'EnemyImpl/getConditionAccumulationCount', 'ConditionSlot/getConditionAccumulationCount',
                'ConditionSlot/_getConditionAccumulationCount', 'ConditionTools$/matchTarget',
                'ConditionChangeContentTools$/matchTarget', 'Condition/get_magnification'} <= w.executed
    for code in (28, 29):
        for flags in (-2147483648, -7, -1, 0, 1, 2, 11, 2147483647):
            for levels in (0, 1, 2, 20):
                rows = [(code, 129997, 137, flags, 3)]
                factor(f'boundary.code{code}.flags{flags}.level{levels}', rows, {129997: levels})
    mixed = [(28, 129997, 2700, 1, 2), (28, 800001, 700, 3, 3),
             (29, 129997, 300, 11, 2), (29, 129997, 500, 2, 3),
             (29, 800001, 90, 0, 4), (29, 800002, 333, 1, 5)]
    for targets in ({}, {129997: 1}, {129997: 20, 800001: 7},
                    {129997: 20, 800001: 7, 800002: 9}, {800001: 2}):
        factor('multi_uid_independent_cap.' + str(targets), mixed, targets)
    for value in (-30000, -10000, -1000, 0, 1000):
        for code in (28, 29):
            factor(f'negative.code{code}.value{value}', [(code, 129997, value, 1, 2)], {129997: 2})
    for code in (28, 29):
        w, cond = world([(code, 129997, 1000, 1, 0)])
        eq(f'zero_holder.code{code}', schedule(w, conditions=cond, targets={129997: 20})['multipliers'], [100000])
        eq(f'zero_holder.code{code}.no_target_query', w.calls['target_unique'], 0)
        w, cond = world([(code, 129997, 1000, 1, 99)])
        cond[0]['maxAccumulation'] = 1
        eq(f'nonstackable_holder.code{code}', schedule(w, conditions=cond, targets={129997: 1})['multipliers'], [110000])
    # 所有16种码24 arg子集；原凯尔倍率与整个新公式相乘。
    old_rows = [(24, 0, 3100, 0, 2), (24, 1, 625, 0, 1),
                (24, 2, 9500, 0, 1), (24, 3, 500, 2, 3)]
    for enabled in itertools.product((False, True), repeat=4):
        rows = [row for row, yes in zip(old_rows, enabled) if yes] + klaus
        for kyle in (False, True):
            base = 1 + (6000 + (6200 if enabled[0] else 0) +
                        (9500 if enabled[2] else 0) + (3000 if enabled[3] else 0)) / 10000
            expected = base * (1.5 if enabled[1] else 1) * (4.5 if kyle else 1)
            factor(f'all_arg_subsets.{enabled}.kyle{kyle}', rows, {129997: 20}, expected,
                   combo=8, debuffs=3, leader=kyle, name='kyle_moon' if kyle else 'other',
                   legacy={13999011: 3, 13999012: 625})
    for base, combo_value, expected in ((-20000, -10000, 0), (10000, -10000, 0),
                                        (-5000, 625, 2.4), (0, 625, 3.4)):
        rows = [(24, 0, base, 0, 1), (24, 1, combo_value, 0, 1)] + klaus
        # k=1 -> Klaus +3000; combo16 -> positive second bracket2 or negative-15.
        expected = max(0, max(0, 1 + (base + 3000) / 10000) * (1 + combo_value * 16 / 10000))
        factor(f'base_and_final_clamp.{base}.{combo_value}', rows, {129997: 1}, expected, combo=16)
    # 有28/29而无24时也必须保留原连击/多段/合并补偿副作用。
    for segments in (1, 3, 4, 7):
        for merged in (False, True):
            rows = klaus + ([(25, 2, 0, 0, 1)] if merged else [])
            w, cond = world(rows)
            got = schedule(w, conditions=cond, targets={129997: 2}, segments=segments)
            neutral, old_cond = world(rows[2:])
            old = schedule(neutral, conditions=old_cond, targets={129997: 2}, segments=segments)
            eq(f'segments.{segments}.merged{merged}.multiplier', got['multipliers'], [v * 1.33 for v in old['multipliers']])
            eq(f'segments.{segments}.merged{merged}.side_effects',
               {k: v for k, v in got.items() if k != 'multipliers'},
               {k: v for k, v in old.items() if k != 'multipliers'})
    for target in (None, {'parent': None}):
        w, cond = world(klaus)
        member, *_ = w.member(conditions=cond)
        eq('missing_target.' + str(target), w.run('MemberImpl/wfxDirectFactor', member, target), 1)
        eq('missing_target.no_query.' + str(target), w.calls['target_unique'], 0)
    class UnreadableTarget(dict):
        def __contains__(self, key):
            raise AssertionError('无码24/28/29时不应访问目标属性: ' + str(key))
    w, cond = world()
    member, *_ = w.member(conditions=cond)
    eq('empty_holder.no_target_property_access',
       w.run('MemberImpl/wfxDirectFactor', member, UnreadableTarget()), 1)
    # 无合法新码、未加载、缺行及其它码都不得新增目标Unique查询。
    for text in ('ordinary', 'wfx:30:129997:1000:1:x', 'wfx:28:129997:1.5:1:x',
                 'wfx:28:129997:1000:-1.5:x', 'wfx:29:129997:1000:2147483648:x',
                 'wfx:28:-1:1000:1:x', 'wfx:28:129997:1000::x'):
        w = World(abc, {1: text}, overrides=overrides)
        eq('invalid.' + text, schedule(w, conditions=[w.condition(1)], targets={129997: 20})['multipliers'], [100000])
        eq('invalid.no_query.' + text, w.calls['target_unique'], 0)
    for loaded, table in ((False, {1: 'wfx:28:129997:1000:1:x'}), (True, {})):
        w = World(abc, table, loaded, overrides)
        eq(f'missing_or_unloaded.{loaded}', schedule(w, conditions=[w.condition(1)], targets={129997: 20})['multipliers'], [100000])
        eq(f'missing_or_unloaded.{loaded}.no_query', w.calls['target_unique'], 0)
    # 同一UID的原生计数=max(匹配的可叠加层数)，不求和，不读invisibleSlot。
    native_checks(abc, overrides, eq)
    return checks


def native_checks(abc, overrides, eq):
    rows = [(29, 129997, 1000, 0, 1)]
    for kind in ('max_duplicates', 'max_sources', 'nonstackable', 'invisible', 'squad', 'wrong_uid', 'wrong_content'):
        w = World(abc, overrides=overrides)
        held = prepare(w, rows)
        targets = [w.condition(129997, 3), w.condition(129997, 7)]
        expected = 7
        if kind == 'max_sources':
            targets = [w.condition(129997, 3)]
            targets[0]['magnificationFromOther'] = 9
            expected = 9
        elif kind == 'nonstackable':
            targets = [w.condition(129997, 99, stackable=False)]
            expected = 0
        elif kind == 'wrong_uid':
            targets = [w.condition(800001, 20)]
            expected = 0
        elif kind == 'wrong_content':
            targets = [w.condition(129997, 20, content=0)]
            expected = 0
        member, unit, *_ = w.member(conditions=held, target_conditions=targets)
        target_slot = unit['parent']['conditionSlot']
        if kind == 'invisible':
            target_slot['invisibleSlot'] = w.slot([w.condition(129997, 20)], invisible=True)
        if kind == 'squad':
            target_slot['squadSlot'] = {'index': 0, 'params': [w.slot([w.condition(129997, 11)])]}
            expected = 11
        eq('native_target.' + kind, w.run('MemberImpl/wfxDirectFactor', member, unit), 1 + expected / 10)
    # 全队持有=每个发起成员各自持有；已有wfxRows可见/不可见/队伍来源的扫描语义不变。
    for code in (28, 29):
        for source in ('own', 'invisible', 'squad', 'target_only'):
            w = World(abc, overrides=overrides)
            held = prepare(w, [(code, 129997, 3000, 1, 2)])
            member, unit, *_ = w.member(conditions=held if source == 'own' else [], targets={129997: 1})
            if source == 'invisible':
                member['conditionSlot']['invisibleSlot'] = w.slot(held, invisible=True)
            elif source == 'squad':
                member['conditionSlot']['squadSlot'] = {'index': 0, 'params': [w.slot(held)]}
            elif source == 'target_only':
                unit['parent']['conditionSlot'] = w.slot(held + [w.condition(129997, 20)])
            eq(f'holder_scope.{code}.' + source, w.run('MemberImpl/wfxDirectFactor', member, unit), 1 if source == 'target_only' else 1.6)
