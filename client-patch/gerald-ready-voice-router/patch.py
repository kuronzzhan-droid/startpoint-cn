"""Append one Gerald HUD int slot and splice two voice-only bodies into V15.

Input is immutable; output must be a new file. No APK, store or device writes.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'client-patch/abcasm'))
import asm
import bodies
from swfabc import SwfAbc, PoolEditor, abcfmt
import router_blocks as blocks

BASE_SHA = 'eed904417bb6a2865a471d309ae60b3d64be1e51c8e7c28e9a5035a2d8b774b8'
TARGETS = {
    'HudMemberStatus/update': 'c4b3159e3491456f53af5f7055c2a57275800ea271f217b85f9448cd16ed64fd',
    'BattleCharacterLogic/resolveFollowingPathCollection': '055afa16439333e968f6fc5fef96f369cbfd438007ac2dab306131da3fc6e587',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def add_slots(abc, pool):
    instances = [x for x in abc.instances if abc.mn_name(x[0]) ==
                 'pinball.scene.battle.battle.hud::HudMemberStatus']
    if len(instances) != 1:
        raise asm.AsmError('HUD class must be unique')
    inst = instances[0]
    donor, = [t for t in inst[6] if abc.mn_name(t.name) == 'prevSkillPointCycle']
    if donor.kind != 0 or abc.mn_name(donor.data[2]) != 'int':
        raise asm.AsmError('HUD int donor differs')
    result = {}
    for name in (blocks.READY_NEXT,):
        if any(abc.mn_name(t.name) == name for t in inst[6]):
            raise asm.AsmError('router already present; do not apply twice')
        mn = pool.public_qname(name, donor.name)
        t = abcfmt.Trait()
        t.name, t.kind, t.attr = mn, 0, 0
        t.data, t.metadata = ['slot', 0, donor.data[2], 0, None], []
        inst[6].append(t)
        result[name] = mn
    return result


def apply(source, output, report):
    source, output, report = map(Path, (source, output, report))
    if output.exists() or output.resolve() == source.resolve():
        raise asm.AsmError('output must be a new path')
    data = source.read_bytes()
    if sha(data) != BASE_SHA:
        raise asm.AsmError('input is not the verified installed V15 SWF')
    swf = SwfAbc(source)
    abc = swf.abc
    original = [b[:] for b in abc.bodies]
    refs = bodies.resolve_all(abc, TARGETS)
    for name, idx in refs.items():
        if sha(abc.bodies[idx][5]) != TARGETS[name]:
            raise asm.AsmError('unexpected method baseline: ' + name)
    pool = PoolEditor(abc)
    slots = add_slots(abc, pool)
    insertions = {
        'HudMemberStatus/update': [(172, blocks.ready_block(pool, slots[blocks.READY_NEXT]))],
        'BattleCharacterLogic/resolveFollowingPathCollection':
            [(134, blocks.preload_block(pool))],
    }
    evidence = []
    for name, edits in insertions.items():
        idx = refs[name]
        body = abc.bodies[idx]
        assembled = [(at, asm.assemble(code), asm.ENTER) for at, code in edits]
        code, exceptions, ins, locations = asm.splice_many(body, assembled)
        # Verify the pre-existing instruction stream remains byte-for-byte
        # recoverable, including Seris dual-form selection and the gameplay DSL.
        if asm.unsplice_many(code, locations) != original[idx][5]:
            raise asm.AsmError('original method instructions changed')
        body[5], body[6] = code, exceptions
        # Debug/debugline/debugfile have no operand-stack effect. Keep their
        # actual bytes; only normalize the analysis copy for the shared walker.
        analysis = [asm.Instruction(0x02) if x.op in (0xEF,0xF0,0xF1) else x
                    for x in ins]
        metrics = asm.simulate(analysis, body[3], abc.multinames)
        body[1] = max(body[1], metrics[0])
        body[4] = max(body[4], metrics[1])
        evidence.append({'method': name, 'body_index': idx,
                         'before_sha256': TARGETS[name], 'after_sha256': sha(code),
                         'insertions': locations, 'metrics': metrics,
                         'header': body[1:5]})
    changed = [i for i, (a, b) in enumerate(zip(original, abc.bodies)) if a != b]
    if set(changed) != set(refs.values()) or len(original) != len(abc.bodies):
        raise asm.AsmError('unexpected method body changes')
    # The independent verifier compares every instance trait and all ABC pools.
    output.parent.mkdir(parents=True, exist_ok=True)
    swf.save(output)
    result = {'status': 'built_static_pending_runtime', 'capability': 'gerald-ready-voice-router-v1',
              'source': str(source), 'source_sha256': sha(data),
              'output': str(output), 'output_sha256': sha(output.read_bytes()),
              'changed_methods': evidence, 'unchanged_method_bodies': len(original)-2,
              'new_slots': list(slots), 'pool': pool.report(),
              'device_or_store_writes': False}
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--report', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(apply(a.source, a.output, a.report),ensure_ascii=False,indent=2))
