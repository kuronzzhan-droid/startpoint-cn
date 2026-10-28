"""只读本地锁定资产视图，提取离线规模验收的来源；只写本轮 scale-evidence。"""
import hashlib
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
AUDIT = Path('<WORKDIR>/outputs/work/coop-desync-20261021/audit_view.py')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def extract():
    spec = importlib.util.spec_from_file_location('scale_asset_view', AUDIT)
    view = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(view)
    sources = []

    def read(logical, table=False):
        raw, origin = view.raw(logical)
        sources.append({'logical': logical, 'archive': origin, 'bytes': len(raw),
                        'sha256': sha(raw)})
        return view.table(logical) if table else view.amf(logical)

    def spawn_nodes(tree, path='$'):
        if isinstance(tree, list):
            if tree and tree[0] == 'SpawnFunnel':
                yield {'path': path, 'node': tree}
            for i, value in enumerate(tree):
                yield from spawn_nodes(value, path + '/' + str(i))
        elif isinstance(tree, dict):
            for key, value in tree.items():
                yield from spawn_nodes(value, path + '/' + key)

    def terrain(logical):
        tree = read(logical)
        groups = Counter(obj['type'] for layer in tree['layers']
                         for obj in layer.get('objects', [])
                         if obj.get('type', '').startswith('FUNNEL_SPAWN'))
        return {str(i): groups.get('FUNNEL_SPAWN' + str(i), 0) for i in range(1, 11)}

    quests = read('master/quest/boss_battle_quest.orderedmap', True)
    zones = read('master/battle/zone.orderedmap', True)
    standard = read('master/battle/boss/standard_boss.orderedmap', True)
    bosses = read('master/battle/boss/general_boss.orderedmap', True)
    fields = read('master/battle/field_data.orderedmap', True)
    quest = view.rows(quests['1']['29']['4'])[0]
    assert quest[0] == '1029004'
    cases = []
    official = [('official_1029004', quest[109], 'discarded_dragon_light_lv80_multi'),
                ('official_many_funnels', 'multi_normal_1_18_1', 'administrator_another_dark_multi')]
    for name, zone_id, boss_id in official:
        field = view.rows(fields[zone_id])[0]
        group_sizes = terrain(field[1] + '.amf3.deflate')
        row = zones[zone_id]['0']
        case = {'name': name, 'zone': zone_id, 'bosses': [boss_id],
                'zone_csv': row, 'field_csv': fields[zone_id], 'group_sizes': group_sizes}
        if name == 'official_1029004':
            case.update(quest_id=1029004, quest_csv=quests['1']['29']['4'])
            esdl = view.rows(standard[boss_id]['100'])[0][1] + '.esdl.amf3.deflate'
            tree = read(esdl)
            case['boss_source'] = esdl
            case['boss_definition_keys'] = sorted(tree)
            case['enemy_kind'] = 'EnemyImpl'
            # This fixture tests sampled size, not the StandardEnemy DSL runtime.
            action = 'battle/action/enemy/action/boss_discarded_dragon_light/boss_discarded_dragon_light$difficulity10_funnel_shot1.action.dsl.amf3.deflate'
            nodes = list(spawn_nodes(read(action)))
            case['spawn_source'] = action
            case['spawn_nodes'] = nodes
            case['funnel_kind'] = nodes[0]['node'][1][1]
        else:
            case['boss_csv'] = bosses[boss_id]['100']
            action = 'battle/action/enemy/action/boss_administrator/boss_administrator_another_dark$difficulity10_funnel_barrier1_multi.action.dsl.amf3.deflate'
            nodes = list(spawn_nodes(read(action)))
            case['spawn_source'] = action
            case['spawn_nodes'] = nodes
            case['enemy_kind'] = 'GeneralBoss'
            case['funnel_kind'] = nodes[0]['node'][1][1]
        cases.append(case)
    actions = ['hp_p1_round1_multi', 'hp_r_setup', 'hp_candle_multi', 'hp_sum_white3d_multi']
    nodes = {}
    for action in actions:
        logical = 'battle/action/enemy/action/mod/hell_pumpkin/' + action + '.action.dsl.amf3.deflate'
        nodes[action] = list(spawn_nodes(read(logical)))
    cases.append({'name': 'hell_pumpkin', 'quest_id': 300097005, 'zone': 'mod_hp_zone',
                  'bosses': ['mod_hp_jack_multi', 'mod_hp_rage_multi'],
                  'zone_csv': zones['mod_hp_zone']['0'], 'spawn_nodes': nodes,
                  'group_sizes': terrain('battle/terrain/mod/hell_pumpkin/hp_terrain.amf3.deflate'),
                  'enemy_kind': 'GeneralBoss', 'funnel_kind': nodes['hp_sum_white3d_multi'][0]['node'][1][1]})
    evidence = {'status': 'source-extracted', 'view': str(AUDIT), 'view_sha256': sha(AUDIT.read_bytes()),
                'scope': '本地261底链+SHA锁定bundle262的资产提取；不是当前服务器或设备观测。',
                'fixture_boundary': '每个场景三个独立Battle，按地形全部召唤槽占满建立首次全量采样；'
                    'boss种类/地形容量来自真实资产，状态/RNG/HP/试炼值是明确合成。'
                    '不声称各阶段所有召唤物会在真实frame0同时存活。',
                'sources': sources, 'cases': cases}
    output = ROOT / 'scale-evidence' / 'asset-scale-spec.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'path': str(output), 'cases': [{k: c[k] for k in ('name', 'group_sizes')} for c in cases]}, ensure_ascii=False))
    return evidence


if __name__ == '__main__':
    extract()
