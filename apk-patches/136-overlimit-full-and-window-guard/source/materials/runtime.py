"""材料回归真实 AVM2 运行夹具；外围表、集合、UI资源为受控边界。"""
from materials.vm import Harness,VM

EXT=10000320
CORE=10000302
RETAIL=10003


def world(abc,step=0,key=None,cid=129989,rarity=5,highest=120,crystals=9,cores=9,stack=3,loaded=True):
    table={} if key is None else {'wfx_overlimit_full_'+str(cid):key}
    e=Harness(abc,table,loaded)
    events=[]
    char={'_type':'OwnedCharacterLogic','id':cid,'overLimitStep':step,
          'baseStatusLogic':{'keyLevels':([80,100,highest] if highest else [])},
          'logicAssets':e.asset,'levelLogic':{'getMaxOverLimitStep':lambda:8},
          'get_rarity':lambda:rarity,'get_name':lambda:'角色'+str(cid),'get_stack':lambda:stack,
          'get_currentLevelCap':lambda:80+5*step,'canExBoost':lambda items:False,
          'existsGettableBondTokenOrManaNode':lambda:False}
    e.bind(char,'GeneralCharacterLogic',['wfxOverlimitFull','get_maxOverLimitStep'])
    e.bind(char,'OwnedCharacterLogic',['getRestOverLimitStep','isMaxOverLimitStep','getPossibleOverLimitCountByItem'])
    item_defs={RETAIL:(5,False,crystals,'破星结晶'),EXT:(5,True,crystals,'超限结晶'),
               10002:(4,False,crystals,'四星结晶'),CORE:(0,False,cores,'悖论之核')}
    raw={};items={}
    for iid,(r,allow,number,name) in item_defs.items():
        effect={'index':4 if iid!=CORE else 0,'params':[{'target_character_rarity':r,'is_allow_below_rarity':allow}]}
        raw[iid]={'_type':'ItemValues','id':iid,'effect_kind':effect}
        items[iid]={'_type':'OwnedItemLogic','id':iid,'number':number,'get_effect':lambda effect=effect:effect,
                    'get_name':lambda name=name:name,'get_rarity':lambda r=r:r,'get_thumbnailId':lambda iid=iid:'item/'+str(iid)}
    crystal_items=[v for k,v in items.items() if k!=CORE]
    logic={'character':char,'get_itemTable':lambda:{'keys':lambda:list(raw),'get':raw.__getitem__},
           'compareTargetRarityByItemId':lambda x,y:x-y,
           'compareTargetRarityByOwnItemLogic':lambda x,y:x['id']-y['id'],
           'getTargetRarity':lambda iid:item_defs[iid][0]}
    e.bind(logic,'OwnedOverLimitLogic',['getOwnAwakingCrystalToOverLimit','getAwakingCrystalToOverLimit','getOverLimitState'])
    char['getAwakingCrystalToOverLimit']=logic['getAwakingCrystalToOverLimit']
    char['getOverLimitState']=logic['getOverLimitState']
    reasons={'ReachingUpperLimit':'limit','InsufficientEitherStackOrItem':'insufficient'}
    e.lex['OverLimitImpossibleReason']=VM.Cls('OverLimitImpossibleReason',**reasons)
    e.lex['OverLimitState']=VM.Cls('OverLimitState',PossibleByStack={'state':'stack'},
      PossibleByAwakingCrystal=lambda iid,same:{'state':'item','id':iid,'same':same},
      Impossible=lambda why:{'state':'impossible','why':why})
    repo={'getItemsByCategory':lambda kind:crystal_items,'get':items.__getitem__,'getExBoostCostItems':lambda:[]}
    player={'getItemRepository':lambda:repo,'getItemNumber':lambda iid:items[iid]['number'],
            'getOwnedCharacter':lambda ident:char}
    def button():
        b={'enabled':0}
        b['set_enabled']=lambda value:b.update(enabled=value)
        b['get_enabled']=lambda:b['enabled']
        return b
    def buttons(callback,ids):
        mapping={iid:button() for iid in ids};out={'ids':ids.copy(),'mapping':mapping}
        out['get']=mapping.__getitem__
        out['append']=lambda iid:(out['ids'].append(iid),mapping.update({iid:button()}))
        return out
    e.lex['ButtonGroupLogic']=VM.Cls('ButtonGroupLogic',buttons)
    def playhead(*args):return {'source':{'soundFrameMap':None},'gotoAndPlay':lambda name:events.append(('play',name))}
    e.lex['UIPlayhead']=VM.Cls('UIPlayhead',createFromUiData=playhead)
    window={'targetCharacter':char,'characterId':cid,'player':player,
      'uncappingLevelCutin':{'setTargetCharacter':lambda c:None},'gear':{'addChild':lambda child,where:child},
      'buttonClicked':lambda n:None,'sound':{},'logicAsset':{'getUiData':lambda name:{},'getPlayhead':playhead}}
    e.bind(window,'OverLimitWindow',['run','getOverLimitState','getStatusInformation'])
    window['canOverLimit']=lambda:window['getOverLimitState']()['state']!='impossible'
    item=items[EXT if key=='1' or step>=4 else RETAIL]
    dialog={'character':char,'item':item,'globalLogic':{'getItem':items.__getitem__},
      'logic':{'asset':{'getUiStringWithContext':lambda name,context:context}}}
    e.bind(dialog,'ExpodOverLimitByItemDialog',['getDescription'])
    return e,char,logic,window,dialog,items,events


def capture(abc,**params):
    e,char,logic,window,dialog,items,events=world(abc,**params)
    all_items=[v for k,v in items.items() if k!=CORE]
    candidates=logic['getAwakingCrystalToOverLimit']()
    own=[x['id'] for x in logic['getOwnAwakingCrystalToOverLimit'](all_items)]
    state=logic['getOverLimitState'](all_items)
    enabled=window['getOverLimitState']()
    counts={iid:char['getPossibleOverLimitCountByItem'](window['player'],iid) for iid in (RETAIL,EXT)}
    status=window['getStatusInformation']()
    desc=dialog['getDescription'](1)
    window['run']()
    snapshot={'candidates':candidates,'own':own,'state':state,'window_state':enabled,
      'counts':counts,'status':status,'description':desc,'buttons':window['buttonGroup']['ids'],
      'button_states':{k:v['enabled'] for k,v in window['buttonGroup']['mapping'].items()},
      'max_step':char['get_maxOverLimitStep'](),'rest':char['getRestOverLimitStep'](),'events':events}
    return snapshot,e
