"""沿用 p11 的 p9 输入和模块次序；先逐字节复现 p11，再追加 P12。"""
import argparse
import copy
import json
import zipfile
from bootstrap import ROOT, load_lock, output_path, require_hash, sha, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=('test', 'local'), default='test')
    parser.add_argument('--baseline-only', action='store_true')
    args = parser.parse_args()
    lock = load_lock()
    from framework import Editor
    from swfabc import SwfAbc
    from common import describe, freeze
    import asm
    import bodies
    from leader_kinds import patch as lk
    from direct_combo_cap import patch as cc
    from atlas_preload import patch as ap

    source = lock['profiles'][args.profile]
    require_hash(source['swf'], source['swf_sha256'])
    for base in source['bases'].values():
        require_hash(base['path'], base['sha256'])
        with zipfile.ZipFile(base['path']) as archive:
            assert sha(archive.read('assets/worldflipper_android_release.swf')) == source['swf_sha256']
    locks = json.loads((ROOT / 'baseline-locks.json').read_text('utf-8'))
    editor = Editor(source['swf'], locks)
    inherited = [mod.build(editor) for mod in (lk, cc, ap)]
    editor.apply()
    assert set(editor.report) == set(lk.TARGETS + cc.TARGETS + ap.TARGETS)
    assert not editor.new_methods and not editor.traits
    raw_p11 = editor.swf.serialize()
    assert sha(raw_p11) == lock['expected_p11'][args.profile], 'p11 reconstruction differs'
    reproduction = {'status': 'passed', 'profile': args.profile,
                    'p9_sha256': source['swf_sha256'], 'p11_sha256': sha(raw_p11),
                    'inherited_mods': lock['inherited_mods'],
                    'incremental_mods': lock['inherited_incremental_mods'],
                    'changed': editor.report, 'details': inherited}
    write_json(ROOT / 'build-audit' / f'p11-reproduction-{args.profile}.json', reproduction)
    if args.baseline_only:
        print(json.dumps({'status': 'p11_reproduced', 'profile': args.profile, 'sha256': sha(raw_p11)}))
        return

    from summon_cutin_preload import patch as n1
    from combo_base import patch as n3
    from dual_pf import patch as n4
    modules = (n1, n3, n4)
    targets = [label for mod in modules for label in mod.TARGETS]
    assert len(targets) == len(set(targets)), 'Overlapping module targets need explicit merge'
    original = copy.deepcopy(editor.abc.bodies)
    original_methods = copy.deepcopy(editor.abc.methods)
    original_labels = bodies.label_map(editor.abc).copy()
    editor.report = {}
    editor.original_bodies = original
    for label in targets:
        body = editor.body(label)
        editor.locks[label] = {'sha': sha(body[5]), 'header': body[1:5]}
    details = []
    for mod in modules:
        details.append(mod.build(editor))
        editor.apply()
    assert set(editor.report) == set(targets), (editor.report.keys(), targets)
    raw = editor.swf.serialize()
    dest = output_path(ROOT / 'client/build' / f'v35abyss-p12b-{args.profile}.swf')
    if dest.exists() and dest.read_bytes() != raw:
        raise FileExistsError(f'Refusing to overwrite a different candidate: {dest}')
    dest.write_bytes(raw)
    final = SwfAbc(dest).abc
    changed_indices = {bodies.resolve(final, label) for label in targets}
    assert freeze(original_methods) == freeze(final.methods[:len(original_methods)])
    kept = 0
    for index, before in enumerate(original):
        if index not in changed_indices:
            assert freeze(before) == freeze(final.bodies[index]), (index, original_labels.get(index))
            kept += 1
    labels = targets + [item['label'] for item in editor.new_methods]
    for label in labels:
        code = final.bodies[bodies.resolve(final, label)][5]
        output_path(ROOT / 'build-audit/pcode' / args.profile / (label.replace('/', '__') + '.txt')).write_text(
            '\n'.join(f'{i}: {describe(final, op)}' for i, op in enumerate(asm.decode(code))) + '\n', 'utf-8')
    report = {'status': 'passed', 'profile': args.profile, 'input': source['swf'],
              'input_sha256': source['swf_sha256'], 'p11_reproduced_sha256': sha(raw_p11),
              'output': str(dest), 'sha256': sha(raw),
              'mods': lock['inherited_incremental_mods'] + lock['incremental_mods'],
              'inherited_mods': lock['inherited_mods'],
              'changed': editor.report, 'added': editor.new_methods, 'traits': editor.traits,
              'non_target_method_records_preserved': kept, 'details': details,
              'build_lock_sha256': sha((ROOT / 'build-lock.json').read_bytes()),
              'module_sources': {str(p): sha(p.read_bytes()) for p in sorted((ROOT / 'source').rglob('*.py'))},
              'runtime_verified': False}
    write_json(ROOT / 'build-audit' / f'build-{args.profile}.json', report)
    load_lock()
    print(json.dumps({k: report[k] for k in ('status', 'profile', 'output', 'sha256', 'non_target_method_records_preserved')}))


if __name__ == '__main__':
    main()
