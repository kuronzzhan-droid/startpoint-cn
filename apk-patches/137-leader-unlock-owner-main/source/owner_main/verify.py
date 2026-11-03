"""最终SWF真实字节码基线、静态有效语义变异，以及恢复后全基线。"""
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
from owner_main.cases import suite
from owner_main.mutations import body, candidates, probe
from owner_main.patches import TARGETS


def source_locks():
    paths = set(HERE.glob('*.py'))
    paths.update(bootstrap.ROOT / name for name in ('bootstrap.py', 'framework.py', 'static_check.py'))
    for module in list(sys.modules.values()):
        file = getattr(module, '__file__', None)
        if file:
            path = Path(file).resolve()
            if path.suffix == '.py' and path.is_relative_to(bootstrap.ROOT.parent):
                paths.add(path)
    return [{'path': os.path.relpath(path, bootstrap.ROOT).replace('\\', '/'),
             'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(paths)]


def run(before=bootstrap.BASE, after=bootstrap.ROOT / 'v35i.swf', mutations=True):
    start = time.monotonic()
    hashes = {name + '_swf_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest()
              for name, path in (('before', before), ('after', after))}
    assert hashes['before_swf_sha256'] == bootstrap.BASE_SHA
    old, new = SwfAbc(before).abc, SwfAbc(after).abc
    # Import all test modules before locking; no dynamic imports can escape the evidence set.
    from owner_main import cases_edges, cases_element, cases_integration, cases_party, cases_lifecycle
    sources = source_locks()
    # Candidate generation failures must stop verification before any behavior claim.
    mutants = list(candidates(old, new)) if mutations else []
    result = suite(old, new)
    print('owner_main 全基线通过，开始语义变异', flush=True)
    expected = probe(new)
    killed, survived = [], []
    if mutations:
        for label, name, raw, static in mutants:
            target, saved = body(new, label), bytes(body(new, label)[5])
            target[5] = raw
            try:
                actual = probe(new)
                assert actual == expected, '真实AVM2业务结果偏离已验收基线'
            except Exception as exc:
                killed.append({'method': label, 'mutation': name, 'status': 'killed',
                               'static_check': static,
                               'failure': type(exc).__name__ + ': ' + str(exc)[:1400]})
            else:
                survived.append({'method': label, 'mutation': name})
            finally:
                target[5] = saved
            print('mutation', len(killed) + len(survived), name,
                  'killed' if not survived or survived[-1]['mutation'] != name else 'SURVIVED', flush=True)
        final = suite(old, new)
        assert all(final[key] == result[key] for key in ('old_parity_checks', 'new_checks', 'examples'))
        assert probe(new) == expected
    assert source_locks() == sources, '验证期间源码变化，证据失效'
    result.update(status='pass' if not survived else 'fail', **hashes, mutants=killed,
                  mutant_count=len(killed) + len(survived), survived=survived,
                  all_mutants_killed=not survived, final_baseline='pass',
                  evidence_source_locks=sources, evidence_sources_unchanged_during_verification=True,
                  mutation_probe_baseline_checks=len(expected),
                  method_locks={label: {'sha256': hashlib.sha256(body(new, label)[5]).hexdigest(),
                                        'header': body(new, label)[1:5]} for label in TARGETS},
                  elapsed_seconds=round(time.monotonic() - start, 3),
                  boundary='真实AVM2完整入口与原生队伍getter；主表、角色资源构造和描述排版为受控夹具。AIR/真机未核实')
    bootstrap.output_path(HERE / 'verify-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert not survived, survived
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, default=bootstrap.BASE)
    parser.add_argument('--after', type=Path, default=bootstrap.ROOT / 'v35i.swf')
    parser.add_argument('--no-mutations', action='store_true')
    args = parser.parse_args()
    result = run(args.before, args.after, not args.no_mutations)
    print(json.dumps({k: result[k] for k in ('status', 'old_parity_count', 'new_check_count',
          'mutant_count', 'survived', 'final_baseline', 'elapsed_seconds')}, ensure_ascii=False))
