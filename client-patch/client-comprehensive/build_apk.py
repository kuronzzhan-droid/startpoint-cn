"""Package an audited comprehensive LAN candidate; never install or promote registry state."""
import argparse,importlib.util,json,os,subprocess,uuid,zipfile
from pathlib import Path
from types import SimpleNamespace
from verify_swf import verify
FINAL_SWF_SHA256='3f37dee12692b53cd6f9db0a21ec826366d56b8338cdfa66216fc7dbc2efde37'
HELPERS={'cn/optimize/network/RequestTimer','cn/optimize/network/NetworkBudget',
         'cn.optimize.data.DataOptimization','cn.optimize.resources.ResourceRuntime',
         'cn.optimize.ui.UiOptimization'}
HERE=Path(__file__).resolve().parent;PATCH_ROOT=HERE.parent
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
b=module('party_packaging',PATCH_ROOT/'party-animation-liveness/build_apk.py')
n=module('native_packaging',PATCH_ROOT/'startup-cache/build_periodic_apk.py')
quiet=module('comprehensive_quiet_process',PATCH_ROOT/'quiet_process.py')

def quiet_run(command,work,label,timeout=600):
    result=quiet.run([str(x) for x in command],cwd=work,stdout=subprocess.PIPE,
                     stderr=subprocess.STDOUT,timeout=timeout,check=False)
    output=result.stdout.decode('utf-8','replace')
    (work/(label+'.log')).write_text(output,encoding='utf-8')
    if result.returncode:raise RuntimeError(f'{label} failed ({result.returncode}): {output[-3000:]}')
    return output

