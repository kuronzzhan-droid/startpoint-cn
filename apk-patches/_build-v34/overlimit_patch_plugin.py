"""Adapter for appendable, explicit single-method O8-O12 P-code edits."""
import json
from pathlib import Path
import subprocess
import sys

from build_common import ROOT, environment


def apply_selected(source, target, work, selection):
    paths = [Path(value).resolve() for value in (source, target, work)]
    if any(not path.is_relative_to(ROOT.resolve()) for path in paths):
        raise ValueError('All plugin paths must remain in this workspace')
    source, target, work = paths
    report_path = work / 'upstream-application.json'
    command = [sys.executable, '-B', str(ROOT / 'scripts/overlimit_runner.py'),
               str(source), str(target), '--select', selection, '--report', str(report_path)]
    result = subprocess.run(command, cwd=ROOT, env=environment(), capture_output=True, timeout=600)
    (work / 'overlimit-runner.log').write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f'{selection} refused; see {work / "overlimit-runner.log"}')
    report = json.loads(report_path.read_text('utf-8'))
    if len(report['patches']) != 1 or report['patches'][0]['status'] != 'applied':
        raise ValueError('A fresh pipeline stage must apply exactly one patch')
    patch = report['patches'][0]
    if patch['id'] != selection or patch['pool_added']:
        raise ValueError('Unexpected selection or constant-pool edit')
    return {'changed_bodies': [f'{patch["tag"]}:{patch["body"]}'], 'helpers': [],
            'source_patch': selection, 'upstream_report': report,
            'independent_guard': 'patch_pipeline.verify_patch checks raw body records independently'}
