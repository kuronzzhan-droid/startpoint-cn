"""Reconcile final files, source locks and existing evidence; do not rerun suites."""
import ast
import json
from pathlib import Path
import re

import bootstrap
from bootstrap import ROOT, load_lock, sha, write_json
from atlas_preload.patch import TARGETS


def read(relative):
    return json.loads((ROOT / relative).read_text('utf-8'))


def file_sha(path):
    return sha(path.read_bytes())


def main():
    lock = load_lock()
    lock_sha = file_sha(ROOT / 'build-lock.json')
    report = (ROOT / 'P11-PATCH-REPORT.md').read_text('utf-8')
    assert '@@' not in report
    links = re.findall(r'\]\(([^)]+)\)', report)
    for link in links:
        if link not in ('SHA256SUMS.txt', 'FINAL-VERIFICATION.json'):
            assert (ROOT / link).exists(), link
    sources = list(ROOT.rglob('*.py'))
    for path in sources:
        ast.parse(path.read_text('utf-8-sig'), filename=str(path))
    assert not list(ROOT.rglob('__pycache__'))
    profiles = {}
    binding = read('regression/INPUTS.json')
    for profile in ('test', 'local'):
        swf = ROOT / 'build' / f'v35abyss-p11-{profile}.swf'
        digest = file_sha(swf)
        build = read(f'build/build-{profile}.json')
        audit = read(f'audit/methods-{profile}.json')
        behavior = read(f'review/behavior-review-{profile}.json')
        assert build['status'] == audit['status'] == 'pass'
        assert behavior['pass']
        assert build['sha256'] == audit['after_sha256'] == behavior['sha256'] == digest
        assert build['build_lock_sha256'] == lock_sha
        assert build['input_sha256'] == audit['before_sha256'] == lock['profiles'][profile]['swf_sha256']
        assert set(build['changed']) == {row['label'] for row in audit['changed_bodies']} == set(TARGETS)
        assert audit['unchanged_bodies'] == 96983
        assert behavior['behavior_cases'] == 116 and behavior['distinct_tag_cases'] == 29
        assert binding['inputs'][profile]['sha256'] == digest
        assert binding['method_audits'][profile]['sha256'] == file_sha(ROOT / f'audit/methods-{profile}.json')
        assert digest in report
        profiles[profile] = {'swf': str(swf), 'sha256': digest, 'unchanged_body_records': 96983,
                             'preload_cases': 116, 'uid_equivalence_cases': 29}
    runs, summary = read('regression/RUN-RESULTS.json'), read('regression/SUMMARY.json')
    assert runs['status'] == 'pass' and runs['executions'] == 33 and runs['failed_executions'] == 0
    assert summary['total_recorded_checks'] == 704
    receipts = list((ROOT / 'regression/receipts').glob('*.json'))
    assert len(receipts) == 33
    for receipt in receipts:
        row = json.loads(receipt.read_text('utf-8'))
        assert row['status'] == 'pass' and row['same_source_as_p10_execution']
        assert row['swf_sha256'] == profiles[row['profile']]['sha256']
        path = Path(row['source'])
        assert file_sha(path) == row['source_sha256']
        adapted = ROOT / 'regression/adapted' / f"{row['suite']}-{row['profile']}.py.txt"
        assert sha(adapted.read_text('utf-8').encode('utf-8')) == row['adapted_source_sha256']
    dedup = read('review/module-dedup-review.json')
    assert dedup['pass'] and len(dedup['checks']) == 6 and all(row['pass'] for row in dedup['checks'])
    review = (ROOT / 'review/REVIEW.md').read_text('utf-8')
    for path in (ROOT / 'atlas_preload').glob('*.py'):
        assert file_sha(path) in report and file_sha(path) in review, path
    files = [path for path in ROOT.rglob('*') if path.is_file()]
    assert not [path for path in files if path.suffix.lower() in ('.apk', '.idsig', '.jks', '.keystore')]
    result = {'status': 'pass', 'build_lock_sha256': lock_sha, 'locked_source_files': len(lock['source_files']),
              'profiles': profiles, 'regression_executions': 33, 'regression_recorded_checks': 704,
              'dedup_checks': 6, 'python_sources_syntax_checked': len(sources),
              'report_sha256': file_sha(ROOT / 'P11-PATCH-REPORT.md'), 'runtime_verified': False,
              'evidence_files': {str(path.relative_to(ROOT)).replace('\\', '/'): file_sha(path)
                                 for path in sorted(files)
                                 if path.name not in ('SHA256SUMS.txt', 'FINAL-VERIFICATION.json')}}
    write_json(ROOT / 'FINAL-VERIFICATION.json', result)
    files = sorted(path for path in ROOT.rglob('*') if path.is_file() and path.name != 'SHA256SUMS.txt')
    sums = '\n'.join(f"{file_sha(path)}  {path.relative_to(ROOT).as_posix()}" for path in files) + '\n'
    (ROOT / 'SHA256SUMS.txt').write_text(sums, 'utf-8')
    for line in sums.splitlines():
        digest, relative = line.split('  ', 1)
        assert file_sha(ROOT / relative) == digest
    assert all((ROOT / link).exists() for link in links)
    print(json.dumps({'status': 'pass', 'checksummed_files': len(files), 'source_locks': len(lock['source_files']),
                      'regression_executions': 33, 'recorded_checks': 704, 'runtime_verified': False}))


if __name__ == '__main__':
    main()
