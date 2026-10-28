"""Verify sealed revised C19 and lock every immutable C20 input."""
import hashlib
import json
from bootstrap import C18, C19, C15, ROOT, WORKSPACE, BASE, BASE_SHA, P13, P13_SHA
from bootstrap import require_hash, write_immutable


def inventory():
    paths = {*C19.rglob('*'), *C18.rglob('*'), P13, WORKSPACE / 'C20-BRIEF.md',
             *(C15 / 'audit/c15').glob('*'),
             WORKSPACE.parent / 'server-wt/RIVEN-V3-REPORT.md',
             WORKSPACE.parent / 'P1-CONTRACT.md'}
    for folder, name in ((C19, 'C19-DELIVERY-MANIFEST.json'),
                         (C18, 'C18-DELIVERY-MANIFEST.json')):
        manifest = json.loads((folder / name).read_text('utf-8'))
        paths.update(WORKSPACE / item for item in manifest['files'])
    result = {}
    for path in sorted(p for p in paths if p.is_file()):
        with path.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        result[str(path)] = {'sha256': digest, 'bytes': path.stat().st_size}
    return result


def main():
    assert __debug__
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    manifest_path = C19 / 'C19-DELIVERY-MANIFEST.json'
    require_hash(manifest_path, '0bd5c677525bc6f5c60f8a1b0a8f4f41d3c942382aa489a831b3c2878175f23b')
    sealed = json.loads(manifest_path.read_text('utf-8'))
    assert sealed['status'] == 'sealed' and sealed['swf_sha256'] == BASE_SHA
    assert sealed['version_code'] == 1008080
    current = inventory()
    for name, row in sealed['files'].items():
        assert current[str(WORKSPACE / name)] == row, name
    result = {'status': 'locked', 'c19_sealed_manifest_verified': True, 'inputs': current}
    write_immutable(ROOT / 'audit/input-lock.json',
                    (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'status': 'locked', 'files': len(current)}))


if __name__ == '__main__':
    main()
