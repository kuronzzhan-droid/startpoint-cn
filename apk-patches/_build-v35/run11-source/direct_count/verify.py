"""对最终SWF执行本组完整基线及静态有效语义变异；仅写direct_count。"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.path.insert(0, str(HERE.parent))
import bootstrap
from swfabc import SwfAbc
from direct_count.cases import behavior
from direct_count.regression import regression
from direct_count.mutations import candidates


def source_snapshot():
    """预导入全部验收模块后锁定本组及实际导入的历史只读工具。"""
    paths = set(HERE.glob('*.py'))
    for module in tuple(sys.modules.values()):
        value = getattr(module, '__file__', None)
        if value:
            path = Path(value).resolve()
            if path.suffix == '.py' and path.is_relative_to(bootstrap.ROOT.parent):
                assert '-aborted' not in str(path)
                paths.add(path)
    return [{'path': os.path.relpath(p, bootstrap.ROOT).replace('\\', '/'),
             'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(paths)]


def verify(before_path=bootstrap.BASE, after_path=HERE / 'candidate.swf', mutations=True):
    assert hashlib.sha256(Path(before_path).read_bytes()).hexdigest() == bootstrap.BASE_SHA
    sources = source_snapshot()
    before, after = SwfAbc(before_path).abc, SwfAbc(after_path).abc
    old, new = regression(before, after), behavior(after)
    mutants, survived = [], []
    if mutations:
        for name, label, code, at, static in candidates(before, after):
            try:
                behavior(after, {label: code})
                regression(before, after, {label: code})
            except Exception as exc:
                mutants.append({'name': name, 'method': label, 'instruction': at, 'static_check': static,
                                'status': 'killed', 'failure': type(exc).__name__ + ': ' + str(exc)[:1000]})
            else:
                survived.append(name)
                mutants.append({'name': name, 'method': label, 'instruction': at,
                                'static_check': static, 'status': 'survived'})
    final_old, final_new = regression(before, after), behavior(after)
    assert old == final_old and new == final_new
    assert sources == source_snapshot(), 'direct_count验收期间参与源码改变'
    report = {'status': 'pass' if not survived else 'fail', 'before_sha256': bootstrap.BASE_SHA,
              'after_sha256': hashlib.sha256(Path(after_path).read_bytes()).hexdigest(),
              'before_swf_sha256': bootstrap.BASE_SHA,
              'after_swf_sha256': hashlib.sha256(Path(after_path).read_bytes()).hexdigest(),
              'evidence_source_locks': sources,
              'old_parity_count': len(old), 'old_parity_checks': old,
              'new_check_count': len(new), 'new_checks': new,
              'mutant_count': len(mutants), 'mutants': mutants, 'survived': survived,
              'final_baseline': 'pass', 'final_old_parity_count': len(final_old),
              'final_new_check_count': len(final_new),
              'execution': '真实schedule/getAdditionalDirectAttack/getBetter/ConditionSlot/wfx查询/弱体查询字节码',
              'boundary': '外围对象、能力合计器输入、调度和渲染出口为受控夹具；完整AIR、真机、视觉未核实'}
    (HERE / 'verify-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    assert not survived, survived
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, default=bootstrap.BASE)
    parser.add_argument('--after', type=Path, default=HERE / 'candidate.swf')
    parser.add_argument('--no-mutations', action='store_true')
    args = parser.parse_args()
    result = verify(args.before, args.after, not args.no_mutations)
    print(json.dumps({k: result[k] for k in ('status', 'old_parity_count', 'new_check_count', 'mutant_count', 'survived', 'final_baseline')}))
