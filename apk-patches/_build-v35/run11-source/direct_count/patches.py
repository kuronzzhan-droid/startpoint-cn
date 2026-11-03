"""码33：只拼接原生最终次数；保留原生选优、调度和合并路径。"""
import hashlib

import asm

MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
ENEMY = 'pinball.scene.battle.battle.enemy::Enemy'
SCHEDULE = 'MemberImpl/scheduleDirectAttack'
SPEC = 'ConditionSlot$/wfxSpec'
HELPER = 'MemberImpl/wfxDirectTargetCount'
TARGETS = [SCHEDULE, SPEC]
ADDED = [HELPER]
LOCKS = {
    SCHEDULE: {'sha': '7f0d02acfc116523f829a639e717fea6e53ce30b61c0f40085082c4b0caf1e07',
               'header': [110, 45, 1, 2]},
    SPEC: {'sha': '91ca69969bd16ae753041acdb6982603f6c3dc685c2145bd8cf96c33e369dd12',
           'header': [5, 9, 1, 2]},
}


def install_helper(e):
    q = e.q
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    # rows=[base, per*layers, cap, layers, per]; locals rows2,kMinus1=3,i4,row5,n6,cap7,sum8.
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('getproperty', q('conditionSlot')), e.number(33), ('pushtrue',),
            ('callproperty', q('wfxRows'), 2), ('setlocal_2',),
            ('getlocal_2',), ('getproperty', q('length')), ('iffalse', 'ZERO'),
            ('getlocal_1',), ('iffalse', 'ZERO'),
            ('getlocal_1',), ('getproperty', q('parent')), ('coerce', q(ENEMY)), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'ZERO'),
            ('getlocal', 5),
            ('callproperty', q('pinball.online.battle.impact:ImpactTarget::getTotalDebuffCounts'), 0),
            ('convert_i',), ('setlocal_3',),
            ('getlocal_3',), e.number(1), ('iflt', 'ZERO'),
            ('getlocal_3',), e.number(1), ('subtract',), ('setlocal_3',),
            e.number(0), ('setlocal', 4), e.number(0), ('setlocal', 8), ('jump', 'CHECK'),
            ('label', 'LOOP'), ('avm_label',),
            ('getlocal_2',), ('getlocal', 4), ('getproperty', x), ('setlocal', 5),
            ('getlocal_3',), ('setlocal', 6),
            ('getlocal', 5), e.number(2), ('getproperty', x), ('setlocal', 7),
            ('getlocal', 7), e.number(0), ('ifle', 'ADD'),
            ('getlocal', 7), ('getlocal', 6), ('ifge', 'ADD'),
            ('getlocal', 7), ('setlocal', 6),
            ('label', 'ADD'),
            ('getlocal', 8),
            ('getlocal', 5), e.number(0), ('getproperty', x),
            ('getlocal', 5), e.number(3), ('getproperty', x), ('multiply',),
            ('getlocal', 5), e.number(1), ('getproperty', x),
            ('getlocal', 6), ('multiply',), ('add',), ('add',), ('setlocal', 8),
            ('inclocal_i', 4),
            ('label', 'CHECK'), ('getlocal', 4), ('getlocal_2',),
            ('getproperty', q('length')), ('iflt', 'LOOP'),
            ('getlocal', 8), e.number(0), ('iflt', 'ZERO'),
            ('getlocal', 8), ('returnvalue',),
            ('label', 'ZERO'), e.number(0), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxDirectTargetCount', 'Number', ['*'], code, 9)


def extend_parser(e):
    """仅33允许负base/cap；整数/int32/空字段检查和其它码全部保留。"""
    body = e.body(SPEC)
    ins = asm.decode(body[5])
    assert len(ins) == 172
    x = ins[93].args[0]
    assert ins[93].name == 'getproperty'
    for at, field in ((102, 'BASE'), (145, 'CAP')):
        assert ins[at].name == 'iflt' and ins[at].target == 164
        assert ins[at-2].name == 'getlocal' and ins[at-2].args == [8]
        # 在原来的负号比较前只替换比较用栈值；原始数字local8和后续字段原封不动。
        e.insert(SPEC, at, [
            ('getlocal', 6), e.number(1), ('getproperty', x), ('convert_i',),
            e.number(33), ('ifne', 'KEEP_' + field),
            ('pop',), ('pop',), e.number(0), e.number(0), ('label', 'KEEP_' + field),
        ])


def build(e):
    for label in TARGETS:
        body = e.body(label)
        if hashlib.sha256(body[5]).hexdigest() != LOCKS[label]['sha'] or body[1:5] != LOCKS[label]['header']:
            raise asm.AsmError('direct-count unknown v35j SHA/header: ' + label)
    helper = install_helper(e)
    extend_parser(e)
    q = e.q
    ins = asm.decode(e.body(SCHEDULE)[5])
    assert ins[149].name == 'pushbyte' and ins[149].args == [1]
    assert [v.name for v in ins[145:149]] == ['getlocal', 'getproperty', 'convert_d', 'setlocal']
    assert ins[148].args == [6]
    # 原生来源已经选优。无码33/零贡献时不改变任何旧次数、统计或算术。
    e.insert(SCHEDULE, 149, [
        ('getlocal_0',), ('getlocal_2',), ('callproperty', helper, 1), ('setlocal', 45),
        ('getlocal', 45), ('iffalse', 'UNCHANGED'),
        ('getlocal', 5), ('getlocal', 45), ('add',), ('convert_i',), ('setlocal', 5),
        ('getlocal_0',), ('getproperty', q('stats')), ('getproperty', q('maxAdditionalDirectAttackTimes')),
        ('getlocal', 5), ('ifnlt', 'UNCHANGED'),
        ('getlocal_0',), ('getproperty', q('stats')), ('getlocal', 5),
        ('setproperty', q('maxAdditionalDirectAttackTimes')), ('label', 'UNCHANGED'),
    ])
    return {'capability': 'direct-count-target-debuff-v1', 'effect_codes': [33],
            'targets': TARGETS, 'added': ADDED,
            'native_rule': 'getBetter保留原生次数优先、同次数伤害优先；随后码33额外次数相加',
            'clamp': '逐状态独立cap后求和；最终额外次数max(0,sum)；k<1为0'}
