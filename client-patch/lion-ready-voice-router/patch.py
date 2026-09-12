"""Append a Lion-only two-pool ready router to the hash-locked installed V16."""
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

BASE_SHA = '1ce423019de2604171d0e6824f9f629e81efd6689d43503322b96e981eca398a'
TARGETS = {
    'HudMemberStatus/update': '6029b345b1309e2303e74b2a66b4fc9fbcd8e38bad9f70200fd98f5e01f77210',
    'BattleCharacterLogic/resolveFollowingPathCollection': 'ba5c2fda867c017d3a2e73024f61577c0c791a2398cd568b748dbf6e61ba7cba',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def add_slots(abc, pool):
    instance, = [x for x in abc.instances if abc.mn_name(x[0]) ==
                 'pinball.scene.battle.battle.hud::HudMemberStatus']
    donor, = [t for t in instance[6] if abc.mn_name(t.name) == 'prevSkillPointCycle']
    if donor.kind != 0 or abc.mn_name(donor.data[2]) != 'int':
        raise asm.AsmError('HUD int donor differs')
    slots = {}
    for name in (blocks.NORMAL_SLOT, blocks.MATCHED_SLOT):
        if any(abc.mn_name(t.name) == name for t in instance[6]):
            raise asm.AsmError('Lion router already present')
        mn = pool.public_qname(name, donor.name)
        trait = abcfmt.Trait()
        trait.name, trait.kind, trait.attr = mn, 0, 0
        trait.data, trait.metadata = ['slot', 0, donor.data[2], 0, None], []
        instance[6].append(trait); slots[name] = mn
    return slots


def apply(source, output, report):
    source, output, report = map(Path, (source, output, report))
    if output.exists() or report.exists() or len({source.resolve(), output.resolve(), report.resolve()}) != 3:
        raise asm.AsmError('outputs must be new, distinct from immutable source')
    data = source.read_bytes()
    if sha(data) != BASE_SHA:
        raise asm.AsmError('input is not the verified installed V16 SWF')
    swf = SwfAbc(source); abc = swf.abc
    original = [body[:] for body in abc.bodies]
    refs = bodies.resolve_all(abc, TARGETS)
    for name, index in refs.items():
        if sha(abc.bodies[index][5]) != TARGETS[name]:
            raise asm.AsmError('unexpected method baseline: ' + name)
    pool = PoolEditor(abc); slots = add_slots(abc, pool)
    edits = {'HudMemberStatus/update': (254, blocks.ready_block(pool, slots)),
             'BattleCharacterLogic/resolveFollowingPathCollection': (162, blocks.preload_block(pool))}
    evidence = []
    for name, (at, listing) in edits.items():
        index = refs[name]; body = abc.bodies[index]
        code, exceptions, instructions, locations = asm.splice_many(body, [(at, asm.assemble(listing), asm.ENTER)])
        if asm.unsplice_many(code, locations) != original[index][5]:
            raise asm.AsmError('pre-existing method instructions changed')
        body[5], body[6] = code, exceptions
        analysis = [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in instructions]
        metrics = asm.simulate(analysis, body[3], abc.multinames)
        if metrics[0] > body[1] or metrics[1] > body[4]:
            raise asm.AsmError('insertion requires an unexpected stack/scope header change')
        evidence.append(dict(method=name, body_index=index, before_sha256=TARGETS[name], after_sha256=sha(code),
                             insertions=locations, metrics=metrics, header=body[1:5]))
    changed = [i for i, (a, b) in enumerate(zip(original, abc.bodies)) if a != b]
    if set(changed) != set(refs.values()) or len(original) != len(abc.bodies):
        raise asm.AsmError('unexpected method body changes')
    output.parent.mkdir(parents=True, exist_ok=True);report.parent.mkdir(parents=True, exist_ok=True)
    swf.save(output)
    if sha(source.read_bytes()) != BASE_SHA: raise asm.AsmError('source changed during build')
    result = dict(status='built_static_pending_runtime', capability='lion-ready-voice-router-v1',
                  source=str(source), source_sha256=BASE_SHA, output=str(output), output_sha256=sha(output.read_bytes()),
                  changed_methods=evidence, unchanged_method_bodies=len(original)-2,
                  new_slots=list(slots), pool=pool.report(), device_or_store_writes=False)
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'output'): parser.add_argument(name, type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(apply(args.source, args.output, args.report), ensure_ascii=False, indent=2))
