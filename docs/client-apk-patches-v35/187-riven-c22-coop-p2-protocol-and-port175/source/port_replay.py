"""One audited stage over the wt 1008091 chain; no historical whole-SWF replacement."""
import argparse
import copy
import json
from bootstrap import ROOT, BASE, BASE_SHA, P13, P13_SHA, FINAL
from bootstrap import sha, require_hash, output_path, write_json
from c4_build import TABLES, POOLS, body_bytes
from framework import Editor
from common import freeze
from swfabc import SwfAbc
from port_stages import queue
from port_compare import historical, compare_methods, adapt_consumer_lock
import asm
import bodies


def stage_path(stage):
    return ROOT / f'build/stages/c{stage:02d}.swf'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', type=int, choices=range(23))
    args = parser.parse_args()
    stage = args.stage
    assert __debug__
    require_hash(BASE, BASE_SHA)
    require_hash(P13, P13_SHA)
    input_path = BASE if stage == 0 else stage_path(stage - 1)
    if stage > 0:
        last = json.loads((ROOT / f'audit/replay/c{stage-1:02d}.json').read_text('utf-8'))
        require_hash(input_path, last['sha256'])
    editor = Editor(input_path, {})
    originals = {n: copy.deepcopy(getattr(editor.abc, n)) for n in (*TABLES, *POOLS)}
    adaptation = adapt_consumer_lock(editor) if stage == 22 else None
    # C1 restores superseded P0 producers. Here they must already equal p13;
    # replacing them is a verified no-op, so no 1008091 code can be discarded.
    if stage == 1:
        p13 = SwfAbc(P13)
        for label in ('GeneralAbilitySoulLogic/getAbility', 'PartyLogic/getBattleParty'):
            assert body_bytes(editor.body(label)) == body_bytes(p13.abc.bodies[bodies.resolve(p13.abc, label)])
        del p13
    metadata = queue(stage, editor)
    anchors = {label: [{'instruction': at, 'inserted_instructions': len(block),
                        'incoming': policy} for at, block, policy in additions]
               for label, additions in editor.insertions.items()}
    for label, additions in editor.insertions.items():
        points = [a for a, _, _ in additions]
        assert len(points) == len(set(points)), ('Duplicate anchor', label, points)
    editor.apply()
    assert not editor.new_methods and not editor.traits
    assert len(editor.abc.bodies) == len(editor.original_bodies)
    for n, before in originals.items():
        after = getattr(editor.abc, n)
        assert freeze(after[:len(before)] if n in POOLS else after) == freeze(before), n
    labels = bodies.label_map(editor.abc)
    changed = [i for i, (a, b) in enumerate(zip(editor.original_bodies, editor.abc.bodies))
               if body_bytes(a) != body_bytes(b)]
    assert {labels[i] for i in changed} == set(anchors) == set(editor.report)
    for label, row in editor.report.items():
        assert asm.unsplice_many(editor.body(label)[5], row['insertions']) == editor.original_bodies[row['body']][5]
        row['unsplice_recovers_previous_wt_stage'] = True
    if stage >= 1:
        ref_path = historical(stage)
        reference = SwfAbc(ref_path)
        equivalence = compare_methods(editor, reference, anchors, stage)
        del reference
    else:
        equivalence, ref_path = [], None
    raw = editor.swf.serialize()
    # Reverse all insertions and appended constants, proving the entire input
    # SWF (including every native helper and admission key) is recoverable.
    restored = copy.deepcopy(editor.swf)
    for i in changed:
        restored.abc.bodies[i] = copy.deepcopy(editor.original_bodies[i])
    for n in POOLS:
        setattr(restored.abc, n, copy.deepcopy(originals[n]))
    assert restored.serialize() == input_path.read_bytes()
    del restored
    library = None
    if stage == 14:
        from c14_library_build import patch_library, restore_library
        updated, library, undo = patch_library(raw)
        assert restore_library(updated, undo) == raw
        raw = updated
    output = stage_path(stage)
    output_path(output).write_bytes(raw)
    parsed = SwfAbc(output)
    assert parsed.serialize() == raw
    assert all(body_bytes(a) == body_bytes(b) for a, b in zip(parsed.abc.bodies, editor.abc.bodies))
    result = {'status': 'passed', 'stage': stage, 'baseline': str(input_path),
              'baseline_sha256': sha(input_path.read_bytes()), 'output': str(output),
              'sha256': sha(raw), 'metadata': metadata, 'anchors': anchors,
              'changed': editor.report, 'changed_method_count': len(changed),
              'new_methods': [], 'new_traits': [], 'structural_tables_identical': True,
              'pool_prefixes_identical': True, 'reverse_recovers_entire_input_swf': True,
              'historical_reference': str(ref_path) if ref_path else None,
              'historical_sha256': sha(ref_path.read_bytes()) if ref_path else None,
              'historical_resolved_method_equivalence': equivalence,
              'consumer_lock_adaptation': adaptation, 'library': library}
    write_json(ROOT / f'audit/replay/c{stage:02d}.json', result)
    # FINAL is written by source/port_admission.py (stage 23) from c22.swf.
    print(json.dumps({k: result[k] for k in ('stage', 'status', 'sha256', 'changed_method_count')}), flush=True)


if __name__ == '__main__':
    main()
