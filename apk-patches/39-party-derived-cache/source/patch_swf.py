"""R10: replace R9's helper, insert loading lifecycle gates, extend numeric diagnostics."""
import copy
import json
import struct
import sys
import zlib
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'loading-diagnostic'))
from common import s

SOURCE_SHA = '119560545b87cf7cfc36b53a0354fa211cbc7eb05f2bdb6872661d62ee82ed4f'

def patch(source, helper, output):
    assert s.sha(source.read_bytes()) == SOURCE_SHA
    assert not output.exists() and '.cdn' not in output.parts
    version, header, tags = s.parts(source)
    originals = {row[2]: copy.deepcopy(row[3]) for row in tags if row[0] == 82}
    changed = []

    def view(tag): return s.m.View(SimpleNamespace(abc=tag[3]), s.m.asm)
    def q(tag, ns, name):
        a = tag[3]; v = view(tag); p = s.PoolEditor(a)
        wanted = (7, (22, ns), name)
        for i in range(1, len(a.multinames)):
            if v.mn(i) == wanted: return i
        spaces = [i for i, row in enumerate(a.namespaces) if i and row[0] == 22 and a.s(row[1]) == ns]
        if spaces: space = spaces[0]
        else:
            space = len(a.namespaces); a.namespaces.append((22, p.string(ns)))
        a.multinames.append((7, space, p.string(name)))
        return len(a.multinames) - 1

    def insert(tag, label, at, rows):
        v = view(tag); bi, = v.by_label[label]; body = tag[3].bodies[bi]
        original = bytes(body[5])
        block = s.m.asm.assemble(rows)
        body[5], body[6], _, placed = s.m.asm.splice_many(body, [(at, block, s.m.asm.ENTER)])
        assert s.m.asm.unsplice_many(body[5], placed) == original
        check = s.m.check_body(body, tag[3]); body[1] = max(body[1], check['max_stack'])
        assert check['max_scope'] <= body[4]
        changed.append({'abc':tag[2][4:-1].decode(), 'body':bi, 'method':label, 'insertion_reversible':True, 'check':check})

    main = next(t for t in tags if t[0] == 82 and t[2][4:-1] == b'boot_ffc6')
    helper_q = q(main, 'cn.loading', 'PartyDerivedCache')
    insert(main, 'pinball.scene.loading::LoadingSceneBase/gotoNextScene|1', 2,
           [('getlex', helper_q), ('getlocal_0',), ('callproperty', q(main,'','defer'),1),
            ('iffalse','continue'), ('returnvoid',), ('label','continue')])
    insert(main, 'pinball.scene.loading::LoadingSceneBase/startNextSceneAssetLoadWithDetail|1', 2,
           [('getlex',helper_q),('callpropvoid',q(main,'','reset'),0)])
    insert(main, 'pinball.scene.battle::BattleScene/leaveHandler|1', 2,
           [('getlex',helper_q),('callpropvoid',q(main,'','finish'),0)])

    trace = next(t for t in tags if t[0] == 82 and t[2][4:-1] == b'cn.diagnostics.LoadingTrace')
    insert(trace, 'cn.diagnostics::LoadingTrace$/firstFrame|1', 2,
           [('getlex',q(trace,'cn.loading','PartyDerivedCache')),('callpropvoid',q(trace,'','finish'),0)])
    v = view(trace); bi, = v.by_label['cn.diagnostics::LoadingTrace$/mark|1']
    instructions = s.m.asm.decode(trace[3].bodies[bi][5])
    spots = [i for i, ins in enumerate(instructions) if ins.op == 0x5d and v.mn(ins.args[0])[-1] == 'emit']
    at, = spots
    pool = s.PoolEditor(trace[3]); rows = []
    for phase in ('party.cache.summary','party.prewarm.begin','party.prewarm.end','party.prewarm.fallback'):
        rows += [('getlocal_1',),('pushstring',pool.string(phase)),('ifeq','metrics')]
    rows += [('jump','keep'),('label','metrics'),('getlocal',4),('coerce',q(trace,'','Object')),('setlocal',5),('label','keep')]
    insert(trace,'cn.diagnostics::LoadingTrace$/mark|1',at,rows)

    cache = next(t for t in tags if t[0] == 82 and t[2][4:-1] == b'cn.loading.PartyDerivedCache')
    replacement = s.helper_abc(helper)
    assert len(replacement.instances) == 1
    assert replacement.mn_name(replacement.instances[0][0]) == 'cn.loading::PartyDerivedCache'
    for body in replacement.bodies: s.m.check_body(body,replacement)
    cache[3] = replacement

    for tag in (main,trace,cache):
        if tag is not cache:
            old = originals[tag[2]]
            allowed = {row['body'] for row in changed if row['abc'] == tag[2][4:-1].decode()}
            actual = {i for i,b in enumerate(tag[3].bodies) if s.m.freeze(b) != s.m.freeze(old.bodies[i])}
            assert actual == allowed
            for field in ('methods','metadata','instances','classes','scripts'):
                assert s.m.freeze(getattr(old,field)) == s.m.freeze(getattr(tag[3],field))
            for field in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
                prefix = getattr(old,field)
                assert s.m.freeze(getattr(tag[3],field)[:len(prefix)]) == s.m.freeze(prefix)
        payload = tag[2] + s.serialize(tag[3],tag[4])
        tag[1] = struct.pack('<HI',(82<<6)|63,len(payload)) + payload
    raw = header + b''.join(t[1] for t in tags)
    output.write_bytes(b'CWS' + bytes([version]) + struct.pack('<I',len(raw)+8) + zlib.compress(raw))
    final_tags = s.parts(output)[2]
    assert len(final_tags) == len(tags)
    for final, intended in zip(final_tags,tags): assert final[1] == intended[1]
    preserved = [15140,20565,92540,66523,66013,66481]
    old = originals[main[2]]
    for bi in preserved: assert s.m.freeze(main[3].bodies[bi]) == s.m.freeze(old.bodies[bi])
    report = {'input_swf_sha256':SOURCE_SHA,'output_swf_sha256':s.sha(output.read_bytes()),
              'changes':changed,'replaced_helper':'cn.loading.PartyDerivedCache',
              'helper_bodies':len(replacement.bodies),'helper_abc_sha256':s.sha(replacement.serialize()),
              'preserved_r8_r9_carousel_bodies':preserved,'all_other_methods_and_tags_preserved':True,
              'class_layouts_preserved':True,'save_or_persistence_change':False}
    output.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report

if __name__ == '__main__':
    print(json.dumps(patch(*(Path(p) for p in sys.argv[1:])),ensure_ascii=False))
