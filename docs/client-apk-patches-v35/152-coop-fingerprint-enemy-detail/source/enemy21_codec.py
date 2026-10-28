"""Round21 detached copies, generated only from audited raw slots/signatures."""
from fp_fields_base import START, NULL

ENUMS = ('ConditionChangeContent', 'ConditionDirection', 'ConditionOverwriteStrategy', 'Option', 'ActionEvaluatorAddress')
RESULT = 'ConditionChangeResultContent'
CONDITION = 'pinball.common.data.character.condition::Condition'
CONDITION_FIELDS = ('id', 'content', 'addedTime', 'timeLimit', '_originalTimeLimit',
    'restFlipLimit', 'restPowerFlipLimit', 'restEndPowerFlipLimit',
    'endPowerFlipAcceptedLevels', 'maxAccumulation', 'magnificationFromPrimary',
    'magnificationFromOther', 'consumedCount', 'cancelable', 'isEternal',
    'isFromHostile', 'isQuestInitial', 'linkedTrialId', 'discriminationKey',
    'extensionId', 'statsBattleId', 'originMemberIndex', 'shouldCountForMission', 'blinkFrameCount')
RESERVED_FIELDS = ('result', 'statsBattleId', 'shouldCountForMission', 'linkedTrialId',
                   'isMergedResult', 'createdByPrimaryBattle')


def cp(g, value, path=None, depth=None):
    return g.call('wfxFp21Copy', value, g.l(2), path or g.l(3), depth or g.n(0))


def build(g):
    e, l, n, s = g.e, g.l, g.n, g.s
    for name in ENUMS:
        ci, row = e.instance(g.cls(name))
        cases = []
        for trait in e.abc.classes[ci][1]:
            tag = e.abc.mn_name(trait.name).split('::')[-1]
            if tag.startswith('__'):
                continue
            if trait.data[0] == 'method':
                method = e.abc.methods[trait.data[2]]
                if method[0] == row[0]:
                    cases.append((tag, [e.abc.mn_name(x) for x in method[1]]))
            elif trait.data[0] == 'slot' and trait.data[2] == row[0]:
                cases.append((tag, []))
        if not cases:
            raise ValueError('no audited enum signatures: ' + name)
        g.audit.append({'enum21': g.cls(name), 'factorySignatures': cases})
        c = START + g.raw(l(1), 'params') + [('setlocal', 5)]
        for i, (tag, types) in enumerate(cases):
            c += g.raw(l(1), 'tag') + s(tag) + [('ifne', 'NEXT' + str(i))]
            items = [s(tag), g.raw(l(1), 'index')]
            for j, typ in enumerate(types):
                value = g.at(l(5), n(j))
                if typ == 'Number':
                    value = g.f64(value)
                elif typ not in ('int', 'uint', 'Boolean', 'String'):
                    value = cp(g, value, g.add(l(3), s('/' + str(j))), l(4) + n(1) + [('add_i',)])
                items.append(value)
            c += g.arr(items) + [('returnvalue',), ('label', 'NEXT' + str(i))]
        c += g.unsupported(l(2), l(3), 'enum21_variant') + NULL + [('returnvalue',)]
        g.method('Battle', 'wfxFp21Enum' + name, '*', ['*', 'Array', 'String', 'int'], c, 6)

    c = START + l(1) + NULL + [('ifne', 'VALUE')] + NULL + [('returnvalue',), ('label', 'VALUE')]
    c += l(4) + n(64) + [('ifgt', 'BAD')]
    for typ in ('String', 'Boolean', 'int', 'uint'):
        c += l(1) + [('istype', e.q(typ)), ('iffalse', 'NOT' + typ)] + l(1)
        c += [('returnvalue',), ('label', 'NOT' + typ)]
    c += l(1) + [('istype', e.q('Number')), ('iffalse', 'NOTNUMBER')]
    c += g.f64(l(1)) + [('returnvalue',), ('label', 'NOTNUMBER')]
    c += l(1) + [('istype', e.q('Array')), ('iffalse', 'NOTARRAY')]
    c += g.arr([]) + [('setlocal', 5)] + n(0) + [('setlocal', 6), ('label', 'ARRAYLOOP')]
    c += l(6) + g.raw(l(1), 'length') + [('ifge', 'ARRAYDONE')]
    c += g.push(l(5), cp(g, g.at(l(1), l(6)), g.add(l(3), s('/'), l(6)), l(4) + n(1) + [('add_i',)]))
    c += [('inclocal_i', 6), ('jump', 'ARRAYLOOP'), ('label', 'ARRAYDONE')] + l(5) + [('returnvalue',), ('label', 'NOTARRAY')]
    for name in ENUMS:
        c += l(1) + [('istype', e.q(g.cls(name))), ('iffalse', 'NOT' + name)]
        c += g.call('wfxFp21Enum' + name, l(1), l(2), l(3), l(4)) + [('returnvalue',), ('label', 'NOT' + name)]
    for name in ('EnemyAddress', 'EnemyStateAddress', 'ZoneAddress'):
        c += l(1) + [('istype', e.q(g.cls(name))), ('iffalse', 'NOT' + name)]
        c += g.enum(l(1), l(2), l(3)) + [('returnvalue',), ('label', 'NOT' + name)]
    c += l(1) + [('istype', e.q(g.cls('AdditionalDirectAttackContent'))), ('iffalse', 'NOTDIRECT')]
    c += g.arr([g.p(l(1), 'AdditionalDirectAttackContent', 'directAttackTimes'),
                g.f64(g.p(l(1), 'AdditionalDirectAttackContent', 'directAttackDamage'))])
    c += [('returnvalue',), ('label', 'NOTDIRECT')]
    c += l(1) + [('istype', e.q(g.cls(RESULT))), ('iffalse', 'BAD')]
    _, row = e.instance(g.cls(RESULT))
    fields = [e.abc.mn_name(t.name).split('::')[-1] for t in row[6] if t.data[0] == 'slot']
    g.audit.append({'result21Fields': fields})
    c += g.arr([cp(g, g.p(l(1), RESULT, name), g.add(l(3), s('/' + name)), l(4) + n(1) + [('add_i',)]) for name in fields])
    c += [('returnvalue',), ('label', 'BAD')]
    c += g.unsupported(l(2), l(3), 'copy21_type_or_depth') + NULL + [('returnvalue',)]
    g.method('Battle', 'wfxFp21Copy', '*', ['*', 'Array', 'String', 'int'], c, 7)

    c = START + g.arr([cp(g, g.p(l(1), CONDITION, name), g.add(l(3), s('/' + name))) for name in CONDITION_FIELDS])
    c += [('returnvalue',)]
    g.method('Battle', 'wfxFp21Condition', 'Array', ['*', 'Array', 'String'], c, 4)
