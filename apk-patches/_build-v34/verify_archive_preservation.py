"""Map all 101 archive entries to actual v33/v34 method-preservation evidence."""
from __future__ import annotations
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = Path(r'D:\WF\apkp1016\apk-patches')
ALLOWED = {('boot_ffc6', i) for i in (66361, 66148, 66116, 66173, 66180)}
P_HEADER = re.compile(r'# DoABC2: (.*?); label: (.*?); body: ([0-9]+); method: ([0-9]+)')
P_SHA = re.compile(r'# code SHA-256: ([0-9a-f]{64}); header: (\[[^\n]+\])')
S_EVIDENCE = re.compile(r'`([^`]+)`；body `([0-9]+)`；code SHA-256 `([0-9a-f]{64})`')
R_EVIDENCE = re.compile(r'\[([^\]]+)\]\((pcode/[^)]+)\)；body `([0-9]+)`；code SHA-256 `([0-9a-f]{64})`')


def import_support():
    path = ROOT / 'r4-src/client-patch/startup-cache/build_swf.py'
    spec = importlib.util.spec_from_file_location('archive_preservation_support', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def archive_entries():
    source_text = (ARCHIVE / 'SOURCES.md').read_text(encoding='utf-8')
    sections = {int(n): body for n, body in re.findall(r'^## ([0-9]+) [^\n]*\n(.*?)(?=^## |\Z)', source_text, re.M | re.S)}
    entries = []
    for folder in sorted(ARCHIVE.iterdir(), key=lambda p: p.name):
        match = re.match(r'^([0-9]{2,3})-', folder.name)
        if not match: continue
        number = int(match.group(1))
        readme = folder / 'README.md'
        text = readme.read_text(encoding='utf-8')
        title = text.splitlines()[0].lstrip('# ')
        mapped = {}
        def add(abc, body, label, digest, source, method=None, header=None):
            key = (abc.replace('/', '.'), int(body))
            if key in mapped:
                assert mapped[key]['archive_code_sha256'] == digest, (folder.name, key, source)
                mapped[key]['mapping_sources'].append(source)
                return
            mapped[key] = {'abc': abc, 'body': int(body), 'label': label,
                           'archive_code_sha256': digest, 'mapping_sources': [source]}
            if method is not None: mapped[key]['archive_method'] = int(method)
            if header is not None: mapped[key]['archive_header'] = header
        for pcode in sorted((folder / 'pcode').glob('*.txt')):
            with pcode.open(encoding='utf-8') as stream:
                head = ''.join(next(stream, '') for _ in range(6))
            ph, ps = P_HEADER.search(head), P_SHA.search(head)
            assert ph and ps, 'unparsed P-code header: '+str(pcode)
            add(ph[1], ph[3], ph[2], ps[1], pcode.relative_to(ARCHIVE).as_posix(), ph[4], json.loads(ps[2]))
        for label, relative, body, digest in R_EVIDENCE.findall(text):
            abc = Path(relative).name.split('--')[0]
            add(abc, body, label, digest, readme.relative_to(ARCHIVE).as_posix())
        for qualified, body, digest in S_EVIDENCE.findall(sections.get(number, '')):
            abc, label = qualified.split(':', 1)
            add(abc, body, label, digest, f'SOURCES.md section {number}')
        entries.append({'number': number, 'entry': folder.name, 'title': title,
                        'readme_read': True, 'source_section_read': number in sections,
                        'methods': list(mapped.values())})
    assert {row['number'] for row in entries} == set(range(1,102))
    return entries


def abc_map(s, path):
    result = {}
    for tag in s.parts(path)[2]:
        if tag[0] != 82: continue
        actual = tag[2][4:-1].decode('utf-8')
        key = actual.replace('/', '.')
        result.setdefault(key, []).append((actual, tag[3]))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--original', type=Path, default=ROOT / 'inputs/v33.swf')
    parser.add_argument('--final', type=Path, default=ROOT / 'v34.swf')
    parser.add_argument('--output', type=Path, default=ROOT / 'verification/v33-patches-preserved.json')
    parser.add_argument('--apk-evidence', default='verification/apk-x86-verification.json')
    parser.add_argument('--whole-swf-evidence', default='verification/swf-verification.json')
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError(f'output escapes workspace: {args.output}')
    entries = archive_entries()
    s = import_support()
    before, after = abc_map(s, args.original), abc_map(s, args.final)
    unique = {}
    failures, gaps = [], []
    for entry in entries:
        if 97 <= entry['number'] <= 100:
            entry.update(status='non_swf_evidence_required', reason='v33-x86 的双 ABI/native/ANE 条目；不属于共享 SWF 方法体，应由最终 x86 APK 全成员与 ABI/ANE 保留报告核验',
                         evidence_file=args.apk_evidence)
            continue
        if not entry['methods']:
            entry.update(status='non_method_evidence_required', reason='归档未提供 SWF 方法体映射；资源/DEX/包身份由主构建最终 APK 全成员比较覆盖，本报告不冒认为方法验证')
            gaps.append({'number': entry['number'], 'entry': entry['entry'], 'reason': entry['reason']})
            continue
        statuses = []
        for row in entry['methods']:
            key = row['abc'].replace('/', '.')
            index = row['body']
            if key not in before or key not in after:
                row.update(status='failed', reason='ABC name missing')
            elif len(before[key]) != 1 or len(after[key]) != 1:
                row.update(status='failed', reason='Mapped ABC name has multiple occurrences')
            elif index >= len(before[key][0][1].bodies) or index >= len(after[key][0][1].bodies):
                row.update(status='failed', reason='Body index missing')
            else:
                original = before[key][0][1].bodies[index]
                final = after[key][0][1].bodies[index]
                first_sha, last_sha = s.sha(original[5]), s.sha(final[5])
                match = first_sha == row['archive_code_sha256']
                equal = s.m.freeze(original) == s.m.freeze(final)
                allowed = (before[key][0][0], index) in ALLOWED
                row.update(actual_abc=before[key][0][0], v33_code_sha256=first_sha, v34_code_sha256=last_sha,
                           archive_sha_matches_input=match, full_body_equal=equal,
                           method_id_equal=original[0] == final[0], allowed_composition=allowed)
                if not match:
                    row.update(status='failed', reason='Archive SHA differs from actual pinned v33 input')
                elif equal:
                    row['status'] = 'preserved_byte_identical'
                elif allowed:
                    row['status'] = 'composed_allowed'
                else:
                    row.update(status='failed', reason='Changed outside five composed methods')
            statuses.append(row['status'])
            unique[(key,index)] = row
            if row['status'] == 'failed': failures.append({'entry': entry['entry'], **row})
        entry['status'] = 'failed' if 'failed' in statuses else ('preserved_with_composition' if 'composed_allowed' in statuses else 'preserved_byte_identical')
    result = {
        'status': 'passed_with_explicit_non_method_scope' if not failures else 'failed',
        'input_swf_sha256': s.sha(args.original.read_bytes()), 'output_swf_sha256': s.sha(args.final.read_bytes()),
        'archive_root': str(ARCHIVE), 'entries_total': len(entries),
        'entry_status_counts': dict(Counter(e['status'] for e in entries)),
        'unique_mapped_method_count': len(unique), 'unique_method_status_counts': dict(Counter(r['status'] for r in unique.values())),
        'method_evidence_failures': failures, 'non_method_mapping_gaps': gaps,
        'asset_and_identity_evidence': {'expected_file': args.apk_evidence,
                                       'scope': '主构建最终 APK 全成员逐字节比较，应仅主 SWF 与明确版本槽改变；覆盖 asset-only 条目、包身份/DEX/native/ANE 与双 ABI 保留'},
        'whole_swf_preservation_evidence': {
            'owner': 'root build verification', 'expected_file': args.whole_swf_evidence,
            'scope': '本脚本只按归档逐条映射；所有原始方法整体比较由根 scripts/verify_swf_v34.py 独立提供，不能把归档映射当作全 SWF 覆盖',
        },
        'limitations': [
            '仅对有归档 abc/body/SHA 证据的方法确认原 v33 输入身份并比较完整 body，包含方法头、code、异常和 traits。',
            '资源/DEX/身份条目不捏造 SWF 方法覆盖；由最终 APK 成员差异报告覆盖。',
            '本报告是静态比较，不声明 AIR 或设备运行验证。',
        ], 'entries': entries,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({key: result[key] for key in ['status','entries_total','entry_status_counts','unique_mapped_method_count','unique_method_status_counts','non_method_mapping_gaps','method_evidence_failures']}, ensure_ascii=False, indent=2))
    assert not failures, 'archive preservation verification failed'


if __name__ == '__main__': main()
