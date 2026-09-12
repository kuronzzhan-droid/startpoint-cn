"""火属性三套：连击、敌方减益、追加直击。"""
from wf_miniboss_rows import event as e, ongoing as o


def soldier(k):
    slots = [
        [k.i(226, 200, trigger=e(26)), k.gain(2, trigger=e(23)),
         k.gain(trigger=e(65))],
        [k.team(32, 5, trigger=e(12, every=30, limit=10)), k.i(211, 50)],
        [k.i(55, 60), k.team(34, 40), k.i(226, 1000, trigger=e(23))],
        [k.d(0, 15), k.i(35, 10)],
        [k.i(34, 30), k.team(211, 3, trigger=e(12, every=50, ct=3))],
        [k.team(693, 15), k.i(205, 25)],
    ]
    leader = [k.team(32, 100), k.i(55, 120), k.team(205, 20),
              k.i(226, 500, trigger=e(23))]
    return k.finish(slots, leader)


def cobra(k):
    debuff = o(136, limit=6)
    slots = [
        [k.i(211, 50), k.gain(2, trigger=e(23)), k.team(35, 5)],
        [k.d(258, 8, debuff), k.d(159, 12, debuff)],
        [k.i(34, 60), k.team(96, 20)],
        [k.i(391, -15, trigger=e(2, ct=10), duration=9),
         k.i(393, -5, trigger=e(2, ct=10), duration=9),
         k.gain(trigger=e(2, ct=5))],
        [k.d(0, 10), k.team(37, 10)],
        [k.team(694, 15), k.team(32, 30)],
    ]
    leader = [k.team(32, 80), k.team(491, 60), k.team(34, 100), k.team(205, 15)]
    return k.finish(slots, leader)


def red(k):
    direct = e(20, every=30, puller=7, group=k.group)
    growth = e(20, every=30, puller=7, group=k.group, limit=10)
    slots = [
        [k.i(211, 50), k.i(211, 5, trigger=direct), k.gain(2, trigger=e(23))],
        [k.team(32, 5, trigger=growth), k.team(33, 5, trigger=growth),
         k.gain(trigger=e(20, every=30, puller=7, group=k.group, ct=2))],
        [k.i(201, 20), k.team(33, 50)],
        [k.d(23, 10), k.i(35, 10)],
        [k.team(205, 15), k.team(37, 10)],
        [k.team(223, 30, trigger=e(23), duration=15),
         k.team(693, 15), k.team(32, 30)],
    ]
    leader = [k.team(32, 80), k.team(33, 140), k.i(55, 80), k.team(205, 15)]
    return k.finish(slots, leader)


BUILDERS = {"119995": soldier, "119993": cobra, "119994": red}
