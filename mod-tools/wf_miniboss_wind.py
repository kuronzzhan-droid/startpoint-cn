"""四位风属性小Boss：贯穿、浮游、防护、怒攻互不复制。"""
from wf_miniboss_rows import event as e, ongoing as o


def rabbit(k):
    pierce = o(30)
    slots = [
        [k.i(211, 50), k.i(26, duration=6, trigger=e(65)),
         k.gain(2, trigger=e(23)), k.gain(trigger=e(65))],
        [k.d(0, 60, pierce), k.d(1, 80, pierce)],
        [*(k.helper(f"claw_lv{n}", trigger=e(62 + n)) for n in (1, 2, 3)),
         k.d(410, 15, pierce), k.d(23, 60, pierce)],
        [k.i(190, 15), k.i(35, 10)],
        [k.team(53, 20), k.i(51, 30)],
        [k.d(2, 60, o(134, uid=k.uid, count=8, limit=1)),
         k.i(211, 5, trigger=e(20, every=20, ct=2, puller=7, group=k.group))],
    ]
    leader = [k.team(32, 100), k.team(33, 140), k.i(190, 20), k.team(211, 30)]
    return k.finish(slots, leader)


def green(k):
    slots = [
        [k.i(211, 50), k.gain(2, trigger=e(23))],
        [k.gain(trigger=e(197, every=4, ct=1)),
         k.team(32, 5, trigger=e(197, every=4, limit=10))],
        [k.d(2, 15), k.d(0, 10)],
        [k.team(36, 10), k.team(205, 15)],
        [k.d(8, 3), k.i(227, 8, trigger=e(23))],
        [k.team(34, 50), k.team(694, 15), k.i(35, 10)],
    ]
    leader = [k.team(32, 80), k.team(34, 100), k.team(205, 25), k.team(36, 10)]
    return k.finish(slots, leader)


def armor(k):
    flying = o(31)
    slots = [
        [k.i(211, 50), k.gain(2, trigger=e(23)),
         k.gain(trigger=e(52, ct=6))],
        [k.d(0, 4), k.d(1, 6)],
        [k.d(1, 70, flying), k.d(410, 15, flying)],
        [k.i(191, 20), k.team(39, 10)],
        [k.d(0, 40, flying), k.d(3, 7.5, flying)],
        [k.d(2, 60, flying), k.i(211, 5, trigger=e(52, ct=6))],
    ]
    leader = [k.team(32, 80), k.d(1, 140, flying), k.i(191, 20), k.team(211, 30)]
    return k.finish(slots, leader)


def bear(k):
    slots = [
        [k.gain(2, trigger=e(23)), k.gain(trigger=e(26, every=10)),
         k.team(0, 5, trigger=e(23), duration=15, stacks=7)],
        [k.team(157, 20), k.i(211, 50)],
        [k.d(0, 8), k.d(1, 12)],
        [k.i(201, 20), k.i(35, 10)],
        [k.d(2, 5), k.team(693, 15)],
        [k.i(32, 40), k.i(36, 15)],
    ]
    leader = [k.team(32, 100), k.team(33, 100), k.team(157, 20), k.team(205, 15)]
    return k.finish(slots, leader)


BUILDERS = {"149994": rabbit, "149993": green, "149992": armor, "149991": bear}
