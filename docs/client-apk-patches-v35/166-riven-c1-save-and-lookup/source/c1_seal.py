"""Read back final evidence, preserve upstream inputs, and seal the C1 delivery."""
import json
from pathlib import Path
from bootstrap import ROOT, WORKSPACE, FINAL, require_hash, sha, write_json, output_path
from c1_config import VERSION_CODE, APK, PACKAGE_REPORT


def load(path):
    return json.loads(path.read_text('utf-8-sig'))


def main():
    build = load(ROOT / 'audit/build.json')
    tests = load(ROOT / 'validation/all-results.json')
    independent = load(ROOT / 'audit/independent-c1.json')
    package = load(PACKAGE_REPORT)
    assert all(x['status'] == 'passed' for x in (build, tests, independent, package))
    swf_sha = require_hash(FINAL, build['sha256'])
    assert swf_sha == tests['swf_sha256'] == independent['swf_sha256'] == package['swf_sha256']
    apk_sha = require_hash(APK, package['apk_sha256'])
    assert package['version_code'] == VERSION_CODE
    assert package['readback']['uniqueappversionid'] == package['receipt']['build_id']
    for relative, expected in build['sources'].items():
        require_hash(ROOT / relative, expected)
    for filename, expected in package['sources'].items():
        require_hash(filename, expected)
    for filename, expected in tests['validation_source_sha256'].items():
        require_hash(ROOT / 'validation' / filename, expected)
    for filename, expected in tests['fixture_sha256'].items():
        require_hash(ROOT / 'validation' / filename, expected)
    locked = load(ROOT / 'audit/input-lock.json')['inputs']
    preserved = [{'path': filename, 'sha256': require_hash(filename, row['sha256']), 'unchanged': True}
                 for filename,row in locked.items()]
    syntax_files = list((ROOT / 'source').rglob('*.py')) + list((ROOT / 'validation').glob('*.py'))
    for p in syntax_files:
        compile(p.read_text('utf-8-sig'), str(p), 'exec')
    write_json(ROOT / 'audit/input-preservation.json', {
        'status': 'passed', 'input_files': preserved, 'source_syntax_files': len(syntax_files)})
    report = WORKSPACE / 'C1-REPORT.md'
    content = report.read_text('utf-8')
    assert apk_sha in content and swf_sha in content and package['receipt']['build_id'] in content
    assert '108' in content and '<ADMISSION_ID>' in content
    excluded = {'C1-DELIVERY-MANIFEST.json', 'SHA256SUMS.txt'}
    files = [p for p in ROOT.rglob('*') if p.is_file() and p.name not in excluded
             and '__pycache__' not in p.parts and 'client' not in p.relative_to(ROOT).parts]
    files.append(report)
    manifest = {
        'status': 'sealed', 'version_code': VERSION_CODE, 'apk': str(APK), 'apk_sha256': apk_sha,
        'swf_sha256': swf_sha, 'uniqueappversionid': package['receipt']['build_id'],
        'admission_transport_build': '<ADMISSION_ID>',
        'admission_transport_build_is_unique_to_c1': False, 'offline_cases_passed': tests['case_count'],
        'scope': 'Local C1 artifacts; no device install, server configuration/deployment or git publication.',
        'files': {str(p.relative_to(WORKSPACE)).replace('\\','/'): {
            'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in sorted(files)}}
    write_json(ROOT / 'C1-DELIVERY-MANIFEST.json', manifest)
    sums = '\n'.join(f"{row['sha256']}  {name}" for name,row in manifest['files'].items()) + '\n'
    output_path(ROOT / 'SHA256SUMS.txt').write_text(sums, 'utf-8')
    assert sha(APK.read_bytes()) == apk_sha
    print(json.dumps({'status': 'sealed', 'files': len(files), 'offline_cases': tests['case_count'],
                      'apk_sha256': apk_sha, 'version_code': VERSION_CODE,
                      'uniqueappversionid': package['receipt']['build_id']}))


if __name__ == '__main__':
    main()
