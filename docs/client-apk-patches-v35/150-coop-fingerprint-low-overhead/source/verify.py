"""双产物实际字节码验收；不同测试外围在独立进程隔离。"""
import argparse
import json
import subprocess
import sys
import bootstrap
from bootstrap import ROOT, INPUTS, sha
from build import json_write
from verify_structural import run as structural


def suite(name, path, output):
    programs = {
        'fields': 'from test_compact_fields import run; result=run(SwfAbc(target))',
        'inputs': 'from test_compact_inputs import run_tests; result=run_tests(SwfAbc(target).abc)',
        'round18': 'from test_round18 import verify_swf; result=verify_swf(target)',
    }
    code = ('import json,sys,bootstrap;from pathlib import Path;from swfabc import SwfAbc;'
            'target=Path(sys.argv[1]);' + programs[name] + ';'
            'bootstrap.output_path(Path(sys.argv[2])).write_text('
            'json.dumps(result,ensure_ascii=False,indent=2)+"\\n",encoding="utf-8")')
    child = subprocess.run([sys.executable, '-B', '-c', code, str(path), str(output)],
                           cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    if child.returncode:
        raise RuntimeError(name + '\n' + child.stdout + child.stderr)
    report = json.loads(output.read_text(encoding='utf-8'))
    assert report['status'] == 'pass', name
    return report


def run(candidate=False):
    directory = ROOT / 'work' if candidate else ROOT
    source = bootstrap.source_evidence()
    structural(candidate)
    profiles = {}
    for profile, (_, _, name) in INPUTS.items():
        path = directory / name
        reports = {}
        for test in ('fields', 'inputs', 'round18'):
            output = directory / (test + '-' + profile + '.json')
            print('verify ' + profile + ' ' + test, flush=True)
            result = suite(test, path, output)
            result.update(swf_sha256=sha(path.read_bytes()), source_evidence=source)
            json_write(output, result)
            reports[test] = dict(status='pass', report=output.name, sha256=sha(output.read_bytes()))
        profiles[profile] = dict(sha256=sha(path.read_bytes()), tests=reports)
    assert source == bootstrap.source_evidence(), '验证过程中源码发生变化，请按变动范围重验'
    result = dict(status='pass', profiles=profiles, source_evidence=source,
        framework_report_sha256=sha((directory / 'framework-report.json').read_bytes()),
        scope='最终SWF字节码+明确外围模型；非AIR/设备/服务器/真实网络验收')
    json_write(directory / 'verify-report.json', result)
    print(json.dumps(dict(status='pass', profiles=profiles), ensure_ascii=False), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', action='store_true')
    run(parser.parse_args().candidate)
