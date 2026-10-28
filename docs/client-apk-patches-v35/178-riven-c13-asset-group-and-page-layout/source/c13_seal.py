"""Verify C13 evidence and immutable C12 inputs, then seal the local delivery."""
import json
from bootstrap import ROOT, WORKSPACE, C12, FINAL, require_hash, sha, write_json, output_path
from c13_config import APK, PACKAGE_REPORT, VERSION_CODE, ADMISSION_BUILD
from c13_verify_package import verify_offline_results, verify_box_results


def read(path):
    return json.loads(path.read_text('utf-8-sig'))


def main():
    build = read(ROOT / 'audit/build.json')
    package = read(PACKAGE_REPORT)
    independent = read(ROOT / 'audit/c13/independent-c13.json')
    assert all(row['status'].startswith('passed') for row in (build, package, independent))
    digest = require_hash(FINAL, build['sha256'])
    assert digest == package['swf_sha256'] == independent['swf_sha256']
    tests = verify_offline_results(digest)
    assert package['offline_validation'] == tests
    assert package['native_button_validation'] == verify_box_results(digest)
    apk_digest = require_hash(APK, package['apk_sha256'])
    assert package['version_code'] == VERSION_CODE == 1008074
    assert package['admission_build'] == ADMISSION_BUILD
    assert package['readback']['uniqueappversionid'] == package['receipt']['build_id']
    assert build['build_mode'] == 'full_c13'
    assert not build['new_methods'] and not build['new_traits']
    assert not independent['new_methods'] and not independent['new_traits']
    assert independent['protected_method_count'] == 562
    for name, expected in independent['audit_source_sha256'].items():
        require_hash(ROOT / 'audit/c13' / name, expected)
    require_hash(ROOT / 'audit/c13/protected-method-hashes.json',
                 independent['protected_method_hashes_sha256'])
    for relative, expected in build['sources'].items():
        require_hash(ROOT / relative, expected)
    for filename, expected in package['sources'].items():
        require_hash(filename, expected)
    regression = read(ROOT / 'validation/all-results.json')
    for key in ('validation_source_sha256', 'fixture_sha256'):
        for name, expected in regression[key].items():
            require_hash(ROOT / 'validation' / name, expected)
    locked = read(ROOT / 'audit/input-lock.json')['inputs']
    c12_files = {str(p) for p in C12.rglob('*') if p.is_file()}
    assert c12_files == {name for name in locked if name.startswith(str(C12) + '\\')}
    preserved = [{'path': name, 'sha256': require_hash(name, row['sha256']), 'unchanged': True}
                 for name, row in locked.items()]
    sources = (list((ROOT / 'source').rglob('*.py')) + list((ROOT / 'validation').glob('*.py'))
               + list((ROOT / 'audit/c13').glob('*.py')))
    for path in sources:
        compile(path.read_text('utf-8-sig'), str(path), 'exec')
    write_json(ROOT / 'audit/input-preservation.json', {
        'status': 'passed', 'c12_file_count': len(c12_files), 'locked_file_count': len(preserved),
        'files': preserved, 'source_syntax_files': len(sources)})
    report = WORKSPACE / 'C13-REPORT.md'
    content = report.read_text('utf-8')
    for value in (digest, apk_digest, package['receipt']['build_id'], ADMISSION_BUILD,
                  str(VERSION_CODE), '18001'):
        assert value in content, value
    excluded = {'C13-DELIVERY-MANIFEST.json', 'SHA256SUMS.txt'}
    files = [p for p in ROOT.rglob('*') if p.is_file() and p.name not in excluded
             and '__pycache__' not in p.parts and 'client' not in p.relative_to(ROOT).parts]
    files.append(report)
    manifest = {'status': 'sealed', 'version_code': VERSION_CODE,
        'apk': str(APK), 'apk_sha256': apk_digest, 'swf_sha256': digest,
        'uniqueappversionid': package['receipt']['build_id'], 'admission_build': ADMISSION_BUILD,
        'offline_cases_passed': regression['case_count'],
        'startup_cases_passed': tests['startup_case_count'],
        'changed_methods': build['changed_method_count'], 'protected_method_count': 562,
        'c12_preserved_file_count': len(c12_files),
        'scope': 'Local C13 only; no device installation, deployment, git publication or paid API.',
        'files': {p.relative_to(WORKSPACE).as_posix(): {
            'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in sorted(files)}}
    write_json(ROOT / 'C13-DELIVERY-MANIFEST.json', manifest)
    output_path(ROOT / 'SHA256SUMS.txt').write_text('\n'.join(
        f'{row["sha256"]}  {name}' for name, row in manifest['files'].items()) + '\n', 'utf-8')
    require_hash(APK, apk_digest)
    print(json.dumps({'status': 'sealed', 'files': len(files), 'c12_preserved_files': len(c12_files),
                      'version_code': VERSION_CODE, 'apk_sha256': apk_digest}))


if __name__ == '__main__':
    main()
