"""无键逐项对照与 0..8 全程材料行为矩阵。"""
import itertools
import asm,bodies
from materials.runtime import capture,world,EXT,CORE,RETAIL
from materials.helper import HELPER


def body(abc,label):return abc.bodies[bodies.resolve(abc,label)]


def suite(before,after):
    count={'old_parity_count':0,'new_check_count':0}
    def check(kind,ok,detail):
        assert ok,detail
        count[kind]+=1
    for cid,highest,rarity in [(129989,100,5),(111183,120,5),(141099,120,5),(129989,120,4)]:
        for step,crystals,cores,stack in itertools.product(range(9),(0,2,9),(0,1,9),(0,3)):
            params=dict(cid=cid,highest=highest,rarity=rarity,step=step,crystals=crystals,cores=cores,stack=stack)
            old,_=capture(before,**params);new,_=capture(after,**params)
            for key in old:check('old_parity_count',old[key]==new[key],('parity',params,key,old[key],new[key]))
    examples=[]
    for step,crystals,cores,stack in itertools.product(range(9),(0,2,9),(0,1,9),(0,3)):
        params=dict(step=step,key='1',crystals=crystals,cores=cores,stack=stack)
        new,e=capture(after,**params)
        rest=(4 if step<4 else 8)-step
        expected_state='impossible' if step==8 or not crystals or not cores else 'item'
        expected_count=min(crystals,cores,rest)
        expectations={
          'candidates':new['candidates']==[EXT],
          'owned_candidates':new['own']==([EXT] if crystals else []),
          'no_duplicate':new['state']['state']!='stack',
          'count':new['counts']=={RETAIL:0,EXT:expected_count},
          'core_gate':new['window_state']['state']==expected_state,
          'slots':[x['id'] for x in new['status']['items']]==[EXT,CORE],
          'amounts':[x['ownNumber'] for x in new['status']['items']]==[crystals,cores],
          'button_ids':new['buttons'][-2:]==[33554432+EXT,33554432+CORE],
          'button_enabled':new['button_states'][16777216]==(4 if expected_state=='impossible' else 1),
          'dialog':new['description']=={'value':1,'itemName':'超限结晶＋悖论之核'},
          'official_cap':new['max_step']==(4 if step<4 else 8),
          'rest':new['rest']==rest,
        }
        for name,ok in expectations.items():check('new_check_count',ok,(name,params,new))
        # 每个业务入口必须完整执行到返回，候选、按钮及窗口不以Python重写。
        required=['OwnedOverLimitLogic/getOwnAwakingCrystalToOverLimit','OwnedOverLimitLogic/getAwakingCrystalToOverLimit',
          'OwnedOverLimitLogic/getOverLimitState','OwnedCharacterLogic/getPossibleOverLimitCountByItem',
          'OverLimitWindow/getOverLimitState','OverLimitWindow/run','OverLimitWindow/getStatusInformation',
          'ExpodOverLimitByItemDialog/getDescription',HELPER]
        check('new_check_count',all(body(after,label)[0] in e.executed for label in required),('not executed',params))
        if crystals==9 and cores==9 and stack==3:examples.append({'step':step,**new})
    # 非严格1/普通五星/非五星/未加载都按无键基线逐项恢复。
    for key,rarity,highest,loaded in [('0',5,120,True),('2',5,120,True),('01',5,120,True),
       ('1.0',5,120,True),('true',5,120,True),('',5,120,True),(1,5,120,True),
       ('1',5,100,True),('1',4,120,True),('1',5,120,False)]:
        for step in range(9):
            params=dict(key=key,rarity=rarity,highest=highest,loaded=loaded,step=step)
            old,_=capture(before,**params);new,_=capture(after,**params)
            check('old_parity_count',old==new,('invalid key/gate',params,old,new))
    for params in [dict(key='1',highest=0),dict(key='1',step=-1),dict(key='1',rarity=6)]:
        e,c,*_=world(after,**params);check('new_check_count',not c['wfxOverlimitFull'](),('helper_guard',params))
    e,c,*_=world(after,key='1');del c['overLimitStep']
    check('new_check_count',not c['wfxOverlimitFull'](),'General无overLimitStep')
    e,c,*_=world(after,key='1');c['logicAssets']=None
    check('new_check_count',not c['wfxOverlimitFull'](),'asset为null')
    e,c,*_=world(after,key='1',loaded=False)
    check('new_check_count',not c['wfxOverlimitFull'](),'表未加载')
    e.loaded=True;check('new_check_count',c['wfxOverlimitFull'](),'表就绪后须重试')
    trace=[];original=e.asset['getMasterTableMaybe']
    def tracked(cls):
        trace.append('maybe');table=original(cls);data=table['get_data']();ex=data['exists'];get=data['get']
        data['exists']=lambda key:(trace.append('exists'),ex(key))[1]
        data['get']=lambda key:(trace.append('get'),get(key))[1]
        table['get_data']=lambda:data
        return table
    e.asset['getMasterTableMaybe']=tracked
    check('new_check_count',c['wfxOverlimitFull']() and trace==['maybe','exists','get'],('read order',trace))
    e.table.clear();trace.clear();check('new_check_count',not c['wfxOverlimitFull']() and trace==['maybe','exists'],('missing key read',trace))
    # O1保持逐字节和header不变，4次前等级上限规则的真实执行也在上面覆盖。
    label='GeneralCharacterLogic/get_maxOverLimitStep'
    check('old_parity_count',body(before,label)==body(after,label),'O1必须完整不变')
    # Independently prove the O5 closing tail remains unreachable.
    ins=asm.decode(body(after,'OwnedCharacterLogic/getPossibleOverLimitCountByItem')[5])
    seen=set();pending=[0]
    while pending:
        index=pending.pop()
        if index in seen:continue
        seen.add(index);x=ins[index]
        if x.op in (0x03,0x47,0x48):continue
        if x.op==0x10:pending.append(x.target)
        elif x.op in asm.CONDITIONAL_BRANCHES:pending.extend([x.target,index+1])
        else:pending.append(index+1)
    check('new_check_count',all(i not in seen for i in range(len(ins)-3,len(ins))),'O5 closing tail must remain unreachable')
    count.update(examples=examples,new_step_matrix=list(range(9)),
      no_key_characters=[129989,111183,141099],native_methods_fully_executed=True)
    return count
