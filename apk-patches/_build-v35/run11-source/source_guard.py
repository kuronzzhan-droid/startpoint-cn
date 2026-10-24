"""第十一轮只读快照；旧中断目录不读取、不使用，仅在 run11 写报告。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from task_contract import accepted_task_change, ACK_SHA

ROOT = Path(__file__).resolve().parent
SNAPSHOT = ROOT / 'readonly-source-locks.json'
V34 = Path(r'D:\WF\v34-r4-20261016\v34.swf')
BASE_SHA = '1414862f84a1895b0bea54613f92fd48a59d11544a6097ef4dd2627c0dfe2384'
V34_SHA = '3d5c9745f519beee68557df7bce3e4ff635c9bb127069ed85a8fd02b5cbedb8a'
ACK_FILE = 'task-evidence/known-external-changes.json'
ACK_FILE_SHA = '5f19dfe64e712ac5bf1d834d83303b992bf2b381c9c40760f25e4247c092b8a0'


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
        children[:] = sorted(n for n in children if (current / n).resolve() != ROOT and '-aborted' not in n)
        if current != ROOT.parent:
            directories.append(current.relative_to(ROOT.parent).as_posix())
        for name in sorted(names):
            path = current / name
            files[path.relative_to(ROOT.parent).as_posix()] = {
                'sha256': digest(path), 'bytes': path.stat().st_size}
    assert digest(ROOT.parent / 'run10/v35j.swf') == BASE_SHA, '输入 v35j SHA 不符，停止'
    assert digest(V34) == V34_SHA, 'v34 起点 SHA 不符，停止'
    return {'workspace': str(ROOT.parent), 'files': files,
            'directories': sorted(directories),
            'external': {str(V34): {'sha256': digest(V34), 'bytes': V34.stat().st_size}}}


def capture():
    assert not SNAPSHOT.exists(), '不得覆盖最初快照'
    result = inventory()
    SNAPSHOT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'captured': True, 'file_count': len(result['files']), 'external_count': 1}


def acknowledged_changes():
    path = ROOT / ACK_FILE
    assert digest(path) == ACK_FILE_SHA, '已知外部变化登记漂移'
    record = json.loads(path.read_text(encoding='utf-8'))
    assert record['status'] == 'acknowledged'
    assert record['authorization']['sha256'] == ACK_SHA
    observed = record['observed_report']
    assert digest(ROOT / observed['path']) == observed['sha256'], '确认前只读报告漂移'
    report = json.loads((ROOT / observed['path']).read_text(encoding='utf-8'))
    assert record['changes'] == report['unapproved_differences'], '必须按原报告精确哈希登记'
    return [{**row, 'reason': record['reason'], 'acknowledgement': ACK_FILE}
            for row in record['changes']]


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
    accepted = accepted_task_change(old['TASK11.md'], new['TASK11.md'])
    external = acknowledged_changes()
    for row in external:
        assert old.get(row['path']) == row['before'], ('已知变化原锁不符', row['path'])
        assert new.get(row['path']) == row['after'], ('已知外部变化必须匹配精确哈希和大小', row['path'])
    assert differences['changed_files'] == sorted(['TASK11.md'] + [
        row['path'] for row in external if row['before'] is not None]), differences
    assert differences['new_files'] == sorted(row['path'] for row in external if row['before'] is None), differences
    assert not any(differences[k] for k in ('missing_files', 'new_directories', 'missing_directories')), differences
    assert before['external'] == after['external'], '外部 v34 输入变化'
    return {'status': 'pass', 'pass': True, 'workspace_snapshot_exact': False,
            'initially_locked_files_unchanged': len(old)-len(differences['changed_files']), 'external_count': 1,
            'accepted_changes': [accepted, *external], 'unapproved_differences': [],
            'differences': differences, 'snapshot_sha256': digest(SNAPSHOT),
            'scope': '工作区除 run11 与所有禁用的 run*-aborted* 的全部文件和目录，以及指定外部 v34 输入'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='store_true')
    args = parser.parse_args()
    result = capture() if args.capture else verify()
    if not args.capture:
        (ROOT / 'readonly-source-report.json').write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
