"""沿原生可达状态预载检测码36，仅有码36时补合击类型及持有者属性路径。"""
import json
from pathlib import Path
import asm

PARTY = 'pinball.common.data.party::BattlePartyLogic'
UC = 'pinball.common.data.character.condition::UniqueConditionLogic'
TABLE = 'pinball.master.generated::PowerFlipActionTable'
TRIGGERS = 'pinball.common.data.ability::AbilityTriggerTools'
TARGETS = ['BattlePartyLogic/resolvePathCollection', 'UniqueConditionLogic/wfxSuperPreload']
LOCKS = json.loads(Path(__file__).with_name('target-locks.json').read_text(encoding='utf-8'))


def build(e):
    q = e.q
    m = next(i for i, x in enumerate(e.abc.multinames) if x and x[0] == 0x1b)
    builder = e.add_slot(PARTY, 'wfxPfPreloadBuilder', 'Object', static=True)
    seen = e.add_slot(PARTY, 'wfxPfPreloadSeen', 'Boolean', static=True)
    finish = e.newq('wfxPfPreloadFinish')
    ability = e.newq('wfxPfPreloadAbility')
    typepaths = e.newq('wfxPfPreloadType')

    # The native path walker determines whether a status is reachable. No full-table
    # scan, no new data lookup, and no assumption about a particular character UID.
    e.insert(TARGETS[0], 2, [
        ('getlex', q(PARTY)), ('getlocal_1',), ('setproperty', builder),
        ('getlex', q(PARTY)), ('pushfalse',), ('setproperty', seen)])
    e.insert(TARGETS[0], 60, [
        ('getlocal_0',), ('getlocal_1',), ('getlocal_2',), ('getlocal_3',),
        ('callpropvoid', finish, 3)])
    # Existing wfxSuperPreload already parses safely and has spec in local3 here.
    e.insert(TARGETS[1], 10, [
        ('getlocal_3',), ('pushbyte', 0), ('getproperty', m), ('pushbyte', 36),
        ('ifne', 'PF_PRELOAD_NATIVE'), ('getlex', q(PARTY)), ('getproperty', builder),
        ('getlocal_1',), ('ifstrictne', 'PF_PRELOAD_NATIVE'),
        ('getlex', q(PARTY)), ('pushtrue',), ('setproperty', seen),
        ('label', 'PF_PRELOAD_NATIVE')])

    # ability, paths, owner, permit, effective holder element
    code = [
        ('getlocal_0',), ('pushscope',), ('getlocal_1',), ('callproperty', q('getTriggers'), 0),
        ('setlocal', 6), ('pushbyte', 0), ('setlocal', 7),
        ('label', 'LOOP'), ('avm_label',), ('getlocal', 7), ('getlocal', 6),
        ('getproperty', q('length')), ('ifge', 'DONE'),
        ('getlex', q(TRIGGERS)), ('getlocal', 6), ('getlocal', 7), ('getproperty', m),
        ('getlocal_2',), ('getlocal_3',), ('getlocal', 4), ('getlocal', 5),
        ('getlocal_0',), ('getproperty', q('logicAssets')),
        ('callpropvoid', q('resolvePathCollection'), 6), ('inclocal_i', 7), ('jump', 'LOOP'),
        ('label', 'DONE'), ('returnvoid',)]
    e.add_method(PARTY, 'wfxPfPreloadAbility', 'void',
                 ['Object', 'Object', 'Object', 'Object', 'int'], code, 8)

    # unison CharacterLogic, paths, effective holder element. Safe optional master read.
    code = [
        ('getlocal_0',), ('pushscope',), ('getlocal_0',), ('getproperty', q('logicAssets')),
        ('getlex', q(TABLE)),
        ('callproperty', q('pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe'), 1),
        ('astype', q(TABLE)), ('setlocal', 4), ('getlocal', 4), ('iffalse', 'DONE'),
        ('getlocal', 4), ('callproperty', q('get_data'), 0), ('setlocal', 4),
        ('getlocal_1',), ('getproperty', q('powerFlipActionId')), ('setlocal', 5),
        ('getlocal', 4), ('getlocal', 5),
        ('callproperty', q('pinball.master.runtime:MasterMap::exists'), 1), ('iffalse', 'DONE'),
        ('getlocal', 4), ('getlocal', 5),
        ('callproperty', q('pinball.master.runtime:MasterMap::get'), 1), ('setlocal', 4)]
    for field in ('power_flip_action1', 'power_flip_action2', 'power_flip_action3'):
        code += [
            ('getlocal_2',), ('getlocal', 4), ('getproperty', q(field)), e.string(':'),
            ('add',), ('getlocal_3',), ('add',), ('pushnull',),
            ('callpropvoid', q('pinball.asset.logic:IAssetPathCollectionBuilder::addActionDsl'), 2)]
    code += [('label', 'DONE'), ('returnvoid',)]
    e.add_method(PARTY, 'wfxPfPreloadType', 'void', ['Object', 'Object', 'int'], code, 6)

    # paths, owner, permit. Clear the scoped detection before supplemental traversal,
    # so that a second party or status-only preload cannot inherit a previous result.
    code = [
        ('getlocal_0',), ('pushscope',), ('getlex', q(PARTY)), ('getproperty', builder),
        ('getlocal_1',), ('ifstrictne', 'DONE'),
        ('getlex', q(PARTY)), ('getproperty', seen), ('setlocal', 4),
        ('getlex', q(PARTY)), ('pushnull',), ('setproperty', builder),
        ('getlex', q(PARTY)), ('pushfalse',), ('setproperty', seen),
        ('getlocal', 4), ('iffalse', 'DONE'),
        ('getlocal_0',), ('callproperty', q('getUnitedCharacterPeeks'), 0), ('setlocal', 4),
        ('pushbyte', 0), ('setlocal', 5),
        ('label', 'MAIN'), ('avm_label',), ('getlocal', 5), ('getlocal', 4),
        ('getproperty', q('length')), ('ifge', 'DONE'),
        ('getlocal', 4), ('getlocal', 5), ('getproperty', m), ('setlocal', 6),
        ('getlocal', 6), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'NEXT_MAIN'),
        ('getlocal', 6), ('getproperty', q('params')), ('pushbyte', 0), ('getproperty', m),
        ('setlocal', 6), ('getlocal', 6), ('callproperty', q('get_unisonCharacter'), 0),
        ('setlocal', 7), ('getlocal', 7), ('getproperty', q('index')), ('pushbyte', 0),
        ('ifne', 'NEXT_MAIN'),
        ('getlocal', 6), ('callproperty', q('get_element'), 0), ('setlocal', 8),
        ('getlocal_0',), ('getlocal', 7), ('getproperty', q('params')), ('pushbyte', 0),
        ('getproperty', m), ('getlocal_1',), ('getlocal', 8), ('callpropvoid', typepaths, 3),
        ('getlocal', 6), ('callproperty', q('getBattleAbilities'), 0), ('setlocal', 9),
        ('pushbyte', 0), ('setlocal', 10),
        ('label', 'ABILITY'), ('avm_label',), ('getlocal', 10), ('getlocal', 9),
        ('getproperty', q('length')), ('ifge', 'LEADERS'),
        ('getlocal_0',), ('getlocal', 9), ('getlocal', 10), ('getproperty', m),
        ('getlocal_1',), ('getlocal_2',), ('getlocal_3',), ('getlocal', 8),
        ('callpropvoid', ability, 5), ('inclocal_i', 10), ('jump', 'ABILITY'),
        ('label', 'LEADERS'), ('getlocal', 6), ('callproperty', q('wfxExtraLeaders'), 0),
        ('setlocal', 9), ('pushbyte', 0), ('setlocal', 10),
        ('label', 'LEADER'), ('avm_label',), ('getlocal', 10), ('getlocal', 9),
        ('getproperty', q('length')), ('ifge', 'NEXT_MAIN'),
        ('getlocal_0',), ('getlocal', 9), ('getlocal', 10), ('getproperty', m),
        ('pushbyte', 1), ('getproperty', m),
        ('getlocal_1',), ('getlocal_2',), ('getlocal_3',), ('getlocal', 8),
        ('callpropvoid', ability, 5), ('inclocal_i', 10), ('jump', 'LEADER'),
        ('label', 'NEXT_MAIN'), ('inclocal_i', 5), ('jump', 'MAIN'),
        ('label', 'DONE'), ('returnvoid',)]
    e.add_method(PARTY, 'wfxPfPreloadFinish', 'void', ['Object', 'Object', 'Object'], code, 11)
    return {'targets': TARGETS, 'slots': ['wfxPfPreloadBuilder', 'wfxPfPreloadSeen']}
