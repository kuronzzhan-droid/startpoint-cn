"""第三版 CT 验收：治疗、采样、聚合、发伤和 Fever 都执行实际 ABC。"""
from .runtime import World
from .cases import TABLE


def make(abc, arg=5050, *, hp=0, maxhp=100, codes=(34, 35), table=None, **kw):
    rows = {**TABLE, 34: f'wfx:34:{arg}:100000:150000:hidden_ct'}
    if table:
        rows.update(table)
    world = World(abc, rows, **kw)
    owner = world.unit([world.condition(code) for code in codes])
    recipient = world.unit(hp=hp, maxhp=maxhp)
    return world, owner, recipient


def trace(world):
    return [(shot['frame'], shot['member'], amount)
            for shot, amount in zip(world.shots, world.amounts())]


def expected(*emissions):
    return [entry for entry in emissions for _ in range(2)]


def tick_now(world):
    world.run('MemberImpl$/wfxHealDamageTick', world.lex['MemberImpl'], world.manager)


def mixed_suite(abc):
    """额外混配的当前实现约定取 max；不表示作者另行批准此数据组合。"""
    checks = []
    for short_arg in (50, 1050):
        for reverse in (False, True):
            w, owner, target = make(abc, arg=short_arg, codes=(),
                                    table={36: 'wfx:34:5050:100000:150000:long_ct'})
            conditions = [w.condition(34, 2), w.condition(36)]
            owner['conditionSlot'] = w.slot(list(reversed(conditions)) if reverse else conditions)
            w.heal(target, 5, origin=-1)
            w.tick(30)
            assert trace(w) == expected((30, 0, 30)), 'ct.mixed-convention-initial-sum'
            w.tick(60)
            w.heal(target, 5, origin=-1)
            w.tick(239)
            w.heal(target, 5, origin=-1)
            w.tick()
            assert trace(w) == expected((30, 0, 30)), 'ct.mixed-convention-maximum-blocks-both-states'
            w.heal(target, 5, origin=-1)
            w.tick(30)
            assert trace(w) == expected((30, 0, 30), (360, 0, 30)), 'ct.mixed-convention-expiry-no-hoarding'
            checks.append(f'ct.implementation-convention.mixed-max.arg{short_arg}-5050.reverse{reverse}')
    return checks


