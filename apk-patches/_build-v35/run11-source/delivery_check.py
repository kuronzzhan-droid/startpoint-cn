"""核对正式SWF、P-code、源码归档、十一轮累计登记和本次验收证据。"""
import json
import re
from bootstrap import ROOT, BASE_SHA, output_path, check_baseline
from framework import sha
from common import listing
from swfabc import SwfAbc
import bodies
from make_registry import ENTRIES, implementation_group
from make_archive import archive_sources
from source_guard import verify as verify_readonly
from verify import source_locks, source_manifest
from task_contract import verify as verify_task, PRE_CT_SWF_SHA


def read(name):
    return json.loads((ROOT/name).read_text(encoding='utf-8'))


def pcode(digest):
    manifest = read('final-pcode/manifest.json')
    release = read('release-locks.json')
    assert release['baseline_swf_sha256'] == BASE_SHA and release['output_swf_sha256'] == digest
    assert set(release['methods']) == {row['label'] for row in manifest}
    assert {p.name for p in (ROOT/'final-pcode').glob('*.pcode.txt')} == {row['file'] for row in manifest}
    abcs = {}
    for row in manifest:
        if row['abc'] not in abcs:
            abcs[row['abc']] = SwfAbc(ROOT/'v35k.swf', tag=row['abc'].encode()).abc
        abc = abcs[row['abc']]
        index = bodies.resolve(abc, row['label'])
        body = abc.bodies[index]
        assert index == row['body'] and sha(body[5]) == row['code_sha256'] and body[1:5] == row['header']
        lock = release['methods'][row['label']]
        assert lock['after'] == sha(body[5]) and lock['after_header'] == body[1:5]
        lines = [f'# {row["label"]}; body={index}; code_sha256={sha(body[5])}; header={body[1:5]}',
                 f'# exceptions={body[6]}', *listing(abc, body[5])]
        assert (ROOT/'final-pcode'/row['file']).read_text(encoding='utf-8') == '\n'.join(lines)+'\n'
    return len(manifest)


def registry(digest):
    old = json.loads((ROOT.parent/'run10/registry-draft.json').read_text(encoding='utf-8'))
    now = read('registry-draft.json')
    assert now['requirement_decisions'] == verify_task(), '累计登记与裁定不一致'
    assert now['verification_status'] == 'pass' and 'blocker' not in now
    assert now['external_readonly_ack'] == 'task-evidence/known-external-changes.json'
    groups = read('build-report.json')['groups']
    assert now['extends'] == '../run10/registry-draft.json'
    assert now['since_layer'] == 'v35k-run11' and now['output_swf_sha256'] == digest
    assert set(now['capabilities']) == set(old['capabilities']) | {entry[0] for entry in ENTRIES.values()}
    for key, value in old['capabilities'].items():
        assert now['capabilities'][key] == value, key
    for key, (capability, archive, _) in ENTRIES.items():
        group = implementation_group(key)
        new = now['capabilities'][capability]
        assert new['required_swf_sha256'] == digest and new['patch_archive'] == archive
        assert set(new['methods']) == set(groups[group]['changed']+groups[group]['added'])
    allowed = {'since_layer', 'extends', 'output_swf_sha256', 'capabilities',
               'integration_notes', 'effect_codes', 'effect_flags_overrides'}
    for key, value in old.items():
        if key not in allowed:
            assert now[key] == value, key
    for key in ('integration_notes', 'effect_codes'):
        assert now[key][:len(old[key])] == old[key], key
    additions = now['effect_codes'][len(old['effect_codes']):]
    assert [row['code'] for row in additions] == [33, 34, 35]
    damage = additions[1]
    assert damage['example'] == 'wfx:34:5050:100000:150000:hidden_wg_aqua_heal_damage_any', '码34示例未更新CT'
    assert damage['logic_frames_per_second'] == 60 and damage['ct_evidence'] == 'audit/ct-delta-report.json'
    assert '1000*CT秒数' in damage['arg'] and 'arg<1000' in damage['timing'], '码34 CT登记缺失'
    assert additions[2]['example'] == 'wfx:35:50:500:1000:hidden_wg_aqua_heal_fever_any', '码35数据发生未授权变化'
    assert set(now['effect_flags_overrides']) == set(old['effect_flags_overrides']) | {'33', '34', '35'}
    for key, value in old['effect_flags_overrides'].items():
        assert now['effect_flags_overrides'][key] == value
    for n in range(1, 11):
        ancestor = json.loads((ROOT.parent/f'run{n}/registry-draft.json').read_text(encoding='utf-8'))
        assert set(ancestor['capabilities']) <= set(now['capabilities'])
    return len(now['capabilities'])


