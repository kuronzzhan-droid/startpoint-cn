"""Run the sealed 62-suite C1-C22 registry on one immutable port175 artifact."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'validation'
AUDIT = ROOT / 'audit/riven-tests'
sys.dont_write_bytecode = True
sys.path.insert(0, str(OUT))
from c22_validate import INHERITED, C22, FIXTURES
from support import FINAL, sha

SUITES = [*INHERITED, *C22]
SEALED = ROOT.parent / 'client-p1/build-c22/validation'
BASELINE = json.loads((AUDIT / 'sealed-c22-results.json').read_text('utf-8'))


def source_hashes():
    paths = list(OUT.glob('*.py')) + list((ROOT / 'test-support').rglob('*.py')) + list((AUDIT / 'protocol').glob('*.py'))
    return {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in sorted(paths)}


def audit_sources():
    changed, diff = [], []
    for path in sorted(OUT.glob('*.py')):
        original = SEALED / path.name
        if not original.exists():
            continue
        before, after = original.read_bytes(), path.read_bytes()
        if before == after:
            continue
        changed.append({'file': path.name, 'sealed_sha256': sha(before), 'current_sha256': sha(after)})
        diff.extend(difflib.unified_diff(before.decode('utf-8').splitlines(True), after.decode('utf-8').splitlines(True), fromfile='sealed-c22/' + path.name, tofile='port175/' + path.name))
    (AUDIT / 'validation-source.diff').write_text(''.join(diff), 'utf-8')
    (AUDIT / 'validation-source-changes.json').write_text(json.dumps({'changes': changed, 'case_policy': 'Every sealed suite and per-suite count retained; only path binding, explicit port identity oracle and documented host adapters may change.'}, indent=2), 'utf-8')


def summarize():
    digest = sha(FINAL.read_bytes())
    results = {}
    for name, script, filename in SUITES:
        path = OUT / filename
        detail = json.loads(path.read_text('utf-8'))
        expected = BASELINE['suites'][name]['case_count']
        assert detail['status'] == 'passed' and detail['swf_sha256'] == digest, name
        assert detail['case_count'] == expected, (name, detail['case_count'], expected)
        results[name] = {'status': 'passed', 'case_count': expected, 'swf_sha256': digest,
                         'report': filename, 'report_sha256': sha(path.read_bytes())}
    assert len(results) == 62
    assert sum(row['case_count'] for row in results.values()) == 1666
    report = {'status': 'passed', 'swf': str(FINAL), 'swf_sha256': digest, 'suite_count': 62,
              'case_count': 1666, 'sealed_c22_baseline_sha256': sha((AUDIT / 'sealed-c22-results.json').read_bytes()),
              'suites': results, 'validation_source_sha256': source_hashes(),
              'fixture_sha256': {name: sha((OUT / name).read_bytes()) for name in FIXTURES},
              'boundary': 'Actual serialized AVM2 methods execute in a limited Python interpreter with explicit native/UI/assets/transport adapters. C6/C14/C15 test cold-start/login/error recovery paths; no Android AIR, device rendering, live network/server, or real combat execution.',
              'device_runtime_verified': False}
    (OUT / 'all-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    cold = {name: results[name] for name in ('startup', 'login', 'c14_text', 'c15_startup', 'c15_getters')}
    (AUDIT / 'cold-start-results.json').write_text(json.dumps({'status': 'passed', 'swf_sha256': digest,
        'suites': cold, 'boundary': report['boundary'], 'device_runtime_verified': False}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps({'status': 'passed', 'suite_count': 62, 'case_count': 1666, 'swf_sha256': digest}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--suite', action='append', choices=[r[0] for r in SUITES])
    parser.add_argument('--summary-only', action='store_true')
    parser.add_argument('--inventory-only', action='store_true')
    parser.add_argument('--jobs', type=int, default=3)
    args = parser.parse_args()
    assert __debug__
    assert BASELINE['status'] == 'passed' and BASELINE['case_count'] == 1666
    assert len(SUITES) == len(BASELINE['suites']) == 62
    assert set(BASELINE['suites']) == {row[0] for row in SUITES}
    for name, expected in BASELINE['fixture_sha256'].items():
        assert sha((OUT / name).read_bytes()) == expected, name
    audit_sources()
    if args.inventory_only:
        print(json.dumps({'status': 'ready', 'suite_count': 62, 'case_count': 1666, 'swf': str(FINAL)}))
        return
    if args.summary_only:
        summarize()
        return
    initial, sources = sha(FINAL.read_bytes()), source_hashes()
    def run_suite(row):
        name, script, filename = row
        process = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(OUT / script)],
            cwd=str(ROOT), capture_output=True, text=True, encoding='utf-8', errors='strict',
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONDONTWRITEBYTECODE': '1'})
        (OUT / (name + '-execution.log')).write_text(process.stdout + process.stderr, 'utf-8')
        return name, process.returncode, process.stderr[-5000:]
    selected = [row for row in SUITES if not args.suite or row[0] in args.suite]
    failures = {}
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for future in as_completed([pool.submit(run_suite, row) for row in selected]):
            name, code, error = future.result()
            print(name + (': passed' if code == 0 else ': FAILED'), flush=True)
            if code:
                failures[name] = error
    assert sha(FINAL.read_bytes()) == initial, 'Artifact changed during validation'
    assert sources == source_hashes(), 'Validation sources changed during run'
    (AUDIT / 'last-run.json').write_text(json.dumps({'swf_sha256': initial, 'selected_suites': [r[0] for r in selected], 'failures': failures}, indent=2), 'utf-8')
    assert not failures, failures
    if not args.suite:
        summarize()


if __name__ == '__main__':
    main()
