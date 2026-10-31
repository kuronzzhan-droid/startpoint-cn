"""有CT配置才进入独立队列；无CT直接返回，执行第二版原指令。"""
from .values import MEMBER


def install(e, m, queue, value):
    q, x = e.q, m['x']
    # args rows, effective, overflow, maximum. Locals 5=max seconds,6=i,7=row,
    # 8=state,9=frame,10=kind,11=normalized row,12=amount,13=buckets,14=tier.
    code = [('getlocal_0',), ('pushscope',), e.number(0), ('setlocal', 5),
            e.number(0), ('setlocal', 6), ('jump', 'CT_CHECK'),
            ('label', 'CT_LOOP'), ('avm_label',), ('getlex', q('Math')),
            ('getlocal', 5), ('getlex', q('Math')), ('getlocal_1',),
            ('getlocal', 6), ('getproperty', x), e.number(0), ('getproperty', x),
            e.number(1000), ('divide',), ('callproperty', q('floor'), 1),
            ('callproperty', q('max'), 2), ('setlocal', 5), ('inclocal_i', 6),
            ('label', 'CT_CHECK'), ('getlocal', 6), ('getlocal_1',),
            ('getproperty', q('length')), ('iflt', 'CT_LOOP'), ('getlocal', 5),
            e.number(0), ('ifgt', 'HAS_CT'), ('pushfalse',), ('returnvalue',),
            ('label', 'HAS_CT'), ('getlex', q(MEMBER)), ('getlocal_0',),
            ('callproperty', queue, 1), ('setlocal', 8), ('getlocal_0',),
            ('getproperty', q('squadManager')), ('getproperty', q('currentFrame')),
            ('setlocal', 9), ('getlocal', 9), ('getlocal', 8), e.number(2),
            ('getproperty', x), ('iflt', 'DONE'), ('getlex', q('Math')),
            e.number(30), ('getlocal', 5), e.number(60), ('multiply',),
            ('callproperty', q('max'), 2), ('setlocal', 5), e.number(0),
            ('setlocal', 6), ('jump', 'CHECK'), ('label', 'LOOP'), ('avm_label',),
            ('getlocal_1',), ('getlocal', 6), ('getproperty', x), ('setlocal', 7),
            ('getlocal_0',), ('getlocal', 7), e.number(0), ('getproperty', x),
            e.number(10), ('modulo',), ('callproperty', q('wfxHealDamageKind'), 1),
            ('setlocal', 10), ('getlocal', 10), ('iffalse', 'NEXT'),
            # Keep the second-edition value helper (also used by Fever) byte exact.
            ('getlocal', 7), e.number(0), ('getproperty', x), e.number(1000),
            ('modulo',)]
    for index in (1, 2, 3):
        code += [('getlocal', 7), e.number(index), ('getproperty', x)]
    code += [('newarray', 4), ('setlocal', 11), ('getlex', q('Math')),
             ('getlocal', 11), e.number(0), ('getproperty', x), e.number(10),
             ('divide',), ('callproperty', q('floor'), 1), ('setlocal', 14),
             ('getlocal', 14), e.number(0), ('ifngt', 'QUALIFIED'),
             ('getlocal_2',), e.number(100), ('multiply',), ('getlocal', 4),
             ('getlocal', 14), ('multiply',), ('ifge', 'QUALIFIED'),
             ('getlocal_3',), e.number(100), ('multiply',), ('getlocal', 4),
             ('getlocal', 14), ('multiply',), ('iflt', 'NEXT'),
             ('label', 'QUALIFIED'), ('getlocal', 8), e.number(1),
             ('getproperty', x), e.number(0), ('ifge', 'OPEN'),
             ('getlocal', 8), e.number(1), ('getlocal', 9), e.number(30),
             ('add',), ('setproperty', x), ('getlocal', 8), e.number(3),
             e.number(0), ('setproperty', x), ('label', 'OPEN'),
             ('getlocal', 8), e.number(3), ('getlex', q('Math')),
             ('getlocal', 5), ('getlocal', 8), e.number(3), ('getproperty', x),
             ('callproperty', q('max'), 2), ('setproperty', x), ('getlocal_0',),
             ('getlocal', 11), ('getlocal_2',), ('getlocal_3',), ('getlocal', 4),
             ('callproperty', value, 4), e.number(10000), ('divide',),
             ('setlocal', 12), ('getlocal', 8), e.number(4), ('getproperty', x),
             ('setlocal', 13), ('getlocal', 13), ('getlocal', 10),
             ('getlocal', 13), ('getlocal', 10), ('getproperty', x),
             ('getlocal', 12), ('add',), ('setproperty', x),
             ('label', 'NEXT'), ('inclocal_i', 6), ('label', 'CHECK'),
             ('getlocal', 6), ('getlocal_1',), ('getproperty', q('length')),
             ('iflt', 'LOOP'), ('label', 'DONE'), ('pushtrue',), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxHealAnyCTRecord', 'Boolean',
                        ['Array', 'Number', 'Number', 'Number'], code, 15)
