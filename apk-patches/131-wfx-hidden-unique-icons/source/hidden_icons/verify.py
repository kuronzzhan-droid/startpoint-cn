"""仅读锁定v35d/最终v35e；行为报告与所有写入均限定run5。"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import bootstrap
from swfabc import SwfAbc
from hidden_icons.cases import behavior, regression
from hidden_icons.queries import behavior as query_behavior, fever_regression
from hidden_icons.mutations import candidates


def verify(before_path=bootstrap.BASE, after_path=bootstrap.ROOT / 'v35e.swf', mutations=True):
    before_sha = hashlib.sha256(Path(before_path).read_bytes()).hexdigest()
    assert before_sha == bootstrap.BASE_SHA
    after_sha = hashlib.sha256(Path(after_path).read_bytes()).hexdigest()
    before, after = SwfAbc(before_path).abc, SwfAbc(after_path).abc

    def checks(changes=None):
        new = behavior(after, changes) + query_behavior(before, after, changes)
        old = regression(before, after, changes) + fever_regression(before, after, changes)
        return old, new

    old, new = checks()
    reports, survived = [], []
    if mutations:
        for name, label, code, at in candidates(before, after):
            try:
                checks({label: code})
            except Exception as exc:
                reports.append({'name': name, 'method': label, 'instruction': at,
                                'status': 'killed',
                                'failure': type(exc).__name__ + ': ' + str(exc)[:700]})
            else:
                survived.append(name)
                reports.append({'name': name, 'method': label, 'instruction': at, 'status': 'survived'})
    final_old, final_new = checks()
    assert final_old == old and final_new == new
    result = {
        'status': 'pass' if not survived else 'fail',
        'before_sha256': before_sha, 'after_sha256': after_sha,
        'old_parity_count': len(old), 'old_parity_checks': old,
        'new_check_count': len(new), 'new_checks': new,
        'mutant_count': len(reports), 'mutants': reports, 'survived': survived,
        'mutation_encoding': '每个候选先asm.encode为真实字节再decode，二次编码相等后执行；未靠hash变化判定检出',
        'final_baseline': 'pass', 'final_old_parity_count': len(final_old),
        'final_new_check_count': len(final_new),
        'execution': '完整MemberImpl显示列表和总数、ConditionSlot原生列表/队伍汇总/排序/计数、wfxSpec/wfxRows/层数、scheduleDirectAttack和FeverMarker/FeverSpec调用链',
        'label_evidence': 'wfxSpec实际读取分段下标只到0..4，36组标签变体与缓存结果一致；长度仍须至少6但不读取label内容',
        'state_evidence': '显示前后状态字段、层数、各来源槽顺序、状态对象身份不变；可见/不可见/队伍wfxRows及码24调度结果一致',
        'legacy_errors': 'null string_id与无表沿用v35d原异常类别、消息和外部调用顺序，不扩大容错',
        'boundary': '离线真实AVM2字节码解释执行，外围对象/主表/集合和字符串内建为受控夹具；完整AIR/Android设备未核实',
    }
    bootstrap.output_path(HERE / 'verify-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert not survived, survived
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--before', type=Path, default=bootstrap.BASE)
    parser.add_argument('--after', type=Path, default=bootstrap.ROOT / 'v35e.swf')
    parser.add_argument('--no-mutations', action='store_true')
    args = parser.parse_args()
    result = verify(args.before, args.after, not args.no_mutations)
    print(json.dumps({key: result[key] for key in ['status', 'old_parity_count', 'new_check_count',
                     'mutant_count', 'survived', 'final_baseline']}, ensure_ascii=False))
