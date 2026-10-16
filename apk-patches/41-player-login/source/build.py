"""Formal R10 cumulative release: remove diagnostics, preserve performance, add admission."""
import argparse, copy, importlib.util, json, re, secrets, struct, uuid, zipfile, zlib
from pathlib import Path
from types import SimpleNamespace
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
s=module('admission_swf_support',HERE.parent/'startup-cache/build_swf.py')
b=module('admission_apk_support',HERE.parent/'startup-cache/build.py')
native=module('admission_native_support',HERE.parent/'startup-cache/verify_native.py')
checker=module('admission_baseline',HERE.parent/'verify_android_baseline.py')

def release_identity():
    accepted=checker.verify('public')
    assert accepted['apk_sha256']=='35e0e7c777798594d68c9bcd74c507c6f0b7d065453e0425c301258c6bc38ac6'
    apk=ROOT/'outputs/loading-r10-public-diagnostic-fixed2-20260915/StarPoint-CN-1.8.1-loading-r10-public-diagnostic-test-20260915.apk'
    assert b.sha(apk.read_bytes())=='6846c73bd2ade26d8269b8af0398d40c939a0f554ebe575c5d09b7779d7320d7'
    with zipfile.ZipFile(apk) as z,zipfile.ZipFile(accepted['apk']) as baseline:
        assert b.sha(z.read('assets/worldflipper_android_release.swf'))=='49aa2ef9bfd8aac4d90ed092ebcb49975fe9bc94c8718ebc264e738467a57363'
        allowed={'assets/worldflipper_android_release.swf','classes.dex','AndroidManifest.xml','META-INF/MANIFEST.MF','META-INF/WF.SF','META-INF/WF.RSA'}
        assert set(z.namelist())==set(baseline.namelist())
        for name in z.namelist():
            if name not in allowed:assert z.read(name)==baseline.read(name),name
    return {'apk':str(apk),'apk_sha256':'6846c73bd2ade26d8269b8af0398d40c939a0f554ebe575c5d09b7779d7320d7',
      'uniqueappversionid':'6b457568-d4a1-4918-a65f-b7c29b40759f','endpoint':'http://TEST-SERVER-HOST:8001',
      'main_abc_index':293,'method_bodies_checked':96582,'envelope_apk':accepted['apk'],'envelope_uuid':accepted['uniqueappversionid']}


