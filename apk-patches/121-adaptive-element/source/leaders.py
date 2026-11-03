"""原生队长技分发和原生资源预载复用；自属角色传入 BattleAbilitySource.add。"""
from .common import CHAR,sym,n

def build(e,h):
    q=lambda name:sym(e,name)
    m=h['mnl']; rows=e.newq('wfxExtraLeaders'); add=e.newq('wfxAddExtraLeaders'); preload=e.newq('wfxPreloadExtraLeaders')
    code=[('getlocal_0',),('pushscope',),('newarray',0),('setlocal_1',),
          ('getlocal_0',),('callproperty',h['mask'],0),('setlocal_2',),
          ('getlocal_0',),('getproperty',q('isUnison')),('iftrue','DONE'),
          ('getlocal_0',),('getproperty',q('index')),('pushbyte',0),('ifeq','UNISON'),
          ('getlocal_2',),('pushbyte',4),('bitand',),('iffalse','UNISON'),
          ('getlocal_0',),('callproperty',h['leader'],0),('setlocal_3',),
          ('getlocal_3',),('iffalse','UNISON'),('getlocal_1',),('getlocal_0',),('getlocal_3',),
          *n(e,22000),('getlocal_0',),('getproperty',q('index')),('pushshort',1000),('multiply',),('add',),
          ('newarray',3),('callpropvoid',q('http://adobe.com/AS3/2006/builtin::push'),1),
          ('label','UNISON'),('getlocal_2',),('pushbyte',2),('bitand',),('iffalse','DONE'),
          ('getlocal_0',),('callproperty',q('get_unisonCharacter'),0),('setlocal_3',),
          ('getlocal_3',),('getproperty',q('index')),('pushbyte',0),('ifne','DONE'),
          ('getlocal_3',),('getproperty',q('params')),('pushbyte',0),('getproperty',m),('setlocal_3',),
          ('getlocal_3',),('callproperty',h['leader'],0),('setlocal',4),('getlocal',4),('iffalse','DONE'),
          ('getlocal_1',),('getlocal_3',),('getlocal',4),*n(e,1021000),
          ('getlocal_0',),('getproperty',q('index')),('pushshort',1000),('multiply',),('add',),
          ('newarray',3),('callpropvoid',q('http://adobe.com/AS3/2006/builtin::push'),1),
          ('label','DONE'),('getlocal_1',),('returnvalue',)]
    e.add_method(CHAR,'wfxExtraLeaders','Array',[],code,5)
    # source, party, slot, tutorial, summary mode
    code=[('getlocal_0',),('pushscope',),('getlocal_0',),('callproperty',rows,0),('setlocal',6),
          ('pushbyte',0),('setlocal',7),('label','ROW'),('avm_label',),
          ('getlocal',7),('getlocal',6),('getproperty',q('length')),('ifge','DONE'),
          ('getlocal',6),('getlocal',7),('getproperty',m),('setlocal',8),
          ('getlocal',8),('pushbyte',1),('getproperty',m),('setlocal',9),
          ('getlocal',9),('callproperty',q('getTriggers'),0),('setlocal',10),
          ('getlocal',4),('iftrue','TRIGGERS'),('getlocal_1',),('getlocal',9),('pushfalse',),
          ('callproperty',q('getDescription'),1),('setproperty',q('abilityDescription')),
          ('label','TRIGGERS'),('pushbyte',0),('setlocal',11),('label','TRIGGER'),('avm_label',),
          ('getlocal',11),('getlocal',10),('getproperty',q('length')),('ifge','NEXT'),
          ('getlocal_1',),('getlocal',8),('pushbyte',2),('getproperty',m),('getlocal',11),('add',),
          ('convert_i',),('getlocal',10),('getlocal',11),('getproperty',m),
          ('getlocal',8),('pushbyte',0),('getproperty',m),('getlocal_2',),('getlocal_3',),('getlocal',5),
          ('callpropvoid',q('add'),6),('inclocal_i',11),('jump','TRIGGER'),
          ('label','NEXT'),('inclocal_i',7),('jump','ROW'),('label','DONE'),('returnvoid',)]
    e.add_method(CHAR,'wfxAddExtraLeaders','void',['Object','Object','int','Boolean','Boolean'],code,12)
    code=[('getlocal_0',),('pushscope',),('getlocal_0',),('callproperty',rows,0),('setlocal',4),
          ('pushbyte',0),('setlocal',5),('label','LOOP'),('avm_label',),('getlocal',5),
          ('getlocal',4),('getproperty',q('length')),('ifge','DONE'),('getlocal',4),('getlocal',5),
          ('getproperty',m),('pushbyte',1),('getproperty',m),('getlocal_1',),('getlocal_2',),('getlocal_3',),
          ('callpropvoid',q('resolvePathCollection'),3),('inclocal_i',5),('jump','LOOP'),
          ('label','DONE'),('returnvoid',)]
    e.add_method(CHAR,'wfxPreloadExtraLeaders','void',['Object','Object','Object'],code,6)
    return dict(add=add,preload=preload)