def archive(digest):
    prefix = ROOT/'apk-patches-additions'
    expected = {(p.relative_to(ROOT).as_posix(),
                 (prefix/'source'/p.relative_to(ROOT)).relative_to(ROOT).as_posix())
                for p in archive_sources()}
    meta = {(prefix/'README.md').relative_to(ROOT).as_posix()}
    pcode_rows = read('final-pcode/manifest.json')
    groups = read('build-report.json')['groups']
    for key, (capability, name, _) in ENTRIES.items():
        group = implementation_group(key)
        item = read('apk-patches-additions/'+name+'/manifest.json')
        assert item['requirement_decisions'] == verify_task(), '归档manifest与裁定不一致'
        assert item['verification_status'] == 'pass' and 'blocker' not in item
        assert item['external_readonly_ack'] == '../source/task-evidence/known-external-changes.json'
        assert item['revision'] == 3 and item['pre_ct_swf_sha256'] == PRE_CT_SWF_SHA, '归档未绑定第二版CT基线'
        assert item['capability'] == capability and item['output_swf_sha256'] == digest
        labels = set(groups[group]['changed']+groups[group]['added'])
        assert item['pcode'] == [r for r in pcode_rows if r['label'] in labels]
        expected |= {('final-pcode/'+r['file'],
                      (prefix/name/'pcode'/r['file']).relative_to(ROOT).as_posix()) for r in item['pcode']}
        meta |= {(prefix/name/f).relative_to(ROOT).as_posix() for f in ('README.md', 'manifest.json')}
    rows = read('archive-source-manifest.json')
    assert {(r['source'], r['path']) for r in rows} == expected and len(rows) == len(expected)
    actual_files = {p.relative_to(ROOT).as_posix() for p in prefix.rglob('*') if p.is_file()}
    assert actual_files == {dest for _, dest in expected} | meta, '归档有未登记或缺失文件'
    for row in rows:
        data = (ROOT/row['path']).read_bytes()
        assert sha(data) == row['sha256'] and data == (ROOT/row['source']).read_bytes(), row['path']
    return len(rows)


def main():
    check_baseline()
    report = read('verify-report.json')
    digest = sha((ROOT/'v35k.swf').read_bytes())
    assert report['status'] == 'pass' and report['output_swf_sha256'] == digest
    assert report['requirement_decisions'] == verify_task()
    task_frame = read('audit-ruling-framework.json')
    assert task_frame['status'] == 'pass' and task_frame['requirement_decisions'] == verify_task()
    assert task_frame['revision'] == 3 and task_frame['final_baseline'] == 'pass'
    source_locks(task_frame['evidence_source_locks'])
    ct = read('audit/ct-delta-report.json')
    assert ct['status'] == 'passed' and ct['output_swf_sha256'] == digest, 'CT增量报告未绑定本次产物'
    assert ct['previous_swf_sha256'] == PRE_CT_SWF_SHA and ct['sources_unchanged_during_verification']
    source_locks([{'path': name, 'sha256': value} for name, value in ct['source_locks'].items()])
    native_ct = read('audit/ct-native-evidence.json')
    assert native_ct['status'] == 'passed' and native_ct['input_swf_sha256'] == BASE_SHA
    assert native_ct['logic_frames_per_second'] == 60 and native_ct['ct_5_seconds_frames'] == 300
    assert sha((ROOT/'audit/ct-native-evidence.json').read_bytes()) == ct['native_evidence']['sha256']
    assert sha((ROOT/'audit/ct_native.py').read_bytes()) == native_ct['source_sha256']
    source_locks(ct['native_evidence']['pcode_files'])
    ct_review = read('audit/ct-review-report.json')
    assert ct_review['status'] == 'passed' and ct_review['output_swf_sha256'] == digest
    source_locks([{'path': name, 'sha256': value} for name, value in ct_review['source_locks'].items()])
    assert report['mutation_survivors'] == 0 and report['final_baseline'] == 'pass'
    review = read(report['independent_cross_review']['report'])
    assert review['status'] == 'pass' and review['swf_sha256'] == digest
    source_locks(review['evidence_source_locks'])
    assert (ROOT/'v35k.swf.sha256').read_text().split()[0] == digest
    locks = read('verification-source-locks.json')
    source_locks(locks)
    assert locks == source_manifest(), '验收后新增或删除源码'
    for name in report['behavior_reports']:
        group = read(name)
        source_locks(group['evidence_source_locks'])
        assert group['status'] == 'pass' and group['after_swf_sha256'] == digest
    frame = read('framework-report.json')
    receipt = frame['verification_source_manifest']
    assert sha((ROOT/receipt['path']).read_bytes()) == receipt['sha256']
    frame_locks = read(receipt['path'])
    source_locks([{'path': k, 'sha256': v} for k, v in frame_locks['files'].items()])
    assert frame_locks['output_swf_sha256'] == digest
    result = {'status': 'pass', 'output_swf_sha256': digest,
              'pcode_count': pcode(digest), 'capabilities': registry(digest),
              'archive_copies': archive(digest), 'source_locks': len(locks),
              'revision': 3, 'pre_ct_swf_sha256': PRE_CT_SWF_SHA,
              'ct_delta_report': 'audit/ct-delta-report.json',
              'task_contract_negative_cases': task_frame['negative_cases']}
    links = []
    report_path = (ROOT/'delivery-report.json').resolve()
    docs = [ROOT/'README.md', *(ROOT/'apk-patches-additions').rglob('README.md')]
    for doc in docs:
        for target in re.findall(r'\]\(([^)]+)\)', doc.read_text(encoding='utf-8')):
            assert '://' not in target, '离线交付文档不可依赖外网'
            resolved = (doc.parent/target.split('#')[0]).resolve()
            assert resolved == report_path or resolved.exists(), (doc, target)
            links.append(target)
    result.update(document_links_checked=len(links), readonly_sources=verify_readonly())
    output_path(ROOT/'delivery-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'readonly_sources'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
