"""资产容量驱动的三 Battle 夹具；实际状态值合成，采样逻辑取最终 SWF。"""
import copy
import json
from pathlib import Path
import bootstrap
from fp_fields_test import enum, fixture, rng
from fp_test_vm import make_world
from test_fp_core import call, scene_fixture
from test_fp_transport import compact

ROOT = Path(__file__).resolve().parent


def make_battle(case, index, occupied=True):
    battle, zone, template = fixture()
    battle.update(floor=1, primary=index == 0)
    battle['initialData']['id'] = '0123456789abcdef0123456789abcdef' + str(index)
    enemies = {}
    bosses = []
    for i, kind in enumerate(case['bosses']):
        enemy = copy.deepcopy(template)
        enemy.update(_type=case['enemy_kind'], enemyId=f'Boss({kind},{i},ZoneAddress(0))',
                     address=enum('EnemyAddress', 'Boss', 0, kind, i,
                                  enum('ZoneAddress', 'ZoneAddress', 0, 0)),
                     stateFrame=0, currentStateGroup='start', synchronizeCount=0,
                     funnelSpawnCount=0, subroutineId=0)
        enemy['state'] = enum('EnemyState', 'Unique', 1, {'id': 'start', 'funnelSpawnCount': 0}, 'start')
        if case['enemy_kind'] == 'EnemyImpl':
            enemy['state'] = enum('EnemyState', 'Common', 0, enum('EnemyCommonState', 'Stun', 1))
        enemy['healthPointGauge']['healthPoint'] = {'value': 5250000000.0, 'max': 5250000000.0}
        enemy['hitCountCheck']['gauge']['trialProgress']['h'] = {1: 0}
        enemies['boss' + str(i)] = enemy
        bosses.append(enemy)
    for group in range(1, 11):
        size = case['group_sizes'][str(group)]
        active = []
        for i in range(size if occupied else 0):
            enemy = copy.deepcopy(template)
            parent = bosses[(group - 1) % len(bosses)]['address']
            address = enum('EnemyAddress', 'Funnel', 2, case['funnel_kind'], i,
                           enum('EnemyStateAddress', 'Enemy', 0,
                                'phase_group_' + str(group), 0, parent))
            enemy.update(address=address, enemyId=f'Funnel({case["funnel_kind"]},{group},{i})',
                         stateFrame=0, currentStateGroup='start', synchronizeCount=0,
                         funnelSpawnCount=0, subroutineId=0)
            enemy['state'] = enum('EnemyState', 'Unique', 1,
                                  {'id': 'start', 'funnelSpawnCount': 0}, 'start')
            enemy['hitCountCheck']['gauge']['trialProgress']['h'] = {1: 0}
            enemies[f'f{group:02d}_{i:02d}'] = enemy
            active.append(enemy)
        head = None
        for enemy in reversed(active):
            head = {'item': enemy, 'next': head}
        zone['funnelManager'][f'subManager{group:02d}'] = {
            'activeFunnels': {'h': head, 'length': len(active)},
            'queueOfFunnels': {'length': 0}, 'random': rng(7654321),
            'spawnPoints': [{'available': not occupied} for _ in range(size)]}
    zone['enemyManager']['enemies'] = {'h': enemies, 'rh': {}}
    return battle


def sample_three(abc, case, occupied=True):
    world = make_world(abc)
    # Native JSON number/string encoding is shared with the transport fixture.
    world.lex['JSON']['stringify'] = compact
    scene = scene_fixture()
    battles = [make_battle(case, i, occupied) for i in range(3)]
    original = copy.deepcopy(battles)
    for battle in battles:
        state = call(world, 'wfxFpBind', battle, scene)
        assert state is not None
        call(world, 'wfxFpSample', battle, True)
    assert battles == original, 'sampler changed simulation objects'
    ctx = state['ctx']
    rows = copy.deepcopy(ctx['rows'])
    assert len(rows) == 3, ctx
    assert all(row['phase'] == 'initial' and row['mode'] == 'full' and row['postFrame'] == 0 for row in rows)
    assert all(not row['unsupported'] for row in rows), [r['unsupported'] for r in rows]
    assert len({r['battleId'] for r in rows}) == 3
    # Snapshot objects must be detached from all live game slots.
    frozen = copy.deepcopy(rows)
    for battle in battles:
        for enemy in battle['zoneManager']['state']['params'][0]['enemyManager']['enemies']['h'].values():
            enemy['stateFrame'] += 1
            enemy['stateChooser']['random']['randomNum'] += 1
    assert ctx['rows'] == frozen
    return rows, world.executed


def cases():
    return json.loads((ROOT / 'scale-evidence' / 'asset-scale-spec.json').read_text(encoding='utf-8'))['cases']
