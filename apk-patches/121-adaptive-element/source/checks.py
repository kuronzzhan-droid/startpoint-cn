"""组1/2离线行为检查；主流程、辅助方法、下游原生计数执行真实字节码。"""
from collections import Counter
from .worlds import world,available,summary,preload,FIXTURE,filtered
from .consumers import enum,native_add,snapshot,native_origins,native_resource_elements
from .runtime import some,none

def suite(before,after,record=False):
    checks=[];executed=set();team_results={}
    def ok(name,a,b=True):
        assert a==b,(name,a,b)
        checks.append(name)
    def capture(e):executed.update(e.executed)
    for loaded in (True,False):
      for missing in (True,False):
       for empty in (True,False):
        for learned in (True,False):
         kw=dict(loaded=loaded,missing_leader=missing,empty_unison=empty,learned=learned)
         a,*_=available(before,{},**kw);b,e,p,ms,us=available(after,{},**kw)
         ok('old-parity '+str(kw),b,a);capture(e)
         if loaded and learned and not empty:
             team_results['leader_absent' if missing else 'leader_present']={'v35a':a,'v35b':b}
    for mask in range(8):
        table={'wfx_unlock_111001':str(mask)}
        b,e,p,ms,us=available(after,table,restricted=True)
        ordinary,*_=available(before,{},restricted=not bool(mask&1))
        expected=[r.copy() for r in ordinary]
        for slot in range(3):
            specs=[]
            if mask&4 and slot:specs.append((ms[slot],22000+slot*1000))
            if mask&2:specs.append((us[slot],1021000+slot*1000))
            for char,base in specs:
                lid=char['values']['leader_ability']['params'][0]['id']
                expected[slot]+=[[base+i,lid,char['id'],slot] for i,_ in enumerate(filtered(FIXTURE['leader_ability'][str(lid)],True))]
        ok('mask origins/owner '+str(mask),b,expected)
        e.origins.clear();ok('panel equality '+str(mask),summary(e,p,ms),sum(expected,[]))
        e.preloads.clear();got=preload(e,ms,us)
        ids={r[1] for r in sum(expected,[])}
        ok('preload includes every enabled id '+str(mask),set(got),ids)
        ok('no origin collision per slot '+str(mask),all(len({r[0] for r in rows})==len(rows) for rows in b))
        for i,c in enumerate(ms):
            result=e.run('BattleCharacterLogic/getAvailableAbilitiesWithCond',c,p,i,lambda cond:True,[none()]*3,False,False)
            ok('withCond '+str(mask)+'/'+str(i),result['records'],expected[i])
        capture(e)
        if mask==7:team_results['all_unlocked']=b
    for value,expected in [('',0),('x',0),('-1',0),('1.5',0),('NaN',0),('Infinity',0),('2147483648',0),('8',0),('15',7),('0',0)]:
        e,p,ms,us=world(after,{'wfx_unlock_111001':value})
        ok('mask parse '+value,ms[0]['wfxPartyMask'](),expected);capture(e)
    e,p,ms,us=world(after,{'wfx_unlock_121001':'7','wfx_unlock_111002':'7'})
    ok('only slot0 main leader id',ms[1]['wfxPartyMask'](),0)
    e,p,ms,us=world(after,{'wfx_unlock_111001':'7'});e.leader_ids.clear()
    ok('missing leader-table ids safe',ms[1]['wfxExtraLeaders'](),[]);capture(e)
    # 完整原生 count 与 add：202/203按origin判断；新增合击队长技自身队长前置不得借slot0。
    e,p,ms,us=world(after,{'wfx_unlock_111001':'7'})
    origins=[1000,21000,23000,24000,1001000,1006000,1021000,1022000,1023000]
    for origin in origins:
        char=us[0] if origin>=1000000 else ms[0]
        for kind in (11,12):
            expected=int((origin//1000000==1)==(kind==12))
            rows=native_add(e,p,char,origin,kind)
            ok(f'native add 202/203 {origin}/{kind}',rows[0]['count']['params'][0],expected)
    for slot in range(3):
        origin=1021000+slot*1000
        ok('unison leader precondition '+str(slot),native_add(e,p,us[slot],origin,0,[enum(6)]),[])
        ok('unison not leader precondition '+str(slot),len(native_add(e,p,us[slot],origin,0,[enum(7)])),1)
    ok('old origin slot0 leader predicate retained',len(native_add(e,p,us[0],1001000,0,[enum(6)])),1)
    ok('main slot1 leader predicate false',native_add(e,p,ms[1],23000,0,[enum(6)]),[])
    selfgreen=enum(2,[enum(0,3)])
    ok('self belongs to unison character',len(native_add(e,p,us[2],1023000,0,[selfgreen])),1)
    ok('self differs from its paired main',native_add(e,p,ms[2],24000,0,[selfgreen]),[])
    for origin in origins:
        e.bind(ms[0],'BattleCharacterLogic',['getInstantAbiltyCount'])
        k=enum(1,[enum(0,0)],1,some(1))
        got=ms[0]['getInstantAbiltyCount'](k,p,0,origin,False)
        raw=ms[0]['getInstantAbiltyCountWithoutLimit'](k,p,0,origin,False)
        ok('native resonance count '+str(origin),raw['params'][0],2)
        ok('native count limit '+str(origin),got['params'][0],1)
    six=[21000,23000,24000,1021000,1022000,1023000]
    slot,stats,pullers=native_origins(e,[v+k for v in six for k in (0,1)])
    ok('native preboot separate per-origin stats',len(stats),12)
    ok('native preboot separate trigger-puller stats',len(pullers),12)
    ok('native gauge dedup only within skill',slot['instantAbilityGaugePeeks'],six)
    ok('native instant addresses main/unison', [a['address'][2] for a in slot['instantAbilities']],[False]*6+[True]*6)
    ok('native separate trigger limits',[a['get_triggerLimit']() for a in slot['instantAbilities']],[2]*12)
    ok('native slot number no collision',[a['get_slotNumber']() for a in slot['instantAbilities']],[v//1000 for v in six for k in (0,1)])
    capture(e)
    # 六个能力槽逐个验证已学会、缺键、值不为1；主位与合击属性、快照、共鸣统一。
    for slot in range(1,7):
        aid=FIXTURE['character']['121001'][0][18+slot]
        for learned in (True,False):
            e,p,ms,us=world(after,{'wfx_adaptive_'+aid:'1'},learned=learned)
            ok(f'adaptive learned slot {slot}/{learned}',ms[1]['get_element'](),0 if learned else 1)
            capture(e)
    adaptive={f'wfx_adaptive_{FIXTURE["character"][cid][0][19]}':'1' for cid in FIXTURE['main_ids']+FIXTURE['unison_ids']}
    e,p,ms,us=world(after,adaptive)
    ok('leader also adaptive original reference',[c['get_element']() for c in ms+us],[0]*6)
    ok('resonance follows all six adaptive characters',p['matchCharacterGroup']([enum(0,0)]),6)
    ok('old element no longer counted',p['matchCharacterGroup']([enum(0,1)]),0)
    src=snapshot(e,ms[1]);ok('native calculated snapshot',src['element'],0)
    ok('native unison-element snapshot',src['unisonElements'],[0])
    member={'source':src};ok('native Member getElement damage consumer',e.run('MemberImpl/getElement',member),0)
    enemy={'isHostile':lambda:True,'getElement':lambda:3}
    ok('native outgoing elemental advantage',e.run('ImpactCalculator$/hasDamageMovedBecauseElement',None,enemy,e.run('MemberImpl/getElement',member)),True)
    ok('native outgoing old water not advantageous',e.run('ImpactCalculator$/hasDamageMovedBecauseElement',None,enemy,1),False)
    member.update(isHostile=lambda:False,getElement=lambda:e.run('MemberImpl/getElement',member))
    ok('native incoming old water resistance to fire removed',e.run('ImpactCalculator$/hasDamageMovedBecauseElement',None,member,0),False)
    ok('native incoming wind resisted by adaptive fire',e.run('ImpactCalculator$/hasDamageMovedBecauseElement',None,member,3),True)
    capture(e)
    for table,expected in [({},1),({'wfx_adaptive_1210011':'1'},0)]:
        e,p,ms,us=world(after,table,empty_unison=True)
        vals,paths,leader,skill=native_resource_elements(e,ms[1])
        ok('ability preload ownerElement '+str(table),vals,[expected]*6)
        ok('real full BCL DSL preload key '+str(table),set(paths),{'wfx_probe:'+str(expected)})
        ok('native leader ownerElement '+str(table),leader,expected)
        ok('native action skill resource element '+str(table),skill,expected)
        capture(e)
    e,p,ms,us=world(after,{'wfx_adaptive_1210021':'1'})
    ok('unison ability preload ownerElement',[a['params'][0]['ownerElement'] for a in us[1]['getSelfAbilitySlots'](True)],[0]*6)
    capture(e)
    for table,kw in [({},{}),({'wfx_adaptive_1210011':'2'},{}),({'wfx_adaptive_1210011':'1'},{'loaded':False})]:
        e,p,ms,us=world(after,table,**kw)
        ok('adaptive safe absent/invalid/unloaded '+str((table,kw)),ms[1]['get_element'](),1);capture(e)
    e,p,ms,us=world(after,{'wfx_adaptive_1210011':'1'});ms[1]['party']=None
    ok('adaptive detached character',ms[1]['get_element'](),1);capture(e)
    # 原 kind720 路径仍工作，自适应数据优先覆盖。
    for table,expected in [({},5),({'wfx_adaptive_1210021':'1'},0)]:
        e,p,ms,us=world(after,table)
        e.lex['InitialAbilityTriggerKindTools']={'matchCharacter':lambda c,k:True}
        trigger=enum(0,{'content':enum(2,enum(1,enum(0),enum(36,5))),'preconditions':[],'trigger':enum(0,0,enum(0))})
        us[1]['getSelfAbilitySlots']=lambda flag:[some({'getTriggers':lambda:[trigger]})]
        ok('legacy kind720 '+str(table),us[1]['get_element'](),expected);capture(e)
    return {'status':'pass','checks':len(checks),'check_names':checks,'executed_method_ids':sorted(executed),
            'real_team':team_results,'fixture_sources':FIXTURE['sources']}
