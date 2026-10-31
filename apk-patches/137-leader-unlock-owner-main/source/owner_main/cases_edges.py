"""无队伍/空首位与未获授权的原生条件边界。"""
from .runtime import COUNT, MATCH, KEY, enum, world, panel, battle, none


def edges(before, after, ok, executed):
    kinds = (enum(0), enum(6), enum(7), enum(12), enum(3, []), enum(10, []))
    for slot in range(3):
        e, p, mains, unisons = world(after, {KEY: '27'})
        ae, ap, am, au = world(before, {KEY: '27'})
        for kind in kinds:
            for origin in (1000, 1001000, 1021000):
                args = (kind, p, slot, origin, False)
                prior_args = (kind, ap, slot, origin, False)
                actual = e.run(COUNT, mains[slot], *args)
                prior = ae.run(COUNT, am[slot], *prior_args)
                ok(f'非202计数/slot{slot}/kind{kind}/origin{origin}', actual, prior, True)
                for mode in ('initial', 'battle', 'during'):
                    actual = battle(e, p, mains[slot], origin, (kind,), mode)
                    prior = battle(ae, ap, am[slot], origin, (kind,), mode)
                    ok(f'非202原生发动/{slot}/{kind}/{origin}/{mode}', actual, prior, True)
            for char, oldchar in ((mains[slot], am[slot]), (unisons[slot], au[slot])):
                actual = e.run(MATCH, e.lex['InitialAbilityTriggerKindTools'], char, kind)
                prior = ae.run(MATCH, ae.lex['InitialAbilityTriggerKindTools'], oldchar, kind)
                ok(f'原生matchCharacter/{slot}/{char["isUnison"]}/{kind}', actual, prior, True)
        # 主位自身从来不需要解锁，三个槽均应保持。
        for unisonable in (False, True):
            actual = panel(e, p, mains, slot, unison=False, unisonable=unisonable)
            prior = panel(ae, ap, am, slot, unison=False, unisonable=unisonable)
            ok(f'主位面板保持/{slot}/{unisonable}', actual, prior, True)
        actual = panel(e, p, mains, slot, learned=False)
        ok(f'未学习不进入发动列表/{slot}', len(actual['triggerableAbilities']), 0)
        executed.update(e.executed)

    for case in ('no_party', 'first_none'):
        results = []
        for abc in (before, after):
            e, p, mains, unisons = world(abc, {KEY: '27'})
            if case == 'no_party':
                for char in mains + unisons:
                    char['party'] = None
                p = None
            elif case == 'first_none':
                p['mainCharacters'][0] = none()
            values = []
            for slot in range(3):
                values.append(e.run(COUNT, mains[slot], enum(11), p, slot, 1001000, False))
                values.append(panel(e, p, mains, slot))
            results.append(values)
            if abc is after:
                executed.update(e.executed)
        ok('无队伍边界/' + case, results[1], results[0], True)
