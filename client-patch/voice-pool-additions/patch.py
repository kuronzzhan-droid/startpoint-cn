"""在已安装 battle-rules v4 上局部扩充语音池，不改战斗规则和共享状态。"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, sys
R = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(R/'client-patch/abcasm'))
import asm, bodies
from swfabc import SwfAbc, PoolEditor

BASE_SHA = 'de9e865d88c14c1b3cc121044ce7d01d8cba5dd78f097ecf568b9dfef83393ae'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, R/relative)
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def locate(code, fragment):
    raw, _ = asm.encode(fragment)
    offset = code.find(raw)
    if offset < 0 or code.find(raw, offset+1) >= 0:
        raise ValueError('verified voice insertion must occur exactly once')
    ins = asm.decode(code);_, offsets = asm.encode(ins)
    if offset not in offsets:raise ValueError('fragment does not start at instruction boundary')
    return offsets.index(offset)


def replace(body, old, new):
    before = body[5];at = locate(before, old)
    stripped = asm.unsplice(before, at, len(old))
    temp = list(body);temp[5] = stripped
    code, exceptions, ins = asm.splice(temp, at, new, asm.ENTER)
    restored = list(temp);restored[5] = asm.unsplice(code, at, len(new))
    if asm.splice(restored, at, old, asm.ENTER)[0] != before:
        raise ValueError('original instruction stream cannot be recovered')
    body[5], body[6] = code, exceptions
    analysis = [asm.Instruction(0x02) if x.op in (0xef,0xf0,0xf1) else x for x in ins]
    stack, scope = asm.simulate(analysis, body[3], ABC.multinames)[:2]
    body[1], body[4] = max(body[1], stack), max(body[4], scope)
    return dict(at=at, old_count=len(old), new_count=len(new), reversible=True)


def apply(source, output, report):
    global ABC
    source, output, report = map(Path, (source, output, report))
    if output.exists() or sha(source.read_bytes()) != BASE_SHA:
        raise ValueError('requires verified v4 baseline and fresh output')
    swf = SwfAbc(source);ABC = swf.abc;pool = PoolEditor(ABC)
    before = [b[:] for b in ABC.bodies]
    G = load('gerald_blocks_add', 'client-patch/gerald-ready-voice-router/router_blocks.py')
    T = load('tekuto_blocks_add', 'client-patch/voice-pool-additions/blocks.py')
    Z = load('zantetsu_blocks_add', 'client-patch/voice-pool-additions/zantetsu.py')
    U = load('ready_ui_add', 'client-patch/voice-pool-additions/ui.py')
    slot, = [t.name for i in ABC.instances if ABC.mn_name(i[0]).endswith('::HudMemberStatus')
             for t in i[6] if ABC.mn_name(t.name) == G.READY_NEXT]
    targets = ['HudMemberStatus/update', 'BattleCharacterLogic/resolveFollowingPathCollection']
    ids = bodies.resolve_all(ABC, targets);edits = []
    for name, old, new in [
      (targets[0], G.ready_block(pool, slot), G.ready_block(pool, slot, 6)),
      (targets[1], G.preload_block(pool), G.preload_block(pool, 6))]:
        old = asm.assemble(old)
        new = asm.assemble(new)
        extra = asm.assemble(T.ready(pool, slot, G) if name == targets[0] else T.preload(pool))
        # Preserve the seasonal router verbatim. If it runs after this selection,
        # the new path has no _alt alias and passes through unchanged.
        temp = [0, 0, 0, 0, 0, asm.encode(new)[0], []]
        _, _, new = asm.splice(temp, len(new), extra, asm.ENTER)
        temp[5] = asm.encode(new)[0]
        extra = asm.assemble(Z.ready(pool, slot, G) if name == targets[0] else Z.preload(pool))
        _, _, new = asm.splice(temp, len(new), extra, asm.ENTER)
        body = ABC.bodies[ids[name]]
        if body[6]:raise ValueError('voice target unexpectedly has exception handlers')
        edits.append(dict(method=name, **replace(body, old, new)))
    ui_id = bodies.resolve(ABC, U.TARGET);body = ABC.bodies[ui_id]
    if sha(body[5]) != U.BASE_SHA or body[6]:
        raise ValueError('ready list baseline differs')
    code, exceptions, instructions = asm.splice(body, U.INSERT_AT, asm.assemble(U.block(pool)), asm.ENTER)
    if asm.unsplice(code, U.INSERT_AT, len(asm.assemble(U.block(pool)))) != body[5]:
        raise ValueError('ready list original cannot be recovered')
    stack, scope, _ = asm.simulate(instructions, body[3], ABC.multinames)
    body[1], body[4] = max(body[1], stack), max(body[4], scope)
    body[5], body[6] = code, exceptions
    edits.append(dict(method=U.TARGET, at=U.INSERT_AT, old_count=0,
                      new_count=len(asm.assemble(U.block(pool))), reversible=True))
    ids[U.TARGET] = ui_id
    changed = [i for i,(a,b) in enumerate(zip(before,ABC.bodies)) if a != b]
    if set(changed) != set(ids.values()) or len(before) != len(ABC.bodies):
        raise ValueError('non-voice method changed')
    output.parent.mkdir(parents=True,exist_ok=True);swf.save(output)
    data = dict(status='static_candidate_runtime_pending', source_sha256=BASE_SHA,
        output_sha256=sha(output.read_bytes()), source=str(source), output=str(output),
        edits=edits, changed_bodies=changed, unchanged_bodies=len(before)-3,
        new_traits=0, gameplay_methods_unchanged=True, pool=pool.report())
    report.write_text(json.dumps(data,ensure_ascii=False,indent=2),'utf8')
    return data


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('source','output','report'):p.add_argument(n,type=Path)
    a=p.parse_args();print(json.dumps(apply(a.source,a.output,a.report),ensure_ascii=False))
