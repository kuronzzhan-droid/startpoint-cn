"""Apply C25: make the 裂罅工坊 批量分解 「分解」 button work on the real client.

Run AFTER C23 (input = an SWF that already carries round2 + C23).

usage: python -B -X utf8 c25_apply.py --in <swf> --out <swf> [--report <json>]

Root cause (device, 1008093): the C23 batch branch of EquipmentListScene/buttonClicked
(ids 0x28000000 分解 and 0x29000000 SEND), the C23 response branch of
EquipmentListScene/filterDialogOkHandler, the C23 `c23_batch_on` write in
EquipmentListScene/update and the dim check in
EquipmentListTableItemView/enhancedEffectAnimationDraw all keep their state in
`logicStatus.getLoadedData().wfx_riven` and silently `drop`/skip when it is falsy.
That slot is only filled by the C2 riven reroll page (ExBoostWindow run → ctx, leave → null);
in the 裂罅工坊 list it is absent / null, so the native tap (ButtonGroupView.touch →
CoreButtonView.processTouch → ButtonLogic.inputHandler → ButtonGroupLogic.clickHandler →
EquipmentListScene.buttonClicked(0x28000000)) arrives and C23 returns without a dialog,
a request or an error.  C23's offline host always installed a ctx, so this never showed.

C25 (2 single-method inserts, both at instruction 2, in front of the C23 prefix):
  EquipmentListScene/update, EquipmentListScene/buttonClicked:
    if this.filterSetting.wfxRiven and logicStatus.loadedData is Some and
       !getLoadedData().wfx_riven:  getLoadedData().wfx_riven = {mode: 'c25_workshop'}
The object's mode is not 'wfx_riven', so all 271 inherited C1-C22/round2 readers (which all
compare ctx.mode with 'wfx_riven' and fall to the same instruction as for a null ctx) behave
exactly as before; only the five truthiness-only C23 readers start working.  A real reroll
page ctx (mode 'wfx_riven') is never replaced; the reroll page still overwrites/clears the
slot as before.

Asserted on every run (same contract as c23_apply / r2_apply):
  * no new methods / traits; structural tables identical; pools append-only;
  * exactly the two methods change; each unsplices back to its input bytes; restoring
    them and truncating pools reproduces the input SWF byte for byte;
  * the C23 prefix is present at the anchor (C25 refuses a non-C23 input);
  * ActionEvaluator / NormalAttackCalculator / MemberImpl / AbilityDamageShot untouched;
  * no admission-related strings added.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import c25_paths  # noqa: F401
from framework import Editor
from common import freeze
import asm
import bodies

TABLES = ('methods', 'instances', 'classes', 'scripts', 'metadata', 'namespaces', 'ns_sets')
POOLS = ('strings', 'ints', 'uints', 'doubles', 'multinames')
PROTECTED = ('ActionEvaluator', 'NormalAttackCalculator', 'MemberImpl', 'AbilityDamageShot')
DYN = 14                      # MultinameL used by the riven patches for o[key]
MODE_VALUE = 'c25_workshop'   # deliberately != 'wfx_riven'
B_ENTER = 0x26000000
METHODS = ('EquipmentListScene/update', 'EquipmentListScene/buttonClicked')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def body_bytes(body):
    return repr(body[:5]).encode() + body[5] + repr(body[6]).encode() + repr(
        [(t.name, t.kind, t.attr, t.data, t.metadata) for t in (body[7] if len(body) > 7 else [])]).encode()


def assert_c23_prefix(e, label):
    """C25 sits in front of the C23 prefix; refuse inputs without it."""
    ops = asm.decode(e.body(label)[5])
    assert [o.name for o in ops[:2]] == ['getlocal_0', 'pushscope'], label
    if label == 'EquipmentListScene/buttonClicked':
        # C23: getlocal_1, pushint 0x26000000, ifne k_cancel
        assert ops[2].name == 'getlocal_1' and ops[3].name == 'pushint' and e.abc.ints[ops[3].args[0]] == B_ENTER \
            and ops[4].name == 'ifne', 'C23 batch prefix missing in ' + label
    else:
        # C23 mode_flags: pushfalse, setlocal riven, pushfalse, setlocal batch, pushstring 'filterSetting', getlocal_0, in
        names = [o.name for o in ops[2:9]]
        assert names == ['pushfalse', 'setlocal', 'pushfalse', 'setlocal', 'pushstring', 'getlocal_0', 'in'], names
        assert e.abc.s(ops[6].args[0]) == 'filterSetting', 'C23 update prefix missing in ' + label
    # C23 must still read loadedData.wfx_riven by truthiness in this method
    hits = [i for i in range(len(ops) - 1) if ops[i].name == 'pushstring' and e.abc.s(ops[i].args[0]) == 'wfx_riven'
            and ops[i + 1].name == 'getproperty']
    assert hits, 'no C23 wfx_riven reader in ' + label
    return ops


def ensure_ctx(e, first):
    """Prefix block (falls through to the C23 prefix on every path)."""
    fs, scr, ld = first, first + 1, first + 2
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    gp = lambda n: ('getproperty', e.q(n))
    get = lambda k: [e.string(k), ('getproperty', DYN)]
    code = [e.string('filterSetting'), ('getlocal_0',), ('in',), ('iffalse', 'c25_end'),
            ('getlocal_0',), gp('filterSetting'), ('coerce_a',), p(fs), g(fs), ('iffalse', 'c25_end'),
            e.string('wfxRiven'), g(fs), ('in',), ('iffalse', 'c25_end'),
            g(fs), *get('wfxRiven'), ('iffalse', 'c25_end'),
            ('getlex', e.q('PinballClientMain')), gp('top'), ('coerce_a',), p(scr), g(scr), ('iffalse', 'c25_end')]
    for field in ('logic', 'globalLogic', 'logicStatus'):
        code += [g(scr), gp(field), ('coerce_a',), p(scr), g(scr), ('iffalse', 'c25_end')]
    code += [e.string('loadedData'), g(scr), ('in',), ('iffalse', 'c25_end'),
             g(scr), gp('loadedData'), ('coerce_a',), p(ld), g(ld), ('iffalse', 'c25_end'),
             g(ld), gp('index'), ('pushbyte', 0), ('ifne', 'c25_end'),             # C2001: only when Some
             g(scr), ('callproperty', e.q('getLoadedData'), 0), ('coerce_a',), p(ld), g(ld), ('iffalse', 'c25_end'),
             e.string('wfx_riven'), g(ld), ('in',), ('iffalse', 'c25_make'),
             g(ld), *get('wfx_riven'), ('iftrue', 'c25_end'),                        # keep a live ctx (page or ours)
             ('label', 'c25_make'),
             g(ld), e.string('wfx_riven'), e.string('mode'), e.string(MODE_VALUE), ('newobject', 1),
             ('setproperty', DYN),
             ('label', 'c25_end')]
    return code


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
    rows = []
    for label in METHODS:
        assert_c23_prefix(e, label)
        body = e.body(label)
        e.locks.setdefault(label, {'sha': sha(body[5]), 'header': list(body[1:5])})
        first = body[2]
        block = asm.assemble(ensure_ctx(e, first))
        e.insertions.setdefault(label, []).append((2, block, asm.FORBID))
        rows.append({'method': label, 'at': 2, 'instructions': len(block), 'incoming': asm.FORBID,
                     'first_local': first, 'method_sha256_before': sha(body[5]),
                     'note': 'ensure loadedData.wfx_riven (mode c25_workshop) in the riven workshop, before C23'})
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
    assert sorted(labels[i] for i in changed) == sorted(METHODS), sorted(labels[i] for i in changed)
    for label, row in e.report.items():
        assert asm.unsplice_many(e.body(label)[5], row['insertions']) == e.original_bodies[row['body']][5]
    raw = e.swf.serialize()
    restored = copy.deepcopy(e.swf)
    for i in changed:
        restored.abc.bodies[i] = copy.deepcopy(e.original_bodies[i])
    for n in POOLS:
        setattr(restored.abc, n, copy.deepcopy(originals[n]))
    assert restored.serialize() == raw_in, 'reverse does not recover input SWF'
    added = [s.decode('utf-8', 'replace') for s in e.abc.strings[len(originals['strings']):]]
    for word in ('admission', 'SP-ADMISSION'):
        assert not [s for s in added if word in s], ('admission-related string added', added)
    assert 'wfx_riven' not in added and MODE_VALUE != 'wfx_riven'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    growth = {n: len(getattr(e.abc, n)) - len(originals[n]) for n in POOLS}
    report = {'status': 'passed', 'input': str(src), 'input_sha256': sha(raw_in), 'output': str(out),
              'output_sha256': sha(raw), 'changed_methods': sorted(labels[i] for i in changed),
              'changed_method_count': len(changed), 'insert_count': len(rows), 'inserts': rows,
              'pool_growth': growth, 'appended_strings': added,
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
