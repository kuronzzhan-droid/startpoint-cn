"""治疗瞬间按实际层数加权；每个解析后分类独立累计。"""
from .symbols import MEMBER

def install(e,m,kind,queue):
 q,x=m['q'],m['x']
 code=[('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',q('conditionSlot')),e.number(30),('pushtrue',),('callproperty',q('wfxRows'),2),('setlocal_3',),e.number(0),('setlocal',4),('jump','CHECK'),('label','LOOP'),('avm_label',),('getlocal_3',),('getlocal',4),('getproperty',x),('setlocal',5),
 ('getlocal_0',),('getlocal',5),e.number(0),('getproperty',x),('callproperty',kind,1),('setlocal',6),('getlocal',6),('iffalse','NEXT'),
 ('getlocal_1',),('getlocal',5),e.number(1),('getproperty',x),('multiply',),('getlocal_2',),('getlocal',5),e.number(2),('getproperty',x),('multiply',),('getlocal',5),e.number(3),('getproperty',x),('multiply',),('add',),e.number(10000),('divide',),('setlocal',7),('getlocal',7),e.number(0),('ifeq','NEXT'),
 ('getlex',q(MEMBER)),('getlocal_0',),('getlocal',6),('callproperty',queue,2),('setlocal',8),('getlocal',8),e.number(3),('getlocal',8),e.number(3),('getproperty',x),('getlocal',7),('add',),('setproperty',x),
 ('label','NEXT'),('inclocal_i',4),('label','CHECK'),('getlocal',4),('getlocal_3',),('getproperty',q('length')),('iflt','LOOP'),('returnvoid',)]
 return e.add_method(MEMBER,'wfxHealDamageRecord','void',['Number','Number'],code,9)
