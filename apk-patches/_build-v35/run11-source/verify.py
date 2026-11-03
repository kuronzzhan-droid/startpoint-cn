"""第十一轮离线验收；支持复用同次、同SWF且源码未变的完整通过证据。"""
import argparse
import json
import subprocess
import sys
import time
import traceback
from bootstrap import ROOT, BASE, BASE_SHA, output_path, check_baseline
from framework import sha
from source_guard import verify as verify_readonly
from task_contract import verify as verify_task

GROUPS = ('direct_count', 'heal_any')


def read(name):
    return json.loads((ROOT/name).read_text(encoding='utf-8'))


def write(name, value):
    output_path(ROOT/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def source_manifest():
    excluded = {'work', 'apk-patches-additions', '__pycache__'}
    return [{'path': p.relative_to(ROOT).as_posix(), 'sha256': sha(p.read_bytes())}
            for p in sorted(ROOT.rglob('*.py'))
            if not excluded.intersection(p.relative_to(ROOT).parts)]


def source_locks(rows):
    assert rows, '缺少源码锁'
    for row in rows:
        path = (ROOT/row['path']).resolve()
        assert path.is_relative_to(ROOT.parent), row['path']
        assert '-aborted' not in str(path), row['path']
        assert sha(path.read_bytes()) == row['sha256'], row['path']


def behavior(group, reuse, digest):
    if not reuse:
        subprocess.run([sys.executable, '-B', str(ROOT/group/'verify.py'),
                        '--before', str(BASE), '--after', str(ROOT/'v35k.swf')], check=True)
    report = read(group+'/verify-report.json')
    source_locks(report['evidence_source_locks'])
    assert report['status'] == 'pass' and report['before_swf_sha256'] == BASE_SHA, group
    assert report['after_swf_sha256'] == digest, group
    assert report['final_baseline'] == 'pass' and not report['survived'], group
    assert report['mutant_count'] > 0, group
    return report


def framework(reuse, digest):
    if reuse:
        report = read('framework-report.json')
        record = report['verification_source_manifest']
        assert sha((ROOT/record['path']).read_bytes()) == record['sha256']
        locks = read(record['path'])
        assert locks['unchanged_during_verification']
        assert locks['input_swf_sha256'] == BASE_SHA and locks['output_swf_sha256'] == digest
        source_locks([{'path': k, 'sha256': v} for k, v in locks['files'].items()])
    else:
        from verify_framework import verify
        report = verify()
        write('framework-report.json', report)
    assert report['output_sha256'] == digest
    assert report['byte_identical_replay'] and report['v34_chain_byte_identical']
    return report


def cross_review(digest):
    subprocess.run([sys.executable, '-B', str(ROOT/'audit/cross_review.py'),
                    '--after', str(ROOT/'v35k.swf')], check=True)
    report = read('audit/cross-review-report.json')
    assert report['status'] == 'pass' and report['swf_sha256'] == digest
    source_locks(report['evidence_source_locks'])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reuse-verified', action='store_true')
    parser.add_argument('--reuse-behavior', action='store_true')
    args = parser.parse_args()
    started = time.monotonic()
    report = {'status': 'running', 'baseline_swf_sha256': BASE_SHA,
              'scope': 'TASK11第三版：码33原生直击；码34逐成员档位及持有者CT，发伤起算且CT内丢弃；码35不受CT限制',
              'unverified': ['完整AIR虚拟机', 'Android真机', '实际画面', '真实联机两端去重', '设备性能']}
    try:
        check_baseline()
        decisions = verify_task()
        verify_readonly()
        sources = source_manifest()
        digest = sha((ROOT/'v35k.swf').read_bytes())
        groups = {}
        for group in GROUPS:
            print('核对真实字节码行为和变异：'+group, flush=True)
            groups[group] = behavior(group, args.reuse_verified or args.reuse_behavior, digest)
        review = cross_review(digest)
        from audit.ct_delta import verify as verify_ct_delta
        ct_delta = verify_ct_delta()
        subprocess.run([sys.executable, '-B', str(ROOT/'audit/ct_review.py')], check=True)
        ct_review = read('audit/ct-review-report.json')
        assert ct_review['output_swf_sha256'] == digest
        print('核对整包保持、双锁及十一轮串联重放', flush=True)
        frame = framework(args.reuse_verified, digest)
        readonly = verify_readonly()
        write('readonly-source-report.json', readonly)
        assert source_manifest() == sources, '验收期间源码改变'
        assert sha((ROOT/'v35k.swf').read_bytes()) == digest
        write('verification-source-locks.json', sources)
        old = sum(g['old_parity_count'] for g in groups.values())
        new = sum(g['new_check_count'] for g in groups.values())
        report.update(status='pass', output_swf_sha256=digest,
            requirement_decisions=decisions,
            old_parity_checks=old, new_checks=new, checks_total=old+new,
            mutation_total=sum(g['mutant_count'] for g in groups.values()), mutation_survivors=0,
            final_baseline='pass', behavior_reports=[g+'/verify-report.json' for g in GROUPS],
            independent_cross_review={'report': 'audit/cross-review-report.json',
                'checks': review['count'], 'status': 'pass', 'counted_in_business_total': False},
            ct_second_edition_delta={'report': 'audit/ct-delta-report.json',
                'status': ct_delta['status'], 'counted_in_business_total': False},
            ct_independent_cross_review={'report':'audit/ct-review-report.json',
                'status':ct_review['status'], 'counted_in_business_total':False},
            framework={'report': 'framework-report.json', 'changed_methods': frame['changed_methods'],
                'added_methods': frame['added_methods'], 'original_body_count': frame['whole_swf_original_body_count'],
                'unchanged_body_records': frame['whole_swf_unchanged_body_records'],
                'method_lock_negative_cases': len(frame['method_lock_negative_cases']),
                'release_lock_negative_cases': len(frame['release_lock_negative_cases']),
                'static_negative_cases': len(frame['static_negative_controls']),
                'byte_identical_replay': frame['byte_identical_replay'],
                'v34_chain_byte_identical': frame['v34_chain_byte_identical']},
            evidence_reuse={'behavior': args.reuse_verified or args.reuse_behavior,
                            'framework': args.reuse_verified,
                            'condition': '同次完整基线和变异已通过，前后SWF及相关源码SHA一致'},
            readonly_sources=readonly, verification_source_manifest='verification-source-locks.json')
    except BaseException as exc:
        report.update(status='fail', error=str(exc), traceback=traceback.format_exc())
        raise
    finally:
        report['elapsed_seconds'] = round(time.monotonic()-started, 3)
        write('verify-report.json', report)
    print(json.dumps({k: report[k] for k in ('status', 'checks_total', 'mutation_total', 'output_swf_sha256')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
