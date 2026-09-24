"""在无效回槽演出创建前退出；不改触发器计数、冷却和其他能力。"""
from core import MEMBER, asm, bodies

DECIMAL = 'pinball.common.math._Decimal::Decimal_Impl_'


def insertion_point(e):
    body = e.abc.bodies[bodies.resolve(e.abc, 'MemberImpl/applyInstantAbility')]
    ins = asm.decode(body[5])
    # Native zero-multiplier and dead exits must run first. Match the first switch.
    matches = [i for i in range(2, len(ins)) if ins[i].name == 'lookupswitch'
               and ins[i-2].name == 'getlocal_3'
               and ins[i-1].name == 'getproperty' and ins[i-1].args == [e.q('index')]]
    if not matches or matches[0] != 86:
        raise asm.AsmError('applyInstantAbility entry switch changed')
    return matches[0]-2


def guard(e):
    q, context = e.q, e.newq('wfGaugeContext')
    code = [('getlocal_3',), ('getproperty', q('index')), ('pushbyte', 8),
            ('ifeq', 'RATIO'), ('getlocal_3',), ('getproperty', q('index')),
            ('pushbyte', 9), ('ifne', 'PASS'),
            # Fixed gauge uses signed int multiplication, exactly as native.
            ('getlocal_3',), ('getproperty', q('params')), ('pushbyte', 0),
            ('getproperty', 14), ('convert_i',), ('getlocal', 7), ('multiply_i',),
            ('jump', 'POSITIVE'), ('label', 'RATIO'), ('getlex', q(DECIMAL)),
            ('getlocal_3',), ('getproperty', q('params')), ('pushbyte', 0),
            ('getproperty', 14), ('convert_d',), ('callproperty', q('toFloat'), 1),
            ('getlocal', 7), ('multiply',), ('label', 'POSITIVE'),
            ('pushbyte', 0), ('ifngt', 'PASS'),
            # Reuse the stamped address, not an allocated snapshot. No callbacks
            # mutate it during the synchronous, read-only rule check.
            ('getlex', q(MEMBER)), ('getproperty', context), ('setlocal', 38),
            ('getlex', q(MEMBER)), ('getlocal_2',), ('setproperty', context),
            ('getlocal_0',), ('pushbyte', 8),
            ('callproperty', e.newq('wfAllowsGauge'), 1), ('setlocal', 39),
            ('getlex', q(MEMBER)), ('getlocal', 38), ('setproperty', context),
            ('getlocal', 39), ('iftrue', 'PASS'), ('returnvoid',), ('label', 'PASS')]
    return code
