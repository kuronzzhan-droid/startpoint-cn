"""Package one p13-based P0c local x86 APK; hash-locked nocache is the final mutation."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
if not __debug__:
    raise RuntimeError('Packaging assertions require Python without -O')
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'source/packaging'))
from packaging_verify import require_hash, sha, verify_package
from package_support import checked_path, module_at, output_path, setup_nocache, verify_p13

P13 = Path(r'<WORKDIR>/outputs/work/beretta-p13-20261025')
BASE = P13 / 'apk/abyss-beast-v35pf4p13-local-wf-x86.signed.apk'
BASE_SHA = '51672dd80d3e277e9570e78b7ae948559dae781d216898fce1c95a63d8e687ca'
BASE_SWF = P13 / 'client/build/v35abyss-p13-local.swf'
BASE_SWF_SHA = '2d748efba919fee44ecf149a02cb87cb703ecc5e365fcf64d44b8f0fbd6a0540'
VERSION_CODE = 1008051
SWF = ROOT / 'swf/boot-riven-p0c.swf'
TARGET = ROOT / f'apk/worldflipper-riven-p0c-local-wf-x86-v{VERSION_CODE}.signed.apk'
REPORT = ROOT / 'build-audit/riven-p0c-apk-final.json'
SOURCE_LOCKS = {
    'source/packaging/build_apks.py': 'f40d4bffdb5d38d0eb09994111c1c0186346a01433a4b1ff7e374ddb12882570',
    'source/packaging/packaging_verify.py': '50a6686a6ccc3f2ca720c44241f9ed9360179b18f40ccb1697e5cfddac9f6c3d',
    'source/nocache/apk_nocache.py': '9f6efed68c9b0a56928f98a5f0326f6df24e64cff2e96b5701084d5de36c290e',
    'source/nocache/native/cn/startpoint/StartupCache.java': '376d11b99c72cc331c01c0071e32ff6fbdcd7a9c928638492482467f7ffe44d9',
}
PROVENANCE_LOCKS = {
    'P13-DELIVERY-MANIFEST.json': '55ab810fda89c99703d9ac53ff16547ebc838afa296efe2359ca6e657a0a7702',
    'P13-REPORT.md': 'd15c77446e11babab5e31f4f0a218bb8261a6beb4da8113cdfe82db76643a3c7',
    'apk/build-report-local-r13.json': '801139cbfd13b5e4895fb32a33f793aed6310b6dcbb791561b0f5a4ebaf8f4d5',
}


def dependencies(create_work=True):
    for relative, expected in SOURCE_LOCKS.items():
        require_hash(ROOT / relative, expected)
    bump = Path(r'<WORKDIR>/perf-v30-20261015/tools/bump_versioncode.py')
    require_hash(bump, '0d04f0cd425027a29e57def9a71da3cb8113c4c8b915747035dedbd2baed0740')
    nocache = module_at('p0c_apk_nocache', ROOT / 'source/nocache/apk_nocache.py')
    required = [nocache.JDK / 'java.exe', nocache.JDK / 'javac.exe',
                nocache.BT / 'aapt.exe', nocache.BT / 'zipalign.exe',
                nocache.BT / 'apksigner.bat', nocache.BT / 'lib/apksigner.jar',
                nocache.BT / 'lib/d8.jar', nocache.ANDROID_JAR,
                nocache.SMALI_LIB / 'baksmali.jar', nocache.SMALI_LIB / 'smali.jar',
                nocache.KS, nocache.SRC]
    for path in required:
        if not path.is_file():
            raise FileNotFoundError(path)
    setup_nocache(nocache, ROOT, create=create_work)
    provenance = verify_p13(BASE, BASE_SHA, BASE_SWF, BASE_SWF_SHA, PROVENANCE_LOCKS, nocache.BT)
    assert nocache.manifest_uuid(BASE) == provenance['uniqueappversionid']
    packager = module_at('p0c_inherited_packager', ROOT / 'source/packaging/build_apks.py')
    packager.NOCACHE_ROOT = ROOT / 'source/nocache'
    packager.VERSION_CODE = VERSION_CODE
    profile = packager.PROFILES['local']
    profile['bases'] = {'x86': (BASE, BASE_SHA)}
    profile['base_version'] = provenance['version_code']
    return packager, nocache, provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--swf', type=Path, default=SWF)
    parser.add_argument('--swf-sha256')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check-only', action='store_true')
    mode.add_argument('--preflight-only', action='store_true')
    args = parser.parse_args()
    packager, nocache, provenance = dependencies()
    if args.preflight_only:
        print(json.dumps({'status': 'fixed_dependencies_verified_no_build',
                          'base': str(BASE), 'base_sha256': BASE_SHA,
                          'base_swf_sha256': BASE_SWF_SHA, 'provenance': provenance,
                          'version_code': VERSION_CODE, 'default_swf': str(SWF), 'target': str(TARGET)}))
        return
    if not args.swf_sha256:
        parser.error('--swf-sha256 is required except for --preflight-only')
    source = checked_path(args.swf, ROOT).resolve()
    require_hash(source, args.swf_sha256.lower())
    swf = packager.validate_inputs(packager.PROFILES['local'], source, args.swf_sha256)
    assert sha(swf) != BASE_SWF_SHA, 'Refusing to package the unchanged p13 SWF'
    if args.check_only:
        print(json.dumps({'status': 'inputs_verified_no_build', 'swf': str(source),
                          'swf_sha256': sha(swf), 'version_code': VERSION_CODE, 'target': str(TARGET)}))
        return
    for path in (TARGET, TARGET.with_suffix('.apk.idsig'), REPORT):
        checked_path(path, ROOT)
        if path.exists():
            raise FileExistsError(f'Refusing to replace an existing delivery: {path}')
    assert not list((ROOT / 'apk').glob('*.apk')), 'Only one final APK is authorized'
    target = output_path(TARGET, ROOT)
    receipt = nocache.refresh(BASE, target, version_code=VERSION_CODE, swf_bytes=swf)
    # No operation after refresh mutates the APK.
    evidence = verify_package(BASE, target, swf, 'com.leiting.wf', VERSION_CODE, packager.BT)
    from verify_package_p0c import final_review
    review = final_review(BASE, target, source, receipt, evidence, nocache, VERSION_CODE)
    dependencies(create_work=False)
    sources = [Path(__file__), ROOT / 'source/verify_package_p0c.py',
               ROOT / 'source/package_support.py', *(ROOT / name for name in SOURCE_LOCKS),
               *(P13 / name for name in PROVENANCE_LOCKS)]
    report = {'status': 'passed', 'profile': 'local', 'variant': 'x86',
              'version_code': VERSION_CODE, 'base': str(BASE), 'base_sha256': BASE_SHA,
              'base_swf': str(BASE_SWF), 'base_swf_sha256': BASE_SWF_SHA,
              'base_provenance': provenance, 'swf': str(source), 'swf_sha256': sha(swf),
              'apk': str(target), 'apk_sha256': sha(target.read_bytes()), 'receipt': receipt,
              'verification': evidence, 'readback': review,
              'last_mutating_step': 'build-p0c/source/nocache/apk_nocache.py refresh (hash locked)',
              'runtime_verified': False, 'device_accessed': False, 'deployed': False,
              'sources': {str(p): sha(p.read_bytes()) for p in sources}}
    output_path(REPORT, ROOT).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps({'status': 'passed', 'apk': str(target),
                      'sha256': report['apk_sha256'], 'version_code': VERSION_CODE,
                      'uniqueappversionid': receipt['build_id'], 'report': str(REPORT)}))


if __name__ == '__main__':
    main()
