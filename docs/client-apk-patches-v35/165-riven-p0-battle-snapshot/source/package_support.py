"""Bound P0c packaging writes and verify the read-only final p13 inputs."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import types
import zipfile


def checked_path(path, root):
    path, root = Path(path).absolute(), Path(root).absolute()
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f'Output escaped P0c: {path}')
    for ancestor in (path, *path.parents):
        if not ancestor.exists() and not ancestor.is_symlink():
            continue
        attrs = getattr(ancestor.lstat(), 'st_file_attributes', 0)
        if ancestor.is_symlink() or attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError(f'Output path contains a junction/symlink: {ancestor}')
    return path


def output_path(path, root):
    path = checked_path(path, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    return checked_path(path, root)


def module_at(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def setup_nocache(nocache, root, create=True):
    work = checked_path(root / 'client/packaging-work', root)
    temporary = checked_path(work / 'tmp', root)
    if create:
        output_path(temporary / 'guard', root)
    elif not temporary.is_dir():
        raise FileNotFoundError(temporary)
    os.environ.update(TMP=str(temporary), TEMP=str(temporary), TMPDIR=str(temporary),
                      JAVA_TOOL_OPTIONS='-Djava.io.tmpdir=' + str(temporary) + ' -XX:-UsePerfData')
    nocache.HERE = work
    original_new_dex = nocache.new_dex

    def bounded_new_dex(data, build_id, directory):
        directory = checked_path(directory, work)
        if directory.parent != work or not directory.name.startswith('nocache-'):
            raise ValueError(f'Unexpected nocache work directory: {directory}')
        result = original_new_dex(data, build_id, directory)
        checked_path(directory, work)
        return result

    def bounded_rmtree(directory):
        directory = checked_path(directory, work)
        if directory.relative_to(work).parts[1:] != ('smali', 'cn', 'startpoint'):
            raise ValueError(f'Unexpected recursive deletion target: {directory}')
        if not directory.parts[-4].startswith('nocache-'):
            raise ValueError(f'Unexpected recursive deletion owner: {directory}')
        for child in directory.rglob('*'):
            checked_path(child, work)
        return shutil.rmtree(directory)

    nocache.new_dex = bounded_new_dex
    nocache.shutil = types.SimpleNamespace(rmtree=bounded_rmtree)


def verify_p13(base, base_sha, base_swf, swf_sha, provenance_locks, bt):
    from packaging_verify import CERT_SHA256, SWF_ENTRY, package_info, require_hash, run, sha
    p13 = base.parent.parent
    for relative, expected in provenance_locks.items():
        require_hash(p13 / relative, expected)
    manifest = json.loads((p13 / 'P13-DELIVERY-MANIFEST.json').read_text('utf-8'))
    report = json.loads((p13 / 'apk/build-report-local-r13.json').read_text('utf-8'))
    assert manifest['status'] == 'sealed'
    assert report['status'] == 'verified' and report['profile'] == 'local'
    assert report['version_code'] == 1008050
    assert Path(report['swf']) == base_swf and report['swf_sha256'] == swf_sha
    entry = [item for item in report['apks'] if Path(item['path']) == base]
    assert len(entry) == 1 and entry[0]['sha256'] == base_sha
    assert entry[0]['swf_sha256'] == swf_sha
    for path, expected in ((base, base_sha), (base_swf, swf_sha)):
        sealed = manifest['files'][str(path.relative_to(p13))]
        assert sealed['sha256'] == expected and sealed['size'] == path.stat().st_size
        require_hash(path, expected)
    with zipfile.ZipFile(base) as archive:
        assert sha(archive.read(SWF_ENTRY)) == swf_sha
        assert archive.read(SWF_ENTRY) == base_swf.read_bytes()
    info = package_info(base, bt)
    assert info == {'package': 'com.leiting.wf', 'version_code': 1008050,
                    'abis': ['arm64-v8a', 'x86_64']}
    cert = run(['cmd', '/c', bt / 'apksigner.bat', 'verify', '--verbose', '--print-certs', base])
    assert f'certificate SHA-256 digest: {CERT_SHA256}' in cert
    run([bt / 'zipalign.exe', '-c', '-p', '4', base])
    return {**info, 'certificate_sha256': CERT_SHA256,
            'delivery_manifest_verified': True, 'build_report_verified': True,
            'base_swf_matches_standalone': True,
            'uniqueappversionid': entry[0]['build_id']}
