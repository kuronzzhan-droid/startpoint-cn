"""第十六轮总验收：最终双输入、真实字节码夹具和语义变异。"""
import argparse
import json
import subprocess
import sys
import time
import bootstrap
from bootstrap import ROOT, INPUTS, sha
from build import json_write

TEST_PROGRAM = '''
import json,sys,types
import bootstrap
from pathlib import Path
from swfabc import SwfAbc
from framework import Editor
from build import json_write
kind,path,out=sys.argv[1:]
s=SwfAbc(path)
if kind=='fields':
 from fp_fields_test import run
 r=run(s)
elif kind=='core':
 from test_fp_core import run
 r=run(s)
elif kind=='inputs':
 from test_fp_inputs import run_tests
 r=run_tests(s.abc)
elif kind=='transport':
 from test_fp_transport import verify_swf
 r=verify_swf(path)
elif kind=='integration':
 from test_fp_integration import verify_swf
 r=verify_swf(path)
else:
 from test_fp_transport_mutations import run_mutations
 r={'status':'pass','mutations':run_mutations(Editor(s,{})),'restored_baseline_pass':True}
r['source_swf_sha256']=bootstrap.sha(Path(path).read_bytes())
json_write(Path(out),r)
print(json.dumps({'kind':kind,'status':r['status']}))
'''


def readonly_audit(directory):
    import asm
    import bodies
    from swfabc import SwfAbc
    from fp_fields_base import BATTLE
    forbidden = {'randomUInt', 'randomFloat', 'randomRange', 'randomRangeInt', 'randomRangeFloat',
                 'choose', 'randomPick', 'getRandomCorrectionValue', 'getRandomAddendValue',
                 'getGauge', 'getTrialGaugeRemaining', 'getDisguisableRelativeCurrentHealthPoint',
                 'getTotalDisguiseHp', 'nextFunnelAddress', 'getStatModifierForParameterCheck'}
    write_forbidden = {'randomNum', 'healthPoint', 'currentFrame', 'rawFrame', 'rawTime',
                       'funnelSpawnCount', 'synchronizeCount', 'stateFrame'}
    swf = SwfAbc(directory / 'v35p.swf')
    checked, calls = [], set()
    for index, label in bodies.label_map(swf.abc).items():
        if not label.startswith('Battle$/wfxFp'):
            continue
        checked.append(label)
        for instruction in asm.decode(swf.abc.bodies[index][5]):
            if instruction.name in ('callproperty', 'callpropvoid', 'callproplex'):
                name = swf.abc.mn_name(instruction.args[0]).split('::')[-1]
                calls.add(name)
                assert name not in forbidden and not name.startswith('randomRange'), (label, name)
                assert not name.startswith('getStatModifier'), (label, name)
            if instruction.name in ('setproperty', 'initproperty'):
                name = swf.abc.mn_name(instruction.args[0]).split('::')[-1]
                assert name not in write_forbidden, (label, name)
    result = dict(status='pass', helper_count=len(checked), called_names=sorted(calls),
        forbidden_sampling_calls_absent=True, direct_game_state_writes_absent=True,
        limitation='name-based static check supplements source slot audit and fixed-input execution; not a full formal alias proof')
    json_write(directory / 'readonly-audit.json', result)
    return result


def run(candidate=False):
    directory = ROOT / 'work' if candidate else ROOT
    report_path = directory / 'verify-report.json'
    report = dict(status='running', scope='offline only', profiles={}, exclusions=[
        '完整AIR/Android运行', '真实三机联机', '服务端实现与部署', 'APK签名安装', '真机耗时/GC/内存'])
    report['source_evidence'] = bootstrap.source_evidence()
    json_write(report_path, report)
    started = time.perf_counter()
    try:
        from verify_structural import run as structural
        report['structure'] = structural(candidate)['status']
        from verify_protocol import run as protocol
        report['protocol_mutations'] = protocol()['status']
        report['readonly'] = readonly_audit(directory)['status']
        for profile, (_, _, name) in INPUTS.items():
            report['profiles'][profile] = {'sha256': sha((directory / name).read_bytes()), 'tests': {}}
            for kind in ('fields', 'core', 'inputs', 'transport', 'transport_mutations', 'integration'):
                output = directory / (kind + '-' + profile + '.json')
                completed = subprocess.run([sys.executable, '-B', '-c', TEST_PROGRAM, kind,
                    str(directory / name), str(output)], cwd=ROOT, capture_output=True, text=True,
                    encoding='utf-8', errors='replace')
                if completed.returncode:
                    raise RuntimeError(kind + '/' + profile + '\n' + completed.stdout + completed.stderr)
                print(completed.stdout.strip(), flush=True)
                value = json.loads(output.read_text(encoding='utf-8'))
                assert value['status'] == 'pass'
                report['profiles'][profile]['tests'][kind] = 'pass'
        report['elapsed_seconds'] = round(time.perf_counter() - started, 2)
        assert report['source_evidence'] == bootstrap.source_evidence(), 'source changed during verification'
        report['status'] = 'pass'
    except Exception as exc:
        report['status'], report['error'] = 'fail', str(exc)
        json_write(report_path, report)
        raise
    json_write(report_path, report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', action='store_true')
    run(parser.parse_args().candidate)
