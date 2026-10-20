"""旧输入按完整方法的返回和副作用逐项对照 v35c，并核对新目标查询为零。"""
from .runtime import World, prepare, schedule


def regression(before, after, overrides=None):
    names = []
    samples = [[], [(24, 0, 10000, 0, 1)], [(24, 1, 625, 0, 2)],
               [(24, 2, 9500, 0, 1)], [(24, 3, 500, 11, 2)],
               [(24, 0, -20000, 0, 1), (24, 1, -10000, 0, 1)],
               [(24, 0, 10000, 0, 1), (24, 1, -10000, 0, 1)],
               [(24, 8, 10000, 0, 1)], [(25, 2, 0, 0, 1)],
               [(24, 3, 500, 2, 1), (24, 3, 300, 11, 3), (24, 3, 100, 0, 2)]]
    for row_index, rows in enumerate(samples):
        for combo, debuffs in ((0, 0), (1, 1), (8, 2), (20, 20)):
            for segments in (1, 4):
                for kyle in (False, True):
                    outputs, counters = [], []
                    for abc, changes in ((before, None), (after, overrides)):
                        world = World(abc, overrides=changes)
                        conditions = prepare(world, rows)
                        outputs.append(schedule(world, conditions=conditions, combo=combo,
                                                debuffs=debuffs, segments=segments,
                                                leader=kyle, name='kyle_moon' if kyle else 'other',
                                                legacy={13999011: 3, 13999012: 625},
                                                targets={129997: 20}))
                        counters.append(world.calls)
                    assert outputs[0] == outputs[1], (rows, combo, debuffs, segments, kyle, outputs)
                    assert counters[1]['target_unique'] == 0, counters[1]
                    assert counters[0]['debuff'] == counters[1]['debuff'], counters
                    names.append(f'old.schedule.{row_index}.combo{combo}.debuff{debuffs}.segments{segments}.kyle{kyle}')
    # 支持新码负 flags 的必要解析扩展不得改变其它任何码的负 flags 拒绝行为。
    for code in (0, 24, 25, 26, 27, 30, 60, 61, 62, 71):
        for flags in (-2147483648, -7, -1, 0, 1, 2147483647):
            text = f'wfx:{code}:129997:-100:{flags}:parse'
            values = []
            for abc, changes in ((before, None), (after, overrides)):
                w = World(abc, {1: text}, overrides=changes)
                values.append(w.lex['ConditionSlot']['wfxSpec'](1, w.asset))
            assert values[0] == values[1], (text, values)
            names.append(f'old.spec.code{code}.flags{flags}')
    return names
