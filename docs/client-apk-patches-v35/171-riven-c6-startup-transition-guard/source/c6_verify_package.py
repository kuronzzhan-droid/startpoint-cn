"""Read-only C6 endpoint and offline-validation gates for local packaging."""
import json
import zipfile
import zlib

from bootstrap import ROOT, BASE_SHA, require_hash, sha
from c6_config import ADMISSION_BUILD, SWF, HTTP_CDN_ENDPOINT
from package_support import checked_path


def validate_swf(source, expected):
    source = checked_path(source, ROOT)
    require_hash(source, expected)
    raw = source.read_bytes()
    assert raw[:3] == b'CWS'
    body = zlib.decompress(raw[8:])
    assert len(body) + 8 == int.from_bytes(raw[4:8], 'little')
    assert body.count(ADMISSION_BUILD.encode()) == 3
    assert body.count(HTTP_CDN_ENDPOINT.encode()) == 9
    for forbidden in ('<SERVER_HOST>:8001', '<SERVER_HOST>:8003',
                      '<ADMISSION_ID>', '<ADMISSION_ID>',
                      '<ADMISSION_ID>',
                      '<ADMISSION_ID>', '<SERVER_HOST>:8001'):
        assert forbidden.encode() not in body, forbidden
    assert sha(raw) != BASE_SHA
    return raw


def external_address_scan(apk):
    """Search exact old endpoints in every non-SWF ZIP member, including DEX/AXML."""
    from packaging_verify import SWF_ENTRY
    findings, scanned = [], 0
    with zipfile.ZipFile(apk) as archive:
        for info in archive.infolist():
            if info.is_dir() or info.filename == SWF_ENTRY:
                continue
            data = archive.read(info)
            scanned += 1
            for endpoint in ('<SERVER_HOST>:8001', '<SERVER_HOST>:8003'):
                for encoding in ('utf-8', 'utf-16le', 'utf-16be'):
                    count = data.count(endpoint.encode(encoding))
                    if count:
                        findings.append({'member': info.filename, 'endpoint': endpoint,
                                         'encoding': encoding, 'occurrences': count})
    assert not findings, f'Old local endpoints outside SWF: {findings}'
    return {'status': 'passed', 'apk_sha256': sha(apk.read_bytes()),
            'scanned_non_swf_members': scanned, 'old_endpoint_findings': findings,
            'encodings': ['utf-8', 'utf-16le', 'utf-16be']}


def verify_offline_results(expected_sha, baseline_cases=498):
    path = ROOT / 'validation/all-results.json'
    results = json.loads(path.read_text('utf-8'))
    assert results['status'] == 'passed'
    assert results['swf'] == str(SWF) and results['swf_sha256'] == expected_sha
    assert results['case_count'] >= baseline_cases == 498
    assert len(results['suites']) >= 18
    assert sum(suite['case_count'] for suite in results['suites'].values()) == results['case_count']
    for suite in results['suites'].values():
        assert suite['status'] == 'passed' and suite['swf_sha256'] == expected_sha
        result_path = checked_path(ROOT / 'validation' / suite['report'], ROOT)
        require_hash(result_path, suite['report_sha256'])
    startup_path = ROOT / 'validation/startup-flow-results.json'
    startup = json.loads(startup_path.read_text('utf-8'))
    assert startup['status'] == 'passed' and startup['swf_sha256'] == expected_sha
    assert startup['case_count'] > 0
    return {'report': str(path), 'sha256': sha(path.read_bytes()),
            'swf_sha256': expected_sha, 'case_count': results['case_count'],
            'suite_count': len(results['suites']), 'startup_report': str(startup_path),
            'startup_report_sha256': sha(startup_path.read_bytes()),
            'startup_case_count': startup['case_count']}
