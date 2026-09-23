"""入账前按来源筛选；已获准的排队加槽保留原生消费顺序。"""
from core import MEMBER, TOTALIZER

# 同组 OR、组间 AND。未设置的组不参与筛选；未知来源不冒充自身/队友。
GROUPS = (127, 7936, 49152, 196608)
CONTEXT = 'wfGaugeContext'


def filter_body(e):
    q, slot = e.q, e.newq('wfGaugeRules')
    code = [('getlocal_0',), ('pushscope',), ('getlocal_0',), ('getproperty', slot),
            ('setlocal_2',), ('getlocal_2',), ('iffalse', 'NO'), ('pushbyte', 0), ('setlocal_3',),
            ('label', 'LOOP'), ('getlocal_3',), ('getlocal_2',), ('getproperty', q('length')),
            ('ifge', 'NO'), ('getlocal_2',), ('getlocal_3',), ('getproperty', 14),
            ('coerce', q('pinball.scene.battle.battle.ability::DuringCheckerWithDecimal')),
            ('setlocal', 4), ('inclocal_i', 3), ('getlocal', 4), ('pushnull',),
            ('callproperty', q('getActiveCount'), 1), ('pushbyte', 0), ('ifle', 'LOOP'),
            ('getlocal', 4), ('getproperty', q('value')), ('convert_i',), ('setlocal', 5)]
    for mask in GROUPS:
        code += [('getlocal', 5), e.number(mask), ('bitand',), ('setlocal', 6),
                 ('getlocal', 6), ('iffalse', f'NEXT{mask}'), ('getlocal', 6),
                 ('getlocal_1',), ('bitand',), ('iffalse', 'LOOP'), ('label', f'NEXT{mask}')]
    # Invalid zero rules are no-ops, not accidental universal blockers.
    code += [('getlocal', 5), ('pushbyte', 127), ('bitand',), ('iffalse', 'LOOP'),
             ('pushtrue',), ('returnvalue',), ('label', 'NO'), ('pushfalse',), ('returnvalue',)]
    return code


def allows_body(e):
    q, context = e.q, e.newq(CONTEXT)
    code = [('getlocal_0',), ('pushscope',), ('getlocal_1',), ('setlocal_2',),
            ('getlocal_1',), ('pushbyte', 2), ('ifeq', 'CHECK'),
            ('getlocal_1',), ('pushbyte', 1), ('ifeq', 'CHECK'),
            ('getlex', q(MEMBER)), ('getproperty', context), ('setlocal_3',),
            ('getlocal_3',), ('iffalse', 'CHECK'), ('getlocal_3',), ('getproperty', e.newq('wfGainKind')),
            ('convert_i',), ('getlocal_3',), ('getproperty', e.newq('wfGainCategory')), ('convert_i',),
            ('bitor',), ('setlocal_2',)]
    for field, yes, no in (('wfGainOwner', 16384, 32768), ('wfGainTrigger', 65536, 131072)):
        code += [('getlocal_3',), ('getproperty', e.newq(field)), ('convert_i',), ('setlocal', 4),
                 ('getlocal', 4), ('pushbyte', 0), ('iflt', f'UNKNOWN{field}'),
                 ('getlocal', 4), ('getlocal_0',), ('getproperty', q('originMemberIndex')),
                 ('ifeq', f'SELF{field}'), ('getlocal_2',), e.number(no), ('bitor',),
                 ('setlocal_2',), ('jump', f'UNKNOWN{field}'), ('label', f'SELF{field}'),
                 ('getlocal_2',), e.number(yes), ('bitor',), ('setlocal_2',), ('label', f'UNKNOWN{field}')]
    code += [('label', 'CHECK'), ('getlocal_0',), ('getproperty', q('abilityTotalizer')),
             ('getlocal_2',), ('callproperty', e.newq('wfBlocksGauge'), 1), ('not',), ('returnvalue',)]
    return code


def guard(e, kind):
    return [('getlocal_1',), ('pushbyte', 0), ('ifle', 'PASS'), ('getlocal_0',),
            ('pushbyte', kind), ('callproperty', e.newq('wfAllowsGauge'), 1),
            ('iftrue', 'PASS'), ('returnvoid',), ('label', 'PASS')]


def install(e):
    e.add_slot(MEMBER, CONTEXT, 'Object', True)
    e.add_method(TOTALIZER, 'wfBlocksGauge', 'Boolean', ['int'], filter_body(e), 7)
    e.add_method(MEMBER, 'wfAllowsGauge', 'Boolean', ['int'], allows_body(e), 5)
    for method, kind in (('addSkillPoint', 4), ('reserveSkillPoint', 8),
                         ('reserveFixedSkillPoint', 8), ('applyInitialSkillPointRatio', 1)):
        e.insert('MemberImpl/' + method, 2, guard(e, kind))
    # Insert immediately after hasLaunched(): false skips the entire native recharge
    # block, including gauge/stat accounting, while movement and physics continue.
    import asm, bodies
    ins = asm.decode(e.abc.bodies[bodies.resolve(e.abc, 'MemberImpl/move')][5])
    matches = [i for i, x in enumerate(ins) if x.name == 'callproperty' and
               e.abc.mn_name(x.args[0]).endswith('::hasLaunched')]
    if len(matches) != 1:
        raise asm.AsmError('move hasLaunched boundary changed')
    e.insert('MemberImpl/move', matches[0]+1, [('getlocal_0',), ('pushbyte', 2),
             ('callproperty', e.newq('wfAllowsGauge'), 1), ('bitand',)])
