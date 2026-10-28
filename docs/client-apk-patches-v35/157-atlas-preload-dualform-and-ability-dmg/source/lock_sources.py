"""Capture the reviewed source snapshot and the two immutable p10 method locks."""
import argparse

import bootstrap
from bootstrap import INPUTS, ROOT, TOOLCHAIN, sha, write_json
from atlas_preload import patch
from atlas_preload.inline import DEPENDENCIES
from swfabc import SwfAbc
import bodies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='explicitly replace this task source lock')
    args = parser.parse_args()
    if (ROOT / 'build-lock.json').exists() and not args.refresh:
        raise FileExistsError('source lock exists; do not silently refresh a build lock')
    snapshots = []
    for source, expected in INPUTS.values():
        assert sha(source.read_bytes()) == expected, source
        abc = SwfAbc(source).abc
        snapshots.append({label: {'sha': sha(abc.bodies[bodies.resolve(abc, label)][5]),
                                  'header': abc.bodies[bodies.resolve(abc, label)][1:5]}
                          for label in patch.TARGETS + list(DEPENDENCIES)})
    assert snapshots[0] == snapshots[1], 'profile target/dependency method mismatch'
    write_json(ROOT / 'baseline-locks.json', snapshots[0])
    sources = [ROOT / name for name in ('bootstrap.py', 'build_swf.py', 'lock_sources.py', 'baseline-locks.json')]
    sources += sorted((ROOT / 'atlas_preload').glob('*.py'))
    sources += [TOOLCHAIN / name for name in ('bootstrap.py', 'build_swf.py')]
    sources += sorted((TOOLCHAIN / 'vendor').glob('*.py'))
    lock = {'baseline': 'p10 versionCode 1008030; SWF-only increment',
            'mods': ['atlas_preload'], 'targets': patch.TARGETS,
            'profiles': {profile: {'swf': str(path), 'swf_sha256': expected}
                         for profile, (path, expected) in INPUTS.items()},
            'source_files': [{'path': str(path), 'sha256': sha(path.read_bytes())} for path in sources]}
    write_json(ROOT / 'build-lock.json', lock)
    print('Locked', len(sources), 'sources; both p10 profiles and all dependency methods match.')


if __name__ == '__main__':
    main()
