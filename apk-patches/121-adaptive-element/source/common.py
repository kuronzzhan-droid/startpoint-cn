"""第二轮队伍补丁共用符号及原指令定位。"""
import asm

CHAR = 'pinball.common.data.character::BattleCharacterLogic'
TABLE = 'pinball.master.generated::CustomAbilityStringTable'
LEADER_TABLE = 'pinball.master.generated::LeaderAbilityTable'

def sym(e, name):
    hits = [i for i in range(1,len(e.abc.multinames))
            if e.abc.multinames[i][0] == 7 and e.abc.mn_name(i) == name]
    if len(hits) != 1:
        raise asm.AsmError(f'party symbol {name}: {hits}')
    return hits[0]

def dynamic(e):
    return next(i for i in range(1,len(e.abc.multinames)) if e.abc.multinames[i][0] == 0x1b)

def n(e, value):
    if -128 <= value <= 127:
        return [e.number(value)]
    if 0 <= value <= 32767:
        return [('pushshort',value)]
    try:
        return [e.number(value)]
    except asm.AsmError:
        hi,lo = divmod(value,1000)
        return n(e,hi)+[('pushshort',1000),('multiply',)]+n(e,lo)+[('add',),('convert_i',)]

def data_helpers(e):
    q=lambda name:sym(e,name)
    read=e.newq('wfxPartyRead')
    mask=e.newq('wfxPartyMask')
    leader=e.newq('wfxPartyLeader')
    m=dynamic(e)
    e.add_method(CHAR,'wfxPartyRead','String',['String'],[
        ('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',q('logicAssets')),
        ('dup',),('iffalse','EMPTY_ASSET'),('getlex',q(TABLE)),
        ('callproperty',q('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'),1),
        ('astype',q(TABLE)),('setlocal_2',),('getlocal_2',),('iffalse','EMPTY'),
        ('getlocal_2',),('callproperty',q('get_data'),0),('setlocal_2',),
        ('getlocal_2',),('getlocal_1',),('callproperty',q('pinball.master.runtime:MasterMap::exists'),1),
        ('iffalse','EMPTY'),('getlocal_2',),('getlocal_1',),
        ('callproperty',q('pinball.master.runtime:MasterMap::get'),1),
        ('getproperty',q('string')),('coerce_s',),('returnvalue',),
        ('label','EMPTY_ASSET'),('pop',),('label','EMPTY'),('pushnull',),('returnvalue',)
    ],3)
    e.add_method(CHAR,'wfxPartyMask','int',[],[
        ('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',q('party')),('setlocal_1',),
        ('getlocal_1',),('iffalse','ZERO'),('getlocal_1',),('callproperty',q('get_leaderCharacter'),0),
        ('setlocal_1',),('getlocal_1',),('iffalse','ZERO'),('getlocal_1',),
        ('getproperty',q('values')),('getproperty',q('leader_ability')),('setlocal_1',),
        ('getlocal_1',),('getproperty',q('index')),('pushbyte',0),('ifne','ZERO'),
        ('getlocal_0',),e.string('wfx_unlock_'),('getlocal_1',),('getproperty',q('params')),
        ('pushbyte',0),('getproperty',m),('getproperty',q('id')),('add',),
        ('callproperty',read,1),('dup',),('iffalse','POP_ZERO'),('convert_d',),('setlocal_2',),
        ('getlocal_2',),('convert_i',),('getlocal_2',),('ifne','ZERO'),
        ('getlocal_2',),('pushbyte',0),('iflt','ZERO'),('getlocal_2',),('convert_i',),
        ('pushbyte',7),('bitand',),('returnvalue',),
        ('label','POP_ZERO'),('pop',),('label','ZERO'),('pushbyte',0),('returnvalue',)
    ],3)
    # 新解锁路径先检查 leader 表是否就绪、是否有键；原队长路径不改。
    e.add_method(CHAR,'wfxPartyLeader','Object',[],[
        ('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',q('values')),
        ('getproperty',q('leader_ability')),('setlocal_1',),('getlocal_1',),
        ('getproperty',q('index')),('pushbyte',0),('ifne','NONE'),
        ('getlocal_0',),('getproperty',q('logicAssets')),('getlex',q(LEADER_TABLE)),
        ('callproperty',q('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'),1),
        ('astype',q(LEADER_TABLE)),('setlocal_2',),('getlocal_2',),('iffalse','NONE'),
        ('getlocal_2',),('callproperty',q('get_data'),0),('getlocal_1',),('getproperty',q('params')),
        ('pushbyte',0),('getproperty',m),('getproperty',q('id')),
        ('callproperty',q('pinball.master.runtime:MasterMap::exists'),1),('iffalse','NONE'),
        ('getlocal_0',),('callproperty',q('getLeaderAbility'),0),('getproperty',q('params')),
        ('pushbyte',0),('getproperty',m),('returnvalue',),
        ('label','NONE'),('pushnull',),('returnvalue',)
    ],3)
    return dict(read=read,mask=mask,leader=leader,mnl=m)
