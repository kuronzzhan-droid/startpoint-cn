"""Append the approved wide title PNG to the isolated local .106 test chain.

The historical title artwork, published archives, source held manifest and
gameplay data remain unchanged. --apply backs up and syncs exactly three paths.
"""
from __future__ import annotations
import argparse
import copy
from datetime import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import zipfile
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
RUNTIME=Path(r'F:\startpoint-cn-main')
PREVIOUS=ROOT/'assets/asset-patch/audit/abyss-standard-links-1.4.106-test'
OLD_SERVER=Path(r'F:\codex\work\abyss-floor12-reboot-repair-20260910\candidate-server')
PRISTINE=Path(r'F:\codex\work\abyss-element-local-test-20260910\pristine-read-links\cn')
PATCH_ID='sponsor-title-wide-1.4.107-test'
AUDIT=ROOT/'assets/asset-patch/audit'/PATCH_ID
NAME='pinball-1.4.106-1.4.107-1-sponsor-title-wide-test.zip'
LOGICAL='dynamic/degree/degree_mod_special_thanks.png'
MEMBER='production/upload/03/076857d74f07bb194f6185d4f1c1d6061850ce'
ART=ROOT/'assets/asset-patch/artwork/sponsor-special-thanks/degree_mod_special_thanks_wide.png'
OLD_ART=ART.with_name('degree_mod_special_thanks.png')
BEFORE_SHA='b44cafb1c8f2a7d4528e129489d68b9c9d986093fd537e551f302ff1ef66d7b1'
MANIFEST_SHA='3e4a05d6b9fb8ec7e22e323fd107a462148a077dd2375467c298e433a0cc4673'


