"""Apply only atlas_preload on the locked p10 SWF; never build or inspect an APK."""
import argparse

import bootstrap
from bootstrap import INPUTS, ROOT, load_lock, output_path, sha, write_json
from atlas_preload import patch as ap
from common import freeze, listing
from framework import Editor
from swfabc import SwfAbc
import bodies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=INPUTS, required=True)
    profile = parser.parse_args().profile
    load_lock()
    source, expected = INPUTS[profile]
    # framework.Editor loads our ROOT/baseline-locks.json through this bootstrap.
    editor = Editor(source)
    mods = [ap]
    details = [module.build(editor) for module in mods]
    editor.apply()
    assert set(editor.report) == set(ap.TARGETS)
    assert not editor.new_methods and not editor.traits
    raw = editor.swf.serialize()
    dest = output_path(ROOT / 'build' / f'v35abyss-p11-{profile}.swf')
    if dest.exists() and dest.read_bytes() != raw:
        raise FileExistsError('refusing to replace a different SWF: ' + str(dest))
    dest.write_bytes(raw)
    final = SwfAbc(dest).abc
    changed = {bodies.resolve(final, label) for label in ap.TARGETS}
    assert len(final.bodies) == len(editor.original_bodies)
    for index, before in enumerate(editor.original_bodies):
        if index not in changed:
            assert freeze(before) == freeze(final.bodies[index]), index
    for label in ap.TARGETS:
        body = final.bodies[bodies.resolve(final, label)]
        output_path(ROOT / 'build/pcode' / profile / (label.replace('/', '__') + '.txt')).write_text(
            '\n'.join(listing(final, body[5])) + '\n', 'utf-8')
    report = {'status': 'pass', 'profile': profile, 'input': str(source), 'input_sha256': expected,
              'output': str(dest), 'sha256': sha(raw), 'mods': ['atlas_preload'],
              'details': details, 'changed': editor.report,
              'non_target_main_method_records_preserved': len(final.bodies) - len(changed),
              'new_classes': 0, 'new_helpers': 0, 'runtime_verified': False,
              'build_lock_sha256': sha((ROOT / 'build-lock.json').read_bytes())}
    write_json(ROOT / 'build' / f'build-{profile}.json', report)
    load_lock()
    print(profile, sha(raw), 'pass:', len(changed), 'methods changed')


if __name__ == '__main__':
    main()
