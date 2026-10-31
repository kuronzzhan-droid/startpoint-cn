"""离线重放 v35h -> v35i；--from-v34 先只读调用前八轮构造器。"""
from __future__ import annotations
import argparse
import importlib
import json
import subprocess
import sys
from pathlib import Path
import bootstrap
from bootstrap import ROOT, BASE, BASE_SHA, output_path, checked_output_path
from framework import Editor, sha
from swfabc import SwfAbc
from common import listing
import bodies
from multiabc import editors, compose

MODULES = ['owner_main.patches']


def construct(source=BASE):
    if sha(BASE.read_bytes()) != BASE_SHA:
        raise ValueError('run8 v35h SWF SHA256 mismatch; 停止')
    if sha(Path(source).read_bytes()) != BASE_SHA:
        raise ValueError('输入不是锁定的 v35h; 整包拒绝')
    e = Editor(source)
    for name in MODULES:
        importlib.import_module(name).build(e)
    for _, editor in editors(e):
        editor.apply()
    return compose(e), e


def release_record(raw, e):
    methods = {}
    for tag, editor in editors(e):
        for label, record in editor.report.items():
            assert label not in methods
            methods[label] = dict(record, abc=tag)
        for item in editor.new_methods:
            assert item['label'] not in methods
            methods[item['label']] = {'added': True, 'after': item['sha256'],
                                      'after_header': item['header'], 'abc': tag}
    record = {'baseline_swf_sha256': BASE_SHA, 'output_swf_sha256': sha(raw),
              'methods': methods}
    return json.loads(json.dumps(record))


def verify_input(source, release):
    digest = sha(source.read_bytes())
    if digest == BASE_SHA:
        return 'ready'
    if release is None:
        raise ValueError('未知输入且没有最终方法锁; 整包拒绝')
    abcs = {}
    for label, lock in release['methods'].items():
        tag = lock['abc']
        if tag not in abcs:
            abcs[tag] = SwfAbc(source, tag=tag.encode('utf-8')).abc
        abc = abcs[tag]
        body = abc.bodies[bodies.resolve(abc, label)]
        if sha(body[5]) != lock['after'] or body[1:5] != lock['after_header']:
            raise ValueError('unknown method sha/header; 整包拒绝: ' + label)
    if digest != release['output_swf_sha256']:
        raise ValueError('方法锁匹配但整包不同; 整包拒绝')
    return 'already_present'


def write_pcode(e):
    manifest = []
    for tag, editor in editors(e):
        manifest.extend(write_editor_pcode(tag, editor))
    output_path(ROOT/'final-pcode'/'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def write_editor_pcode(tag, e):
    manifest = []
    for label in list(e.report) + [x['label'] for x in e.new_methods]:
        idx = bodies.resolve(e.abc, label)
        body = e.abc.bodies[idx]
        name = label.replace('/', '__').replace('<', '').replace('>', '').replace('|', '_') + '.pcode.txt'
        lines = [f'# {label}; body={idx}; code_sha256={sha(body[5])}; header={body[1:5]}',
                 f'# exceptions={body[6]}', *listing(e.abc, body[5])]
        output_path(ROOT/'final-pcode'/name).write_text('\n'.join(lines)+'\n', encoding='utf-8')
        manifest.append({'abc': tag, 'label': label, 'body': idx, 'code_sha256': sha(body[5]),
                         'header': body[1:5], 'file': name})
    return manifest


def chained_input():
    result = subprocess.run([sys.executable, '-B', str(ROOT/'chain_replay.py')],
                            capture_output=True, text=True, encoding='utf-8', check=True)
    receipt = json.loads(result.stdout)
    if receipt['sha256'] != BASE_SHA:
        raise ValueError('前八轮串联重放输出不等于锁定v35h')
    return Path(receipt['path'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument('--input', type=Path, default=BASE)
    inputs.add_argument('--from-v34', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT/'v35i.swf')
    parser.add_argument('--prepare-locks', action='store_true', help='研发固定最终输出；普通重放不使用')
    args = parser.parse_args()
    if sha(BASE.read_bytes()) != BASE_SHA:
        raise ValueError('run8 v35h SHA 不匹配，停止')
    dest = checked_output_path(args.output)
    release_path = ROOT/'release-locks.json'
    release = json.loads(release_path.read_text(encoding='utf-8')) if release_path.exists() else None
    if not args.prepare_locks and release is None:
        raise ValueError('缺少 release-locks.json')
    if args.from_v34:
        # 这些阶段文件随后作为下一轮输入；须在任何阶段写入前拒绝覆盖。
        stage_inputs = [ROOT/'work'/('v35' + suffix + '-chained.swf') for suffix in 'abcdefgh']
        if any(dest == p or (dest.exists() and p.exists() and dest.samefile(p))
               for p in stage_inputs):
            raise ValueError('拒绝覆盖串联输入 SWF')
    source = chained_input() if args.from_v34 else args.input.resolve()
    state = verify_input(source, release)
    if state == 'already_present':
        if dest != source and not (dest.exists() and dest.samefile(source)):
            output_path(dest).write_bytes(source.read_bytes())
        print(json.dumps({'status': state, 'sha256': sha(dest.read_bytes())}))
        return
    if dest == source or (dest.exists() and dest.samefile(source)):
        raise ValueError('拒绝覆盖输入 SWF')
    raw, e = construct(source)
    actual = release_record(raw, e)
    if args.prepare_locks:
        output_path(release_path).write_text(json.dumps(actual, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    elif actual != release:
        raise ValueError('重放不符合固定最终方法锁; 整包拒绝')
    output_path(dest).write_bytes(raw)
    output_path(ROOT/'v35i.swf.sha256').write_text(sha(raw)+'  v35i.swf\n', encoding='ascii')
    write_pcode(e)
    by_abc = {tag: {'changed': editor.report, 'added': editor.new_methods,
                   'traits': editor.traits, 'pool': editor.pool.report()}
              for tag, editor in editors(e)}
    output_path(ROOT/'build-report.json').write_text(json.dumps({
        'input_sha256': BASE_SHA, 'output_sha256': sha(raw), 'changed': e.report,
        'added': e.new_methods, 'traits': e.traits, 'pool': e.pool.report(), 'abcs': by_abc},
        ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'status': 'built', 'sha256': sha(raw),
                      'changed': sum(len(x.report) for _, x in editors(e)),
                      'added': sum(len(x.new_methods) for _, x in editors(e))}))


if __name__ == '__main__':
    main()
