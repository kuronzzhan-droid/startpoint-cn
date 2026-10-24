"""第二版与第三版真实事件轨迹规范 JSON 字节对照；不含对象标识符。"""
import json
from .runtime import World
from .cases import TABLE


def encoded(world):
    return json.dumps(world.snapshot(), ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def compare(before, after, table, codes, heals, *, hp=0, layers=1, second=False):
    result = []
    for abc in (before, after):
        world = World(abc, table)
        world.unit([world.condition(code, layers) for code in codes])
        recipient = world.unit(hp=hp)
        if second:
            world.unit([world.condition(code, 2) for code in codes])
        for wait, amount, flags in heals:
            world.tick(wait)
            world.heal(recipient, amount, **flags)
        world.tick(40)
        result.append(encoded(world))
    assert result[0] == result[1], ('pre-ct-json-byte-parity', codes, table, heals, hp, layers, second)


def suite(before, after):
    checks = []
    events = [(0, 4.9, {'origin': -1}), (0, 5, {'origin': -1}),
              (29, 12, {'origin': 0}), (1, 7, {'origin': 0}),
              (10, 20, {'statsBattleId': 'remote-source', 'createdByCoopCommand': True}),
              (20, 3, {'origin': -1}), (100, 10, {'origin': -1})]
    # All legal classification digits, representative continuous/quantized steps,
    # and values near the new 1000 boundary retain complete second-edition traces.
    for step in (0, 1, 5, 29, 99):
        for kind in range(5):
            arg = step * 10 + kind
            table = {**TABLE, 34: f'wfx:34:{arg}:100000:150000:legacy_arg'}
            for codes, hp, layers, second in [((34,), 0, 1, False),
                                              ((30, 31, 34, 35), 97, 2, True)]:
                compare(before, after, table, codes, events, hp=hp, layers=layers, second=second)
                checks.append(f'pre-ct.byte-parity.arg{arg}.codes{codes}.hp{hp}.layers{layers}.second{second}')
    # Code 35 keeps floor(arg/10), including arg>=1000; CT decoding belongs only to 34.
    for arg in (0, 4, 10, 50, 990, 1000, 1050, 5050, 9990):
        table = {**TABLE, 35: f'wfx:35:{arg}:500:1000:fever_original',
                 36: f'wfx:35:{arg}:1000:2000:fever_second'}
        for hp in (0, 97, 100):
            compare(before, after, table, (31, 35, 36), events, hp=hp, layers=2, second=True)
            checks.append(f'pre-ct.byte-parity.multiple-code35.arg{arg}.hp{hp}')
    for flags in ({'isHealRejected': True}, {'createdByCoopCommand': True},
                  {'statsBattleId': 'remote-source'}, {'isFromHostile': True},
                  {'createdBySummonsMultiBall': True}, {'origin': -1}):
        compare(before, after, TABLE, (30, 31, 34, 35), [(0, 10, flags)])
        checks.append('pre-ct.byte-parity.source-filter.' + str(flags))
    return checks
