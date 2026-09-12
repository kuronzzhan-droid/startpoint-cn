"""五位水属性小Boss：主动资源保持，六能力各走不同机制。"""
from wf_miniboss_rows import event as e, ongoing as o


def ghost(k):
    slots = [
        [k.i(211, 50), k.gain(2, trigger=e(23)), k.gain(trigger=e(65))],
        [k.d(2, 10)],
        [*(k.helper(f"hitodama_lv{n}", trigger=e(62 + n)) for n in (1, 2, 3)),
         k.i(693, 15)],
        [k.i(35, 10), k.i(211, 10, trigger=e(23, ct=2))],
        [k.d(258, 10, o(136, limit=5)), k.team(119, 30)],
        [k.d(2, 80, o(134, uid=k.uid, count=8, limit=1)), k.team(32, 30)],
    ]
    leader = [k.team(32, 100), k.team(34, 120), k.team(211, 30), k.team(119, 30)]
    return k.finish(slots, leader)


def clione(k):
    slots = [
        [k.i(462, 30, target=1), k.gain(3, trigger=e(23)), k.team(195, 10)],
        [k.team(206, 3, trigger=e(21, every=3, ct=2)),
         k.team(0, 30, trigger=e(23), duration=10)],
        [k.d(1, 20), k.d(0, 10), k.team(201, 15)],
        [k.i(211, 50), k.i(35, 10), k.i(211, 3, trigger=e(19, ct=2))],
        [k.d(2, 20), k.team(36, 8)],
        [k.team(32, 60), k.team(693, 15)],
    ]
    leader = [k.team(32, 80), k.team(33, 120), k.team(195, 15), k.team(205, 20)]
    return k.finish(slots, leader)


def armor(k):
    slots = [
        [k.i(211, 50), k.gain(trigger=e(21, every=5))],
        [k.d(0, 5)],
        [k.d(2, 5), k.team(211, 3, trigger=e(2, ct=2))],
        [k.team(37, 15), k.i(205, 20)],
        [k.d(1, 5)],
        [k.team(32, 3, trigger=e(21, every=5, limit=20)),
         k.i(34, 30), k.team(693, 15)],
    ]
    leader = [k.team(32, 80), k.team(34, 80), k.team(37, 20), k.team(205, 20)]
    return k.finish(slots, leader)


def blue(k):
    buffs = o(38, puller=5, group=k.group, limit=6)
    slots = [
        [k.i(211, 50), k.gain(2, trigger=e(23))],
        [k.team(157, 15), k.team(35, 5)],
        [k.d(0, 10, buffs, target=7), k.d(1, 15, buffs, target=7)],
        [k.team(205, 15), k.team(38, 8)],
        [k.d(2, 10), k.gain(trigger=e(2, ct=5))],
        [k.team(0, 60, trigger=e(23), duration=15), k.team(693, 15)],
    ]
    leader = [k.team(32, 80), k.team(33, 100), k.team(157, 20), k.team(211, 30)]
    return k.finish(slots, leader)


def whale(k):
    debuff = o(136, limit=1)
    slots = [
        [k.d(0, 8, o(64, limit=5)), k.d(2, 30, debuff)],
        [k.i(211, 50), k.d(3, 1), k.team(32, 40)],
        [k.i(226, 500, trigger=e(23)), k.i(55, 10, trigger=e(23, limit=5)),
         k.gain(2, trigger=e(23))],
        [k.d(4, 10, debuff), k.team(195, 10)],
        [k.team(119, 25), k.gain(trigger=e(2, ct=5))],
        [k.d(2, 15), k.d(411, 15, debuff)],
    ]
    leader = [k.team(32, 80), k.team(34, 100), k.team(119, 30), k.team(211, 30)]
    return k.finish(slots, leader)


BUILDERS = {"129998": ghost, "129996": clione, "129995": armor,
            "129994": blue, "129993": whale}
