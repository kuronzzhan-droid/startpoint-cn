"""Rebuild immutable p13s profiles: python -B build_swf.py."""
from __future__ import annotations
import argparse
import json

import bootstrap
from bootstrap import ROOT, INPUTS, build_path, output_path, sha, verify_input
import asm
import bodies
from framework import Editor
from swfabc import SwfAbc
from client_patch import patch
from client_patch.audit import audit, require
from client_patch.pcode_export import export_pcode

class PatchEditor(Editor):
    """Forbid replacement except the framework's reversible splice operation."""
    def __init__(self, source, locks):
        super().__init__(source, locks)
        self._applying = False

    def insert(self, label, at, code, incoming=asm.ENTER):
        require(label in self.locks, 'undeclared insertion target: ' + label)
        return super().insert(label, at, code, incoming)

    def replace(self, *args, **kwargs):
        require(self._applying, 'direct body replacement is forbidden')
        return super().replace(*args, **kwargs)

    def apply(self):
        self._applying = True
        try:
            return super().apply()
        finally:
            self._applying = False

def build_sources():
    paths = [ROOT / name for name in ('bootstrap.py', 'build_swf.py')]
    for directory in ('client_patch', 'vendor'):
        paths.extend((ROOT / directory).rglob('*.py'))
    hashes = {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in sorted(paths)}
    return sha(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()), hashes

def build_one(profile):
    source_digest, source_files = build_sources()
    baseline = SwfAbc(verify_input(profile))
    locks = {}
    for label in patch.TARGETS:
        body = baseline.abc.bodies[bodies.resolve(baseline.abc, label)]
        locks[label] = {'sha': sha(body[5]), 'header': body[1:5]}
    editor = PatchEditor(verify_input(profile), locks)
    detail = patch.build(editor)
    editor.apply()
    raw = editor.swf.serialize()
    candidate = output_path(ROOT / 'build' / ('.' + profile + '.candidate.swf'))
    try:
        candidate.write_bytes(raw)
        final = SwfAbc(candidate)
        checks = audit(baseline, final, editor, patch.TARGETS)
        final_labels = set(editor.report) | {r['label'] for r in editor.new_methods}
        pcode = export_pcode(final.abc, final_labels, ROOT / 'build' / 'pcode' / profile)
    finally:
        if candidate.exists():
            candidate.unlink()
    require(build_sources() == (source_digest, source_files), 'source changed during build')
    destination = output_path(build_path(profile))
    destination.write_bytes(raw)
    report = {
        'profile': profile, 'input': INPUTS[profile][0].relative_to(ROOT).as_posix(),
        'input_sha256': INPUTS[profile][1], 'output': destination.relative_to(ROOT).as_posix(),
        'output_sha256': sha(raw), 'output_bytes': len(raw),
        'build_source_sha256': source_digest, 'build_source_files': source_files,
        'baseline_method_locks': locks, 'changed_methods': editor.report,
        'new_methods': editor.new_methods, 'pool_additions': editor.pool.report(),
        'structural_audit': checks, 'final_pcode': pcode, 'patch_detail': detail,
        'device_validation': 'not performed',
    }
    output_path(ROOT / 'build' / ('audit-' + profile + '.json')).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=['all', *INPUTS], default='all')
    args = parser.parse_args()
    for profile in INPUTS if args.profile == 'all' else [args.profile]:
        report = build_one(profile)
        print(json.dumps({'profile': profile, 'output': report['output'],
                          'sha256': report['output_sha256'], 'audit_pass': True}), flush=True)
    sums = [f'{sha(build_path(p).read_bytes())}  {build_path(p).name}' for p in INPUTS if build_path(p).exists()]
    output_path(ROOT / 'build/SHA256SUMS').write_text('\n'.join(sums)+'\n', encoding='ascii')

if __name__ == '__main__':
    main()
