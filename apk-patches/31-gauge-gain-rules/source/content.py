"""两种可复用角色词条：423 加槽限制，424 伤害类型转换。"""
from core import TOTALIZER

SPECS = ((423, 37, 'GaugeGainRestriction', 'wfGaugeRules', '限制技能槽增加'),
         (424, 38, 'DamageTypeConversion', 'wfDamageRules', '变更伤害类型'))
MASTER = 'pinball.common.data.ability.during::CommonAbilityContentMasterValue'
CONTENT = 'pinball.common.data.ability.during::CommonAbilityContent'
CHARACTER = 'pinball.common.data.ability.during::CommonAbilityCharacterContent'
CHECKER = 'pinball.scene.battle.battle.ability::DuringCheckerWithDecimal'


def param(e, local, index=0):
    return [('getlocal', local), ('getproperty', e.q('params')), ('pushbyte', index), ('getproperty', 14)]


def wrapper_guard(e, local, kind, end):
    return [('getlocal', local), ('getproperty', e.q('index')), ('pushbyte', 1), ('ifne', end)] + \
        param(e, local, 1) + [('getproperty', e.q('index')), ('pushbyte', kind), ('ifne', end)]


def install(e):
    q = e.q
    parse, resolve, totalize = [], [], []
    for master, kind, tag, slot_name, text in SPECS:
        slot = e.add_slot(TOTALIZER, slot_name, 'Array')
        end = f'END{kind}'
        # Reuse standard target parser (self, element, party) and integer column118.
        parse += [('getlocal_2',), e.string(str(master)), ('ifne', end), ('getlex', q(MASTER)),
                  e.string(tag), e.number(master), e.string('target'),
                  ('getlex', q('pinball.master.generated::AbilityValues')), ('getlocal_1',),
                  ('callproperty', q('parseAt110'), 1), e.string('unique_condition_id'),
                  ('getlex', q('pinball.master.generated::AbilityValues')), ('getlocal_1',),
                  ('callproperty', q('parseAt118'), 1), ('newobject', 2), ('newarray', 1),
                  ('construct', 3), ('coerce', q(MASTER)), ('returnvalue',), ('label', end)]
        resolve += [('getlocal', 21), ('getproperty', q('index')), e.number(master), ('ifne', end)]
        resolve += param(e, 21) + [('setlocal', 22), ('getlex', q(CONTENT)),
                   ('getlex', q('pinball.common.data.ability::AbilityTargetKindTools')),
                   ('getlocal', 22), ('getproperty', q('target')), ('getlocal_3',),
                   ('callproperty', q('resolve'), 2), ('getlex', q(CHARACTER)),
                   e.string(tag), ('pushbyte', kind), ('getlocal', 22),
                   ('getproperty', q('unique_condition_id')), ('convert_i',), ('newarray', 1),
                   ('construct', 3), ('callproperty', q('Character'), 2),
                   ('coerce', q(CONTENT)), ('setlocal', 20), ('label', end)]
        # Native code already adds the checker to duringCheckers before this insertion.
        totalize += [('getlocal_1',), ('getproperty', q('index')), ('pushbyte', kind),
                     ('ifne', end), ('getlocal_0',), ('getproperty', slot), ('iftrue', f'HAVE{kind}'),
                     ('getlocal_0',), ('newarray', 0), ('setproperty', slot), ('label', f'HAVE{kind}'),
                     ('getlocal_0',), ('getproperty', slot), ('getlex', q(CHECKER)),
                     ('getlocal_3',), ('getproperty', q('index')), ('getlocal', 4), ('getlocal', 5)]
        totalize += param(e, 1) + [('convert_d',), ('construct', 4),
                     ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
                     ('returnvoid',), ('label', end)]
    e.insert('AbilityValues$/parseAt109', 6, parse)
    e.insert('DuringAbilitySource$/createFromDuringAbilityValues', 7303, resolve)
    e.insert('MemberAbilityTotalizerImpl/addDuringContent', 40, totalize)
    install_consumers(e)


def install_consumers(e):
    q = e.q
    option = q('haxe.ds::Option')
    returns = {
        'getStrength': [('getlex', option), ('getproperty', q('None')), ('returnvalue',)],
        'hasAdvantage': [('pushfalse',), ('returnvalue',)],
        'isAccumulationBest': [('pushfalse',), ('returnvalue',)],
        'isSameDescriptionByPower': [('pushfalse',), ('returnvalue',)],
        'isActiveEvenIfOwnerIsDead': [('pushfalse',), ('returnvalue',)],
        'hasTargetDescription': [('pushtrue',), ('returnvalue',)],
        'resolvePathCollection': [('returnvoid',)],
        'mergeForDescription': [('getlex', option), ('getproperty', q('None')), ('returnvalue',)],
    }
    for method, result in returns.items():
        code = []
        for local in ((1, 2) if method == 'mergeForDescription' else (1,)):
            for _, kind, _, _, _ in SPECS:
                end = f'E{local}_{kind}'
                code += wrapper_guard(e, local, kind, end) + result + [('label', end)]
        e.insert('CommonAbilityContentTools$/' + method, 0, code)
    for method, at, local, wrapped in (
        ('stringfyCommonCharacterContent', 4, 2, False),
        ('stringfyStrengthByCommonCharacterContent', 4, 1, False),
        ('stringfySummaryCommonContent', 4, 1, True),
    ):
        code = []
        for _, kind, _, _, text in SPECS:
            end = f'END{kind}'
            if wrapped:
                code += wrapper_guard(e, local, kind, end)
            else:
                code += [('getlocal', local), ('getproperty', q('index')), ('pushbyte', kind), ('ifne', end)]
            code += [('getlex', q('pinball.common.data.ability.description::AbilityDescriptionTools')),
                     e.string('' if 'Strength' in method else text),
                     ('callproperty', q('stringfy'), 1), ('coerce', q('Function')),
                     ('returnvalue',), ('label', end)]
        e.insert('AbilityDescriptionGenerator/' + method, at, code)
