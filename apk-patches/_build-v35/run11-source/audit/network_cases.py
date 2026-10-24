"""独立执行原生联机命令、回复计算和回执；不模拟被验收的路由算法。"""
import math

from heal_any.runtime import enum
from cross_cases import make_heal, pending


def receive(w, recipient, *, mirror=False):
    """枚举/定点数和引擎对象作为外围；三个原生方法执行实际 AVM2。"""
    queued, feedback = [], []
    w.battle['bothBossManager'] = {'onlySyncDamage': lambda: False}
    w.battle['squadManager'] = w.manager
    w.battle['zoneManager'] = {'addImpact': lambda *a: queued.append(a)}
    w.battle['__isMyBattle__'] = lambda: not mirror
    w.lex['ImpactSourceContent'].statics['RatioHeal'] = lambda payload: enum(1, payload)
    w.lex['Decimal_Impl_']['multiplyFloat'] = lambda value, ratio: value * ratio / 100000
    w.lex['Decimal100_Impl_']['fround'] = lambda value: value / 100
    w.lex['FloatInt_Impl_'].update(toFloat=float, floor=math.floor, max=max)
    w.lex['CommonBattleConstants'] = {'MAX_CURE': 99999999}
    w.lex['BattleCoopCommand']['StatsFeedback'] = lambda *args: enum(10, *args)
    w.lex['FeedbackStatsKind']['HealToMember'] = lambda *args: enum(0, *args)
    for index, member in enumerate(w.members):
        member['matchMaybeCharacterGroup'] = lambda filters, i=index: not filters or i in filters
    recipient.update(matchCharacterGroup=lambda _: False,
                     getStatModifierEaseOfHeal=lambda: 0,
                     isHealRejected=lambda _: False)
    recipient['output']['addCoopCommand'] = feedback.append
    payload = {'kind': enum(1), 'rate': 5000, 'battleId': 'battle-B',
               'allCharacterSlayerTargets': [], 'multiplierOfCharacterSlayer': 0,
               'createdBySelf': False, 'createdByHostility': False,
               'shouldCountForMission': False, 'originMemberIndex': 1,
               'createdBySummonsMultiBall': False}
    command = enum(1, {'leaderElementFilter': [], 'elementFilter': [2],
                       'specialityFilter': [], 'raceFilter': [], 'genderFilter': [],
                       'content': enum(1, payload), 'x': 3, 'y': 4, 'hitEffect': enum(1)})
    w.run('Battle/applyCoopCommand', w.battle, command, 'battle-B')
    return queued, feedback, payload, command


def apply_queued(w, queued):
    recipient, source = queued[0]
    detail = w.run('RatioHealCalculator/calculate', {}, recipient, source['content']['params'][0])
    source.update(hitEffectX=source['x'], hitEffectY=source['y'])
    w.run('MemberImpl/applyHeal', recipient, source, detail)
    return detail


def native_network_cases(abc, eq):
    w, _, _, target = make_heal(abc)
    before_hp = target['getRealCurrentHealthPoint']()
    queued, feedback, payload, command = receive(w, target)
    eq('network.receiver_one_selected_member', len(queued), 1)
    eq('network.receiver_target_identity', queued[0][0] is target, True)
    eq('network.receiver_preserves_payload_identity', queued[0][1]['content']['params'][0] is payload, True)
    eq('network.receiver_marks_coop_source', queued[0][1]['createdByCoopCommand'], True)
    eq('network.queued_without_actual_heal_no_hp_change', target['getRealCurrentHealthPoint'](), before_hp)
    eq('network.queued_without_actual_heal_no_damage', pending(w), [])
    eq('network.queued_without_actual_heal_no_fever', len(w.fever), 0)
    detail = apply_queued(w, queued)
    eq('network.native_calculator_preserves_cross_id', detail['statsBattleId'], 'battle-B')
    eq('network.native_calculator_five_percent_heal', detail['cure'], 500)
    eq('network.local_actual_hp_write', target['getRealCurrentHealthPoint']() - before_hp, 50000)
    eq('network.local_actual_once_holder_damage', pending(w), [(0, 4, 10)])
    eq('network.local_actual_once_holder_fever', len(w.fever), 1)
    eq('network.local_actual_native_fever_value', w.native_fever.gauge['feverPoint']['value'], 50)
    eq('network.local_actual_emits_one_feedback', len(feedback), 1)
    eq('network.feedback_destination_is_source', feedback[0]['params'][1], 'battle-B')
    stats = []
    source_battle = {'bothBossManager': {'onlySyncDamage': lambda: False},
                     'get_id': lambda: 'battle-B',
                     'squadManager': {'summerizeHealResult': lambda *a: stats.append(a)}}
    w.run('Battle/applyCoopCommand', source_battle, feedback[0], 'battle-A')
    eq('network.feedback_only_statistics', stats, [(detail, 50000)])
    eq('network.feedback_no_second_fever', len(w.fever), 1)
    eq('network.feedback_no_second_damage', pending(w), [(0, 4, 10)])
    eq('network.feedback_no_second_hp_write', target['getRealCurrentHealthPoint'](), before_hp + 50000)
    source_battle['get_id'] = lambda: 'unrelated-battle'
    w.run('Battle/applyCoopCommand', source_battle, feedback[0], 'battle-A')
    eq('network.feedback_wrong_destination_ignored', len(stats), 1)
    friendly = {'isHostile': lambda: False, 'isCoffin': lambda: False}
    eq('network.friendly_heal_no_impact_broadcast',
       w.run('ImpactManagerImpl$/shouldSync', {}, friendly, {'content': enum(1)}), False)

    mirror, _, _, mirror_target = make_heal(abc)
    mirror_queue, _, _, _ = receive(mirror, mirror_target, mirror=True)
    apply_queued(mirror, mirror_queue)
    eq('network.mirror_simulation_no_holder_damage', pending(mirror), [])
    eq('network.mirror_simulation_no_holder_fever', len(mirror.fever), 0)
    distribute_cases(w, command, target, eq)


def distribute_cases(w, command, target, eq):
    local, remote = [], []
    w.lex['BattleCommand'] = {'Coop': lambda *args: enum(0, *args)}
    scene = {'scene': {'myBattleId': 'battle-A'},
             'myBattleDriver': {'write': local.append},
             'otherBattleDerailleurs': {
                 '_keys': ['battle-B', 'battle-C'], 'map': {'h': {
                     key: {'addCoopCommand': lambda *a, key=key: remote.append((key, a))}
                     for key in ['battle-B', 'battle-C']}}}}
    before = (target['getRealCurrentHealthPoint'](), len(w.fever), pending(w))
    w.run('BattleScenePlayingStateImpl/distributeCoopCommand', scene, command, 'battle-B', 120)
    eq('network.distribute_remote_to_one_local_driver', len(local), 1)
    eq('network.distribute_skips_origin_mirror', [row[0] for row in remote], ['battle-C'])
    eq('network.forwarding_only_no_actual_side_effect',
       (target['getRealCurrentHealthPoint'](), len(w.fever), pending(w)), before)
    local.clear()
    remote.clear()
    w.run('BattleScenePlayingStateImpl/distributeCoopCommand', scene, command, 'battle-A', 120)
    eq('network.distribute_own_source_no_local_echo', len(local), 0)
    eq('network.distribute_own_source_other_mirrors', [row[0] for row in remote],
       ['battle-B', 'battle-C'])
    eq('network.local_forwarding_no_second_fever', len(w.fever), before[1])
