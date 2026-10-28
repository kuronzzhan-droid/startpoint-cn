"""复用 p11 封包入口与 apk_nocache，p9 三包制作 p12 / 1008033。"""
import importlib.util
import json
import os
import sys
from pathlib import Path
from bootstrap import ROOT, load_lock, output_path, require_hash, write_json


def module_from_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if any(arg.startswith('--swf') for arg in sys.argv):
        raise ValueError('P12 SWF must come from the bound build report')
    profile = sys.argv[sys.argv.index('--profile') + 1] if '--profile' in sys.argv else 'test'
    lock = load_lock()
    report = json.loads((ROOT / 'build-audit' / f'build-{profile}.json').read_text('utf-8'))
    assert report['status'] == 'passed'
    require_hash(report['output'], report['sha256'])
    for path, digest in report['module_sources'].items():
        require_hash(path, digest)
    sys.path.insert(0, str(ROOT / 'source/packaging'))
    packager = module_from_file('p12_packager', ROOT / 'source/packaging/build_apks.py')
    packager.ROOT, packager.VERSION_CODE, packager.REVISION = ROOT, 1008033, '12b'
    packager.NOCACHE_ROOT = ROOT / 'source/nocache'
    work = output_path(ROOT / 'client/packaging-work' / 'guard').parent
    temp = output_path(work / 'tmp' / 'guard').parent
    os.environ.update(TMP=str(temp), TEMP=str(temp), TMPDIR=str(temp),
                      JAVA_TOOL_OPTIONS='-Djava.io.tmpdir=' + str(temp))

    def load_nocache():
        nocache = module_from_file('p12_nocache', packager.NOCACHE_ROOT / 'apk_nocache.py')
        nocache.HERE = work
        # Readability only; never print or copy the signing material.
        try:
            with nocache.KS.open('rb') as stream:
                assert stream.read(1)
        except (PermissionError, FileNotFoundError):
            raise PermissionError('P11 signing material unavailable; unsigned packaging required') from None
        original_new_dex = nocache.new_dex

        def safe_new_dex(dex_bytes, build_id, temporary):
            temporary = Path(temporary)
            if not temporary.resolve().is_relative_to(work.resolve()):
                raise ValueError('nocache temporary directory escaped P12')
            output_path(temporary / 'smali/cn/startpoint/guard')
            return original_new_dex(dex_bytes, build_id, temporary)

        nocache.new_dex = safe_new_dex
        return nocache

    packager.load_nocache = load_nocache
    for group, config in lock['profiles'].items():
        packager.PROFILES[group]['base_version'] = 1008029
        packager.PROFILES[group]['bases'] = {
            abi: (Path(item['path']), item['sha256']) for abi, item in config['bases'].items()}
    sys.argv.extend(['--swf', report['output'], '--swf-sha256', report['sha256']])
    packager.main()
    load_lock()
    for item in lock['profiles'][profile]['bases'].values():
        require_hash(item['path'], item['sha256'])
    if '--check-only' not in sys.argv:
        write_json(ROOT / 'build-audit' / f'input-provenance-{profile}.json', {
            'status': 'passed', 'p9_inputs_unchanged': lock['profiles'][profile],
            'source_files_unchanged': lock['source_files'], 'version_code': 1008033,
            'device_accessed': False, 'deployed': False})


if __name__ == '__main__':
    main()
