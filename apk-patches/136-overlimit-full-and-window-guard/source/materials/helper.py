"""全程超限共用判定；已有 GeneralCharacterLogic 上追加实例助手。"""
import asm

HELPER='GeneralCharacterLogic/wfxOverlimitFull'
CLASS='pinball.common.data.character::GeneralCharacterLogic'
TABLE='pinball.master.generated::CustomAbilityStringTable'


def install(e):
    q=e.q
    def exact(name):
        hits=[i for i,x in enumerate(e.abc.multinames) if i and x[0]==7 and e.abc.mn_name(i)==name]
        if len(hits)!=1:raise asm.AsmError('full helper symbol: '+name)
        return hits[0]
    # 与 O1 相同的数组下标 multiname；只查询已有池。
    o1=asm.decode(e.body('GeneralCharacterLogic/get_maxOverLimitStep')[5])
    dyn=[x.args[0] for x in o1 if x.name=='getproperty' and e.abc.multinames[x.args[0]][0]==0x1b]
    assert len(dyn)==1
    code=[
      ('getlocal_0',),('pushscope',),
      ('getlocal_0',),('callproperty',q('get_rarity'),0),('convert_i',),('pushbyte',5),('ifne','NO'),
      e.string('overLimitStep'),('getlocal_0',),('in',),('iffalse','NO'),
      ('getlocal_0',),('getproperty',q('overLimitStep')),('convert_i',),('pushbyte',0),('iflt','NO'),
      ('getlocal_0',),('getproperty',q('baseStatusLogic')),('getproperty',q('keyLevels')),('setlocal_1',),
      ('getlocal_1',),('getproperty',q('length')),('convert_i',),('pushbyte',1),('iflt','NO'),
      ('getlocal_1',),('getlocal_1',),('getproperty',q('length')),('convert_i',),('pushbyte',1),('subtract',),
      ('getproperty',dyn[0]),('convert_i',),('pushbyte',120),('iflt','NO'),
      ('getlocal_0',),('getproperty',q('logicAssets')),('setlocal_1',),('getlocal_1',),('iffalse','NO'),
      ('getlocal_1',),('getlex',q(TABLE)),
      ('callproperty',exact('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'),1),
      ('astype',q(TABLE)),('setlocal_1',),('getlocal_1',),('iffalse','NO'),
      ('getlocal_1',),('callproperty',q('get_data'),0),('setlocal_1',),
      e.string('wfx_overlimit_full_'),('getlocal_0',),('getproperty',q('id')),('add',),('coerce_s',),('setlocal_2',),
      ('getlocal_1',),('getlocal_2',),('callproperty',exact('pinball.master.runtime:MasterMap::exists'),1),('iffalse','NO'),
      ('getlocal_1',),('getlocal_2',),('callproperty',exact('pinball.master.runtime:MasterMap::get'),1),
      ('getproperty',q('string')),e.string('1'),('ifstrictne','NO'),
      ('pushtrue',),('returnvalue',),('label','NO'),('pushfalse',),('returnvalue',),
    ]
    return e.add_method(CLASS,'wfxOverlimitFull','Boolean',[],code,3)
