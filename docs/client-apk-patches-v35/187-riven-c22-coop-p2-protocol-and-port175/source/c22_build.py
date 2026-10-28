"""C21-locked reversible inline P2 build; no new runtime methods or traits."""
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
    from c22_types import apply as types
    from c22_consumer import apply as consumer
    from c22_protocol import apply as protocol
    from c22_restore import apply as restore
    from c22_admission import patch, reverse
    from c22_catalog import CATALOG_ID
    from c22_catalog_build import verify_locked
    assert __debug__
    sources = {str(p.relative_to(ROOT)): sha(p.read_bytes())
               for p in sorted((ROOT / 'source').rglob('*.py'))}
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    resource_lock = verify_locked()
    editor = Editor(BASE, {})
    originals = {n: copy.deepcopy(getattr(editor.abc, n)) for n in (*TABLES, *POOLS)}
    metadata = {'types': types(editor), 'consumer': consumer(editor),
                'protocol': protocol(editor), 'restore': restore(editor, CATALOG_ID)}
    expected = set(editor.insertions)
    for label, rows in editor.insertions.items():
        anchors = [at for at, _, _ in rows]
        assert len(anchors) == len(set(anchors)), ('Shared splice', label, anchors)
    editor.apply()
    assert not editor.new_methods and not editor.traits
    for name, before in originals.items():
        value = getattr(editor.abc, name)
        assert freeze(value[:len(before)] if name in POOLS else value) == freeze(before), name
    labels = bodies.label_map(editor.abc)
    changed = [i for i, (a, b) in enumerate(zip(editor.original_bodies, editor.abc.bodies))
               if body_bytes(a) != body_bytes(b)]
    assert len(editor.original_bodies) == len(editor.abc.bodies)
    assert {labels[i] for i in changed} == set(editor.report) == expected
    for label, report in editor.report.items():
        i = report['body']
        assert asm.unsplice_many(editor.abc.bodies[i][5], report['insertions']) == editor.original_bodies[i][5]
        report['unsplice_recovers_c21'] = True
        for phase, body in [('c21', editor.original_bodies[i]), ('c22', editor.abc.bodies[i])]:
            name = label.replace('/', '__').replace('<', '').replace('>', '')
            output_path(ROOT / f'audit/pcode/{name}-{phase}.txt').write_text(
                '\n'.join(listing(editor.abc, body[5])) + '\n', 'utf-8')
    protected = protected_audit(SwfAbc(P13).abc, editor.abc)
    for row in protected.values():
        row['p13_equals_c22'] = row.pop('p13_equals_c4')
        row['c22_sha256'] = row.pop('c4_sha256')
    write_json(ROOT / 'audit/protected-method-hashes.json', protected)
    method_raw = editor.swf.serialize()
    raw, admission = patch(method_raw)
    assert reverse(raw) == method_raw, 'Admission patch must exactly reverse'
    if FINAL.exists() and FINAL.read_bytes() != raw:
        assert not list((ROOT / 'apk').glob('*.apk')), 'APK already delivered'
        output_path(ROOT / f'audit/candidates/{sha(FINAL.read_bytes())}.swf').write_bytes(FINAL.read_bytes())
    output_path(FINAL).write_bytes(raw)
    parsed = SwfAbc(FINAL)
    assert parsed.serialize() == raw
    assert all(body_bytes(a) == body_bytes(b) for a, b in zip(parsed.abc.bodies, editor.abc.bodies))
    old, new = list(abc_records(BASE.read_bytes())), list(abc_records(raw))
    assert [r['name'] for r in old] == [r['name'] for r in new]
    changed_tags = [a['name'] for a, b in zip(old, new) if a['raw'] != b['raw']]
    # Reverse raw admission first, then every splice and appended pool entry.
    restored = copy.deepcopy(editor.swf)
    for i in changed:
        restored.abc.bodies[i] = copy.deepcopy(editor.original_bodies[i])
    for name in POOLS:
        setattr(restored.abc, name, copy.deepcopy(originals[name]))
    assert restored.serialize() == BASE.read_bytes()
    assert sources == {str(p.relative_to(ROOT)): sha(p.read_bytes())
                       for p in sorted((ROOT / 'source').rglob('*.py'))}
    result = {'status': 'passed', 'build_mode': 'full_c22', 'baseline': str(BASE),
              'baseline_sha256': BASE_SHA, 'output': str(FINAL), 'sha256': sha(raw),
              'metadata': metadata, 'admission': admission, 'catalog_id': CATALOG_ID,
              'resource_lock': resource_lock,
              'changed': editor.report, 'changed_method_count': len(changed),
              'changed_abc_tags': changed_tags,
              'unchanged_main_body_records': len(editor.abc.bodies) - len(changed),
              'new_methods': editor.new_methods, 'new_traits': editor.traits,
              'structural_tables_identical': True, 'pools_append_only': True,
              'added_pool_counts': {n: len(getattr(editor.abc, n)) - len(v)
                                    for n, v in originals.items() if n in POOLS},
              'restore_changes_recovers_entire_c21_swf': True,
              'protected_methods': sum(r['method_count'] for r in protected.values()),
              'runtime_verified': False, 'sources_unchanged_during_build': True, 'sources': sources}
    write_json(ROOT / 'audit/build.json', result)
    print(json.dumps({k: result[k] for k in ('status', 'sha256', 'changed_method_count', 'protected_methods')}))


if __name__ == '__main__':
    main()
