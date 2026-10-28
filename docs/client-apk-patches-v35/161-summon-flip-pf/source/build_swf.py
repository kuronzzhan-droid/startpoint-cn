"""Apply method-level P13 increments to locked actual p12b-final SWFs."""
import argparse
import copy
import json
from pathlib import Path
from bootstrap import ROOT, output_path, require_hash, sha, write_json


def load_inputs():
    lock = json.loads((ROOT / 'p13-input-lock.json').read_text('utf-8'))
    for item in lock['source_files']:
        require_hash(item['path'], item['sha256'])
    require_hash(ROOT / lock['brief']['path'], lock['brief']['sha256'])
    require_hash(lock['interface']['path'], lock['interface']['sha256'])
    return lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True, choices=('test', 'local'))
    args = parser.parse_args()
    lock = load_inputs()
    source = lock['profiles'][args.profile]
    require_hash(source['swf'], source['sha256'])
    from framework import Editor
    from swfabc import SwfAbc
    from common import freeze, listing
    import bodies
    from ball_pf_action import patch as n6
    from summon_flip_pf import patch as n5
    modules = (n5, n6)
    targets = [target for module in modules for target in module.TARGETS]
    assert len(targets) == len(set(targets)), 'Module targets overlap'
    editor = Editor(source['swf'], {})
    before = copy.deepcopy(editor.abc.bodies)
    before_methods = copy.deepcopy(editor.abc.methods)
    for label in targets:
        body = editor.body(label)
        editor.locks[label] = {'sha': sha(body[5]), 'header': body[1:5]}
    details = []
    for module in modules:
        details.append(module.build(editor))
        editor.apply()
    assert set(editor.report) == set(targets), (editor.report.keys(), targets)
    raw = editor.swf.serialize()
    dest = output_path(ROOT / 'client/build' / f'v35abyss-p13-{args.profile}.swf')
    if dest.exists() and dest.read_bytes() != raw:
        raise FileExistsError(f'Refusing overwrite; archive previous candidate first: {dest}')
    dest.write_bytes(raw)
    final = SwfAbc(dest).abc
    assert freeze(before_methods) == freeze(final.methods[:len(before_methods)])
    changed = {bodies.resolve(final, label) for label in targets}
    kept = 0
    for i, old in enumerate(before):
        if i not in changed:
            assert freeze(old) == freeze(final.bodies[i]), i
            kept += 1
    for label in targets + [row['label'] for row in editor.new_methods]:
        body = final.bodies[bodies.resolve(final, label)]
        output_path(ROOT / 'build-audit/pcode' / args.profile / (label.replace('/', '__') + '.txt')).write_text(
            '\n'.join(listing(final, body[5])) + '\n', 'utf-8')
    report = {'status': 'passed', 'revision': 'p13', 'profile': args.profile,
              'input': source['swf'], 'input_sha256': source['sha256'],
              'output': str(dest), 'sha256': sha(raw),
              'changed': editor.report, 'added': editor.new_methods, 'traits': editor.traits,
              'details': details, 'non_target_method_records_preserved': kept,
              'input_lock_sha256': sha((ROOT / 'p13-input-lock.json').read_bytes()),
              'module_sources': {str(p.relative_to(ROOT)): sha(p.read_bytes())
                                 for p in sorted((ROOT / 'source').rglob('*.py'))},
              'runtime_verified': False}
    write_json(ROOT / 'build-audit' / f'build-{args.profile}.json', report)
    load_inputs()
    print(json.dumps({k: report[k] for k in ('status', 'profile', 'output', 'sha256', 'non_target_method_records_preserved')}))


if __name__ == '__main__':
    main()
