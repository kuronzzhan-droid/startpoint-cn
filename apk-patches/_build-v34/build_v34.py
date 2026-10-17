"""Offline official O8-O12 r2 build; O9-off is a historical diagnostic."""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

from build_common import ROOT, environment, run, write_json
from patch_pipeline import run_pipeline
from release_package import preflight, build_variant, VARIANTS
from release_report import write_report
from release_history import digest, ensure_round5_input, preserve_round5
from release_publish import publish
from verify_round6 import verify_release_swf


def diagnostic_only(run_dir):
    pipeline = run_pipeline(ROOT / 'patch-list-without-O9.json', run_dir / 'diagnostic-without-O9.swf')
    target = ROOT / 'diagnostics/v34-without-O9.swf'
    target.parent.mkdir(exist_ok=True)
    publish(Path(pipeline['output_path']), target)
    result = {'status': 'historical_diagnostic_only', 'candidate': False, 'revision': 'r2',
              'swf_path': str(target), 'swf_sha256': pipeline['output_sha256'],
              'pipeline': pipeline, 'apk_built': False, 'archive_101_retained': True,
              'zero_consumption_policy_cancelled': True, 'official_O9_retained': True}
    write_json(ROOT / 'verification/without-O9-build.json', result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def verify_outputs(pipeline, run_dir):
    path = ROOT / 'verification/swf-o8-o12-r2-verification.json'
    proof = json.loads(path.read_text('utf-8')) if path.exists() else {}
    valid = (proof.get('passed') and proof.get('swf_sha256') == pipeline['output_sha256']
             and proof.get('input_v33_sha256') == digest(ROOT / 'inputs/v33.swf')
             and proof.get('r4_base_sha256') == pipeline['base_sha256']
             and proof.get('revision') == 'r2'
             and proof.get('previous_round5_r1_sha256') == digest(ROOT / 'inputs/v34-o8-o12-r1-verified.swf'))
    if not valid:
        proof = verify_release_swf(Path(pipeline['output_path']), run_dir)
    write_json(path, proof)
    archive_path = ROOT / 'verification/v33-patches-preserved-o8-o12-r2.json'
    archive = json.loads(archive_path.read_text('utf-8')) if archive_path.exists() else {}
    if (archive.get('output_swf_sha256') != pipeline['output_sha256']
            or archive.get('input_swf_sha256') != digest(ROOT / 'inputs/v33.swf')
            or archive.get('method_evidence_failures') != []):
        run('round6-archive', [sys.executable, '-B', ROOT / 'scripts/verify_archive_preservation.py',
            '--final', pipeline['output_path'], '--output', archive_path,
            '--apk-evidence', 'verification/apk-x86-verification.json',
            '--whole-swf-evidence', 'verification/swf-o8-o12-r2-verification.json'])
    for name, sha_key in [('audits/round6-source-audit.json', 'final_swf_sha256'),
                          ('work/overlimit-round6/source-replay-verification.json', 'r4_final_sha256')]:
        evidence = json.loads((ROOT / name).read_text('utf-8'))
        assert evidence['passed'] and evidence[sha_key] == pipeline['output_sha256'], name
    return proof


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--without-O9', action='store_true',
                        help='historical diagnostic SWF only; no APK and no candidate release')
    args = parser.parse_args()
    os.environ.update(environment())
    if not args.without_O9:
        preflight()
    ensure_round5_input()
    releases = ROOT / 'work/release'
    releases.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix='build-', dir=releases))
    if args.without_O9:
        diagnostic_only(run_dir)
        return
    pipeline = run_pipeline(ROOT / 'patch-list.json', run_dir / 'v34-final.swf')
    proof = verify_outputs(pipeline, run_dir)
    packages, artifacts = {}, {}
    for variant in ('x86', 'arm64'):
        artifact, report = build_variant(variant, Path(pipeline['output_path']), run_dir / variant)
        packages[variant], artifacts[variant] = report, artifact
    assert packages['x86']['swf_sha256'] == packages['arm64']['swf_sha256'] == pipeline['output_sha256']
    preserve_round5()
    for variant, artifact in artifacts.items():
        publish(artifact, ROOT / VARIANTS[variant]['output'])
        write_json(ROOT / f'verification/apk-{variant}-verification.json', packages[variant])
    publish(Path(pipeline['output_path']), ROOT / 'v34.swf')
    run('round6-additions', [sys.executable, '-B', ROOT / 'scripts/archive_overlimit.py',
                            '--final-swf', ROOT / 'v34.swf'])
    report = write_report(pipeline, packages, run_dir)
    from overlimit_release_report import extend_report
    report = extend_report(report, proof)
    write_json(run_dir / 'build-report.json', report)
    print(json.dumps({'status': report['status'], 'primary_variant': 'x86',
                      'outputs': {name: row['output'] for name, row in report['variants'].items()},
                      'swf': report['swf'], 'versionCode': 1008002,
                      'official_patches': ['O8', 'O9', 'O10', 'O11', 'O12'],
                      'revision': 'r2'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
