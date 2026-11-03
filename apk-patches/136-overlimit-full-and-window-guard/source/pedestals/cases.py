"""旧行为真实字节码对照与新判据边界。"""
from .runtime import capture, world

ALL_IDS = [12998901, 12998902, 12998921, 12998922, 12998931]


def expected(kind, *, owned=True, player=True, rarity=5):
    result = ['character_pedestal/water_' + str(kind),
              'character_pedestal/water_' + str(kind) + '_half']
    other = result if owned and player else ['character_pedestal/water_' + str(rarity),
                                           'character_pedestal/water_' + str(rarity) + '_half']
    return result + other


def parity(before, after, comprehensive=True):
    checks = 0
    for cid, rarity, highest in [(140001, 5, 100), (111183, 5, 120),
                                (141099, 5, 120), (129989, 5, 120), (140002, 4, 120)]:
        for step in (range(9) if comprehensive else (0, 4, 5, 8)):
            for level in (119, 120):
                for awake in (0, 1):
                    for learned in (ALL_IDS, ALL_IDS[:-1], []):
                        args = dict(cid=cid, rarity=rarity, highest=highest, step=step,
                                    level=level, key=None, awake=awake, learned=learned)
                        old = capture(before, **args)[0]
                        new = capture(after, **args)[0]
                        assert new == old, ('无键台座差异', args, old, new)
                        checks += len(old)
    # 数据类型、非超限/非星5、未持有入口均执行原生方法对照。
    for params in ({'key': '0'}, {'key': ''}, {'key': 1}, {'key': '01'},
                   {'rarity': 4}, {'highest': 119}, {'step': -1},
                   {'full_loaded': False}, {'owned': False, 'key': None},
                   {'player': False, 'key': None}):
        assert capture(after, **params)[0] == capture(before, **params)[0], params
        checks += 4
    return checks


def scenarios(after, comprehensive=True):
    checks = 0

    def equal(params, kind):
        nonlocal checks
        actual = capture(after, **params)[0]
        want = expected(kind, owned=params.get('owned', True), player=params.get('player', True))
        assert actual == want, ('有键台座', params, actual, want)
        checks += len(want)

    # 每个未学节点单独删去；包含尚未开放的第2/3盘。
    learning = [ALL_IDS, [], *[[n for n in ALL_IDS if n != missing] for missing in ALL_IDS]]
    for step in range(9):
        for level in ((80, 119, 120, 121) if comprehensive else (119, 120)):
            for learned in learning:
                for awake in (0, 1):
                    equal(dict(step=step, level=level, learned=learned, awake=awake),
                          7 if step >= 8 and level >= 120 and learned == ALL_IDS else 6)
    for params in ({'mana_loaded': False}, {'missing_character': True}, {'boards': {}},
                   {'boards': {1: {}}}, {'boards': {1: {11: 12998901}, 2: {}}},
                   {'ghost_board': True}, {'ghost_node': True}, {'has_abilities': False}):
        equal(params, 6)
    for params in ({'owned': False}, {'player': False}):
        equal(params, 7)
    # GeneralCharacterLogic 没有持有数据：helper false，仍原生 _5。
    e, char, general, pixel, reads, events = world(after)
    assert general['wfxOverlimitFull']() is False
    assert general['wfxAllManaNodesLearned']() is False
    assert general['getPedestalImagePath']() == 'character_pedestal/water_5'
    checks += 3
    # 只学习盘1且盘1觉醒：旧条件会满，新条件须因2/3盘未学拒绝。
    equal({'learned': ALL_IDS[:2], 'awake': 1}, 6)
    # 无觉醒数据，但全部盘节点值为0（原生基础已学），可达到 C。
    equal({'awake': 0}, 7)
    return checks
