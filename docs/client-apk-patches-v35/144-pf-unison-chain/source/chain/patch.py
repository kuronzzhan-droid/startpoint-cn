"""码36入口、原生上下文和同帧第二次 executeAction。"""
import asm
from . import config

MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
PF = 'pinball.common.data.skill.powerFlip::PowerFlipLogic'
SPEC = 'ConditionSlot$/wfxSpec'
START = 'MemberImpl/startPowerFlip'
TARGETS = [SPEC, START]
LOCKS = {
    SPEC: {'sha': '41a35474919597c0284697979a51213f2daf14b71d8dae19a77f53a35439b20a',
           'header': [5, 9, 1, 2]},
    START: {'sha': '030ae3c33da2fe234e174d12fdd251b59251ca36ce2813a5bea1e8fb47cf69b8',
            'header': [27, 20, 1, 2]},
}


def parser(e):
    """保留原整数合法性；36的参数/flags允许有符号int32。"""
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    for at in (112, 165):
        e.insert(SPEC, at, [('getlocal', 6), e.number(1), ('getproperty', x),
                           ('convert_i',), e.number(36), ('ifne', 'OLD'),
                           ('pop',), ('pop',), e.number(0), e.number(0), ('label', 'OLD')])


def main_override(e, gate):
    q = e.q
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('callproperty', gate, 0), ('iffalse', 'OLD'),
            ('getlocal_0',), ('getproperty', q('battle')), ('getproperty', q('abilityTotalizer')),
            ('coerce_a',), ('getlocal_2',),
            ('getlocal_0',), ('getproperty', q('originMemberIndex')), ('pushfalse',),
            ('callproperty', e.newq('wfxPfSelect'), 3), ('returnvalue',),
            ('label', 'OLD'), ('getlocal_1',), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxPfMainOverride', 'String', ['String', 'int'], code, 3)


