"""确认label不参与wfx解析，显示前后状态、WFX与战斗触发查询保持一致。"""
import copy
import math
from hidden_icons.runtime import World, StringProbe, LIST, TOTAL, SPEC, ROWS, observe, state


def observable(value):
    if isinstance(value, float) and math.isnan(value):
        return 'NaN'
    if isinstance(value, dict):
        return {key: observable(item) for key, item in value.items() if key not in ('attacker', 'enemy')}
    if isinstance(value, (list, tuple)):
        return [observable(item) for item in value]
    return value


def behavior(before, after, overrides=None):
    checks = []
    for code, arg, value, flags in [(24, 0, 2500, 0), (24, 1, -625, 0),
                                    (28, 129997, 2700, -1), (29, 129997, 300, 11),
                                    (71, 0, 100, 0), (26, 0, -15000, 3)]:
        for label in ['normal', 'hidden_', 'hidden_name', 'Hidden_name', '', 'hidden_name:extra']:
            outcomes, reads = [], []
            for abc, changes in ((before, None), (after, overrides)):
                world = World(abc, overrides=changes)
                text = StringProbe(f'wfx:{code}:{arg}:{value}:{flags}:{label}', world.parts_reads)
                world.table[1] = text
                spec = world.run(SPEC, world.lex['ConditionSlot'], 1, world.asset)
                assert spec == [code, arg, value, flags], (text, spec)
                first_reads = list(world.parts_reads)
                assert first_reads and set(first_reads) <= {0, 1, 2, 3, 4}, first_reads
                cached = world.run(SPEC, world.lex['ConditionSlot'], 1, world.asset)
                assert cached is spec and world.parts_reads == first_reads
                outcomes.append(spec)
                reads.append(first_reads)
            assert outcomes[0] == outcomes[1] and reads[0] == reads[1]
            checks.append({'name': f'parser.label_not_read.code={code}.label={label}',
                           'parsed': outcomes[1], 'read_indices': reads[1], 'cache_unchanged': True})
    for text, expected in [('wfx:24:0:2500:0', None), ('wfx:24:0:2500:0:', [24, 0, 2500, 0]),
                           ('wfx:::::hidden_x', None), ('wfx:bad:a:v:f:hidden_x', None),
                           (None, None), ('', None), ('WFX:24:0:2500:0:hidden_x', None)]:
        results = []
        for abc, changes in ((before, None), (after, overrides)):
            world = World(abc, {1: text}, overrides=changes)
            results.append(world.run(SPEC, world.lex['ConditionSlot'], 1, world.asset))
        assert results == [expected, expected], (text, results)
        checks.append({'name': 'parser.invalid_or_empty.' + repr(text), 'value': expected})
    for include_outer in (False, True):
        for hidden in (False, True):
            all_results = []
            for abc, changes in ((before, None), (after, overrides)):
                prefix = 'hidden_' if hidden else 'ordinary_'
                world = World(abc, {uid: f'wfx:24:0:{uid * 100}:0:{prefix}{uid}' for uid in range(1, 5)},
                              overrides=changes)
                conds = [world.condition(uid, uid + 1, tag=str(uid)) for uid in range(1, 5)]
                member = world.member_for_display([conds[0]], [conds[2]], [conds[1]], [conds[3]])
                slot = member['conditionSlot']
                original = copy.deepcopy(state(member))
                initial_rows = world.run(ROWS, slot, 24, include_outer)
                expected = [[0, 200.0, 0, 2, 100], [0, 600.0, 0, 3, 200]]
                if include_outer:
                    expected += [[0, 1200.0, 0, 4, 300], [0, 2000.0, 0, 5, 400]]
                assert initial_rows == expected, initial_rows
                listing, total = observe(world, member, LIST), observe(world, member, TOTAL)
                final_rows = world.run(ROWS, slot, 24, include_outer)
                assert initial_rows == final_rows and state(member) == original
                assert listing['status'] == 'value' and total['status'] == 'value'
                assert len(listing['value']) == total['value']
                all_results.append(final_rows)
            assert all_results[0] == all_results[1]
            checks.append({'name': f'rows.display_independent.outer={include_outer}.hidden={hidden}',
                           'rows': all_results[1], 'native_currentAccumulation': True,
                           'all_slot_state_and_identity_unchanged': True})
    # 码24由真实scheduleDirectAttack消耗，比较调度内容、触发计数和连击外部状态。
    for layers in (0, 1, 3, 11):
        outputs = []
        for abc, hidden, changes in [(before, False, None), (before, True, None),
                                      (after, False, overrides), (after, True, overrides)]:
            sid = 'wfx:24:0:2500:0:' + ('hidden_base' if hidden else 'base')
            world = World(abc, {1: sid}, overrides=changes)
            member, target, shots, counts, combos = world.member(
                conditions=[world.condition(1, layers)], segments=3, combo=5)
            member['logicAssets'] = world.logic_asset
            world.bind(member, 'MemberImpl', ['wfxDirectTargetUnique',
                       'getConditionsIncludingOuterEnvironments', 'getTotalConditions'])
            shown, total = observe(world, member, LIST), observe(world, member, TOTAL)
            assert shown['status'] == total['status'] == 'value'
            expected_visible = 0 if abc is after and hidden else 1
            assert len(shown['value']) == total['value'] == expected_visible
            world.run('MemberImpl/scheduleDirectAttack', member, 10, target, 0.5)
            assert all(shot[3]['content']['multiplierOfAttackPoint'] == 100000 + 25000 * layers
                       for shot in shots)
            outputs.append({'attacks': [observable(shot[3]['content']) for shot in shots],
                            'times': [shot[0] for shot in shots], 'triggers': counts,
                            'combo': combos[0], 'stats': member['stats'],
                            'execution_count': member['directAttackExecutionCount']})
        assert all(result == outputs[0] for result in outputs), outputs
        checks.append({'name': f'combat.real_schedule_trigger_label_independent.layers={layers}',
                       'observed': outputs[-1]})
    return checks


