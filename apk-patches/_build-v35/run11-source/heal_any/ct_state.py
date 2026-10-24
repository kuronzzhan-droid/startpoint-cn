"""码34独立持有者窗口；与旧30帧尾量队列分离，仅消费逻辑帧。"""
from .values import MEMBER


def zeros(e):
    return [e.number(0)] * 5 + [('newarray', 5)]


def queue(e, m):
    q, x = e.q, m['x']
    battle = e.add_slot(MEMBER, 'wfxHealAnyCTBattle', 'Object', static=True)
    pending = e.add_slot(MEMBER, 'wfxHealAnyCTPending', 'Array', static=True)
    # [holder, due (-1 means idle), blocked_until, window_ct_frames, kind_buckets]
    code = [('getlocal_0',), ('pushscope',), ('getlocal_0',), ('getproperty', battle),
            ('getlocal_1',), ('getproperty', q('battle')), ('ifstricteq', 'READY'),
            ('getlocal_0',), ('getlocal_1',), ('getproperty', q('battle')),
            ('setproperty', battle), ('getlocal_0',), ('newarray', 0),
            ('setproperty', pending), ('label', 'READY'), ('getlocal_0',),
            ('getproperty', pending), ('setlocal_2',), e.number(0), ('setlocal_3',),
            ('jump', 'CHECK'), ('label', 'LOOP'), ('avm_label',), ('getlocal_2',),
            ('getlocal_3',), ('getproperty', x), ('setlocal', 4), ('getlocal', 4),
            e.number(0), ('getproperty', x), ('getlocal_1',), ('ifstricteq', 'RESULT'),
            ('inclocal_i', 3), ('label', 'CHECK'), ('getlocal_3',), ('getlocal_2',),
            ('getproperty', q('length')), ('iflt', 'LOOP'), ('getlocal_1',),
            e.number(-1), e.number(0), e.number(0), *zeros(e), ('newarray', 5),
            ('setlocal', 4), ('getlocal_2',), ('getlocal', 4),
            ('callpropvoid', m['push'], 1), ('label', 'RESULT'), ('getlocal', 4),
            ('returnvalue',)]
    helper = e.add_method(MEMBER, 'wfxHealAnyCTQueue', 'Array', ['*'], code, 5, static=True)
    return helper, battle, pending


def tick(e, m, battle, pending):
    q, x = e.q, m['x']
    code = [('getlocal_0',), ('pushscope',), ('getlocal_0',), ('getproperty', battle),
            ('getlocal_1',), ('getproperty', q('battle')), ('ifstrictne', 'DONE'),
            ('getlocal_0',), ('getproperty', pending), ('setlocal_2',),
            ('getlocal_2',), ('iffalse', 'DONE'), ('getlocal_1',),
            ('getproperty', q('currentFrame')), ('setlocal_3',), e.number(0),
            ('setlocal', 4), ('jump', 'CHECK'), ('label', 'LOOP'), ('avm_label',),
            ('getlocal_2',), ('getlocal', 4), ('getproperty', x), ('setlocal', 5),
            ('getlocal', 5), e.number(1), ('getproperty', x), e.number(0),
            ('iflt', 'NEXT'), ('getlocal_3',), ('getlocal', 5), e.number(1),
            ('getproperty', x), ('iflt', 'NEXT'), ('getlocal', 5), e.number(4),
            ('getproperty', x), ('setlocal', 6),
            # Detach the window before emitting; reentrant healing sees CT immediately.
            ('getlocal', 5), e.number(1), e.number(-1), ('setproperty', x),
            ('getlocal', 5), e.number(4), *zeros(e), ('setproperty', x),
            ('pushfalse',), ('setlocal', 9), e.number(1), ('setlocal', 7),
            ('jump', 'POS_CHECK'), ('label', 'POS_LOOP'), ('avm_label',),
            ('getlocal', 6), ('getlocal', 7), ('getproperty', x), e.number(0),
            ('ifngt', 'POS_NEXT'), ('pushtrue',), ('setlocal', 9),
            ('label', 'POS_NEXT'), ('inclocal_i', 7), ('label', 'POS_CHECK'),
            ('getlocal', 7), e.number(5), ('iflt', 'POS_LOOP'), ('getlocal', 9),
            ('iffalse', 'NEXT'), ('getlocal', 5), e.number(2), ('getlocal_3',),
            ('getlocal', 5), e.number(3), ('getproperty', x), ('add',),
            ('setproperty', x), e.number(1), ('setlocal', 7), ('jump', 'EMIT_CHECK'),
            ('label', 'EMIT_LOOP'), ('avm_label',), ('getlocal', 6), ('getlocal', 7),
            ('getproperty', x), ('setlocal', 8), ('getlocal', 8), e.number(0),
            ('ifngt', 'EMIT_NEXT'), ('getlocal', 5), e.number(0), ('getproperty', x),
            ('getlocal', 7), ('getlocal', 8), ('callpropvoid', q('wfxHealDamageEmit'), 2),
            ('label', 'EMIT_NEXT'), ('inclocal_i', 7), ('label', 'EMIT_CHECK'),
            ('getlocal', 7), e.number(5), ('iflt', 'EMIT_LOOP'),
            ('label', 'NEXT'), ('inclocal_i', 4), ('label', 'CHECK'), ('getlocal', 4),
            ('getlocal_2',), ('getproperty', q('length')), ('iflt', 'LOOP'),
            ('label', 'DONE'), ('returnvoid',)]
    return e.add_method(MEMBER, 'wfxHealAnyCTTick', 'void', ['*'], code, 10, static=True)
