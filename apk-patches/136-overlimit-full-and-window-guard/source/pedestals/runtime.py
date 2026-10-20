"""执行真实台座/全盘/旧觉醒字节；主表与资源边界用受控夹具。"""
from materials.vm import Harness, VM

_prior_lookup = VM._lookup


def lookup(obj, key):
    name = str(key).split('::')[-1]
    if isinstance(obj, dict) and isinstance(key, (int, float)):
        return obj[int(key)]
    if isinstance(obj, list):
        if name == 'join':
            return lambda sep: str(sep).join(map(str, obj))
        if name == 'indexOf':
            return lambda value: obj.index(value) if value in obj else -1
    return _prior_lookup(obj, key)


VM._lookup = lookup


def master_map(data, reads, name, extra_keys=()):
    checked = set()

    def exists(key):
        reads.append((name, 'exists', key))
        checked.add(key)
        return key in data

    def get(key):
        reads.append((name, 'get', key))
        assert key in checked, 'get 必须先 exists: ' + repr((name, key))
        return data[key]

    return {'exists': exists, 'get': get, 'keys': lambda: list(data) + list(extra_keys),
            'rawKeys': lambda: list(data) + list(extra_keys)}


def world(abc, *, cid=129989, rarity=5, highest=120, step=8, level=120,
          key='1', boards=None, learned=None, awake=0, full_loaded=True,
          mana_loaded=True, owned=True, player=True, has_abilities=True,
          missing_character=False, ghost_board=False, ghost_node=False):
    """节点键刻意不同于 multiplied_id，避免把节点序号误认为学习ID仍通过。"""
    e = Harness(abc, {} if key is None else {'wfx_overlimit_full_' + str(cid): key}, full_loaded)
    reads, events = [], []
    boards = boards if boards is not None else {1: {11: 12998901, 12: 12998902},
                                               2: {21: 12998921, 22: 12998922},
                                               3: {31: 12998931}}
    ids = [node for board in boards.values() for node in board.values()]
    learned = ids if learned is None else learned
    values = {bid: master_map({nid: {'multiplied_id': mid} for nid, mid in nodes.items()},
                             reads, 'nodes:' + str(bid), [999] if ghost_node else [])
              for bid, nodes in boards.items()}
    board_map = master_map(values, reads, 'boards', [999] if ghost_board else [])
    characters = master_map({} if missing_character else {cid: board_map}, reads, 'characters')
    mana_table = {'_type': 'ManaNodeTable', 'get_data': lambda: characters}
    e.lex['ManaNodeTable'] = VM.Cls('ManaNodeTable')
    e.lex['IMap'] = VM.Cls('IMap')
    original_master = e.master

    def master(cls):
        if cls.name == 'ManaNodeTable':
            events.append(('mana_table', mana_loaded))
            return mana_table if mana_loaded else None
        return original_master(cls)

    e.asset['getMasterTableMaybe'] = master
    char = {'_type': 'OwnedCharacterLogic', 'id': cid, 'overLimitStep': step,
            'baseStatusLogic': {'keyLevels': [80, highest]}, 'logicAssets': e.asset,
            'get_rarity': lambda: rarity, 'get_level': lambda: level,
            # 旧觉醒真实方法以同一 abilities.h 检查盘1；这里仅供应原生主表查询边界。
            'getManaBoardAwakeLevel': lambda board: awake,
            'getManaNodeIdsOfManaBoard': lambda board: list(boards.get(board, {}).values()),
            'canManaBoard2Open': lambda: False}
    if has_abilities:
        char['abilities'] = {'h': {nid: 0 if awake == 0 else awake for nid in learned}}
    e.bind(char, 'GeneralCharacterLogic', ['getPedestalImagePath', 'getHalfPedestalImagePath',
                                          'wfxOverlimitFull', 'wfxAllManaNodesLearned'])
    e.bind(char, 'BattleCharacterLogic', ['hasAwakedAllManaNodeOfManaBoard'])
    e.lex['CharacterPedestalImageResolver'] = VM.Cls('CharacterPedestalImageResolver',
        resolveFull=lambda c: 'character_pedestal/water_' + str(rarity),
        resolveHalf=lambda c: 'character_pedestal/water_' + str(rarity) + '_half')
    general = {**char, '_type': 'GeneralCharacterLogic'}
    general.pop('overLimitStep', None)
    general.pop('abilities', None)
    e.bind(general, 'GeneralCharacterLogic', ['getPedestalImagePath', 'getHalfPedestalImagePath',
                                             'wfxOverlimitFull', 'wfxAllManaNodesLearned'])
    owner = {'hasOwnedCharacter': lambda value: owned and value == cid,
             'getOwnedCharacter': lambda value: char}
    pixel = {'character': {'index': 0, 'params': [general]},
             'player': owner if player else None}
    e.bind(pixel, 'PixelArtCharacter', ['getPedestalImagePath'])
    return e, char, general, pixel, reads, events


def capture(abc, **params):
    e, char, general, pixel, reads, events = world(abc, **params)
    paths = [char['getPedestalImagePath'](), char['getHalfPedestalImagePath'](),
             pixel['getPedestalImagePath'](0), pixel['getPedestalImagePath'](1)]
    return paths, e, reads, events
