"""Lock the C1 delivery and every source/fixture that C2 reads."""
from bootstrap import C1, ROOT, BASE, P13, BASE_SHA, P13_SHA, require_hash, sha, write_json


def main():
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    inputs = [p for p in C1.rglob('*') if p.is_file()
              and '__pycache__' not in p.parts and 'client' not in p.relative_to(C1).parts]
    write_json(ROOT / 'audit/input-lock.json', {'inputs': {
        str(p): {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size} for p in sorted(inputs)}})
    print({'status': 'locked', 'c1_input_files': len(inputs)})


if __name__ == '__main__':
    main()
