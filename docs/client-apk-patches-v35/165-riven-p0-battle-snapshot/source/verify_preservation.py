"""Recheck the previous turn's locked inputs and byte-identical source copies."""
import json
from pathlib import Path

from bootstrap import ROOT, sha, write_json


def main():
    lock_path = ROOT / 'audit/input-lock.json'
    copy_path = ROOT / 'audit/build-chain-copy.json'
    locked = json.loads(lock_path.read_text('utf-8'))
    copied = json.loads(copy_path.read_text('utf-8'))
    checked = {}

    def verify(path, expected):
        path = Path(path)
        if str(path) in checked:
            assert checked[str(path)] == expected
            return
        actual = sha(path.read_bytes())
        assert actual == expected, f'Locked input changed: {path}: {actual}'
        checked[str(path)] = actual

    for group in ('preserved_p13_files', 'preserved_p0_files'):
        for row in locked[group]:
            verify(row['path'], row['sha256'])
    for row in [*locked['copied_build_chain'], *copied['files']]:
        verify(row['source'], row['sha256'])
        verify(row['copy'], row['sha256'])
    report = {
        'status': 'passed', 'input_lock_sha256': sha(lock_path.read_bytes()),
        'copy_lock_sha256': sha(copy_path.read_bytes()),
        'preserved_p13_file_count': len(locked['preserved_p13_files']),
        'preserved_p0_file_count': len(locked['preserved_p0_files']),
        'inherited_p13_copy_count': len(locked['copied_build_chain']),
        'p0_build_chain_copy_count': len(copied['files']),
        'unique_verified_paths': len(checked), 'excluded_locked_files': [],
        'checked_hashes': checked,
    }
    write_json(ROOT / 'audit/input-preservation.json', report)
    print(json.dumps({k: v for k, v in report.items() if k != 'checked_hashes'}))


if __name__ == '__main__':
    main()
