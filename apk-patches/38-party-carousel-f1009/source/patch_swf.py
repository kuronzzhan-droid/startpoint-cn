"""Fix lazy party registration with two reversible AVM2 method insertions."""
import copy, importlib.util, json, struct, sys, zlib
from pathlib import Path
from types import SimpleNamespace

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('startup_swf',HERE.parent/'startup-cache/build_swf.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)

def patch(source, target):
    assert s.sha(source.read_bytes()) in {
        '9e7af3223559e05af44abc6f5a4a40c9c71b7196a74780ff911632ffa3682186',
        '2b72ea4140a759c33fc6b86ebfa1fdfd6acd2478fe911d8545a0f3995e15ee93'}
    version,header,tags=s.parts(source)
    abcs=[t for t in tags if t[0]==82]
    assert len(abcs)==289 and sum(len(t[3].bodies) for t in abcs)==96520
    main=abcs[288];a=main[3];v=s.m.View(SimpleNamespace(abc=a),s.m.asm)
    before=copy.deepcopy(a)
    assert a.serialize()==main[4]
    def q(name):
        matches=[i for i in range(1,len(a.multinames)) if v.mn(i)==(7,(22,''),name)]
        assert matches,name
        return matches[0]
    # Validate the destination before creating anything; make both name records
    # available before the existing SwitchParty command is sent to the view.
    preflight=s.m.asm.assemble([
        ('getlocal_2',),('pushbyte',0),('iflt','reject'),
        ('getlocal_2',),('getlocal_0',),('getproperty',q('characterContainers')),('getproperty',q('length')),('ifge','reject'),
        ('getlocal_0',),('getlocal_2',),('callpropvoid',q('initialzeAt'),1),
        ('getlocal_1',),('pushbyte',0),('iflt','fallback'),
        ('getlocal_1',),('getlocal_0',),('getproperty',q('characterContainers')),('getproperty',q('length')),('ifge','fallback'),
        ('getlocal_0',),('getlocal_1',),('callpropvoid',q('getPartyData'),1),('jump','END'),
        ('label','fallback'),('getlocal_2',),('setlocal_1',),('jump','END'),
        ('label','reject'),('returnvoid',)
    ])
    touch=s.m.asm.assemble([('getlocal',7),('iftrue','END'),('returnvoid',)])
    changes=[]
    for label,expected,index,block in [
        ('pinball.scene.character.partyCarousel::PartyCarousel/changeIndex|1',66523,2,preflight),
        ('pinball.scene.character.cell.button::CharacterCellButtonProcessor/beginTouch|1',66013,8,touch)]:
        assert v.by_label[label]==[expected]
        b=a.bodies[expected]
        if expected==66013:
            original=s.m.asm.decode(b[5])
            assert original[7].op==0x63 and tuple(original[7].args)==(7,)
        b[5],b[6],_,placed=s.m.asm.splice_many(b,[(index,block,s.m.asm.ENTER)])
        assert s.m.asm.unsplice_many(b[5],placed)==before.bodies[expected][5]
        check=s.m.check_body(b,a)
        changes.append({'body':expected,'label':label,'at':index,'added_instructions':len(block),'check':check,'reversible':True})
    for i,b in enumerate(a.bodies):
        if i not in (66523,66013):assert s.m.freeze(b)==s.m.freeze(before.bodies[i]),i
    # No pools, class layouts, method signatures or script metadata change.
    for field in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames','methods','metadata','instances','classes','scripts'):
        assert s.m.freeze(getattr(a,field))==s.m.freeze(getattr(before,field)),field
    data=main[2]+a.serialize();main[1]=struct.pack('<HI',(82<<6)|63,len(data))+data
    raw=header+b''.join(t[1] for t in tags)
    target.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    final=s.parts(target)[2];old=s.parts(source)[2]
    assert len(final)==len(old) and sum(x[1]!=y[1] for x,y in zip(old,final))==1
    report={'input_swf_sha256':s.sha(source.read_bytes()),'swf_sha256':s.sha(target.read_bytes()),'main_abc':288,
        'method_bodies':96520,'changes':changes,'all_other_bodies_unchanged':True,'pools_and_class_layouts_unchanged':True,
        'current_party_only_update_preserved':True}
    target.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report

if __name__=='__main__':print(json.dumps(patch(Path(sys.argv[1]),Path(sys.argv[2])),indent=2))
