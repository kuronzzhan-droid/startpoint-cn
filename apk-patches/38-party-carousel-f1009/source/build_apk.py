"""Build cumulative LAN/public candidates; only two game methods are patched."""
import argparse,importlib.util,json,uuid,zipfile
from pathlib import Path
from patch_swf import patch

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
base=module('startup_build',HERE.parent/'startup-cache/build.py')
native=module('startup_verify',HERE.parent/'startup-cache/verify_native.py')
checker=module('accepted_check',HERE.parent/'verify_android_baseline.py')
VARIANTS={
 'lan':('68cfbb9044d172acc20bd86dd86c6f9ac44b2a9c845d294147474d5c1e3e4900','29c026c2-e683-460c-b6f5-0f705ba75a6c'),
 'public':('32006941eff3a0294e9895aafba4668c8a4691bce1459740cb46afc258492f56','3649f84f-5690-4601-81cb-e5d6d09ee275')}

def main(args):
    w=args.work.resolve();out=args.out.resolve();variant=args.variant
    assert not w.exists() and not out.exists() and '.cdn' not in w.parts and '.cdn' not in out.parts
    checker.verify(variant, record_path=HERE.parent/'accepted-history/android-lens0910-20260910.json')
    parent=ROOT/f'outputs/client-cache-rounded-{variant}-20260912/StarPoint-CN-1.8.1-cache-rounded-{variant}-20260912.apk'
    digest,old_uid=VARIANTS[variant];assert base.sha(parent.read_bytes())==digest
    w.mkdir(parents=True);out.mkdir(parents=True);uid=str(uuid.uuid4())
    with zipfile.ZipFile(parent) as z:
        (w/'input.swf').write_bytes(z.read('assets/worldflipper_android_release.swf'))
        (w/'original.dex').write_bytes(z.read('classes.dex'))
    swf=w/'party-fixed.swf';swf_report=patch(w/'input.swf',swf)
    java,libs,run=base.JAVA,base.ALIB,base.run
    ffdec=Path('F:/codex/tools/ffdec_26.2.1/ffdec.jar');classes=w/'java';classes.mkdir()
    run([java.with_name('javac.exe'),'-cp',ffdec,'-d',classes,HERE.parent/'character-carousel/CompareMethodBodies.java'],w,'compile-verifier')
    checks=run([java,'-Xmx2g','-cp',str(classes)+';'+str(ffdec),'CompareMethodBodies',w/'input.swf',swf],w,'method-verify')
    assert 'method_bodies=96520' in checks and 'changed_count=2' in checks and 'changed=288:66013,288:66523' in checks
    print('Two method changes independently verified',flush=True)
    run([java,'-jar',libs/'baksmali.jar','d','-o',w/'smali',w/'original.dex'],w,'dex-decode')
    original={p.relative_to(w/'smali'):p.read_text() for p in (w/'smali').rglob('*.smali')}
    hits=0
    for name,text in original.items():
        count=text.count(old_uid)
        if count:
            assert name.as_posix() in ('cn/startpoint/StartupCache.smali','cn/startpoint/BuildIdentity.smali')
            (w/'smali'/name).write_text(text.replace(old_uid,uid));hits+=count
    assert hits==2
    run([java,'-jar',libs/'smali.jar','a','-a','21','-o',w/'classes.dex',w/'smali'],w,'dex-assemble')
    run([java,'-jar',libs/'baksmali.jar','d','-o',w/'readback',w/'classes.dex'],w,'dex-readback')
    assert len(list((w/'readback').rglob('*.smali')))==len(original)==6
    for name,text in original.items():
        assert native.canonical((w/'readback'/name).read_text().replace(uid,old_uid))==native.canonical(text),name
    excluded={'META-INF/MANIFEST.MF','META-INF/WF.SF','META-INF/WF.RSA'}
    payloads={'assets/worldflipper_android_release.swf':swf.read_bytes(),'classes.dex':(w/'classes.dex').read_bytes()}
    with zipfile.ZipFile(parent) as source,zipfile.ZipFile(w/'unsigned.apk','w') as dest:
        manifest=source.read('AndroidManifest.xml');assert manifest.count(old_uid.encode('utf-16le'))==1
        payloads['AndroidManifest.xml']=manifest.replace(old_uid.encode('utf-16le'),uid.encode('utf-16le'))
        for item in source.infolist():
            if item.filename not in excluded:dest.writestr(item,payloads.get(item.filename,source.read(item.filename)))
    align=Path('F:/StartPointCN/wf_full_patch/build-tools/zipalign.exe')
    run([align,'-p','4',w/'unsigned.apk',w/'aligned.apk'],w,'align')
    apk=out/f'StarPoint-CN-1.8.1-party-f1009-{variant}-20260912.apk'
    run(['powershell','-NoProfile','-NonInteractive','-File',HERE.parent/'lens0907-0908/sign_apk.ps1',
         '-InputApk',w/'aligned.apk','-OutputApk',apk,'-ApkSigner',libs/'apksigner.jar','-Java',java],w,'sign')
    signature=run([java,'-jar',libs/'apksigner.jar','verify','--verbose','--print-certs',apk],w,'verify-signature')
    assert base.CERT in signature.lower()
    assert all('Verified using '+s+': true' in signature for s in ('v1 scheme (JAR signing)','v2 scheme (APK Signature Scheme v2)'))
    run([align,'-c','-p','4',apk],w,'verify-alignment')
    with zipfile.ZipFile(parent) as source,zipfile.ZipFile(apk) as dest:
        assert set(source.namelist())-excluded==set(dest.namelist())-excluded
        for name in set(source.namelist())-excluded:assert dest.read(name)==payloads.get(name,source.read(name)),name
        manifest=dest.read('AndroidManifest.xml')
        assert manifest.count(uid.encode('utf-16le'))==1 and old_uid.encode('utf-16le') not in manifest
    report={'variant':variant,'apk':str(apk),'apk_sha256':base.sha(apk.read_bytes()),'parent_apk_sha256':digest,
        'uniqueappversionid':uid,'native_build_identity':uid,'swf':swf_report,'signer_sha256':base.CERT,
        'zipalign':True,'v1_v2_signatures':True,'native_behavior_unchanged':True,'all_other_apk_members_unchanged':True,
        'previous_three_features_preserved':True,'device_tested_at_build':False,'server_changed':False,'registry_promoted':False}
    (out/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'SHA256.txt').write_text(report['apk_sha256']+'  '+apk.name+'\n',encoding='ascii')
    for name in ('unsigned.apk','aligned.apk'):
        p=(w/name).resolve();assert p.parent==w;p.unlink()
    print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--variant',choices=VARIANTS,required=True)
    p.add_argument('--work',type=Path,required=True);p.add_argument('--out',type=Path,required=True);main(p.parse_args())
