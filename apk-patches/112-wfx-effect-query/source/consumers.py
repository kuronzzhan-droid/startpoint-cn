"""24/25/26/71 消费方法；原写死分支保留在原方法体。"""
from .query import CS
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
DECIMAL = 'pinball.common.math._Decimal::Decimal_Impl_'
BC = 'pinball.scene.battle.battle::BattleConstants'


def direct(e, m):
    q, x = m['q'], m['mnl']
    # locals: rows2, combo3, k4, index5, row6, arg7, B8, C9, n10, cap11.
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('getproperty', q('conditionSlot')), e.number(24), ('pushtrue',),
            ('callproperty', m['rows'], 2), ('setlocal_2',),
            ('getlocal_2',), ('getproperty', q('length')), ('iftrue', 'HAVE'),
            e.number(1), ('returnvalue',),
            ('label', 'HAVE'), e.number(0), ('setlocal_3',), e.number(0), ('setlocal', 4),
            ('getlocal_0',), ('getproperty', q('comboCalculator')), ('setlocal', 6),
            ('getlocal', 6), ('iffalse', 'TARGET'),
            ('getlex', q('pinball.common.mask::MaskGeneral')), ('getproperty', q('maskBit')),
            ('getlocal', 6), ('callproperty', m['exact']('pinball.scene.battle.battle:ComboCalculator::getCombo'), 0),
            ('convert_i',), ('bitxor',), ('convert_i',), ('setlocal_3',),
            ('label', 'TARGET'), ('getlocal_1',), ('iffalse', 'START'),
            ('getlocal_1',), ('getproperty', q('parent')),
            ('coerce', q('pinball.scene.battle.battle.enemy::Enemy')), ('setlocal', 6),
            ('getlocal', 6), ('iffalse', 'START'),
            ('getlocal', 6),
            ('callproperty', m['exact']('pinball.online.battle.impact:ImpactTarget::getTotalDebuffCounts'), 0),
            ('convert_i',), ('setlocal', 4),
            ('label', 'START'), e.number(0), ('setlocal', 8), e.number(0), ('setlocal', 9),
            e.number(0), ('setlocal', 5), ('jump', 'CHECK'),
            ('label', 'LOOP'), ('avm_label',),
            ('getlocal_2',), ('getlocal', 5), ('getproperty', x), ('setlocal', 6),
            ('getlocal', 6), e.number(0), ('getproperty', x), ('convert_i',), ('setlocal', 7),
            ('getlocal', 6), e.number(1), ('getproperty', x), ('convert_d',), ('setlocal', 10),
            ('getlocal', 7), e.number(0), ('ifeq', 'BASE'),
            ('getlocal', 7), e.number(1), ('ifeq', 'COMBO'),
            ('getlocal', 7), e.number(2), ('ifeq', 'ONE'),
            ('getlocal', 7), e.number(3), ('ifne', 'NEXT'),
            ('getlocal', 4), ('setlocal', 11),
            ('getlocal', 6), e.number(2), ('getproperty', x), e.number(0), ('ifle', 'MULT'),
            ('getlocal', 6), e.number(2), ('getproperty', x), ('getlocal', 11), ('ifge', 'MULT'),
            ('getlocal', 6), e.number(2), ('getproperty', x), ('setlocal', 11),
            ('label', 'MULT'), ('getlocal', 10), ('getlocal', 11), ('multiply',), ('setlocal', 10),
            ('jump', 'BASE'),
            ('label', 'ONE'), ('getlocal', 4), e.number(1), ('iflt', 'NEXT'),
            ('label', 'BASE'), ('getlocal', 8), ('getlocal', 10), ('add',), ('setlocal', 8), ('jump', 'NEXT'),
            ('label', 'COMBO'), ('getlocal', 9), ('getlocal', 10), ('add',), ('setlocal', 9),
            ('label', 'NEXT'), ('inclocal_i', 5),
            ('label', 'CHECK'), ('getlocal', 5), ('getlocal_2',), ('getproperty', q('length')), ('iflt', 'LOOP'),
            e.number(1), ('getlocal', 8), e.number(10000), ('divide',), ('add',), ('setlocal', 8),
            ('getlocal', 8), e.number(0), ('ifge', 'RESULT'), e.number(0), ('setlocal', 8),
            ('label', 'RESULT'), ('getlocal', 8), e.number(1),
            ('getlocal', 9), ('getlocal_3',), ('multiply',), e.number(10000), ('divide',), ('add',),
            ('multiply',), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxDirectFactor', 'Number', ['*'], code, 12)


