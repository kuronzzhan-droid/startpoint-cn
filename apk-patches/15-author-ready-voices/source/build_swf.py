"""Port the reviewed battle rules and three voice pools onto the accepted APK SWF.

The accepted input is pinned. Existing instructions, traits and helper ABCs are
preserved. Only the three reviewed voice blocks are imported from the donor.
"""
from __future__ import annotations
import argparse, copy, hashlib, importlib.util, json, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(HERE/'rules'))
from core import Editor, SwfAbc, asm, bodies
import content, damage, gauge, provenance

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
g=load('author1043_graft',HERE.parent/'lens0907-0908/build_swf.py')
BASE_SHA='1785d16b430ea7008e7d70cf1bca106f3f5410bbf86566063e83ad856d9a0a49'
DONOR_SHA='b113c90c3bccaf48eb0874512e862213dc91c9221882c061748fbe191478ad5e'
VOICE_PLAN=(
 ('HudMemberStatus/update','dfc34b88665a15839faef83de2a78a383ae4fba2ad2b553a7e7db93b1da2e4ef',172,82,172,225),
 ('BattleCharacterLogic/resolveFollowingPathCollection','97e2649a2d92d205f0e0991fc952112a03a4cb6421ad579ad8a82d630de8abea',132,28,134,76),
 ('CharacterVoiceLogic/createVoicePathMap','1e9b3d58f3c2409cac476f6267f83f9d9100263f208c1984b88eb9f436224e03',213,0,253,128),
)
sha=lambda b:hashlib.sha256(b).hexdigest()

def fragment(importer,body_id,start,count):
    body=copy.deepcopy(importer.b.bodies[body_id])
    code=asm.decode(body[5])[start:start+count]
    for ins in code:
        assert ins.cases is None and ins.default is None
        if ins.target is not None:
            assert start<=ins.target<=start+count
            ins.target-=start
    body[5]=asm.encode(code)[0];body[6]=[];body[7]=[]
    importer.b.bodies.append(body)
    try: result=importer.body(len(importer.b.bodies)-1,body[0])
    finally: importer.b.bodies.pop()
    return asm.decode(result[5])

def verify_structure(before,after,expected,new_methods,traits):
    changed={i for i,(a,b) in enumerate(zip(before.bodies,after.bodies)) if g.freeze(a)!=g.freeze(b)}
    assert changed==expected,(changed,expected)
    assert len(after.bodies)==len(before.bodies)+new_methods
    for key in ('strings','ints','uints','doubles','namespaces','ns_sets','multinames'):
        old=getattr(before,key);new=getattr(after,key)
        assert repr(old)==repr(new[:len(old)]),key
    for key in ('metadata','scripts'):
        assert g.freeze(getattr(before,key))==g.freeze(getattr(after,key)),key
    assert g.freeze(before.methods)==g.freeze(after.methods[:len(before.methods)])
    assert len(after.methods)==len(before.methods)+new_methods
    for section in ('instances','classes'):
        old,new=getattr(before,section),getattr(after,section)
        assert len(old)==len(new)
        for i,(a,b) in enumerate(zip(old,new)):
            assert g.freeze(a[:-1])==g.freeze(b[:-1]),(section,i)
            assert g.freeze(a[-1])==g.freeze(b[-1][:len(a[-1])]),(section,i)
            assert [after.mn_name(t.name) for t in b[-1][len(a[-1]):]]==traits.get((section,i),[])

def build(source,donor,output):
    assert sha(source.read_bytes())==BASE_SHA,'accepted SWF identity mismatch'
    assert sha(donor.read_bytes())==DONOR_SHA,'reviewed author identity mismatch'
    assert not output.exists(),'output must be a new path'
    swf=SwfAbc(source);initial=copy.deepcopy(swf.abc)
    e=Editor(swf)
    for module in (content,damage,gauge,provenance):module.install(e)
    methods=e.apply()
    voice=[]
    target=g.View(swf,asm);author=g.View(SwfAbc(donor),asm)
    importer=g.Importer(target,author)
    for name,locked,at,old_count,start,new_count in VOICE_PLAN:
        index=bodies.resolve(swf.abc,name);body=swf.abc.bodies[index]
        assert sha(body[5])==locked and not body[6],name
        original=copy.deepcopy(body)
        new=fragment(importer,bodies.resolve(author.a,name),start,new_count)
        old=fragment(g.Importer(target,g.View(SwfAbc(source),asm)),index,at,old_count) if old_count else []
        stripped=asm.unsplice(body[5],at,old_count) if old_count else body[5]
        temp=copy.deepcopy(body);temp[5]=stripped
        code,ex,ins=asm.splice(temp,at,new,asm.ENTER)
        restore=copy.deepcopy(body);restore[5]=asm.unsplice(code,at,len(new))
        assert restore[5]==stripped
        if old_count: assert asm.splice(restore,at,old,asm.ENTER)[0]==original[5]
        else: assert restore[5]==original[5]
        metrics=asm.simulate(ins,body[3],swf.abc.multinames)
        assert metrics[1]==body[4]
        body[1]=max(body[1],metrics[0]);body[2]=max(body[2],asm.block_locals(ins))
        body[5],body[6]=code,ex
        voice.append(dict(method=name,body=index,at=at,old_count=old_count,new_count=new_count,
                          before=locked,after=sha(code),reversible=True))
    expected={bodies.resolve(swf.abc,k) for k in methods}|{v['body'] for v in voice}
    traits={}
    for cls,name,static in e.traits:
        index,_=e.instance(cls)
        traits.setdefault(('classes' if static else 'instances',index),[]).append(name)
    verify_structure(initial,swf.abc,expected,len(e.new_methods),traits)
    output.parent.mkdir(parents=True,exist_ok=True);swf.save(output)
    reread=SwfAbc(output)
    assert reread.abc.serialize()==swf.abc.serialize()
    assert swf.body[:swf._offset]==reread.body[:reread._offset]
    assert swf.body[swf._offset+swf._length:]==reread.body[reread._offset+reread._length:]
    # The existing local damage decorator still receives the original context.
    call=asm.decode(reread.abc.bodies[bodies.resolve(reread.abc,'MemberImpl/applyInstantAbility')][5])
    assert sum(x.name=='getlex' and reread.abc.mn_name(x.args[0])=='cn.mod::GenericDamage' for x in call)==1
    report={'status':'offline_candidate','source_sha256':BASE_SHA,'donor_sha256':DONOR_SHA,
            'output_sha256':sha(output.read_bytes()),'battle_methods':methods,
            'voice_methods':voice,'new_methods':e.new_methods,'new_traits':e.traits,
            'changed_original_bodies':sorted(expected),'unchanged_original_bodies':len(initial.bodies)-len(expected),
            'other_abc_tags_byte_identical':True,'generic_damage_preserved':True,
            'device_tested':False,'accepted_registry_changed':False}
    output.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ('status','output_sha256','changed_original_bodies','unchanged_original_bodies')}))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--donor',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();build(args.source,args.donor,args.output)
