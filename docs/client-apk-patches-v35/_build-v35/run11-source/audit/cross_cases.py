"""独立断言；复用对象外围/VM，不导入两实现组的测试用例或业务断言。"""
from direct_count.runtime import World as DirectWorld
from heal_any.runtime import World as HealWorld
from heal_damage.damage_fixture import calculate


def direct_cases(abc, eq):
    for k, extra in [(0, 0), (1, 10), (2, 11), (6, 15), (10, 15)]:
        w = DirectWorld(abc, {901: 'wfx:33:10:1:5:hidden_audit'})
        m, target, shots, _, _ = w.member(conditions=[w.condition(901)], debuffs=k,
                                         native=(3, 50000), extra=[(5, 25000)])
        w.run('MemberImpl/scheduleDirectAttack', m, 10, target, .5)
        eq(f'direct.k{k}.native_best_plus_bonus', len(shots), 5 + extra)
        eq(f'direct.k{k}.native_damage_preserved',
           shots[0][3]['content']['statModifierAdditionalDirectAttackDamage'], 25000)
    w = DirectWorld(abc, {901: 'wfx:33:10:1:5:hidden_audit',
                          902: 'wfx:25:4:0:0:hidden_merge'})
    m, target, shots, _, combo = w.member(
        conditions=[w.condition(901), w.condition(902)], debuffs=6, native=(3, 50000))
    w.run('MemberImpl/scheduleDirectAttack', m, 10, target, .5)
    eq('direct.merge_single_schedule', len(shots), 1)
    eq('direct.merge_native_toughness', shots[0][3]['content']['basicDetoughness'], 18)
    eq('direct.merge_extra_combo', combo[0], 17)
    eq('direct.merge_extra_stat', m['stats']['directAttackCount'], 17)
    w = DirectWorld(abc, {901: 'wfx:33:-10:1:0:hidden_negative'})
    m, target, shots, _, _ = w.member(conditions=[w.condition(901)], debuffs=6,
                                     native=(2, 50000))
    w.run('MemberImpl/scheduleDirectAttack', m, 10, target, .5)
    eq('direct.negative_sum_clamp', len(shots), 2)


def make_heal(abc, hidden=False, second=False, legacy=True):
    data = {901: 'wfx:34:54:100000:150000:hidden_audit_damage',
            902: 'wfx:35:50:500:1000:hidden_audit_fever',
            903: 'wfx:30:4:10000:10000:hidden_legacy_damage',
            904: 'wfx:31:0:100:100:hidden_legacy_fever'}
    w = HealWorld(abc, data, native_fever=True)
    rows = [w.condition(901), w.condition(902)]
    owner = w.unit(conditions=[] if hidden else rows, hp=1000, maxhp=1000)
    if hidden:
        owner['conditionSlot']['invisibleSlot'] = w.slot(rows, invisible=True)
    if second:
        other = w.unit(conditions=[w.condition(901, 2), w.condition(902, 2)],
                       hp=1000, maxhp=1000)
    else:
        other = w.unit(conditions=([w.condition(903), w.condition(904)] if legacy else []),
                       hp=1000, maxhp=1000)
    recipient = w.unit(hp=5000, maxhp=10000)
    return w, owner, other, recipient


def pending(w):
    return [(row[0]['originMemberIndex'], row[1], row[3])
            for row in (w.lex['MemberImpl']['wfxHealDamagePending'] or [])]


def heal_cases(abc, eq):
    for cure, damage, fever in [(490, 0, 0), (500, 10, 50), (1200, 20, 100)]:
        w, owner, healer, target = make_heal(abc)
        w.heal(target, cure=cure, origin=1)
        eq(f'heal.{cure}.owner_queue', pending(w), [] if not damage else [(0, 4, damage)])
        eq(f'heal.{cure}.native_fever', w.native_fever.gauge['feverPoint']['value'], fever)
        eq(f'heal.{cure}.one_api_or_zero', len(w.fever), 0 if not fever else 1)
    w, owner, _, target = make_heal(abc, hidden=True)
    target['getRealCurrentHealthPoint'] = lambda: 970000
    w.heal(target, cure=1000, origin=-1)
    eq('heal.hidden_owner_split_quantization', pending(w), [(0, 4, 15)])
    eq('heal.hidden_owner_overflow_native_fever',
       w.native_fever.gauge['feverPoint']['value'], 100)
    w, _, _, target = make_heal(abc)
    w.heal(target, cure=300, origin=-1)
    w.heal(target, cure=300, origin=-1)
    eq('heal.independent_subthreshold_never_carries', pending(w), [])
    eq('heal.independent_subthreshold_no_fever', len(w.fever), 0)
    w, _, _, target = make_heal(abc, second=True)
    w.heal(target, cure=500, origin=-1)
    eq('heal.two_owners_layer_weight', pending(w), [(0, 4, 10), (1, 4, 20)])
    eq('heal.two_owners_two_native_calls', len(w.fever), 2)
    eq('heal.two_owners_native_fever_sum', w.native_fever.gauge['feverPoint']['value'], 150)
    for name, extras, expected in [
        ('coop_same_id', {'createdByCoopCommand': True}, [(0, 4, 10)]),
        ('coop_cross_id', {'createdByCoopCommand': True, 'statsBattleId': 'battle-B'}, [(0, 4, 10)]),
        ('rejected', {'isHealRejected': True}, [])]:
        w, _, _, target = make_heal(abc)
        w.heal(target, cure=500, origin=-1, **extras)
        eq('heal.' + name, pending(w), expected)
    w, _, _, target = make_heal(abc, legacy=False)
    w.battle['__isMyBattle__'] = lambda: False
    w.heal(target, cure=500, origin=-1)
    eq('heal.remote_simulation_owner_gate', pending(w), [])
    eq('heal.remote_simulation_no_fever', len(w.fever), 0)
    w, _, _, target = make_heal(abc, legacy=False)
    w.primary['members'].append(w.primary['members'][0])
    w.heal(target, cure=500, origin=-1)
    eq('heal.aliased_member_is_not_second_owner', pending(w), [(0, 4, 10)])
    eq('heal.aliased_member_one_fever_call', len(w.fever), 1)


