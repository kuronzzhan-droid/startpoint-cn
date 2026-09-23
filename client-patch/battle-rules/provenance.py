"""从原生能力地址追溯加槽来源，异步能力技能保存独立上下文快照。"""
from core import MEMBER, ADDRESS, asm
from gauge import CONTEXT
from content import param

FIELDS = ('wfGainKind', 'wfGainCategory', 'wfGainOwner', 'wfGainTrigger')


def from_address(e):
    code = [('getlocal_0',), ('pushscope',)]
    for field in FIELDS:
        code += [e.string(field), ('getlocal_1',), ('getproperty', e.newq(field))]
    return code + [('newobject', 4), ('returnvalue',)]


def init_address(e):
    q = e.q
    code = []
    for field, value in zip(FIELDS, (8, 0, -1, -1)):
        e.add_slot(ADDRESS, field, 'int')
        code += [('getlocal_0',), e.number(value), ('setproperty', e.newq(field))]
    code += [('getlocal_2',), ('pushbyte', 0), ('ifne', 'NOT_INITIAL'),
             ('getlocal_0',), ('pushbyte', 1), ('setproperty', e.newq('wfGainKind')),
             ('label', 'NOT_INITIAL'), ('getlocal_2',), ('pushbyte', 3), ('ifne', 'END')]
    for field in FIELDS:
        code += [('getlocal_0',), ('getlocal_3',), ('pushbyte', 0), ('getproperty', 14),
                 ('getproperty', e.newq(field)), ('setproperty', e.newq(field))]
    code += [('label', 'END')]
    e.insert('InstantAbilityAddress/<ctor>', 11, code)
    # InstantBattleAbility.trigger: Combo(4), BallFlipWithCombo(6), CharacterCount(2).
    code = [('getlocal_3',), ('getproperty', q('trigger')), ('getproperty', q('index')),
            ('pushbyte', 4), ('ifeq', 'COMBO'), ('getlocal_3',), ('getproperty', q('trigger')),
            ('getproperty', q('index')), ('pushbyte', 6), ('ifeq', 'COMBO'),
            ('getlocal_3',), ('getproperty', q('trigger')), ('getproperty', q('index')),
            ('pushbyte', 2), ('ifne', 'END'), ('getlocal_3',), ('getproperty', q('trigger')),
            ('getproperty', q('params')), ('pushbyte', 1), ('getproperty', 14),
            ('pushbyte', 4), ('ifne', 'END'), ('getlocal_1',), ('pushbyte', 40),
            ('setproperty', e.newq('wfGainKind')), ('jump', 'END'), ('label', 'COMBO'),
            ('getlocal_1',), ('pushbyte', 24), ('setproperty', e.newq('wfGainKind')), ('label', 'END')]
    e.insert('InstantAbility/<ctor>', 53, code)


def stamp_source(e):
    """applyInstant 的 param4=完整能力来源编号，param6=触发角色。"""
    q = e.q
    code = [('getlocal_3',), e.number(256), ('setproperty', e.newq('wfGainCategory'))]
    for number, flag in ((21, 512), (31, 2048), (41, 1024), (51, 4096)):
        code += [('getlocal', 4), e.number(1000), ('divide',), ('convert_i',),
                 e.number(1000), ('modulo',), e.number(number), ('ifne', f'NEXT{number}'),
                 ('getlocal_3',), e.number(flag), ('setproperty', e.newq('wfGainCategory')),
                 ('label', f'NEXT{number}')]
    code += [('getlocal_3',), e.number(-1), ('setproperty', e.newq('wfGainOwner')),
             ('getlocal_3',), e.number(-1), ('setproperty', e.newq('wfGainTrigger'))]
    for field, loader in (('wfGainOwner', [('getlocal_0',), ('getproperty', q('member'))]),
                          ('wfGainTrigger', [('getlocal', 6)])):
        code += loader + [('astype', q(MEMBER)), ('setlocal', 39), ('getlocal', 39),
                 ('iffalse', f'UNKNOWN{field}'), ('getlocal_3',), ('getlocal', 39),
                 ('getproperty', q('originMemberIndex')), ('setproperty', e.newq(field)),
                 ('label', f'UNKNOWN{field}')]
    e.insert('AbilitySlotImpl/applyInstant', 2, code)


