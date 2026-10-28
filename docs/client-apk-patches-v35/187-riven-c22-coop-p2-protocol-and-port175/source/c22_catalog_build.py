"""Read actual client resource archives; emit a locked P2 catalog manifest."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from bootstrap import ROOT, WORKSPACE, sha, write_json, output_path

TABLES = ('master/ability/ability_soul.orderedmap', 'master/item/equipment.orderedmap',
          'master/item/item.orderedmap', 'master/string/custom_ability_string.orderedmap')
SALT = 'K6R9T9Hz22OpeIGEWB0ui6c6PYFQnJGy'


def member_name(logical):
    value = hashlib.sha1((logical + SALT).encode()).hexdigest()
    return 'production/upload/' + value[:2] + '/' + value[2:]


def verify_locked():
    """Verify the locked inputs without regenerating or accepting changed data."""
    from c22_catalog import CATALOG_ID
    audit = json.loads((ROOT / 'audit/types-consumer/catalog.json').read_bytes())
    assert audit['catalog_id'] == CATALOG_ID
    assert sha(Path(audit['manifest']).read_bytes()) == audit['manifest_sha256']
    for row in audit['resources']:
        if 'archive' in row:
            archive = Path(row['archive'])
            assert sha(archive.read_bytes()) == row['archive_sha256']
            with zipfile.ZipFile(archive) as source:
                raw = source.read(row['member'])
        else:
            sys.path.insert(0, '<WORKDIR>/wf-mod-tools-worktrees/m4-integrate')
            from wf_enhancement_policy import OfficialBaseline
            raw = OfficialBaseline(Path(row['cdn']), write_cache=False).get(
                'common', row['member'].removeprefix('production/upload/'))
        assert sha(raw) == row['sha256'], row['logical']
        saved = ROOT / 'audit/types-consumer/catalog-resources' / row['logical']
        assert saved.read_bytes() == raw
    canonical = ''.join(row['logical'] + '\t' + row['sha256'] + '\n'
                        for row in sorted(audit['resources'], key=lambda x: x['logical']))
    assert CATALOG_ID == 'riven-multi-v1-' + sha(canonical.encode())[:32]
    return {'status': 'passed', 'catalog_id': CATALOG_ID, 'resource_count': len(audit['resources'])}


def build():
    assets = WORKSPACE.parent / 'localsrv-riven/assets/asset-patch'
    manifest_path = assets / 'manifest.json'
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw)
    wanted = {member_name(logical): logical for logical in TABLES}
    latest, archive_evidence = {}, []
    for entry in manifest['patches']:
        if not entry.get('enabled', True):
            continue
        for name in entry.get('chain', [entry.get('archive')]):
            if not name:
                continue
            paths = [assets / 'active' / name, assets / name]
            path = next((p for p in paths if p.is_file()), None)
            if path is None:
                # Historical manifest entries may be archived elsewhere; only
                # the actual active-chain resource files are candidates here.
                continue
            with zipfile.ZipFile(path) as archive:
                hits = set(archive.namelist()) & wanted.keys()
                for member in sorted(hits):
                    raw = archive.read(member)
                    latest[wanted[member]] = (raw, {'archive': str(path),
                        'archive_sha256': sha(path.read_bytes()), 'member': member,
                        'version': entry['version']})
                    archive_evidence.append(dict(latest[wanted[member]][1]))
    missing = set(TABLES) - latest.keys()
    if missing:
        sys.path.insert(0, '<WORKDIR>/wf-mod-tools-worktrees/m4-integrate')
        from wf_enhancement_policy import OfficialBaseline
        cdn = Path('<WORKDIR>/startpoint-cn-kulo/.cdn/cn')
        baseline = OfficialBaseline(cdn, write_cache=False)
        for logical in sorted(missing):
            member = member_name(logical)
            raw = baseline.get('common', member.removeprefix('production/upload/'))
            assert raw, ('Missing actual client table', logical)
            latest[logical] = (raw, {'source': 'official CDN baseline',
                                    'cdn': str(cdn), 'member': member})
    evidence = []
    for logical in TABLES:
        raw, source = latest[logical]
        evidence.append({'logical': logical, 'sha256': sha(raw), 'bytes': len(raw), **source})
        output_path(ROOT / 'audit/types-consumer/catalog-resources' / logical).write_bytes(raw)
    canonical = ''.join(row['logical'] + '\t' + row['sha256'] + '\n'
                        for row in sorted(evidence, key=lambda x: x['logical']))
    catalog_id = 'riven-multi-v1-' + sha(canonical.encode())[:32]
    # Decode the actual full table, then prove each current generator affix is
    # present byte-for-byte at the row/cell level; metadata alone is not enough.
    sys.path.insert(0, str(WORKSPACE.parent / 'library/generator'))
    from riven_sources import flat_table
    souls = flat_table(latest[TABLES[0]][0])
    delta_path = WORKSPACE.parent / 'library/generator/out/client_master_delta.json'
    delta = json.loads(delta_path.read_bytes())['flat'][TABLES[0]]
    for key, rows in delta.items():
        assert souls[key] == rows, ('Affix resource differs from generator', key)
    carriers = sorted(int(k) for k in souls if 16000001 <= int(k) <= 16000999)
    assert carriers and carriers == list(range(16000001, max(carriers) + 1))
    assert len(delta) == 96
    result = {'status': 'passed', 'catalog_id': catalog_id,
              'algorithm': 'riven-multi-v1- + SHA256(sorted logical TAB raw-resource-SHA256 LF)[:32]',
              'canonical': canonical, 'resources': evidence,
              'manifest': str(manifest_path), 'manifest_sha256': sha(manifest_raw),
              'affix_keys': sorted(map(int, delta)), 'carrier_min': min(carriers),
              'carrier_max': max(carriers), 'carrier_count': len(carriers),
              'generator_delta_sha256': sha(delta_path.read_bytes()),
              'affixes_equal_actual_resource_rows': True,
              'server_rule_digest_in_catalog': False,
              'resource_package_verified_locally': True,
              'device_loaded_resources_verified': False}
    write_json(ROOT / 'audit/types-consumer/catalog.json', result)
    source = ('"""Build-locked P2 client resource catalog; generated from actual table bytes."""\n'
              f'CATALOG_ID = {catalog_id!r}\n'
              f'AFFIX_KEYS = {tuple(result["affix_keys"])!r}\n'
              f'CARRIER_MIN = {min(carriers)}\nCARRIER_MAX = {max(carriers)}\n')
    output_path(ROOT / 'source/c22_catalog.py').write_text(source, 'utf-8')
    print(json.dumps({k: result[k] for k in ('status', 'catalog_id', 'carrier_count')}, ensure_ascii=False))
    return result


if __name__ == '__main__':
    build()
