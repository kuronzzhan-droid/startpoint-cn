"""Seal a verified local C22 delivery without mutating the APK."""
import json
from pathlib import Path
from bootstrap import ROOT, WORKSPACE, C21, FINAL, require_hash, sha, write_json, output_path
from c22_config import APK, PACKAGE_REPORT, VERSION_CODE, ADMISSION_BUILD
from c22_verify_package import verify_offline_results, verify_box_results
from c22_catalog import CATALOG_ID
from c22_catalog_build import verify_locked


def read(path):
    return json.loads(path.read_text('utf-8-sig'))


def main():
    build = read(ROOT / 'audit/build.json')
    package = read(PACKAGE_REPORT)
    independent = read(ROOT / 'audit/c22-independent/independent-c22.json')
    assert all(row['status'] == 'passed' for row in (build, package, independent))
    digest = require_hash(FINAL, build['sha256'])
    assert digest == package['swf_sha256'] == independent['swf_sha256']
    tests = verify_offline_results(digest)
    assert package['offline_validation'] == tests
    assert package['native_button_validation'] == verify_box_results(digest)
    apk_digest = require_hash(APK, package['apk_sha256'])
    assert package['version_code'] == VERSION_CODE == 1008083
    assert package['admission_build'] == ADMISSION_BUILD
    assert package['readback']['uniqueappversionid'] == package['receipt']['build_id']
    assert build['build_mode'] == 'full_c22'
    assert not build['new_methods'] and not build['new_traits']
    assert not independent['new_methods'] and not independent['new_traits']
    assert independent['protected_method_count'] == 562
    for relative, expected in build['sources'].items():
        require_hash(ROOT / relative, expected)
    for filename, expected in package['sources'].items():
        require_hash(filename, expected)
    locked = read(ROOT / 'audit/input-lock.json')['inputs']
    for filename, expected in locked.items():
        path = Path(filename)
        assert path.stat().st_size == expected['bytes'], filename
        require_hash(path, expected['sha256'])
    c21_count = sum(Path(name).is_relative_to(C21) for name in locked)
    sources = [*(ROOT / 'source').rglob('*.py'), *(ROOT / 'validation').glob('*.py')]
    for path in sources:
        compile(path.read_text('utf-8-sig'), str(path), 'exec')
    catalog = read(ROOT / 'audit/types-consumer/catalog.json')
    verify_locked()
    assert catalog['status'] == 'passed' and catalog['catalog_id'] == CATALOG_ID
    for row in catalog['resources']:
        require_hash(ROOT / 'audit/types-consumer/catalog-resources' / row['logical'], row['sha256'])
        if 'archive' in row:
            require_hash(row['archive'], row['archive_sha256'])
    require_hash(catalog['manifest'], catalog['manifest_sha256'])
    write_json(ROOT / 'audit/input-preservation.json', {
        'status': 'passed', 'c21_file_count': c21_count, 'locked_file_count': len(locked),
        'inputs': locked, 'source_syntax_files': len(sources), 'all_locked_inputs_unchanged': True})
    report = WORKSPACE / 'C22-REPORT.md'
    content = report.read_text('utf-8')
    for value in (digest, apk_digest, package['receipt']['build_id'], ADMISSION_BUILD,
                  str(VERSION_CODE), '18001', CATALOG_ID, 'C22-PROTOCOL-CHANGES.md'):
        assert value in content, value
    excluded = {'C22-DELIVERY-MANIFEST.json', 'SHA256SUMS.txt'}
    files = [p for p in ROOT.rglob('*') if p.is_file() and p.name not in excluded
             and '__pycache__' not in p.parts and 'client' not in p.relative_to(ROOT).parts]
    files += [report, WORKSPACE / 'C22-PROTOCOL-CHANGES.md']
    regression = read(ROOT / 'validation/all-results.json')
    manifest = {'status': 'sealed', 'version_code': VERSION_CODE,
        'apk': str(APK), 'apk_sha256': apk_digest, 'swf_sha256': digest,
        'uniqueappversionid': package['receipt']['build_id'], 'admission_build': ADMISSION_BUILD,
        'catalog_id': CATALOG_ID, 'offline_cases_passed': regression['case_count'],
        'startup_cases_passed': tests['startup_case_count'],
        'c15_startup_cases_passed': tests['c15_startup_case_count'],
        'c15_getter_cases_passed': tests['c15_getter_case_count'],
        'changed_methods': build['changed_method_count'], 'protected_method_count': 562,
        'c21_preserved_file_count': c21_count,
        'scope': 'Local C22 client and offline tests; no device, server, DB, deployment or paid API.',
        'files': {p.relative_to(WORKSPACE).as_posix(): {
            'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in sorted(files)}}
    write_json(ROOT / 'C22-DELIVERY-MANIFEST.json', manifest)
    output_path(ROOT / 'SHA256SUMS.txt').write_text('\n'.join(
        f'{row["sha256"]}  {name}' for name, row in manifest['files'].items()) + '\n', 'utf-8')
    require_hash(APK, apk_digest)
    print(json.dumps({'status': 'sealed', 'files': len(files), 'c21_preserved_files': c21_count,
                      'version_code': VERSION_CODE, 'apk_sha256': apk_digest}))


if __name__ == '__main__':
    main()
