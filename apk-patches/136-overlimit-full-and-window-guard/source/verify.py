"""第八轮总验收；复用模式必须绑定同次完整测试、源码和SWF SHA。"""
import argparse
import importlib
import json
import time
import traceback
from bootstrap import ROOT, BASE, BASE_SHA, output_path
from framework import sha
from source_guard import verify as verify_readonly
from target_contract import GROUPS


def read(name):
    return json.loads((ROOT/name).read_text(encoding='utf-8'))


def write(name, value):
    output_path(ROOT/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def source_manifest():
    return [{'path': p.relative_to(ROOT).as_posix(), 'sha256': sha(p.read_bytes())}
            for p in sorted(ROOT.rglob('*.py'))
            if not {'work', 'apk-patches-additions'} & set(p.relative_to(ROOT).parts)]


def source_locks(rows):
    assert rows, '缺少源码锁，不能复用测试证据'
    for row in rows:
        path = (ROOT/row['path']).resolve()
        assert path.is_relative_to(ROOT.parent), row['path']
        assert sha(path.read_bytes()) == row['sha256'], row['path']


def behavior(group, reuse, digest):
    name = group+'/verify-report.json'
    if reuse:
        report = read(name)
        source_locks(report['evidence_source_locks'])
    else:
        report = importlib.import_module(group+'.verify').run(
            before=BASE, after=ROOT/'v35h.swf', mutations=True)
        write(name, report)
    assert report['status'] == 'pass', group
    assert report['before_swf_sha256'] == BASE_SHA, group
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reuse-verified', action='store_true')
    parser.add_argument('--reuse-behavior', action='store_true', help='只复用已完整通过的行为组，仍执行框架验收')
    args = parser.parse_args()
    started = time.monotonic()
    report = {'status': 'running', 'baseline_swf_sha256': BASE_SHA,
              'scope': 'TASK8 按角色全程超限、所有玛纳盘学习判据、窗口缺失格子防崩',
              'unverified': ['完整AIR虚拟机', 'Android真机', '实际UI画面', '服务端联动', '设备性能']}
    try:
        assert sha(BASE.read_bytes()) == BASE_SHA
        verify_readonly()
        sources = source_manifest()
        digest = sha((ROOT/'v35h.swf').read_bytes())
        groups = {}
        for group in GROUPS:
            print('核对真实字节码行为和变异：'+group, flush=True)
            groups[group] = behavior(group, args.reuse_verified or args.reuse_behavior, digest)
        print('核对整包保持、双锁及八轮串联重放', flush=True)
        frame = framework(args.reuse_verified, digest)
        readonly = verify_readonly()
        write('readonly-source-report.json', readonly)
        assert source_manifest() == sources, '验收期间源码改变'
        assert sha((ROOT/'v35h.swf').read_bytes()) == digest
        write('verification-source-locks.json', sources)
        old = sum(g['old_parity_count'] for g in groups.values())
        new = sum(g['new_check_count'] for g in groups.values())
        report.update(status='pass', output_swf_sha256=digest,
            old_parity_checks=old, new_checks=new, checks_total=old+new,
            mutation_total=sum(g['mutant_count'] for g in groups.values()), mutation_survivors=0,
            final_baseline='pass', behavior_reports=[g+'/verify-report.json' for g in GROUPS],
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
                            'condition': '同次任务已通过完整基线和变异，前后SWF与相关源码SHA全部一致'},
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
