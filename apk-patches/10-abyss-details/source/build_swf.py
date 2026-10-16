"""Two presentation insertions on the cumulative LAN element-channel APK."""
from __future__ import annotations
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import zipfile
import zlib

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent / 'lens0907-0908'))
import build_swf as model
from swfabc import PoolEditor, swftags

INPUT = ROOT/'outputs/quest-element-channel-lan-test-20260910/StarPoint-CN-1.8.1-quest-element-channel-lan-test-20260910.apk'
EXPECTED_APK = '8e21b793091415be13d13ac170a1dc53e89fb92a3d688c135deb86644a71bbcb'
EXPECTED_SWF = '70ae68d0b5ca59650e3a41468b81fd00d6ce1d2861eebb5fb66d90b61b0da653'
BASE_UUID = '51e09b50-f15c-431f-9359-c9a55caf209f'
HELPER_NAME = b'cn.ui.AbyssDetails'

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result

def run(command, log=None, timeout=60, **unused):
    p = subprocess.Popen([str(x) for x in command], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding='utf8', errors='replace')
    try:
        output, _ = p.communicate(timeout=timeout)
        if log: Path(log).write_text(output, encoding='utf8')
        if p.returncode: raise RuntimeError(f'child exit {p.returncode}: {output}')
        return output
    finally:
        if p.poll() is None:
            subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],capture_output=True,timeout=15)
            p.wait(timeout=15)

def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf8')