def fever_member_boundary_cases(abc, eq):
    w, owner, other, target = make_heal(abc)
    # 同帧、同来源、同数值：每位受治疗成员分别量化，保留两次 API。
    other['getRealCurrentHealthPoint'] = lambda: 50000
    w.heal(other, cure=50, origin=-1)
    w.heal(target, cure=500, origin=-1)
    eq('fever.ruling_A.two_members_two_calls', len(w.fever), 2)
    eq('fever.ruling_A.two_members_native_total', w.native_fever.gauge['feverPoint']['value'], 100)
    eq('fever.ruling_A.same_holder_damage_aggregation', pending(w), [(0, 4, 20)])


def legacy_source_cases(abc, before, eq):
    for name, extras, accepted in [
        ('same_id_local', {}, True),
        ('cross_id_local', {'statsBattleId': 'battle-B'}, False),
        ('same_id_coop', {'createdByCoopCommand': True}, False),
        ('cross_id_coop', {'createdByCoopCommand': True, 'statsBattleId': 'battle-B'}, False)]:
        states = []
        for image in [before, abc]:
            w, owner, _, target = make_heal(image)
            owner['conditionSlot'] = w.slot()
            w.heal(target, cure=500, origin=1, **extras)
            states.append({'pending': pending(w), 'calls': len(w.fever),
                           'fever': w.native_fever.gauge['feverPoint']['value'],
                           'hp': target['getRealCurrentHealthPoint'](),
                           'stats': target['stats'].copy(), 'events': w.events})
        eq('legacy30_31.' + name + '.v35j_identical', states[1], states[0])
        eq('legacy30_31.' + name + '.damage_gate', states[1]['pending'],
           [(1, 4, 5)] if accepted else [])
        eq('legacy30_31.' + name + '.fever_gate', states[1]['calls'], int(accepted))


def damage_stats_cases(abc, eq):
    w, owner, healer, target = make_heal(abc)
    w.heal(target, cure=1200, origin=1)
    w.tick(30)
    attack = w.impacts[0][1]['content']
    eq('damage.attacker_identity_is_holder', attack['attacker'] is owner, True)
    eq('damage.attack_origin_is_holder', attack['originMemberIndex'], 0)
    result, _ = calculate(w, attack, kind=4, attack_point=3200,
                          attack_bonus=25000, bonus=50000, resistance=20000)
    eq('damage.native_calculator_holder_attack_and_bonus', result['damage'] / 100, 96000)
    events = []
    zone_stats = {'add': lambda *v: events.append(('add', *v)),
                  'setMax': lambda *v: events.append(('max', *v))}
    enemy = {'isBreakableBlock': lambda: False, 'isBoss': lambda: False,
             'isFunnel': lambda: False}
    w.run('BattleZoneStats/summerizeAttackToEnemy', zone_stats, enemy,
          {'createdByPrimaryBattle': True}, result, result['damage'], False)
    eq('damage.native_category_statistics',
       [(key, value) for operation, key, value in events
        if operation == 'add' and key in (24, 26, 30, 31)], [(31, 96000)])
    routed = []
    for i, member in enumerate(w.members):
        member['stats']['summerizeAttackResult'] = (
            lambda *args, i=i: routed.append(('member', i, args[1])))
        member['stats']['summerizeAttackResultAsOrigin'] = (
            lambda *args, i=i: routed.append(('origin', i, args[0]['damage'])))
    w.run('SquadManagerImpl/summerizeAttackResult', w.manager,
          result, result['damage'], False, 'enemy0')
    eq('damage.native_member_and_origin_routing', routed,
       [('member', 0, 9600000), ('origin', 0, 9600000)])