def sha(raw):return hashlib.sha256(raw).hexdigest()
def readj(path):return json.loads(path.read_text('utf8'))
def save(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    assert path.read_bytes()==raw
def jsonbytes(value):return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
def savej(path,value):save(path,jsonbytes(value))


def main(work,apply):
    work=work.resolve();cdn=(ROOT/'.cdn').resolve()
    assert not work.is_relative_to(cdn)
    held=(ROOT/'assets/asset-patch/manifest.json').read_bytes()
    before_manifest=(PREVIOUS/'manifest.json').read_bytes()
    assert sha(before_manifest)==MANIFEST_SHA
    assert (RUNTIME/'assets/asset-patch/manifest.json').read_bytes()==before_manifest
    assert (OLD_SERVER/'assets/asset-patch/manifest.json').read_bytes()==before_manifest
    assert sha(OLD_ART.read_bytes())=='c2c4d06e1b386abfcf11a15a23ac2c72a01617fbed02c4a1d4cfca88ed0354ff'
    manifest=json.loads(before_manifest);assert manifest['cdn_version']=='1.4.106'
    old_archives={}
    for entry in manifest['patches']:
        if entry.get('local_test_only'):
            for record in entry['archive_integrity']:
                old_archives[record['name']]=record['sha256']
                assert sha((RUNTIME/'assets/asset-patch/active'/record['name']).read_bytes())==record['sha256']
    os.environ.update(WF_SERVER_DIR=str(OLD_SERVER),WF_CDN_DIR=str(PRISTINE),WF_LIVE_CDN='1')
    import wf_live_cdn as live
    import wf_assets
    import publish_sponsor_special_thanks as sponsor
    before=live.read_logical(LOGICAL).data
    assert sha(before)==BEFORE_SHA and (RUNTIME/'assets/asset-patch'/MEMBER).read_bytes()==before
    assert wf_assets.png_decode_stored(before)==OLD_ART.read_bytes()
    formal=ART.read_bytes()
    facts=readj(work/'artwork-receipt.json')
    assert facts['sha256']==sha(formal)
    assert formal[:8]==wf_assets.PNG_REAL and formal[24:26]==bytes([8,6])
    with Image.open(io.BytesIO(formal)) as im:
        im.load();assert im.size==(320,50) and im.mode=='RGBA'
        alpha=im.getchannel('A');assert alpha.getextrema()==(0,255)
        bbox=alpha.getbbox();assert 310<=bbox[2]-bbox[0]<=316 and bbox[3]-bbox[1]<=50
        assert bbox==tuple(facts['visible_bbox'])
    stored=wf_assets.png_encode(formal)
    sponsor.verify_stored_png(stored,formal)
    degree_logical='master/degree/degree.orderedmap'
    degree=live.read_logical(degree_logical).data
    definition=(ROOT/'assets/degree_sponsor.json').read_bytes()
    assert (RUNTIME/'assets/degree_sponsor.json').read_bytes()==definition
    assert sponsor.p.csvrows(sponsor.p.rawmap(degree)['9900012'])==[sponsor.client_fields()]
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        info=zipfile.ZipInfo(MEMBER,(2026,9,10,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        z.writestr(info,stored)
    archive=buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        assert z.testzip() is None and z.namelist()==[MEMBER]
        sponsor.verify_stored_png(z.read(MEMBER),formal)
    dest=ROOT/'assets/asset-patch/inactive/candidates'/NAME
    assert not dest.exists() or dest.read_bytes()==archive
    save(dest,archive)
    integrity=dict(name=NAME,size=len(archive),sha256=sha(archive),members=1,files=[MEMBER])
    entry=dict(id=PATCH_ID,type='patch',name='特别鸣谢称号宽版美术（本地测试）',
        description='称号9900012采用已确认的宽版中国结构图，保持320×50透明画布，仅替换图片。',
        version='1.4.107',depends_on='1.4.106',enabled=True,archive=NAME,archive_size=len(archive),
        chain=[NAME],archive_integrity=[integrity],files=[MEMBER],created_at='2026-09-10',
        local_test_only=True,audit=dict(directory=AUDIT.relative_to(ROOT).as_posix(),report='report.json'))
    manifest['cdn_version']='1.4.107';manifest['patches'].append(entry)
    server=work/'candidate-server'
    for src in (OLD_SERVER/'assets/asset-patch/active').glob('*.zip'):
        target=server/'assets/asset-patch/active'/src.name
        target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():os.link(src,target)
        assert sha(target.read_bytes())==sha(src.read_bytes())
    target=server/'assets/asset-patch/active'/NAME
    if not target.exists():os.link(dest,target)
    assert target.read_bytes()==archive
    save(server/'assets/asset-patch'/MEMBER,stored)
    savej(server/'assets/asset-patch/manifest.json',manifest)
    for name in ('rush_event_quest.json','rush_event_quest_folder.json'):
        save(server/'server/assets'/name,(OLD_SERVER/'server/assets'/name).read_bytes())
    os.environ.update(WF_SERVER_DIR=str(server));live.clear_cache()
    view=live.describe()
    assert view['tail']=='1.4.107' and set(view['platform_tails'].values())=={'1.4.107'}
    inventory=copy.deepcopy(readj(PREVIOUS/'resource-inventory.json'))
    assert sum(x['logical']==LOGICAL for x in inventory)==1
    for item in inventory:
        if item['logical']==LOGICAL:item.update(sha256=sha(stored),size=len(stored))
        assert sha(live.read_logical(item['logical']).data)==item['sha256'],item['logical']
    assert live.read_logical(degree_logical).data==degree
    sponsor.verify_stored_png(live.read_logical(LOGICAL).data,formal)
    assert (ROOT/'assets/asset-patch/manifest.json').read_bytes()==held
    assert (ROOT/'assets/degree_sponsor.json').read_bytes()==definition
    report=dict(status='built_verified',base='1.4.106',version='1.4.107',degree_id=9900012,
        archive=integrity,artwork=facts,artwork_path=str(ART),image_logical=LOGICAL,
        old_formal_sha256=sha(OLD_ART.read_bytes()),before_stored_sha256=sha(before),stored_sha256=sha(stored),
        source_manifest_preserved=True,old_artwork_preserved=True,published_archives_preserved=old_archives,
        degree_table_sha256=sha(degree),server_definition_sha256=sha(definition),
        title_master_and_grant_mechanism_unchanged=True,all_other_inventory_unchanged=True,
        effective_inventory_checked=len(inventory),shared_platforms=['Android','iOS'],
        strict_png_storage_roundtrip=True,apk_changed=False,ipa_changed=False,gameplay_or_device_ui_verified=False,
        committed=False,pushed=False,cloud_deployed=False,cloud_overlay_created=False)
    savej(AUDIT/'manifest.json',manifest);savej(AUDIT/'manifest-entry.json',entry)
    savej(AUDIT/'resource-inventory.json',inventory);savej(AUDIT/'report.json',report)
    savej(AUDIT/'artwork-receipt.json',facts)
    payloads={'assets/asset-patch/active/'+NAME:archive,'assets/asset-patch/'+MEMBER:stored,
              'assets/asset-patch/manifest.json':jsonbytes(manifest)}
    preimages={rel:(RUNTIME/rel).read_bytes() if (RUNTIME/rel).exists() else None for rel in payloads}
    assert list(preimages.values())==[None,before,before_manifest]
    for rel in payloads:
        target=(RUNTIME/rel).resolve()
        assert target.is_relative_to(RUNTIME.resolve()) and not target.is_relative_to(cdn)
    plan=dict(status='preflight_passed',target=str(RUNTIME),mode='authorized_uncommitted_local_test_increment',
        files=[dict(path=rel,size=len(raw),sha256=sha(raw),
            before_sha256=sha(preimages[rel]) if preimages[rel] is not None else None) for rel,raw in payloads.items()])
    savej(AUDIT/'local-sync-plan.json',plan)
    if apply:
        backup=RUNTIME/'.codex-backups'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-sponsor-title-wide')
        assert not backup.exists() and backup.resolve().is_relative_to(RUNTIME.resolve())
        for rel,raw in preimages.items():
            if raw is not None:save(backup/rel,raw)
        savej(backup/'sync-plan.json',plan)
        written=[]
        try:
            for rel,raw in payloads.items():
                target=RUNTIME/rel
                assert (target.read_bytes() if target.exists() else None)==preimages[rel],('runtime drift',rel)
                temp=target.with_name(target.name+'.sponsor-wide.tmp');assert not temp.exists()
                save(temp,raw);written.append(rel);os.replace(temp,target)
                assert target.read_bytes()==raw
        except BaseException:
            for rel in reversed(written):
                target=(RUNTIME/rel).resolve()
                assert target.is_relative_to(RUNTIME.resolve()) and not target.is_relative_to(cdn)
                if preimages[rel] is None:target.unlink(missing_ok=True)
                else:save(target,preimages[rel])
            raise
        plan.update(status='local_test_increment_synced',backup=str(backup))
        savej(AUDIT/'local-sync-report.json',plan)
    print(json.dumps(dict(status=plan['status'],version='1.4.107',archive_bytes=len(archive),
        archive_sha256=sha(archive),artwork_sha256=sha(formal),visible_bbox=bbox,backup=plan.get('backup')),ensure_ascii=False))


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--work',type=Path,required=True);ap.add_argument('--apply',action='store_true')
    args=ap.parse_args();main(args.work,args.apply)
