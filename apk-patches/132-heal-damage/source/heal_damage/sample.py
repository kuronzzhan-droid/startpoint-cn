"""码30共享采样；只读原生Decimal100总量与有效量。"""
from .symbols import MEMBER

def install(e,m,record):
 q,x=m['q'],m['x']
 code=[('getlocal_0',),('pushscope',),('getlocal_3',),e.number(0),('ifngt','DONE'),
 ('getlocal_1',),('getproperty',q('createdByCoopCommand')),('iftrue','DONE'),
 ('getlocal_2',),('getproperty',q('isHealRejected')),('iftrue','DONE'),
 ('getlocal_2',),('getproperty',q('isFromHostile')),('iftrue','DONE'),
 ('getlocal_2',),('getproperty',q('createdBySummonsMultiBall')),('iftrue','DONE'),
 ('getlocal_2',),('getproperty',q('statsBattleId')),('getlocal_0',),('getproperty',q('battle')),('callproperty',q('get_id'),0),('ifne','DONE'),
 ('getlocal_2',),('getproperty',q('originMemberIndex')),('convert_i',),('setlocal',6),('getlocal',6),e.number(0),('iflt','DONE'),
 ('getlocal_0',),('getproperty',q('squadManager')),('getproperty',q('primary')),('getlocal',6),('callproperty',m['exact']('pinball.scene.battle.battle.squad:Squad::getMember'),1),('setlocal',6),
 ('getlocal',6),('iffalse','DONE'),('getlocal',6),('getproperty',q('index')),('iftrue','DONE'),
 ('getlocal',6),('getproperty',q('params')),e.number(0),('getproperty',x),('setlocal',6),('getlocal',6),('iffalse','DONE'),
 ('getlocal',5),e.number(0),('ifngt','DONE'),
 ('getlocal',4),('getlocal',5),('divide',),e.number(100),('multiply',),('setlocal',7),
 ('getlocal_3',),('getlocal',4),('subtract',),('getlocal',5),('divide',),e.number(100),('multiply',),('setlocal',8),
 ('getlocal',6),('getlocal',7),('getlocal',8),('callpropvoid',record,2),
 ('getlocal',6),('getlocal',7),('getlocal',8),('callpropvoid',e.newq('wfxHealFever'),2),('label','DONE'),('returnvoid',)]
 return e.add_method(MEMBER,'wfxHealSample','void',['*','*','Number','Number','Number'],code,9)
