"""召唤/领域/zone RNG；不调用生成、随机选择或领域初始化函数。"""
from fp_fields_base import START, NULL, TRUE


def build(g):
    l, n, s, q = g.l, g.n, g.s, g.q
    # (submanager, manager number, values, unsupported)
    code = START + g.add(s('/funnels/'), l(2)) + [('setlocal', 5)]
    code += l(1) + [('iftrue', 'HAS')] + g.set(l(3), l(5), NULL)
    code += g.set(l(3), g.add(s('/rng/funnel/'), l(2)), NULL) + [('returnvoid',), ('label', 'HAS')]
    code += g.set(l(3), l(5), TRUE)
    code += g.p(g.p(l(1), 'FunnelSubManagerImpl', 'activeFunnels'), 'List', 'h') + [('setlocal', 6)]
    code += g.arr([]) + [('setlocal', 7)]
    code += [('label', 'ACTIVE')] + l(6) + [('iffalse', 'ACTIVEDONE')]
    code += g.p(l(6), 'ListNode', 'item') + [('setlocal', 8)]
    code += g.enum(g.p(l(8), 'EnemyImpl', 'address'), l(4), g.add(l(5), s('/active/address'))) + [('setlocal', 9)]
    code += g.lex('JSON') + l(9) + [('callproperty', q('stringify'), 1), ('setlocal', 10)]
    code += g.push(l(7), l(10))
    code += g.add(l(5), s('/active/'), g.ptr(l(10))) + [('setlocal', 10)]
    code += g.set(l(3), g.add(l(10), s('/address')), l(9))
    code += g.set(l(3), g.add(l(10), s('/state')), g.call('wfxFpEnemyState', l(8), l(4), l(10)))
    code += g.p(l(6), 'ListNode', 'next') + [('setlocal', 6), ('jump', 'ACTIVE'), ('label', 'ACTIVEDONE')]
    code += l(7) + [('callpropvoid', q('sort'), 0)]
    code += g.set(l(3), g.add(l(5), s('/active')), l(7))
    code += g.set(l(3), g.add(l(5), s('/queueLength')),
                  g.p(g.p(l(1), 'FunnelSubManagerImpl', 'queueOfFunnels'), 'List', 'length'))
    code += g.p(l(1), 'FunnelSubManagerImpl', 'spawnPoints') + [('setlocal', 6)]
    code += g.arr([]) + [('setlocal', 7)] + n(0) + [('setlocal', 8)]
    code += [('label', 'SPAWN')] + l(8) + g.raw(l(6), 'length') + [('ifge', 'SPAWNDONE')]
    code += g.push(l(7), g.p(g.at(l(6), l(8)), 'FunnelSpawnPointImpl', 'available'))
    code += [('inclocal_i', 8), ('jump', 'SPAWN'), ('label', 'SPAWNDONE')]
    code += g.set(l(3), g.add(l(5), s('/spawnAvailable')), l(7))
    code += g.call('wfxFpRng', g.p(l(1), 'FunnelSubManagerImpl', 'random'), l(3), l(4),
                   g.add(s('/rng/funnel/'), l(2))) + [('pop',), ('returnvoid',)]
    g.method('Battle', 'wfxFpFunnelSub', 'void', ['*', 'String', 'Object', 'Array'], code, 11)

    code = START + l(1) + [('iftrue', 'HAS')] + g.set(l(2), s('/funnels'), NULL)
    for i in range(1, 11):
        code += g.set(l(2), s(f'/rng/funnel/{i:02d}'), NULL)
    code += [('returnvoid',), ('label', 'HAS')] + g.set(l(2), s('/funnels'), TRUE)
    for i in range(1, 11):
        code += g.call('wfxFpFunnelSub', g.p(l(1), 'FunnelManagerImpl', f'subManager{i:02d}'),
                       s(f'{i:02d}'), l(2), l(3)) + [('pop',)]
    code += [('returnvoid',)]
    g.method('Battle', 'wfxFpFunnels', 'void', ['*', 'Object', 'Array'], code, 4)

    # modifier manager -> modifier and buff fields. Each object remains absent
    # until gameplay itself creates it; no lazy getter is used.
    code = START + l(1) + [('iftrue', 'MANAGER')]
    code += g.set(l(2), s('/modifier'), NULL) + g.set(l(2), s('/buff'), NULL) + [('returnvoid',)]
    code += [('label', 'MANAGER')] + g.p(l(1), 'ModifierFieldManagerImpl', 'modifierField') + [('setlocal', 4)]
    code += l(4) + [('iftrue', 'MODIFIER')] + g.set(l(2), s('/modifier'), NULL) + [('jump', 'BUFF')]
    code += [('label', 'MODIFIER')] + g.set(l(2), s('/modifier'), TRUE)
    for field in ('key', 'frameCount', 'limitFrame', 'stateChangedCount'):
        code += g.set(l(2), s('/modifier/' + field), g.p(l(4), 'ModifierField', field))
    code += g.set(l(2), s('/modifier/restCancelCount'), g.f64(g.p(l(4), 'ModifierField', 'restCancelCount')))
    code += g.set(l(2), s('/modifier/contentsLength'), g.raw(g.p(l(4), 'ModifierField', 'contents'), 'length'))
    code += g.p(l(4), 'ModifierField', 'bookedCountDowns') + [('setlocal', 5)]
    code += g.arr([]) + [('setlocal', 6)] + n(0) + [('setlocal', 7)]
    code += [('label', 'BOOKED')] + l(7) + g.raw(l(5), 'length') + [('ifge', 'BOOKEDDONE')]
    code += g.at(l(5), l(7)) + [('setlocal', 8)]
    code += g.push(l(6), g.arr([g.p(l(8), 'BookedCountDown', 'frame'), g.p(l(8), 'BookedCountDown', 'key'),
                              g.f64(g.p(l(8), 'BookedCountDown', 'count'))]))
    code += [('inclocal_i', 7), ('jump', 'BOOKED'), ('label', 'BOOKEDDONE')]
    code += g.set(l(2), s('/modifier/booked'), l(6))
    code += [('label', 'BUFF')] + g.p(l(1), 'ModifierFieldManagerImpl', 'buffField') + [('setlocal', 4)]
    code += l(4) + [('iftrue', 'HASBUFF')] + g.set(l(2), s('/buff'), NULL) + [('returnvoid',)]
    code += [('label', 'HASBUFF')] + g.set(l(2), s('/buff'), TRUE)
    for field in ('frameCount', 'limitFrame'):
        code += g.set(l(2), s('/buff/' + field), g.p(l(4), 'BuffField', field))
    code += g.p(l(4), 'BuffField', 'contents') + [('setlocal', 5)]
    code += g.arr([]) + [('setlocal', 6)] + n(0) + [('setlocal', 7)]
    code += [('label', 'CONTENTS')] + l(7) + g.raw(l(5), 'length') + [('ifge', 'CONTENTSDONE')]
    code += g.push(l(6), g.enum(g.at(l(5), l(7)), l(3), g.add(s('/buff/contents/'), l(7))))
    code += [('inclocal_i', 7), ('jump', 'CONTENTS'), ('label', 'CONTENTSDONE')]
    code += g.set(l(2), s('/buff/contents'), l(6)) + [('returnvoid',)]
    g.method('Battle', 'wfxFpModifier', 'void', ['*', 'Object', 'Array'], code, 9)

    paths = {
        'action': [('ZoneImpl','actionManager'), ('ActionManagerImpl','randomNumberGenerator')],
        'instantItem': [('ZoneImpl','instantItemManager'), ('InstantItemManagerImpl','random')],
        'normalAttack': [('ZoneImpl','impactManager'), ('ImpactManagerImpl','calculator'),
                         ('ImpactCalculator','normalAttackCalculator'), ('NormalAttackCalculator','random')],
        'reductionDamage': [('ZoneImpl','impactManager'), ('ImpactManagerImpl','calculator'),
                            ('ImpactCalculator','normalAttackCalculator'), ('NormalAttackCalculator','randomForReductionDamage')],
        'normalHeal': [('ZoneImpl','impactManager'), ('ImpactManagerImpl','calculator'),
                       ('ImpactCalculator','normalHealCalculator'), ('NormalHealCalculator','random')],
    }
    code = START[:]
    for name, chain in paths.items():
        code += l(1) + [('setlocal', 4)]
        for owner, field in chain:
            code += l(4) + [('iffalse', name + 'DONE')]
            code += g.p(l(4), owner, field) + [('setlocal', 4)]
        code += [('label', name + 'DONE')] + g.call('wfxFpRng', l(4), l(2), l(3), s('/rng/' + name)) + [('pop',)]
    code += [('returnvoid',)]
    g.method('Battle', 'wfxFpZoneRng', 'void', ['*', 'Object', 'Array'], code, 5)
