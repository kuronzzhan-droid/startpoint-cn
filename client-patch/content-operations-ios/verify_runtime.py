"""Execute the prepared production methods in existing bounded AIR fixtures.

Invoke the complete command through the workspace's background desktop runner.
The SWF assembled here is only a method donor for fixtures, never a game build.
Untouched fixture dependencies remain the fixed R11 reference implementation;
this validates transferred logic, not iOS native execution or device rendering.
"""
from __future__ import annotations
import argparse
import copy
import json
from pathlib import Path
import struct
import subprocess
import sys
import zlib

HERE = Path(__file__).resolve().parent
import prepare as recipe
sys.path.insert(0, str(HERE.parent / 'content-operations'))
import build_bridge as bridge
from build_request_identity import label_helper_targets

DONOR_SWF_SHA256 = '9c672e56e5911679848047daece874e139255b2d128f67ab11e605c5db2bb951'
HELPER_SHA256 = 'c11c8b93aba20c48d693e87c21376d4cf3de10e23de4d7c960d5cc1cdd67ef35'
SOURCE_SHA256 = 'c90eb79cc57b32960bec9062894e05d72da0060a5a506fd037bb4fa6c9d986b0'


def run(prepared, source_swf, work, sdk, java):
    work = Path(work)
    if work.exists():
        raise ValueError('Runtime verification needs a fresh output directory')
    source_swf = Path(source_swf)
    if recipe.sha(source_swf.read_bytes()) != DONOR_SWF_SHA256:
        raise ValueError('Requires the fixed accepted R11 SWF')
    report = json.loads(Path(prepared).read_text('utf-8'))
    full = Path(prepared).parent / report['full_abc_file']
    if recipe.sha(full.read_bytes()) != report['full_abc_sha256']:
        raise ValueError('Prepared candidate changed')
    candidate = recipe.view(recipe.p.abcfmt.ABC(full.read_bytes()))
    source = HERE / 'src/cn/content/ContentOperationsState.as'
    if recipe.sha(source.read_bytes()) != SOURCE_SHA256:
        raise ValueError('Pinned iOS helper source changed')
    work.mkdir(parents=True)
    production = work / 'production'
    production.mkdir()
    swc = production / 'content-state.swc'
    command = [str(java), '-Dflexlib=' + str(sdk / 'frameworks'), '-Xmx512m', '-jar',
               str(sdk / 'lib/compc-cli.jar'), '+configname=air', '-swf-version=44',
               '-target-player=32.0', '-debug=false', '-compiler.source-path=' + str(HERE / 'src'),
               '-include-classes=cn.content.ContentOperationsState', '-output=' + str(swc)]
    result = subprocess.run(command, capture_output=True, timeout=180)
    (work / 'helper-compile.log').write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise ValueError(('Helper source compilation failed', result.returncode))
    compiled_helper = bridge.sc.helper_abc(swc)
    label_helper_targets(compiled_helper)
    version, header, tags = bridge.sc.parts(source_swf)
    tag, = [t for t in tags if t[3] and any(t[3].mn_name(i[0]) == 'pinball.context.remote::RequestQueue' for i in t[3].instances)]
    helper, = [t[3] for t in tags if t[3] and any(t[3].mn_name(i[0]) == recipe.OWNER for i in t[3].instances)]
    if recipe.sha(helper.serialize()) != HELPER_SHA256:
        raise ValueError('Production helper identity changed')
    helper_view, compiled_view = recipe.view(helper), recipe.view(compiled_helper)
    helper_checks = []
    for label, indexes in helper_view.by_label.items():
        si, = indexes
        ci, = candidate.by_label[label]
        hi, = compiled_view.by_label[label]
        if helper_view.normalized(si) != candidate.normalized(ci) or helper_view.normalized(si) != compiled_view.normalized(hi):
            raise ValueError(('Helper source/candidate/fixed R11 differs', label))
        helper_checks.append(dict(label=label, candidate_method_id=candidate.a.bodies[ci][0],
                                  source_code_sha256=recipe.sha(helper.bodies[si][5]),
                                  candidate_code_sha256=recipe.sha(candidate.a.bodies[ci][5]), normalized_instructions_cfg_exact=True))
    target = recipe.view(tag[3])
    importer = recipe.p.Importer(target, candidate)
    method_checks = []
    for row in report['methods']:
        label = row['label']
        ci, = candidate.by_label[label]
        ti, = target.by_label[label]
        target.a.bodies[ti] = importer.body(ci, target.a.bodies[ti][0])
        if target.normalized(ti) != candidate.normalized(ci):
            raise ValueError(('Fixture donor differs from prepared production method', label))
        method_checks.append(dict(label=label, candidate_method_id=candidate.a.bodies[ci][0],
                                  candidate_code_sha256=recipe.sha(candidate.a.bodies[ci][5]),
                                  normalized_instructions_cfg_exact=True))
    payload = tag[2] + bridge.sc.serialize(target.a, tag[4])
    tag[1] = struct.pack('<HI', (82 << 6) | 63, len(payload)) + payload
    swf_body = header + b''.join(t[1] for t in tags)
    fixture_donor = b'CWS' + bytes([version]) + struct.pack('<I', len(swf_body) + 8) + zlib.compress(swf_body)
    (production / 'content-operations-android.swf').write_bytes(fixture_donor)
    (production / 'production-helper.abc').write_bytes(helper.serialize())
    binding = dict(prepared_full_abc_sha256=recipe.sha(full.read_bytes()), donor_swf_sha256=DONOR_SWF_SHA256,
                   fixture_method_carrier_sha256=recipe.sha(fixture_donor), helper_source_sha256=SOURCE_SHA256,
                   helper_swc_sha256=recipe.sha(swc.read_bytes()), method_checks=method_checks, helper_checks=helper_checks,
                   selected_methods=121, helper_methods=85,
                   unchanged_dependency_source='Fixed Android R11 reference bodies supplied to bounded AIR fixtures; iOS native dependencies are not executed.',
                   game_executed=False, native_executed=False, device_tested=False)
    recipe.dump(work / 'production-binding.json', binding)
    return run_suites(prepared, work, sdk, java)


