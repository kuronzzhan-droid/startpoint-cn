"""Lock every C4 file and verify its sealed delivery before C5 work."""
import json
from bootstrap import C4, ROOT, WORKSPACE, BASE, BASE_SHA, P13, P13_SHA, require_hash, sha, write_json


def main():
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    sealed = json.loads((C4 / 'C4-DELIVERY-MANIFEST.json').read_text('utf-8'))
    assert sealed['status'] == 'sealed' and sealed['swf_sha256'] == BASE_SHA
    for name, row in sealed['files'].items():
        require_hash(WORKSPACE / name, row['sha256'])
    inputs = sorted(p for p in C4.rglob('*') if p.is_file())
    inputs += [WORKSPACE / name for name in ('C4-REPORT.md', 'C5-BRIEF.md')]
    inputs.append(P13)
    target = ROOT / 'audit/input-lock.json'
    if target.exists():
        for name, row in json.loads(target.read_text('utf-8'))['inputs'].items():
            require_hash(name, row['sha256'])
    write_json(target, {'status': 'locked', 'c4_sealed_manifest_verified': True,
        'inputs': {str(p): {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size} for p in inputs}})
    print(json.dumps({'status': 'locked', 'files': len(inputs)}))


if __name__ == '__main__':
    main()
