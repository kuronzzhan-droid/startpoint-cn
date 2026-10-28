"""Verify C9 evidence and immutable C8 inputs, then seal the local delivery."""
import json
from bootstrap import ROOT, WORKSPACE, C8, FINAL, require_hash, sha, write_json, output_path
from c9_config import APK, PACKAGE_REPORT, VERSION_CODE, ADMISSION_BUILD
from c9_verify_package import verify_offline_results


def read(path):
    return json.loads(path.read_text('utf-8-sig'))


def main():
    build = read(ROOT / 'audit/build.json')
    package = read(PACKAGE_REPORT)
    independent = read(ROOT / 'audit/independent-c9.json')
    assert all(row['status'].startswith('passed') for row in (build, package, independent))
    digest = require_hash(FINAL, build['sha256'])
    assert digest == package['swf_sha256'] == independent['swf_sha256']
    tests = verify_offline_results(digest)
    assert package['offline_validation'] == tests
    apk_digest = require_hash(APK, package['apk_sha256'])
    assert package['version_code'] == VERSION_CODE == 1008070
    assert package['admission_build'] == ADMISSION_BUILD
    assert package['readback']['uniqueappversionid'] == package['receipt']['build_id']
    assert not build['new_methods'] and not build['new_traits']
    assert not independent['new_methods'] and not independent['new_traits']
    assert independent['protected_method_count'] == 562
    for name, expected in independent['audit_source_sha256'].items():
        require_hash(ROOT / 'audit/c9' / name, expected)
    require_hash(ROOT / 'audit/c9/protected-method-hashes.json',
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
    c8_files = {str(p) for p in C8.rglob('*') if p.is_file()}
    assert c8_files == {name for name in locked if name.startswith(str(C8) + '\\')}
    preserved = [{'path': name, 'sha256': require_hash(name, row['sha256']), 'unchanged': True}
                 for name, row in locked.items()]
    sources = (list((ROOT / 'source').rglob('*.py')) + list((ROOT / 'validation').glob('*.py'))
               + list((ROOT / 'audit/c9').glob('*.py')))
    for path in sources:
        compile(path.read_text('utf-8-sig'), str(path), 'exec')
    write_json(ROOT / 'audit/input-preservation.json', {
        'status': 'passed', 'c8_file_count': len(c8_files), 'locked_file_count': len(preserved),
        'files': preserved, 'source_syntax_files': len(sources)})
    report = WORKSPACE / 'C9-REPORT.md'
    content = report.read_text('utf-8')
    for value in (digest, apk_digest, package['receipt']['build_id'], ADMISSION_BUILD,
                  str(VERSION_CODE), '18001'):
        assert value in content, value
    excluded = {'C9-DELIVERY-MANIFEST.json', 'SHA256SUMS.txt'}
    files = [p for p in ROOT.rglob('*') if p.is_file() and p.name not in excluded
             and '__pycache__' not in p.parts and 'client' not in p.relative_to(ROOT).parts]
    files.append(report)
    manifest = {'status': 'sealed', 'version_code': VERSION_CODE,
        'apk': str(APK), 'apk_sha256': apk_digest, 'swf_sha256': digest,
        'uniqueappversionid': package['receipt']['build_id'], 'admission_build': ADMISSION_BUILD,
        'offline_cases_passed': regression['case_count'],
        'startup_cases_passed': tests['startup_case_count'],
        'changed_methods': build['changed_method_count'], 'protected_method_count': 562,
        'c8_preserved_file_count': len(c8_files),
        'scope': 'Local C9 only; no device installation, deployment, git publication or paid API.',
        'files': {p.relative_to(WORKSPACE).as_posix(): {
            'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in sorted(files)}}
    write_json(ROOT / 'C9-DELIVERY-MANIFEST.json', manifest)
    output_path(ROOT / 'SHA256SUMS.txt').write_text('\n'.join(
        f'{row["sha256"]}  {name}' for name, row in manifest['files'].items()) + '\n', 'utf-8')
    require_hash(APK, apk_digest)
    print(json.dumps({'status': 'sealed', 'files': len(files), 'c8_preserved_files': len(c8_files),
                      'version_code': VERSION_CODE, 'apk_sha256': apk_digest}))


if __name__ == '__main__':
    main()
