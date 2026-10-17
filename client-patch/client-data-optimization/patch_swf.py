"""Compose bounded data optimizations using existing method bodies and one helper ABC."""
import argparse
import copy
import importlib.util
import json
import os
import struct
import subprocess
import zlib
from pathlib import Path

import importlib.util as _quiet_importlib
import sys as _quiet_sys
_quiet_spec = _quiet_importlib.spec_from_file_location("starpoint_quiet_process", Path(__file__).resolve().parents[1] / 'quiet_process.py')
quiet = _quiet_importlib.module_from_spec(_quiet_spec)
_quiet_sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)
from types import SimpleNamespace

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('comprehensive_data_support',HERE.parent/'startup-cache/build_swf.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
HELPER='cn.optimize.data.DataOptimization'
SDK=Path(os.environ.get('STARPOINT_AIR_SDK', 'AIRSDK_51.2.1.5'))
JAVA=Path(os.environ.get('STARPOINT_JAVA', 'java'))

_views={}
def view(abc):
    key=id(abc)
    if key not in _views:_views[key]=s.m.View(SimpleNamespace(abc=abc),s.m.asm)
    return _views[key]

def q(abc,ns,name):
    v=view(abc);pool=s.PoolEditor(abc)
    matches=[i for i in range(1,len(abc.multinames)) if v.mn(i)==(7,(22,ns),name)]
    if matches:return matches[0]
    spaces=[i for i,row in enumerate(abc.namespaces) if i and row[0]==22 and abc.s(row[1])==ns]
    if spaces:space=spaces[0]
    else:space=len(abc.namespaces);abc.namespaces.append((22,pool.string(ns)))
    abc.multinames.append((7,space,pool.string(name)));return len(abc.multinames)-1

def label_body(abc,label):
    index,=view(abc).by_label[label];return index,abc.bodies[index]

def replacement(body,changes):
    """Replace closed instruction ranges, keeping all external branch targets."""
    assert not body[6], 'range replacement needs an empty original exception table'
    old=s.m.asm.decode(body[5]);result=[];mapping={};cursor=0
    for start,end,block in sorted(changes):
        assert cursor<=start<=end<=len(old)
        for i in range(cursor,start):mapping[i]=len(result);result.append(copy.deepcopy(old[i]))
        mapping[start]=len(result)
        base=len(result)
        for row in copy.deepcopy(block):
            if row.target is not None:row.target+=base
            if row.cases is not None:row.default+=base;row.cases=[x+base for x in row.cases]
            result.append(row)
        cursor=end
    for i in range(cursor,len(old)):mapping[i]=len(result);result.append(copy.deepcopy(old[i]))
    mapping[len(old)]=len(result)
    # Only old instructions use old offsets; identify them by the map.
    for old_index,new_index in mapping.items():
        if old_index==len(old):continue
        if any(a<=old_index<b for a,b,_ in changes):continue
        row=result[new_index]
        if row.target is not None:
            assert row.target in mapping, 'branch enters a removed instruction range'
            row.target=mapping[row.target]
        if row.cases is not None:
            assert all(x in mapping for x in [row.default,*row.cases])
            row.default=mapping[row.default];row.cases=[mapping[x] for x in row.cases]
    body[5]=s.m.asm.encode(result)[0]
    return mapping

def invoke(abc,name,args,returns=True):
    rows=[('getlex',q(abc,'cn.optimize.data','DataOptimization'))]+args
    rows.append(('callproperty' if returns else 'callpropvoid',q(abc,'',name),len(args)))
    return rows

def compile_helper(work):
    work.mkdir(parents=True,exist_ok=True);swc=work/'data-optimization.swc'
    args=[JAVA,'-Dflexlib='+str(SDK/'frameworks'),'-Xmx512m','-jar',SDK/'lib/compc-cli.jar',
          '+configname=air','-swf-version=32','-target-player=21.0','-compiler.float=false','-debug=false',
          '-compiler.source-path='+str(HERE/'src'),'-include-classes='+HELPER,'-output='+str(swc)]
    result=quiet.run([str(x) for x in args],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
    (work/'compile.log').write_text(result.stdout+result.stderr,encoding='utf-8')
    assert result.returncode==0,str(work/'compile.log')
    helper=s.helper_abc(swc)
    assert helper.major==46 and len(helper.instances)==1
    assert helper.mn_name(helper.instances[0][0])=='cn.optimize.data::DataOptimization'
    for body in helper.bodies:s.m.check_body(body,helper)
    return helper

def scope_body(abc,body):
    assert not body[6]
    original=s.m.asm.decode(body[5])
    beg=s.m.asm.assemble(invoke(abc,'beginNodes',[])+[('setlocal',42)])
    end=s.m.asm.assemble(invoke(abc,'endNodes',[('getlocal',42)],False))
    inserts=[(2,beg,s.m.asm.ENTER)]+[(i,end,s.m.asm.ENTER) for i,x in enumerate(original) if x.op in (0x47,0x48)]
    _,_,merged,_=s.m.asm.splice_many(body,inserts)
    handler=len(merged)
    merged+=s.m.asm.assemble([('setlocal',43)]+invoke(abc,'endNodes',[('getlocal',42)],False)+[('getlocal',43),('throw',)])
    body[5],offsets=s.m.asm.encode(merged)
    body[6]=[(offsets[2+len(beg)],offsets[handler],offsets[handler],0,0)]
    body[2]=max(body[2],44);body[1]=max(body[1],8)

def optimize_methods(abc):
    pins=json.loads((HERE/'method-fingerprints.json').read_text(encoding='utf-8'))
    for label,hashes in pins.items():
        _,body=label_body(abc,label)
        assert s.sha(body[5]) in hashes,'unsupported target/reader: '+label
    changes=[]
    def edit(label,func):
        index,body=label_body(abc,label);before=s.sha(body[5]);func(body)
        body[1]=max(body[1],8)
        check=s.m.check_body(body,abc);body[1]=max(body[1],check['max_stack']);body[4]=max(body[4],check['max_scope'])
        changes.append({'method':label,'body':index,'before_code_sha256':before,'after_code_sha256':s.sha(body[5]),'check':check,'exceptions':body[6]})
    def rows(items):return s.m.asm.assemble(items)
    pub=lambda name:q(abc,'',name)

    def ranks(body):
        before=s.m.asm.decode(body[5])
        assert before[174].op==0x46 and before[199].op==0x4F
        construct=rows(invoke(abc,'ranks',[('getlocal',5)])+[('setlocal',14)])
        lookup=rows(invoke(abc,'rank',[('getlocal',14),('getlocal',8)])+[('convert_i',)])
        comparator=rows(invoke(abc,'rankComparator',[('getlocal',14)]))
        replacement(body,[(104,104,construct),(172,176,lookup),(191,199,comparator)])
        body[2]=max(body[2],15)
    edit('pinball.scene.character.characterTable::CharacterTable/applyCharacters|1',ranks)

    def gauges(body):
        decimal=q(abc,'pinball.common.math._Decimal','Decimal_Impl_')
        clamp=[('getlex',decimal),('getlocal',20),('callproperty',pub('getSecondSkillGauge'),0),
               ('getlex',decimal),('pushbyte',0),('callproperty',pub('fromInt'),1),('convert_d',),
               ('getlex',decimal),('pushbyte',1),('callproperty',pub('fromInt'),1),('convert_d',),
               ('callproperty',pub('clamp'),3),('convert_d',)]
        replacement(body,[(215,228,[]),
                          (229,231,rows([('getlocal',20),('callproperty',pub('getSkillGauge'),0)])),
                          (236,238,rows([('getlocal',20),('callproperty',pub('getFixedSkillGauge'),0)])),
                          (243,245,rows(clamp))])
    edit('pinball.scene.character.translator::PartyTranslator/createStatus|1',gauges)

    def finder(body):
        original=s.m.asm.decode(body[5]);assert original[89].op==0x4F
        # Preserve the original comparator construction, then store its result.
        capture=copy.deepcopy(original[80:89])+rows([('setlocal',10)])
        args=[('getlocal_0',),('getlocal',6),('getlocal_1',),('getlocal',10)]
        replacement(body,[(79,90,capture+rows(invoke(abc,'sortIfChanged',args,False)))])
        body[2]=max(body[2],11)
    edit('pinball.scene.character.characterList::CharacterListCachedRepository/find|1',finder)
    def forget(body):
        body[5],body[6],_,_=s.m.asm.splice_many(body,[(2,rows(invoke(abc,'forgetSort',[('getlocal_0',)],False)),s.m.asm.ENTER)])
    edit('pinball.scene.character.characterList::CharacterListCachedRepository/clearCache|1',forget)

    def party_data(body):
        body[5]=s.m.asm.encode(rows([('getlocal_0',),('pushscope',)]+invoke(abc,'partyData',[('getlocal_0',),('getlocal_1',)])+[('coerce',pub('Object')),('returnvalue',)]))[0]
        body[6]=[]
    edit('pinball.scene.character.partyCarousel::PartyCarousel/getPartyData|1',party_data)
    def detail(body):
        body[5]=s.m.asm.encode(rows([('getlocal_0',),('pushscope',)]+invoke(abc,'applyDetails',[('getlocal_0',),('getlocal_1',)],False)+[('returnvoid',)]))[0]
        body[6]=[]
    edit('pinball.scene.character.partyCarousel::PartyCarousel/applyDetailSetting|1',detail)
    # Original initialzeAt already reads the revision-aware getPartyData.
    # Original getCurrentPartyData initializes then returns that same array slot.
    # Preserve both methods exactly; another helper read cannot refresh anything.
    def accept(body):
        old=s.m.asm.decode(body[5]);index=next(i for i,x in enumerate(old) if x.op in (0x61,0x68))
        body[5],body[6],_,_=s.m.asm.splice_many(body,[(index+1,rows(invoke(abc,'acceptParty',[('getlocal_0',),('getlocal_1',)],False)),s.m.asm.ENTER)])
    edit('pinball.scene.character.partyCarousel::PartyCarousel/applyParty|1',accept)
    def accept_group(body):
        old=s.m.asm.decode(body[5])
        assert old[69].op==0x46 and view(abc).mn(old[69].args[0])[-1]=='getPartyAt' and old[69].args[1]==3
        assert old[71].op==0x61 and view(abc).mn(old[71].args[0])[0]==27
        block=rows(invoke(abc,'acceptParty',[('getlocal_0',),('getlocal',5)],False))
        body[5],body[6],_,placed=s.m.asm.splice_many(body,[(72,block,s.m.asm.ENTER)])
        assert s.m.asm.unsplice_many(body[5],placed)==s.m.asm.encode(old)[0]
    edit('pinball.scene.character.partyCarousel::PartyCarousel/partyChanged|1',accept_group)

    def deferred_badge(body):
        old=s.m.asm.decode(body[5]);v=view(abc)
        assert old[4].op==0x1B and old[4].cases==[6,28,33,47]
        assert old[11].op==0x46 and v.mn(old[11].args[0])[-1]=='getCharacterQuestGroup' and old[11].args[1]==1
        assert old[17].op==old[21].op==0x46 and v.mn(old[17].args[0])[-1]=='getPlayer' and v.mn(old[21].args[0])[-1]=='getTime'
        assert old[23].op==0x4A and old[26].op==0x48 and not body[6]
        # Reuse original repository/id and player/time evaluation instructions;
        # replace only case 0's eager group lookup and Bind construction.
        block=rows([('getlex',q(abc,'cn.optimize.data','DataOptimization'))])
        block+=copy.deepcopy(old[7:11])+rows([('convert_i',)])+copy.deepcopy(old[15:23])
        block+=rows([('callproperty',pub('deferredQuestBadge'),4),('coerce',pub('Function'))])
        mapping=replacement(body,[(6,26,block)])
        final=s.m.asm.decode(body[5])
        # All other switch cases and their internal instruction operands survive.
        for index in range(28,len(old)):
            current=final[mapping[index]]
            assert current.op==old[index].op and current.args==old[index].args
            assert current.target==(mapping[old[index].target] if old[index].target is not None else None)
    edit('pinball.scene.character.translator::CharacterTranslator/getBadgeReasonMethod|1',deferred_badge)

    def nodes(body):
        body[5]=s.m.asm.encode(rows([('getlocal_0',),('pushscope',)]+invoke(abc,'nodes',[('getlocal_0',)])+[('coerce',pub('Array')),('returnvalue',)]))[0]
        body[6]=[]
    edit('pinball.common.data.character::BattleCharacterLogic/getLearnedManaNodes|1',nodes)
    edit('pinball.scene.character.translator::PartyTranslator/translate|1',lambda body:scope_body(abc,body))
    return changes

def patch(source,output):
    source,output=Path(source).resolve(),Path(output).resolve()
    assert not output.exists() and source!=output and '.cdn' not in [x.lower() for x in output.parts]
    helper=compile_helper(output.parent/'data-helper-build')
    version,header,tags=s.parts(source);originals=copy.deepcopy(tags)
    assert not any(t[0]==82 and t[2][4:-1].decode()==HELPER for t in tags),'helper already installed'
    main,=[t for t in tags if t[0]==82 and t[2][4:-1]==b'boot_ffc6']
    before=copy.deepcopy(main[3]);changes=optimize_methods(main[3])
    allowed={row['body'] for row in changes}
    actual={i for i,b in enumerate(main[3].bodies) if s.m.freeze(b)!=s.m.freeze(before.bodies[i])}
    assert actual==allowed
    for field in ['methods','metadata','instances','classes','scripts']:
        assert s.m.freeze(getattr(before,field))==s.m.freeze(getattr(main[3],field)),field
    for field in ['ints','uints','doubles','strings','namespaces','ns_sets','multinames']:
        prefix=getattr(before,field);assert s.m.freeze(getattr(main[3],field)[:len(prefix)])==s.m.freeze(prefix),field
    payload=main[2]+s.serialize(main[3],main[4]);main[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    extra=struct.pack('<I',1)+HELPER.encode()+b'\0'+helper.serialize()
    extra=struct.pack('<HI',(82<<6)|63,len(extra))+extra
    raw=header+b''.join((extra if t is main else b'')+t[1] for t in tags)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    final=s.parts(output)[2];existing=[t for t in final if not(t[0]==82 and t[2][4:-1].decode()==HELPER)]
    assert len(existing)==len(tags)
    for current,intended,prior in zip(existing,tags,originals):
        assert current[1]==intended[1]
        if intended is not main:assert current[1]==prior[1]
    report={'input_swf_sha256':s.sha(source.read_bytes()),'output_swf_sha256':s.sha(output.read_bytes()),'changes':changes,
            'helper_abc_name':HELPER,'helper_instances':len(helper.instances),'helper_methods':len(helper.bodies),
            'helper_abc_sha256':s.sha(helper.serialize()),
            'helper_method_labels':sorted(view(helper).by_label),
            'helper_static_traits':[{'name':helper.mn_name(t.name),'kind':t.kind} for t in helper.classes[0][1]],
            'existing_traits_and_signatures_preserved':True,'constant_pool_prefixes_preserved':True,
            'all_unrelated_methods_and_tags_preserved':True,'save_or_persistence_change':False,
            'device_or_framerate_acceptance':False}
    output.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('source',type=Path);a.add_argument('output',type=Path);args=a.parse_args()
    print(json.dumps(patch(args.source,args.output),ensure_ascii=False))
