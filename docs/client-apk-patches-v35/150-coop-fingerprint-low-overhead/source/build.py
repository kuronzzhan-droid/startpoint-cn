"""v35r双输入同源指令拼接；未知输入与输出越界即拒绝。"""
import argparse
import json
from pathlib import Path
import bootstrap
from bootstrap import ROOT, INPUTS, sha
import bodies
from common import listing
from framework import Editor
import patch


def json_write(path, value):
    bootstrap.output_path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def locks():
    return json.loads((ROOT / 'baseline-locks.json').read_text(encoding='utf-8'))


def construct(path):
    bootstrap.check_baseline()
    if sha(Path(path).read_bytes()) not in [row[1] for row in INPUTS.values()]:
        raise ValueError('未知输入整包，停止')
    e = Editor(path, locks())
    for label, lock in e.locks.items():
        body = e.body(label)
        if sha(body[5]) != lock['sha'] or body[1:5] != lock['header']:
            raise ValueError('方法SHA/header不符: ' + label)
    modules = {'patch': patch.build(e)}
    e.apply()
    assert set(e.report) == set(e.locks), (set(e.report), set(e.locks))
    return e.swf.serialize(), e, modules


def release_record(raw, e):
    labels = list(e.report) + [row['label'] for row in e.new_methods]
    return dict(sha256=sha(raw), methods={label: dict(
        body=bodies.resolve(e.abc, label), sha256=sha(e.body(label)[5]), header=e.body(label)[1:5])
        for label in sorted(labels)})


def export_pcode(e, directory):
    directory.mkdir(parents=True, exist_ok=True)
    manifest = []
    for label in list(e.report) + [row['label'] for row in e.new_methods]:
        index = bodies.resolve(e.abc, label)
        current = e.abc.bodies[index]
        old = e.original_bodies[index] if index < e.original_count else None
        base = label.replace('/', '__').replace('$', '_static')
        after = ['# ' + label + ' header=' + repr(current[1:5]) + ' sha=' + sha(current[5]),
                 '# exceptions=' + repr(current[6]), *listing(e.abc, current[5])]
        before = [] if old is None else ['# ' + label + ' header=' + repr(old[1:5]) + ' sha=' + sha(old[5]),
                                        '# exceptions=' + repr(old[6]), *listing(e.abc, old[5])]
        diff = ['# 新增助手'] + after if old is None else ['# 仅插入，原指令可逆恢复']
        if old is not None:
            for at, count, policy in e.report[label]['insertions']:
                diff += [f'@@ instruction {at}, count {count}, incoming {policy} @@']
                diff += ['+ ' + x for x in after[2 + at:2 + at + count]]
        for suffix, lines in [('before.pcode.txt', before), ('after.pcode.txt', after), ('diff.txt', diff)]:
            (directory / (base + '.' + suffix)).write_text('\n'.join(lines) + '\n', encoding='utf-8')
        manifest.append(dict(label=label, body=index, before_sha256=sha(old[5]) if old else None,
                             after_sha256=sha(current[5]), header=current[1:5], prefix=base))
    json_write(directory / 'manifest.json', manifest)


def write_output(path, data, replace_work=False):
    path = bootstrap.output_path(path)
    if path.exists() and path.read_bytes() != data:
        if not replace_work or not path.is_relative_to(ROOT / 'work'):
            raise ValueError('已有不同内容输出，拒绝覆盖: ' + str(path))
    path.write_bytes(data)
    path.with_suffix('.swf.sha256').write_text(sha(data) + '  ' + path.name + '\n', encoding='ascii')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', choices=['test', 'local', 'both'], default='both')
    ap.add_argument('--candidate', action='store_true')
    ap.add_argument('--replace-work', action='store_true')
    args = ap.parse_args()
    records = {}
    for name, (path, _, output) in INPUTS.items():
        if args.profile not in ('both', name):
            continue
        raw, e, modules = construct(path)
        out = ROOT / 'work' / output if args.candidate else ROOT / output
        write_output(out, raw, args.replace_work)
        records[name] = release_record(raw, e)
        json_write((ROOT / 'work' if args.candidate else ROOT) / ('build-' + name + '.json'),
                   dict(status='built', input=str(path), output=str(out), sha256=sha(raw),
                        changed=e.report, added=e.new_methods, modules=modules))
        if name == 'test':
            export_pcode(e, ROOT / ('work/pcode' if args.candidate else 'pcode'))
        print(json.dumps(dict(profile=name, output=str(out), sha256=sha(raw),
                              changed=len(e.report), added=len(e.new_methods))))
    lock_name = 'release-locks.json'
    json_write((ROOT / 'work' if args.candidate else ROOT) / lock_name, records)


if __name__ == '__main__':
    main()
