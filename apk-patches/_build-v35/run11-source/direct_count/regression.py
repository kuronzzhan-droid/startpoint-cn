"""无码33时v35j真实字节码、原解析器与调度输出对照。"""
import itertools
from .cases import Checks
from .runtime import World, schedule


def regression(before, after, overrides=None):
    checks = Checks()
    old_rows = [(24, 0, 3100, 0, 2), (24, 1, 625, 0, 1), (24, 2, 9500, 0, 1),
                (24, 3, 500, 2, 3), (28, 129997, 2700, 1, 2), (29, 129997, 300, 11, 1)]
    rowsets = [[], old_rows, [(25, 0, 1, 0, 1)], old_rows+[(25, 2, 1, 0, 1)],
               [(24, 0, -30000, 0, 1), (24, 1, -625, 0, 1)],
               [(29, 129997, 300, -1, 2)], [(28, 129997, 200, -5, 1)]]
    for index, rows in enumerate(rowsets):
        for native, k, kyle in itertools.product((None, (1, 0), (3, 50000), (6, 90000)), (0, 1, 6), (False, True)):
            kwargs = dict(native=native, debuffs=k, leader=kyle, name='kyle_moon' if kyle else 'other',
                          legacy={13999011: 3, 13999012: 625}, combo=8, targets={129997: 5})
            a, b = World(before), World(after, overrides=overrides)
            actual, expected = schedule(b, rows, **kwargs), schedule(a, rows, **kwargs)
            checks.eq(f'old_schedule.rows{index}.native{native}.k{k}.kyle{kyle}', actual, expected)
            checks.eq(f'old_debuff_query_count.rows{index}.native{native}.k{k}.kyle{kyle}', b.calls['debuff'], a.calls['debuff'])
    # 原解析器对非33全部行为保持；负arg/flags各码边界不能被放宽。
    for code, base, per, cap in itertools.product((0, 24, 25, 26, 28, 29, 30, 31, 32, 34, 35, 71, 999),
                                                 (-1, 0, 2), (-2, 3), (-1, 0, 5)):
        text = f'wfx:{code}:{base}:{per}:{cap}:hidden_old'
        worlds = [World(before, {1: text}), World(after, {1: text}, overrides=overrides)]
        values = [w.run('ConditionSlot$/wfxSpec', w.lex['ConditionSlot'], 1, w.asset) for w in worlds]
        checks.eq('old_parser.' + text, values[1], values[0])
    return checks
