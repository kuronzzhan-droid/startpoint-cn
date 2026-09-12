"""雷方块、光保安机器人、暗下忍三套原生机制。"""
from wf_miniboss_rows import event as e, ongoing as o, scaled


def cube(k):
    tag = {"unique_condition_id": k.uid}
    drones = o(209, group=k.group, limit=3)
    slots = [
        [k.i(211, 50), k.i(413, 100, extra=tag, trigger=e(23)),
         k.i(413, 100, extra=tag, trigger=e(65, ct=3))],
        [k.team(520, 30, extra=tag), k.team(565, 30, extra=tag)],
        [k.d(0, 10, drones), k.d(23, 20, drones),
         k.i(483, 30, extra={"character_groups": k.group}),
         k.i(484, 30, extra={"character_groups": k.group})],
        [k.i(35, 10), k.i(211, 10, trigger=e(23))],
        [k.i(226, 300, trigger=e(2)), k.i(200, 300),
         k.d(23, 30, o(2, count=50, limit=1))],
        [k.i(227, 8, trigger=e(23)), k.d(2, 40, o(72)), k.d(411, 15, o(72))],
    ]
    leader = [k.team(32, 100), k.i(55, 120), k.team(565, 60, extra=tag),
              k.team(211, 30)]
    return k.finish(slots, leader)


def security(k):
    slots = [
        [k.i(51, 150), k.team(53, 25)],
        [k.i(462, 40, target=1), k.i(205, 25), k.i(36, 10)],
        [k.i(34, 70), k.d(411, 15, o(72)), k.i(227, 8, trigger=e(23))],
        [k.team(491, 50), k.i(211, 50), k.i(35, 10)],
        [k.team(203, 100), k.team(32, 20, trigger=e(18, limit=2))],
        [k.gain(trigger=e(23)), k.d(23, 60), k.d(2, 30)],
    ]
    leader = [k.team(32, 100), k.team(34, 120), k.team(53, 30), k.team(205, 20)]
    return k.finish(slots, leader)


def genin(k):
    def shadows(n):
        return [(144, {"trigger_puller": 0, "unique_condition_id": k.uid,
                       **scaled("threshold", n)})]
    slots = [
        [*(k.gain(n, trigger=e(62 + n)) for n in (1, 2, 3)), k.gain(2, trigger=e(23))],
        [k.d(2, 20, target=0), k.d(0, 10, target=0)],
        [k.helper("shadow_slash", pre=shadows(3), trigger=e(4, ct=2)),
         k.helper("five_shadow", pre=shadows(5), trigger=e(23)),
         k.i(525, 500, pre=shadows(5), trigger=e(23), extra={"unique_condition_id": k.uid})],
        [k.i(211, 50), k.i(35, 10), k.i(211, 10, trigger=e(23))],
        [k.team(199, 40), k.team(512, 30)],
        [k.team(559, 40), k.team(694, 15)],
    ]
    leader = [k.team(32, 100), k.team(34, 120), k.team(117, 30), k.team(211, 30)]
    return k.finish(slots, leader)


BUILDERS = {"139996": cube, "159999": security, "169993": genin}
