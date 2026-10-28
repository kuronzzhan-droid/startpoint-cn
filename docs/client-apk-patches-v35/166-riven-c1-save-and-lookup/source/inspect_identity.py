import json, zlib
from bootstrap import BASE, ROOT, write_json
from swfabc import abcfmt, swftags
import asm, bodies
needle = b'<ADMISSION_ID>'
_,_,_,raw = swftags.load_swf(str(BASE))
results=[]
for code,offset,header,length in swftags.iter_tags(raw):
    content=raw[offset+header:offset+header+length]
    if needle not in content: continue
    row={'tag':code,'offset':offset,'length':length}
    if code==82:
        nul=content.index(b'\0',4)
        row['abc_name']=content[4:nul].decode()
        abc=abcfmt.ABC(content[nul+1:])
        sid=next(i for i,s in enumerate(abc.strings) if s==needle)
        labels=bodies.label_map(abc)
        row['methods']=[]
        for i,body in enumerate(abc.bodies):
            ops=asm.decode(body[5])
            for n,op in enumerate(ops):
                if op.name=='pushstring' and op.args==[sid]:
                    props=[abc.mn_name(x.args[0]) for x in ops[max(0,n-10):n+10]
                           if x.name in ('getproperty','setproperty','initproperty','callproperty','findpropstrict')]
                    row['methods'].append({'body':i,'label':labels.get(i),'instruction':n,'nearby_properties':props})
    results.append(row)
write_json(ROOT / 'audit/admission-identity.json', {'inherited_admission_id':needle.decode(),'matches':results})
print(json.dumps(results))
