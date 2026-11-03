"""第八轮只读范围快照；仅在 run8 写报告，所有外部差异严格拒绝。"""
import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SNAPSHOT = ROOT / 'readonly-source-locks.json'
V34 = Path(r'D:\WF\v34-r4-20261016\v34.swf')
BASE_SHA = '960757dbaf599b5d4978b95670b9bbe3e76fac5cfd29045b8c9c0dd1a1ca0870'
V34_SHA = '3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def inventory():
    files, directories = {}, []
    for current, children, names in os.walk(ROOT.parent, followlinks=False):
        current = Path(current)
        children[:] = sorted(n for n in children if (current / n).resolve() != ROOT)
        if current != ROOT.parent:
            directories.append(current.relative_to(ROOT.parent).as_posix())
        for name in sorted(names):
            path = current / name
            files[path.relative_to(ROOT.parent).as_posix()] = {
                'sha256': digest(path), 'bytes': path.stat().st_size}
    assert digest(ROOT.parent / 'run7/v35g.swf') == BASE_SHA, '输入 v35g SHA 不符，停止'
    assert digest(V34) == V34_SHA, 'v34 起点 SHA 不符，停止'
    return {'workspace': str(ROOT.parent), 'files': files,
            'directories': sorted(directories),
            'external': {str(V34): {'sha256': digest(V34), 'bytes': V34.stat().st_size}}}


def capture():
    assert not SNAPSHOT.exists(), '不得覆盖最初快照'
    result = inventory()
    SNAPSHOT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'captured': True, 'file_count': len(result['files']), 'external_count': 1}


def verify():
    before = json.loads(SNAPSHOT.read_text(encoding='utf-8'))
    after = inventory()
    old, new = before['files'], after['files']
    differences = {
        'new_files': sorted(set(new) - set(old)),
        'missing_files': sorted(set(old) - set(new)),
        'changed_files': sorted(k for k in set(old) & set(new) if old[k] != new[k]),
        'new_directories': sorted(set(after['directories']) - set(before['directories'])),
        'missing_directories': sorted(set(before['directories']) - set(after['directories'])),
    }
    assert not any(differences.values()), differences
    assert before['external'] == after['external'], '外部 v34 输入变化'
    return {'pass': True, 'workspace_snapshot_exact': True,
            'initially_locked_files_unchanged': len(old), 'external_count': 1,
            'differences': differences, 'snapshot_sha256': digest(SNAPSHOT),
            'scope': '工作区除 run8 的全部文件和目录，以及指定外部 v34 输入'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='store_true')
    args = parser.parse_args()
    result = capture() if args.capture else verify()
    if not args.capture:
        (ROOT / 'readonly-source-report.json').write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