def run_suites(prepared, work, sdk, java):
    work = Path(work)
    report = json.loads(Path(prepared).read_text('utf-8'))
    binding = json.loads((work / 'production-binding.json').read_text('utf-8'))
    production = work / 'production'
    if report['full_abc_sha256'] != binding['prepared_full_abc_sha256']:
        raise ValueError('Previously bound candidate changed')
    if recipe.sha((production / 'content-operations-android.swf').read_bytes()) != binding['fixture_method_carrier_sha256']:
        raise ValueError('Bound fixture donor changed')
    if recipe.sha((production / 'content-state.swc').read_bytes()) != binding['helper_swc_sha256']:
        raise ValueError('Bound helper SWC changed')
    suites = [('runtime', [], HERE / 'air_fixture_adapter.py', 'adapted-fixtures'),
              ('native', ['--native-regression'], HERE.parent / 'content-operations/period_runtime_fixtures.py', 'current-fixtures'),
              ('identity', ['--request-identity'], HERE / 'air_fixture_adapter.py', 'current-fixtures'),
              ('entry', ['--native-entry'], HERE / 'air_fixture_adapter.py', 'current-fixtures')]
    results = []
    for name, flags, script, group in suites:
        suite = work / group / name
        result_path = suite / f'air-{name}-result.json'
        reused = False
        if result_path.exists():
            prior = json.loads(result_path.read_text('utf-8'))
            reused = bool(prior.get('passed') and prior.get('sourceSwfSha256') == binding['fixture_method_carrier_sha256']
                          and prior.get('productionHelperAbcSha256') == HELPER_SHA256)
        if not reused:
            suite.mkdir(parents=True, exist_ok=True)
            command = [sys.executable, '-B', str(script),
                       '--work', str(suite), '--production-work', str(production), '--sdk', str(sdk), '--java', str(java), *flags]
            process = subprocess.run(command, capture_output=True, timeout=240)
            (suite / 'wrapper.log').write_bytes(process.stdout + process.stderr)
            if process.returncode:
                raise ValueError(('AIR fixture failed', name, process.returncode, str(suite / 'wrapper.log')))
        actual = json.loads((suite / f'air-{name}-result.json').read_text('utf-8'))
        if not actual.get('passed'):
            raise ValueError(('AIR assertions failed', name, actual))
        results.append(dict(suite=name, assertions=actual['assertions'], result_file=str(suite / f'air-{name}-result.json'),
                            test_swf_sha256=actual['testSwfSha256'], reused_unchanged_success=reused,
                            fixture_script=str(script), fixture_script_sha256=recipe.sha(script.read_bytes()), result=actual))
        print(json.dumps(dict(suite=name, passed=True, assertions=actual['assertions'])), flush=True)
    result = dict(status='production_logic_air_suites_passed', full_abc_sha256=report['full_abc_sha256'],
                  source_binding_sha256=recipe.sha((work / 'production-binding.json').read_bytes()),
                  suites=results, total_assertions=sum(r['assertions'] for r in results),
                  game_executed=False, native_executed=False, device_tested=False,
                  scope='Production helper and selected prepared method bodies execute with isolated dependency fixtures. No server, player save, CDN or device is touched.')
    recipe.dump(work / 'runtime-validation.json', result)
    print(json.dumps({k: result[k] for k in ('status', 'total_assertions')}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('prepared', 'source-swf', 'work', 'sdk', 'java'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--resume-fixtures', action='store_true')
    args = parser.parse_args()
    if args.resume_fixtures:
        run_suites(args.prepared, args.work, args.sdk, args.java)
    else:
        run(args.prepared, args.source_swf, args.work, args.sdk, args.java)


if __name__ == '__main__':
    main()
