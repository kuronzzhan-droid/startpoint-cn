"""为月兔风与澄波响建立隔离候选及键级差异，不改活动包/store/pending。"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'mod-tools'))
import wf_battle_rules as rules
import wf_client_legality as legality
import wf_midautumn_common as common
import wf_midautumn_specs as specs
import wf_midautumn_kit_hibiki as hibiki
import wf_midautumn_kitlib as kitlib
import wf_seasonal7_common as native
import wf_seasonal7_manifest as manifests
import wf_share_update_codec as codec


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf8')


def snapshot(path):
    return {p.relative_to(path).as_posix(): digest(p.read_bytes())
            for p in path.rglob('*') if p.is_file()}


def clone(key, destination):
    source = common.MAPack(specs.get_spec(key), record_sources=False)
    before = snapshot(source.workspace)
    out = destination/key
    out.mkdir()
    shutil.copy2(source.workspace/'workspace.json', out/'workspace.json')
    shutil.copytree(source.package, out/'package')
    (out/'evidence').mkdir()
    for name in ('table_claims.json', 'kit-report.json'):
        shutil.copy2(source.evidence/name, out/'evidence'/name)
    candidate = common.MAPack(source.spec, workspace=out, record_sources=False)
    return source, candidate, before


def donor(pack):
    for key, blob in sorted(pack.template_raw(kitlib.ABILITY).items()):
        for index, row in enumerate(codec.csv_read(blob)):
            if (len(row) == 126 and row[5] == '1' and row[85] == '(None)' and row[97] == '0'
                    and all(row[i] == '0' for i in (6, 13, 20))
                    and row[109] == '0' and row[110] == '0'):
                return row, {'table': kitlib.ABILITY, 'key': key, 'row': index}
    raise ValueError('no verified always-active self attack donor')


def replace_row(pack, logical, key, rows, delta):
    before = codec.unpack(pack.pkg_path('common', logical).read_bytes())
    pack.write_flat(logical, {key: rows})
    after = codec.unpack(pack.pkg_path('common', logical).read_bytes())
    if set(after) != set(before) or any(v != after[k] for k, v in before.items() if k != key):
        raise ValueError('foreign table key changed')
    delta.setdefault(logical, []).append({'path': [key], 'before': codec.node(before[key]),
                                         'after': codec.node(after[key])})


def fluffy_overlay(pack, delta):
    rows = codec.csv_read(codec.unpack(pack.pkg_path('common', kitlib.ABILITY).read_bytes())['1499872'])
    if len(rows) != 3 or any(row[109] == '423' for row in rows):
        raise ValueError('Fluffy A2 baseline drift')
    template, evidence = donor(pack)
    row = rules.make_row(template, rows[0][0], 423, rules.gauge_mask(['skill', 'ability']))
    row[:5] = rows[0][:5]
    problems = legality.client_legality_problems('ability', row)
    if problems:
        raise ValueError(problems)
    replace_row(pack, kitlib.ABILITY, '1499872', [*rows, row], delta)
    key = 'desc_override_combat_animal_moon_2'
    text = codec.csv_read(codec.unpack(pack.pkg_path('common', kitlib.CAS).read_bytes())[key])[0][0]
    addition = '自身无法因技能或能力效果增加技能槽（战斗开始时除外）'
    replace_row(pack, kitlib.CAS, key, [[text+'\n'+addition]], delta)
    return {'capability': rules.GAUGE_CAP, 'mask': 12, 'target': 'self', 'opening': 'preserved',
            'movement': 'preserved', 'combo_and_free_skill_invokes': 'preserved',
            'donor': evidence, 'panel': text+'\n'+addition}


def hibiki_overlay(pack, assets):
    logical = hibiki.INVOKE_PROGRAM+'.action.dsl.amf3.deflate'
    path = pack.pkg_path('common', logical)
    old = path.read_bytes()
    tree = native.amf_parse(old)
    if tree[0] != 'ActionDsl' or tree[10] != 3:
        raise ValueError('Hibiki invoke tree baseline drift')
    tree[10] = rules.segment_override('pf3')
    new = native.amf_bytes(tree)
    pack.write_pkg('common', logical, new)
    back = native.amf_parse(new)
    back[10] = 3
    if back != native.amf_parse(old):
        raise ValueError('non-target DSL change')
    assets.append({'root': 'common', 'logical_path': logical, 'before_sha256': digest(old),
                   'after_sha256': digest(new), 'candidate': str(path.resolve())})
    return {'capability': rules.DAMAGE_CAP, 'program': logical, 'buff_target_as': 133,
            'power_flip_level': 3, 'dash_cooldown_seconds': 1.5}


def stage(destination):
    destination = destination.resolve()
    if destination.exists() or destination.is_relative_to(ROOT.resolve()):
        raise ValueError('使用仓外全新目录；不能覆盖现有候选或活动工作区')
    destination.mkdir(parents=True)
    tables, assets, result = {}, [], {}
    for key in ('fluffy', 'hibiki'):
        source, candidate, before = clone(key, destination)
        original = snapshot(candidate.package/'roots')
        evidence = fluffy_overlay(candidate, tables) if key == 'fluffy' else hibiki_overlay(candidate, assets)
        report = candidate.read_evidence('kit-report.json', {})
        caps = report.setdefault('required_capabilities', [])
        if evidence['capability'] not in caps:
            caps.append(evidence['capability'])
        report['battle_rules'] = evidence
        candidate.write_evidence('kit-report.json', report)
        candidate.write_evidence('battle-rules.json', evidence)
        manifest_report = manifests.build(candidate)
        if manifest_report['required'] != '37/37' or manifest_report['release_ready']:
            raise ValueError('candidate assets incomplete or mistakenly release-ready')
        now = snapshot(candidate.package/'roots')
        changed = [p for p in original if original[p] != now.get(p)]
        expected = (['common/'+kitlib.ABILITY, 'common/'+kitlib.CAS] if key == 'fluffy'
                    else ['common/'+evidence['program']])
        if set(now) != set(original) or set(changed) != set(expected):
            raise ValueError('unexpected candidate asset changes')
        if snapshot(source.workspace) != before:
            raise ValueError('active character workspace changed')
        result[key] = {'manifest': manifest_report, 'changed': changed,
                       'preserved_files': len(original)-len(changed), 'rule': evidence}
    result.update(status='client_dependent_candidate', published=False, device_verified=False,
                  required_capabilities=[rules.GAUGE_CAP, rules.DAMAGE_CAP])
    save(destination/'candidate-report.json', result)
    save(destination/'client-delta.json', {'status': 'not_for_old_clients', 'tables': tables,
                                          'assets': assets, 'requires': result['required_capabilities']})
    print(json.dumps({'destination': str(destination), 'characters': 2, 'table_keys': 2,
                      'assets': 1, 'published': False}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    stage(parser.parse_args().destination)
