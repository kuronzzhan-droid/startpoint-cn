"""C18 values mode, party limit and zero disposition over the sealed C17 SWF, with byte-exact reversal."""
import copy
import json
from bootstrap import ROOT, BASE, BASE_SHA, P13, P13_SHA, FINAL
from bootstrap import require_hash, sha, write_json, output_path
from c4_build import TABLES, POOLS, body_bytes, protected_audit
from c5_constants import abc_records
from c18_values import apply as values_apply
from c18_party_gate import apply as party_apply
from c18_quality import apply as quality_apply
from framework import Editor
from common import freeze, listing
from swfabc import SwfAbc
import asm
import bodies


def main():
    assert __debug__, 'Build requires assertions'
    sources = {str(p.relative_to(ROOT)): sha(p.read_bytes())
               for p in sorted((ROOT / 'source').rglob('*.py'))}
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    editor = Editor(BASE, {})
    originals = {n: freeze(copy.deepcopy(getattr(editor.abc, n))) for n in (*TABLES, *POOLS)}
    metadata = {'values': values_apply(editor), 'party': party_apply(editor), 'quality': quality_apply(editor)}
    metadata['modified_method_count'] = len(editor.insertions)
    for label, rows in editor.insertions.items():
        anchors = [at for at, _, _ in rows]
        assert len(anchors) == len(set(anchors)), ('Shared splice needs review', label, anchors)
    editor.apply()
    assert not editor.new_methods and not editor.traits
    for name, before in originals.items():
        value = getattr(editor.abc, name)
        assert freeze(value[:len(before)] if name == 'strings' else value) == before, name
    labels = bodies.label_map(editor.abc)
    changed = [i for i, (a, b) in enumerate(zip(editor.original_bodies, editor.abc.bodies))
               if body_bytes(a) != body_bytes(b)]
    assert len(editor.original_bodies) == len(editor.abc.bodies)
    assert {labels[i] for i in changed} == set(editor.report)
    assert len(changed) == metadata['modified_method_count']
    for label, report in editor.report.items():
        i = report['body']
        assert asm.unsplice_many(editor.abc.bodies[i][5], report['insertions']) == editor.original_bodies[i][5]
        report['unsplice_recovers_c17'] = True
        for phase, body in [('c17', editor.original_bodies[i]), ('c18', editor.abc.bodies[i])]:
            name = label.replace('/', '__').replace('<', '').replace('>', '')
            output_path(ROOT / f'audit/pcode/{name}-{phase}.txt').write_text(
                '\n'.join(listing(editor.abc, body[5])) + '\n', 'utf-8')
    protected = protected_audit(SwfAbc(P13).abc, editor.abc)
    for row in protected.values():
        row['p13_equals_c18'] = row.pop('p13_equals_c4')
        row['c18_sha256'] = row.pop('c4_sha256')
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
    assert {a['name'] for a, b in zip(old, new) if a['raw'] != b['raw']} == {'boot_ffc6'}
    for i in changed:
        parsed.abc.bodies[i] = copy.deepcopy(editor.original_bodies[i])
    parsed.abc.strings = parsed.abc.strings[:len(originals['strings'])]
    assert parsed.serialize() == BASE.read_bytes()
    assert sources == {str(p.relative_to(ROOT)): sha(p.read_bytes())
                       for p in sorted((ROOT / 'source').rglob('*.py'))}
    result = {'status': 'passed', 'build_mode': 'full_c18', 'baseline': str(BASE),
              'baseline_sha256': BASE_SHA, 'output': str(FINAL), 'sha256': sha(raw),
              'metadata': metadata, 'changed': editor.report, 'changed_method_count': len(changed),
              'changed_abc_tags': ['boot_ffc6'],
              'unchanged_main_body_records': len(editor.abc.bodies) - len(changed),
              'new_methods': editor.new_methods, 'new_traits': editor.traits,
              'structural_tables_and_non_string_pools_identical': True,
              'string_pool_append_only': True,
              'added_strings': [editor.abc.s(i) for i in range(len(originals['strings']), len(editor.abc.strings))],
              'restore_changes_recovers_entire_c17_swf': True,
              'protected_methods': sum(r['method_count'] for r in protected.values()),
              'runtime_verified': False, 'sources_unchanged_during_build': True, 'sources': sources}
    write_json(ROOT / 'audit/build.json', result)
    print(json.dumps({k: result[k] for k in ('status', 'sha256', 'changed_method_count', 'protected_methods')}))


if __name__ == '__main__':
    main()
