"""台座分组验收：正式SWF真实字节码、变异后恢复完整基线。"""
import hashlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap
import asm
from swfabc import SwfAbc
from static_check import check_body
from pedestals.cases import parity, scenarios
from pedestals.mutations import body, candidates
from pedestals.patches import TARGETS, HELPER, FULL, O8, DONORS


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pcode(abc, label):
    b = body(abc, label)
    lines = [f'# {label} header={b[1:5]} sha256={sha(b[5])}']
    for i, ins in enumerate(asm.decode(b[5])):
        args = list(ins.args)
        if args and ins.name in ('getproperty', 'findproperty', 'findpropstrict', 'callproperty',
                                 'callpropvoid', 'coerce', 'getlex', 'astype'):
            args[0] = abc.mn_name(args[0])
        if args and ins.name == 'pushstring':
            args[0] = abc.strings[args[0]].decode('utf-8')
        branch = '' if ins.target is None else ' -> #' + str(ins.target)
        lines.append(f'#{i:04d} {ins.name} {args!r}{branch}')
    return '\n'.join(lines) + '\n'


def run(before=bootstrap.BASE, after=bootstrap.ROOT / 'v35h.swf', mutations=True):
    before, after = Path(before), Path(after)
    old_raw, new_raw = before.read_bytes(), after.read_bytes()
    assert sha(old_raw) == bootstrap.BASE_SHA
    old, new = SwfAbc(before).abc, SwfAbc(after).abc
    preservation = {}
    for label in TARGETS:
        raw = asm.unsplice_many(body(new, label)[5], [(16, 5, asm.FORBID), (38, 6, asm.FORBID)])
        assert raw == body(old, label)[5]
        preservation[label] = {'original_bytes_recoverable': True, 'static': check_body(new, body(new, label))}
    for label in DONORS:
        assert body(new, label) == body(old, label), label
        preservation[label] = {'body_record_unchanged': True}
    old_count, new_count = parity(old, new), scenarios(new)
    results, survived = [], []
    if mutations:
        for label, name, raw, static in candidates(old, new):
            target = body(new, label)
            original = target[5]
            target[5] = raw
            error = None
            try:
                parity(old, new, comprehensive=False)
                scenarios(new, comprehensive=False)
            except (AssertionError, KeyError) as exc:
                error = str(exc)
            finally:
                target[5] = original
            if error is None:
                survived.append(label + ': ' + name)
            results.append({'label': label, 'mutation': name, 'static': static,
                            'detected': error is not None, 'semantic_failure': error,
                            'mutation_sha256': sha(raw)})
        assert not survived, ('变异存活', survived)
    final_old, final_new = parity(old, new), scenarios(new)
    assert (old_count, new_count) == (final_old, final_new)
    for label in TARGETS + [HELPER, FULL, O8]:
        out = bootstrap.output_path(bootstrap.ROOT / 'pedestals' / 'pcode' /
                                    (label.replace('/', '__') + '.pcode.txt'))
        out.write_text(pcode(new, label), encoding='utf-8')
    for label in DONORS:
        out = bootstrap.output_path(bootstrap.ROOT / 'pedestals' / 'pcode' /
                                    ('before__' + label.replace('/', '__') + '.pcode.txt'))
        out.write_text(pcode(old, label), encoding='utf-8')
    sources = sorted((bootstrap.ROOT / 'pedestals').glob('*.py'))
    sources += [bootstrap.ROOT / 'materials' / 'vm.py', bootstrap.ROOT / 'materials' / 'helper.py',
                bootstrap.ROOT / 'static_check.py', bootstrap.ROOT / 'vendor' / 'asm.py',
                bootstrap.ROOT / 'vendor' / 'avm_interp.py']
    report = {'status': 'pass', 'before_swf_sha256': sha(old_raw), 'after_swf_sha256': sha(new_raw),
              'old_parity_count': old_count, 'new_check_count': new_count,
              'mutant_count': len(results), 'survived': survived, 'mutations': results,
              'final_baseline': 'pass', 'final_old_parity_count': final_old,
              'final_new_check_count': final_new, 'preservation': preservation,
              'evidence_source_locks': [{'path': str(p.relative_to(bootstrap.ROOT)).replace('\\', '/'),
                                         'sha256': sha(p.read_bytes())} for p in sources],
              'runtime_boundary': '真实 AVM2 字节码离线解释；主表/资源/玩家对象为受控夹具；AIR/设备未核实'}
    bootstrap.output_path(bootstrap.ROOT / 'pedestals' / 'verify-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    result = run()
    print(json.dumps({k: v for k, v in result.items()
                      if k not in ('mutations', 'preservation', 'evidence_source_locks')}, ensure_ascii=False))