def execute(e, gate):
    """按原生 startPowerFlip 的 executeAction 参数构造，省略所有发动计数。"""
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    # level1,config/id2,row3,dsl4,mode5,hold6,context7,address8,config9,scale10.
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_2',), ('iffalse', 'DONE'),
            ('getlocal_2',), ('setlocal', 9),
            ('getlocal_1',), n(1), ('iflt', 'DONE'),
            ('getlocal_1',), n(3), ('ifgt', 'DONE'),
            ('getlocal_0',), ('getproperty', q('zoneManager')),
            ('callproperty', q('pinball.scene.battle.battle.zone:ZoneManager::isFeverMode'), 0),
            ('iffalse', 'NORMAL_SCALE'),
            ('getlocal', 9), n(1), ('getproperty', x), ('jump', 'HAVE_SCALE'),
            ('label', 'NORMAL_SCALE'), ('getlocal', 9), n(2), ('getproperty', x),
            ('label', 'HAVE_SCALE'), n(10000), ('divide',), ('setlocal', 10),
            ('pushnull',), ('setlocal_2',),
            ('getlocal', 9), n(0), ('getproperty', x), ('iftrue', 'TYPE'),
            ('getlocal_0',), ('getproperty', q('battle')), ('getproperty', q('abilityTotalizer')),
            ('coerce_a',), ('getlocal_1',),
            ('getlocal_0',), ('getproperty', q('originMemberIndex')), ('pushtrue',),
            ('callproperty', e.newq('wfxPfSelect'), 3), ('setlocal_2',),
            ('getlocal_2',), ('iftrue', 'HAVE_ID'),
            ('label', 'TYPE'),
            ('getlex', q('pinball.common.data.character::SpecialityTypeTools')),
            ('getlocal_0',), ('getproperty', q('source')),
            ('getproperty', q('unisonSpecialityType')), ('getproperty', q('params')),
            n(0), ('getproperty', x), ('convert_i',),
            ('callproperty', q('getPowerFlipActionId'), 1), ('setlocal_2',),
            ('label', 'HAVE_ID'),
            ('getlocal_0',), ('getproperty', q('logicAssets')),
            ('getlex', q('pinball.master.generated::PowerFlipActionTable')),
            ('callproperty', q('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'), 1),
            ('setlocal', 8), ('getlocal', 8), ('iffalse', 'DONE'),
            ('getlocal', 8), ('coerce', q('pinball.master.generated::PowerFlipActionTable')),
            ('callproperty', q('get_data'), 0), ('setlocal', 8),
            ('getlocal', 8), ('getlocal_2',),
            ('callproperty', q('pinball.master.runtime:MasterMap::exists'), 1), ('iffalse', 'DONE'),
            ('getlocal', 8), ('getlocal_2',),
            ('callproperty', q('pinball.master.runtime:MasterMap::get'), 1), ('setlocal_3',)]
    for level in (1, 2, 3):
        code += [('getlocal_1',), n(level), ('ifne', f'LEVEL_{level}_NEXT'),
                 ('getlocal_0',), ('getproperty', q('logicAssets')),
                 ('getlocal_3',), ('getproperty', q(f'power_flip_action{level}')),
                 ('callproperty', q('getActionDsl'), 1),
                 ('setlocal', 4), ('jump', 'HAVE_DSL'), ('label', f'LEVEL_{level}_NEXT')]
    code += [('jump', 'DONE'), ('label', 'HAVE_DSL'),
             ('getlocal', 4), ('getproperty', q('params')), n(0), ('getproperty', x),
             ('convert_i',), ('setlocal', 5), ('pushfalse',), ('setlocal', 6),
             ('getlocal', 5), n(2), ('ifeq', 'HOLD'),
             ('getlocal', 5), n(3), ('ifne', 'CONTEXT'),
             ('label', 'HOLD'), ('pushtrue',), ('setlocal', 6), ('label', 'CONTEXT')]
    def field(name, value):
        return [e.string(name), *value]
    code += field('originMemberIndex', [('getlocal_0',), ('getproperty', q('originMemberIndex'))])
    code += field('originMemberKind', [n(0)])
    code += field('clv', [('getlex', q('pinball.scene.battle.battle._CLv::CLv_Impl_')),
                         ('getproperty', q('POWER_FLIP_CLV'))])
    code += field('slv', [('getlex', q('pinball.scene.battle.battle::SLvALv')),
                         ('getlex', q('pinball.scene.battle.battle._SLv::SLv_Impl_')),
                         ('getproperty', q('POWER_FLIP_SLV')), ('callproperty', q('Slv'), 1)])
    code += field('type', [('getlex', q('pinball.scene.battle.battle.action::ActionType')),
                          ('getlocal_0',), ('getproperty', q('ball')), ('callproperty', q('PowerFlip'), 1)])
    code += field('kind', [('getlex', q('pinball.online.battle.action::ActionKind')),
                          ('getlocal_2',), ('getlocal_1',), ('callproperty', q('PowerFlip'), 2)])
    code += field('element', [('getlex', q('pinball.common.data.general._ElementKind::ElementKind_Impl_')),
                             ('getlocal_0',), ('getproperty', q('source')), ('getproperty', q('element')),
                             ('callproperty', q('toColorlessable'), 1)])
    code += field('main', [('pushtrue',)])
    code += field('executionCount', [('getlocal_0',), ('getproperty', q('powerFlipActionCount'))])
    code += field('multiballId', [('getlocal_0',), ('getproperty', q('ball')),
                                ('callproperty', q('pinball.scene.battle.battle.action:ActionSubject::getMultiballId'), 0)])
    code += field('multiballIndex', [('pushnull',)])
    code += field('multiballCount', [('getlocal_0',), ('getproperty', q('squad')),
                                   ('callproperty', q('pinball.scene.battle.battle.squad:Squad::get_summonsMultiballCount'), 0)])
    code += field('wfxPfChain', [('pushtrue',)])
    code += field('wfxPfDamageScale', [('getlocal', 10)])
    code += [('newobject', 14), ('setlocal', 7),
             ('getlocal_0',), ('getlocal_0',), ('getproperty', q('powerFlipActionCount')),
             ('callproperty', e.newq('wfxPfChainAddress'), 1),
             ('setlocal', 8),
             ('getlocal_0',), ('getproperty', q('zoneManager')), ('getlocal', 8), ('getlocal_0',),
             ('getlocal', 7), ('getlocal', 6), ('getlocal', 5), ('getlocal', 4),
             ('callpropvoid', q('pinball.scene.battle.battle.zone:ZoneManager::executeAction'), 6),
             ('label', 'DONE'), ('returnvoid',)]
    return e.add_method(MEMBER, 'wfxPfChainExecute', 'void', ['int', 'Array'], code, 11)


def build(e):
    parser(e)
    settings, gate = config.install(e)
    select = main_override(e, gate)
    chain = execute(e, gate)
    e.insert(START, 2, [('getlocal_0',), ('callproperty', settings, 0), ('setlocal', 20)])
    for at, level in ((45, [e.number(4)]), (56, [('getlocal_2',)])):
        e.insert(START, at, [('getlocal_0',), ('swap',), *level, ('callproperty', select, 2)])
    e.insert(START, 241, [('getlocal', 20),
                         ('iffalse', 'OLD_CONTEXT'), ('dup',), ('pushtrue',),
                         ('setproperty', e.newq('wfxPfPaired')), ('label', 'OLD_CONTEXT')])
    e.insert(START, 249, [('getlocal_0',), ('getlocal_2',), ('getlocal', 20),
                         ('callpropvoid', chain, 2)])
    return {'targets': TARGETS, 'capability': 'pf-unison-chain-v1'}
