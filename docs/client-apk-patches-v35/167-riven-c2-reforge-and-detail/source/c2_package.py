"""Build the C2 local x86-profile APK; nocache.refresh is the last mutation."""
import argparse
import json
from pathlib import Path
import sys
import zipfile
import zlib

from bootstrap import ROOT, C1, BASE as INPUT_SWF, BASE_SHA, require_hash, sha, write_json
from c2_config import VERSION_CODE, SWF, APK, PACKAGE_REPORT
from package_support import module_at, setup_nocache, checked_path, output_path
sys.path.insert(0, str(ROOT / 'source/packaging'))
from packaging_verify import CERT_SHA256, SWF_ENTRY, package_info, verify_package, run
from c1_verify_package import final_review

UPSTREAM = C1
MANIFEST = UPSTREAM / 'C1-DELIVERY-MANIFEST.json'
SOURCE_LOCKS = {
    'source/packaging/packaging_verify.py': '50a6686a6ccc3f2ca720c44241f9ed9360179b18f40ccb1697e5cfddac9f6c3d',
    'source/nocache/apk_nocache.py': '9f6efed68c9b0a56928f98a5f0326f6df24e64cff2e96b5701084d5de36c290e',
    'source/nocache/native/cn/startpoint/StartupCache.java': '376d11b99c72cc331c01c0071e32ff6fbdcd7a9c928638492482467f7ffe44d9',
}


def dependencies(create_work=True):
    if not __debug__:
        raise RuntimeError('Packaging assertions require Python without -O')
    locks = json.loads((ROOT / 'audit/input-lock.json').read_text('utf-8'))['inputs']
    require_hash(MANIFEST, locks[str(MANIFEST)]['sha256'])
    manifest = json.loads(MANIFEST.read_text('utf-8-sig'))
    assert manifest['status'] == 'sealed' and manifest['swf_sha256'] == BASE_SHA
    base = C1.parent / next(k for k in manifest['files'] if k.endswith('.signed.apk'))
    require_hash(base, manifest['apk_sha256'])
    require_hash(INPUT_SWF, BASE_SHA)
    for relative, expected in SOURCE_LOCKS.items():
        require_hash(ROOT / relative, expected)
    bump = Path('<WORKDIR>/perf-v30-20261015/tools/bump_versioncode.py')
    require_hash(bump, '0d04f0cd425027a29e57def9a71da3cb8113c4c8b915747035dedbd2baed0740')
    nocache = module_at('c2_apk_nocache', ROOT / 'source/nocache/apk_nocache.py')
    for path in [nocache.JDK / 'java.exe', nocache.JDK / 'javac.exe', nocache.BT / 'aapt.exe',
                 nocache.BT / 'zipalign.exe', nocache.BT / 'apksigner.bat', nocache.BT / 'lib/d8.jar',
                 nocache.ANDROID_JAR, nocache.SMALI_LIB / 'baksmali.jar',
                 nocache.SMALI_LIB / 'smali.jar', nocache.KS, nocache.SRC]:
        if not path.is_file():
            raise FileNotFoundError(path)
    setup_nocache(nocache, ROOT, create=create_work)
    info = package_info(base, nocache.BT)
    assert info == {'package': 'com.leiting.wf', 'version_code': manifest['version_code'],
                    'abis': ['arm64-v8a', 'x86_64']}
    assert VERSION_CODE > info['version_code']
    with zipfile.ZipFile(base) as archive:
        assert archive.read(SWF_ENTRY) == INPUT_SWF.read_bytes()
    assert nocache.manifest_uuid(base) == manifest['uniqueappversionid']
    cert = run(['cmd', '/c', nocache.BT / 'apksigner.bat', 'verify', '--verbose', '--print-certs', base])
    assert f'certificate SHA-256 digest: {CERT_SHA256}' in cert
    run([nocache.BT / 'zipalign.exe', '-c', '-p', '4', base])
    return nocache, base, {**info, 'sha256': manifest['apk_sha256'],
                            'uniqueappversionid': manifest['uniqueappversionid']}


def validate_swf(source, expected):
    source = checked_path(source, ROOT)
    require_hash(source, expected)
    raw = source.read_bytes()
    assert raw[:3] == b'CWS'
    body = zlib.decompress(raw[8:])
    assert len(body) + 8 == int.from_bytes(raw[4:8], 'little')
    assert b'<ADMISSION_ID>' in body
    assert b'<SERVER_HOST>:8001' in body
    assert b'<ADMISSION_ID>' not in body
    assert b'<SERVER_HOST>:8001' not in body
    assert sha(raw) != BASE_SHA
    return raw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preflight-only', action='store_true')
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    nocache, base, provenance = dependencies()
    if args.preflight_only:
        print(json.dumps({'status': 'dependencies_verified', 'target': str(APK),
                          'version_code': VERSION_CODE, 'base': provenance}))
        return
    build = json.loads((ROOT / 'audit/build.json').read_text('utf-8'))
    assert build['status'] == 'passed'
    raw = validate_swf(SWF, build['sha256'])
    if args.check_only:
        print(json.dumps({'status': 'inputs_verified', 'swf_sha256': sha(raw),
                          'version_code': VERSION_CODE, 'target': str(APK)}))
        return
    for path in (APK, APK.with_suffix('.apk.idsig'), PACKAGE_REPORT):
        checked_path(path, ROOT)
        if path.exists():
            raise FileExistsError(f'Refusing to replace delivery: {path}')
    output_path(APK, ROOT)
    receipt = nocache.refresh(base, APK, version_code=VERSION_CODE, swf_bytes=raw)
    evidence = verify_package(base, APK, raw, 'com.leiting.wf', VERSION_CODE, nocache.BT)
    review = final_review(base, APK, SWF, receipt, evidence, nocache, VERSION_CODE)
    require_hash(base, provenance['sha256'])
    report = {'status': 'passed', 'profile': 'local', 'variant': 'x86', 'version_code': VERSION_CODE,
              'base': str(base), 'base_provenance': provenance, 'swf': str(SWF),
              'swf_sha256': sha(raw), 'apk': str(APK), 'apk_sha256': sha(APK.read_bytes()),
              'receipt': receipt, 'verification': evidence, 'readback': review,
              'last_mutating_step': 'build-c2/source/nocache/apk_nocache.py refresh (hash locked)',
              'runtime_verified': False, 'device_accessed': False, 'deployed': False,
              'sources': {str(p): sha(p.read_bytes()) for p in
                         [Path(__file__), ROOT / 'source/c2_config.py', ROOT / 'source/c1_verify_package.py',
                          ROOT / 'source/package_support.py', *(ROOT / k for k in SOURCE_LOCKS)]}}
    write_json(PACKAGE_REPORT, report)
    print(json.dumps({'status': 'passed', 'apk': str(APK), 'sha256': report['apk_sha256'],
                      'version_code': VERSION_CODE, 'uniqueappversionid': receipt['build_id']}))


if __name__ == '__main__':
    main()
