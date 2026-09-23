"""普通攻击对象的伤害分类转换，覆盖接触直击、DSL 技能/PF、能力弹。"""
from core import MEMBER, TOTALIZER

KINDS = {1: 'skill', 2: 'ability', 4: 'direct', 31: 'pf1', 32: 'pf2', 33: 'pf3'}
FLAGS = ('createdByDirectAttack', 'createdByPowerFlipAction',
         'createdByMainSkillAction', 'createdByUnisonSkillAction',
         'createdByAbility', 'createdByUnisonAbility', 'createdBySkillInvoker')


def conversion_body(e):
    """Object -> Object。DSL 101/102/104/131..133 优先，否则查询角色规则。"""
    q = e.q
    code = [('getlocal_0',), ('pushscope',), ('getlocal_1',),
            ('getproperty', q('buffTargetAs')), ('convert_i',), ('pushbyte', 100),
            ('subtract_i',), ('setlocal_2',)]
    for k in KINDS:
        code += [('getlocal_2',), e.number(k), ('ifeq', 'APPLY')]
    code += [('getlocal_1',), ('getproperty', q('attacker')), ('astype', q(MEMBER)),
             ('setlocal_3',), ('getlocal_3',), ('iffalse', 'END'),
             ('pushbyte', 0), ('setlocal', 4)]
    # Skill flags are exclusive after conversion; native objects need ordered discovery.
    for flag, kind in [('createdByDirectAttack', 4), ('createdByPowerFlipAction', 3),
                       ('createdByAbility', 2), ('createdByMainSkillAction', 1),
                       ('createdByUnisonSkillAction', 1)]:
        code += [('getlocal_1',), ('getproperty', q(flag)), ('iffalse', flag),
                 e.number(kind), ('setlocal', 4), ('jump', 'RESOLVE'), ('label', flag)]
    code += [('jump', 'END'), ('label', 'RESOLVE'), ('getlocal_3',),
             ('getproperty', q('abilityTotalizer')), ('getlocal', 4),
             ('callproperty', e.newq('wfResolveDamageType'), 1), ('convert_i',),
             ('setlocal_2',)]
    for k in KINDS:
        code += [('getlocal_2',), e.number(k), ('ifeq', 'APPLY')]
    code += [('jump', 'END'), ('label', 'APPLY')]
    for flag in FLAGS:
        code += [('getlocal_1',), ('pushfalse',), ('setproperty', q(flag))]
    for prop in ('buffTargetAs', 'powerFlipChargeLv'):
        code += [('getlocal_1',), ('pushbyte', 0), ('setproperty', q(prop))]
    for k in KINDS:
        code += [('getlocal_2',), e.number(k), ('ifne', f'NEXT{k}')]
        if k == 1:
            # Missing/null origin (native contact attack) means main member.
            code += [('getlocal_1',), ('getproperty', q('originMemberKind')),
                     ('pushbyte', 1), ('ifeq', 'UNISON'), ('getlocal_1',),
                     ('pushtrue',), ('setproperty', q('createdByMainSkillAction')),
                     ('jump', 'END'), ('label', 'UNISON'), ('getlocal_1',),
                     ('pushtrue',), ('setproperty', q('createdByUnisonSkillAction'))]
        else:
            flag = 'createdByAbility' if k == 2 else ('createdByDirectAttack' if k == 4 else 'createdByPowerFlipAction')
            code += [('getlocal_1',), ('pushtrue',), ('setproperty', q(flag))]
            if k == 2:
                code += [('getlocal_1',), ('getlocal_1',), ('getproperty', q('originMemberKind')),
                         ('pushbyte', 1), ('strictequals',), ('setproperty', q('createdByUnisonAbility'))]
            if k >= 31:
                code += [('getlocal_1',), e.number(k-30), ('setproperty', q('powerFlipChargeLv'))]
        code += [('jump', 'END'), ('label', f'NEXT{k}')]
    code += [('label', 'END'), ('getlocal_1',), ('returnvalue',)]
    # abcasm reserves END for the end of a block, not a return epilogue.
    return [tuple('RETURN' if value == 'END' else value for value in row) for row in code]


def resolver_body(e):
    """首个匹配的活动规则；source*100+target。只做一次映射，防止循环转换。"""
    q, slot = e.q, e.newq('wfDamageRules')
    code = [('getlocal_0',), ('pushscope',), ('getlocal_0',), ('getproperty', slot),
            ('setlocal_2',), ('getlocal_2',), ('iffalse', 'NONE'), ('pushbyte', 0), ('setlocal_3',),
            ('label', 'LOOP'), ('avm_label',), ('getlocal_3',), ('getlocal_2',), ('getproperty', q('length')),
            ('ifge', 'NONE'), ('getlocal_2',), ('getlocal_3',), ('getproperty', 14),
            ('coerce', q('pinball.scene.battle.battle.ability::DuringCheckerWithDecimal')),
            ('setlocal', 4), ('inclocal_i', 3), ('getlocal', 4), ('pushnull',),
            ('callproperty', q('getActiveCount'), 1), ('pushbyte', 0), ('ifle', 'LOOP'),
            ('getlocal', 4), ('getproperty', q('value')), ('convert_i',), ('setlocal', 5),
            ('getlocal', 5), ('pushbyte', 100), ('divide',), ('convert_i',), ('setlocal', 6),
            ('getlocal', 6), ('pushbyte', 0), ('ifeq', 'MATCH'), ('getlocal', 6),
            ('getlocal_1',), ('ifne', 'LOOP'), ('label', 'MATCH'), ('getlocal', 5),
            ('pushbyte', 100), ('modulo',), ('convert_i',), ('returnvalue',),
            ('label', 'NONE'), ('pushbyte', 0), ('returnvalue',)]
    return code


def install(e):
    e.add_method(TOTALIZER, 'wfResolveDamageType', 'int', ['int'], resolver_body(e), 7)
    mn = e.add_method(MEMBER, 'wfConvertNormalAttack', 'Object', ['Object'], conversion_body(e), 5, True)
    e.insert('ImpactSourceContent$/NormalAttack', 0,
             [('getlex', e.q(MEMBER)), ('getlocal_1',), ('callproperty', mn, 1),
              ('coerce', e.q('Object')), ('setlocal_1',)])
