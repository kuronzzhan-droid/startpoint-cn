"""锁定实际参与本轮框架验收的源码，允许总验收复用未变证据。"""
import json

from bootstrap import ROOT, BASE, output_path
from framework import sha

SOURCES = (
    'bootstrap.py', 'framework.py', 'build.py', 'chain_replay.py',
    'static_check.py', 'integrity.py', 'multiabc.py', 'verify_framework.py',
    'framework_evidence.py', 'target_contract.py', 'owner_main/patches.py',
    'owner_main/helpers.py', 'owner_main/element_helpers.py',
    'baseline-locks.json', 'release-locks.json',
)


def source_snapshot():
    paths = [ROOT / name for name in SOURCES] + sorted((ROOT/'vendor').glob('*.py'))
    return {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in paths}


def freeze_evidence(before, output):
    assert source_snapshot() == before, '框架验收期间参与源码改变，证据不可复用'
    record = {'schema_version': 1, 'files': before,
              'input_swf_sha256': sha(BASE.read_bytes()),
              'output_swf_sha256': sha(output.read_bytes()),
              'unchanged_during_verification': True}
    path = output_path(ROOT/'framework-source-locks.json')
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return {'path': path.name, 'sha256': sha(path.read_bytes()),
            'file_count': len(before), 'unchanged_during_verification': True}
