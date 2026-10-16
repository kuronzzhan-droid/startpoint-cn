"""Graft only the details opener; append a standalone record-reader ABC."""
import copy, importlib.util, json, struct, sys, zlib
from pathlib import Path
from types import SimpleNamespace

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('record_model',HERE.parent/'startup-cache/build_swf.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
m=b.m

def patch(source,output):
    work=source.parent
    version,header,tags=b.parts(source)
    abcs=[x for x in tags if x[0]==82]
    assert len(abcs)==289 and sum(len(x[3].bodies) for x in abcs)==96520
    hits=[x for x in abcs if any(x[3].mn_name(i[0])=='cn.ui::AbyssDetails' for i in x[3].instances)]
    assert len(hits)==1
    tag=hits[0];target=m.View(SimpleNamespace(abc=tag[3]),m.asm)
    donor=m.View(SimpleNamespace(abc=b.helper_abc(work/'details.swc')),m.asm)
    label='cn.ui::AbyssDetails$/openDetails|1'
    bi,=target.by_label[label];di,=donor.by_label[label]
    assert b.serialize(tag[3],tag[4])==tag[4]
    before=copy.deepcopy(target.a)
    target.a.bodies[bi]=m.Importer(target,donor).body(di,target.a.bodies[bi][0])
    assert target.normalized(bi)==donor.normalized(di)
    for i,body in enumerate(target.a.bodies):
        if i!=bi:assert m.freeze(body)==m.freeze(before.bodies[i])
    for field in ['methods','instances','classes','scripts','metadata']:
        assert m.freeze(getattr(target.a,field))==m.freeze(getattr(before,field))
    m.check_body(target.a.bodies[bi],target.a)
    payload=tag[2]+b.serialize(target.a,tag[4]);tag[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    extra=b.helper_abc(work/'records.swc')
    assert len(extra.instances)==1 and extra.mn_name(extra.instances[0][0])=='cn.ui::AbyssRecordDetails'
    # Static stack verification of all added compiled methods.
    for body in extra.bodies:m.check_body(body,extra)
    payload=struct.pack('<I',1)+b'cn.ui.AbyssRecordDetails\0'+extra.serialize()
    addition=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    main=abcs[-1]
    raw=header+b''.join((addition if row is main else b'')+row[1] for row in tags)
    output.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    final=b.parts(output)[2];final_abcs=[x for x in final if x[0]==82]
    assert len(final_abcs)==290
    # Every original tag except the one details ABC is retained byte-for-byte.
    oldtags=b.parts(source)[2];newtags=[x for x in final if not(x[0]==82 and x[2][4:-1]==b'cn.ui.AbyssRecordDetails')]
    assert len(oldtags)==len(newtags)
    assert sum(x[1]!=y[1] for x,y in zip(oldtags,newtags))==1
    report={'parent_swf_sha256':b.sha(source.read_bytes()),'swf_sha256':b.sha(output.read_bytes()),
        'changed_method':f'{abcs.index(tag)}:{bi}','label':label,'original_bodies':96520,
        'added_bodies':len(extra.bodies),'other_original_tags_byte_identical':True,'main_abc_index':289}
    (work/'swf-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
