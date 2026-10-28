"""Build the C12 local x86-profile APK; hash-locked nocache.refresh mutates it last."""
import argparse
import json
from pathlib import Path
import sys
import zipfile

sys.dont_write_bytecode = True
from bootstrap import ROOT, C11, BASE as INPUT_SWF, BASE_SHA, require_hash, sha, write_json
from c12_config import VERSION_CODE, SWF, APK, PACKAGE_REPORT, ADMISSION_BUILD
from package_support import module_at, setup_nocache, checked_path, output_path
sys.path.insert(0, str(ROOT / 'source/packaging'))
from packaging_verify import CERT_SHA256, SWF_ENTRY, package_info, verify_package, run
from c1_verify_package import final_review
from c12_verify_package import validate_swf, external_address_scan, verify_offline_results

MANIFEST = C11 / 'C11-DELIVERY-MANIFEST.json'
SOURCE_LOCKS = {
    'source/packaging/packaging_verify.py': '50a6686a6ccc3f2ca720c44241f9ed9360179b18f40ccb1697e5cfddac9f6c3d',
    'source/nocache/apk_nocache.py': '9f6efed68c9b0a56928f98a5f0326f6df24e64cff2e96b5701084d5de36c290e',
    'source/nocache/native/cn/startpoint/StartupCache.java': '376d11b99c72cc331c01c0071e32ff6fbdcd7a9c928638492482467f7ffe44d9',
}
INHERITED_HELPERS = ('source/package_support.py', 'source/c1_verify_package.py')


def dependencies(create_work=True):
    if not __debug__:
        raise RuntimeError('Packaging assertions require Python without -O')
    locks = json.loads((ROOT / 'audit/input-lock.json').read_text('utf-8'))['inputs']
    require_hash(MANIFEST, locks[str(MANIFEST)]['sha256'])
    manifest = json.loads(MANIFEST.read_text('utf-8-sig'))
    assert manifest['status'] == 'sealed' and manifest['swf_sha256'] == BASE_SHA
    assert manifest['version_code'] == 1008072 and VERSION_CODE == 1008073
    assert manifest['admission_build'] == ADMISSION_BUILD == '<ADMISSION_ID>'
    base = Path(manifest['apk'])
    assert base.resolve().is_relative_to(C11.resolve())
    sealed_key = base.relative_to(C11.parent).as_posix()
    assert manifest['files'][sealed_key]['sha256'] == manifest['apk_sha256']
    assert manifest['files'][sealed_key]['bytes'] == base.stat().st_size
    require_hash(base, manifest['apk_sha256'])
    require_hash(base, locks[str(base)]['sha256'])
    require_hash(INPUT_SWF, BASE_SHA)
    for relative, expected in SOURCE_LOCKS.items():
        require_hash(ROOT / relative, expected)
    for relative in INHERITED_HELPERS:
        require_hash(ROOT / relative, locks[str(C11 / relative)]['sha256'])
    bump = Path('<WORKDIR>/perf-v30-20261015/tools/bump_versioncode.py')
    require_hash(bump, '0d04f0cd425027a29e57def9a71da3cb8113c4c8b915747035dedbd2baed0740')
    nocache = module_at('c12_apk_nocache', ROOT / 'source/nocache/apk_nocache.py')
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
    with zipfile.ZipFile(base) as archive:
        assert archive.read(SWF_ENTRY) == INPUT_SWF.read_bytes()
    assert nocache.manifest_uuid(base) == manifest['uniqueappversionid']
    cert = run(['cmd', '/c', nocache.BT / 'apksigner.bat', 'verify', '--verbose', '--print-certs', base])
    assert f'certificate SHA-256 digest: {CERT_SHA256}' in cert
    run([nocache.BT / 'zipalign.exe', '-c', '-p', '4', base])
    address_scan = external_address_scan(base)
    return nocache, base, {**info, 'sha256': manifest['apk_sha256'],
                            'uniqueappversionid': manifest['uniqueappversionid'],
                            'offline_cases_passed': manifest['offline_cases_passed'],
                            'external_address_scan': address_scan}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--preflight-only', action='store_true')
    mode.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    # Java tools need their temp directory bounded here even in read-only checks.
    nocache, base, provenance = dependencies()
    if args.preflight_only:
        print(json.dumps({'status': 'dependencies_verified', 'target': str(APK),
                          'version_code': VERSION_CODE, 'base': provenance}))
        return
    build = json.loads((ROOT / 'audit/build.json').read_text('utf-8'))
    assert build['status'] == 'passed'
    raw = validate_swf(SWF, build['sha256'])
    validation = verify_offline_results(sha(raw), provenance['offline_cases_passed'])
    independent = json.loads((ROOT / 'audit/c12/independent-c12.json').read_text('utf-8'))
    assert independent['status'] == 'passed' and independent['swf_sha256'] == sha(raw)
    assert independent['protected_method_count'] == 562
    assert not independent['new_methods'] and not independent['new_traits']
    if args.check_only:
        print(json.dumps({'status': 'inputs_verified', 'swf_sha256': sha(raw),
                          'version_code': VERSION_CODE, 'target': str(APK),
                          'offline_validation': validation}))
        return
    for path in (APK, APK.with_suffix('.apk.idsig'), PACKAGE_REPORT):
        checked_path(path, ROOT)
        if path.exists():
            raise FileExistsError(f'Refusing to replace delivery: {path}')
    output_path(APK, ROOT)
    receipt = nocache.refresh(base, APK, version_code=VERSION_CODE, swf_bytes=raw)
    # No operation below this point modifies the delivered APK or idsig.
    evidence = verify_package(base, APK, raw, 'com.leiting.wf', VERSION_CODE, nocache.BT)
    review = final_review(base, APK, SWF, receipt, evidence, nocache, VERSION_CODE)
    address_scan = external_address_scan(APK)
    require_hash(base, provenance['sha256'])
    require_hash(APK, receipt['sha256'])
    report = {'status': 'passed', 'profile': 'local', 'variant': 'x86', 'version_code': VERSION_CODE,
              'base': str(base), 'base_provenance': provenance, 'swf': str(SWF),
              'swf_sha256': sha(raw), 'apk': str(APK), 'apk_sha256': sha(APK.read_bytes()),
              'admission_build': ADMISSION_BUILD, 'http_cdn_endpoint': '<SERVER_HOST>:18001',
              'receipt': receipt, 'verification': evidence, 'readback': review,
              'external_address_scan': address_scan, 'offline_validation': validation,
              'last_mutating_step': 'build-c12/source/nocache/apk_nocache.py refresh (hash locked)',
              'temporary_directory': str(ROOT / 'client/packaging-work'),
              'runtime_verified': False, 'device_accessed': False, 'deployed': False,
              'sources': {str(p): sha(p.read_bytes()) for p in
                         [Path(__file__), ROOT / 'source/c12_verify_package.py',
                          ROOT / 'source/c12_config.py', ROOT / 'source/bootstrap.py',
                          *(ROOT / k for k in INHERITED_HELPERS),
                          *(ROOT / k for k in SOURCE_LOCKS)]}}
    write_json(PACKAGE_REPORT, report)
    print(json.dumps({'status': 'passed', 'apk': str(APK), 'sha256': report['apk_sha256'],
                      'version_code': VERSION_CODE, 'uniqueappversionid': receipt['build_id']}))


if __name__ == '__main__':
    main()
