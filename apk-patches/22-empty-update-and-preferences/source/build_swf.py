"""Three-fix LAN candidate. Graft two helper methods; insert one main-method call."""
import copy, hashlib, importlib.util, json, struct, sys, zipfile, zlib
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent/'lens0907-0908'))
spec = importlib.util.spec_from_file_location('lens_model', HERE.parent/'lens0907-0908/build_swf.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
from swfabc import PoolEditor, swftags

def sha(data): return hashlib.sha256(data).hexdigest()

def parts(path):
    _, version, _, raw = swftags.load_swf(str(path))
    tags = list(swftags.iter_tags(raw)); result = []
    for code, at, header, size in tags:
        data = raw[at+header:at+header+size]
        prefix = data[:data.index(b'\0', 4)+1] if code == 82 else b''
        result.append([code, raw[at:at+header+size], prefix,
                       m.abcfmt.ABC(data[len(prefix):]) if code == 82 else None, data[len(prefix):]])
    return version, raw[:tags[0][1]], result

def helper_abc(swc):
    path = swc.with_suffix('.swf')
    with zipfile.ZipFile(swc) as z: path.write_bytes(z.read('library.swf'))
    values = [row[3] for row in parts(path)[2] if row[0] == 82]
    assert len(values) == 1
    return values[0]

def serialize(abc, original):
    # ABC allows empty numeric pools encoded as 0 or 1. Preserve the input's spelling.
    def counts(data):
        r = m.abcfmt.R(data); r.p = 4; rows = []
        for reader in [r.s32, r.u32, r.d64]:
            at = r.p; n = r.u30(); rows.append((at, n))
            for _ in range(max(0, n-1)): reader()
        return rows
    out = bytearray(abc.serialize())
    for (_, old), (at, new) in zip(counts(original), counts(out)):
        if old == 0 and new == 1: out[at] = 0
    return bytes(out)

def build(work):
    source = work/'input.swf'
    assert sha(source.read_bytes()) == 'c667815ff871e12705e665267640db480f7c959e1c6bb4d852016f1e4923d6ed'
    version, header, tags = parts(source)
    abcs = [x for x in tags if x[0] == 82]
    assert len(abcs) == 288 and sum(len(x[3].bodies) for x in abcs) == 96515
    changes = []
    def view(abc): return m.View(SimpleNamespace(abc=abc), m.asm)
    for name, method, donor_name in [
        ('cn.account::PlayerLogin', 'cn.account::PlayerLogin$/title|1/closure:0', 'login'),
        ('cn.ui::AbyssDetails', 'cn.ui::AbyssDetails$/attach|1', 'details')]:
        hits = [x for x in abcs if any(x[3].mn_name(i[0]) == name for i in x[3].instances)]
        assert len(hits) == 1, name
        tag = hits[0]; target = view(tag[3]); donor = view(helper_abc(work/(donor_name+'.swc')))
        assert serialize(tag[3], tag[4]) == tag[4], 'modified helper must roundtrip byte-exactly'
        assert len(target.by_label[method]) == len(donor.by_label[method]) == 1, method
        bi, di = target.by_label[method][0], donor.by_label[method][0]
        before = copy.deepcopy(target.a)
        importer = m.Importer(target, donor)
        target.a.bodies[bi] = importer.body(di, target.a.bodies[bi][0])
        assert target.normalized(bi) == donor.normalized(di)
        for index, body in enumerate(target.a.bodies):
            if index != bi: assert m.freeze(body) == m.freeze(before.bodies[index])
        for field in ['methods', 'instances', 'classes', 'scripts', 'metadata']:
            assert m.freeze(getattr(target.a, field)) == m.freeze(getattr(before, field))
        check = m.check_body(target.a.bodies[bi], target.a)
        changes.append({'abc': abcs.index(tag), 'body': bi, 'method': method, 'check': check})
        data = tag[2] + serialize(target.a, tag[4])
        tag[1] = struct.pack('<HI', (82<<6)|63, len(data)) + data
    main = abcs[-1]; assert main[2][4:-1] == b'boot_ffc6'
    assert main[1].endswith(main[3].serialize()), 'main ABC must roundtrip byte-exactly'
    v = view(main[3]); a = v.a; before = copy.deepcopy(a); pool = PoolEditor(a)
    def q(ns, name):
        want = (7, (22, ns), name)
        matches = [i for i in range(1, len(a.multinames)) if v.mn(i) == want]
        if matches: return matches[0]
        spaces = [i for i, n in enumerate(a.namespaces) if i and n[0] == 22 and a.s(n[1]) == ns]
        if spaces: space = spaces[0]
        else:
            a.namespaces.append((22, pool.string(ns))); space = len(a.namespaces)-1
        a.multinames.append((7, space, pool.string(name))); return len(a.multinames)-1
    label = 'pinball.remote.asset.getPath::AssetGetPathRealRemote/successHandler|1'
    assert len(v.by_label[label]) == 1
    bi = v.by_label[label][0]; body = a.bodies[bi]; original = v.normalized(bi)
    block = m.asm.assemble([('getlex', q('cn.asset', 'EmptyUpdate')), ('getlocal_1',),
                            ('callpropvoid', q('', 'normalize'), 1)])
    body[5], body[6], instructions, placed = m.asm.splice_many(body, [(0, block, m.asm.ENTER)])
    assert m.asm.unsplice_many(body[5], placed) == before.bodies[bi][5]
    body[1] = max(body[1], 2)
    m.insertion_proof(original, v.normalized(bi), [{'at': 0, 'instructions': len(block)}])
    for index, b in enumerate(a.bodies):
        if index != bi: assert m.freeze(b) == m.freeze(before.bodies[index])
    changes.append({'abc': 287, 'body': bi, 'method': label, 'reversible_insertion': True})
    payload = main[2] + a.serialize()
    main[1] = struct.pack('<HI', (82<<6)|63, len(payload)) + payload
    extra = helper_abc(work/'empty.swc')
    payload = struct.pack('<I', 1) + b'cn.asset.EmptyUpdate\0' + extra.serialize()
    extra_tag = struct.pack('<HI', (82<<6)|63, len(payload)) + payload
    raw = header + b''.join((extra_tag if row is main else b'') + row[1] for row in tags)
    output = work/'client-three-fixes.swf'
    output.write_bytes(b'CWS' + bytes([version]) + struct.pack('<I', len(raw)+8) + zlib.compress(raw))
    final = parts(output)[2]
    final_abcs = [x for x in final if x[0] == 82]
    assert len(final_abcs) == 289
    report = {'input_swf_sha256': sha(source.read_bytes()), 'swf_sha256': sha(output.read_bytes()),
              'changes': changes, 'main_abc_index': 288,
              'original_bodies': 96515, 'added_bodies': len(extra.bodies),
              'all_other_original_bodies_unchanged': True}
    (work/'swf-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__': build(Path(sys.argv[1]).resolve())
