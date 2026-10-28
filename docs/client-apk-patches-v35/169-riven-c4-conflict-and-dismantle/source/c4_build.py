"""C4 single-method splice build, structural audit and protected-class comparison."""
import copy
import json
from bootstrap import ROOT, BASE, P13, FINAL, BASE_SHA, P13_SHA, require_hash, sha, write_json, output_path
import asm
import bodies
from common import freeze, listing
from framework import Editor
from swfabc import SwfAbc, abcfmt

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
        rows[cls] = {'method_count': len(indices), 'p13_equals_c4': True,
                     'p13_sha256': sha(b''.join(body_bytes(base.bodies[i]) for i in indices)),
                     'c4_sha256': sha(b''.join(body_bytes(final.bodies[i]) for i in indices)),
                     'methods': records}
    return rows


def main():
    from c4_requests import queue_requests_splices
    from c4_save import queue_save_splices
    from c4_ranges import queue_range_splices
    from c4_conflict import queue_conflict_splices
    from c4_dismantle import queue_dismantle_splices
    from c4_party import queue_party_splices
    from c4_admission import patch, verify_tags
    if not __debug__:
        raise RuntimeError('Build assertions require Python without -O')
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    print('C4: inputs verified; loading C3', flush=True)
    e = Editor(BASE, {})
    before = e.original_bodies
    tables = {n: freeze(copy.deepcopy(getattr(e.abc, n))) for n in TABLES}
    pools = {n: copy.deepcopy(getattr(e.abc, n)) for n in POOLS}
    metadata = {}
    owners = {}
    for name, fn in [('requests', queue_requests_splices), ('save', queue_save_splices), ('party', queue_party_splices),
                     ('conflict', queue_conflict_splices), ('dismantle', queue_dismantle_splices),
                     ('ranges', queue_range_splices)]:
        prior = {k: len(v) for k, v in e.insertions.items()}
        metadata[name] = fn(e)
        for label, additions in e.insertions.items():
            if len(additions) > prior.get(label, 0):
                owners.setdefault(label, []).append(name)
    # Modules can splice distinct offsets of one existing method; all original bytes
    # must still be recovered by the combined unsplice verification below.
    # The inherited writer stores signed-pool bytes as unsigned varints. Reject
    # negative Python ints before serialization; emit positive+negate_i instead.
    assert all(v >= 0 for v in e.abc.ints), 'negative Python int would stall the inherited ABC writer'
    e.apply()
    print('C4: all method splices and static checks passed', flush=True)
    assert not e.new_methods and not e.traits
    for name, value in tables.items():
        assert freeze(getattr(e.abc, name)) == value, name
    for name, value in pools.items():
        assert freeze(getattr(e.abc, name)[:len(value)]) == freeze(value), name
    assert len(before) == len(e.abc.bodies)
    labels = bodies.label_map(e.abc)
    changed = [i for i, (old, new) in enumerate(zip(before, e.abc.bodies))
               if body_bytes(old) != body_bytes(new)]
    assert {labels[i] for i in changed} == set(e.report)
    p13 = SwfAbc(P13)
    write_json(ROOT / 'audit/protected-method-hashes.json', protected_audit(p13.abc, e.abc))
    del p13, pools, tables
    for label, item in e.report.items():
        i = item['body']
        assert asm.unsplice_many(e.abc.bodies[i][5], item['insertions']) == before[i][5], label
        item['unsplice_recovers_c3'] = True
        for phase, body in [('c3', before[i]), ('c4', e.abc.bodies[i])]:
            filename = label.replace('/', '__').replace('<', '').replace('>', '')
            output_path(ROOT / f'audit/pcode/{filename}-{phase}.txt').write_text(
                '\n'.join(listing(e.abc, body[5])) + '\n', 'utf-8')
    print('C4: protected hashes and reversible splices verified; serializing', flush=True)
    raw, admission = patch(e.swf.serialize())
    write_json(ROOT / 'audit/admission-identity.json', admission)
    tag_audit = verify_tags(BASE.read_bytes(), raw)
    if FINAL.exists() and FINAL.read_bytes() != raw:
        if any((ROOT / 'apk').glob('*.apk')):
            raise FileExistsError('Refusing to change SWF after APK delivery exists')
        prior = sha(FINAL.read_bytes())
        archived = ROOT / f'audit/candidates/boot-{prior}.swf'
        if not archived.exists():
            output_path(archived).write_bytes(FINAL.read_bytes())
    output_path(FINAL).write_bytes(raw)
    print('C4: SWF written; performing parse-back comparison', flush=True)
    parsed = SwfAbc(FINAL)
    assert parsed.serialize() == raw
    assert all(body_bytes(a) == body_bytes(b) for a,b in zip(parsed.abc.bodies,e.abc.bodies))
    assert verify_tags(BASE.read_bytes(), raw) == tag_audit
    write_json(ROOT / 'audit/build.json', {
        'status': 'passed', 'baseline': str(BASE), 'baseline_sha256': BASE_SHA,
        'output': str(FINAL), 'sha256': sha(raw), 'metadata': metadata, 'owners': owners,
        'changed': e.report, 'changed_method_count': len(changed),
        'preserved_c3_body_records': len(before)-len(changed), 'body_count': len(before),
        'new_methods': e.new_methods, 'new_traits': e.traits,
        'structural_tables_identical': list(TABLES), 'constant_pool': e.pool.report(),
        'admission_constant': admission, 'swf_tags': tag_audit, 'runtime_verified': False,
        'sources': {str(p.relative_to(ROOT)): sha(p.read_bytes())
                    for p in sorted((ROOT / 'source').rglob('*.py'))}})
    print(json.dumps({'status': 'passed', 'swf_sha256': sha(raw), 'changed_method_count': len(changed)}))


if __name__ == '__main__':
    main()