def suite(abc):
    checks = []
    w, _, target = make(abc)
    w.heal(target, 5, origin=-1)
    w.tick(29)
    assert not w.shots, 'ct.window-before-due'
    w.heal(target, 5, origin=-1)
    w.tick()
    assert trace(w) == expected((30, 0, 20)), 'ct.window-aggregates-until-due'
    w.heal(target, 10, origin=-1)
    w.tick(299)
    w.heal(target, 10, origin=-1)
    assert trace(w) == expected((30, 0, 20)), 'ct.drop-at-start-and-last-frame'
    assert w.fever_ratios() == [.05, .05, .1, .1], 'ct.fever-unlimited'
    w.tick()
    assert trace(w) == expected((30, 0, 20)), 'ct.expiry-without-heal-does-not-open'
    w.heal(target, 5, origin=-1)
    w.tick(29)
    assert len(w.shots) == 2, 'ct.reopened-window-waits-30'
    w.tick()
    assert trace(w) == expected((30, 0, 20), (360, 0, 10)), 'ct.no-hoarded-healing'
    w.tick(600)
    assert len(w.shots) == 4, 'ct.no-automatic-tail-after-expiry'
    checks += ['ct.30-frame-window-aggregation', 'ct.300-frame-cooldown-from-emission',
               'ct.expiry-inclusive-new-heal-opens-window', 'ct.fever-during-ct',
               'ct.no-hoarding-or-automatic-tail']

    # Delayed timer delivery moves the CT origin to the actual emission frame.
    w, _, target = make(abc)
    w.heal(target, 5, origin=-1)
    w.manager['currentFrame'] = 47
    tick_now(w)
    assert trace(w) == expected((47, 0, 10)), 'ct.delayed-tick-emits-now'
    w.manager['currentFrame'] = 330
    w.heal(target, 5, origin=-1)
    w.manager['currentFrame'] = 346
    w.heal(target, 5, origin=-1)
    w.manager['currentFrame'] = 347
    tick_now(w)
    assert len(w.shots) == 2, 'ct.delayed-tick-has-no-hoarded-window'
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert trace(w) == expected((47, 0, 10), (377, 0, 10)), 'ct.start-is-actual-emission'
    checks.append('ct.delayed-tick-starts-at-actual-emission-47-not-due-30')

    for first_overflow in (False, True):
        w, _, target = make(abc, hp=100 if first_overflow else 0)
        other = w.unit(hp=0 if first_overflow else 100)
        first = 15 if first_overflow else 10
        second = 10 if first_overflow else 15
        w.heal(target, 5, origin=-1)
        w.tick(30)
        w.heal(other, 5, origin=-1)
        w.tick(300)
        assert trace(w) == expected((30, 0, first)), 'ct.effective-overflow-share-cooldown'
        w.heal(other, 5, origin=-1)
        w.tick(30)
        assert trace(w) == expected((30, 0, first), (360, 0, second)), 'ct.shared-cooldown-resumes'
        checks.append('ct.effective-overflow-shared.' + str(first_overflow))

    # Rejected, nonlocal and sub-step recovery must not start a window or CT.
    for gate in ('low-step', 'zero', 'rejected', 'mirror-battle', 'other-squad', 'outside-members'):
        w, _, target = make(abc)
        kwargs = {'origin': -1}
        amount = 5
        if gate == 'low-step': amount = 4.9
        elif gate == 'zero': amount = 0
        elif gate == 'rejected': kwargs['isHealRejected'] = True
        elif gate == 'mirror-battle': w.battle['__isMyBattle__'] = lambda: False
        elif gate == 'other-squad': target['squad'] = {'isPrimary': lambda: False}
        else: member_entry = w.primary['members'].pop()
        w.heal(target, amount, **kwargs)
        w.battle['__isMyBattle__'] = lambda: True
        target['squad'] = w.primary
        if gate == 'outside-members': w.primary['members'].append(member_entry)
        w.tick(10)
        w.heal(target, 5, origin=-1)
        w.tick(20)
        assert not w.shots, ('ct.no-empty-window', gate)
        w.tick(10)
        assert trace(w) == expected((40, 0, 10)), ('ct.first-qualified-heal', gate)
        checks.append('ct.no-window-for.' + gate)

    for coop in (False, True):
        w, _, target = make(abc, codes=(30, 31, 34, 35))
        w.heal(target, 5, origin=0, statsBattleId='remote-source', createdByCoopCommand=coop)
        w.tick(30)
        w.heal(target, 5, origin=0, statsBattleId='remote-source', createdByCoopCommand=coop)
        w.tick(30)
        assert trace(w) == expected((30, 0, 10)), 'ct.remote-source-damage-once'
        assert w.fever_ratios() == [.05, .05], 'ct.remote-source-fever-during-ct'
        checks.append('ct.cross-statsBattleId-local-heal-once.' + str(coop))

    # Independent holders can use different CT lengths without sharing state.
    w, _, target = make(abc, arg=1050, codes=(34,),
                        table={36: 'wfx:34:5050:100000:150000:second_holder'})
    w.unit([w.condition(36, 2)])
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert trace(w) == expected((30, 0, 10), (30, 2, 20)), 'ct.two-holder-first-emission'
    w.tick(59)
    w.heal(target, 5, origin=-1)
    w.tick()
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert trace(w) == expected((30, 0, 10), (30, 2, 20), (120, 0, 10)), 'ct.two-holder-independent-duration'
    w.tick(210)
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert trace(w) == expected((30, 0, 10), (30, 2, 20), (120, 0, 10),
                                (360, 0, 10), (360, 2, 20)), 'ct.two-holder-independent-reopen'
    checks.append('ct.two-holders-1second-and-5seconds-independent-layers')

    w, _, target = make(abc)
    w.heal(target, 5, origin=-1)
    w.tick(30)
    for _ in range(400): tick_now(w)
    assert w.manager['currentFrame'] == 30, 'ct.pause-does-not-advance-logic-frame'
    w.heal(target, 5, origin=-1)
    w.tick(299)
    w.heal(target, 5, origin=-1)
    assert trace(w) == expected((30, 0, 10)), 'ct.pause-does-not-consume-cooldown'
    assert w.fever_ratios() == [.05, .05, .05], 'ct.pause-keeps-fever-independent'
    checks.append('ct.pause-fixed-currentFrame-keeps-cooldown')

    # A damage callback can synchronously trigger another heal; the CT guard must
    # already be active when native emission begins, before the callback returns.
    w, owner, target = make(abc)
    emit = owner['wfxHealDamageEmit']
    def reentrant(kind, amount):
        w.heal(target, 5, origin=-1)
        return emit(kind, amount)
    owner['wfxHealDamageEmit'] = reentrant
    w.heal(target, 5, origin=-1)
    w.tick(60)
    assert trace(w) == expected((30, 0, 10)), 'ct.emission-reentrant-heal-is-dropped'
    assert w.fever_ratios() == [.05, .05], 'ct.emission-reentrant-fever-still-counts'
    checks.append('ct.emission-reentrant-heal-observes-active-ct')

    for kind in range(5):
        w, _, target = make(abc, arg=5050 + kind, codes=(34,),
                            stance={129989: {'main_stance': {'concepts': [2]}}})
        w.heal(target, 12, origin=-1)
        w.tick(30)
        attack = w.impacts[0][1]['content']
        flag = {1: 'createdByMainSkillAction', 2: 'createdByPowerFlipAction',
                3: 'createdByDirectAttack', 4: 'createdByAbility'}[kind or 2]
        assert w.amounts() == [20, 20] and attack[flag], ('ct.decode-step-and-kind', kind)
        checks.append('ct.arg5050-step5-classification.' + str(kind))

    for step in (1, 5, 29, 99):
        w, _, target = make(abc, arg=5000 + step * 10, codes=(34,), maxhp=200)
        w.heal(target, step * 2, origin=-1)
        w.tick(30)
        assert w.amounts() == [10, 10], ('ct.integer-step-maxhp200', step)
        checks.append('ct.step-decoding-maxhp200.' + str(step))
    w, _, target = make(abc, arg=5004, codes=(34,), hp=80)
    w.heal(target, 30, origin=-1)
    w.tick(30)
    assert w.amounts() == [350, 350], 'ct.step-zero-continuous-effective-overflow'
    checks.append('ct.step-zero-keeps-continuous-weights')
    w, _, target = make(abc)
    other = w.unit(hp=0)
    w.heal(target, 4.9, origin=-1)
    w.heal(target, 4.9, origin=-1)
    w.heal(other, 4.9, origin=-1)
    w.tick(30)
    assert not w.shots and not w.fever, 'ct.quantization-no-cross-event-or-member-remainder'
    checks.append('ct.substep-no-remainder-across-events-or-members')

    w, _, target = make(abc)
    w.heal(target, 5, origin=-1)
    w.tick(30)
    changed = dict(w.battle)
    w.manager['battle'] = changed
    for member in w.members: member['battle'] = changed
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert trace(w) == expected((30, 0, 10), (60, 0, 10)), 'ct.new-battle-object-resets-cooldown'
    checks.append('ct.same-battle-id-new-object-resets-state')

    w, _, target = make(abc)
    w.heal(target, 5, origin=-1)
    changed = dict(w.battle)
    w.manager['battle'] = changed
    w.tick(30)
    assert not w.shots, 'ct.pending-window-from-old-battle-discarded'
    for member in w.members: member['battle'] = changed
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert trace(w) == expected((60, 0, 10)), 'ct.new-battle-opens-new-window'
    checks.append('ct.same-battle-id-new-object-discards-pending-window')

    w, owner, target = make(abc, arg=5054, codes=(34,),
                            table={36: 'wfx:34:5051:100000:150000:new_kind'})
    w.heal(target, 5, origin=-1)
    w.tick(30)
    owner['conditionSlot'] = w.slot([w.condition(36)])
    w.heal(target, 5, origin=-1)
    w.tick(300)
    assert trace(w) == expected((30, 0, 10)), 'ct.holder-ct-is-not-category-ct'
    w.heal(target, 5, origin=-1)
    w.tick(30)
    assert trace(w) == expected((30, 0, 10), (360, 0, 10)), 'ct.changed-category-reopens-after-expiry'
    assert w.impacts[0][1]['content']['createdByAbility']
    assert w.impacts[-1][1]['content']['createdByMainSkillAction']
    checks.append('ct.same-holder-category-change-keeps-shared-cooldown')

    for coefficient in (0, -100000):
        w, owner, target = make(abc, codes=(34,), table={
            34: f'wfx:34:5050:{coefficient}:0:no_positive_damage',
            36: 'wfx:34:5050:100000:0:positive_damage'})
        w.heal(target, 5, origin=-1)
        w.tick(30)
        assert not w.shots, 'ct.nonpositive-window-does-not-emit'
        owner['conditionSlot'] = w.slot([w.condition(36)])
        w.heal(target, 5, origin=-1)
        w.tick(30)
        assert trace(w) == expected((60, 0, 10)), 'ct.no-emission-means-no-cooldown-start'
        checks.append('ct.nonpositive-damage-does-not-start-cooldown.' + str(coefficient))
    return checks + mixed_suite(abc)