def build(work, swc):
    work.mkdir(parents=True, exist_ok=True)
    checker = module('abyss_details_baseline', HERE.parent/'verify_android_baseline.py')
    accepted = checker.verify('lan')
    lineage = json.loads((INPUT.parent/'verification-report.json').read_text('utf8'))
    assert lineage['baseline']['apk_sha256'] == accepted['apk_sha256']
    assert model.sha(INPUT.read_bytes()) == EXPECTED_APK
    assert lineage['swf_sha256'] == EXPECTED_SWF
    with zipfile.ZipFile(INPUT) as z: raw = z.read('assets/worldflipper_android_release.swf')
    assert model.sha(raw) == EXPECTED_SWF
    source = work/'input.swf'; source.write_bytes(raw)
    v = model.View(model.SwfAbc(source), model.asm)
    a = v.a; baseline = copy.deepcopy(a); pool = PoolEditor(a)
    assert len(a.bodies) == 92561
    assert model.sha(a.bodies[39060][5]) == '4a035a6b48b89a8a1b3f60eb371c49dfcf8095b1fe129e7bff46730e3a81b065'
    def qname(ns, name):
        want = (7, (22, ns), name)
        matches = [i for i in range(1,len(a.multinames)) if v.mn(i) == want
                   and a.namespaces[a.multinames[i][1]][1] != 0]
        if matches: return matches[0]
        matches = [i for i,n in enumerate(a.namespaces) if i and n[0] == 22
                   and n[1] != 0 and a.strings[n[1]] == ns.encode('utf8')]
        if matches: ns_index = matches[0]
        else:
            string_index = pool.string(ns)
            if string_index == 0:
                a.strings.append(b''); string_index = len(a.strings)-1
            a.namespaces.append((22,string_index)); ns_index = len(a.namespaces)-1
        a.multinames.append((7,ns_index,pool.string(name)))
        return len(a.multinames)-1
    targets = {
        71835: ('pinball.ui.component.quest::QuestTranslator/translateFormattedQuestNumber|1', 3,
            [('getlex', qname('cn.ui','AbyssDetails')), ('swap',), ('getlocal_1',),
             ('callproperty',qname('','summaryForQuest'),2), ('coerce',qname('','String'))]),
        78350: ('pinball.scene.partySelect.topPanel::PartySelectTopPanelView/baseRun|1', 607,
            [('getlex',qname('cn.ui','AbyssDetails')),('getlocal_0',),('callpropvoid',qname('','attach'),1)])}
    proofs = {}
    for index, (label, at, ops) in targets.items():
        assert v.by_label[label] == [index]
        before = v.normalized(index)
        assert len(before[0]) == at + 1 and before[0][-1][0] in (0x47,0x48)
        block = model.asm.assemble(ops)
        body = a.bodies[index]
        code, exceptions, instructions, placed = model.asm.splice_many(body,[(at,block,model.asm.ENTER)])
        assert model.asm.unsplice_many(code,placed) == baseline.bodies[index][5]
        body[5] = code; body[6] = exceptions
        _, offsets = model.asm.encode(instructions); by_offset = {o:i for i,o in enumerate(offsets)}
        stack, scope, _ = model.asm.simulate(instructions,body[3],a.multinames,[by_offset[e[2]] for e in exceptions])
        body[1] = max(body[1],stack); assert scope <= body[4]
        proofs[index] = model.insertion_proof(before,v.normalized(index),[{'at':at,'instructions':len(block)}])
        assert body[0] == baseline.bodies[index][0] and body[2:5] == baseline.bodies[index][2:5]
    for i,(old,new) in enumerate(zip(baseline.bodies,a.bodies)):
        if i not in targets: assert model.freeze(old) == model.freeze(new), i
    for attr in ('methods','metadata','instances','classes','scripts'):
        assert model.freeze(getattr(baseline,attr)) == model.freeze(getattr(a,attr)), attr
    for attr in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
        old = getattr(baseline,attr); new = getattr(a,attr)[:len(old)]
        if attr == 'doubles': assert [struct.pack('<d',x) for x in old] == [struct.pack('<d',x) for x in new]
        else: assert model.freeze(old) == model.freeze(new), attr
    assert not any(n[0] == 22 and n[1] == 0 for n in a.namespaces[len(baseline.namespaces):])
    intermediate = work/'hook-only.swf'; v.swf.save(intermediate)
    readback = model.View(model.SwfAbc(intermediate),model.asm)
    assert all(readback.normalized(i) == v.normalized(i) for i in targets)
    with zipfile.ZipFile(swc) as z: lib = z.read('library.swf')
    library = work/'helper-library.swf'; library.write_bytes(lib)
    _, _, _, helper_body = swftags.load_swf(str(library))
    abcs = []
    for tag_code,off,hdr,size in swftags.iter_tags(helper_body):
        if tag_code == 82:
            payload = helper_body[off+hdr:off+hdr+size]
            abcs.append(payload[payload.index(b'\0',4)+1:])
    assert len(abcs) == 1
    helper = model.abcfmt.ABC(abcs[0])
    assert len(helper.instances) == 1
    assert helper.mn_name(helper.instances[0][0]) == 'cn.ui::AbyssDetails'
    content = struct.pack('<I',1) + HELPER_NAME + b'\0' + abcs[0]
    tag = struct.pack('<HI',(82<<6)|63,len(content)) + content
    raw_body = readback.swf.body; at = readback.swf._offset
    final_body = raw_body[:at] + tag + raw_body[at:]
    payload = zlib.compress(final_body) if readback.swf.signature == b'CWS' else final_body
    output = work/'abyss-details-lan.swf'
    output.write_bytes(readback.swf.signature+bytes([readback.swf.version])+struct.pack('<I',len(final_body)+8)+payload)
    final = model.View(model.SwfAbc(output),model.asm)
    assert model.freeze(final.a.bodies) == model.freeze(a.bodies)
    def tags(path):
        _,_,_,raw = swftags.load_swf(str(path))
        return [raw[o:o+h+n] for _,o,h,n in swftags.iter_tags(raw)]
    left = tags(source); right = tags(output)
    assert right.count(tag) == 1; right.remove(tag)
    assert len(left) == len(right) and sum(x != y for x,y in zip(left,right)) == 1
    result = dict(status='presentation_candidate_static_verified', variant='lan',
        accepted=accepted, input_apk=str(INPUT), input_apk_sha256=EXPECTED_APK,
        input_uniqueappversionid=BASE_UUID, game_bodies=list(targets),
        original_game_bodies=96409, main_body_count=len(a.bodies), helper_bodies=len(helper.bodies),
        helper_abc_index=285, original_main_abc_now=286, original_instructions_reconstructed=True,
        original_pools_and_metadata_preserved=True, all_non_target_bodies_preserved=True,
        original_tags_preserved_except_main_abc=True, insertion_proof=proofs,
        input_swf_sha256=EXPECTED_SWF, output_swf_sha256=model.sha(output.read_bytes()),
        helper_swc_sha256=model.sha(swc.read_bytes()),
        helper_source_sha256=model.sha((HERE/'src/cn/ui/AbyssDetails.as').read_bytes()),
        protected_methods={str(i):model.sha(a.bodies[i][5]) for i in [21496,24599,39060,79085,79222,71120,82510,92013]},
        android_device_tested=False, combat_code_changed=False)
    dump(work/'swf-report.json',result)
    print(json.dumps({'swf':str(output),'changed_bodies':list(targets),'helper_bodies':len(helper.bodies)},ensure_ascii=False),flush=True)
    return result
