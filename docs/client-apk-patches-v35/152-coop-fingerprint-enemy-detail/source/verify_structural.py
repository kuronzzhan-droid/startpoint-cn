"""实际双SWF逐记录保持、逆插入/尾增还原、同源重放与双锁负控。"""
import argparse
import copy
import json
import bootstrap
from bootstrap import ROOT, INPUTS, sha
import asm
import bodies
from build import construct, locks, release_record, json_write
from common import freeze
from framework import Editor
from integrity import compare, unchanged_scaffolding, restore_inserted_body
from static_check import check_body, negative_controls
from swfabc import SwfAbc


def run(candidate=False):
    directory = ROOT / 'work' if candidate else ROOT
    reports, signatures = {}, []
    method_locks = locks()
    for profile, (path, _, name) in INPUTS.items():
        out = directory / name
        if not out.exists():
            raise ValueError('缺少交付物: ' + str(out))
        before, after = SwfAbc(path), SwfAbc(out)
        raw, editor, _ = construct(path)
        assert raw == out.read_bytes(), 'same source replay differs'
        assert out.with_suffix('.swf.sha256').read_text().split() == [sha(raw), name]
        report = compare(before, after, method_locks)
        report['restoration'] = unchanged_scaffolding(before, after, method_locks)
        report['insertions'] = {label: restore_inserted_body(
            before.abc.bodies[bodies.resolve(before.abc, label)],
            after.abc.bodies[bodies.resolve(after.abc, label)], detail['insertions'])
            for label, detail in editor.report.items()}
        report['same_source_byte_identical'] = True
        report['sha256'] = sha(raw)
        records = release_record(raw, editor)
        signatures.append({label: freeze(after.abc.bodies[bodies.resolve(after.abc, label)])
                           for label in records['methods']})
        report['release_methods'] = len(records['methods'])
        reports[profile] = report
    assert signatures[0] == signatures[1], 'two variants modified methods differ'
    rejected = []
    e = Editor(INPUTS['test'][0], copy.deepcopy(method_locks))
    for label, lock in method_locks.items():
        for part in ('sha', 'header'):
            e.locks[label] = copy.deepcopy(lock)
            e.locks[label][part] = '0' * 64 if part == 'sha' else [lock['header'][0] + 1, *lock['header'][1:]]
            try:
                e.replace(label, e.body(label)[5])
            except asm.AsmError:
                rejected.append(label + ':' + part)
            else:
                raise AssertionError('dual lock accepted mutation')
        e.locks[label] = lock
    for path in (ROOT.parent / 'escape.swf', ROOT / 'work' / '..' / '..' / 'escape.swf'):
        try:
            bootstrap.checked_output_path(path)
        except ValueError:
            rejected.append('output-boundary')
        else:
            raise AssertionError('output boundary accepted')
    try:
        construct(ROOT / 'baseline-locks.json')
    except ValueError:
        rejected.append('unknown-input-sha256')
    else:
        raise AssertionError('unknown input accepted')
    result = dict(status='pass', profiles=reports, dual_lock_negative_controls=rejected,
                  static_negative_controls=negative_controls(),
                  modified_and_added_methods_identical_between_variants=True,
                  scope='offline exact ABC/SWF preservation; not AIR or device acceptance')
    json_write(directory / 'framework-report.json', result)
    print(json.dumps(dict(status='pass', profiles={k: dict(changed=len(v['changed_methods']),
        added=len(v['added_methods']), unchanged=v['whole_swf_unchanged_body_records'])
        for k, v in reports.items()})))
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--candidate', action='store_true')
    run(p.parse_args().candidate)
