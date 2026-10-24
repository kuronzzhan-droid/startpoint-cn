"""仅写run4：读取给定最终SWF，执行行为、原生计数链及语义变异复审。"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import bootstrap
from swfabc import SwfAbc
from direct_unique.checks import behavior
from direct_unique.regression import regression
from direct_unique.mutations import candidates


def verify(before_path=bootstrap.BASE, after_path=bootstrap.ROOT / 'v35d.swf', mutations=True):
    assert hashlib.sha256(Path(before_path).read_bytes()).hexdigest() == bootstrap.BASE_SHA
    before, after = SwfAbc(before_path).abc, SwfAbc(after_path).abc
    old, new = regression(before, after), behavior(after)
    reports, survived = [], []
    if mutations:
        for name, label, code, at in candidates(before, after):
            try:
                behavior(after, {label: code})
                regression(before, after, {label: code})
            except Exception as exc:
                reports.append({'name': name, 'method': label, 'instruction': at, 'status': 'killed',
                                'failure': type(exc).__name__ + ': ' + str(exc)[:700]})
            else:
                survived.append(name)
                reports.append({'name': name, 'method': label, 'instruction': at, 'status': 'survived'})
    # 变异只覆盖解释执行用指令副本；恢复无override，重新完成全部新旧检查。
    final_old, final_new = regression(before, after), behavior(after)
    assert final_old == old and final_new == new
    result = {
        'status': 'pass' if not survived else 'fail',
        'before_sha256': bootstrap.BASE_SHA,
        'after_sha256': hashlib.sha256(Path(after_path).read_bytes()).hexdigest(),
        'old_parity_count': len(old), 'old_parity_checks': old,
        'new_check_count': len(new), 'new_checks': new,
        'mutant_count': len(reports), 'mutants': reports, 'survived': survived,
        'mutation_encoding': '每个候选先asm.encode为真实字节，再asm.decode；二次编码必须逐字节一致后才执行',
        'final_baseline': 'pass', 'final_old_parity_count': len(final_old), 'final_new_check_count': len(final_new),
        'execution': '完整scheduleDirectAttack、wfxDirectFactor、wfxDirectTargetUnique、wfxSpec/wfxRows查询链及原生Unique计数/匹配链',
        'native_target_count': '原生取可见本槽及可见squadSlot内匹配且可叠加状态的最大magnification；来源间取max；不累加重复UID，不读invisibleSlot，不可叠加为0',
        'boundary': '离线AVM2解释执行；表、对象、枚举构造、调度器等边界用受控夹具；完整AIR/Android设备未核实',
    }
    path = bootstrap.output_path(HERE / 'verify-report.json')
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert not survived, survived
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, default=bootstrap.BASE)
    parser.add_argument('--after', type=Path, default=bootstrap.ROOT / 'v35d.swf')
    parser.add_argument('--no-mutations', action='store_true')
    args = parser.parse_args()
    report = verify(args.before, args.after, not args.no_mutations)
    print(json.dumps({key: report[key] for key in ('status', 'old_parity_count', 'new_check_count',
                                                  'mutant_count', 'survived', 'final_baseline')}, ensure_ascii=False))