def main(args):
    identity=release_identity()
    work=args.work.resolve();out=args.out.resolve();keysPath=args.keys.resolve()
    for target in (work,out,keysPath):
        assert '.cdn' not in [part.lower() for part in target.parts], 'read-only CDN boundary'
    assert re.fullmatch(r'[A-Za-z0-9_-]{1,80}',args.build_id), 'invalid build ID'
    assert Path(args.name).name==args.name and args.name.endswith('.apk'), 'invalid APK filename'
    work.mkdir(parents=True,exist_ok=False);out.mkdir(parents=True,exist_ok=True)
    origin=args.origin or identity['endpoint']
    assert origin.startswith('http://') and '/' not in origin[7:] and '"' not in origin
    if args.variant=='public':
        assert origin==identity['endpoint'] and not args.isolate_storage
        assert args.build_id=='android-181-r10-20260915'
    else:
        assert args.origin and args.isolate_storage
        assert args.build_id=='android-20260915-admission-01'
    with zipfile.ZipFile(identity['apk']) as z:
        (work/'input.swf').write_bytes(z.read('assets/worldflipper_android_release.swf'))
        (work/'original.dex').write_bytes(z.read('classes.dex'))
    version,header,tags=s.parts(work/'input.swf');abcs=[t for t in tags if t[0]==82]
    assert sum(len(t[3].bodies) for t in abcs)==identity['method_bodies_checked']
    assert len(abcs)-1==identity['main_abc_index']
    main=abcs[-1];changes=[];originals={id(t):copy.deepcopy(t[3]) for t in abcs}
    def view(t):return s.m.View(SimpleNamespace(abc=t[3]),s.m.asm)
    def q(t,ns,name):
        a=t[3];v=view(t);pool=s.PoolEditor(a)
        match=[i for i in range(1,len(a.multinames)) if v.mn(i)==(7,(22,ns),name)]
        if match:return match[0]
        spaces=[i for i,n in enumerate(a.namespaces) if i and n[0]==22 and a.s(n[1])==ns and n[1]!=0]
        if spaces:space=spaces[0]
        else:
            ix=pool.string(ns)
            if ix==0:a.strings.append(b'');ix=len(a.strings)-1
            a.namespaces.append((22,ix));space=len(a.namespaces)-1
        a.multinames.append((7,space,pool.string(name)));return len(a.multinames)-1
    def insert(t,bi,at,code):
        body=t[3].bodies[bi];old=body[5]
        body[5],body[6],_,placed=s.m.asm.splice_many(body,[(at,s.m.asm.assemble(code),s.m.asm.ENTER)])
        assert s.m.asm.unsplice_many(body[5],placed)==old
        body[1]=max(body[1],8)
        changes.append({'abc':abcs.index(t),'body':bi,'kind':'reversible insertion'})
    with zipfile.ZipFile(identity['envelope_apk']) as accepted_zip:
        (work/'accepted.swf').write_bytes(accepted_zip.read('assets/worldflipper_android_release.swf'))
        (work/'original.dex').write_bytes(accepted_zip.read('classes.dex'))
    base_tags=[t for t in s.parts(work/'accepted.swf')[2] if t[0]==82]
    base_main=base_tags[-1][3]
    audit=json.loads((HERE/'lineage.json').read_text('utf-8'))
    original_main=copy.deepcopy(main[3])
    actual={i for i,body in enumerate(main[3].bodies) if s.m.freeze(body)!=s.m.freeze(base_main.bodies[i])}
    assert actual==set(audit['changed_original_methods'])
    for field in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
        old=getattr(base_main,field);assert s.m.freeze(getattr(main[3],field)[:len(old)])==s.m.freeze(old),field
    for bi in audit['diagnostic_only_methods_proven_by_removing_instrumentation']:
        main[3].bodies[bi]=copy.deepcopy(base_main.bodies[bi])
        changes.append({'abc':abcs.index(main),'body':bi,'kind':'remove diagnostic-only instrumentation'})
    # R8's two optimized routines also contain entry/exit trace calls. Remove only
    # those balanced six-instruction blocks, relocating every branch, then prove
    # that reinserting the blocks reproduces the exact pinned R10 bytecode.
    for bi,phase,positions in ((15140,'abilities.summary',(0,598)),(92540,'abilities.available',(2,535))):
        body=main[3].bodies[bi];old=body[5];rows=view(main).normalized(bi)[0]
        assert not body[6], 'trace removal requires an empty exception table'
        blocks=[]
        for at,status in zip(positions,('begin','end')):
            expected=[(0x60,[(7,(22,'cn.diagnostics'),'LoadingTrace')]),(0x2c,[('string',phase)]),
                      (0x2c,[('string',status)]),(0xd0,[]),(0x20,[]),(0x4f,[(7,(22,''),'mark'),4])]
            assert [(x[0],x[1]) for x in rows[at:at+6]]==expected
            blocks.append(s.m.asm.decode(old)[at:at+6])
        placed=[(at,6,s.m.asm.ENTER) for at in positions]
        body[5]=s.m.asm.unsplice_many(old,placed)
        reinsert=[(at-6*i,block,s.m.asm.ENTER) for i,(at,block) in enumerate(zip(positions,blocks))]
        assert s.m.asm.splice_many(body,reinsert)[0]==old
        changes.append({'abc':abcs.index(main),'body':bi,'kind':'remove trace calls; R8 logic reversibly preserved','removed_blocks':placed})
    cache=q(main,'cn.loading','PartyDerivedCache')
    insert(main,76169,2,[('getlex',cache),('getlocal_0',),('callproperty',q(main,'','defer'),1),('iffalse','END'),('returnvoid',)])
    insert(main,76162,2,[('getlex',cache),('callpropvoid',q(main,'','reset'),0)])
    insert(main,28971,2,[('getlex',cache),('callpropvoid',q(main,'','finish'),0)])
    bi=view(main).by_label['pinball.scene.battle.state::BattleScenePlayingStateImpl/update|1'][0]
    ends=[i for i,x in enumerate(s.m.asm.decode(main[3].bodies[bi][5])) if x.op==0x47]
    for at in reversed(ends):insert(main,bi,at,[('getlex',cache),('callpropvoid',q(main,'','finish'),0)])
    for bi in (20565,66523,66013,66481):assert s.m.freeze(main[3].bodies[bi])==s.m.freeze(original_main.bodies[bi])
    removed=[t for t in abcs if t[2][4:-1] in (b'cn.diagnostics.LoadingTrace',b'cn.loading.PartyDerivedCache')]
    assert len(removed)==2
    # No runtime reference to the diagnostics class may survive in an original method.
    v=view(main)
    for bi,body in enumerate(main[3].bodies):
        for ins in s.m.asm.decode(body[5]):
            if ins.op==0x60:assert 'cn.diagnostics' not in str(v.mn(ins.args[0])),bi
    if not args.legacy:
        keysPath.parent.mkdir(parents=True,exist_ok=True)
        keys=json.loads(keysPath.read_text('utf-8-sig')) if keysPath.exists() else {}
        assert isinstance(keys,dict) and all(isinstance(v,str) and re.fullmatch(r'[a-f0-9]{64}',v) for v in keys.values()), 'invalid build keys'
        if args.build_id not in keys:
            keys[args.build_id]=secrets.token_hex(32)
            keysPath.write_text(json.dumps(keys,indent=2)+'\n','utf-8')
        generated=work/'generated/cn/admission';generated.mkdir(parents=True)
        cache_source=(HERE.parent/'loading-preparation-r10/src/cn/loading/PartyDerivedCache.as').read_text('utf-8')
        begin=cache_source.index('        private static function checkpoint(')
        end=cache_source.index('        public static function finish()',begin)
        cache_source=cache_source[:begin]+'        private static function checkpoint(phase:String):void {}\n'+cache_source[end:]
        cache_dir=work/'generated/cn/loading';cache_dir.mkdir(parents=True)
        (cache_dir/'PartyDerivedCache.as').write_text(cache_source,'utf-8')
        (generated/'BuildConfig.as').write_text('package cn.admission { public final class BuildConfig { public static const ID:String='+json.dumps(args.build_id)+'; public static const KEY:String='+json.dumps(keys[args.build_id])+'; public static const ORIGIN:String='+json.dumps(origin)+'; } }','utf-8')
        b.run([b.JAVA,'-Dflexlib='+str(b.SDK/'frameworks'),'-Xmx512m','-jar',b.SDK/'lib/compc-cli.jar',
            '+configname=air','-swf-version=44','-target-player=32.0','-debug=false',
            '-compiler.source-path='+str(HERE/'src')+','+str(work/'generated'),'-include-classes=cn.admission.ClientAdmission,cn.loading.PartyDerivedCache',
            '-output='+str(work/'admission.swc')],work,'compile-helper')
        helper=q(main,'cn.admission','ClientAdmission')
        assert view(main).normalized(29670)[0][332][0:2]==(0x62,[16])
        insert(main,29670,332,[('getlex',helper),('getlocal',16),('getlocal_2',),
            ('callproperty',q(main,'','forwardAdmission'),2),('iftrue','END'),('returnvoid',)])
        insert(main,29697,5,[('getlex',helper),('getlocal_0',),('getlocal_1',),('getlocal_2',),('getlocal_3',),
            ('callproperty',q(main,'','beforeQueue'),4),('iftrue','END'),('returnvoid',)])
        insert(main,29701,2,[('getlex',helper),('getlocal_0',),('getlocal_1',),('getlocal_3',),
            ('callproperty',q(main,'','inspect'),3),('iftrue','END'),('returnvoid',)])
        insert(main,31405,5,[('getlex',helper),('getlocal_0',),('callpropvoid',q(main,'','socket'),1)])
        insert(main,31407,2,[('getlex',helper),('getlocal_0',),('callproperty',q(main,'','beforeSocketConnect'),1),('iftrue','END'),('returnvoid',)])
        insert(main,31421,2,[('getlex',helper),('getlocal_0',),('callpropvoid',q(main,'','socketClosed'),1)])
        insert(main,29703,2,[('getlex',helper),('getlocal_0',),('callpropvoid',q(main,'','queueCanceled'),1)])
        login=next(t for t in abcs if any(t[3].mn_name(i[0])=='cn.account::PlayerLogin' for i in t[3].instances))
        v=view(login);bi=v.by_label['cn.account::PlayerLogin$/cn.account:PlayerLogin::request|1'][0]
        body=login[3].bodies[bi];code=s.m.asm.decode(body[5]);rows=v.normalized(bi)[0]
        hits=[i for i,r in enumerate(rows) if r[0]==0x4f and r[1]==[(7,(22,''),'load'),1]]
        assert len(hits)==1
        # Preserve the original call's stack [loader, request]; two temporary locals
        # let the replacement call our helper with the same objects and callbacks.
        at=hits[0];temp=body[2];body[2]+=2
        block=s.m.asm.assemble([('setlocal',temp+1),('setlocal',temp),('getlex',q(login,'cn.admission','ClientAdmission')),
            ('getlocal',temp),('getlocal',temp+1)])
        body[5],body[6],_,placed=s.m.asm.splice_many(body,[(at,block,s.m.asm.ENTER)])
        code=s.m.asm.decode(body[5]);call=code[at+len(block)];call.args=[q(login,'','load'),2]
        body[5]=s.m.asm.encode(code)[0];body[1]=max(body[1],4)
        changes.append({'abc':abcs.index(login),'body':bi,'kind':'loader wrapper'})
        v=view(login);cancel=v.by_label['cn.account::PlayerLogin$/cn.account:PlayerLogin::cancelNetwork|1'][0]
        loader_q=next(i for i in range(1,len(login[3].multinames)) if v.mn(i)==(7,(5,'cn.account:PlayerLogin'),'loader'))
        insert(login,cancel,2,[('getlex',q(login,'cn.admission','ClientAdmission')),('getlex',loader_q),('callpropvoid',q(login,'','cancelLoad'),1)])
    v=view(main);a=main[3];pool=s.PoolEditor(a)
    if origin!=identity['endpoint']:
        body=a.bodies[92013];code=s.m.asm.decode(body[5]);assert code[11].op==0x2c
        assert a.s(code[11].args[0])==identity['endpoint'].split('://',1)[1]
        code[11].args[0]=pool.string(origin.split('://',1)[1]);body[5]=s.m.asm.encode(code)[0]
        changes.append({'abc':abcs.index(main),'body':92013,'kind':'endpoint'})
    if args.isolate_storage:
        a.bodies[91935][5]=s.m.asm.encode(s.m.asm.assemble([('pushstring',pool.string('client_admission_trial_v1')),('returnvalue',)]))[0]
        changes.append({'abc':abcs.index(main),'body':91935,'kind':'isolated test preferences'})
    changed={(r['abc'],r['body']) for r in changes}
    body_checks=[]
    for ti,bi in sorted(changed):
        check=s.m.check_body(abcs[ti][3].bodies[bi],abcs[ti][3])
        body=abcs[ti][3].bodies[bi]
        assert check['max_stack']<=body[1] and check['max_scope']<=body[4],(ti,bi,check)
        body_checks.append({'abc':ti,'body':bi,**check})
    for ti,t in enumerate(abcs):
        old=originals[id(t)]
        for i,body in enumerate(t[3].bodies):
            if (ti,i) not in changed:assert s.m.freeze(body)==s.m.freeze(old.bodies[i]),(ti,i)
        for field in ('methods','metadata','instances','classes','scripts'):
            assert s.m.freeze(getattr(old,field))==s.m.freeze(getattr(t[3],field)),field
        if any(x[0]==ti for x in changed):
            payload=t[2]+s.serialize(t[3],t[4]);t[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    extra=b'';extra_count=0
    if not args.legacy:
        with zipfile.ZipFile(work/'admission.swc') as library:(work/'helper.swf').write_bytes(library.read('library.swf'))
        helper_tags=[t for t in s.parts(work/'helper.swf')[2] if t[0]==82]
        helper_classes=[t[3].mn_name(i[0]) for t in helper_tags for i in t[3].instances]
        assert set(helper_classes)=={'cn.admission::ClientAdmission','cn.admission::AdmissionSession','cn.admission::BuildConfig','cn.loading::PartyDerivedCache'},helper_classes
        extra=b''.join(t[1] for t in helper_tags);extra_count=len(helper_tags)
    raw=header+b''.join((extra if t is abcs[0] else b'')+t[1] for t in tags if not any(t is r for r in removed))
    swf=work/'client-admission.swf';swf.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    after=[t for t in s.parts(swf)[2] if t[0]==82]
    retained=[t for t in abcs if not any(t is r for r in removed)]
    for i,t in enumerate(retained):assert s.m.freeze(after[i+extra_count][3].bodies)==s.m.freeze(t[3].bodies)
    uid=str(uuid.uuid4());old_uid=identity['envelope_uuid']
    b.run([b.JAVA,'-jar',b.ALIB/'baksmali.jar','d','-o',work/'smali',work/'original.dex'],work,'decode-dex')
    nativeOriginal={p.relative_to(work/'smali'):p.read_text('utf8') for p in (work/'smali').rglob('*.smali')};hits={}
    for name,text in nativeOriginal.items():
        if old_uid in text:
            assert name.as_posix() in ('cn/startpoint/StartupCache.smali','cn/startpoint/BuildIdentity.smali')
            hits[str(name)]=text.count(old_uid);(work/'smali'/name).write_text(text.replace(old_uid,uid),'utf8')
    assert sum(hits.values())==2
    b.run([b.JAVA,'-jar',b.ALIB/'smali.jar','a','-a','21','-o',work/'classes.dex',work/'smali'],work,'encode-dex')
    b.run([b.JAVA,'-jar',b.ALIB/'baksmali.jar','d','-o',work/'native-readback',work/'classes.dex'],work,'readback-dex')
    for name,text in nativeOriginal.items():assert native.canonical((work/'native-readback'/name).read_text('utf8').replace(uid,old_uid))==native.canonical(text)
    signatures={'META-INF/MANIFEST.MF','META-INF/WF.SF','META-INF/WF.RSA'}
    payloads={'assets/worldflipper_android_release.swf':swf.read_bytes(),'classes.dex':(work/'classes.dex').read_bytes()}
    with zipfile.ZipFile(identity['envelope_apk']) as z,zipfile.ZipFile(work/'unsigned.apk','w') as dest:
        manifest=z.read('AndroidManifest.xml');assert manifest.count(old_uid.encode('utf-16le'))==1
        payloads['AndroidManifest.xml']=manifest.replace(old_uid.encode('utf-16le'),uid.encode('utf-16le'))
        for item in z.infolist():
            if item.filename not in signatures:dest.writestr(item,payloads.get(item.filename,z.read(item.filename)))
    align=Path('F:/StartPointCN/wf_full_patch/build-tools/zipalign.exe')
    b.run([align,'-p','4',work/'unsigned.apk',work/'aligned.apk'],work,'align')
    apk=out/args.name;assert not apk.exists()
    b.run(['powershell','-NoProfile','-NonInteractive','-File',HERE.parent/'lens0907-0908/sign_apk.ps1',
        '-InputApk',work/'aligned.apk','-OutputApk',apk,'-ApkSigner',b.ALIB/'apksigner.jar','-Java',b.JAVA],work,'sign')
    sig=b.run([b.JAVA,'-jar',b.ALIB/'apksigner.jar','verify','--verbose','--print-certs',apk],work,'verify-signature')
    assert b.CERT in sig.lower() and all('Verified using '+x+': true' in sig for x in ['v1 scheme (JAR signing)','v2 scheme (APK Signature Scheme v2)'])
    b.run([align,'-c','-p','4',apk],work,'verify-align')
    with zipfile.ZipFile(identity['envelope_apk']) as original,zipfile.ZipFile(apk) as check:
        assert len(check.namelist())==len(set(check.namelist()))
        assert set(check.namelist())-signatures==set(original.namelist())-signatures
        for name in set(check.namelist())-signatures:assert check.read(name)==payloads.get(name,original.read(name)),name
        assert check.read('AndroidManifest.xml').count(uid.encode('utf-16le'))==1
        assert old_uid.encode('utf-16le') not in check.read('AndroidManifest.xml')
    report={'apk':str(apk),'sha256':b.sha(apk.read_bytes()),'swf_sha256':b.sha(swf.read_bytes()),'baseline':identity,
        'changes':changes,'body_checks':body_checks,'original_bodies_verified':identity['method_bodies_checked'],'all_other_methods_preserved':True,
        'build_id':None if args.legacy else args.build_id,'uniqueappversionid':uid,'signer_sha256':b.CERT,'zipalign':True,'v1_v2':True,
        'origin':origin,'isolated_preferences':args.isolate_storage,'registry_promoted':False,'diagnostics_removed':True,'r10_cache_cleanup_independent':True,'performance_methods_preserved':[15140,20565,92540],'save_schema_change':False}
    (out/(apk.stem+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({k:report[k] for k in ['apk','sha256','build_id','original_bodies_verified']}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--work',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--name',required=True);p.add_argument('--variant',choices=['lan','public'],default='lan');p.add_argument('--origin')
    p.add_argument('--keys',type=Path,required=True);p.add_argument('--build-id',required=True)
    p.set_defaults(legacy=False);p.add_argument('--isolate-storage',action='store_true');main(p.parse_args())
