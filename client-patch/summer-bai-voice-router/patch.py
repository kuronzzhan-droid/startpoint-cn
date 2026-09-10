"""Append two HUD int slots and splice three voice-only bodies into V14.

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

BASE_SHA = 'dee19b6a96d8cece93021c09f937fdf35832ed362dcbf9b9df0b8750a3774572'
TARGETS = {
    'SquadManagerImpl/invokeActionSkill': '1e5cfb972f60505ab7dac6284584dcf387e0f5b64bcb0e9813a016b567afd739',
    'HudMemberStatus/update': '9e97a8fc66d7b6c5208b82f944b57250261b9441fc1860fb1ae12eb90ad03e61',
    'BattleCharacterLogic/resolveFollowingPathCollection': '807e45e3ab22da39432be8523c8932f3ad0015788c966e4ff051cc494ecde8fa',
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
    for name in (blocks.READY_NORMAL, blocks.READY_FEVER):
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
        raise asm.AsmError('input is not the verified installed V14 SWF')
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
        'SquadManagerImpl/invokeActionSkill': [(130, blocks.skill_block(pool))],
        'HudMemberStatus/update': [(64, blocks.ready_phase_block(pool)),
                                  (75, blocks.ready_alternate_block(pool, slots))],
        'BattleCharacterLogic/resolveFollowingPathCollection':
            [(114, blocks.preload_block(pool))],
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
    result = {'status': 'built_static_pending_runtime', 'capability': 'summer-bai-voice-router-v1',
              'source': str(source), 'source_sha256': sha(data),
              'output': str(output), 'output_sha256': sha(output.read_bytes()),
              'changed_methods': evidence, 'unchanged_method_bodies': len(original)-3,
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
