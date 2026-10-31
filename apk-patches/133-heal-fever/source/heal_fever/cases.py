"""独立验证用例。计算、层数、表查询、724入口、槽钳位及同步均执行真实字节码。"""
from .runtime import World
SPEC = 'wfx:31:0:100:200:hidden_wg_aqua_heal_fever'


def suite(before, after, overrides=None, legacy=True):
    checks, executed = [], set()
    def eq(name, actual, expected):
        if isinstance(actual, (float, int)) and isinstance(expected, (float, int)):
            assert abs(actual - expected) < 1e-8, (name, actual, expected)
        else:
            assert actual == expected, (name, actual, expected)
        checks.append({'name': name, 'actual': actual, 'expected': expected})
    def use(h):
        executed.update(h.executed)
    def make(**kwargs):
        return World(after, {1: SPEC}, overrides=overrides, **kwargs)
    old_count = 0
    if legacy:
        for state in (0, 1, 2):
            for val in (0, 85, 100):
                for no_gauge in (False, True):
                    snapshots = []
                    for abc in (before, after):
                        h = World(abc, state=state, value=val, overrides=overrides if abc is after else None)
                        if no_gauge: h.zone['feverPointGauge'] = {'index': 1}
                        h.native724(.2); h.native_add(5)
                        snapshots.append(h.snapshot()); use(h)
                    eq(f'old.native724.state{state}.value{val}.absent{no_gauge}', snapshots[1], snapshots[0])
        old_count = len(checks)
    for name, eff, over, want in [('effective', 20, 0, 20), ('overflow', 0, 10, 20),
                                  ('mixed', 20, 10, 40), ('fractional', .125, .125, .375),
                                  ('zero', 0, 0, 0)]:
        h = make(); h.attach(1); h.sample(eff, over)
        eq(name, h.gauge['feverPoint']['value'], want)
        eq(name+'.coop_not_broadcast_each_add', h.coop, [])
        if want: eq(name+'.native_kind1_trigger', h.triggers, [(9, 1, True)])
        else: eq(name+'.no_zero_side_effect', h.triggers, [])
        use(h)
    h = make(); h.member['conditionSlot']['squadSlot'] = {'index': 0, 'params': [h.slot([h.condition(1, 2)])]}
    h.sample(10, 5); eq('shared_squad_slot_layers', h.gauge['feverPoint']['value'], 40); use(h)
    h = make(); h.member['conditionSlot']['invisibleSlot'] = h.slot([h.condition(1)], invisible=True)
    h.sample(20, 10); eq('invisible_slot', h.gauge['feverPoint']['value'], 40); use(h)
    h = make(maximum=250); h.attach(1); h.sample(20, 10)
    eq('current_max_scaling', h.gauge['feverPoint']['value'], 100); use(h)
    h = make(); h.attach(1, 2); h.sample(10, 5)
    eq('both_terms_layer_weight', h.gauge['feverPoint']['value'], 40)
    h.attach(1, 3); h.sample(10, 5)
    eq('next_heal_live_layers', h.gauge['feverPoint']['value'], 100); use(h)
    h = World(after, {1: SPEC, 2: 'wfx:31:0:50:300:second', 3: 'wfx:27:0:10000:0:old',
                      4: 'wfx:30:0:10000:50000:new_damage', 5: 'wfx:31:1:900:900:reserved'}, overrides=overrides)
    for uid in range(1, 6): h.attach(uid)
    h.sample(10, 5)
    eq('multi_row_sum_and_27_30_isolation', h.gauge['feverPoint']['value'], 40); use(h)
    for state, initial, want in [(0, 0, 0), (1, 85, 100), (2, 0, 40), (2, 85, 100), (2, 100, 100)]:
        h = make(state=state, value=initial); h.attach(1); h.sample(20, 10)
        eq(f'native_state{state}_initial{initial}', h.gauge['feverPoint']['value'], want)
        if state == 0: eq('disabled_state_no_stats', h.triggers, [])
        else: eq(f'native_state{state}_initial{initial}_trigger', h.triggers, [(9, 1, True)])
        use(h)
    h = make(); h.attach(1); h.zone['feverPointGauge'] = {'index': 1}; h.sample(20, 10)
    eq('zone_without_gauge', h.gauge['feverPoint']['value'], 0); use(h)
    for kind in ('empty', 'missing', 'not_loaded', 'non_unique'):
        h = make(loaded=kind != 'not_loaded')
        if kind != 'empty':
            h.attach(1)
            if kind == 'missing': h.table.clear()
            if kind == 'non_unique': h.condition_for(h.member, 1)['content']['index'] = 0
        h.events.clear(); h.sample(20, 10)
        eq('no_effect.'+kind, h.snapshot()['value'], 0)
        eq('no_native_call.'+kind, h.triggers, []); use(h)
    h = make(); h.attach(1)
    for _ in range(5): h.sample(20, 0)
    eq('five_targets_immediate_sum', h.gauge['feverPoint']['value'], 100)
    eq('five_targets_each_immediate', len(h.triggers), 5); use(h)
    # The same native chain as 724, including requested-amount statistics and full-gauge triggers.
    for state, value in ((1, 0), (2, 10), (2, 100)):
        h = make(state=state, value=value); h.attach(1); h.events.clear(); h.sample(20, 10)
        n = make(state=state, value=value); n.events.clear(); n.native724(.4)
        eq(f'new_matches_native724_state{state}_value{value}', h.snapshot(), n.snapshot()); use(h); use(n)
    for initial, energy in ((90, 11), (100, 1)):
        h = World(after, {1: SPEC, 2: 'wfx:60:3:10000:100:energy', 3: 'wfx:61:0:0:0:super'},
                  state=2, value=initial, overrides=overrides)
        h.attach(1); h.attach(2); h.sample(20, 10)
        eq(f'prior_superfever_effective_delta_initial{initial}', h.layers(h.member, 2), energy); use(h)
    h = make(value=90); h.attach(1); h.sample(20, 0)
    eq('full_before_update_no_sync_yet', h.coop, [])
    h.run('FeverPointGaugeImpl/update', h.gauge, False)
    eq('native_update_enters_fever', h.gauge['state']['index'], 2)
    eq('native_start_sync_command', h.coop, [{'index': 1, 'params': [2, {'index': 0, 'params': [1]}]}])
    eq('native_start_once', h.gauge['feverModeCount'], 1); use(h)
    peer = make(value=7); peer.run('FeverPointGaugeImpl/applySynchronize', peer.gauge, 1)
    eq('peer_native_sync_fills_gauge', peer.gauge['feverPoint']['value'], 100)
    eq('peer_native_sync_enters_fever', peer.gauge['state']['index'], 2)
    eq('peer_does_not_rebroadcast', peer.coop, [])
    old = peer.snapshot(); peer.run('FeverPointGaugeImpl/applySynchronize', peer.gauge, 1)
    eq('peer_repeated_sync_ignored', peer.snapshot(), old); use(peer)
    return {'checks': checks, 'old_parity_count': old_count, 'new_check_count': len(checks)-old_count,
            'executed_methods': sorted(executed)}

