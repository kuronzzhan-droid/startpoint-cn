"""C6: guard the C4 global scene notice while LoadedData is Option.None."""
import copy
import json
from bootstrap import (ROOT, BASE, BASE_SHA, P13, P13_SHA, FINAL,
                       require_hash, sha, write_json, write_immutable, output_path)
from c4_build import TABLES, POOLS, body_bytes, protected_audit
from framework import Editor
from common import freeze, listing
from swfabc import SwfAbc
import asm

LABEL = 'LogicScene/finishTransition'


def queue_guard(editor):
    body = editor.body(LABEL)
    ops = asm.decode(body[5])
    sites = [i for i, op in enumerate(ops) if op.name == 'callproperty'
             and editor.abc.mn_name(op.args[0]) == 'getLoadedData']
    assert sites == [240], sites
    at = sites[0]
    assert [op.name for op in ops[at - 5:at]] == ['getlex'] + ['getproperty'] * 4
    assert [editor.abc.mn_name(op.args[0]) for op in ops[at - 5:at]] == [
        'PinballClientMain', 'top', 'logic', 'globalLogic', 'logicStatus']
    assert ops[at].args[1] == 0 and ops[-1].name == 'returnvoid'
    assert body[6:] == [[], []]
    editor.locks[LABEL] = {'sha': sha(body[5]), 'header': body[1:5]}
    # Check the exact receiver already on the operand stack. None is a valid
    # pre-login state, and the original transition work has already completed.
    # Some retains the existing getter, notice ownership and one-shot behavior.
    editor.insert(LABEL, at, [
        ('dup',), ('getproperty', editor.q('loadedData')),
        ('getproperty', editor.q('index')), ('pushbyte', 0),
        ('ifeq', 'c6_loaded_ready'), ('pop',), ('returnvoid',),
        ('label', 'c6_loaded_ready')])
    return {'method': LABEL, 'instruction': at, 'guard': 'loadedData.index == 0 (Some)',
            'none_behavior': 'return after all original transition work, before C4 notice getter',
            'some_behavior': 'unchanged C4 notice and getLoadedData'}


def main():
    assert __debug__, 'Build assertions require Python without -O'
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    editor = Editor(BASE, {})
    tables = {name: freeze(copy.deepcopy(getattr(editor.abc, name))) for name in (*TABLES, *POOLS)}
    metadata = queue_guard(editor)
    editor.apply()
    assert not editor.new_methods and not editor.traits
    for name, before in tables.items():
        assert freeze(getattr(editor.abc, name)) == before, name
    changed = [i for i, (a, b) in enumerate(zip(editor.original_bodies, editor.abc.bodies))
               if body_bytes(a) != body_bytes(b)]
    report = editor.report[LABEL]
    assert changed == [report['body']]
    assert asm.unsplice_many(editor.body(LABEL)[5], report['insertions']) == editor.original_bodies[changed[0]][5]
    report['unsplice_recovers_c5'] = True
    protected = protected_audit(SwfAbc(P13).abc, editor.abc)
    for item in protected.values():
        item['p13_equals_c6'] = item.pop('p13_equals_c4')
        item['c6_sha256'] = item.pop('c4_sha256')
    write_json(ROOT / 'audit/protected-method-hashes.json', protected)
    for phase, body in [('c5', editor.original_bodies[changed[0]]), ('c6', editor.body(LABEL))]:
        output_path(ROOT / f'audit/pcode/LogicScene__finishTransition-{phase}.txt').write_text(
            '\n'.join(listing(editor.abc, body[5])) + '\n', 'utf-8')
    raw = editor.swf.serialize()
    write_immutable(FINAL, raw)
    parsed = SwfAbc(FINAL)
    assert parsed.serialize() == raw
    assert all(body_bytes(a) == body_bytes(b) for a, b in zip(parsed.abc.bodies, editor.abc.bodies))
    from c5_constants import abc_records
    old_records, new_records = list(abc_records(BASE.read_bytes())), list(abc_records(raw))
    assert [r['name'] for r in old_records] == [r['name'] for r in new_records]
    assert [a['name'] for a, b in zip(old_records, new_records) if a['raw'] != b['raw']] == ['boot_ffc6']
    # Restore the sole changed body and require the complete original SWF bytes.
    parsed.abc.bodies[changed[0]] = copy.deepcopy(editor.original_bodies[changed[0]])
    assert parsed.serialize() == BASE.read_bytes()
    result = {'status': 'passed', 'baseline': str(BASE), 'baseline_sha256': BASE_SHA,
              'output': str(FINAL), 'sha256': sha(raw), 'metadata': metadata,
              'changed': editor.report, 'changed_method_count': 1,
              'unchanged_main_body_records': len(editor.abc.bodies) - 1,
              'new_methods': editor.new_methods, 'new_traits': editor.traits,
              'all_structural_tables_and_constant_pools_identical': True,
              'restore_one_body_recovers_entire_c5_swf': True,
              'protected_methods': sum(x['method_count'] for x in protected.values()),
              'runtime_verified': False,
              'sources': {str(p.relative_to(ROOT)): sha(p.read_bytes())
                          for p in sorted((ROOT / 'source').rglob('*.py'))}}
    write_json(ROOT / 'audit/build.json', result)
    print(json.dumps({k: result[k] for k in ('status', 'sha256', 'changed_method_count', 'protected_methods')}))


if __name__ == '__main__':
    main()
