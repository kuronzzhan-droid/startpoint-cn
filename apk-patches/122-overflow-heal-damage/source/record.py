"""治疗结算后采样；按治疗时的有效WFX层数加权，避免后续层数变化追溯改写。"""
from .symbols import MEMBER,DEC100

def install(e,m,queue):
 q,x=m['q'],m['x']
 # arguments impact1, detail2, overflowDecimal100 3; healer4, rows5, i6,row7,total8/9,state10.
 code=[('getlocal_0',),('pushscope',),
       ('getlocal_3',),e.number(0),('ifngt','DONE'),
       ('getlocal_1',),('getproperty',q('createdByCoopCommand')),('iftrue','DONE'),
       ('getlocal_2',),('getproperty',q('isHealRejected')),('iftrue','DONE'),
       ('getlocal_2',),('getproperty',q('isFromHostile')),('iftrue','DONE'),
       ('getlocal_2',),('getproperty',q('createdBySummonsMultiBall')),('iftrue','DONE'),
       ('getlocal_2',),('getproperty',q('statsBattleId')),
       ('getlocal_0',),('getproperty',q('battle')),('callproperty',q('get_id'),0),('ifne','DONE'),
       ('getlocal_2',),('getproperty',q('originMemberIndex')),('convert_i',),('setlocal',4),
       ('getlocal',4),e.number(0),('iflt','DONE'),
       ('getlocal_0',),('getproperty',q('squadManager')),('getproperty',q('primary')),
       ('getlocal',4),('callproperty',m['exact']('pinball.scene.battle.battle.squad:Squad::getMember'),1),('setlocal',4),
       ('getlocal',4),('iffalse','DONE'),('getlocal',4),('getproperty',q('index')),('iftrue','DONE'),
       ('getlocal',4),('getproperty',q('params')),e.number(0),('getproperty',x),('setlocal',4),
       ('getlocal',4),('iffalse','DONE'),
       ('getlocal',4),('getproperty',q('conditionSlot')),e.number(27),('pushtrue',),
       ('callproperty',q('wfxRows'),2),('setlocal',5),
       e.number(0),('setlocal',8),e.number(0),('setlocal',9),e.number(0),('setlocal',6),('jump','CHECK'),
       ('label','LOOP'),('avm_label',),('getlocal',5),('getlocal',6),('getproperty',x),('setlocal',7),
       ('getlocal',7),e.number(0),('getproperty',x),e.number(0),('ifne','NEAR'),
       ('getlocal',8),('getlocal',7),e.number(1),('getproperty',x),('add',),('setlocal',8),('jump','NEXT'),
       ('label','NEAR'),('getlocal',7),e.number(0),('getproperty',x),e.number(1),('ifne','NEXT'),
       ('getlocal',9),('getlocal',7),e.number(1),('getproperty',x),('add',),('setlocal',9),
       ('label','NEXT'),('inclocal_i',6),('label','CHECK'),('getlocal',6),('getlocal',5),('getproperty',q('length')),('iflt','LOOP'),
       ('getlocal',8),e.number(0),('ifgt','SAVE'),('getlocal',9),e.number(0),('ifngt','DONE'),
       ('label','SAVE'),('getlex',q(MEMBER)),('getlocal',4),('callproperty',queue,1),('setlocal',10),
       ('getlex',q(DEC100)),('getlocal_3',),('callproperty',q('toFloat'),1),('setlocal_3',)]
 for amount,at in [(8,2),(9,3)]:
  code += [('getlocal',amount),e.number(0),('ifngt','SKIP'+str(at)),
           ('getlocal',10),e.number(at),('getlocal',10),e.number(at),('getproperty',x),
           ('getlocal_3',),('getlocal',amount),('multiply',),e.number(10000),('divide',),('add',),('setproperty',x),('label','SKIP'+str(at))]
 code += [('label','DONE'),('returnvoid',)]
 return e.add_method(MEMBER,'wfxOverflowRecord','void',['*','*','Number'],code,11)
