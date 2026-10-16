"""Stage a complete private admission pair without activating it."""
import json, secrets
from common import PRIVATE, PAIR, IDS, OLD_IDS, sha, dump, pair

def main():
    if PAIR.exists():
        pair()
        print('Existing batch pair verified; no new credentials allocated.')
        return
    policy_raw = (PRIVATE/'config/client-admission.json').read_bytes()
    keys_raw = (PRIVATE/'config/client-admission.keys.json').read_bytes()
    policy = json.loads(policy_raw.decode('utf-8-sig'))
    keys = json.loads(keys_raw.decode('utf-8-sig'))
    assert all(r['id'] in keys for r in policy['builds'])
    assert all(old in keys for old in OLD_IDS.values())
    assert not any(r['id'] in IDS.values() for r in policy['builds'])
    assert not any(build in keys for build in IDS.values())
    (PAIR/'before/config').mkdir(parents=True)
    (PAIR/'before/config/client-admission.json').write_bytes(policy_raw)
    (PAIR/'before/config/client-admission.keys.json').write_bytes(keys_raw)
    (PAIR/'before/registry.json').write_bytes((PRIVATE/'registry.json').read_bytes())
    for platform, build in IDS.items():
        keys[build] = secrets.token_hex(32)
        policy['builds'].append({'id': build, 'name': 'StarPoint CN 1043 统一机制 '+platform,
                                'platform': platform, 'enabled': True, 'allowUntil': None})
    dump(PAIR/'config/client-admission.keys.json', keys)
    dump(PAIR/'config/client-admission.json', policy)
    pair()
    report = {'batch': 'author-1043-public-20260924', 'status': 'prepared_not_activated',
              'old_ids': OLD_IDS, 'new_ids': IDS, 'enforce': policy['enforce'],
              'previous_policy_sha256': sha(policy_raw), 'previous_keys_sha256': sha(keys_raw),
              'policy_sha256': sha((PAIR/'config/client-admission.json').read_bytes()),
              'keys_sha256': sha((PAIR/'config/client-admission.keys.json').read_bytes()),
              'cloud_deployed': False, 'master_updated': False}
    dump(PAIR/'batch.json', report)
    print(json.dumps({k:report[k] for k in ('batch','status','old_ids','new_ids','enforce')}))

if __name__ == '__main__':
    main()
