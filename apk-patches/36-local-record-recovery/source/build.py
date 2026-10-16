"""Pinned R10 account/device record recovery; no gameplay or admission changes."""
import argparse
import copy
import importlib.util
import json
import struct
import uuid
import zipfile
import zlib
from pathlib import Path
from types import SimpleNamespace

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('record_lan_support',HERE.parent/'r10-public-release/build_lan.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
s,b=m.s,m.b
INPUTS={
    'lan':{
        'apk':'outputs/r10-admission-lan-20260915/StarPoint-CN-1.8.1-r10-admission-lan-20260915.apk',
        'sha256':'af2699ea9a2e8792b4f84dd72aea0c08cb1da6a5448a572896139150e6d51d4f',
        'swf_sha256':'13c2ab8f473622eabd111d5b140af27df3d698994fd8e59f2ddd039a4d57638a',
        'uuid':'f56d1bd9-104f-49fd-b675-4ad209c2930d'},
    'public':{'apk':str(m.APK.relative_to(ROOT)),'sha256':m.APK_SHA,'swf_sha256':m.SWF_SHA,'uuid':m.OLD_UUID},
}


def main(args):
    identity=INPUTS[args.variant]
    apk_input=ROOT/identity['apk']
    work,out=args.work.resolve(),args.out.resolve()
    for path in (work,out):
        assert '.cdn' not in [p.lower() for p in path.parts]
    assert not work.exists() and not (out/args.name).exists()
    assert Path(args.name).name==args.name and args.name.endswith('.apk')
    m.checker.verify('public')
    assert b.sha(apk_input.read_bytes())==identity['sha256']
    work.mkdir(parents=True)
    out.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(apk_input) as z:
        payload=z.read(m.SWF_MEMBER)
        assert b.sha(payload)==identity['swf_sha256']
        (work/'input.swf').write_bytes(payload)
        (work/'original.dex').write_bytes(z.read('classes.dex'))
    version,header,tags=s.parts(work/'input.swf')
    abcs=[t for t in tags if t[0]==82]
    assert len(abcs)==296 and sum(len(t[3].bodies) for t in abcs)==96631
    admission=m.constants(abcs)
    assert admission['ID']==m.BUILD_ID
    main_tag=abcs[-1]
    a=main_tag[3]
    assert s.serialize(a,main_tag[4])==main_tag[4]
    original_a=s.m.abcfmt.ABC(main_tag[4])
    v=s.m.View(SimpleNamespace(abc=a),s.m.asm)
    pool=s.PoolEditor(a)

    def q(ns,name):
        hits=[i for i in range(1,len(a.multinames)) if v.mn(i)==(7,(22,ns),name)]
        if hits:return hits[0]
        spaces=[i for i,n in enumerate(a.namespaces) if i and n[0]==22 and a.s(n[1])==ns and n[1]!=0]
        if spaces:space=spaces[0]
        else:
            ix=pool.string(ns)
            if ix==0:a.strings.append(b'');ix=len(a.strings)-1
            a.namespaces.append((22,ix));space=len(a.namespaces)-1
        a.multinames.append((7,space,pool.string(name)))
        return len(a.multinames)-1

    helper=q('cn.storage','LocalRecordIO')
    changes=[]
    # Keep all original compression/serialization and file-selection logic.
    # Remove the unsafe pre-delete and replace only the final writer's receiver.
    for bi,at,local in [(29390,50,3),(29456,75,6)]:
        body=a.bodies[bi]
        assert not body[6]
        code=s.m.asm.decode(body[5])
        rows=v.normalized(bi)[0]
        assert [x[0] for x in rows[at:at+5]]==[0xd3 if local==3 else 0x62,0x66,0x12,0xd3 if local==3 else 0x62,0x4f]
        assert rows[at+1][1]==[(7,(22,''),'exists')]
        assert rows[at+4][1]==[(7,(22,''),'deleteFile'),0]
        assert rows[at+5][0:2]==(0x60,[(7,(22,'pinball.asset.file'),'FileUtil')])
        for i in range(at,at+5):code[i]=s.m.asm.assemble([('nop',)])[0]
        code[at+5].args=[helper]
        body[5]=s.m.asm.encode(code)[0]
        reverse=s.m.asm.decode(body[5])
        reverse[at:at+6]=copy.deepcopy(s.m.asm.decode(original_a.bodies[bi][5])[at:at+6])
        assert s.m.asm.encode(reverse)[0]==original_a.bodies[bi][5]
        changes.append({'body':bi,'change':'keep old record until sibling temporary file is fully written','reversible':True})
    # A zero-byte account has no recoverable account data. Treat it as missing,
    # so the existing login flow can rebuild it after authenticating the user.
    bi=29386
    body=a.bodies[bi]
    assert v.normalized(bi)[0][22][0:2]==(0x60,[(7,(22,'pinball.asset.file'),'FileUtil')])
    guard=s.m.asm.assemble([('getlocal_2',),('getproperty',q('','size')),('pushbyte',0),('ifne','END'),
                          ('getlex',q('haxe.ds','Option')),('getproperty',q('','None')),('returnvalue',)])
    body[5],body[6],_,placed=s.m.asm.splice_many(body,[(22,guard,s.m.asm.ENTER)])
    assert s.m.asm.unsplice_many(body[5],placed)==original_a.bodies[bi][5]
    changes.append({'body':bi,'change':'empty account returns the existing None result','reversible':True})
    classes='cn.storage.LocalRecordIO'
    paths=str(HERE/'src')
    if args.probe:
        paths+=','+str(HERE/'tests')
        classes+=',cn.probe.StartupProbe,RecordHarness'
        probe=q('cn.probe','StartupProbe')
        body=a.bodies[2596]
        assert s.m.asm.decode(body[5])[7].op==0x49
        body[5],body[6],_,placed=s.m.asm.splice_many(body,[
            (0,s.m.asm.assemble([('getlex',probe),('callpropvoid',q('','mark'),0)]),s.m.asm.ENTER),
            (8,s.m.asm.assemble([('getlex',probe),('getlocal_0',),('callpropvoid',q('','install'),1)]),s.m.asm.ENTER)])
        assert s.m.asm.unsplice_many(body[5],placed)==original_a.bodies[2596][5]
        changes.append({'body':2596,'change':'temporary Android fixture/exception probe; not a release','reversible':True})
    changed={row['body'] for row in changes}
    for row in changes:
        body=a.bodies[row['body']]
        check=s.m.check_body(body,a)
        assert check['max_stack']<=body[1] and check['max_scope']<=body[4]
        row['stack_scope_check']=check
    for bi,body in enumerate(a.bodies):
        if bi not in changed:assert s.m.freeze(body)==s.m.freeze(original_a.bodies[bi]),bi
    for field in ('methods','metadata','instances','classes','scripts'):
        assert s.m.freeze(getattr(a,field))==s.m.freeze(getattr(original_a,field)),field
    for field in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
        old=getattr(original_a,field)
        assert s.m.freeze(getattr(a,field)[:len(old)])==s.m.freeze(old),field
    b.run([b.JAVA,'-Dflexlib='+str(b.SDK/'frameworks'),'-Xmx512m','-jar',b.SDK/'lib/compc-cli.jar',
           '+configname=air','-swf-version=44','-target-player=32.0','-debug=false','-compiler.source-path='+paths,
           '-include-classes='+classes,'-output='+str(work/'helper.swc')],work,'compile-helper')
    with zipfile.ZipFile(work/'helper.swc') as z:(work/'helper.swf').write_bytes(z.read('library.swf'))
    helpers=[t for t in s.parts(work/'helper.swf')[2] if t[0]==82]
    if not args.probe:
        assert [t[3].mn_name(i[0]) for t in helpers for i in t[3].instances]==['cn.storage::LocalRecordIO']
    helper_checks=[]
    for t in helpers:
        for bi,body in enumerate(t[3].bodies):
            check=s.m.check_body(body,t[3])
            assert check['max_stack']<=body[1] and check['max_scope']<=body[4]
            helper_checks.append(check)
    payload=main_tag[2]+s.serialize(a,main_tag[4])
    main_tag[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    raw=header+b''.join((b''.join(t[1] for t in helpers) if t is abcs[0] else b'')+t[1] for t in tags)
    swf=work/'local-record-recovery.swf'
    swf.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    final_tags=s.parts(swf)[2]
    final_abcs=[t for t in final_tags if t[0]==82]
    assert m.constants(final_abcs)==admission
    for i,t in enumerate(abcs):
        final=final_abcs[i+len(helpers)]
        if t is main_tag:assert final[4]==s.serialize(a,main_tag[4])
        else:assert final[1]==t[1]
    assert [t[1] for t in tags if t[0]!=82]==[t[1] for t in final_tags if t[0]!=82]
    uid=str(uuid.uuid4());old_uid=identity['uuid']
    b.run([b.JAVA,'-jar',b.ALIB/'baksmali.jar','d','-o',work/'smali',work/'original.dex'],work,'decode-dex')
    originals={p.relative_to(work/'smali'):p.read_text('utf-8') for p in (work/'smali').rglob('*.smali')}
    hits={}
    for path,text in originals.items():
        if old_uid in text:
            assert path.as_posix() in {'cn/startpoint/StartupCache.smali','cn/startpoint/BuildIdentity.smali'}
            hits[path.as_posix()]=text.count(old_uid)
            (work/'smali'/path).write_text(text.replace(old_uid,uid),'utf-8')
    assert len(originals)==6 and len(hits)==2 and sum(hits.values())==2
    b.run([b.JAVA,'-jar',b.ALIB/'smali.jar','a','-a','21','-o',work/'classes.dex',work/'smali'],work,'encode-dex')
    b.run([b.JAVA,'-jar',b.ALIB/'baksmali.jar','d','-o',work/'native-readback',work/'classes.dex'],work,'readback-dex')
    for path,text in originals.items():
        assert m.native.canonical((work/'native-readback'/path).read_text('utf-8').replace(uid,old_uid))==m.native.canonical(text)
    payloads={m.SWF_MEMBER:swf.read_bytes(),'classes.dex':(work/'classes.dex').read_bytes()}
    with zipfile.ZipFile(apk_input) as z,zipfile.ZipFile(work/'unsigned.apk','w') as dest:
        manifest=z.read('AndroidManifest.xml')
        assert manifest.count(old_uid.encode('utf-16le'))==1
        payloads['AndroidManifest.xml']=manifest.replace(old_uid.encode('utf-16le'),uid.encode('utf-16le'))
        for item in z.infolist():
            if item.filename not in m.SIGNATURES:dest.writestr(item,payloads.get(item.filename,z.read(item.filename)))
    align=Path('F:/StartPointCN/wf_full_patch/build-tools/zipalign.exe')
    b.run([align,'-p','4',work/'unsigned.apk',work/'aligned.apk'],work,'align')
    apk=out/args.name
    b.run(['powershell','-NoProfile','-NonInteractive','-File',HERE.parent/'lens0907-0908/sign_apk.ps1',
           '-InputApk',work/'aligned.apk','-OutputApk',apk,'-ApkSigner',b.ALIB/'apksigner.jar','-Java',b.JAVA],work,'sign')
    sig=b.run([b.JAVA,'-jar',b.ALIB/'apksigner.jar','verify','--verbose','--print-certs',apk],work,'verify-signature')
    assert b.CERT in sig.lower()
    assert all('Verified using '+x+': true' in sig for x in ['v1 scheme (JAR signing)','v2 scheme (APK Signature Scheme v2)'])
    b.run([align,'-c','-p','4',apk],work,'verify-align')
    with zipfile.ZipFile(apk_input) as before,zipfile.ZipFile(apk) as after:
        assert len(after.namelist())==len(set(after.namelist())) and set(after.namelist())==set(before.namelist())
        for name in set(after.namelist())-m.SIGNATURES:assert after.read(name)==payloads.get(name,before.read(name)),name
        manifest=after.read('AndroidManifest.xml')
        assert manifest.count(uid.encode('utf-16le'))==1 and old_uid.encode('utf-16le') not in manifest
    report={'apk':str(apk),'sha256':b.sha(apk.read_bytes()),'swf_sha256':b.sha(swf.read_bytes()),
            'uuid':uid,'variant':args.variant,'build_id':admission['ID'],'origin':admission['ORIGIN'],
            'baseline':identity,'changes':changes,'original_bodies_verified':96631,'all_other_methods_preserved':True,
            'helper_method_checks':helper_checks,'probe':args.probe,'native_classes_verified':6,'signer_sha256':b.CERT,
            'zipalign':True,'v1_v2':True,'admission_id_key_and_behavior_unchanged':True,
            'save_schema_changed':False,'record_encoding_unchanged':True,'registry_promoted':False}
    (out/(apk.stem+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(json.dumps({k:report[k] for k in ['apk','sha256','swf_sha256','uuid','probe']},ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--work',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--name',required=True)
    parser.add_argument('--variant',choices=['lan','public'],default='lan')
    parser.add_argument('--probe',action='store_true')
    main(parser.parse_args())
