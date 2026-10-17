"""Hash-locked, offline SWF patch list; plugins are reviewed code, not a sandbox.

Enabled entry: id/name/status, implementation_mode="single_method_pcode",
plugin/plugin_sha256, input_sha256/output_sha256, expected_changed_bodies,
expected_helpers, and optional inputs=[{"path": ..., "sha256": ...}].
Plugin API: apply(source: Path, target: Path, work: Path) -> JSON-compatible dict
containing changed_bodies and helpers; optional test results remain plugin claims.
Pending entries are placeholders and never execute. Import this module with -B.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

from build_common import ROOT, environment, load, write_json
from swf_patch_guard import verify_patch

sys.dont_write_bytecode = True


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def confined(value):
    path = Path(value)
    path = (ROOT / path).resolve() if not path.is_absolute() else path.resolve()
    if not path.is_relative_to(ROOT.resolve()):
        raise ValueError(f'Path must remain in this workspace: {value}')
    return path


def locked(path_value, expected):
    if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError(f'Full lowercase SHA-256 required: {path_value}')
    path = confined(path_value)
    if not path.is_file() or sha(path) != expected:
        raise ValueError(f'Input SHA-256 mismatch: {path}')
    return path


def checked_list(entry, field):
    value = entry[field]
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f'{field} must be an explicit string list')
    if len(value) != len(set(value)):
        raise ValueError(f'Duplicate {field}')
    return value


def prepare_entries(entries):
    enabled, pending, seen = [], [], set()
    for entry in entries:
        identity = entry['id']
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', identity) or identity in seen:
            raise ValueError(f'Invalid/duplicate patch id: {identity}')
        seen.add(identity)
        if entry['status'] == 'pending':
            pending.append({'id': identity, 'name': entry['name'], 'status': 'pending'})
            continue
        if entry['status'] != 'enabled':
            raise ValueError(f'Unknown patch status: {identity}')
        if entry.get('implementation_mode') != 'single_method_pcode':
            raise ValueError(f'Only reviewed method-level P-code plugins are accepted: {identity}')
        plugin = locked(entry['plugin'], entry['plugin_sha256'])
        if plugin.suffix.lower() != '.py':
            raise ValueError('Plugin must be a workspace Python file')
        for field in ('input_sha256', 'output_sha256'):
            if not re.fullmatch(r'[0-9a-f]{64}', entry[field]):
                raise ValueError(f'Full {field} required: {identity}')
        bodies = checked_list(entry, 'expected_changed_bodies')
        helpers = checked_list(entry, 'expected_helpers')
        if not bodies and not helpers:
            raise ValueError(f'Enabled patch declares no changes: {identity}')
        for dependency in entry.get('inputs', []):
            locked(dependency['path'], dependency['sha256'])
        enabled.append((entry, plugin))
    return enabled, pending


def copy_output(source, target):
    target = confined(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = confined(target.with_name(target.name + '.tmp'))
    shutil.copyfile(source, temporary)
    os.replace(temporary, target)


def apply_entry(entry, plugin, current, run_dir, index, tool_hashes):
    if sha(current) != entry['input_sha256']:
        raise ValueError(f'Patch input SHA-256 mismatch: {entry["id"]}')
    key_data = {'entry': entry, 'pipeline_tools': tool_hashes}
    key = hashlib.sha256(json.dumps(key_data, sort_keys=True).encode('utf-8')).hexdigest()
    cache = confined(ROOT / 'work/patch-pipeline/cache' / key)
    cached_swf, cached_report = cache / 'patched.swf', cache / 'verification.json'
    if cached_swf.is_file() and cached_report.is_file():
        saved = json.loads(cached_report.read_text('utf-8'))
        if (saved.get('cache_key') == key and saved.get('verification', {}).get('passed')
                and sha(cached_swf) == entry['output_sha256']):
            return cached_swf, dict(saved, cache_hit=True)
    work = run_dir / f'{index:02d}-{entry["id"]}'
    work.mkdir()
    source, target = work / 'input.swf', work / 'output.swf'
    shutil.copyfile(current, source)
    old_cwd = Path.cwd()
    try:
        os.chdir(ROOT)
        module = load(f'v34_patch_{index}_{key[:12]}', plugin)
        result = module.apply(source, target, work)
    finally:
        os.chdir(old_cwd)
    if sha(source) != entry['input_sha256'] or sha(current) != entry['input_sha256']:
        raise ValueError(f'Plugin modified its input: {entry["id"]}')
    locked(target, entry['output_sha256'])
    if not isinstance(result, dict):
        raise ValueError('Plugin apply() must return a JSON-compatible dict')
    for actual, expected in (('changed_bodies', 'expected_changed_bodies'),
                             ('helpers', 'expected_helpers')):
        if set(checked_list(result, actual)) != set(entry[expected]):
            raise ValueError(f'Plugin report differs from declared {expected}')
    verification = verify_patch(source, target, entry['expected_changed_bodies'],
                                entry['expected_helpers'])
    report = {'id': entry['id'], 'name': entry['name'], 'cache_key': key,
              'plugin': str(plugin.relative_to(ROOT)), 'plugin_sha256': sha(plugin),
              'input_sha256': entry['input_sha256'], 'output_sha256': sha(target),
              'verification': verification, 'plugin_report': result, 'cache_hit': False}
    # Ensure serialization succeeds before publishing any reusable cache entry.
    json.dumps(report, ensure_ascii=False)
    cache.mkdir(parents=True, exist_ok=True)
    copy_output(target, cached_swf)
    write_json(cached_report, report)
    write_json(work / 'verification.json', report)
    return cached_swf, report


def run_pipeline(config_path=None, output_path=None, *, exclude_patch_ids=()):
    """Return output path/hash, isolated working_run_dir/report_path and evidence."""
    os.environ.update(environment())
    config_path = confined(config_path or ROOT / 'patch-list.json')
    output_path = confined(output_path or ROOT / 'work/release/v34-final.swf')
    config = json.loads(config_path.read_text('utf-8'))
    if config['schema_version'] != 1:
        raise ValueError('Unsupported patch-list schema')
    base = config['base']
    source = locked(base['path'], base['sha256'])
    if output_path == source:
        raise ValueError('Output cannot overwrite the immutable verified base')
    evidence_path = confined(base['verification_report'])
    evidence = json.loads(evidence_path.read_text('utf-8'))
    if not evidence.get('passed') or evidence.get('swf_sha256') != base['sha256']:
        raise ValueError('Base verification report does not match the pinned SWF')
    enabled, pending = prepare_entries(config['patches'])
    excluded = set(exclude_patch_ids)
    if not excluded <= {entry['id'] for entry, _ in enabled}:
        raise ValueError('Excluded patch id is not an enabled entry')
    enabled = [(entry, plugin) for entry, plugin in enabled if entry['id'] not in excluded]
    tools = [Path(__file__).resolve(), ROOT / 'scripts/swf_patch_guard.py',
             ROOT / 'scripts/build_common.py',
             ROOT / 'r4-src/client-patch/startup-cache/build_swf.py']
    tools += sorted((ROOT / 'r4-src/client-patch/lens0907-0908').rglob('*.py'))
    tools += sorted((ROOT / 'r4-src/tools/lens-integration').rglob('*.py'))
    tool_hashes = {str(path.relative_to(ROOT)): sha(path) for path in tools}
    runs = confined(ROOT / 'work/patch-pipeline/runs')
    runs.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix='run-', dir=runs))
    current, stages = source, []
    for index, (entry, plugin) in enumerate(enabled, 1):
        current, result = apply_entry(entry, plugin, current, run_dir, index, tool_hashes)
        stages.append(result)
    copy_output(current, output_path)
    report_path = run_dir / 'pipeline-report.json'
    report = {'passed': True, 'config_path': str(config_path), 'config_sha256': sha(config_path),
              'base_path': str(source), 'base_sha256': base['sha256'],
              'base_verification_report': str(evidence_path),
              'base_verification_report_sha256': sha(evidence_path),
              'output_path': str(output_path), 'output_sha256': sha(output_path),
              'enabled_patch_count': len(stages), 'stages': stages, 'pending': pending,
              'excluded_patch_ids': sorted(excluded),
              'working_run_dir': str(run_dir), 'report_path': str(report_path),
              'historical_air_evidence_applicable_to_swf': not enabled,
              'new_patch_air_validation': '未运行；新增补丁不得继承原 R4 AIR 验收' if enabled else '无新增补丁',
              'plugin_execution': '本工作区内经审阅代码；路径和哈希锁不构成代码沙箱',
              'tool_hashes': tool_hashes}
    write_json(report_path, report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'patch-list.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'work/release/v34-final.swf')
    args = parser.parse_args()
    print(json.dumps(run_pipeline(args.config, args.output), ensure_ascii=False, indent=2))
