"""专用reference4固定爆发；保留旧reference3和全部原有伤害路径。"""
import asm
from .record import install_record

REF = 'pinball.online.battle.impact.attack::NormalAttackReferenceParameter'
DEC = 'pinball.common.math._Decimal::Decimal_Impl_'


def fixed_guard(e):
    # Object缺属性安全返回undefined；不增加任何实例槽。
    return [('getlocal_2',), ('getproperty', e.newq('wfxSuperFixed')), ('iffalse', 'OLD')]


def build(e):
    label = 'AbilityDamageShot/finish'
    ins = asm.decode(e.body(label)[5])
    assert ins[126].name == 'pushbyte' and ins[126].args == [3]
    assert ins[175].name == 'getlex'
    # 前置将reference4改为同基底；旧reference3分支及0-2 switch逐指令保留。
    from perf2_core import splice_with_exits
    code = [('getlocal_1',), ('getproperty', e.q('reference')), e.number(4), ('ifne', 'OLD'),
            ('getlex', e.q(REF)), ('getlocal_1',), ('getproperty', e.q('strength')),
            ('getlex', e.q(DEC)), e.number(1), ('callproperty', e.q('fromInt'), 1),
            ('callproperty', e.q('MaxHpParameter'), 2), ('setlocal', 9),
            ('jump', 'COMMON'), ('label', 'OLD')]
    # 两个插入点一次splice，保留可逆恢复证据。
    # 普通insert的外部出口不可表达；使用显式splice后只调用一次replace。
    raw, exc, _, _ = splice_with_exits(e.body(label), 124, code, {'COMMON': 175}, asm.ENTER)
    interim = list(e.body(label)); interim[5], interim[6] = raw, exc
    changed = asm.decode(raw)
    attack_object = next(i for i, x in enumerate(changed) if x.name == 'newobject' and x.args == [49])
    marker = [('dup',), ('getlocal_1',), ('getproperty', e.q('reference')), e.number(4),
              ('equals',), ('setproperty', e.newq('wfxSuperFixed'))]
    raw, exc, _, _ = asm.splice_many(interim, [(attack_object + 1, asm.assemble(marker), asm.ENTER)])
    e.replace(label, raw, exc)

    label = 'NormalAttackCalculator/_calculate'
    ins = asm.decode(e.body(label)[5])
    # 恢复对应阶段的输入，只影响带专用标记的attack Object。
    resets = [(380, 25, 24), (1762, 75, 28), (2173, 87, 83), (2381, 103, 99)]
    for at, dest, src in resets:
        assert ins[at-1].name == 'setlocal' and ins[at-1].args == [dest], (at, dest)
        e.insert(label, at, fixed_guard(e) + [('getlocal', src), ('setlocal', dest), ('label', 'OLD')])
    assert ins[2386].name == 'setlocal' and ins[2386].args == [104]
    e.insert(label, 2387, fixed_guard(e) + [e.number(1), ('setlocal', 104), ('label', 'OLD')])
    install_record(e)
    from . import poison, source_share
    poison.install(e)
    source_share.install(e)
    return {'reference': 4, 'legacy_reference3_unchanged': True}
