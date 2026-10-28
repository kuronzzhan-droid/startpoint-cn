"""Apply C23 (riven 分解 in the detail popup + 批量分解 on the 裂罅工坊 list).

Run AFTER the round-2 insert (input = round-2 output, e.g. riven-wt-r2-cat325.swf or
the merged 1008093 SWF that already carries round2).

usage: python -B -X utf8 c23_apply.py --in <swf> --out <swf> [--only detail,batch] [--report <json>]

Asserted on every run (same contract as r2_apply):
  * no new methods / traits; method, instance, class, script, metadata, namespace,
    ns-set tables identical; constant pools append-only;
  * every changed method unsplices back to its input bytes; restoring changed bodies and
    truncating pools reproduces the input SWF byte for byte;
  * ActionEvaluator / NormalAttackCalculator / MemberImpl / AbilityDamageShot untouched;
  * static stack/scope/control-flow check on every changed body (framework.replace);
  * admission strings / tags untouched (only the main boot ABC changes).
"""
import argparse
import copy
import json
from pathlib import Path
import c23_paths  # noqa: F401
from framework import Editor
from common import freeze
import asm
import bodies
from c23_common import Queue, sha, PROTECTED
from c23_detail import queue_detail
from c23_batch import queue_batch

TABLES = ('methods', 'instances', 'classes', 'scripts', 'metadata', 'namespaces', 'ns_sets')
POOLS = ('strings', 'ints', 'uints', 'doubles', 'multinames')
FEATURES = ('detail', 'batch')
EXPECTED = {
    'detail': ['GeneralDialog/buttonClicked', 'GeneralDialog/preparation',
               'GeneralDialog/sliderValueChangedForAbilityDescriptionVariationWithLevel', 'GeneralDialogView/run'],
    'batch': ['EquipmentListScene/buttonClicked', 'EquipmentListScene/filterDialogOkHandler', 'EquipmentListScene/run',
              'EquipmentListScene/toThumbnailData', 'EquipmentListScene/update',
              'EquipmentListTableItemView/apply', 'EquipmentListTableItemView/enhancedEffectAnimationDraw',
              'EquipmentListTableItemView/setSelected', 'EquipmentListView/setupHowToButton'],
}


def body_bytes(body):
    return repr(body[:5]).encode() + body[5] + repr(body[6]).encode() + repr(
        [(t.name, t.kind, t.attr, t.data, t.metadata) for t in (body[7] if len(body) > 7 else [])]).encode()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default=','.join(FEATURES))
    ap.add_argument('--report')
    a = ap.parse_args(argv)
    src, out = Path(a.src), Path(a.out)
    assert src.resolve() != out.resolve()
    features = a.only.split(',')
    raw_in = src.read_bytes()
    e = Editor(src, {})
    other_tags = [(t.code, bytes(t.data)) for t in e.swf.tags] if hasattr(e.swf, 'tags') else None
    originals = {n: copy.deepcopy(getattr(e.abc, n)) for n in (*TABLES, *POOLS)}
    q = Queue(e)
    meta = {}
    if 'detail' in features:
        meta['detail'] = queue_detail(q)
    if 'batch' in features:
        meta['batch'] = queue_batch(q)
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
    expected = sorted(m for f in features for m in EXPECTED[f])
    assert sorted(labels[i] for i in changed) == expected, (sorted(labels[i] for i in changed), expected)
    for label, row in e.report.items():
        assert asm.unsplice_many(e.body(label)[5], row['insertions']) == e.original_bodies[row['body']][5]
    raw = e.swf.serialize()
    restored = copy.deepcopy(e.swf)
    for i in changed:
        restored.abc.bodies[i] = copy.deepcopy(e.original_bodies[i])
    for n in POOLS:
        setattr(restored.abc, n, copy.deepcopy(originals[n]))
    assert restored.serialize() == raw_in, 'reverse does not recover input SWF'
    for word in ('admission', 'SP-ADMISSION'):
        new_strings = [s for s in e.abc.strings[len(originals['strings']):] if word.encode() in s]
        assert not new_strings, ('admission-related string added', new_strings)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    growth = {n: len(getattr(e.abc, n)) - len(originals[n]) for n in POOLS}
    report = {'status': 'passed', 'input': str(src), 'input_sha256': sha(raw_in), 'output': str(out),
              'output_sha256': sha(raw), 'features': features, 'meta': meta,
              'changed_methods': sorted(labels[i] for i in changed), 'changed_method_count': len(changed),
              'insert_count': len(q.rows), 'inserts': q.rows, 'pool_growth': growth,
              'appended_strings': [s.decode('utf-8', 'replace') for s in e.abc.strings[len(originals['strings']):]],
              'appended_ints': list(e.abc.ints[len(originals['ints']):]),
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
