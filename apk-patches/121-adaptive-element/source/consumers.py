"""执行原生 BattleAbilitySource.add、快照及属性消费链。"""
from .runtime import VM,some,none
from .worlds import world,preload

def enum(index,*params):return {'index':index,'params':list(params)}

def native_add(e,p,char,origin,kind=0,preconditions=()):
    e.lex['Boot']={'skip_constructor':False}
    e.bind(char,'BattleCharacterLogic',['getInstantAbiltyCount'])
    def initial(*args):
        obj={'_type':'InstantInitialAbility'}
        e.run('InstantInitialAbility/<ctor>',obj,*args)
        return obj
    e.lex['InstantInitialAbility']=VM.Cls('InstantInitialAbility',initial)
    trigger=enum(0,{'_type':'InstantAbilitySource','trigger':enum(0,0,enum(kind)),
                   'preconditions':[enum(0,k) for k in preconditions],
                   'precontent':none(),'delayFrame':0,'content':enum(2,None)})
    source=e.source()
    e.run('BattleAbilitySource/add',source,origin,trigger,char,p,char['index'],False)
    return source['instantInitialAbilities']

def snapshot(e,char):
    e.lex['Boot']={'skip_constructor':False}
    voice={name:(lambda:[]) for name in ['get_skillVoicePaths','get_winVoicePaths','get_switchedSkillVoicePaths',
            'get_powerFlipVoicePaths','get_exchangePowerFlipVoicePaths','get_outholeVoicePaths','get_startVoicePaths']}
    voice.update({name:(lambda:none()) for name in ['get_skillReadyVoicePath','get_switchedSkillReadyVoicePath']})
    skill={'noVoiceWhenSwitching':False,'noReadyVoiceWhenSwitching':False,'get_skillWeight':lambda:100}
    char.update(getShortVoice=lambda:voice,get_name=lambda:'fixture',getSelfActionSkill=lambda:skill,
                getActionSkills=lambda:[skill],getActionSkillReferences=lambda:[None],specialityType=0)
    for name in ['getSkillCutinImagePath','getSkillChainImagePath','getControlBoardImagePath',
                 'getMemberStatusImagePath','get_stringId','getPixelArtAnimationPath','get_gender']:
        char[name]=lambda:'fixture'
    for name in ['get_level','get_rarity','get_hp','get_atk','getMainHp','getUnisonHp','getMainAtk','getUnisonAtk']:
        char[name]=lambda:100
    for name in ['get_races','get_characterTags','getUnisonRaces','getUnisonCharacterTags']:
        char[name]=lambda:[]
    e.bind(char,'BattleCharacterLogic',['getUnisonElements'])
    for name in ['getUnisonGender','getUnisonSpecialityType','getUnisonClv']:char[name]=lambda:none()
    obj={'_type':'CalculatedBattleCharacterLogic'}
    e.run('CalculatedBattleCharacterLogic/<ctor>',obj,char,e.source())
    return obj

def native_origins(e,origins):
    """原生preboot地址/统计/仪表去重；InstantAbility渲染和计时对象受控。"""
    e.lex['Equal']={'equals':lambda a,b:a==b}
    e.lex['InstantAbilityAddress']={'Instant':lambda i,owner,unison:[i,owner,unison]}
    def instant(address,slot,source):
        obj={'_type':'InstantAbility','address':address,'source':source,'stats':{},'triggerPullerStats':{},
             'gaugePeeks':[source['origin']]}
        e.bind(obj,'InstantAbility',['get_triggerLimit','get_slotNumber'])
        return obj
    e.lex['InstantAbility']=VM.Cls('InstantAbility',instant)
    rows=[{'origin':origin,'preconditions':[],'precontent':None,'trigger':enum(0),
           'triggerLimit':some(2),'cooltime':30} for origin in origins]
    stats={};pullers={}
    slot={'_type':'AbilitySlotImpl','prebootedUp':False,'index':0,
          'source':{'instantBattleAbilities':rows,'duringAbilities':[],'instantInitialAbilities':[]},
          'stats':{'set':lambda key,val:stats.__setitem__(key,val)},
          'triggerPullerStats':{'set':lambda key,val:pullers.__setitem__(key,val)},
          'instantAbilities':[],'duringAbilities':[],'instantAbilityGaugePeeks':[]}
    e.run('AbilitySlotImpl/executePrebootUp',slot,'owner',False,False)
    return slot,stats,pullers

def native_resource_elements(e,char):
    """真正的trigger -> InstantAbilitySource预载DSL键；原生leader/skill构造属性参数。"""
    abilities=char['getSelfAbilitySlots'](False)
    values=[opt['params'][0]['ownerElement'] for opt in abilities if opt['index']==0]
    paths=[]
    e.lex['InahoAbilityVisuals']={'preload':lambda *args:None}
    e.lex['Std']={'string':lambda value:str(int(value))}
    instant={'content':enum(4,enum(0),enum(19,None,'wfx_probe')),'logicAssets':e.asset}
    e.bind(instant,'InstantAbilitySource',['resolvePathCollection'])
    e.lex['LeaderAbilityLogic']=VM.Cls('LeaderAbilityLogic',lambda data,level,asset,element:{'ownerElement':element})
    leader=e.run('GeneralCharacterLogic/getLeaderAbilityWithEvolutionLevel',char,0)['params'][0]['ownerElement']
    char.update(getSelfActionSkillReference=lambda:None,get_actionSkillSwitching=lambda:none(),
                get_noVoiceWhenActionSkillSwitching=lambda:False,get_noReadyVoiceWhenActionSkillSwitching=lambda:False)
    e.lex['ActionSkillLogic']=VM.Cls('ActionSkillLogic',lambda ref,element,*args:{'element':element})
    skill=e.run('BattleCharacterLogic/getSelfActionSkill',char)['element']
    # 表行解析边界注入DSL触发器；完整BCL闭包传入的ownerElement不能由测试代码代传。
    def trigger_hook(trigger,*args):
        e.run('AbilityTriggerTools$/resolvePathCollection',None,enum(0,instant),*args)
    preload(e,[char],[],trigger_hook=trigger_hook,
            extra_paths={'addActionDsl':lambda path,report:paths.append(path)})
    return values,paths,leader,skill
