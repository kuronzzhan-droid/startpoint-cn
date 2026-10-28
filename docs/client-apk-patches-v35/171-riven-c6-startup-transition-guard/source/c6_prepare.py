"""Verify sealed C5 delivery and lock immutable inputs before C6 work."""
import json
from bootstrap import C5, ROOT, WORKSPACE, BASE, BASE_SHA, P13, P13_SHA, require_hash, sha, write_json


def main():
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    manifest_path = C5 / 'C5-DELIVERY-MANIFEST.json'
    sealed = json.loads(manifest_path.read_text('utf-8'))
    assert sealed['status'] == 'sealed' and sealed['swf_sha256'] == BASE_SHA
    assert sealed['version_code'] == 1008056
    for name, row in sealed['files'].items():
        require_hash(WORKSPACE / name, row['sha256'])
    inputs = sorted(p for p in C5.rglob('*') if p.is_file())
    inputs += [WORKSPACE / name for name in ('C5-REPORT.md', 'C6-BRIEF.md')]
    inputs.append(P13)
    target = ROOT / 'audit/input-lock.json'
    if target.exists():
        for name, row in json.loads(target.read_text('utf-8'))['inputs'].items():
            require_hash(name, row['sha256'])
    write_json(target, {'status': 'locked', 'c5_sealed_manifest_verified': True,
        'inputs': {str(p): {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size} for p in inputs}})
    print(json.dumps({'status': 'locked', 'files': len(inputs)}))


if __name__ == '__main__':
    main()

