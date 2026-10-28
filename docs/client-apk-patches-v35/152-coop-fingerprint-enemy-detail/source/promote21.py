"""候选全绿后同源重放正式产物；以逐字节相同复用已完成的验收。"""
import json
import bootstrap
from bootstrap import ROOT, INPUTS, sha
from build import construct, write_output, release_record, json_write, export_pcode
from verify import PROGRAMS


def main():
    work = ROOT/'work'
    report = json.loads((work/'verify-report.json').read_text(encoding='utf-8'))
    assert report['status'] == 'pass'
    assert report['source_evidence'] == bootstrap.source_evidence(), 'source changed since candidate acceptance'
    protected = json.loads((ROOT/'protected-run20-before.json').read_text(encoding='utf-8'))
    assert protected == {p.relative_to(bootstrap.BASE_DIR).as_posix():sha(p.read_bytes())
        for p in bootstrap.BASE_DIR.rglob('*') if p.is_file()}
    locks = {}
    for profile, (source, _, filename) in INPUTS.items():
        raw, editor, modules = construct(source)
        candidate = work/filename
        assert raw == candidate.read_bytes(), 'candidate and final replay differ'
        assert sha(raw) == report['profiles'][profile]['sha256']
        write_output(ROOT/filename, raw)
        locks[profile] = release_record(raw, editor)
        json_write(ROOT/('build-'+profile+'.json'), dict(status='built', input=str(source),
            output=str(ROOT/filename), sha256=sha(raw), changed=editor.report,
            added=editor.new_methods, modules=modules))
        if profile == 'test':
            export_pcode(editor, ROOT/'pcode')
        for suite in PROGRAMS:
            filename_report = suite+'-'+profile+'.json'
            data = (work/filename_report).read_bytes()
            assert sha(data) == report['profiles'][profile]['tests'][suite]['sha256']
            assert json.loads(data)['swf_sha256'] == sha(raw)
            bootstrap.output_path(ROOT/filename_report).write_bytes(data)
    json_write(ROOT/'release-locks.json', locks)
    data = (work/'framework-report.json').read_bytes()
    assert sha(data) == report['framework_report_sha256']
    bootstrap.output_path(ROOT/'framework-report.json').write_bytes(data)
    report['promotion'] = dict(same_source_replay_byte_identical=True,
        source_evidence_unchanged=True, verified_candidate_report_sha256=sha((work/'verify-report.json').read_bytes()),
        scope='final files equal tested candidate bytes; completed behavior checks reused without repeat')
    json_write(ROOT/'verify-report.json', report)
    print(json.dumps({'status':'pass','profiles':{k:v['sha256'] for k,v in report['profiles'].items()}}))


if __name__ == '__main__':
    main()
