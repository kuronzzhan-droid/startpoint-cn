"""码30复用原生能力弹前，补齐同一资源集合；旧60/61分支保持原code。"""
import asm

TARGET = 'UniqueConditionLogic/wfxSuperPreload'
TARGETS = [TARGET]
TOTAL = 'battle/common/layer1/total_ability_damage_effect'
SOURCE = 'pinball.common.data.ability.instant::InstantAbilitySource'


def build(e):
    q = e.q
    body = e.body(TARGET)
    ins = asm.decode(body[5])
    assert ins[10].name=='getlocal_3' and ins[13].args==[60]
    x = next(i for i,row in enumerate(e.abc.multinames) if row[0]==0x1b)
    animation = next(i for i,row in enumerate(e.abc.multinames)
                     if e.abc.mn_name(i)=='pinball.asset.logic:IAssetPathCollectionBuilder::addAnimationLayout')
    code = [('getlocal_3',), e.number(0), ('getproperty',x), e.number(30), ('ifne','OLD'),
            ('getlocal_1',),e.string(TOTAL),('callpropvoid',animation,1),
            e.number(0),('setlocal',5),('jump','CHECK'),('label','LOOP'),('avm_label',)]
    for kind in ('Hit','Player','Shot'):
        code += [('getlocal_1',),('getlex',q(SOURCE)),('getlocal',5),
                 ('callproperty',q('getAbilityDamage'+kind+'Effect'),1),('callpropvoid',animation,1)]
    code += [('inclocal_i',5),('label','CHECK'),('getlocal',5),e.number(6),('iflt','LOOP'),
             ('returnvoid',),('label','OLD')]
    e.insert(TARGET,10,code)
    return {'target':TARGET,'code':30,'animations':19,'new_resources':False}
