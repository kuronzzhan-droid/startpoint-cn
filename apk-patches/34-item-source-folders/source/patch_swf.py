"""Supplement the native acquisition event gate with unlocked folder membership."""
import copy, importlib.util, json, struct, zlib
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('folder_model', HERE.parent/'startup-cache/build_swf.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)


def patch(source, output):
    assert b.sha(source.read_bytes()) == 'b498a303a21ef9cc2b59919e7e9c1f4faadf43449b0ae64b98e84f9345ab731a'
    version, header, tags = b.parts(source)
    abcs = [t for t in tags if t[0] == 82]
    assert len(abcs) == 290 and sum(len(t[3].bodies) for t in abcs) == 96531
    main = abcs[-1]; a = main[3]; v = b.m.View(SimpleNamespace(abc=a), b.m.asm)
    assert a.serialize() == main[4]
    before = copy.deepcopy(a)
    pool = b.PoolEditor(a)
    def q(ns, name):
        hits = [i for i in range(1, len(a.multinames)) if v.mn(i) == (7, (22, ns), name)]
        if hits: return hits[0]
        spaces = [i for i,n in enumerate(a.namespaces) if i and n[0] == 22 and a.s(n[1]) == ns]
        if spaces: space = spaces[0]
        else:
            a.namespaces.append((22, pool.string(ns))); space = len(a.namespaces)-1
        a.multinames.append((7, space, pool.string(name)))
        return len(a.multinames)-1
    label = 'pinball.scene.itemHowToGet.questSearch::ItemHowToGetQuestSearcher/getAvailableQuestLogic|1'
    bi, = v.by_label[label]
    assert bi == 75857
    body = a.bodies[bi]; original = v.normalized(bi)
    instructions = b.m.asm.decode(body[5])
    # The merge point after the ordinary-event loop: if (!listed) return None.
    assert instructions[53].op == 0x62 and instructions[53].args == [5]
    assert instructions[54].op == 0x96 and instructions[55].op == 0x12
    block = b.m.asm.assemble([
        ('getlex', q('cn.ui', 'ItemSourceFolderGate')), ('getlocal', 5),
        ('getlocal_0',), ('getproperty', q('', 'eventRepository')), ('getlocal', 4), ('getlocal_3',),
        ('callproperty', q('', 'allow'), 4), ('convert_b',), ('setlocal', 5)])
    body[5], body[6], _, placed = b.m.asm.splice_many(body, [(53, block, b.m.asm.ENTER)])
    assert b.m.asm.unsplice_many(body[5], placed) == before.bodies[bi][5]
    body[1] = max(body[1], 5)
    b.m.insertion_proof(original, v.normalized(bi), [{'at': 53, 'instructions': len(block)}])
    check = b.m.check_body(body, a)
    for i, other in enumerate(a.bodies):
        if i != bi: assert b.m.freeze(other) == b.m.freeze(before.bodies[i])
    for field in ('methods','instances','classes','scripts','metadata'):
        assert b.m.freeze(getattr(a, field)) == b.m.freeze(getattr(before, field))
    payload = main[2] + a.serialize()
    main[1] = struct.pack('<HI', (82<<6)|63, len(payload)) + payload
    extra = b.helper_abc(source.parent/'folder-gate.swc')
    assert len(extra.instances) == 1 and extra.mn_name(extra.instances[0][0]) == 'cn.ui::ItemSourceFolderGate'
    for method in extra.bodies: b.m.check_body(method, extra)
    payload = struct.pack('<I', 1) + b'cn.ui.ItemSourceFolderGate\0' + extra.serialize()
    addition = struct.pack('<HI', (82<<6)|63, len(payload)) + payload
    raw = header + b''.join((addition if t is main else b'') + t[1] for t in tags)
    output.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    final = b.parts(output)[2]
    restored = [t for t in final if not(t[0] == 82 and t[2][4:-1] == b'cn.ui.ItemSourceFolderGate')]
    original_tags = b.parts(source)[2]
    assert len(restored) == len(original_tags)
    assert sum(x[1] != y[1] for x,y in zip(restored,original_tags)) == 1
    report = {'parent_swf_sha256':b.sha(source.read_bytes()), 'swf_sha256':b.sha(output.read_bytes()),
              'changed_method':f'289:{bi}', 'label':label, 'original_bodies':96531,
              'added_bodies':len(extra.bodies), 'reversible_insertion':True, 'check':check,
              'other_original_tags_byte_identical':True, 'main_abc_index':290}
    (source.parent/'swf-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
