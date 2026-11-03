"""读取真实SWF/ABC，行为对照、20项语义变异及恢复后的全基线。"""
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
from leader_unlock.cases import suite
from leader_unlock.mutations import body, candidates, smoke_reference, smoke
from leader_unlock.patches import TARGETS


def run(before=bootstrap.BASE, after=bootstrap.ROOT / 'v35f.swf', mutations=True):
    hashes = {name + '_swf_sha256': hashlib.sha256(Path(value).read_bytes()).hexdigest()
              for name, value in [('before', before), ('after', after)] if isinstance(value, (str, Path))}
    if 'before_swf_sha256' in hashes:
        assert hashes['before_swf_sha256'] == bootstrap.BASE_SHA
    before = SwfAbc(before).abc if isinstance(before, (str, Path)) else before
    after = SwfAbc(after).abc if isinstance(after, (str, Path)) else after
    start = time.monotonic()
    result = suite(before, after)
    reference = smoke_reference(before)
    result['mutation_probe_baseline_checks'] = smoke(after, reference)
    killed, survived = [], []
    if mutations:
        for label, name, raw in candidates(before, after):
            target = body(after, label)
            saved = target[5]
            target[5] = raw
            try:
                smoke(after, reference)
            except Exception as exc:
                killed.append({'method': label, 'mutation': name, 'status': 'killed',
                               'failure': type(exc).__name__ + ': ' + str(exc)[:900]})
            else:
                survived.append({'method': label, 'mutation': name})
            finally:
                target[5] = saved
        final = suite(before, after)
        assert all(
            final[key] == result[key] for key in ('old_parity_checks', 'new_checks', 'examples'))
    result.update(status='pass' if not survived else 'fail', **hashes,
                  method_locks={label: {'before': hashlib.sha256(body(before, label)[5]).hexdigest(),
                                        'after': hashlib.sha256(body(after, label)[5]).hexdigest(),
                                        'before_header': body(before, label)[1:5],
                                        'after_header': body(after, label)[1:5]} for label in TARGETS},
                  mutant_count=len(killed) + len(survived), mutants=killed, survived=survived,
                  all_mutants_killed=not survived, final_baseline='pass',
                  elapsed_seconds=round(time.monotonic() - start, 3),
                  mutation_encoding='真实方法字节替换；候选编码/解码往返并通过静态校验；行为断言检出',
                  boundary='执行真实AVM2字节码；主表/集合/边界对象为受控夹具；AIR/真机/联机未核实')
    bootstrap.output_path(HERE / 'verify-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert not survived, survived
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, default=bootstrap.BASE)
    parser.add_argument('--after', type=Path, default=bootstrap.ROOT / 'v35f.swf')
    parser.add_argument('--no-mutations', action='store_true')
    args = parser.parse_args()
    result = run(args.before, args.after, not args.no_mutations)
    print(json.dumps({key: result[key] for key in ['status', 'old_parity_count', 'new_check_count',
                     'mutant_count', 'survived', 'final_baseline']}, ensure_ascii=False))
