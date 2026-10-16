"""Transplant only the reviewed Lens 0910 blocks over the selected details APK.

Every original instruction and branch is recoverable. No donor native method
is substituted wholesale, and no AIR desktop runtime is launched.
"""
from __future__ import annotations
import argparse, copy, hashlib, importlib.util, json, sys, zipfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
g=module('lens0910_graft',HERE.parent/'lens0907-0908/build_swf.py')
BASE_APK_SHA='eb1edaaae48027362970fb94b3a71da8fa3282ec47f6196a49490b56d9a4c61c'
BASE_SWF_SHA='355d4b5e1ff41f874c7f32f9ec45542a7cce8469c740497949c1dc0b3c6faa55'
BASE_UUID='2bf1476e-2fe3-43b0-bba3-b199415c0128'
DONOR_SWF_SHA='256ba66767653e9490377486a6115f1dd9ec435007221cae05adfcdd58b95f37'
BASE_APK=REPO/'outputs/abyss-detail-ui-lan-test-20260910/StarPoint-CN-1.8.1-abyss-details-lan-test-20260910.apk'
PLAN=[
 ('ConditionSlot/getOneSideTotalAbilityDamageResistance','45132366ca9add7dbfc334bebfc726287a28bf1d3dea2cf84f96b2cdf2b16a30','c17a3823103a135fdc094d017f003c8a9898fdab303ce321589ed2b8b51cad64',[(241,241,274)]),
 ('SquadManagerImpl/invokeActionSkill','564e663b05d20bc085f3cb4684ca213bc9ec519ec660993ad83c9f612ab58740','b0b50cb6cc8b125fdbb7493523a35f3ece3b3d5f898930bbff6a2f2775385e7e',[(111,130,145)]),
 ('HudMemberStatus/update','9e97a8fc66d7b6c5208b82f944b57250261b9441fc1860fb1ae12eb90ad03e61','6029b345b1309e2303e74b2a66b4fc9fbcd8e38bad9f70200fd98f5e01f77210',[(64,64,78),(75,89,254)]),
 ('BattleCharacterLogic/resolveFollowingPathCollection','23fa097c22cd9cdd90fd139b4086adae4f97605b958ab9ee80c064af085b0f65','ba5c2fda867c017d3a2e73024f61577c0c791a2398cd568b748dbf6e61ba7cba',[(112,114,162)]),
]
SLOTS=['wtsReadyNormalNext','wtsReadyFeverNext','geraldReadyNext']
def sha(b): return hashlib.sha256(b).hexdigest()
def savej(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf8')

def import_block(importer, source_index, start, end):
    """Import an isolated closed CFG, never an author's recompiled method."""
    body=copy.deepcopy(importer.b.bodies[source_index])
    ins=g.asm.decode(body[5])[start:end]
    for x in ins:
        if x.target is not None:
            assert start<=x.target<=end; x.target-=start
        assert x.default is None and x.cases is None
    body[5]=g.asm.encode(ins)[0];body[6]=[];body[7]=[]
    importer.b.bodies.append(body)
    try: remapped=importer.body(len(importer.b.bodies)-1,body[0])
    finally:importer.b.bodies.pop()
    return g.asm.decode(remapped[5])

def build(apk,donor,work):
    assert sha(apk.read_bytes())==BASE_APK_SHA,'user-selected APK identity mismatch'
    assert sha(donor.read_bytes())==DONOR_SWF_SHA,'reviewed donor identity mismatch'
    assert not (work/'lens0910-lan.swf').exists(),'use new output'
    work.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(apk) as z:
        raw=z.read('assets/worldflipper_android_release.swf')
        assert sha(raw)==BASE_SWF_SHA
        mf=z.read('AndroidManifest.xml')
        assert mf.count(BASE_UUID.encode())+mf.count(BASE_UUID.encode('utf-16le'))==1
    (work/'baseline.swf').write_bytes(raw)
    target=g.View(g.SwfAbc(work/'baseline.swf'),g.asm);source=g.View(g.SwfAbc(donor),g.asm)
    initial=copy.deepcopy(target.a);importer=g.Importer(target,source)
    owner='pinball.scene.battle.battle.hud::HudMemberStatus'
    ai,=[i for i,row in enumerate(target.a.instances) if target.a.mn_name(row[0])==owner]
    di,=[i for i,row in enumerate(source.a.instances) if source.a.mn_name(row[0])==owner]
    left=target.a.instances[ai][6];right=source.a.instances[di][6]
    for name in SLOTS:
        assert not any(target.a.mn_name(t.name)==name for t in left)
        donor_trait,=[t for t in right if source.a.mn_name(t.name)==name]
        assert donor_trait.kind==0 and source.a.mn_name(donor_trait.data[2])=='int'
        left.append(importer.trait(donor_trait))
    evidence=[];changed=set()
    for name,expected,donor_hash,spans in PLAN:
        label,=[l for l in target.by_label if l.endswith('::'+name+'|1')]
        ti=target.by_label[label][0];si=source.by_label[label][0]
        body=target.a.bodies[ti];assert sha(body[5])==expected
        assert sha(source.a.bodies[si][5])==donor_hash
        edits=[(at,import_block(importer,si,start,end),g.asm.ENTER) for at,start,end in spans]
        code,ex,instructions,locations=g.asm.splice_many(body,edits)
        assert g.asm.unsplice_many(code,locations)==initial.bodies[ti][5]
        body[5],body[6]=code,ex
        stack,scope,_=g.asm.simulate(instructions,body[3],target.a.multinames)
        body[1]=max(body[1],stack);body[4]=max(body[4],scope)
        proof=g.insertion_proof(g.View(g.SwfAbc(work/'baseline.swf'),g.asm).normalized(ti),target.normalized(ti),[dict(at=at,instructions=end-start) for at,start,end in spans])
        evidence.append(dict(label=label,body_index=ti,before=expected,after=sha(code),insertions=proof,author_spans=spans,checks=g.check_body(body,target.a)))
        changed.add(ti)
    for key in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
        a,b=getattr(initial,key),getattr(target.a,key);assert b[:len(a)]==a
    assert initial.methods==target.a.methods and initial.metadata==target.a.metadata
    assert g.freeze(initial.classes)==g.freeze(target.a.classes)
    assert g.freeze(initial.scripts)==g.freeze(target.a.scripts)
    for i,(a,b) in enumerate(zip(initial.instances,target.a.instances)):
        assert a[:6]==b[:6]
        assert g.freeze(a[6])==g.freeze(b[6][:len(a[6])])
        assert len(b[6])==len(a[6])+(3 if i==ai else 0)
    assert len(initial.bodies)==len(target.a.bodies)
    for i,(a,b) in enumerate(zip(initial.bodies,target.a.bodies)):
        if i not in changed:assert g.freeze(a)==g.freeze(b),i
    output=work/'lens0910-lan.swf';target.swf.save(output)
    final=g.View(g.SwfAbc(output),g.asm)
    assert g.freeze(final.a.bodies)==g.freeze(target.a.bodies)
    assert target.swf.body[:target.swf._offset]==final.swf.body[:final.swf._offset]
    assert target.swf.body[target.swf._offset+target.swf._length:]==final.swf.body[final.swf._offset+final.swf._length:]
    report=dict(status='static_verified_device_pending',input_apk=str(apk),input_apk_sha256=BASE_APK_SHA,input_swf_sha256=BASE_SWF_SHA,input_uuid=BASE_UUID,donor_swf_sha256=sha(donor.read_bytes()),output=str(output),output_swf_sha256=sha(output.read_bytes()),methods=evidence,added_slots=SLOTS,main_abc_bodies=len(initial.bodies),main_abc_index=286,all_other_methods_and_tags_preserved=True,desktop_air_run=False,device_tested=False,accepted_registry_changed=False)
    savej(work/'swf-report.json',report)
    print(json.dumps(report,ensure_ascii=False),flush=True)
    return report

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--base',type=Path,default=BASE_APK);ap.add_argument('--donor',type=Path,required=True);ap.add_argument('--work',type=Path,required=True);args=ap.parse_args();build(args.base,args.donor,args.work)
