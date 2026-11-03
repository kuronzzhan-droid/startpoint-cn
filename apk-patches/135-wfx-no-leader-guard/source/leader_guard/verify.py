"""真实最终SWF行为、静态有效变异、恢复后完整基线与验证源码锁。"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import bootstrap
from swfabc import SwfAbc
from leader_guard.cases import suite, body
from leader_guard.mutations import candidates, smoke_reference, smoke
from leader_guard.patches import TARGETS
from leader_guard.runtime import VM


def source_locks():
    """锁当前任务实际导入的所有项目Python模块及本组源码。"""
    paths = set(HERE.glob('*.py'))
    for module in list(sys.modules.values()):
        source = getattr(module, '__file__', None)
        if source:
            path = Path(source).resolve()
            if path.suffix == '.py' and path.is_relative_to(bootstrap.ROOT.parent):
                paths.add(path)
    import os
    return [{'path': os.path.relpath(path, bootstrap.ROOT).replace('\\', '/'),
             'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted(paths)]


def run(before=bootstrap.BASE, after=bootstrap.ROOT / 'v35g.swf', mutations=True):
    hashes = {name + '_swf_sha256': hashlib.sha256(Path(value).read_bytes()).hexdigest()
              for name, value in [('before', before), ('after', after)] if isinstance(value, (str, Path))}
    if 'before_swf_sha256' in hashes:
        assert hashes['before_swf_sha256'] == bootstrap.BASE_SHA
    before = SwfAbc(before).abc if isinstance(before, (str, Path)) else before
    after = SwfAbc(after).abc if isinstance(after, (str, Path)) else after
    initial_sources = source_locks()
    start = time.monotonic()
    result = suite(before, after)
    reference = smoke_reference(before)
    result['mutation_probe_baseline_checks'] = smoke(after, reference)
    killed, survived = [], []
    if mutations:
        for label, name, raw, static in candidates(before, after):
            target = body(after, label)
            saved = target[5]
            target[5] = raw
            try:
                smoke(after, reference)
            except (AssertionError, VM.AvmThrow) as exc:
                killed.append({'method': label, 'mutation': name, 'status': 'killed',
                               'static_check': static,
                               'failure': type(exc).__name__ + ': ' + str(exc)[:900]})
            else:
                survived.append({'method': label, 'mutation': name})
            finally:
                target[5] = saved
        # 不是只重跑smoke：恢复后重新跑全部Some/None/入口/字节保持基线。
        final = suite(before, after)
        assert all(final[key] == result[key] for key in
                   ('old_parity_checks', 'new_checks', 'examples', 'incident_reproduction'))
        assert smoke(after, reference) == result['mutation_probe_baseline_checks']
    final_sources = source_locks()
    assert final_sources == initial_sources, '验证运行期间源码发生变化；拒绝生成通过证据'
    result.update(status='pass' if not survived else 'fail', **hashes,
                  method_locks={label: {'before': hashlib.sha256(body(before, label)[5]).hexdigest(),
                                        'after': hashlib.sha256(body(after, label)[5]).hexdigest(),
                                        'before_header': body(before, label)[1:5],
                                        'after_header': body(after, label)[1:5]} for label in TARGETS},
                  mutant_count=len(killed) + len(survived), mutants=killed, survived=survived,
                  all_mutants_killed=not survived, final_baseline='pass',
                  evidence_source_locks=final_sources, evidence_sources_unchanged_during_verification=True,
                  elapsed_seconds=round(time.monotonic() - start, 3),
                  mutation_encoding='真实方法字节替换；每项编码往返并通过静态检查；仅行为断言/真实AVM2 throw检出',
                  boundary='执行真实AVM2字节码及原生队长getter；BCL构造器/主表/集合/资源边界为受控夹具；AIR/真机/联机未核实')
    bootstrap.output_path(HERE / 'verify-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert not survived, survived
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, default=bootstrap.BASE)
    parser.add_argument('--after', type=Path, default=bootstrap.ROOT / 'v35g.swf')
    parser.add_argument('--no-mutations', action='store_true')
    args = parser.parse_args()
    result = run(args.before, args.after, not args.no_mutations)
    print(json.dumps({key: result[key] for key in ['status', 'old_parity_count', 'new_check_count',
                     'mutant_count', 'survived', 'final_baseline', 'elapsed_seconds']}, ensure_ascii=False))
