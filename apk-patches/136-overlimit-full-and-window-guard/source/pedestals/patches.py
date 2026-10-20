"""只拼接 O6/O7；O8 保留原持有角色路由。"""
import copy
import hashlib

import asm
from perf2_core import splice_with_exits

TARGETS = ['GeneralCharacterLogic/getPedestalImagePath',
           'GeneralCharacterLogic/getHalfPedestalImagePath']
HELPER = 'GeneralCharacterLogic/wfxAllManaNodesLearned'
FULL = 'GeneralCharacterLogic/wfxOverlimitFull'
O8 = 'PixelArtCharacter/getPedestalImagePath'
LOCKS = {
    TARGETS[0]: {'sha': '1c5905b65f624a24c01cf58adeeb90c300a9e9ae965577c4b295c093f0be117d', 'header': [3, 3, 1, 2]},
    TARGETS[1]: {'sha': '0dc8e515702c2c3c77cca60549da8e063eec0785f89a57e503b5ddf41be6a28a', 'header': [3, 3, 1, 2]},
}
DONORS = {
    'GeneralCharacterLogic/getManaNodeIdsOfManaBoard': {'sha': '54020731e63ab30e6b4a445dce0bcfd5f7d7aaf36d53b1e060e08f87277f7b58', 'header': [3, 7, 1, 2]},
    'GeneralCharacterLogic/getManaBoardIndexes': {'sha': '5355f91932bcee7760095d151a9aba0c2873ed63e4b923a4963c40b1d7c597b2', 'header': [2, 6, 1, 2]},
    'BattleCharacterLogic/hasLearnedAllManaNodeOfManaBoard': {'sha': 'fe7cd862fb9a2dffbf6acebb8cd9ed6d8260d5ed83332c84411a6d580303168b', 'header': [2, 8, 6, 7]},
    'BattleCharacterLogic/hasAwakedAllManaNodeOfManaBoard': {'sha': '507cbb08abdf5e05ab150462ec9832bcf950816c405760a312d62495aceeb178', 'header': [2, 9, 6, 7]},
    O8: {'sha': '10eb1e21f915782bcd5715a3fb58670cb18737ae8a5f0f569781f774b1a48f0d', 'header': [3, 5, 1, 2]},
}


def require_lock(e, label, lock):
    b = e.body(label)
    if hashlib.sha256(b[5]).hexdigest() != lock['sha'] or b[1:5] != lock['header']:
        raise asm.AsmError('pedestals unknown v35g SHA/header: ' + label)


