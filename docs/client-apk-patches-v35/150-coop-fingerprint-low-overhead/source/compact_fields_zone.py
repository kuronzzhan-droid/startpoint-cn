"""Summon address-set digests and modifier/buff counts; no content copying."""
from fp_fields_base import START, NULL
from compact_fields_codec import json, summary


def build(g):
    l, s = g.l, g.s
    code = START + l(1) + [('iftrue', 'HAS')]
    code += g.set(l(3), g.add(s('/funnels/'), l(2)), NULL)
    code += g.set(l(3), g.add(s('/rng/funnel/'), l(2)), NULL) + [('returnvoid',), ('label', 'HAS')]
    code += g.p(g.p(l(1), 'FunnelSubManagerImpl', 'activeFunnels'), 'List', 'h') + [('setlocal', 5)]
    code += g.arr([]) + [('setlocal', 6)]
    code += [('label', 'LOOP')] + l(5) + [('iffalse', 'DONE')]
    code += g.p(l(5), 'ListNode', 'item') + [('setlocal', 7)]
    code += g.push(l(6), json(g, g.enum(g.p(l(7), 'EnemyImpl', 'address'), l(4), g.add(s('/funnels/'), l(2)))))
    code += g.p(l(5), 'ListNode', 'next') + [('setlocal', 5), ('jump', 'LOOP'), ('label', 'DONE')]
    code += g.set(l(3), g.add(s('/funnels/'), l(2)), summary(g, l(6)))
    code += g.set(l(3), g.add(s('/rng/funnel/'), l(2)),
                  g.call('wfxFpCompactRng', g.p(l(1), 'FunnelSubManagerImpl', 'random'), l(4), g.add(s('/rng/funnel/'), l(2))))
    code += [('returnvoid',)]
    g.method('Battle', 'wfxFpCompactFunnelSub', 'void', ['*', 'String', 'Object', 'Array'], code, 8)

    code = START[:]
    for i in range(1, 11):
        code += NULL + [('setlocal', 4)] + l(1) + [('iffalse', f'S{i}')]
        code += g.p(l(1), 'FunnelManagerImpl', f'subManager{i:02d}') + [('setlocal', 4), ('label', f'S{i}')]
        code += g.call('wfxFpCompactFunnelSub', l(4), s(f'{i:02d}'), l(2), l(3)) + [('pop',)]
    code += [('returnvoid',)]
    g.method('Battle', 'wfxFpCompactFunnels', 'void', ['*', 'Object', 'Array'], code, 5)

    code = START + l(1) + [('iftrue', 'HAS')]
    code += g.set(l(2), s('/modifier'), NULL) + g.set(l(2), s('/buff'), NULL) + [('returnvoid',), ('label', 'HAS')]
    for key, typ, field in (('modifier', 'ModifierField', 'modifierField'), ('buff', 'BuffField', 'buffField')):
        code += g.p(l(1), 'ModifierFieldManagerImpl', field) + [('setlocal', 3)]
        code += l(3) + [('iftrue', key + 'HAS')]
        code += g.set(l(2), s('/' + key), NULL) + [('jump', key + 'DONE'), ('label', key + 'HAS')]
        fields = {name: g.p(l(3), typ, name) for name in ('frameCount', 'limitFrame')}
        fields['contentsCount'] = g.raw(g.p(l(3), typ, 'contents'), 'length')
        if key == 'modifier':
            fields['stateChangedCount'] = g.p(l(3), typ, 'stateChangedCount')
            fields['restCancelCount'] = g.f64(g.p(l(3), typ, 'restCancelCount'))
            fields['bookedCount'] = g.raw(g.p(l(3), typ, 'bookedCountDowns'), 'length')
        code += g.set(l(2), s('/' + key), g.obj(fields)) + [('label', key + 'DONE')]
    code += [('returnvoid',)]
    g.method('Battle', 'wfxFpCompactModifier', 'void', ['*', 'Object'], code, 4)
