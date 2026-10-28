"""Apply the round2 single-method inserts to a riven wt SWF (1008092 or a merged 1008093).

usage: python -B -X utf8 r2_apply.py --in <swf> --out <swf> [--catalog <json>] [--resources <dir>]
       [--only f1009,themed,party,catalog] [--report <json>]

Guarantees asserted on every run:
  * no new methods / traits; method, instance, class, script, metadata, namespace,
    ns-set tables identical; constant pools append-only;
  * every changed method unsplices back to its input bytes; restoring changed bodies
    and truncating pools reproduces the input SWF byte for byte;
  * ActionEvaluator / NormalAttackCalculator / MemberImpl / AbilityDamageShot bodies untouched;
  * static stack/scope/control-flow check on every changed body (framework.replace).
"""
import argparse
import copy
import json
import sys
from pathlib import Path
import r2_paths
from r2_paths import ROOT, ROUND2
from framework import Editor
from common import freeze
import asm
import bodies
from r2_common import Queue, sha, PROTECTED
from r2_f1009 import queue_f1009
from r2_themed import queue_themed
from r2_party import queue_consumer, queue_translate, queue_present
import r2_catalog

TABLES = ('methods', 'instances', 'classes', 'scripts', 'metadata', 'namespaces', 'ns_sets')
POOLS = ('strings', 'ints', 'uints', 'doubles', 'multinames')
FEATURES = ('f1009', 'themed', 'party', 'catalog')


def body_bytes(body):
    return repr(body[:5]).encode() + body[5] + repr(body[6]).encode() + repr(
        [(t.name, t.kind, t.attr, t.data, t.metadata) for t in (body[7] if len(body) > 7 else [])]).encode()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--catalog', default=str(ROUND2 / 'p2-catalog.json'))
    ap.add_argument('--resources')
    ap.add_argument('--only', default=','.join(FEATURES))
    ap.add_argument('--report')
    a = ap.parse_args(argv)
    src, out = Path(a.src), Path(a.out)
    assert src.resolve() != out.resolve()
    features = a.only.split(',')
    raw_in = src.read_bytes()
    e = Editor(src, {})
    originals = {n: copy.deepcopy(getattr(e.abc, n)) for n in (*TABLES, *POOLS)}
    q = Queue(e)
    meta = {}
    if 'f1009' in features:
        meta['f1009'] = queue_f1009(q)
    if 'themed' in features:
        meta['themed'] = queue_themed(q)
    if 'party' in features:
        meta['party'] = {'consumer': queue_consumer(q), 'translate': queue_translate(q),
                         'present': queue_present(q)}
    if 'catalog' in features:
        cat = r2_catalog.load(a.catalog, a.resources)
        meta['catalog'] = {'parameter': cat, **r2_catalog.queue_catalog(q, cat['catalog_id'])}
    for label, adds in e.insertions.items():
        pts = [x[0] for x in adds]
        assert len(pts) == len(set(pts)), ('duplicate anchor', label, pts)
    e.apply()
    assert not e.new_methods and not e.traits
    assert len(e.abc.bodies) == len(e.original_bodies)
    for n, before in originals.items():
        after = getattr(e.abc, n)
        assert freeze(after[:len(before)] if n in POOLS else after) == freeze(before), n
    labels = bodies.label_map(e.abc)
    changed = [i for i, (x, y) in enumerate(zip(e.original_bodies, e.abc.bodies)) if body_bytes(x) != body_bytes(y)]
    for i in changed:
        assert labels[i].split('/')[0].split('$')[0] not in PROTECTED, labels[i]
    for label, row in e.report.items():
        assert asm.unsplice_many(e.body(label)[5], row['insertions']) == e.original_bodies[row['body']][5]
    raw = e.swf.serialize()
    restored = copy.deepcopy(e.swf)
    for i in changed:
        restored.abc.bodies[i] = copy.deepcopy(e.original_bodies[i])
    for n in POOLS:
        setattr(restored.abc, n, copy.deepcopy(originals[n]))
    assert restored.serialize() == raw_in, 'reverse does not recover input SWF'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    report = {'status': 'passed', 'input': str(src), 'input_sha256': sha(raw_in), 'output': str(out),
              'output_sha256': sha(raw), 'features': features, 'meta': meta,
              'changed_methods': sorted(labels[i] for i in changed), 'changed_method_count': len(changed),
              'insert_count': len(q.rows), 'inserts': q.rows,
              'pool_growth': {n: len(getattr(e.abc, n)) - len(originals[n]) for n in POOLS},
              'new_methods': 0, 'new_traits': 0, 'structural_tables_identical': True,
              'reverse_recovers_input_swf': True, 'protected_classes_untouched': list(PROTECTED),
              'static_checks': {k: v.get('static_check') for k, v in e.report.items()}}
    if a.report:
        Path(a.report).write_text(json.dumps(report, ensure_ascii=False, indent=1, default=repr) + '\n', 'utf-8')
    print(json.dumps({k: report[k] for k in ('status', 'output_sha256', 'changed_method_count', 'insert_count')}))
    return report


if __name__ == '__main__':
    main()
