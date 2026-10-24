"""最终 SWF 真实完整方法对照、定点变异、恢复重验；只写 equipment 报告。"""
import argparse, copy, json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap, asm, bodies
from framework import sha
from static_check import check_body
from swfabc import SwfAbc
from equipment.checks import suite
from equipment.patches import TARGETS, HELPERS


def body(abc, label):
    return abc.bodies[bodies.resolve(abc, label)]


def mutations(before, after):
    for label in TARGETS:
        yield label, '恢复v35b原方法', body(before, label)[5]
    for label in HELPERS:
        code = [('pushnull',), ('returnvalue',)] if label.endswith('Config') else [('getlocal_3',), ('returnvalue',)]
        yield label, '停用新增助手', asm.encode(asm.assemble(code))[0]
    opposites = {'iffalse':'iftrue','iftrue':'iffalse','ifne':'ifeq','ifeq':'ifne',
                 'iflt':'ifge','ifgt':'ifle','ifle':'ifgt','ifge':'iflt'}
    for label in TARGETS + HELPERS:
        original = asm.decode(body(after, label)[5])
        for i, ins in enumerate(original):
            if ins.name in opposites:
                changed = copy.deepcopy(original)
                changed[i].op = asm.MNEMONICS[opposites[ins.name]]
                yield label, f'翻转分支 {i} {ins.name}', asm.encode(changed)[0]
            elif ins.name == 'greaterthan':
                changed = copy.deepcopy(original)
                changed[i].op = asm.MNEMONICS['lessthan']
                yield label, f'反转成员判定 {i}', asm.encode(changed)[0]


def verify(before=bootstrap.BASE, after=None, run_mutations=True):
    if after is None:
        after = Path(__file__).with_name('candidate.swf')
    assert sha(bootstrap.BASE.read_bytes()) == bootstrap.BASE_SHA, '固定输入SHA不匹配'
    input_path, output_path = None, None
    if isinstance(before, (str,Path)):
        input_path = Path(before)
        assert sha(input_path.read_bytes()) == bootstrap.BASE_SHA, '未知输入SWF'
        before = SwfAbc(input_path).abc
    if isinstance(after, (str,Path)):
        output_path = Path(after)
        after = SwfAbc(output_path).abc
    locks = json.loads((bootstrap.ROOT/'baseline-locks.json').read_text(encoding='utf8'))
    for label in TARGETS:
        old = body(before,label)
        assert sha(old[5]) == locks[label]['sha'] and old[1:5] == locks[label]['header'], label
    started = time.time()
    report = suite(before, after)
    checks = {label:check_body(after,body(after,label)) for label in TARGETS+HELPERS}
    killed, survivors = [], []
    if run_mutations:
        for label, reason, raw in mutations(before,after):
            actual = body(after,label)
            saved = actual[5]
            actual[5] = raw
            try:
                suite(before,after)
                survivors.append({'method':label,'mutation':reason})
            except Exception as exc:
                killed.append({'method':label,'mutation':reason,'detected':str(exc)[:300]})
            finally:
                actual[5] = saved
    baseline = suite(before,after)
    assert baseline['cases'] == report['cases'], '恢复后的基线不同'
    executed = [label for label in TARGETS+HELPERS if body(after,label)[0] in report['executed_method_ids']]
    assert len(executed) == len(TARGETS+HELPERS), executed
    report.update(changed_methods=TARGETS,added_methods=HELPERS,executed_labels=executed,
        mutations=len(killed)+len(survivors),mutants=len(killed)+len(survivors),
        mutation_killed=killed,mutation_survivors=survivors,survivors=survivors,
        all_mutants_killed=not survivors,final_baseline='PASS',static_checks=checks,
        input_sha256=bootstrap.BASE_SHA,
        output_sha256=sha(output_path.read_bytes()) if output_path else None,
        swf_sha256=sha(output_path.read_bytes()) if output_path else None,
        elapsed_seconds=round(time.time()-started,3))
    Path(__file__).with_name('verify-report.json').write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    assert not survivors, survivors
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('final',nargs='?')
    parser.add_argument('--before',default=str(bootstrap.BASE))
    parser.add_argument('--after',default=str(Path(__file__).with_name('candidate.swf')))
    parser.add_argument('--no-mutations',action='store_true')
    args = parser.parse_args()
    result = verify(args.before,args.final or args.after,not args.no_mutations)
    print(json.dumps({k:result[k] for k in ('status','checks','mutations','all_mutants_killed','final_baseline','elapsed_seconds')},ensure_ascii=False))
