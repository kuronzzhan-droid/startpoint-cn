"""Apply C24 (no-context multi rooms start without rivens; catalog NACK reason).

Run AFTER round2 and C23 (input = C23 output, or the merged 1008093 SWF that already
carries guard / matefx / round2 / C23).

usage: python -B -X utf8 c24_apply.py --in <swf> --out <swf> [--report <json>]

Asserted on every run (same contract as r2_apply / c23_apply):
  * no new methods / traits; method, instance, class, script, metadata, namespace,
    ns-set tables identical; constant pools append-only (expected: 1 string '|catalog');
  * exactly the five expected methods change; each unsplices back to its input bytes;
    restoring changed bodies and truncating pools reproduces the input SWF byte for byte;
  * ActionEvaluator / NormalAttackCalculator / MemberImpl / AbilityDamageShot untouched;
  * static stack/scope/control-flow check on every changed body (framework.replace);
  * no admission strings added (only the main boot ABC changes).
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import c24_paths  # noqa: F401
from framework import Editor
from common import freeze
import asm
import bodies
from c24_legacy import queue_all, MATES, START, LOAD, READ, RESTORE

TABLES = ('methods', 'instances', 'classes', 'scripts', 'metadata', 'namespaces', 'ns_sets')
POOLS = ('strings', 'ints', 'uints', 'doubles', 'multinames')
PROTECTED = ('ActionEvaluator', 'NormalAttackCalculator', 'MemberImpl', 'AbilityDamageShot')
EXPECTED = sorted([MATES, START, LOAD, READ, RESTORE])


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class Queue:
    def __init__(self, editor):
        self.e = editor
        self.rows = []

    def add(self, feature, label, at, code, incoming=asm.FORBID, note=''):
        body = self.e.body(label)
        self.e.locks.setdefault(label, {'sha': sha(body[5]), 'header': list(body[1:5])})
        block = asm.assemble(code)
        self.e.insertions.setdefault(label, []).append((at, block, incoming))
        self.rows.append({'feature': feature, 'method': label, 'at': at, 'instructions': len(block),
                          'incoming': incoming, 'note': note, 'method_sha256_before': sha(body[5])})
        return at


def body_bytes(body):
    return repr(body[:5]).encode() + body[5] + repr(body[6]).encode() + repr(
        [(t.name, t.kind, t.attr, t.data, t.metadata) for t in (body[7] if len(body) > 7 else [])]).encode()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--report')
    a = ap.parse_args(argv)
    src, out = Path(a.src), Path(a.out)
    assert src.resolve() != out.resolve()
    raw_in = src.read_bytes()
    e = Editor(src, {})
    originals = {n: copy.deepcopy(getattr(e.abc, n)) for n in (*TABLES, *POOLS)}
    q = Queue(e)
    meta = queue_all(q)
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
    assert sorted(labels[i] for i in changed) == EXPECTED, sorted(labels[i] for i in changed)
    for label, row in e.report.items():
        assert asm.unsplice_many(e.body(label)[5], row['insertions']) == e.original_bodies[row['body']][5]
    raw = e.swf.serialize()
    restored = copy.deepcopy(e.swf)
    for i in changed:
        restored.abc.bodies[i] = copy.deepcopy(e.original_bodies[i])
    for n in POOLS:
        setattr(restored.abc, n, copy.deepcopy(originals[n]))
    assert restored.serialize() == raw_in, 'reverse does not recover input SWF'
    added = e.abc.strings[len(originals['strings']):]
    for word in ('admission', 'SP-ADMISSION'):
        assert not [s for s in added if word.encode() in s], 'admission-related string added'
    growth = {n: len(getattr(e.abc, n)) - len(originals[n]) for n in POOLS}
    assert growth['ints'] == growth['uints'] == growth['doubles'] == growth['multinames'] == 0, growth
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    report = {'status': 'passed', 'input': str(src), 'input_sha256': sha(raw_in), 'output': str(out),
              'output_sha256': sha(raw), 'features': ['no_context', 'catalog_reason'], 'meta': meta,
              'changed_methods': sorted(labels[i] for i in changed), 'changed_method_count': len(changed),
              'insert_count': len(q.rows), 'inserts': q.rows, 'pool_growth': growth,
              'appended_strings': [s.decode('utf-8', 'replace') for s in added],
              'new_methods': 0, 'new_traits': 0, 'structural_tables_identical': True,
              'reverse_recovers_input_swf': True, 'protected_classes_untouched': list(PROTECTED),
              'static_checks': {k: v.get('static_check') for k, v in e.report.items()},
              'insertion_recovery': {k: {'body': v['body'], 'insertions': v['insertions']} for k, v in e.report.items()}}
    if a.report:
        Path(a.report).parent.mkdir(parents=True, exist_ok=True)
        Path(a.report).write_text(json.dumps(report, ensure_ascii=False, indent=1, default=repr) + '\n', 'utf-8')
    print(json.dumps({k: report[k] for k in ('status', 'output_sha256', 'changed_method_count', 'insert_count',
                                             'pool_growth')}, ensure_ascii=False))
    return report


if __name__ == '__main__':
    main()
