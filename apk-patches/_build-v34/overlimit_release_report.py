"""Official O8-O12 r2 provenance and evidence-bound release notes."""
import json
from pathlib import Path

from build_common import ROOT, write_json
from release_report import artifact
from overlimit_release_notes import update_notes


def read(name):
    return json.loads((ROOT / name).read_text('utf-8'))


def include_diagnostic_evidence(report):
    name = 'verification/round6-diagnostic-switch.json'
    if not (ROOT / name).exists():
        return
    diagnostic = read(name)
    files = diagnostic.get('official_files', {})
    if (diagnostic.get('passed') and files.get('v34.swf') == report['swf']['sha256']
            and all(files.get(Path(row['output']['path']).name) == row['output']['sha256']
                    for row in report['variants'].values())
            and diagnostic.get('diagnostic_sha256') == report['o9_policy']['diagnostic_expected_sha256']):
        report['validation']['historical_diagnostic_switch'] = name


def extend_report(report, proof):
    sha = report['swf']['sha256']
    audit = read('audits/round6-source-audit.json')
    replay = read('work/overlimit-round6/source-replay-verification.json')
    archive = read('verification/v33-patches-preserved-o8-o12-r2.json')
    assert proof['passed'] and proof['swf_sha256'] == sha and proof['revision'] == 'r2'
    assert audit['passed'] and audit['final_swf_sha256'] == sha
    assert replay['passed'] and replay['r4_final_sha256'] == sha
    assert archive['output_swf_sha256'] == sha and not archive['method_evidence_failures']
    additional = []
    for number, folder in [(108, 'overlimit-owned-pedestal'), (109, 'overlimit-paradox-core-gate'),
                           (110, 'overlimit-two-cost-slots'), (111, 'overlimit-dialog-paradox-text')]:
        entry_path = f'apk-patches-additions/{number}-{folder}/entry.json'
        entry = read(entry_path)
        assert entry['final_swf_sha256'] == sha and entry['first_apk_version'] == 'v34'
        if number != 108:
            assert entry['revision'] == 'r2'
        additional.append({'archive': number, 'first_apk_version': 'v34',
                           'revision': entry.get('revision', 'O8 unchanged'),
                           'methods': entry['methods'], 'entry': entry_path,
                           'source_original_archive_number': entry['upstream_number']})
    patches = ['O8', 'O9', 'O10', 'O11', 'O12']
    report.update(official_patches=patches, additional_patches=additional,
                  overlimit_revision='r2', r1_O9_to_O12_obsolete=True,
                  overlimit_mode_predicate=['get_rarity()==5', 'overLimitStep>=4', 'get_maxOverLimitStep()>4'],
                  method_sha256_pins=proof['after_code_sha_pins'],
                  swf_variants={'official': {'artifact': artifact(ROOT / 'v34.swf'),
                                             'patches': patches, 'O9_retained': True, 'used_in_apks': True}},
                  zero_consumption_policy_cancelled=True,
                  o9_policy={'official_retained': True, 'archive_101_retained': True,
                             'legacy_diagnostic_command': 'python -B scripts/build_v34.py --without-O9',
                             'diagnostic_output': 'diagnostics/v34-without-O9.swf',
                             'diagnostic_expected_sha256': replay['historical_diagnostic_without_O9']['output_sha256'],
                             'diagnostic_is_candidate': False, 'diagnostic_builds_apk': False},
                  source_replay=replay,
                  previous_round5_r1_outputs='previous-build/round5-o8-o12-r1-versionCode1008002',
                  data_only_not_apk=['凉月觉醒入口：数据边，不在本次 APK 范围'])
    report['validation'].update({
        'round6_swf': 'verification/swf-o8-o12-r2-verification.json',
        'original_archive_method_evidence': 'verification/v33-patches-preserved-o8-o12-r2.json',
        'source_and_overlap': 'audits/round6-source-audit.json',
        'bytecode_semantics': 'audits/round6-bytecode-probes.json',
        'bytecode_cases': audit['total_cases'], 'negative_controls': audit['negative_controls'],
        'r4_targets_and_helpers_unchanged': True, 'O8_method_body_unchanged_from_round5': True,
        'only_O9_to_O12_method_bodies_changed_from_round5': True,
        'new_patch_verified_scope': '实际生产方法解码解释执行，受控 UI/库存/文案依赖；非 AIR/设备验收',
        'new_whole_swf_air_and_device_execution': '未核实'})
    include_diagnostic_evidence(report)
    write_json(ROOT / 'build-report.json', report)
    update_notes(report, replay, audit)
    return report
