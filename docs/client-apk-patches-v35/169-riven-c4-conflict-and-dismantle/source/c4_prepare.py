"""Lock the C3 delivery and every source/fixture that C4 reads."""
from bootstrap import C3, ROOT, WORKSPACE, C1, BASE, P13, BASE_SHA, P13_SHA, require_hash, sha, write_json


def main():
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    inputs = [p for p in C3.rglob('*') if p.is_file()
              and '__pycache__' not in p.parts and 'client' not in p.relative_to(C3).parts]
    inputs += [p for p in C1.rglob('*') if p.is_file() and '__pycache__' not in p.parts
               and 'client' not in p.relative_to(C1).parts]
    inputs += [WORKSPACE / name for name in ('C1-REPORT.md', 'C2-REPORT.md', 'C3-REPORT.md', 'C4-BRIEF.md')]
    inputs += [WORKSPACE.parent / 'P1-CONTRACT.md', WORKSPACE.parent / 'review2/REVIEW.md']
    lock_path = ROOT / 'audit/input-lock.json'
    if lock_path.exists():
        import json
        for filename, item in json.loads(lock_path.read_text('utf-8'))['inputs'].items():
            require_hash(filename, item['sha256'])
    write_json(ROOT / 'audit/input-lock.json', {'inputs': {
        str(p): {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size} for p in sorted(inputs)}})
    print({'status': 'locked', 'c3_input_files': len(inputs)})


if __name__ == '__main__':
    main()