def merge(e, m):
    q, x = m['q'], m['mnl']
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('getproperty', q('conditionSlot')), e.number(25), ('pushtrue',),
            ('callproperty', m['rows'], 2), ('setlocal_2',), e.number(0), ('setlocal_3',), ('jump', 'CHECK'),
            ('label', 'LOOP'), ('avm_label',),
            ('getlocal_2',), ('getlocal_3',), ('getproperty', x), e.number(0), ('getproperty', x),
            ('convert_i',), ('setlocal', 4),
            ('getlocal', 4), ('iftrue', 'THRESHOLD'), e.number(4), ('setlocal', 4),
            ('label', 'THRESHOLD'), ('getlocal_1',), ('getlocal', 4), ('iflt', 'NEXT'),
            ('pushtrue',), ('returnvalue',),
            ('label', 'NEXT'), ('inclocal_i', 3),
            ('label', 'CHECK'), ('getlocal_3',), ('getlocal_2',), ('getproperty', q('length')), ('iflt', 'LOOP'),
            ('pushfalse',), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxMergeDirect', 'Boolean', ['int'], code, 5)


def resistance(e, m):
    q, x = m['q'], m['mnl']
    # oneSide 的布尔入参属于另一侧的贡献；沿用晒伤仅 false 分支计入，移除仅敌人限制。
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_1',), ('iftrue', 'ZERO'),
            ('getlocal_0',), ('callproperty', q('get_isInvisibleSlot'), 0), ('iftrue', 'ZERO'),
            ('getlocal_0',), e.number(26), ('pushfalse',), ('callproperty', m['rows'], 2), ('setlocal_2',),
            e.number(0), ('setlocal_3',), e.number(0), ('setlocal', 4), ('jump', 'CHECK'),
            ('label', 'LOOP'), ('avm_label',),
            ('getlocal_2',), ('getlocal_3',), ('getproperty', x), ('setlocal', 5),
            ('getlocal', 5), e.number(3), ('getproperty', x), ('setlocal', 6),
            ('getlocal', 5), e.number(2), ('getproperty', x), ('setlocal', 7),
            ('getlocal', 7), e.number(0), ('ifle', 'ADD'),
            ('getlocal', 7), ('getlocal', 6), ('ifge', 'ADD'),
            ('getlocal', 7), ('setlocal', 6),
            ('label', 'ADD'), ('getlocal', 4), ('getlocal', 5), e.number(4), ('getproperty', x),
            ('getlocal', 6), ('multiply',), ('add',), ('setlocal', 4),
            ('label', 'NEXT'), ('inclocal_i', 3),
            ('label', 'CHECK'), ('getlocal_3',), ('getlocal_2',), ('getproperty', q('length')), ('iflt', 'LOOP'),
            ('getlocal', 4), ('returnvalue',), ('label', 'ZERO'), e.number(0), ('returnvalue',)]
    return e.add_method(CS, 'wfxAbilityResistance', 'Number', ['Boolean'], code, 8)


def charge(e, m):
    q = m['q']
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_1',), ('getlex', q(BC)), ('getproperty', q('MAX_STAT_MIDIFIER_SKILL_GAUGE_CHARGING')),
            ('ifngt', 'SAME'),
            ('getlex', q(DECIMAL)),
            ('getlocal_0',), ('getproperty', q('conditionSlot')), e.number(71), e.number(-1),
            ('callproperty', m['sum'], 2), e.number(10000), ('divide',),
            ('callproperty', q('fromFloat'), 1), ('convert_d',), ('setlocal_3',),
            ('getlocal_3',), ('getlocal_2',), ('ifngt', 'SAME'),
            ('getlocal_1',), ('getlocal_3',), ('ifngt', 'RAW'),
            ('getlocal_3',), ('returnvalue',),
            ('label', 'RAW'), ('getlocal_1',), ('returnvalue',),
            ('label', 'SAME'), ('getlocal_2',), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxChargeCap', 'Number', ['Number', 'Number'], code, 4)


def build(e, m):
    return dict(direct=direct(e, m), merge=merge(e, m),
                resistance=resistance(e, m), charge=charge(e, m))
