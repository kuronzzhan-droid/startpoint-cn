"""最终SWF真实窗口方法回归、语义变异和恢复后全基线。"""
import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import bootstrap
from swfabc import SwfAbc
from window.cases import behavioral_suite, suite
from window.mutations import candidates
from window.patches import TARGET, LOCKS, build
from window.runtime import body


def source_locks():
    paths = set(HERE.glob('*.py'))
    for module in list(sys.modules.values()):
        source = getattr(module, '__file__', None)
        if source:
            path = Path(source).resolve()
            if path.suffix == '.py' and path.is_relative_to(bootstrap.ROOT.parent):
                paths.add(path)
    return [{'path': os.path.relpath(path, bootstrap.ROOT).replace('\\', '/'),
             'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(paths)]


def lock_negatives(before):
    """SHA和header分别破坏；必须先于任何补丁写入拒绝。"""
    from framework import Editor
    results = []
    for kind in ('sha', 'header'):
        e = Editor(bootstrap.BASE, locks=LOCKS)
        target = e.body(TARGET)
        if kind == 'sha':
            target[5] = bytes([2]) + target[5]
        else:
            target[1] += 1
        before_raw = bytes(target[5])
        before_header = target[1:5].copy()
        try:
            build(e)
        except Exception as exc:
            assert 'unknown v35g sha/header' in str(exc)
            assert target[5] == before_raw and target[1:5] == before_header
            results.append({'kind': kind, 'status': 'rejected', 'message': str(exc)})
        else:
            raise AssertionError('损坏输入锁未拒绝: ' + kind)
    return results


def run(before=bootstrap.BASE, after=bootstrap.ROOT / 'v35h.swf', mutations=True):
    hashes = {name + '_swf_sha256': hashlib.sha256(Path(value).read_bytes()).hexdigest()
              for name, value in [('before', before), ('after', after)] if isinstance(value, (str, Path))}
    if 'before_swf_sha256' in hashes:
        assert hashes['before_swf_sha256'] == bootstrap.BASE_SHA
    before = SwfAbc(before).abc if isinstance(before, (str, Path)) else before
    after = SwfAbc(after).abc if isinstance(after, (str, Path)) else after
    start = time.monotonic()
    # 先导入lock负例的framework，再冻结相关源码清单。
    negatives = lock_negatives(before)
    sources = source_locks()
    result = suite(before, after)
    killed, survived = [], []
    if mutations:
        for name, raw, static in candidates(before, after):
            target = body(after, TARGET)
            saved = target[5]
            target[5] = raw
            try:
                behavioral_suite(before, after)
            except AssertionError as exc:
                killed.append({'mutation': name, 'status': 'killed', 'static_check': static,
                               'failure': 'AssertionError: ' + str(exc)[:700]})
            except KeyError as exc:
                # 仅接受真实缺失缩略图调用；未知夹具/指令缺口不能伪称检出。
                assert 'null has no property showNumber' in str(exc)
                killed.append({'mutation': name, 'status': 'killed', 'static_check': static,
                               'failure': 'null-receiver: ' + str(exc)})
            else:
                survived.append(name)
            finally:
                target[5] = saved
        assert suite(before, after) == result, '变异恢复后完整基线未一致'
    assert source_locks() == sources, '执行期间相关源变化，拒绝PASS证据'
    result.update(status='pass' if not survived else 'fail', **hashes,
                  mutant_count=len(killed) + len(survived), mutants=killed, survived=survived,
                  final_baseline='pass', all_mutants_killed=not survived,
                  input_lock_negative_cases=negatives, evidence_source_locks=sources,
                  evidence_sources_unchanged_during_verification=True,
                  method_locks={TARGET: {'before': hashlib.sha256(body(before, TARGET)[5]).hexdigest(),
                                        'after': hashlib.sha256(body(after, TARGET)[5]).hexdigest(),
                                        'before_header': body(before, TARGET)[1:5],
                                        'after_header': body(after, TARGET)[1:5]}},
                  elapsed_seconds=round(time.monotonic() - start, 3),
                  mutation_encoding='真实方法字节替换；静态与编码往返有效；仅行为输出或null调用判红',
                  boundary='真实窗口apply/setup与ButtonGroupLogic/get；UI资源、对象构造器和容器为夹具；AIR/真机未核实')
    bootstrap.output_path(HERE / 'verify-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert not survived, survived
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, default=bootstrap.BASE)
    parser.add_argument('--after', type=Path, default=bootstrap.ROOT / 'v35h.swf')
    args = parser.parse_args()
    report = run(args.before, args.after)
    print(json.dumps({key: report[key] for key in ('status', 'old_parity_count', 'new_check_count',
                     'mutant_count', 'survived', 'final_baseline', 'elapsed_seconds')}, ensure_ascii=False))
