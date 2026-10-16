"""在 1043 汇总包客户端上修正无效回槽开销，保留全部语音和伤害类型补丁。"""
import argparse
import json
from pathlib import Path

from core import Editor, SwfAbc, asm, bodies, sha
import gauge
from gauge_effect_guard import guard, insertion_point

BASE_SHA = 'b113c90c3bccaf48eb0874512e862213dc91c9221882c061748fbe191478ad5e'


def apply(source, output, report):
    source, output, report = map(Path, (source, output, report))
    original = source.read_bytes()
    if sha(original) != BASE_SHA or output.exists() or report.exists():
        raise ValueError('requires the 1043 bundled SWF and unused output paths')
    swf = SwfAbc(source)
    e = Editor(swf)
    # Bodies are replaced field-by-field; preserve opaque trait objects rather
    # than deepcopying them (they compare by identity, not serialized contents).
    before = [b[:] for b in e.abc.bodies]
    ids = bodies.resolve_all(e.abc, ['MemberImpl/applyInstantAbility',
                                    'MemberAbilityTotalizerImpl/wfBlocksGauge'])
    body = e.abc.bodies[ids['MemberImpl/applyInstantAbility']]
    at = insertion_point(e)
    code, exceptions, ins = asm.splice(body, at, asm.assemble(guard(e)), asm.ENTER)
    if asm.unsplice(code, at, len(asm.assemble(guard(e)))) != body[5]:
        raise ValueError('cannot recover original native instruction stream')
    body[5], body[6] = code, exceptions
    body[2] = max(body[2], asm.block_locals(ins))
    target = e.abc.bodies[ids['MemberAbilityTotalizerImpl/wfBlocksGauge']]
    target[5] = asm.encode(asm.assemble(gauge.filter_body(e)))[0]
    changes = {}
    for name, index in ids.items():
        b = e.abc.bodies[index]
        ins = asm.decode(b[5])
        analysis = [asm.Instruction(0x02) if x.op in (0xef, 0xf0, 0xf1) else x for x in ins]
        metrics = asm.simulate(analysis, b[3], e.abc.multinames)
        if metrics[1] != b[4] or any(x.target is not None and x.target <= i
                                    and ins[x.target].op != 0x09 for i, x in enumerate(ins)):
            raise ValueError('scope or AVM2 loop-label regression')
        b[1] = max(b[1], metrics[0])
        changes[name] = dict(before=sha(before[index][5]), after=sha(b[5]), metrics=metrics)
    changed = {i for i, (a, b) in enumerate(zip(before, e.abc.bodies)) if a != b}
    if changed != set(ids.values()) or len(before) != len(e.abc.bodies):
        raise ValueError('unrelated method changed')
    output.parent.mkdir(parents=True, exist_ok=True)
    swf.save(output)
    check = SwfAbc(output)
    assert check.abc.serialize() == e.abc.serialize()
    assert swf.body[:swf._offset] == check.body[:check._offset]
    assert swf.body[swf._offset+swf._length:] == check.body[check._offset+check._length:]
    assert source.read_bytes() == original
    result = dict(status='static_candidate_runtime_pending', device_installed=False,
                  source=str(source), source_sha256=sha(original), output=str(output),
                  output_sha256=sha(output.read_bytes()), methods=changes,
                  native_instructions_recoverable=True,
                  unchanged_method_bodies=len(before)-len(changed))
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', 'utf8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--report', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(apply(a.source, a.output, a.report), ensure_ascii=False))