def build(args):
    registry=json.loads(args.registry.read_text('utf-8'))['lineage']['previous_android_variants']['lan']
    assert registry['apk_sha256']==b.BASE_APK_SHA256 and registry['swf_sha256']==b.BASE_SWF_SHA256,'registry changed'
    baseline=Path(args.input_apk or registry['apk']);baseline=baseline if baseline.is_absolute() else PATCH_ROOT.parent/baseline
    assert b.sha(baseline.read_bytes())==b.BASE_APK_SHA256
    assert b.sha(args.swf.read_bytes())==FINAL_SWF_SHA256,'R4 SWF identity mismatch'
    assert not args.output.exists() and not args.work.exists()
    args.work.mkdir(parents=True);args.output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(baseline) as source:
        assert len(source.namelist())==len(set(source.namelist()))
        swf=source.read(b.SWF_MEMBER);manifest=source.read('AndroidManifest.xml');dex=source.read('classes.dex')
    assert b.sha(swf)==b.BASE_SWF_SHA256 and b.sha(dex)==registry['dex_sha256']
    old=registry['uniqueappversionid'];fresh=str(uuid.uuid4());assert manifest.count(old.encode('utf-16le'))==1
    (args.work/'baseline.swf').write_bytes(swf)
    comparison=verify(args.work/'baseline.swf',args.swf,args.expected,args.work/'swf-verify',args.java,args.ffdec)
    assert len(comparison['changed_methods'])==47 and set(comparison['helpers'])==HELPERS
    assert comparison['new_helper_bodies']==102
    (args.work/'baseline.dex').write_bytes(dex)
    run=lambda command,label:quiet_run(command,args.work,label,timeout=240)
    source_smali=args.work/'smali';readback=args.work/'readback'
    run([args.java,'-jar',args.baksmali,'d','-o',source_smali,args.work/'baseline.dex'],'dex-decode')
    before=b.read_smali(source_smali)
    assert {name for name,text in before.items() if old in text}==b.IDENTITY_CLASSES
    assert all(before[name].count(old)==1 for name in b.IDENTITY_CLASSES)
    assert set(n.TARGET_CLASSES)<=set(before)
    for name in ('s/h/e/l/l/A.smali','s/h/e/l/l/S.smali'):
        assert before[name].count('Lcn/startpoint/StartupCache;->run')==1
    n.SOURCE=HERE/'native/cn/startpoint/StartupCache.java'
    n.run=quiet_run
    native_work=args.work/'native';native_work.mkdir()
    native=n.compile_helper(SimpleNamespace(java=args.java,javac=None,d8_jar=args.d8),native_work,fresh)
    helper_smali=args.work/'helper-smali'
    run([args.java,'-jar',args.baksmali,'d','-o',helper_smali,native],'native-decode')
    helpers=b.read_smali(helper_smali);assert set(helpers)==n.TARGET_CLASSES
    for name,text in helpers.items():(source_smali/name).write_text(text,encoding='utf-8')
    final_dex=args.work/'classes.dex'
    run([args.java,'-jar',args.smali,'a','-a','21','-o',final_dex,source_smali],'dex-assemble')
    run([args.java,'-jar',args.baksmali,'d','-o',readback,final_dex],'dex-readback')
    after=b.read_smali(readback);assert before.keys()==after.keys()
    for name,text in before.items():
        if name not in n.TARGET_CLASSES:assert text==after[name],name
    for name,text in helpers.items():assert after[name]==text,name
    assert {name for name,text in after.items() if fresh in text}==b.IDENTITY_CLASSES
    assert all(after[name].count(fresh)==1 for name in b.IDENTITY_CLASSES)
    assert old.encode() not in final_dex.read_bytes()
    assert 'deferred-until-next-launch' in after['cn/startpoint/StartupCache.smali']
    payload={b.SWF_MEMBER:args.swf.read_bytes(),'classes.dex':final_dex.read_bytes(),
      'AndroidManifest.xml':manifest.replace(old.encode('utf-16le'),fresh.encode('utf-16le'))}
    unsigned=args.work/'unsigned.apk';aligned=args.work/'aligned.apk'
    with zipfile.ZipFile(baseline) as source,zipfile.ZipFile(unsigned,'w') as target:
        for info in source.infolist():
            if info.filename not in b.SIGNATURE_MEMBERS:
                target.writestr(info,payload[info.filename] if info.filename in payload else source.read(info.filename))
    run([args.zipalign,'-p','4',unsigned,aligned],'align')
    run(['powershell','-NoProfile','-NonInteractive','-File',args.sign_script,'-InputApk',aligned,
      '-OutputApk',args.output,'-ApkSigner',args.apksigner,'-Java',args.java],'sign')
    signature=run([args.java,'-jar',args.apksigner,'verify','--verbose','--print-certs',args.output],'signature')
    assert b.CERT in signature.lower()
    assert all('Verified using '+scheme+': true' in signature for scheme in ('v1 scheme (JAR signing)','v2 scheme (APK Signature Scheme v2)'))
    run([args.zipalign,'-c','-p','4',args.output],'alignment-readback')
    preserved=0
    with zipfile.ZipFile(baseline) as source,zipfile.ZipFile(args.output) as target:
        assert target.testzip() is None and len(target.namelist())==len(set(target.namelist()))
        assert set(source.namelist())-b.SIGNATURE_MEMBERS==set(target.namelist())-b.SIGNATURE_MEMBERS
        for name in source.namelist():
            if name in b.SIGNATURE_MEMBERS:continue
            expected=payload[name] if name in payload else source.read(name)
            assert target.read(name)==expected,name
            if name not in payload:preserved+=1
        assert target.read('AndroidManifest.xml').count(fresh.encode('utf-16le'))==1
    report={'status':'offline_candidate','variant':'lan','apk':str(args.output),'apk_sha256':b.sha(args.output.read_bytes()),
      'input_apk_sha256':b.BASE_APK_SHA256,'swf_sha256':comparison['swf_sha256'],
      'original_method_bodies_compared':96706,'changed_methods':comparison['changed_methods'],
      'new_helper_abcs':comparison['helpers'],'new_helper_bodies':comparison['new_helper_bodies'],
      'uniqueappversionid':fresh,'previous_uniqueappversionid':old,'signer_certificate_sha256':b.CERT,
      'preserved_apk_members':preserved,'native_changed_classes':sorted(n.TARGET_CLASSES),
      'native_cache_policy':'defer periodic cache deletion until next cold startup; installation identity cleanup retained',
      'original_swf_layout_preserved':True,'package_and_version_preserved':True,'v1_signature':True,'v2_signature':True,'zipalign':True,
      'server_changed':False,'resource_payload_changed':False,'admission_pair_changed':False,'registry_promoted':False,'device_tested':False}
    args.output.with_suffix('.verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    args.output.with_suffix('.sha256.txt').write_text(report['apk_sha256']+'  '+args.output.name+'\n');return report
if __name__=='__main__':
    sdk=Path(os.environ.get('STARPOINT_AIR_SDK','AIRSDK_51.2.1.5'))
    ap=argparse.ArgumentParser();ap.add_argument('--swf',type=Path,required=True);ap.add_argument('--expected',type=Path,required=True)
    ap.add_argument('--work',type=Path,required=True);ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--registry',type=Path,default=PATCH_ROOT/'android-accepted.json')
    ap.add_argument('--input-apk',type=Path,help='audited pre-R4 LAN APK')
    ap.add_argument('--java',type=Path,default=Path(os.environ.get('STARPOINT_JAVA','java')))
    ap.add_argument('--ffdec',type=Path,default=Path(os.environ.get('STARPOINT_FFDEC_JAR','ffdec.jar')))
    ap.add_argument('--d8',type=Path,default=sdk/'lib/android/bin/d8.jar')
    for key in ('baksmali','smali','apksigner'):ap.add_argument('--'+key,type=Path,default=sdk/('lib/android/lib/'+key+'.jar'))
    ap.add_argument('--zipalign',type=Path,default=Path(os.environ.get('STARPOINT_ZIPALIGN','zipalign')))
    ap.add_argument('--sign-script',type=Path,default=PATCH_ROOT/'lens0907-0908/sign_apk.ps1')
    print(json.dumps(build(ap.parse_args()),ensure_ascii=False,indent=2))
