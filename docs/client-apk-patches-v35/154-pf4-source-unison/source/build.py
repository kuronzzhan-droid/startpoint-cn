"""v35o → 通用 PF4 候选。未知底包需 --allow-other-base，仍严格锁方法 SHA+header。"""
import argparse
import json
from pathlib import Path
import bootstrap
from bootstrap import ROOT, INPUTS, sha, output_path, checked_output_path
import bodies
from common import describe
import asm
from swfabc import SwfAbc
from framework import Editor
from evidence import json_write, method_record, write_pcode
from src import patch


def locks():
    return json.loads((ROOT / 'baseline-locks.json').read_text(encoding='utf-8'))


def release_locks():
    path = ROOT / 'release-locks.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def prepare_baseline():
    """仅研发冻结；以后重放不得用此选项改变已锁输入。"""
    bootstrap.check_baseline()
    abc = SwfAbc(INPUTS['test'][0]).abc
    result = {}
    for label in patch.TARGETS:
        body = abc.bodies[bodies.resolve(abc, label)]
        result[label] = {'sha': sha(body[5]), 'header': body[1:5]}
    path = ROOT / 'baseline-locks.json'
    if path.exists() and locks() != result:
        raise ValueError('已存在的基线锁不同，拒绝重写')
    json_write(path, result)


def construct(path):
    editor = Editor(path, locks())
    for label in patch.TARGETS:
        body, lock = editor.body(label), editor.locks[label]
        if sha(body[5]) != lock['sha'] or body[1:5] != lock['header']:
            raise ValueError('方法 SHA/header 不符: ' + label)
    for cls, name in patch.MARKERS:
        index, row = editor.instance(cls)
        if any(editor.abc.mn_name(t.name).split('::')[-1] == name
               for t in row[6] + editor.abc.classes[index][1]):
            raise ValueError('已有补丁标记而基线方法未匹配: ' + cls + '.' + name)
    report = patch.build(editor)
    editor.apply()
    return editor.swf.serialize(), editor, report


def release_record(raw, editor):
    return {'sha256': sha(raw), 'methods': method_record(editor)}


def already_patched(path):
    data = path.read_bytes()
    for profile, entry in release_locks().items():
        if sha(data) != entry['sha256']:
            continue
        abc = SwfAbc(path).abc
        for label, lock in entry['methods'].items():
            body = abc.bodies[bodies.resolve(abc, label)]
            if sha(body[5]) != lock['sha256'] or body[1:5] != lock['header']:
                raise ValueError('已打整包中的方法锁不符: ' + label)
        return profile
    return None


def normalized(abc, code):
    return [describe(abc, item) for item in asm.decode(code)]


def normalized_record(editor):
    return {label: {'instructions': normalized(editor.abc, editor.body(label)[5]),
                    'header': editor.body(label)[1:5]} for label in method_record(editor)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--allow-other-base', action='store_true')
    parser.add_argument('--prepare-locks', action='store_true')
    args = parser.parse_args()
    bootstrap.check_baseline()
    if args.prepare_locks:
        prepare_baseline()
    source = (args.input or INPUTS['test'][0]).resolve()
    data, profile = source.read_bytes(), 'other'
    digest = sha(data)
    for name, (_, expected, _) in INPUTS.items():
        if digest == expected:
            profile = name
    done = already_patched(source) if profile == 'other' else None
    if profile == 'other' and not done and not args.allow_other_base:
        raise ValueError('未知输入整包 SHA；后续底包重放须 --allow-other-base，仍锁方法 SHA/header')
    if args.output:
        destination = checked_output_path(args.output)
    elif profile != 'other':
        destination = ROOT / INPUTS[profile][2]
    else:
        raise ValueError('未知/已打输入需显式指定当前目录内 --output')
    if destination == source or any(destination == entry[0].resolve() for entry in INPUTS.values()):
        raise ValueError('拒绝覆盖输入')
    if done:
        raw, status = data, 'already_present'
    else:
        raw, editor, detail = construct(source)
        record = release_record(raw, editor)
        if profile != 'other':
            release = release_locks()
            if args.prepare_locks:
                release[profile] = record
                json_write(ROOT / 'release-locks.json', release)
                json_write(ROOT / 'normalized-methods.json', normalized_record(editor))
            elif release.get(profile) != record:
                raise ValueError('输出方法/整包不匹配最终锁')
            write_pcode(editor, ROOT / 'pcode')
            json_write(ROOT / f'build-{profile}.json', {'input': str(source), 'input_sha256': digest,
                       'output_sha256': sha(raw), 'changed': editor.report, 'added': editor.new_methods,
                       'traits': editor.traits, 'pool': editor.pool.report(), 'details': detail})
        else:
            reference = json.loads((ROOT / 'normalized-methods.json').read_text(encoding='utf-8'))
            if normalized_record(editor) != reference:
                raise ValueError('后续底包输出方法与正式候选不同')
        status = 'built'
    if destination.exists() and destination.read_bytes() != raw:
        raise ValueError('已有不同内容的输出，拒绝覆盖: ' + str(destination))
    output_path(destination).write_bytes(raw)
    output_path(destination.with_suffix('.swf.sha256')).write_text(sha(raw) + '  ' + destination.name + '\n', encoding='ascii')
    print(json.dumps({'status': status, 'profile': profile, 'output': str(destination), 'sha256': sha(raw)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
