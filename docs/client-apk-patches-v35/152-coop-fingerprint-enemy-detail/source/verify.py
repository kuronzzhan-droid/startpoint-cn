"""双产物分进程验收；报告绑定最终 SWF、执行方法和全部测试源码。"""
import argparse
import json
import subprocess
import sys
import bootstrap
from bootstrap import ROOT, INPUTS, sha
from build import json_write
from verify_structural import run as structural

PROGRAMS = {
    'fields': 'from test_compact_fields import run;result=run(loaded)',
    'inputs': 'from test_compact_inputs import run_tests;result=run_tests(loaded.abc)',
    'enemy_details': 'from test_enemy21 import run;result=run(loaded)',
    'sampling': 'from test_sampling21 import verify_swf;result=verify_swf(target)',
    'binding': 'from test_round20_binding import run;details,executed=run(loaded.abc)',
    'isolation': 'from test_round20_isolation import run;details,executed=run(loaded.abc)',
    'lifecycle': 'from test_round18_lifecycle import run;world,details=run(loaded.abc);executed=world.executed',
    'flow': 'from test_round20_flow import run;details,executed=run(loaded.abc,SwfAbc(baseline).abc)',
    'early_window': 'from test_window21 import run;details,executed=run(loaded.abc)',
    'pa': 'from test_pa21 import run;result=run(loaded.abc,SwfAbc(baseline).abc)',
}


def suite(name, target, baseline, output):
    code = ('import json,sys,bootstrap;from pathlib import Path;from swfabc import SwfAbc;'
        'target=Path(sys.argv[1]);baseline=Path(sys.argv[2]);'
        'before=bootstrap.sha(target.read_bytes());loaded=SwfAbc(target);' + PROGRAMS[name] + ';')
    if name not in ('fields', 'inputs', 'enemy_details', 'sampling', 'pa'):
        code += ('result=dict(status="pass",details=details,executed_method_ids=sorted(executed),'
            'executed_method_sha256={str(b[0]):bootstrap.sha(b[5]) for b in loaded.abc.bodies if b[0] in executed});')
    code += ('assert bootstrap.sha(target.read_bytes())==before;'
        'result.update(swf_sha256=before);'
        'bootstrap.output_path(Path(sys.argv[3])).write_text('
        'json.dumps(result,ensure_ascii=False,indent=2)+"\\n",encoding="utf-8")')
    child = subprocess.run([sys.executable, '-B', '-c', code, str(target), str(baseline), str(output)],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    if child.returncode:
        raise RuntimeError(name + '\n' + child.stdout + child.stderr)
    result = json.loads(output.read_text(encoding='utf-8'))
    assert result['status'] == 'pass'
    return result


def run(candidate=False):
    directory = ROOT / 'work' if candidate else ROOT
    source = bootstrap.source_evidence()
    structural(candidate)
    profiles = {}
    for profile, (baseline, _, name) in INPUTS.items():
        target = directory / name
        reports = {}
        for test in PROGRAMS:
            output = directory / (test + '-' + profile + '.json')
            print('verify ' + profile + ' ' + test, flush=True)
            result = suite(test, target, baseline, output)
            result['source_evidence'] = source
            json_write(output, result)
            reports[test] = dict(status='pass', report=output.name, sha256=sha(output.read_bytes()))
        profiles[profile] = dict(sha256=sha(target.read_bytes()), tests=reports)
    assert source == bootstrap.source_evidence(), '验收期间源码改变，按影响范围重新验证'
    protected = json.loads((ROOT/'protected-run20-before.json').read_text(encoding='utf-8'))
    current = {p.relative_to(bootstrap.BASE_DIR).as_posix():sha(p.read_bytes())
        for p in bootstrap.BASE_DIR.rglob('*') if p.is_file()}
    assert current == protected, '只读 run20 文件发生改变'
    report = dict(status='pass', profiles=profiles, source_evidence=source,
        protected_run20_files=len(protected), protected_run20_unchanged=True,
        framework_report_sha256=sha((directory/'framework-report.json').read_bytes()),
        analysis_evidence={p.relative_to(ROOT).as_posix():sha(p.read_bytes())
            for p in sorted((ROOT/'analysis').glob('*')) if p.is_file() and p.suffix in ('.json','.md','.txt')},
        scope='最终SWF真实方法字节码与明确外围模型；AIR/设备/服务器/真实网络未核实')
    json_write(directory/'verify-report.json', report)
    print(json.dumps(dict(status='pass', profiles=profiles), ensure_ascii=False), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', action='store_true')
    run(parser.parse_args().candidate)
