"""Bind the completed report, APK, SWF, checks, and reproducible source hashes."""
import json
from pathlib import Path

from bootstrap import ROOT, P0, FINAL, sha, write_json


def main():
    required = {
        'build': 'audit/build.json',
        'independent_audit': 'independent-audit/final-audit.json',
        'tests': 'validation-p0a/all-regression-results.json',
        'package': 'build-audit/riven-p0c-apk-final.json',
        'preservation': 'audit/input-preservation.json',
    }
    results = {key: json.loads((ROOT / relative).read_text('utf-8'))
               for key, relative in required.items()}
    assert all(value['status'] == 'passed' for value in results.values())
    swf_hash = sha(FINAL.read_bytes())
    assert results['build']['sha256'] == swf_hash
    assert results['tests']['swf_sha256'] == swf_hash
    assert results['package']['swf_sha256'] == swf_hash
    audit = results['independent_audit']
    assert audit['inputs'][2]['sha256'] == swf_hash
    assert audit['approved_pushstring_operand_relocations'] == 15
    assert audit['changed_code_bytes_relative_to_p0b'] == 15
    assert audit['non_target_complete_records_equal'] == 92767
    assert audit['protected_total'] == 562
    assert audit['restoring_five_bodies_and_removing_six_strings_recovers_p13_abc_byte_exact']
    assert results['tests']['case_count'] == 273
    assert results['tests']['official_level_samples'] == 400
    assert results['package']['version_code'] == 1008051
    assert results['preservation']['preserved_p13_file_count'] == 247
    assert results['preservation']['preserved_p0_file_count'] == 185
    apk = Path(results['package']['apk'])
    assert apk.resolve().is_relative_to(ROOT.resolve())
    apk_hash = sha(apk.read_bytes())
    assert results['package']['apk_sha256'] == apk_hash
    final_report = P0 / 'P0C-REPORT.md'
    report_text = final_report.read_text('utf-8')
    for value in (swf_hash, apk_hash, results['package']['receipt']['build_id']):
        assert value in report_text
    assert '等待字符串索引重定位决定' not in report_text
    files = {final_report, FINAL, apk, *(ROOT / name for name in required.values())}
    for folder in ('source', 'audit', 'independent-audit', 'validation-p0a',
                   'validation-p0b', 'typepacker-audit', 'build-audit'):
        for path in (ROOT / folder).rglob('*'):
            if path.is_file() and path.suffix in ('.py', '.java', '.md', '.json', '.txt', '.tsv'):
                files.add(path)
    if apk.with_suffix('.apk.idsig').is_file():
        files.add(apk.with_suffix('.apk.idsig'))
    manifest = {
        'status': 'sealed', 'swf_sha256': swf_hash, 'apk_sha256': apk_hash,
        'version_code': 1008051,
        'uniqueappversionid': results['package']['receipt']['build_id'],
        'scope': 'Local artifacts and offline evidence; no device install or deployment.',
        'files': {path.relative_to(P0).as_posix():
                  {'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
                  for path in sorted(files)},
    }
    write_json(ROOT / 'P0C-DELIVERY-MANIFEST.json', manifest)
    sums = ''.join(f'{sha(path.read_bytes())}  {path.relative_to(P0).as_posix()}\n'
                   for path in (FINAL, apk, final_report))
    (ROOT / 'SHA256SUMS.txt').write_text(sums, 'utf-8')
    print(json.dumps({'status': 'sealed', 'files': len(files), 'swf_sha256': swf_hash,
                      'apk_sha256': apk_hash, 'version_code': 1008051}))


if __name__ == '__main__':
    main()
