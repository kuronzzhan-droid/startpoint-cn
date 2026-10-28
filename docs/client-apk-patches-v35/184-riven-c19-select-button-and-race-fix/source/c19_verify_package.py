"""Read-only C19 endpoint and offline-validation gates for local packaging."""
import json
import zipfile
import zlib

from bootstrap import ROOT, C18, BASE_SHA, require_hash, sha
from c19_config import ADMISSION_BUILD, SWF, HTTP_CDN_ENDPOINT
from package_support import checked_path

REVISED_C19 = {
    'c19_select': 'c19-select-results.json',
    'c19_race': 'c19-race-results.json',
    'c19_ui': 'c19-ui-results.json',
    'c19_modal': 'c19-modal-results.json',
    'c19_ui_hit': 'c19-ui-hit-results.json',
    'c19_soul': 'c19-soul-results.json',
}


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



def verify_box_results(expected_sha):
    path = ROOT / 'audit/c15-compat/box-button-results.json'
    result = json.loads(path.read_text('utf-8'))
    assert result['status'] == 'passed' and result['swf_sha256'] == expected_sha
    assert result['case_count'] == 13
    return {'report': str(path), 'sha256': sha(path.read_bytes()),
            'case_count': result['case_count'], 'swf_sha256': expected_sha}


def verify_validation_sources(results):
    folder = ROOT / 'validation'
    sources = {p.name: sha(p.read_bytes()) for p in sorted(folder.glob('*.py'))}
    assert results['validation_source_sha256'] == sources, 'Validation sources changed after regression'
    expected_fixtures = {'p0-mapping.json', 'official-carrier-rows.json', 'login-load-fixture.json',
                        'c14-real-card-fixture.json', 'c14-real-card-provenance.json',
                        'c17-affix-catalog.json', 'c17-affix-keys.lock.json'}
    assert set(results['fixture_sha256']) == expected_fixtures
    for name, expected in results['fixture_sha256'].items():
        require_hash(folder / name, expected)
        assert (folder / name).read_bytes() == (C18 / 'validation' / name).read_bytes()
    changes_path = folder / 'validation-source-changes.json'
    changes = json.loads(changes_path.read_text('utf-8'))
    assert changes['status'] == 'passed' and changes['inherited_fixtures_unchanged']
    assert changes['baseline_suite_count'] == 52 and changes['baseline_case_count'] == 1260
    actual_changed = set()
    inherited = list((C18 / 'validation').glob('*.py'))
    assert changes['inherited_file_count'] == len(inherited)
    for before in inherited:
        after = folder / before.name
        assert after.is_file(), ('Inherited validation removed', before.name)
        if before.read_bytes() != after.read_bytes():
            actual_changed.add(before.name)
            row = changes['changed'][before.name]
            require_hash(before, row['before_sha256'])
            require_hash(after, row['after_sha256'])
    assert actual_changed == set(changes['changed'])
    added = {p.name: sha(p.read_bytes()) for p in folder.glob('*.py')
             if not (C18 / 'validation' / p.name).exists()}
    assert changes['added'] == added
    return {'report': str(changes_path), 'sha256': sha(changes_path.read_bytes()),
            'current_source_file_count': len(sources), 'fixture_count': len(expected_fixtures)}


def verify_offline_results(expected_sha, baseline_cases=1260):
    path = ROOT / 'validation/all-results.json'
    results = json.loads(path.read_text('utf-8'))
    assert results['status'] == 'passed'
    assert results['swf'] == str(SWF) and results['swf_sha256'] == expected_sha
    baseline_path = C18 / 'validation/all-results.json'
    locks = json.loads((ROOT / 'audit/input-lock.json').read_text('utf-8'))['inputs']
    require_hash(baseline_path, locks[str(baseline_path)]['sha256'])
    baseline = json.loads(baseline_path.read_text('utf-8'))
    assert baseline['case_count'] == baseline_cases == 1260
    assert results['case_count'] > baseline_cases
    assert len(baseline['suites']) == 52
    assert set(results['suites']) == set(baseline['suites']) | set(REVISED_C19)
    assert 'c19_pending' not in results['suites'], 'Withdrawn pending repair suite is not C19 acceptance'
    assert results['inherited_case_count'] == baseline_cases
    for name, report in REVISED_C19.items():
        assert results['suites'][name]['report'] == report
        assert results['suites'][name]['case_count'] > 0
    assert results['suites']['c19_select']['case_count'] == 12
    for name, suite in baseline['suites'].items():
        assert results['suites'][name]['case_count'] == suite['case_count'], name
    assert sum(suite['case_count'] for suite in results['suites'].values()) == results['case_count']
    for suite in results['suites'].values():
        assert suite['status'] == 'passed' and suite['swf_sha256'] == expected_sha
        result_path = checked_path(ROOT / 'validation' / suite['report'], ROOT)
        require_hash(result_path, suite['report_sha256'])
        detail = json.loads(result_path.read_text('utf-8'))
        for key in ('status', 'swf_sha256', 'case_count'):
            assert detail[key] == suite[key], (suite['report'], key)
    startup_path = ROOT / 'validation/startup-flow-results.json'
    startup = json.loads(startup_path.read_text('utf-8'))
    assert startup['status'] == 'passed' and startup['swf_sha256'] == expected_sha
    assert startup['case_count'] == 16
    c15_startup = results['suites']['c15_startup']
    c15_getters = results['suites']['c15_getters']
    assert c15_startup['case_count'] == 7 and c15_getters['case_count'] == 10
    source_review = verify_validation_sources(results)
    return {'report': str(path), 'sha256': sha(path.read_bytes()),
            'swf_sha256': expected_sha, 'case_count': results['case_count'],
            'suite_count': len(results['suites']), 'startup_report': str(startup_path),
            'startup_report_sha256': sha(startup_path.read_bytes()),
            'startup_case_count': startup['case_count'],
            'c15_startup_case_count': c15_startup['case_count'],
            'c15_getter_case_count': c15_getters['case_count'],
            'validation_sources': source_review,
            'revised_c19_suite_names': sorted(REVISED_C19)}
