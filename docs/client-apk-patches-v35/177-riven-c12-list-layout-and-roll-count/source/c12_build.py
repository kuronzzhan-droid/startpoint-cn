"""C12 reversible method splices with complete structural and protected checks."""
import copy
import json
from bootstrap import ROOT, BASE, BASE_SHA, P13, P13_SHA, FINAL
from bootstrap import require_hash, sha, write_json, output_path
from c4_build import TABLES, POOLS, body_bytes, protected_audit
from c5_constants import abc_records
from framework import Editor
from common import freeze, listing
from swfabc import SwfAbc
import asm
import bodies


def main():
    sources = {str(p.relative_to(ROOT)): sha(p.read_bytes())
               for p in sorted((ROOT / 'source').rglob('*.py'))}
    from c12_layout import apply as queue_layout
    from c12_badge import apply as queue_badge
    from c12_splices import join_shared_splices
    assert __debug__, 'Build assertions require Python without -O'
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    editor = Editor(BASE, {})
    tables = {n: freeze(copy.deepcopy(getattr(editor.abc, n))) for n in TABLES}
    pools = {n: copy.deepcopy(getattr(editor.abc, n)) for n in POOLS}
    metadata = {'layout': queue_layout(editor), 'badge': queue_badge(editor)}
    metadata['shared_splices'] = join_shared_splices(editor)
    assert all(value >= 0 for value in editor.abc.ints), 'Negative Python int stalls inherited ABC unsigned-varint writer'
    editor.apply()
    assert not editor.new_methods and not editor.traits
    for name, before in tables.items():
        assert freeze(getattr(editor.abc, name)) == before, name
    for name, before in pools.items():
        assert freeze(getattr(editor.abc, name)[:len(before)]) == freeze(before), name
    labels = bodies.label_map(editor.abc)
    changed = [i for i, (a, b) in enumerate(zip(editor.original_bodies, editor.abc.bodies))
               if body_bytes(a) != body_bytes(b)]
    assert len(editor.original_bodies) == len(editor.abc.bodies)
    assert {labels[i] for i in changed} == set(editor.report)
    for label, report in editor.report.items():
        i = report['body']
        assert asm.unsplice_many(editor.abc.bodies[i][5], report['insertions']) == editor.original_bodies[i][5]
        report['unsplice_recovers_c11'] = True
        for phase, body in [('c11', editor.original_bodies[i]), ('c12', editor.abc.bodies[i])]:
            filename = label.replace('/', '__').replace('<', '').replace('>', '')
            output_path(ROOT / ('audit/pcode/' + filename + '-' + phase + '.txt')).write_text(
                '\n'.join(listing(editor.abc, body[5])) + '\n', 'utf-8')
    protected = protected_audit(SwfAbc(P13).abc, editor.abc)
    for row in protected.values():
        row['p13_equals_c12'] = row.pop('p13_equals_c4')
        row['c12_sha256'] = row.pop('c4_sha256')
    write_json(ROOT / 'audit/protected-method-hashes.json', protected)
    raw = editor.swf.serialize()
    if FINAL.exists() and FINAL.read_bytes() != raw:
        assert not list((ROOT / 'apk').glob('*.apk')), 'APK already delivered'
        output_path(ROOT / f'audit/candidates/{sha(FINAL.read_bytes())}.swf').write_bytes(FINAL.read_bytes())
    output_path(FINAL).write_bytes(raw)
    parsed = SwfAbc(FINAL)
    assert parsed.serialize() == raw
    assert all(body_bytes(a) == body_bytes(b) for a, b in zip(parsed.abc.bodies, editor.abc.bodies))
    old, new = list(abc_records(BASE.read_bytes())), list(abc_records(raw))
    assert [r['name'] for r in old] == [r['name'] for r in new]
    assert [a['name'] for a, b in zip(old, new) if a['raw'] != b['raw']] == ['boot_ffc6']
    for i in changed:
        parsed.abc.bodies[i] = copy.deepcopy(editor.original_bodies[i])
    for name, before in pools.items():
        setattr(parsed.abc, name, before)
    assert parsed.serialize() == BASE.read_bytes()
    current_sources = {str(p.relative_to(ROOT)): sha(p.read_bytes())
                       for p in sorted((ROOT / 'source').rglob('*.py'))}
    assert current_sources == sources, 'Source changed during build; rerun from stable sources'
    result = {'status': 'passed', 'baseline': str(BASE), 'baseline_sha256': BASE_SHA,
              'output': str(FINAL), 'sha256': sha(raw), 'metadata': metadata,
              'changed': editor.report, 'changed_method_count': len(changed),
              'unchanged_main_body_records': len(editor.abc.bodies) - len(changed),
              'new_methods': editor.new_methods, 'new_traits': editor.traits,
              'structural_tables_identical': list(TABLES), 'constant_pools_append_only': True,
              'constant_pool': editor.pool.report(), 'restore_changes_recovers_entire_c11_swf': True,
              'protected_methods': sum(r['method_count'] for r in protected.values()),
              'runtime_verified': False,
              'sources_unchanged_during_build': True, 'sources': sources}
    write_json(ROOT / 'audit/build.json', result)
    print(json.dumps({k: result[k] for k in ('status', 'sha256', 'changed_method_count', 'protected_methods')}))


if __name__ == '__main__':
    main()
