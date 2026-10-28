"""双输入、同一补丁源；所有输出严格限定 run12。"""
import argparse
import difflib
import importlib
import json
from pathlib import Path
import bootstrap
from bootstrap import ROOT, INPUTS, sha, output_path, checked_output_path
import bodies
from common import freeze, listing
from framework import Editor
from swfabc import SwfAbc
from static_check import check_body

GROUPS = ('override.patch', 'chain.patch', 'lifecycle.patch', 'preload.patch', 'damage.patch')


def modules():
    return [importlib.import_module(name) for name in GROUPS]


def json_write(path, value):
    output_path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def locked_sources():
    selected = {p for p in ROOT.rglob('*.py')
                if not any(x in p.parts for x in ('apk-patches-additions', 'work'))}
    selected.update(ROOT/rel for rel in (
        'preload/target-locks.json', 'preload/real-character-fixture.json',
        'release-locks.json', 'task-evidence/decision-status.json', 'task-evidence/TASK12.md',
        'task-evidence/TASK12-before-supplement.md', 'task-evidence/TASK12-supplement.diff.txt',
        'task-evidence/task-updates.json', 'README.md'))
    for path in selected:
        if not path.is_file():
            raise ValueError('缺少固定源码或配置输入: '+str(path))
    return {str(p.relative_to(ROOT)).replace('\\', '/'): sha(p.read_bytes())
            for p in sorted(selected)}


def locks():
    result = {}
    for module in modules():
        for name, lock in module.LOCKS.items():
            if name in result:
                assert result[name] == lock, name
            result[name] = lock
    return result


def construct(path):
    bootstrap.check_baseline()
    path = Path(path)
    if sha(path.read_bytes()) not in {x[1] for x in INPUTS.values()}:
        raise ValueError('未知输入整包 SHA，停止')
    e = Editor(path, locks())
    for label, lock in e.locks.items():
        body = e.body(label)
        if sha(body[5]) != lock['sha'] or body[1:5] != lock['header']:
            raise ValueError('输入方法 SHA/header 不符: '+label)
    groups = [module.build(e) for module in modules()]
    e.apply()
    return e.swf.serialize(), e, groups


def release_record(raw, e):
    labels = list(e.report) + [x['label'] for x in e.new_methods]
    return {'sha256': sha(raw), 'methods': {
        label: {'sha256': sha(e.body(label)[5]), 'header': e.body(label)[1:5],
                'body': bodies.resolve(e.abc, label)}
        for label in sorted(labels)}}


def pcode(e):
    manifest = []
    for label in list(e.report) + [x['label'] for x in e.new_methods]:
        idx = bodies.resolve(e.abc, label)
        after = e.abc.bodies[idx]
        before = e.original_bodies[idx] if idx < e.original_count else None
        name = label.replace('/', '__').replace('$', '_static')
        a = [f'# {label} header={after[1:5]} sha={sha(after[5])}', *listing(e.abc, after[5])]
        b = [] if before is None else [
            f'# {label} header={before[1:5]} sha={sha(before[5])}', *listing(e.abc, before[5])]
        for suffix, lines in (('after.pcode.txt', a), ('before.pcode.txt', b),
                              ('diff.txt', list(difflib.unified_diff(b, a, 'before', 'after', lineterm='')))):
            output_path(ROOT/'pcode'/f'{name}.{suffix}').write_text('\n'.join(lines)+'\n', encoding='utf-8')
        manifest.append({'label': label, 'body': idx, 'before_sha256': None if before is None else sha(before[5]),
                         'after_sha256': sha(after[5]), 'header': after[1:5],
                         'path_prefix': f'pcode/{name}'})
    json_write(ROOT/'pcode'/'manifest.json', manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--prepare-locks', action='store_true')
    args = parser.parse_args()
    bootstrap.check_baseline()
    release_path = ROOT/'release-locks.json'
    release = json.loads(release_path.read_text(encoding='utf-8')) if release_path.exists() else {}
    if not args.prepare_locks and not release:
        raise ValueError('普通重放必须有固定 release-locks.json')
    source = args.input or INPUTS['test'][0]
    digest = sha(source.read_bytes())
    profiles = [k for k, v in INPUTS.items() if v[1] == digest]
    already = False
    if not profiles:
        profiles = [k for k, v in release.items() if v['sha256'] == digest]
        already = bool(profiles)
    if len(profiles) != 1:
        raise ValueError('未知或不唯一的输入 SHA')
    profile = profiles[0]
    dest = checked_output_path(args.output or ROOT/INPUTS[profile][2])
    if source.resolve() == dest or dest.exists() and source.exists() and dest.samefile(source):
        if not already:
            raise ValueError('拒绝覆盖原输入')
    if already:
        swf = SwfAbc(source)
        for label, lock in release[profile]['methods'].items():
            body = swf.abc.bodies[bodies.resolve(swf.abc, label)]
            if sha(body[5]) != lock['sha256'] or body[1:5] != lock['header']:
                raise ValueError('已打输入方法锁不符')
            check_body(swf.abc, body)
        raw = source.read_bytes()
    else:
        raw, e, groups = construct(source)
        record = release_record(raw, e)
        if args.prepare_locks:
            release[profile] = record
            json_write(release_path, release)
        elif record != release.get(profile):
            raise ValueError('最终 SHA/header 与固定 release 不符')
        pcode(e)
        json_write(ROOT/f'build-{profile}.json', {
            'input_sha256': digest, 'output_sha256': sha(raw), 'groups': groups,
            'changed': e.report, 'added': e.new_methods, 'traits': e.traits,
            'pool': e.pool.report()})
    if dest.exists() and dest.read_bytes() != raw:
        if not args.prepare_locks:
            raise ValueError('输出已存在且内容不同，拒绝覆盖')
    output_path(dest).write_bytes(raw)
    output_path(dest.with_suffix(dest.suffix+'.sha256')).write_text(
        sha(raw)+'  '+dest.name+'\n', encoding='ascii')
    print(json.dumps({'status': 'already_present' if already else 'built',
                      'profile': profile, 'output': str(dest), 'sha256': sha(raw)}))


if __name__ == '__main__':
    main()
