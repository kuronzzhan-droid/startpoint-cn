"""Assemble and audit the C1 patch exclusively from existing method-body splices."""
import copy
import json

from bootstrap import ROOT, BASE, P13, FINAL, BASE_SHA, P13_SHA, require_hash, sha, write_json, output_path
import asm
import bodies
from common import freeze, listing
from framework import Editor
from swfabc import SwfAbc, abcfmt
from c1_save import queue_save_splices
from c1_types import queue_type_splices
from c1_dynamic import queue_dynamic_splices

TABLES = ('methods', 'instances', 'classes', 'scripts', 'metadata', 'namespaces', 'ns_sets')
POOLS = ('strings', 'ints', 'uints', 'doubles', 'multinames')
PROTECTED = ('ActionEvaluator', 'NormalAttackCalculator', 'MemberImpl', 'AbilityDamageShot')


def body_bytes(body):
    writer = abcfmt.W()
    for n in body[:5]:
        writer.u30(n)
    writer.u30(len(body[5]))
    writer.raw(body[5])
    writer.u30(len(body[6]))
    for exception in body[6]:
        for n in exception:
            writer.u30(n)
    writer.u30(len(body[7]))
    for trait in body[7]:
        abcfmt.write_trait(writer, trait)
    return writer.out()


def protected_audit(base, final):
    labels = bodies.label_map(base)
    rows = {}
    for cls in PROTECTED:
        indices = [i for i, label in labels.items() if label.split('/')[0].rstrip('$') == cls]
        assert indices
        records = []
        for i in indices:
            old, new = body_bytes(base.bodies[i]), body_bytes(final.bodies[i])
            assert old == new, labels[i]
            records.append({'label': labels[i], 'body': i, 'sha256': sha(old)})
        rows[cls] = {'method_count': len(indices), 'p13_equals_c1': True,
                     'p13_sha256': sha(b''.join(body_bytes(base.bodies[i]) for i in indices)),
                     'c1_sha256': sha(b''.join(body_bytes(final.bodies[i]) for i in indices)),
                     'methods': records}
    return rows


def main():
    if not __debug__:
        raise RuntimeError('Build assertions require Python without -O')
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    e = Editor(BASE, {})
    before = e.original_bodies
    baseline_tables = {n: freeze(copy.deepcopy(getattr(e.abc, n))) for n in TABLES}
    pools = {n: copy.deepcopy(getattr(e.abc, n)) for n in POOLS}
    metadata = {'save': queue_save_splices(e), 'types': queue_type_splices(e),
                'dynamic': queue_dynamic_splices(e)}
    e.apply()
    assert not e.new_methods and not e.traits
    for name, value in baseline_tables.items():
        assert freeze(getattr(e.abc, name)) == value, name
    for name, value in pools.items():
        assert freeze(getattr(e.abc, name)[:len(value)]) == freeze(value), name
    assert len(before) == len(e.abc.bodies)
    labels = bodies.label_map(e.abc)
    changed = [i for i, (old, new) in enumerate(zip(before, e.abc.bodies))
               if body_bytes(old) != body_bytes(new)]
    assert {labels[i] for i in changed} == set(e.report)
    p13 = SwfAbc(P13)
    protected = protected_audit(p13.abc, e.abc)
    write_json(ROOT / 'audit/protected-method-hashes.json', protected)
    for label, item in e.report.items():
        i = item['body']
        item['splice_base_sha256'] = item['before']
        item['p0c_before_sha256'] = sha(before[i][5])
        item['p0c_before_header'] = before[i][1:5]
        original = p13.abc.bodies[i] if label in metadata['dynamic']['restored_from_p0c'] else before[i]
        assert asm.unsplice_many(e.abc.bodies[i][5], item['insertions']) == original[5], label
        item['unsplice_recovers_original'] = True
        for phase, abc, body in [('p0c', p13.abc, before[i]), ('c1', e.abc, e.abc.bodies[i])]:
            # Use current pool to resolve indices; pre-existing entries remain identical.
            output_path(ROOT / f'audit/pcode/{label.replace("/", "__")}-{phase}.txt').write_text(
                '\n'.join(listing(e.abc, body[5])) + '\n', 'utf-8')
    raw = e.swf.serialize()
    if FINAL.exists() and FINAL.read_bytes() != raw:
        if any((ROOT / 'apk').glob('*.apk')):
            raise FileExistsError('Refusing to change SWF after APK delivery exists')
        prior = sha(FINAL.read_bytes())
        archived = ROOT / f'audit/candidates/boot-{prior}.swf'
        if not archived.exists():
            output_path(archived).write_bytes(FINAL.read_bytes())
    output_path(FINAL).write_bytes(raw)
    parsed = SwfAbc(FINAL)
    assert parsed.serialize() == raw
    assert all(body_bytes(a) == body_bytes(b) for a,b in zip(parsed.abc.bodies,e.abc.bodies))
    assert parsed.body[:parsed._offset] == e.swf.body[:e.swf._offset]
    assert parsed.body[parsed._offset+parsed._length:] == e.swf.body[e.swf._offset+e.swf._length:]
    report = {'status': 'passed', 'baseline': str(BASE), 'baseline_sha256': BASE_SHA,
              'output': str(FINAL), 'sha256': sha(raw), 'metadata': metadata,
              'changed': e.report, 'changed_method_count': len(changed),
              'preserved_p0c_body_records': len(before)-len(changed), 'body_count': len(before),
              'new_methods': e.new_methods, 'new_traits': e.traits,
              'structural_tables_identical': list(TABLES), 'constant_pool': e.pool.report(),
              'non_main_abc_tags_identical': True, 'runtime_verified': False,
              'sources': {str(p.relative_to(ROOT)): sha(p.read_bytes())
                          for p in sorted((ROOT / 'source').glob('c1_*.py'))}}
    write_json(ROOT / 'audit/build.json', report)
    print(json.dumps({'status': 'passed', 'swf_sha256': sha(raw),
                      'changed_method_count': len(changed), 'new_methods': [], 'new_traits': []}))


if __name__ == '__main__':
    main()
