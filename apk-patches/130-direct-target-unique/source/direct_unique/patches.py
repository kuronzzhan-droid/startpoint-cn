"""码28/29：指令拼接原助手；目标层数复用原生接口。"""
import asm
from perf2_core import splice_with_exits

MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
KIND = 'pinball.common.data.character.condition::ConditionTargetKind'
ENEMY = 'pinball.scene.battle.battle.enemy::Enemy'
FACTOR = 'MemberImpl/wfxDirectFactor'
SPEC = 'ConditionSlot$/wfxSpec'


def row_loop(e, array_local, reach):
    """row=[U,value*持有层数,flags,持有层数,value]；逐行应用门槛/封顶。"""
    q = e.q
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    suffix = 'R' if reach else 'L'
    loop, check, next_, add, ready = (name + suffix for name in ('LOOP', 'CHECK', 'NEXT', 'ADD', 'READY'))
    code = [e.number(0), ('setlocal', 7), ('jump', check),
            ('label', loop), ('avm_label',),
            ('getlocal', array_local), ('getlocal', 7), ('getproperty', x), ('setlocal', 6),
            ('getlocal', 4), ('getlex', q(KIND)),
            ('getlocal', 6), e.number(0), ('getproperty', x), ('convert_i',),
            ('callproperty', q('Unique'), 1),
            ('callproperty', q('getConditionAccumulationCount'), 1), ('convert_i',), ('setlocal', 8),
            ('getlocal', 6), e.number(2), ('getproperty', x), ('convert_i',), ('setlocal', 9)]
    if reach:
        code += [('getlocal', 9), e.number(0), ('ifgt', ready),
                 e.number(1), ('setlocal', 9), ('label', ready),
                 ('getlocal', 8), ('getlocal', 9), ('iflt', next_),
                 ('getlocal', 5), ('getlocal', 6), e.number(1), ('getproperty', x),
                 ('add',), ('setlocal', 5)]
    else:
        code += [('getlocal', 9), e.number(0), ('ifle', add),
                 ('getlocal', 9), ('getlocal', 8), ('ifge', add),
                 ('getlocal', 9), ('setlocal', 8), ('label', add),
                 ('getlocal', 5), ('getlocal', 6), e.number(1), ('getproperty', x),
                 ('getlocal', 8), ('multiply',), ('add',), ('setlocal', 5)]
    code += [('label', next_), ('inclocal_i', 7), ('label', check),
             ('getlocal', 7), ('getlocal', array_local), ('getproperty', q('length')), ('iflt', loop)]
    return code


def install_helper(e):
    q = e.q
    code = [('getlocal_0',), ('pushscope',)]
    for number, local in ((28, 2), (29, 3)):
        code += [('getlocal_0',), ('getproperty', q('conditionSlot')), e.number(number),
                 ('pushtrue',), ('callproperty', q('wfxRows'), 2), ('setlocal', local)]
    # 持有者没有两码时，只检查rows长度，不解引用target及其parent。
    code += [('getlocal_2',), ('getproperty', q('length')),
             ('getlocal_3',), ('getproperty', q('length')), ('add',), ('iffalse', 'ZERO'),
             ('getlocal_1',), ('iffalse', 'ZERO'),
             ('getlocal_1',), ('getproperty', q('parent')), ('coerce', q(ENEMY)), ('setlocal', 4),
             ('getlocal', 4), ('iffalse', 'ZERO'), e.number(0), ('setlocal', 5)]
    code += row_loop(e, 2, True) + row_loop(e, 3, False)
    code += [('getlocal', 5), ('returnvalue',), ('label', 'ZERO'), e.number(0), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxDirectTargetUnique', 'Number', ['*'], code, 10)


def extend_spec(e):
    """只绕过28/29的flags负号检查；仍执行空值、整数、int32校验。"""
    body = e.body(SPEC)
    ins = asm.decode(body[5])
    assert len(ins) == 160
    assert [i.name for i in ins[127:138]] == [
        'getlocal', 'getlocal', 'convert_i', 'ifne', 'getlocal', 'pushbyte',
        'iflt', 'getlocal', 'pushbyte', 'getproperty', 'convert_i']
    assert ins[131].args == [8] and ins[133].target == 152
    x = ins[136].args[0]
    code = []
    for effect in (28, 29):
        code += [('getlocal', 6), e.number(1), ('getproperty', x), ('convert_i',),
                 e.number(effect), ('ifeq', 'FLAGS_VALID')]
    raw, exc, _, _ = splice_with_exits(body, 131, code, {'FLAGS_VALID': 134}, asm.ENTER)
    e.replace(SPEC, raw, exc)


def extend_factor(e, helper):
    body = e.body(FACTOR)
    ins = asm.decode(body[5])
    assert len(ins) == 140
    assert [i.name for i in ins[8:13]] == ['getlocal_2', 'getproperty', 'iftrue', 'pushbyte', 'returnvalue']
    assert [i.name for i in ins[114:119]] == ['pushbyte', 'getlocal', 'pushint', 'divide', 'add']
    # 原码24查完后读取新贡献；零贡献继续原指令，避免旧浮点运算顺序变化。
    e.insert(FACTOR, 8, [('getlocal_0',), ('getlocal_1',),
                         ('callproperty', helper, 1), ('setlocal', 12)])
    # 原来无码24就return1。仅有28/29时，仍须算第一括号且钳到>=0。
    e.insert(FACTOR, 11, [
        ('getlocal', 12), e.number(0), ('ifeq', 'OLD_ONE'),
        e.number(1), ('getlocal', 12), e.number(10000), ('divide',), ('add',),
        ('dup',), e.number(0), ('ifge', 'RETURN'), ('pop',), e.number(0),
        ('label', 'RETURN'), ('returnvalue',), ('label', 'OLD_ONE'),
    ])
    # B24/D2/D3完成后、第一括号除10000之前插入，不改连击与最终钳位。
    e.insert(FACTOR, 114, [
        ('getlocal', 12), e.number(0), ('ifeq', 'OLD_BASE'),
        ('getlocal', 8), ('getlocal', 12), ('add',), ('setlocal', 8), ('label', 'OLD_BASE'),
    ])


def build(e):
    helper = install_helper(e)
    extend_spec(e)
    extend_factor(e, helper)
    return {'capability': 'direct-base-v1', 'effect_codes': [28, 29]}
