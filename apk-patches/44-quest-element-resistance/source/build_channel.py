"""One insertion in accepted BattleQuestBaseImpl, plus one independent helper ABC."""
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

EXPECTED_APK = 'c868534b575348dde825fcd4c88c156157174fd4444724f1141fd9aa95e32a2d'
EXPECTED_SWF = '11c06fd77a0e3811164d196208ecce28cba5ec3a602e3d798f3c67d5d5b17e04'
BASELINES = {
    'public': (EXPECTED_APK, EXPECTED_SWF),
    'lan': ('3dd568ff64c3c099cf60d99985d706f1704a1c5666f945f8b548d8eaefa3d588',
            'bfda9db4b244e4518362a97cfa69d8d029b6710eab647727b8eb551bfe1e70d0'),
}
HELPER_NAME = b'cn.rules.QuestElementResistance'

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

def build(work, swc, variant='public'):
    work.mkdir(parents=True, exist_ok=True)
    checker = module('quest_element_baseline', HERE.parent/'verify_android_baseline.py')
    identity = checker.verify(variant)
    expected_apk, expected_swf = BASELINES[variant]
    assert identity['apk_sha256'] == expected_apk, 'accepted baseline advanced; audit before rebuilding'
    assert identity['swf_sha256'] == expected_swf
    with zipfile.ZipFile(identity['apk']) as z: raw = z.read('assets/worldflipper_android_release.swf')
    assert model.sha(raw) == expected_swf
    source = work/f'accepted-{variant}.swf'; source.write_bytes(raw)
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
    index = 21496
    label = 'pinball.common.data.quest.battle::BattleQuestBaseImpl/getInitialEnemyConditions|1'
    assert v.by_label[label] == [index]
    before = v.normalized(index)
    assert len(before[0]) == 115 and before[0][-2][0] == 0xd2 and before[0][-1][0] == 0x48
    block = model.asm.assemble([
        ('getlex',qname('cn.rules','QuestElementResistance')),
        ('getlocal_0',),('getproperty',qname('','questValues')),('getlocal_2',),
        ('getlex',qname('pinball.common.data.character.condition','ConditionChangeContent')),
        ('getlex',qname('pinball.common.math._Decimal','Decimal_Impl_')),
        ('callproperty',qname('','apply'),4),('coerce',qname('','Array')),('setlocal_2',)])
    body = a.bodies[index]
    code, exceptions, instructions, placed = model.asm.splice_many(body,[(113,block,model.asm.ENTER)])
    assert model.asm.unsplice_many(code,placed) == baseline.bodies[index][5]
    body[5] = code; body[6] = exceptions
    _, offsets = model.asm.encode(instructions); by_offset = {o:i for i,o in enumerate(offsets)}
    stack, scope, _ = model.asm.simulate(instructions,body[3],a.multinames,[by_offset[e[2]] for e in exceptions])
    body[1] = max(body[1],stack); assert scope <= body[4]
    proof = model.insertion_proof(before,v.normalized(index),[{'at':113,'instructions':len(block)}])
    assert body[0] == baseline.bodies[index][0] and body[2:5] == baseline.bodies[index][2:5]
    for i,(old,new) in enumerate(zip(baseline.bodies,a.bodies)):
        if i != index: assert model.freeze(old) == model.freeze(new), i
    for attr in ('methods','metadata','instances','classes','scripts'):
        assert model.freeze(getattr(baseline,attr)) == model.freeze(getattr(a,attr)), attr
    for attr in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
        old = getattr(baseline,attr); new = getattr(a,attr)[:len(old)]
        if attr == 'doubles': assert [struct.pack('<d',x) for x in old] == [struct.pack('<d',x) for x in new]
        else: assert model.freeze(old) == model.freeze(new), attr
    assert not any(n[0] == 22 and n[1] == 0 for n in a.namespaces[len(baseline.namespaces):])
    intermediate = work/'hook-only.swf'; v.swf.save(intermediate)
    readback = model.View(model.SwfAbc(intermediate),model.asm)
    assert readback.normalized(index) == v.normalized(index)
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
    assert helper.mn_name(helper.instances[0][0]) == 'cn.rules::QuestElementResistance'
    content = struct.pack('<I',1) + HELPER_NAME + b'\0' + abcs[0]
    tag = struct.pack('<HI',(82<<6)|63,len(content)) + content
    raw_body = readback.swf.body; at = readback.swf._offset
    final_body = raw_body[:at] + tag + raw_body[at:]
    payload = zlib.compress(final_body) if readback.swf.signature == b'CWS' else final_body
    output = work/f'quest-element-{variant}.swf'
    output.write_bytes(readback.swf.signature+bytes([readback.swf.version])+struct.pack('<I',len(final_body)+8)+payload)
    final = model.View(model.SwfAbc(output),model.asm)
    assert model.freeze(final.a.bodies) == model.freeze(a.bodies)
    def tags(path):
        _,_,_,raw = swftags.load_swf(str(path))
        return [raw[o:o+h+n] for _,o,h,n in swftags.iter_tags(raw)]
    left = tags(source); right = tags(output)
    assert right.count(tag) == 1; right.remove(tag)
    assert len(left) == len(right) and sum(x != y for x,y in zip(left,right)) == 1
    result = dict(status='channel_candidate_static_verified',variant=variant,baseline=identity,game_body=index,
        label=label,original_game_bodies=96404,main_body_count=len(a.bodies),helper_bodies=len(helper.bodies),
        helper_abc_index=284,original_main_abc_now=285,original_instructions_reconstructed=True,
        original_pools_and_metadata_preserved=True,all_non_target_bodies_preserved=True,
        original_tags_preserved_except_main_abc=True,insertion_proof=proof,
        input_swf_sha256=expected_swf,output_swf_sha256=model.sha(output.read_bytes()),
        original_method_sha256=model.sha(baseline.bodies[index][5]),new_method_sha256=model.sha(code),
        helper_swc_sha256=model.sha(swc.read_bytes()),helper_source_sha256=model.sha((HERE/'src/cn/rules/QuestElementResistance.as').read_bytes()),
        protected_methods={str(i):model.sha(a.bodies[i][5]) for i in [24599,39060,79085,79222,71120,82510,92013]},
        android_device_tested=False,active_quest_configuration=False,random_tower_generated=False)
    dump(work/'swf-report.json',result)
    print(json.dumps({'swf':str(output),'changed_body':index,'helper_bodies':len(helper.bodies)},ensure_ascii=False),flush=True)
    return result

if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('--work',required=True,type=Path)
    p.add_argument('--helper-swc',required=True,type=Path); p.add_argument('--variant',choices=BASELINES,default='public'); args=p.parse_args()
    build(args.work,args.helper_swc,args.variant)
