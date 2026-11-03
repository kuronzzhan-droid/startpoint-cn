"""安全读状态行，构造原生ConditionChangeResultContent，沿原生叠层/185通知。"""
from .symbols import MEMBER,TABLE,CHANGE,CONTENT,OVERWRITE
CID='pinball.online.battle.impact.condition._ConditionId::ConditionId_Impl_'
KEY='pinball.battle.action.dsl.const._ConditionDiscriminationKey::ConditionDiscriminationKey_Impl_'

def install(e,m):
 q,x=m['q'],m['x']
 # grant(uid,layers) affects the primary's three main members, no multiballs.
 c=[('getlocal_0',),('pushscope',),('getlocal_1',),e.number(0),('ifle','DONE'),
 ('getlocal_0',),('getproperty',q('conditionSlot')),('getproperty',q('asset')),('getlex',q(TABLE)),
 ('callproperty',q('getMasterTableMaybe'),1),('setlocal_3',),('getlocal_3',),('iffalse','DONE'),
 ('getlocal_3',),('callproperty',q('get_data'),0),('setlocal_3',),
 ('getlocal_3',),('getlocal_1',),('callproperty',q('exists'),1),('iffalse','DONE'),
 ('getlocal_3',),('getlocal_1',),('callproperty',q('get'),1),('setlocal_3',),
 e.number(1),('setlocal',4),('getlocal_3',),('getproperty',q('max_accumulation')),('setlocal',5),
 ('getlocal',5),('getproperty',q('index')),e.number(0),('ifne','MAXREADY'),
 ('getlocal',5),('getproperty',q('params')),e.number(0),('getproperty',x),('setlocal',4),
 ('label','MAXREADY'),('newarray',0),('setlocal',6),
 ('getlocal_3',),('getproperty',q('end_power_flip_accepted_levels')),('setlocal',5),
 ('getlocal',5),('getproperty',q('index')),e.number(0),('ifne','LEVELREADY'),
 ('getlocal',5),('getproperty',q('params')),e.number(0),('getproperty',x),('setlocal',5)]
 for n,arr in [(1,[1]),(2,[2]),(3,[3]),(11,[1,2,3]),(12,[2,3])]:
  c += [('getlocal',5),e.number(n),('ifne',f'LEVEL{n}')] + [e.number(v) for v in arr]+[('newarray',len(arr)),('setlocal',6),('jump','LEVELREADY'),('label',f'LEVEL{n}')]
 c += [('label','LEVELREADY'),('getlex',q(CONTENT)),('getlocal_1',),('getlocal_2',),
 ('getlocal_3',),('getproperty',q('condition_direction')),('getlocal_3',),('getproperty',q('remove_if_encoffin')),
 ('callproperty',q('Unique'),4),('setlocal',7),
 ('findpropstrict',q(CHANGE)),e.string('S//UNQ-'),('getlex',q(CID)),('getlocal_1',),('callproperty',q('intToString'),1),('add',),
 e.string('/'),('add',),('getlex',q(KEY)),('getproperty',q('EMPTY')),('add',),
 ('getlex',q(OVERWRITE)),('getproperty',q('ChooseOneWithLongerRemainingTime')),
 ('getlocal_3',),('getproperty',q('duration_frame')),('getlocal_3',),('getproperty',q('flip_limit')),
 ('getlocal_3',),('getproperty',q('power_flip_limit')),('getlocal_3',),('getproperty',q('end_power_flip_limit')),
 ('getlocal',6),('getlocal',4),('getlocal',7),('getlocal_3',),('getproperty',q('cancelable')),
 ('getlocal_3',),('getproperty',q('duration_frame')),e.number(0),('lessthan',),
 ('getlocal_0',),('getproperty',q('originMemberIndex')),('pushfalse',),('pushtrue',),('getlocal_2',),
 ('getlex',q(KEY)),('getproperty',q('EMPTY')),('pushfalse',),('constructprop',q(CHANGE),17),('setlocal',7),
 e.number(0),('setlocal',8),('jump','CHECK'),
 ('label','LOOP'),('avm_label',),('getlocal_0',),('getproperty',q('squadManager')),('getproperty',q('primary')),
 ('getlocal',8),('callproperty',m['exact']('pinball.scene.battle.battle.squad:Squad::getMember'),1),('setlocal',9),
 ('getlocal',9),('getproperty',q('index')),e.number(0),('ifne','NEXT'),
 ('getlocal',9),('getproperty',q('params')),e.number(0),('getproperty',x),('getproperty',q('conditionSlot')),
 ('getlocal',7),('getlocal_0',),('getproperty',q('battle')),('callproperty',q('get_id'),0),
 ('pushfalse',),('pushnull',),('pushfalse',),('pushfalse',),e.number(0),('pushtrue',),('callpropvoid',q('applyConditionChange'),8),
 ('label','NEXT'),('inclocal_i',8),('label','CHECK'),('getlocal',8),e.number(3),('iflt','LOOP'),
 ('label','DONE'),('returnvoid',)]
 return e.add_method(MEMBER,'wfxSuperGrant','void',['int','int'],c,10)