def install_learned_helper(e):
    """主表列出应有节点，abilities.h 仅用于验证每个节点是否已学。"""
    def q(name):
        if '::' not in name:
            return e.q(name)
        hits = [i for i, x in enumerate(e.abc.multinames)
                if i and x[0] == 7 and e.abc.mn_name(i) == name]
        if len(hits) != 1:
            raise asm.AsmError('all-node helper symbol: ' + name)
        return hits[0]
    donor = asm.decode(e.body('GeneralCharacterLogic/getManaNodeIdsOfManaBoard')[5])
    table = donor[6].args[0]
    assert e.abc.mn_name(table) == 'pinball.master.generated::ManaNodeTable'
    index = donor[35].args[0]
    assert e.abc.multinames[index][0] == 0x1B
    code = [
        ('getlocal_0',), ('pushscope',),
        e.string('abilities'), ('getlocal_0',), ('in',), ('iffalse', 'FALSE'),
        ('getlocal_0',), ('getproperty', q('abilities')), ('iffalse', 'FALSE'),
        ('getlocal_0',), ('getproperty', q('logicAssets')), ('setlocal_1',),
        ('getlocal_1',), ('iffalse', 'FALSE'),
        ('getlocal_1',), ('getlex', table),
        ('callproperty', q('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'), 1),
        ('setlocal_1',), ('getlocal_1',), ('iffalse', 'FALSE'),
        ('getlocal_1',), ('callproperty', q('get_data'), 0), ('setlocal_1',),
        ('getlocal_1',), ('getlocal_0',), ('getproperty', q('id')),
        ('callproperty', q('pinball.master.runtime:MasterMap::exists'), 1), ('iffalse', 'FALSE'),
        ('getlocal_1',), ('getlocal_0',), ('getproperty', q('id')),
        ('callproperty', q('pinball.master.runtime:MasterMap::get'), 1), ('setlocal_2',),
        ('getlocal_2',), ('callproperty', q('pinball.master.runtime:MasterMap::keys'), 0), ('setlocal_3',),
        ('getlocal_3',), ('getproperty', q('length')), ('pushbyte', 0), ('ifle', 'FALSE'),
        ('pushbyte', 0), ('setlocal', 4), ('jump', 'BOARD_TEST'),
        ('label', 'BOARD'), ('avm_label',),
        ('getlocal_3',), ('getlocal', 4), ('getproperty', index), ('setlocal', 5),
        ('getlocal_2',), ('getlocal', 5),
        ('callproperty', q('pinball.master.runtime:MasterMap::exists'), 1), ('iffalse', 'FALSE'),
        ('getlocal_2',), ('getlocal', 5),
        ('callproperty', q('pinball.master.runtime:MasterMap::get'), 1), ('setlocal', 6),
        ('getlocal', 6), ('callproperty', q('pinball.master.runtime:MasterMap::rawKeys'), 0), ('setlocal', 7),
        ('getlocal', 7), ('getproperty', q('length')), ('pushbyte', 0), ('ifle', 'FALSE'),
        ('pushbyte', 0), ('setlocal', 8), ('jump', 'NODE_TEST'),
        ('label', 'NODE'), ('avm_label',),
        ('getlocal', 7), ('getlocal', 8), ('getproperty', index), ('setlocal', 9),
        ('getlocal', 6), ('getlocal', 9),
        ('callproperty', q('pinball.master.runtime:MasterMap::exists'), 1), ('iffalse', 'FALSE'),
        ('getlocal', 6), ('getlocal', 9),
        ('callproperty', q('pinball.master.runtime:MasterMap::get'), 1),
        ('getproperty', q('multiplied_id')), ('getlocal_0',),
        ('getproperty', q('abilities')), ('getproperty', q('h')), ('in',), ('iffalse', 'FALSE'),
        ('inclocal_i', 8),
        ('label', 'NODE_TEST'),
        ('getlocal', 8), ('getlocal', 7), ('getproperty', q('length')), ('iflt', 'NODE'),
        ('inclocal_i', 4),
        ('label', 'BOARD_TEST'),
        ('getlocal', 4), ('getlocal_3',), ('getproperty', q('length')), ('iflt', 'BOARD'),
        ('pushtrue',), ('returnvalue',),
        ('label', 'FALSE'), ('pushfalse',), ('returnvalue',),
    ]
    return e.add_method('pinball.common.data.character::GeneralCharacterLogic',
                        'wfxAllManaNodesLearned', 'Boolean', [], code, 10)


def build(e):
    for label, lock in {**LOCKS, **DONORS}.items():
        require_lock(e, label, lock)
    full = e.q('wfxOverlimitFull')  # materials 先追加同一实例助手。
    learned = install_learned_helper(e)
    for label in TARGETS:
        original = e.body(label)
        working = copy.deepcopy(original)
        # 满级后：有键查全盘学习，无键落回完整原觉醒分支。
        high = [('getlocal_3',), ('iffalse', 'OLD_AWAKE'),
                ('getlocal_0',), ('callproperty', learned, 0), ('iffalse', 'SWAP'),
                ('jump', 'C')]
        raw, exc, _, high_n = splice_with_exits(working, 33, high,
                                              {'OLD_AWAKE': 33, 'SWAP': 39, 'C': 37})
        working[5], working[6] = raw, exc
        # 已经由旧代码确定 rarity==5 且 step 字段存在；false 继续原 step>4 门槛。
        low = [('getlocal_0',), ('callproperty', full, 0), ('setlocal_3',),
               ('getlocal_3',), ('iftrue', 'MODE')]
        raw, exc, _, low_n = splice_with_exits(working, 16, low, {'MODE': 21})
        recovery = [(16, low_n, asm.FORBID), (33 + low_n, high_n, asm.FORBID)]
        if asm.unsplice_many(raw, recovery) != original[5]:
            raise asm.AsmError('pedestal original bytes did not recover: ' + label)
        e.replace(label, raw, exc)
        e.report[label]['insertions'] = recovery
        e.report[label]['pedestal'] = {'full_helper': FULL, 'all_nodes_helper': HELPER,
                                      'original_bytes_exactly_recoverable': True}
    return {'capability': 'wfx-overlimit-full-pedestals-v1', 'targets': TARGETS,
            'new_helper': HELPER, 'unchanged_o8': O8,
            'learned_source': 'same owned character abilities.h; all ManaNodeTable boards/nodes',
            'no_awake_required_for_full_key': True}
