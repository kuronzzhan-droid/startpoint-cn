"""Verify C5 receipts and original-file preservation, then seal local artifacts."""
import json
from bootstrap import ROOT, WORKSPACE, C4, FINAL, require_hash, sha, write_json, output_path
from c5_config import APK, PACKAGE_REPORT, VERSION_CODE, ADMISSION_BUILD


def read(path):
    return json.loads(path.read_text('utf-8-sig'))


def main():
    build = read(ROOT / 'audit/build.json')
    tests = read(ROOT / 'validation/all-results.json')
    package = read(PACKAGE_REPORT)
    independent = read(ROOT / 'audit/independent-c5.json')
    lifecycle = read(ROOT / 'validation/requests-independent-review.json')
    addresses = read(ROOT / 'audit/address-audit.json')
    assert all(row['status'].startswith('passed') for row in
               (build, tests, package, independent, lifecycle, addresses))
    digest = require_hash(FINAL, build['sha256'])
    assert digest == tests['swf_sha256'] == package['swf_sha256']
    assert digest == independent['swf_sha256'] == lifecycle['swf_sha256']
    apk_digest = require_hash(APK, package['apk_sha256'])
    assert package['version_code'] == VERSION_CODE == 1008056
    assert tests['case_count'] == 498 and len(tests['suites']) == 18
    assert package['readback']['uniqueappversionid'] == package['receipt']['build_id']
    assert build['changed_method_count'] == 0
    require_hash(ROOT / 'source/c5_review.py', independent['review_source_sha256'])
    assert independent['whole_uncompressed_swf_reversal_byte_exact']
    assert independent['protected_method_count'] == 562
    assert addresses['baseline_swf']['sha256'] == build['baseline_sha256']
    assert addresses['baseline_apk']['sha256'] == package['base_provenance']['sha256']
    for relative, expected in build['sources'].items():
        require_hash(ROOT / relative, expected)
    for filename, expected in package['sources'].items():
        require_hash(filename, expected)
    for name, expected in tests['validation_source_sha256'].items():
        require_hash(ROOT / 'validation' / name, expected)
    for name, expected in tests['fixture_sha256'].items():
        require_hash(ROOT / 'validation' / name, expected)
    for result in tests['suites'].values():
        require_hash(ROOT / 'validation' / result['report'], result['report_sha256'])
    locked = read(ROOT / 'audit/input-lock.json')['inputs']
    c4_files = {str(p) for p in C4.rglob('*') if p.is_file()}
    assert c4_files == {name for name in locked if name.startswith(str(C4) + '\\')}
    preserved = [{'path': name, 'sha256': require_hash(name, row['sha256']), 'unchanged': True}
                 for name, row in locked.items()]
    sources = list((ROOT / 'source').rglob('*.py')) + list((ROOT / 'validation').glob('*.py'))
    for path in sources:
        compile(path.read_text('utf-8-sig'), str(path), 'exec')
    write_json(ROOT / 'audit/input-preservation.json', {
        'status': 'passed', 'c4_file_count': len(c4_files), 'locked_file_count': len(preserved),
        'files': preserved, 'source_syntax_files': len(sources)})
    report = WORKSPACE / 'C5-REPORT.md'
    content = report.read_text('utf-8')
    for value in (digest, apk_digest, package['receipt']['build_id'], ADMISSION_BUILD,
                  str(VERSION_CODE), '498', '18001', '18003'):
        assert value in content, value
    excluded = {'C5-DELIVERY-MANIFEST.json', 'SHA256SUMS.txt'}
    files = [p for p in ROOT.rglob('*') if p.is_file() and p.name not in excluded
             and '__pycache__' not in p.parts and 'client' not in p.relative_to(ROOT).parts]
    files.append(report)
    manifest = {'status': 'sealed', 'version_code': VERSION_CODE,
        'apk': str(APK), 'apk_sha256': apk_digest, 'swf_sha256': digest,
        'uniqueappversionid': package['receipt']['build_id'], 'admission_build': ADMISSION_BUILD,
        'offline_cases_passed': tests['case_count'], 'changed_methods': 0,
        'address_literal_count': 9, 'admission_literal_count': 3, 'protected_method_count': 562,
        'c4_preserved_file_count': len(c4_files),
        'scope': 'Local C5 only; no device installation, deployment, git publication or paid API.',
        'files': {p.relative_to(WORKSPACE).as_posix(): {
            'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in sorted(files)}}
    write_json(ROOT / 'C5-DELIVERY-MANIFEST.json', manifest)
    output_path(ROOT / 'SHA256SUMS.txt').write_text('\n'.join(
        f'{row["sha256"]}  {name}' for name, row in manifest['files'].items()) + '\n', 'utf-8')
    require_hash(APK, apk_digest)
    print(json.dumps({'status': 'sealed', 'files': len(files), 'c4_preserved_files': len(c4_files),
                      'version_code': VERSION_CODE, 'apk_sha256': apk_digest}))


if __name__ == '__main__':
    main()
