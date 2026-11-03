"""补齐码60/61派生的原生能力伤害动画与状态图标预载。"""
import asm

UNIQUE = 'pinball.common.data.character.condition::UniqueConditionLogic'
SOURCE = 'pinball.common.data.ability.instant::InstantAbilitySource'
SLOT = 'pinball.scene.battle.battle.condition::ConditionSlot'
TABLE = 'pinball.master.generated::UniqueConditionTable'
TOTAL = 'battle/common/layer1/total_ability_damage_effect'
SITES = {'InstantAbilitySource/resolvePathCollection': [(232,11),(265,11),(298,11)],
         'InstantAbilitySource/resolveConditionPathCollection': [(141,3)],
         'ActionDslAssetResolver/eval': [(601,13)]}


def build(e):
    q = e.q
    x = next(i for i,v in enumerate(e.abc.multinames) if v[0] == 0x1b)
    def exact(name):
        hits = [i for i,v in enumerate(e.abc.multinames) if v[0] == 7 and e.abc.mn_name(i) == name]
        assert len(hits) == 1, (name,hits)
        return hits[0]
    image = exact('pinball.asset.logic:IAssetPathCollectionBuilder::addImage')
    animation = exact('pinball.asset.logic:IAssetPathCollectionBuilder::addAnimationLayout')
    # addIcon(builder,assets,uid). 不构造UniqueConditionLogic，避免其强制读表接口。
    icon = e.add_method(UNIQUE, 'wfxSuperPreloadIcon', 'void', ['*','*','int'], [
        ('getlocal_0',),('pushscope',),('getlocal_3',),e.number(0),('ifle','DONE'),
        ('getlocal_2',),('getlex',q(TABLE)),('callproperty',q('getMasterTableMaybe'),1),('setlocal',4),
        ('getlocal',4),('iffalse','DONE'),('getlocal',4),('callproperty',q('get_data'),0),('setlocal',4),
        ('getlocal',4),('getlocal_3',),('callproperty',q('exists'),1),('iffalse','DONE'),
        ('getlocal',4),('getlocal_3',),('callproperty',q('get'),1),('getproperty',q('icon_image')),('setlocal',4),
        ('getlocal',4),('iffalse','DONE'),('getlocal_1',),('getlocal',4),('callpropvoid',image,1),
        ('label','DONE'),('returnvoid',)], 5)
    code = [('getlocal_0',),('pushscope',),('getlex',q(SLOT)),('getlocal_0',),('getproperty',q('id')),
        ('getlocal_2',),('callproperty',q('wfxSpec'),2),('setlocal_3',),('getlocal_3',),('iffalse','DONE'),
        ('getlocal_3',),e.number(0),('getproperty',x),e.number(60),('ifeq','ENERGY'),
        ('getlocal_3',),e.number(0),('getproperty',x),e.number(61),('ifne','DONE'),
        ('getlocal_0',),('getproperty',q('id')),('setlocal',4),('jump','EFFECTS'),
        ('label','ENERGY'),('getlocal_3',),e.number(1),('getproperty',x),('setlocal',4),
        ('label','EFFECTS'),('getlocal_1',),e.string(TOTAL),('callpropvoid',animation,1),
        e.number(0),('setlocal',5),('jump','CHECK'),('label','LOOP'),('avm_label',)]
    for kind in ('Hit','Player','Shot'):
        code += [('getlocal_1',),('getlex',q(SOURCE)),('getlocal',5),
                 ('callproperty',q('getAbilityDamage'+kind+'Effect'),1),('callpropvoid',animation,1)]
    code += [('inclocal_i',5),('label','CHECK'),('getlocal',5),e.number(6),('iflt','LOOP'),
        ('getlex',q(SLOT)),('getlocal',4),('getlocal_2',),('callproperty',q('wfxSpec'),2),('setlocal_3',),
        ('getlocal_3',),('iffalse','DONE'),('getlocal_3',),e.number(0),('getproperty',x),e.number(61),('ifne','DONE'),
        ('getlocal_0',),('getlocal_1',),('getlocal_2',),('getlocal',4),('callpropvoid',icon,3),
        ('getlocal_0',),('getlocal_1',),('getlocal_2',),('getlocal_3',),e.number(3),('getproperty',x),('callpropvoid',icon,3),
        ('label','DONE'),('returnvoid',)]
    helper = e.add_method(UNIQUE,'wfxSuperPreload','void',['*','*'],code,6)
    for label,sites in SITES.items():
        ins=asm.decode(e.body(label)[5])
        for at,local in sites:
            assert ins[at-1].name=='callpropvoid' and e.abc.mn_name(ins[at-1].args[0])=='resolvePathCollection'
            builder=[('getlocal_0',),('getproperty',q('paths'))] if label.startswith('ActionDsl') else [('getlocal_1',)]
            e.insert(label,at,[('getlocal',local),*builder,('getlocal_0',),('getproperty',q('logicAssets')),
                               ('callpropvoid',helper,2)],incoming=asm.SKIP)
    return {'sites':SITES,'animations':19,'new_resources':False,'icons':'E -> S -> marker',
            'safe_table':'getMasterTableMaybe / exists / get; unloaded tables retry'}
