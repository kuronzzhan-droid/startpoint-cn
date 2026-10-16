"""Package a one-method fix over the verified cumulative Lens candidate APK."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import sys
import uuid
import zipfile

import package_apk as original
from apk_build_common import replace_apk, sha256, verify, SWF_MEMBER

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--variant',choices=['lan','public'],required=True)
    ap.add_argument('--base-report',type=Path,required=True);ap.add_argument('--swf',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True);ap.add_argument('--ffdec',type=Path,required=True)
    ap.add_argument('--build-tools',type=Path,required=True);args=ap.parse_args()
    base_report=json.loads(args.base_report.read_text('utf8'));base=Path(base_report['apk'])
    assert base_report['variant']==args.variant and sha256(base)==base_report['apk_sha256']
    swf_report=json.loads(args.swf.with_suffix('.report.json').read_text('utf8'))
    assert swf_report['input_sha256']==base_report['swf_sha256']
    assert swf_report['swf_sha256']==sha256(args.swf) and swf_report['changed_body']=='284:19690'
    with zipfile.ZipFile(base) as z:
        assert hashlib.sha256(z.read(SWF_MEMBER)).hexdigest()==base_report['swf_sha256']
    args.out.mkdir(parents=True,exist_ok=False);java_out=args.out/'java';java_out.mkdir()
    original.run(['javac','-cp',args.ffdec,'-d',java_out,HERE/'CompareExactBodies.java'],args.out/'javac.log')
    original.run(['java','-cp',f'{java_out};{args.ffdec}','CompareExactBodies',swf_report['input'],args.swf,'284:19690'],args.out/'body-check.log')
    assert 'PASS bodies=96404 changed=[284:19690]' in (args.out/'body-check.log').read_text()
    cls='pinball.common.data.item.OwnedEquipmentLogic'
    original.run(['java','-Xmx2g','-jar',args.ffdec,'-selectclass',cls,'-export','script',args.out/'readback',args.swf],args.out/'decompile.log')
    exported=args.out/'readback/scripts/pinball/common/data/item/OwnedEquipmentLogic.as'
    text=exported.read_text('utf8');start=text.index('public function getUseableAwakingCrystal(')
    end=text.index('public function getUpgradableStatus(',start);method=text[start:end]
    guard=re.search(r'if\((?:this\.)?id == 5900101\)\s*\{\s*return Option\.None;\s*\}',method)
    assert guard and guard.start()<method.index('if(hasStack())')
    assert 'return Option.None;' in method and 'getEquipmentAwakingCrystal(get_rarity())' in method
    new_uuid=str(uuid.uuid4());assert new_uuid!=base_report['uniqueappversionid']
    unsigned=args.out/'unsigned.apk';aligned=args.out/'aligned.apk'
    final=args.out/f'StarPoint-CN-1.8.1-lens0907-0908-{args.variant}-v3-20260908.apk'
    replace_apk(base,args.swf,unsigned,new_uuid,base_uuid=base_report['uniqueappversionid'])
    align=args.build_tools/'zipalign.exe';signer=args.build_tools/'lib/apksigner.jar'
    original.run([align,'-p','4',unsigned,aligned],args.out/'zipalign-build.log');unsigned.unlink()
    original.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',HERE/'sign_apk.ps1',
                  '-InputApk',aligned,'-OutputApk',final,'-ApkSigner',signer],args.out/'signing.log')
    result=verify(base,final,args.swf,new_uuid,Path('java'),signer,base_uuid=base_report['uniqueappversionid'])
    original.run([align,'-c','-p','4',final],args.out/'zipalign-check.log');aligned.unlink()
    result.update(variant=args.variant,apk=str(final.resolve()),input_apk=str(base),
                  input_apk_sha256=base_report['apk_sha256'],input_swf_sha256=base_report['swf_sha256'],
                  changed_body='284:19690',independent_ffdec_body_check=True,independent_decompile_check=True,
                  inherited_lens_changes_preserved=True,unrelated_apk_members_unchanged=True,
                  v1_signature=True,v2_signature=True,zip_alignment=True,device_tested=False,
                  accepted_registry_updated=False,required_resource_version='1.4.103')
    (args.out/'verification-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
    (args.out/(final.name+'.sha256')).write_text(result['apk_sha256']+'  '+final.name+'\n','utf8')
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':main()
