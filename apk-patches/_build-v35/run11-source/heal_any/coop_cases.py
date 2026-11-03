"""裁定 B/A：真实 applyHeal 的本端 HP、来源统计及逐成员 API 边界。"""
from .runtime import World
from .cases import TABLE


def make(abc, codes=(30, 31, 34, 35)):
    world = World(abc, TABLE, native_fever=True)
    owner = world.unit([world.condition(code) for code in codes], hp=0)
    recipient = world.unit(hp=0)
    writes, feedback = [], []
    add = recipient['healthPointGauge']['add']

    def record(value):
        writes.append(value)
        add(value)

    recipient['healthPointGauge']['add'] = record
    recipient['output']['addCoopCommand'] = feedback.append
    return world, owner, recipient, writes, feedback


def suite(abc):
    checks = []
    # The stats ID belongs to the source. It must never gate new recipient effects.
    for coop in [False, True]:
        w, _, target, writes, feedback = make(abc)
        w.heal(target, 5, origin=0, statsBattleId='source-player', createdByCoopCommand=coop)
        assert writes == [500] and target['getRealCurrentHealthPoint']() == 500
        assert len(feedback) == 1 and feedback[0][1][1] == 'source-player'
        assert w.fever_ratios() == [.05] and w.native_fever.gauge['feverPoint']['value'] == 50
        w.tick(30)
        assert w.amounts() == [10, 10]
        checks.append(f'coop-ruling-B.cross-source-local-hp-once.coop={coop}')
    # The unmodified native early returns must prevent sampling and HP writes.
    for gate in ['deny-external-heal', 'debug-reject-heal']:
        w, _, target, writes, feedback = make(abc)
        if gate == 'deny-external-heal':
            w.battle['get_allowHealFromOtherPlayers'] = lambda: False
        else:
            target['xdebugSettings']['playerRejectHeal'] = True
        w.heal(target, 5, origin=0, statsBattleId='source-player', createdByCoopCommand=True)
        w.tick(30)
        assert not writes and not feedback and target['getRealCurrentHealthPoint']() == 0
        assert not w.shots and not w.fever and 'MemberImpl/wfxHealAnySample' not in w.executed
        checks.append('coop-ruling-B.native-no-hp-no-sample.' + gate)
    for gate in ['mirror-battle', 'other-squad', 'outside-primary-members']:
        w, owner, target, _, _ = make(abc)
        if gate == 'mirror-battle':
            w.battle['__isMyBattle__'] = lambda: False
        elif gate == 'other-squad':
            target['squad'] = {'isPrimary': lambda: False}
        else:
            w.primary['members'].pop()
        w.heal(target, 5, origin=0, statsBattleId='source-player', createdByCoopCommand=True)
        w.tick(30)
        assert owner['getRealCurrentHealthPoint']() == 0
        assert not w.shots and not w.fever
        checks.append('coop-ruling-B.nonlocal-no-new-effects.' + gate)
    # A partial 34/35 mask must leave the other legacy path's cross-ID exclusion intact.
    for codes, damage, fever in [((30, 31), [], []), ((30, 31, 34), [10, 10], []),
                                  ((30, 31, 35), [], [.05])]:
        w, _, target, writes, _ = make(abc, codes)
        w.heal(target, 5, origin=0, statsBattleId='source-player')
        w.tick(30)
        assert writes == [500] and w.amounts() == damage and w.fever_ratios() == fever
        checks.append('coop-ruling-B.legacy-cross-id-stays-excluded.' + str(codes))
    # Two actual recipient events, each with two holders: four native API calls.
    w = World(abc, TABLE, native_fever=True)
    first = w.unit([w.condition(34), w.condition(35)], hp=0)
    second = w.unit([w.condition(34, 2), w.condition(35, 2)], hp=0)
    target = w.unit(hp=0)
    w.heal(target, 5, origin=-1, statsBattleId='source-player', createdByCoopCommand=True)
    w.heal(second, 12, origin=-1, statsBattleId='source-player', createdByCoopCommand=True)
    assert w.fever_ratios() == [.05, .1, .1, .2]
    assert len(w.fever) == 4 and all(call[1:] == (True, 101) for call in w.fever)
    assert w.native_fever.gauge['feverPoint']['value'] == 450
    assert target['getRealCurrentHealthPoint']() == 500
    assert second['getRealCurrentHealthPoint']() == 1200
    assert first['getRealCurrentHealthPoint']() == 0
    w.tick(30)
    assert w.amounts() == [30, 30, 60, 60]
    checks.append('fever-ruling-A.two-recipients-two-holders-four-immediate-native-calls')
    return checks
