"""Verify final receipts, preserve every C1 input, and seal the C2 delivery."""
import json
from bootstrap import ROOT, WORKSPACE, FINAL, require_hash, sha, write_json, output_path
from c2_config import VERSION_CODE, APK, PACKAGE_REPORT


def read(path):
    return json.loads(path.read_text('utf-8'))


def main():
    build = read(ROOT / 'audit/build.json')
    tests = read(ROOT / 'validation/all-results.json')
    independent = read(ROOT / 'audit/independent-c2.json')
    package = read(PACKAGE_REPORT)
    assert all(r['status'] == 'passed' for r in (build, tests, package))
    assert independent['status'] == 'passed_no_new_material_findings'
    swf_sha = require_hash(FINAL, build['sha256'])
    assert swf_sha == tests['swf_sha256'] == independent['swf_sha256'] == package['swf_sha256']
    apk_sha = require_hash(APK, package['apk_sha256'])
    assert package['version_code'] == VERSION_CODE
    assert package['readback']['uniqueappversionid'] == package['receipt']['build_id']
    for relative, expected in build['sources'].items():
        require_hash(ROOT / relative, expected)
    for relative, expected in independent['reviewed_source_sha256'].items():
        require_hash(ROOT / relative, expected)
    for filename, expected in package['sources'].items():
        require_hash(filename, expected)
    for name, expected in tests['validation_source_sha256'].items():
        require_hash(ROOT / 'validation' / name, expected)
    for name, expected in tests['fixture_sha256'].items():
        require_hash(ROOT / 'validation' / name, expected)
    for result in tests['suites'].values():
        require_hash(ROOT / 'validation' / result['report'], result['report_sha256'])
    inputs = read(ROOT / 'audit/input-lock.json')['inputs']
    preserved = [{'path': filename, 'sha256': require_hash(filename, row['sha256']), 'unchanged': True}
                 for filename, row in inputs.items()]
    syntax_files = list((ROOT / 'source').rglob('*.py')) + list((ROOT / 'validation').glob('*.py'))
    for path in syntax_files:
        compile(path.read_text('utf-8-sig'), str(path), 'exec')
    write_json(ROOT / 'audit/input-preservation.json', {
        'status': 'passed', 'c1_input_file_count': len(preserved), 'input_files': preserved,
        'source_syntax_files': len(syntax_files)})
    report = WORKSPACE / 'C2-REPORT.md'
    content = report.read_text('utf-8')
    assert all(value in content for value in (swf_sha, apk_sha, package['receipt']['build_id']))
    assert str(tests['case_count']) in content and str(VERSION_CODE) in content
    excluded = {'C2-DELIVERY-MANIFEST.json', 'SHA256SUMS.txt'}
    files = [p for p in ROOT.rglob('*') if p.is_file() and p.name not in excluded
             and '__pycache__' not in p.parts and 'client' not in p.relative_to(ROOT).parts]
    files.append(report)
    manifest = {'status': 'sealed', 'version_code': VERSION_CODE,
                'apk': str(APK), 'apk_sha256': apk_sha, 'swf_sha256': swf_sha,
                'uniqueappversionid': package['receipt']['build_id'],
                'offline_cases_passed': tests['case_count'], 'changed_methods': build['changed_method_count'],
                'protected_method_count': 562, 'c1_preserved_files': len(preserved),
                'admission_transport_build': '<ADMISSION_ID>',
                'admission_transport_build_is_unique_to_c2': False,
                'scope': 'Local C2 artifacts only; no device installation, server deployment, git publication or paid API.',
                'files': {str(p.relative_to(WORKSPACE)).replace('\\', '/'): {
                    'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in sorted(files)}}
    write_json(ROOT / 'C2-DELIVERY-MANIFEST.json', manifest)
    output_path(ROOT / 'SHA256SUMS.txt').write_text('\n'.join(
        f'{row["sha256"]}  {name}' for name, row in manifest['files'].items()) + '\n', 'utf-8')
    assert sha(APK.read_bytes()) == apk_sha
    print(json.dumps({'status': 'sealed', 'files': len(files), 'offline_cases': tests['case_count'],
                      'version_code': VERSION_CODE, 'apk_sha256': apk_sha,
                      'uniqueappversionid': package['receipt']['build_id']}))


if __name__ == '__main__':
    main()
