"""Build P0c from p13 with the approved six-string / 15-operand exception."""
import copy
import json

from bootstrap import (ROOT, P0, BASE, FINAL, P0B, BASE_SHA, require_hash,
                       sha, write_immutable, write_json)
import bodies
from common import freeze, listing
from framework import Editor
from swfabc import SwfAbc
from rebase_splices import TARGETS, STRINGS, RELOCATION, rebase_body

P0B_SHA = 'aa5151d917a2b5b80dbcc1ebc39fa38b65fc9c29b53a29569a8b2fcf849f7daa'
TABLES = ('methods', 'instances', 'classes', 'scripts', 'metadata',
          'namespaces', 'ns_sets', 'multinames')


def locked_json(path, lock):
    expected = next(row['sha256'] for row in lock['preserved_p0_files']
                    if row['path'] == str(path))
    require_hash(path, expected)
    return json.loads(path.read_text('utf-8-sig'))


def main():
    require_hash(BASE, BASE_SHA)
    require_hash(P0B, P0B_SHA)
    lock = json.loads((ROOT / 'audit/input-lock.json').read_text('utf-8'))
    p0a_report = locked_json(P0 / 'build/build-audit/riven-build.json', lock)
    p0b_report = locked_json(P0 / 'build-p0b/audit/build.json', lock)
    editor, source = Editor(BASE, {}), SwfAbc(P0B)
    before = editor.original_bodies
    tables = {name: freeze(copy.deepcopy(getattr(editor.abc, name))) for name in TABLES}
    pools = {name: copy.deepcopy(getattr(editor.abc, name))
             for name in ('strings', 'ints', 'uints', 'doubles')}
    assert len(pools['strings']) == 94303
    assert [source.abc.s(i) for i in RELOCATION] == list(STRINGS)
    for old, new in RELOCATION.items():
        assert editor.pool.string(source.abc.strings[old]) == new
    assert editor.abc.strings[94303:] == [text.encode('utf-8') for text in STRINGS]
    relocation_reports = {}
    for label in TARGETS:
        original = copy.deepcopy(editor.body(label))
        donor = source.abc.bodies[bodies.resolve(source.abc, label)]
        report = p0a_report if label == TARGETS[0] else p0b_report
        change = report['changed'][label]
        assert sha(donor[5]) == change['after']
        recovery = change.get('p12b_splice_recovery', change.get('insertions'))
        code, exceptions, audit = rebase_body(original, donor, recovery, label)
        editor.locks[label] = {'sha': sha(original[5]), 'header': original[1:5]}
        editor.replace(label, code, exceptions, list(donor[1:5]))
        actual = editor.body(label)
        assert actual[:5] == donor[:5] and freeze(actual[6:]) == freeze(donor[6:])
        editor.report[label].update(audit)
        relocation_reports[label] = audit['operand_differences']
        for phase, abc, body in (('p13', editor.abc, original),
                                 ('p0b', source.abc, donor),
                                 ('p0c', editor.abc, actual)):
            path = ROOT / 'audit/pcode' / f'{label.replace("/", "__")}-{phase}.txt'
            write_immutable(path, ('\n'.join(listing(abc, body[5])) + '\n').encode('utf-8'))
    editor.apply()
    assert not editor.new_methods and not editor.traits
    assert set(editor.report) == set(TARGETS)
    for name, value in tables.items():
        assert freeze(getattr(editor.abc, name)) == value, name
    for name, value in pools.items():
        current = getattr(editor.abc, name)
        assert freeze(current[:len(value)]) == freeze(value), name
        assert len(current) == len(value) + (6 if name == 'strings' else 0)
    targets = {bodies.resolve(editor.abc, label) for label in TARGETS}
    assert len(before) == len(editor.abc.bodies) == 92772
    for index, body in enumerate(before):
        if index not in targets:
            assert freeze(body) == freeze(editor.abc.bodies[index]), index
    raw = editor.swf.serialize()
    write_immutable(FINAL, raw)
    parsed = SwfAbc(FINAL)
    assert parsed.serialize() == raw
    for actual, expected in zip(parsed.abc.bodies, editor.abc.bodies):
        assert freeze(actual) == freeze(expected)
    report = {
        'status': 'passed', 'baseline': str(BASE), 'baseline_sha256': BASE_SHA,
        'p0b_sha256': P0B_SHA, 'output': str(FINAL), 'sha256': sha(raw),
        'approved_exception': 'Tail append six original strings; relocate 15 inserted pushstring operands only.',
        'approval_source': 'User continuation instruction, task author Claude decision, 2026-10-25',
        'changed': editor.report, 'relocation_instruction_count': sum(map(len, relocation_reports.values())),
        'relocation_byte_count': sum(map(len, relocation_reports.values())),
        'constant_pool': editor.pool.report(), 'new_methods': editor.new_methods,
        'new_traits': editor.traits, 'preserved_p13_body_records': len(before) - len(targets),
        'structural_tables_identical': list(TABLES), 'runtime_verified': False,
        'sources': {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in
                    (ROOT / 'source/build_p0c.py', ROOT / 'source/rebase_splices.py')},
    }
    assert report['relocation_instruction_count'] == report['relocation_byte_count'] == 15
    write_json(ROOT / 'audit/build.json', report)
    print(json.dumps({key: report[key] for key in ('status', 'output', 'sha256',
                     'relocation_instruction_count', 'preserved_p13_body_records')}))


if __name__ == '__main__':
    main()