def push_context(e, local, load):
    q, context = e.q, e.newq(CONTEXT)
    return [('getlex', q(MEMBER)), ('getproperty', context), ('setlocal', local),
            ('getlex', q(MEMBER))] + load + [('setproperty', context)]


def pop_context(e, local):
    return [('getlex', e.q(MEMBER)), ('getlocal', local), ('setproperty', e.newq(CONTEXT))]


def opening_context(e):
    return [e.string('wfGainKind'), e.number(1), e.string('wfGainCategory'), e.number(0),
            e.string('wfGainOwner'), ('getlocal_0',), ('getproperty', e.q('originMemberIndex')),
            e.string('wfGainTrigger'), e.number(-1), ('newobject', 4)]


def action_context_body(e):
    """ActionEvaluator -> Object。629 优先取创建时快照，不读取后续被复用的地址。"""
    q = e.q
    code = [('getlocal_0',), ('pushscope',), ('getlocal_1',), ('callproperty', q('get_context'), 0),
            ('setlocal_2',), ('getlocal_2',), ('getproperty', e.newq('wfGainSnapshot')),
            ('setlocal_3',), ('getlocal_3',), ('iffalse', 'MAKE'), ('getlocal_3',), ('returnvalue',),
            ('label', 'MAKE'), ('pushbyte', 64), ('setlocal', 4),
            ('getlocal_2',), ('getproperty', q('kind')), ('getproperty', q('index')),
            ('setlocal', 7)]
    for action_kind, gain_kind in ((1, 4), (7, 4), (4, 8)):
        code += [('getlocal', 7), ('pushbyte', action_kind), ('ifne', f'NEXT{action_kind}'),
                 ('pushbyte', gain_kind), ('setlocal', 4), ('label', f'NEXT{action_kind}')]
    code += [
            e.number(-1), ('setlocal', 5), ('getlocal_1',), ('callproperty', q('get_executor'), 0),
            ('astype', q(MEMBER)), ('setlocal', 6), ('getlocal', 6), ('iffalse', 'UNKNOWN'),
            ('getlocal', 6), ('getproperty', q('originMemberIndex')), ('convert_i',), ('setlocal', 5),
            ('label', 'UNKNOWN'), e.string('wfGainKind'), ('getlocal', 4),
            e.string('wfGainCategory'), e.number(256), e.string('wfGainOwner'), ('getlocal', 5),
            e.string('wfGainTrigger'), ('getlocal', 5), ('newobject', 4), ('returnvalue',)]
    return code


def install(e):
    q = e.q
    init_address(e)
    stamp_source(e)
    from_mn = e.add_method(MEMBER, 'wfGaugeFromAddress', 'Object', [ADDRESS], from_address(e), 2, True)
    action_mn = e.add_method(MEMBER, 'wfGaugeFromAction', 'Object',
                            ['pinball.scene.battle.battle.action::ActionEvaluator'], action_context_body(e), 8, True)
    # Scope only synchronous reserve calls, never the whole ability dispatch.
    load = [('getlex', q(MEMBER)), ('getlocal_2',), ('callproperty', from_mn, 1)]
    for at in (843, 865):
        e.insert('MemberImpl/applyInstantAbility', at, push_context(e, 37, load))
        e.insert('MemberImpl/applyInstantAbility', at+1, pop_context(e, 37))
    e.insert('MemberImpl/applyInstantAbility', 1380, [('dup',)] + load +
             [('setproperty', e.newq('wfGainSnapshot'))])
    e.insert('ActionEvaluator/evalCommand', 899, push_context(e, 190,
             [('getlex', q(MEMBER)), ('getlocal_0',), ('callproperty', action_mn, 1)]))
    e.insert('ActionEvaluator/evalCommand', 900, pop_context(e, 190))
    # Opening >100% reserves its overflow; preserve its opening provenance too.
    e.insert('MemberImpl/applyInitialSkillPointRatio', 21, push_context(e, 2, opening_context(e)))
    # The <=100% branch jumps to 22 without pushing a context; it must skip this pop.
    e.insert('MemberImpl/applyInitialSkillPointRatio', 22, pop_context(e, 2), incoming=asm.SKIP)
