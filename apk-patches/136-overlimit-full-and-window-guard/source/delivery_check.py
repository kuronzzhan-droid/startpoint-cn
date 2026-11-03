"""核对正式SWF、最终P-code、完整源码归档和八轮累计登记。"""
import json
import re
from bootstrap import ROOT, BASE_SHA, output_path
from framework import sha
from common import listing
from swfabc import SwfAbc
import bodies
from make_registry import CAPABILITY, ARCHIVE
from make_archive import archive_sources
from source_guard import verify as verify_readonly
from verify import source_locks, source_manifest


def read(name):
    return json.loads((ROOT/name).read_text(encoding='utf-8'))


def pcode(digest):
    manifest = read('final-pcode/manifest.json')
    release = read('release-locks.json')
    assert release['baseline_swf_sha256'] == BASE_SHA
    assert release['output_swf_sha256'] == digest
    assert set(release['methods']) == {r['label'] for r in manifest}
    abcs = {}
    for row in manifest:
        if row['abc'] not in abcs:
            abcs[row['abc']] = SwfAbc(ROOT/'v35h.swf', tag=row['abc'].encode()).abc
        abc = abcs[row['abc']]
        index = bodies.resolve(abc, row['label'])
        body = abc.bodies[index]
        assert index == row['body'] and sha(body[5]) == row['code_sha256']
        assert body[1:5] == row['header']
        lock = release['methods'][row['label']]
        assert lock['after'] == sha(body[5]) and lock['after_header'] == body[1:5]
        lines = [f'# {row["label"]}; body={index}; code_sha256={sha(body[5])}; header={body[1:5]}',
                 f'# exceptions={body[6]}', *listing(abc, body[5])]
        assert (ROOT/'final-pcode'/row['file']).read_text(encoding='utf-8') == '\n'.join(lines)+'\n'
    archived = read('apk-patches-additions/'+ARCHIVE+'/manifest.json')
    assert archived['pcode'] == manifest and archived['output_swf_sha256'] == digest
    return len(manifest)


def registry(digest):
    old = json.loads((ROOT.parent/'run7/registry-draft.json').read_text(encoding='utf-8'))
    now = read('registry-draft.json')
    assert now['extends'] == '../run7/registry-draft.json'
    assert now['since_layer'] == 'v35h-run8' and now['output_swf_sha256'] == digest
    assert set(now['capabilities']) == set(old['capabilities']) | {CAPABILITY}
    for k, v in old['capabilities'].items():
        assert now['capabilities'][k] == v, k
    new = now['capabilities'][CAPABILITY]
    assert new['required_swf_sha256'] == digest and new['patch_archive'] == ARCHIVE
    assert set(new['methods']) == set(read('release-locks.json')['methods'])
    allowed = {'since_layer', 'extends', 'output_swf_sha256', 'capabilities',
               'integration_notes', 'custom_ability_string_patterns'}
    for k, v in old.items():
        if k not in allowed:
            assert now[k] == v, k
    for k in ('integration_notes', 'custom_ability_string_patterns'):
        assert now[k][:len(old[k])] == old[k], k
    assert now['custom_ability_string_patterns'][-1]['example'] == {
        'key': 'wfx_overlimit_full_129989', 'value': '1'}
    for n in range(1, 8):
        ancestor = json.loads((ROOT.parent/f'run{n}/registry-draft.json').read_text(encoding='utf-8'))
        assert set(ancestor['capabilities']) <= set(now['capabilities'])
    return len(now['capabilities'])


def archive():
    prefix = ROOT/'apk-patches-additions'/ARCHIVE
    expected = {(p.relative_to(ROOT).as_posix(),
                 (prefix/'source'/p.relative_to(ROOT)).relative_to(ROOT).as_posix())
                for p in archive_sources()}
    expected |= {('final-pcode/'+r['file'],
                  (prefix/'pcode'/r['file']).relative_to(ROOT).as_posix())
                 for r in read('final-pcode/manifest.json')}
    rows = read('archive-source-manifest.json')
    assert {(r['source'], r['path']) for r in rows} == expected
    assert len(rows) == len(expected)
    actual_files = {p.relative_to(ROOT).as_posix() for p in prefix.rglob('*') if p.is_file()}
    expected_files = {destination for _, destination in expected} | {
        (prefix/'README.md').relative_to(ROOT).as_posix(),
        (prefix/'manifest.json').relative_to(ROOT).as_posix()}
    assert actual_files == expected_files, '归档有未登记或缺失文件'
    for r in rows:
        data = (ROOT/r['path']).read_bytes()
        assert sha(data) == r['sha256'] and data == (ROOT/r['source']).read_bytes(), r['path']
    return len(rows)


def main():
    report = read('verify-report.json')
    digest = sha((ROOT/'v35h.swf').read_bytes())
    assert report['status'] == 'pass' and report['output_swf_sha256'] == digest
    assert (ROOT/'v35h.swf.sha256').read_text().split()[0] == digest
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
    for reference in read('reference-source-locks.json'):
        from pathlib import Path
        assert sha(Path(reference['path']).read_bytes()) == reference['sha256'], reference['path']
    result = {'status': 'pass', 'output_swf_sha256': digest,
              'pcode_count': pcode(digest), 'capabilities': registry(digest),
              'archive_copies': archive(), 'source_locks': len(locks)}
    links = []
    report_path = (ROOT/'delivery-report.json').resolve()
    for doc in [ROOT/'README.md', *(ROOT/'apk-patches-additions').rglob('README.md')]:
        for target in re.findall(r'\]\(([^)]+)\)', doc.read_text(encoding='utf-8')):
            assert '://' not in target, '离线交付文档不可依赖外网'
            resolved = (doc.parent/target.split('#')[0]).resolve()
            # 首次交付时本报告尚未生成；唯一豁免当前函数成功后才写出的报告。
            assert resolved == report_path or resolved.exists(), (doc, target)
            links.append(target)
    result.update(document_links_checked=len(links), readonly_sources=verify_readonly())
    output_path(ROOT/'delivery-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'readonly_sources'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
