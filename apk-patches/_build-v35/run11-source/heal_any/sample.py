"""接在applyHeal既有采样点；以受治疗者本端队伍查找持有者。"""
from .values import MEMBER


def holders(e, m):
    q, x = e.q, m['x']
    code = [('getlocal_0',), ('pushscope',), ('newarray', 0), ('setlocal_1',),
            ('getlocal_0',), ('getproperty', q('squadManager')),
            ('getproperty', q('primary')), ('setlocal_2',),
            ('getlocal_2',), ('getlocal_0',), ('getproperty', q('squad')),
            ('ifstrictne', 'DONE'), ('getlocal_2',), ('getproperty', q('members')),
            ('setlocal_2',), e.number(0), ('setlocal_3',), ('pushfalse',), ('setlocal', 5),
            ('jump', 'CHECK'), ('label', 'LOOP'), ('avm_label',),
            ('getlocal_2',), ('getlocal_3',), ('getproperty', x), ('setlocal', 4),
            ('getlocal', 4), ('iffalse', 'NEXT'), ('getlocal', 4),
            ('getproperty', q('index')), ('iftrue', 'NEXT'), ('getlocal', 4),
            ('getproperty', q('params')), e.number(0), ('getproperty', x),
            ('setlocal', 4), ('getlocal', 4), ('iffalse', 'NEXT'),
            ('getlocal', 4), ('getlocal_0',), ('ifstrictne', 'OTHER'),
            ('pushtrue',), ('setlocal', 5), ('label', 'OTHER'),
            ('getlocal_1',), ('getlocal', 4), ('callproperty', m['indexof'], 1),
            e.number(0), ('ifge', 'NEXT'), ('getlocal_1',), ('getlocal', 4),
            ('callpropvoid', m['push'], 1), ('label', 'NEXT'), ('inclocal_i', 3),
            ('label', 'CHECK'), ('getlocal_3',), ('getlocal_2',),
            ('getproperty', q('length')), ('iflt', 'LOOP'), ('getlocal', 5),
            ('iftrue', 'DONE'), ('newarray', 0), ('setlocal_1',),
            ('label', 'DONE'), ('getlocal_1',), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxHealAnyMembers', 'Array', [], code, 6)


def install(e, m, members, damage, fever):
    q, x = e.q, m['x']
    code = [('getlocal_0',), ('pushscope',), e.number(0), ('setlocal', 6),
            ('getlocal_3',), e.number(0), ('ifngt', 'DONE'),
            ('getlocal', 5), e.number(0), ('ifngt', 'DONE'),
            ('getlocal_0',), ('getproperty', q('battle')),
            ('callproperty', q('__isMyBattle__'), 0), ('setlocal', 12),
            ('getlocal_2',), ('getproperty', q('isHealRejected')), ('iftrue', 'DONE'),
            ('getlocal_0',), ('callproperty', members, 0), ('setlocal', 7),
            ('getlocal_3',), ('getlocal', 4), ('subtract',), ('setlocal', 8),
            e.number(0), ('setlocal', 9), ('jump', 'CHECK'),
            ('label', 'LOOP'), ('avm_label',), ('getlocal', 7), ('getlocal', 9),
            ('getproperty', x), ('setlocal', 10)]
    for code_number, mask, helper in [(34, 1, damage), (35, 2, fever)]:
        suffix = str(code_number)
        code += [('getlocal', 10), ('getproperty', q('conditionSlot')), e.number(code_number),
                 ('pushtrue',), ('callproperty', q('wfxRows'), 2), ('setlocal', 11),
                 ('getlocal', 11), ('getproperty', q('length')), ('iffalse', 'SKIP' + suffix),
                 ('getlocal', 6), e.number(mask), ('bitor',), ('setlocal', 6),
                 ('getlocal', 12), ('iffalse', 'SKIP' + suffix),
                 ('getlocal', 10), ('getlocal', 11), ('getlocal', 4), ('getlocal', 8),
                 ('getlocal', 5), ('callpropvoid', helper, 4), ('label', 'SKIP' + suffix)]
    code += [('inclocal_i', 9), ('label', 'CHECK'), ('getlocal', 9), ('getlocal', 7),
             ('getproperty', q('length')), ('iflt', 'LOOP'), ('label', 'DONE'),
             ('getlocal', 6), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxHealAnySample', 'int',
                        ['*', '*', 'Number', 'Number', 'Number'], code, 13)
