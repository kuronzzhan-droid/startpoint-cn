"""每场缓存队长stance；既有主表类Maybe、exists/get守卫。"""
from .symbols import MEMBER

def install(e,m):
 q,x=m['q'],m['x']; battle=e.add_slot(MEMBER,'wfxHealStanceBattle','Object',static=True); kind=e.add_slot(MEMBER,'wfxHealStanceKind','int',static=True)
 code=[('getlocal_0',),('pushscope',),('getlocal_1',),e.number(1),('iflt','AUTO'),('getlocal_1',),e.number(4),('ifgt','INVALID'),('getlocal_1',),('returnvalue',),
 ('label','AUTO'),('getlocal_1',),e.number(0),('ifne','INVALID'),('getlex',q(MEMBER)),('getproperty',battle),('getlocal_0',),('getproperty',q('battle')),('ifstrictne','READ'),('getlex',q(MEMBER)),('getproperty',kind),('returnvalue',),
 ('label','READ'),('getlex',q(MEMBER)),('getlocal_0',),('getproperty',q('battle')),('setproperty',battle),('getlex',q(MEMBER)),e.number(4),('setproperty',kind),
 ('getlocal_0',),('getproperty',q('conditionSlot')),('getproperty',q('asset')),('getlex',q('pinball.master.generated::CharacterStanceDetailTable')),('callproperty',q('getMasterTableMaybe'),1),('setlocal_2',),('getlocal_2',),('iffalse','RESULT'),('getlocal_2',),('callproperty',q('get_data'),0),('setlocal_2',),
 ('getlocal_0',),('getproperty',q('battle')),('getproperty',q('initialData')),('callproperty',q('get_leaderCharacterId'),0),('setlocal_3',),('getlocal_2',),('getlocal_3',),('callproperty',q('exists'),1),('iffalse','RESULT'),('getlocal_2',),('getlocal_3',),('callproperty',q('get'),1),('getproperty',q('main_stance')),('setlocal_2',),('getlocal_2',),('iffalse','RESULT'),('getlocal_2',),('getproperty',q('concepts')),('setlocal_2',),('getlocal_2',),('iffalse','RESULT'),('getlocal_2',),('getproperty',q('length')),('iffalse','RESULT'),('getlocal_2',),e.number(0),('getproperty',x),('convert_i',),('setlocal_3',),('getlocal_3',),e.number(1),('iflt','RESULT'),('getlocal_3',),e.number(4),('ifgt','RESULT'),('getlex',q(MEMBER)),('getlocal_3',),('setproperty',kind),
 ('label','RESULT'),('getlex',q(MEMBER)),('getproperty',kind),('returnvalue',),('label','INVALID'),e.number(0),('returnvalue',)]
 return e.add_method(MEMBER,'wfxHealDamageKind','int',['int'],code,4)
