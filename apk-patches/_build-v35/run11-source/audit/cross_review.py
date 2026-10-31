"""本轮最终 SWF 独立交叉验证；所有输出固定写入 audit。"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN = HERE.parent
ROOT = RUN.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(RUN))
import bootstrap
from swfabc import SwfAbc
import bodies
from cross_cases import (direct_cases, heal_cases, fever_member_boundary_cases,
                         legacy_source_cases, damage_stats_cases)
from network_cases import native_network_cases


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sources():
    files = {Path(__file__).resolve(), HERE / 'native-evidence.json'}
    files.update((HERE / 'native-pcode').glob('*.pcode.txt'))
    for module in list(sys.modules.values()):
        name = getattr(module, '__file__', None)
        if name:
            p = Path(name).resolve()
            if p.is_relative_to(ROOT) and p.suffix == '.py':
                files.add(p)
    return [{'path': os.path.relpath(p, RUN).replace('\\', '/'), 'sha256': digest(p)}
            for p in sorted(files)]


def run(after):
    source_locks = sources()
    checks = []
    def eq(name, actual, expected):
        if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
            good = abs(actual - expected) < 1e-8
        else:
            good = actual == expected
        assert good, (name, actual, expected)
        checks.append({'name': name, 'actual': actual, 'expected': expected})
    evidence = json.loads((HERE / 'native-evidence.json').read_text('utf-8'))
    eq('input.sha256', digest(ROOT / 'run10/v35j.swf'), evidence['sha256'])
    abc = SwfAbc(after).abc
    changed = {'MemberImpl/scheduleDirectAttack', 'MemberImpl/wfxHealSample'}
    for row in evidence['methods']:
        if row['label'] in changed:
            continue
        b = abc.bodies[bodies.resolve(abc, row['label'])]
        eq('native.sha.' + row['label'], hashlib.sha256(b[5]).hexdigest(), row['sha256'])
        eq('native.header.' + row['label'], b[1:5], row['header'])
    direct_cases(abc, eq)
    heal_cases(abc, eq)
    fever_member_boundary_cases(abc, eq)
    legacy_source_cases(abc, SwfAbc(ROOT / 'run10/v35j.swf').abc, eq)
    native_network_cases(abc, eq)
    damage_stats_cases(abc, eq)
    eq('evidence.source_locks_unchanged_during_execution', sources() == source_locks, True)
    return {'status': 'pass', 'swf_sha256': digest(after), 'count': len(checks),
            'checks': checks, 'evidence_source_locks': source_locks,
            'scope': '独立断言执行候选真实AVM2；复用受控外围夹具，无完整AIR/设备/网络证明',
            'rulings': {'network': 'B', 'fever': 'A', 'pending_clarification': []},
            'network': '真实原生接收/计算/回复链保留来源ID；本端跨ID实际回复计入34/35，镜像/仅转发/回执不重复计入；未联网',
            'fever_call_boundary': '裁定A：每受治疗成员的一次实际applyHeal，对每持有者合并多状态后一次API；无批次标记'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--after', type=Path, default=RUN / 'v35k.swf')
    args = parser.parse_args()
    report = run(args.after)
    (HERE / 'cross-review-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)
                                                   + '\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ['status', 'swf_sha256', 'count']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
