"""Ordered, independent snapshots of visible and invisible player slots."""
from .common import BCD, SLOT


def build(c):
    # snapshot = [Condition[] normalized to frame zero, [gid,count][], invisible]
    # r1 conditions, r2 application rows, r3 index, r4 condition/iterator,
    # r5 sorted resolver keys, r6 key, r7 invisible snapshot.
    code = [('newarray', 0), ('setlocal_1',), ('newarray', 0), ('setlocal_2',),
            ('pushbyte', 0), ('setlocal_3',), ('label', 'conditions'),
            ('getlocal_3',), ('getlocal_0',), c.get('conditions'), c.get('_keys'),
            c.get('length'), ('ifge', 'applications'),
            ('getlocal_0',), ('getlocal_3',), c.call('getConditionByIndex', 1),
            ('setlocal', 4), ('inclocal_i', 3)]
    code += [('getlocal', 4), c.get('isQuestInitial'), ('iftrue', 'conditions')]
    for field in ('linkedTrialId', 'hitCountCheck'):
        code += [('getlocal', 4), c.get(field), ('pushnull',), ('ifne', 'conditions')]
    code += [('getlocal', 4), ('getlocal_0',), c.get('frameCount'),
             c.call('hasExpired', 1), ('iftrue', 'conditions'),
             ('getlocal_1',), ('getlex', c.q(BCD)), ('getlocal', 4),
             ('getlocal_0',), c.get('frameCount'), ('negate_i',),
             c.helper('wfxStageClone', 2),
             c.void('http://adobe.com/AS3/2006/builtin::push', 1),
             ('jump', 'conditions'), ('label', 'applications'),
             ('newarray', 0), ('setlocal', 5), ('getlocal_0',),
             c.get('applicationResolver'), c.call('keys'), ('setlocal', 4),
             ('label', 'keys'), ('getlocal', 4), c.call('hasNext'),
             ('iffalse', 'sort'), ('getlocal', 5), ('getlocal', 4), c.call('next'),
             c.void('http://adobe.com/AS3/2006/builtin::push', 1), ('jump', 'keys'),
             ('label', 'sort'), ('getlocal', 5),
             c.void('http://adobe.com/AS3/2006/builtin::sort'),
             ('pushbyte', 0), ('setlocal_3',), ('label', 'values'),
             ('getlocal_3',), ('getlocal', 5), c.get('length'), ('ifge', 'invisible'),
             ('getlocal', 5), ('getlocal_3',), ('getproperty', c.dynamic),
             ('setlocal', 6), ('getlocal_2',), ('getlocal', 6), ('getlocal_0',),
             c.get('applicationResolver'), ('getlocal', 6), c.call('get', 1),
             ('newarray', 2), c.void('http://adobe.com/AS3/2006/builtin::push', 1),
             ('inclocal_i', 3), ('jump', 'values'), ('label', 'invisible'),
             ('pushnull',), ('setlocal', 7), ('getlocal_0',), c.get('invisibleSlot'),
             ('iffalse', 'done'), ('getlocal_0',), c.get('invisibleSlot'),
             c.helper('wfxStageSnapshot'), ('setlocal', 7), ('label', 'done'),
             ('getlocal_1',), ('getlocal_2',), ('getlocal', 7), ('newarray', 3),
             ('returnvalue',)]
    c.add(SLOT, 'wfxStageSnapshot', 'Array', [], code, 8)

    # Restore already-resolved Condition values through the same setCondition
    # leaf as CreateCondition. Do not execute obtain, overwrite, or mission hooks.
    code = [('getlocal_1',), ('iffalse', 'done'), ('getlocal_1',), *c.at(0),
            ('setlocal_2',), ('pushbyte', 0), ('setlocal_3',),
            ('label', 'conditions'), ('getlocal_3',), ('getlocal_2',),
            c.get('length'), ('ifge', 'applications'), ('getlex', c.q(BCD)),
            ('getlocal_2',), ('getlocal_3',), ('getproperty', c.dynamic),
            ('getlocal_0',), c.get('frameCount'), c.helper('wfxStageClone', 2),
            ('setlocal', 4), ('getlocal_0',), ('getlocal', 4), c.get('id'),
            ('getlocal', 4), c.void('setCondition', 2), ('getlocal_0',),
            c.void('addRefreshCount'), ('inclocal_i', 3), ('jump', 'conditions'),
            ('label', 'applications'), ('getlocal_1',), *c.at(1), ('setlocal_2',),
            ('pushbyte', 0), ('setlocal_3',), ('label', 'values'),
            ('getlocal_3',), ('getlocal_2',), c.get('length'), ('ifge', 'invisible'),
            ('getlocal_2',), ('getlocal_3',), ('getproperty', c.dynamic),
            ('setlocal', 4), ('getlocal_0',), c.get('applicationResolver'),
            ('getlocal', 4), *c.at(0), ('getlocal', 4), *c.at(1), c.void('set', 2),
            ('inclocal_i', 3), ('jump', 'values'), ('label', 'invisible'),
            ('getlocal_0',), c.get('invisibleSlot'), ('iffalse', 'done'),
            ('getlocal_0',), c.get('invisibleSlot'), ('getlocal_1',), *c.at(2),
            c.helper('wfxStageRestore', 1, void=True), ('label', 'done'), ('returnvoid',)]
    c.add(SLOT, 'wfxStageRestore', 'void', ['Array'], code, 5)
