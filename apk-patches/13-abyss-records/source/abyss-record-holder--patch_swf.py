"""Graft the nickname formatter onto the user-accepted folder-navigation APK."""
import copy, importlib.util, json, struct, zlib
from pathlib import Path
from types import SimpleNamespace
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('holder_model',HERE.parent/'startup-cache/build_swf.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)


def patch(source, output):
    assert b.sha(source.read_bytes())=='657ad0b8413b95fc875e62d227b1b0034b3421a2b2777dc09bb1cce7b3ec5445'
    version,header,tags=b.parts(source)
    abcs=[t for t in tags if t[0]==82]
    assert len(abcs)==291 and sum(len(t[3].bodies) for t in abcs)==96535
    tag,=[t for t in abcs if any(t[3].mn_name(i[0])=='cn.ui::AbyssRecordDetails' for i in t[3].instances)]
    target=b.m.View(SimpleNamespace(abc=tag[3]),b.m.asm)
    donor=b.m.View(SimpleNamespace(abc=b.helper_abc(source.parent/'records.swc')),b.m.asm)
    label='cn.ui::AbyssRecordDetails$/responseText|1'
    bi,=target.by_label[label];di,=donor.by_label[label]
    assert b.serialize(tag[3],tag[4])==tag[4]
    before=copy.deepcopy(target.a)
    target.a.bodies[bi]=b.m.Importer(target,donor).body(di,target.a.bodies[bi][0])
    assert target.normalized(bi)==donor.normalized(di)
    for i,body in enumerate(target.a.bodies):
        if i!=bi: assert b.m.freeze(body)==b.m.freeze(before.bodies[i])
    for field in ('methods','instances','classes','scripts','metadata'):
        assert b.m.freeze(getattr(target.a,field))==b.m.freeze(getattr(before,field))
    check=b.m.check_body(target.a.bodies[bi],target.a)
    payload=tag[2]+b.serialize(target.a,tag[4]);tag[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    raw=header+b''.join(t[1] for t in tags)
    output.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    final=b.parts(output)[2];old=b.parts(source)[2]
    assert len(final)==len(old) and sum(x[1]!=y[1] for x,y in zip(final,old))==1
    report={'parent_swf_sha256':b.sha(source.read_bytes()),'swf_sha256':b.sha(output.read_bytes()),
            'changed_method':f'{abcs.index(tag)}:{bi}','label':label,'original_bodies':96535,
            'added_bodies':0,'check':check,'all_other_tags_and_original_methods_unchanged':True,'main_abc_index':290}
    (source.parent/'swf-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
