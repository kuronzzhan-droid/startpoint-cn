"""按battle隔离、slot+gid识别的E/S状态；叠层替换Condition时保留同段累计。"""
from .symbols import SLOT,MEMBER

def install(e,m):
 q,x=m['q'],m['x']
 battle=e.add_slot(SLOT,'wfxSuperBattle','Object',static=True)
 states=e.add_slot(SLOT,'wfxSuperStates','Array',static=True)
 # entry(condition): [slot,gid,spec,amount,active,condition]
 code=[('getlocal_0',),('pushscope',),('getlocal_1',),('iffalse','NONE'),
 ('getlocal_0',),('getproperty',q('ownerMember')),('setlocal_2',),('getlocal_2',),('iffalse','NONE'),
 ('getlocal_2',),('getproperty',q('battle')),('callproperty',q('__isMyBattle__'),0),('iffalse','NONE'),
 ('getlocal_2',),('callproperty',q('isInPrimarySquad'),0),('iffalse','NONE'),
 ('getlocal_2',),('callproperty',q('isMultiball'),0),('iftrue','NONE'),
 ('getlocal_1',),('getproperty',q('content')),('setlocal_3',),
 ('getlocal_3',),('getproperty',q('index')),e.number(31),('ifne','NONE'),
 ('getlex',q(SLOT)),('getlocal_3',),('getproperty',q('params')),e.number(0),('getproperty',x),
 ('getlocal_0',),('getproperty',q('asset')),('callproperty',q('wfxSpec'),2),('setlocal_3',),
 ('getlocal_3',),('iffalse','NONE'),('getlocal_3',),e.number(0),('getproperty',x),e.number(60),('ifeq','VALID'),
 ('getlocal_3',),e.number(0),('getproperty',x),e.number(61),('ifne','NONE'),
 ('getlocal_2',),('callproperty',q('isLeader'),0),('iffalse','NONE'),
 ('label','VALID'),('getlocal_0',),('getproperty',q('squadManager')),('getproperty',q('battle')),('setlocal',4),
 ('getlex',q(SLOT)),('getproperty',battle),('getlocal',4),('ifstricteq','READY'),
 ('getlex',q(SLOT)),('getlocal',4),('setproperty',battle),('getlex',q(SLOT)),('newarray',0),('setproperty',states),
 ('label','READY'),('getlex',q(SLOT)),('getproperty',states),('setlocal',4),e.number(0),('setlocal',5),('jump','CHECK'),
 ('label','LOOP'),('avm_label',),('getlocal',4),('getlocal',5),('getproperty',x),('setlocal',6),
 ('getlocal',6),e.number(0),('getproperty',x),('getlocal_0',),('ifstrictne','NEXT'),
 ('getlocal',6),e.number(1),('getproperty',x),('getlocal_1',),('getproperty',q('id')),('ifne','NEXT'),
 ('getlocal',6),e.number(4),('getproperty',x),('iftrue','FOUND'),
 ('getlocal',6),e.number(5),('getproperty',x),('getlocal_1',),('ifstricteq','NONE'),
 ('getlocal',6),e.number(3),e.number(0),('setproperty',x),('getlocal',6),e.number(4),('pushtrue',),('setproperty',x),
 ('label','FOUND'),('getlocal',6),e.number(5),('getlocal_1',),('setproperty',x),
 ('getlocal',6),e.number(2),('getlocal_3',),('setproperty',x),('getlocal',6),('returnvalue',),
 ('label','NEXT'),('inclocal_i',5),('label','CHECK'),('getlocal',5),('getlocal',4),('getproperty',q('length')),('iflt','LOOP'),
 ('getlocal_0',),('getlocal_1',),('getproperty',q('id')),('getlocal_3',),e.number(0),('pushtrue',),('getlocal_1',),('newarray',6),('setlocal',6),
 ('getlocal',4),('getlocal',6),('callpropvoid',m['push'],1),('getlocal',6),('returnvalue',),
 ('label','NONE'),('pushnull',),('returnvalue',)]
 entry=e.add_method(SLOT,'wfxSuperEntry','Array',['*'],code,7)
 return dict(entry=entry,battle=battle,states=states)

def install_record(e,m,s):
 q,x=m['q'],m['x']
 # Walk actual leader slot, so S present before cache creation is not lost.
 code=[('getlocal_0',),('pushscope',),('getlocal_1',),e.number(0),('ifngt','DONE'),
 ('getlocal_0',),('callproperty',q('isLeader'),0),('iffalse','DONE'),
 ('getlocal_0',),('getproperty',q('conditionSlot')),('setlocal_2',),
 ('getlocal_2',),('getproperty',q('conditions')),('getproperty',q('_keys')),('setlocal_3',),e.number(0),('setlocal',4),('jump','CHECK'),
 ('label','LOOP'),('avm_label',),('getlocal_2',),('getlocal_2',),('getproperty',q('conditions')),('getproperty',q('map')),
 ('getlocal_3',),('getlocal',4),('getproperty',x),('callproperty',q('get'),1),('callproperty',s['entry'],1),('setlocal',5),
 ('getlocal',5),('iffalse','NEXT'),('getlocal',5),e.number(2),('getproperty',x),e.number(0),('getproperty',x),e.number(61),('ifne','NEXT'),
 ('getlocal',5),e.number(3),('getlocal',5),e.number(3),('getproperty',x),('getlocal_1',),('add',),('setproperty',x),
 ('label','NEXT'),('inclocal_i',4),('label','CHECK'),('getlocal',4),('getlocal_3',),('getproperty',q('length')),('iflt','LOOP'),
 ('label','DONE'),('returnvoid',)]
 return e.add_method(MEMBER,'wfxSuperRecordDamage','void',['Number'],code,6)
