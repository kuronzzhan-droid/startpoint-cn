"""Complete active/invisible/reserved condition lists without gameplay methods."""
from fp_fields_base import START, NULL
from enemy21_codec import cp, RESERVED_FIELDS

PARALYSIS_FIELDS = ('content', 'statsBattleId', 'shouldCountForMission', 'linkedTrialId',
                    'isMergedResult', 'reservedFrameCount', 'createdByPrimaryBattle')


def build(g):
    l, n, s = g.l, g.n, g.s
    c = START + l(1) + [('iftrue', 'HAS')] + NULL + [('returnvalue',), ('label', 'HAS')]
    c += g.arr([]) + [('setlocal', 4)] + n(0) + [('setlocal', 5), ('label', 'LOOP')]
    c += l(5) + g.raw(l(1), 'length') + [('ifge', 'DONE')]
    c += g.at(l(1), l(5)) + [('setlocal', 6)]
    c += g.push(l(4), g.arr([cp(g, g.raw(l(6), name), g.add(l(3), s('/' + name))) for name in PARALYSIS_FIELDS]))
    c += [('inclocal_i', 5), ('jump', 'LOOP'), ('label', 'DONE')] + l(4) + [('returnvalue',)]
    g.method('Battle', 'wfxFp21Paralysis', '*', ['*', 'Array', 'String'], c, 7)
    # slot1, unsupported2, path3, depth4, active5, reserved6, map7, keys8,
    # index9, key10, item11, node12, invisible13.
    c = START + l(1) + [('iftrue', 'HAS')] + NULL + [('returnvalue',), ('label', 'HAS')]
    c += l(4) + n(2) + [('ifle', 'DEPTHOK')]
    c += g.unsupported(l(2), l(3), 'condition_slot_depth') + NULL + [('returnvalue',), ('label', 'DEPTHOK')]
    c += g.arr([]) + [('setlocal', 5)] + g.arr([]) + [('setlocal', 6)]
    c += g.p(l(1), 'ConditionSlot', 'conditions') + [('setlocal', 7)]
    c += l(7) + [('iffalse', 'RESERVED')]
    c += g.p(l(7), 'OrderedMap', '_keys') + [('setlocal', 8)]
    c += g.p(l(7), 'OrderedMap', 'map') + [('setlocal', 7)] + n(0) + [('setlocal', 9)]
    c += [('label', 'ACTIVELOOP')] + l(9) + g.raw(l(8), 'length') + [('ifge', 'RESERVED')]
    c += g.at(l(8), l(9)) + [('setlocal', 10)]
    # Reserved map uses a dollar-prefixed key; prefer its owned entry before
    # touching h, whose native Object prototype may have a same-name member.
    c += g.p(l(7), 'StringMap', 'rh') + [('setlocal', 11)]
    c += l(11) + [('iffalse', 'NORMAL')]
    c += g.add(s('$'), l(10)) + l(11) + [('in',), ('iffalse', 'NORMAL')]
    c += g.at(l(11), g.add(s('$'), l(10))) + [('setlocal', 11), ('jump', 'FOUND')]
    c += [('label', 'NORMAL')]
    c += g.p(l(7), 'StringMap', 'h') + [('setlocal', 11)]
    c += l(11) + [('iffalse', 'MISSING')]
    c += g.at(l(11), l(10)) + [('setlocal', 11)] + l(11) + [('iftrue', 'FOUND')]
    c += [('label', 'MISSING')] + g.unsupported(l(2), g.add(l(3), s('/active/'), l(10)), 'condition_key_missing')
    c += g.push(l(5), g.arr([l(10), NULL])) + [('jump', 'NEXT')]
    c += [('label', 'FOUND')] + g.push(l(5), g.arr([l(10), g.call('wfxFp21Condition', l(11), l(2), g.add(l(3), s('/active/'), l(10)))]))
    c += [('label', 'NEXT'), ('inclocal_i', 9), ('jump', 'ACTIVELOOP'), ('label', 'RESERVED')]
    c += g.p(l(1), 'ConditionSlot', 'reservedConditions') + [('setlocal', 12)]
    c += l(12) + [('iffalse', 'INVISIBLE')]
    c += g.p(l(12), 'List', 'h') + [('setlocal', 12), ('label', 'RESLOOP')]
    c += l(12) + [('iffalse', 'INVISIBLE')]
    c += g.p(l(12), 'ListNode', 'item') + [('setlocal', 11)]
    c += g.push(l(6), g.arr([cp(g, g.raw(l(11), name), g.add(l(3), s('/reserved/' + name))) for name in RESERVED_FIELDS]))
    c += g.p(l(12), 'ListNode', 'next') + [('setlocal', 12), ('jump', 'RESLOOP')]
    c += [('label', 'INVISIBLE')] + g.call('wfxFp21Conditions',
        g.p(l(1), 'ConditionSlot', 'invisibleSlot'), l(2), g.add(l(3), s('/invisible')), l(4) + n(1) + [('add_i',)])
    c += [('setlocal', 13)]
    c += g.arr([g.p(l(1), 'ConditionSlot', 'frameCount'), g.p(l(1), 'ConditionSlot', 'refreshIndex'), l(5), l(6), l(13)])
    c += [('returnvalue',)]
    g.method('Battle', 'wfxFp21Conditions', '*', ['*', 'Array', 'String', 'int'], c, 14)