def _fever_world(abc, table, overrides):
    world = World(abc, table, overrides=overrides)
    world.lex['YakumonoManagerImpl'] = {}
    world.lex['YakumonoManagerImpl']['wfxFeverSpecV2'] = lambda *args: world.run(
        'YakumonoManagerImpl$/wfxFeverSpecV2', world.lex['YakumonoManagerImpl'], *args)
    table_names = ['DirectInstantItemTable', 'ExecutableInstantItemTable',
                   'ExecutableInstantItemLevelTable', 'ExecutableInstantItemAtkCurveTable']
    for name in table_names:
        world.lex[name] = name
    tables = {
        table_names[0]: {key: {'direct_instant_item': {'index': 0, 'params': [
            {'executable_instant_item_id': key + '_ex'}]}} for key in ['hp_recovery_small', 'skill_charge_middle']},
        table_names[1]: {key + '_ex': {} for key in ['hp_recovery_small', 'skill_charge_middle']},
        table_names[2]: {key + '_ex': {'atk_basic_curve_id': 'curve'}
                         for key in ['hp_recovery_small', 'skill_charge_middle']},
        table_names[3]: {'curve': {'keys': lambda: [1, 100]}},
    }

    def get_table(cls):
        rows = {uid: {'string_id': sid} for uid, sid in table.items()} if cls is world.lex['UniqueConditionTable'] else tables[cls]
        return {'get_data': lambda: {'exists': lambda key: key in rows, 'get': rows.get}}

    world.asset = {'getMasterTableMaybe': get_table}
    return world


def fever_regression(before, after, overrides=None):
    checks = []
    table = {1: 'wfx:24:0:2500:0:hidden_base',
             2: 'fever:items:hp_recovery_small|skill_charge_middle:lv100:first',
             3: 'fever:items:skill_charge_middle:lv50:second',
             4: 'wfx:24:0:2500:0:normal', 5: 'hidden_old'}
    scenarios = [([], None), ([1], None), ([1, 5], None), ([4, 1], None),
                 ([1, 2], [2, ['hp_recovery_small', 'skill_charge_middle'], 100]),
                 ([2, 1], [2, ['hp_recovery_small', 'skill_charge_middle'], 100]),
                 ([1, 3, 2], [3, ['skill_charge_middle'], 50]),
                 ([3, 1, 2], [3, ['skill_charge_middle'], 50]),
                 ([5, 1, 2, 4], [2, ['hp_recovery_small', 'skill_charge_middle'], 100])]
    for outer in (False, True):
        for ids, expected in scenarios:
            outcomes = []
            for abc, changes in ((before, None), (after, overrides)):
                world = _fever_world(abc, table, changes)
                conditions = [world.condition(uid, 2, added=pos, tag=str(uid)) for pos, uid in enumerate(ids)]
                member = world.member_for_display([] if outer else conditions, conditions if outer else [])
                squads = {'primary': {'members': [{'index': 1}, None, {'index': 0, 'params': [member]}]}}
                original = copy.deepcopy(state(member))
                value = world.run('YakumonoManagerImpl$/wfxFeverMarkerV2',
                                  world.lex['YakumonoManagerImpl'], world.asset, squads)
                assert value == expected and state(member) == original, (ids, value, expected)
                assert LIST in world.executed
                outcomes.append(value)
            assert outcomes[0] == outcomes[1]
            checks.append({'name': f'fever.real_marker_spec_chain.outer={outer}.ids={ids}',
                           'selected_marker': outcomes[1], 'condition_state_unchanged': True})
    return checks
