"""Replace Five Boss artwork against an explicit, verified local resource chain.

Build reads sparse effective assets; apply uses its exact preimages and replaces
the runtime manifest last. Neither command starts AIR, changes an APK, writes
the pristine CDN, rewrites published ZIPs, commits, or deploys to the cloud.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime
import io
import json
import os
from pathlib import Path
import zipfile

from PIL import Image
import prepare_content as p
import fix_five_boss_icon_closure as closure
import five_boss_art_contract as contract

REPO = p.REPO
RUNTIME = Path('F:/startpoint-cn-main')
ART = REPO/'assets/asset-patch/artwork/five-boss/20260910'
EQUIPMENT = 'master/item/equipment.orderedmap'
ENHANCEMENT = 'master/equipment_enhancement/equipment_enhancement.orderedmap'
SEED = 'assets/cdndata/boss_coin_shop.json'
TICKET = '10000143'
WEAPON = '5900101'
MATERIALS = {'10000145': '新·深界结晶.png', '10000147': '五王心核.png'}
TICKET_ART = '新·深界连战凭证.png'
WEAPON_ART = '死亡使者.png'


def save(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    assert path.read_bytes() == raw


def jsonbytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()


def replace_frames(png, atlas, icons):
    """Replace only existing, untrimmed rectangles; keep all atlas bytes."""
    before = closure.strict_png(png)
    after = before.copy()
    rows = closure.codec.decode_atlas(atlas)
    assert len({r['n'] for r in rows}) == len(rows), 'duplicate frame names'
    selected = [r for r in rows if r['n'] in icons]
    assert {r['n'] for r in selected} == set(icons), 'missing replacement frame'
    for row in selected:
        assert set(row) == {'n', 'x', 'y', 'w', 'h'}, 'review trimmed/rotated frame'
        rect = closure.rect(row)
        assert 0 <= rect[0] < rect[2] <= before.width
        assert 0 <= rect[1] < rect[3] <= before.height
        assert not any(closure.intersects(rect, closure.rect(other)) for other in rows if other is not row), 'shared rectangle'
        image = closure.strict_png(icons[row['n']])
        assert image.size == (row['w'], row['h']), 'replacement size differs'
        after.paste(image, (row['x'], row['y']))
    result = closure.codec.encode_png(after)
    final = closure.strict_png(result)
    restored = final.copy()
    for row in selected:
        rect = closure.rect(row)
        assert final.crop(rect).tobytes() == closure.strict_png(icons[row['n']]).tobytes()
        restored.paste(before.crop(rect), (row['x'], row['y']))
    assert restored.tobytes() == before.tobytes(), 'unrelated atlas pixels changed'
    for row in rows:
        if row['n'] not in icons:
            assert final.crop(closure.rect(row)).tobytes() == before.crop(closure.rect(row)).tobytes()
    return result, dict(size=list(before.size), frames=len(rows), changed_frames=selected,
        atlas_bytes_unchanged=True, all_other_rgba_pixels_unchanged=True)


def weapon_image(source):
    """ItemThumbnailView already scales its native 20px source by six."""
    return contract.thumbnail(source)


def update_seed(raw, thumbnail):
    """Change one source-master cell without reformatting the large JSON."""
    before = json.loads(raw)
    expected = copy.deepcopy(before)
    previous = expected['990099002'][0][12]
    if previous == thumbnail:
        return raw
    expected['990099002'][0][12] = thumbnail
    anchor = raw.index(b'"990099002":')
    quoted = json.dumps(previous).encode()
    start = raw.index(quoted, anchor)
    result = raw[:start] + json.dumps(thumbnail).encode() + raw[start+len(quoted):]
    assert json.loads(result) == expected
    return result


def build(args):
    work = args.work.resolve()
    cdn = (REPO/'.cdn').resolve()
    assert work.is_relative_to(Path('F:/codex/work').resolve()) and not work.is_relative_to(cdn)
    assert not (work/'delivery-plan.json').exists(), 'use a fresh work directory'
    old_server = args.server.resolve()
    previous = args.previous_audit.resolve()
    manifest_bytes = (previous/'manifest.json').read_bytes()
    runtime_manifest_bytes = (RUNTIME/'assets/asset-patch/manifest.json').read_bytes()
    assert json.loads(runtime_manifest_bytes) == json.loads(manifest_bytes), 'runtime chain differs from reviewed audit'
    assert json.loads((old_server/'assets/asset-patch/manifest.json').read_bytes()) == json.loads(manifest_bytes), 'base candidate chain differs'
    manifest = json.loads(manifest_bytes)
    base_version = manifest['cdn_version']
    metadata_repairs=[]
    # .110 used an atlas-loop variable for its dependency. Correct metadata
    # while preserving its published archive and historical receipt bytes.
    for previous_entry in manifest['patches']:
        if previous_entry['id']=='five-boss-item-art-1.4.110-test' and previous_entry['depends_on']=='item/sprite_sheet':
            assert previous_entry['archive']=='pinball-1.4.109-1.4.110-1-five-boss-item-art-test.zip'
            metadata_repairs.append(dict(id=previous_entry['id'],field='depends_on',before='item/sprite_sheet',after='1.4.109'))
            previous_entry['depends_on']='1.4.109'
    contract.validate_manifest(manifest)
    parts = base_version.split('.'); parts[-1] = str(int(parts[-1])+1); version = '.'.join(parts)
    patch_id = f'five-boss-item-art-{version}-test'
    audit = REPO/'assets/asset-patch/audit'/patch_id
    assert not audit.exists()
    name = f'pinball-{base_version}-{version}-1-five-boss-item-art-test.zip'
    protected = p.readj(previous/'report.json')['protected_local_hold_sha256']
    for rel,digest in protected.items():
        assert p.sha((REPO/rel).read_bytes()) == digest
    old_archives = {}
    for entry in manifest['patches']:
        if not entry.get('enabled'): continue
        for filename in entry.get('chain') or [entry['archive']]:
            source = (old_server/'assets/asset-patch/active'/filename).read_bytes()
            raw = (RUNTIME/'assets/asset-patch/active'/filename).read_bytes()
            assert raw == source
            digest = p.sha(raw)
            receipt = next((r for r in entry.get('archive_integrity',[]) if r['name']==filename),None)
            if receipt: assert digest == receipt['sha256']
            old_archives[filename] = digest
    os.environ.update(WF_SERVER_DIR=str(old_server), WF_CDN_DIR=str(args.pristine.resolve()), WF_LIVE_CDN='1')
    import wf_live_cdn as live
    assert live.describe()['tail'] == base_version
    reads, before, stale_loose = {}, {}, {}
    def read(logical):
        if logical not in before:
            try:
                entry = live.read_logical(logical)
            except live.LiveCdnEntryMissing:
                before[logical]=None
                reads[logical]=dict(missing=True)
                return None
            before[logical] = entry.data
            save(work/'before'/logical, entry.data)
            reads[logical] = dict(sha256=p.sha(entry.data),size=len(entry.data))
            loose = RUNTIME/'assets/asset-patch'/p.member(('common',p.hrel(logical)))
            if loose.exists() and loose.read_bytes() != entry.data:
                # Reviewed old loose index: only this weapon is absent; fifteen
                # other rows differ in description alone. Reconcile to the
                # already published master, without changing its chain bytes.
                raw = loose.read_bytes()
                assert logical == EQUIPMENT and p.sha(raw) == '8b5c89403ee73e2fcce0b0d5c5ba7c8f2780a516d60c2456e954d0659da39b31', ('winning loose override drift',logical)
                assert p.sha(entry.data) == '70ee5aef360663aa84e555b8f5eddb088c52416839333ddbde2ba911686fac68'
                old_rows, chain_rows = p.rawmap(raw), p.rawmap(entry.data)
                assert set(chain_rows)-set(old_rows)=={WEAPON} and not set(old_rows)-set(chain_rows)
                for key,val in old_rows.items():
                    a,b=p.csvrows(val)[0],p.csvrows(chain_rows[key])[0]
                    if a!=b:
                        assert 8000101 <= int(key) <= 8000115
                        assert [i for i in range(len(a)) if a[i]!=b[i]]==[7]
                stale_loose[logical]=dict(before_sha256=p.sha(raw),sha256=p.sha(entry.data),reason='旧散文件缺少死亡使者索引；与已发布链中原有武器表对齐，无新增表改动。')
        return before[logical]
    originals={}
    for filename in [*MATERIALS.values(),WEAPON_ART,TICKET_ART]:
        raw=(args.images/filename).read_bytes()
        with Image.open(io.BytesIO(raw)) as im:
            im.load(); assert im.size==(20,20) and im.mode=='RGBA'
        assert raw[:8] == p.wf_assets.PNG_REAL
        originals[filename]=raw
    generated=contract.make_resources(read,originals,replace_frames)
    resources,source_map=generated['resources'],generated['source_map']
    atlas_report,ticket=generated['atlas'],generated['ticket']
    required=generated['display']['required_small_icons']
    assert resources, 'artwork already matches the current display contracts'
    members={p.member(('common',p.hrel(n))):raw for n,raw in resources.items()}
    for logical,raw in resources.items():
        assert raw!=read(logical), ('unchanged output',logical)
        save(work/'after'/logical,raw)
        if logical.endswith('.png'):
            assert raw[:8]==p.wf_assets.PNG_FAKE
            image=closure.strict_png(raw)
            if logical in source_map and image.size==(20,20):
                assert p.wf_assets.png_decode_stored(raw)==originals[source_map[logical]]
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for member,raw in sorted(members.items()):
            info=zipfile.ZipInfo(member,(2026,9,10,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info,raw)
    archive=buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        assert z.testzip() is None and z.namelist()==sorted(members)
        for logical,raw in resources.items():
            stored=z.read(p.member(('common',p.hrel(logical))));assert stored==raw
            if logical.endswith('.png'): closure.strict_png(stored)
    destination=REPO/'assets/asset-patch/active/candidates'/name
    assert not destination.exists();save(destination,archive)
    integrity=dict(name=name,size=len(archive),sha256=p.sha(archive),members=len(members),files=sorted(members))
    entry=dict(id=patch_id,type='patch',name='五重决战道具与商品图更新（本地测试）',
        description='五重材料栏使用独立40px小图，死亡使者详情与商店使用原生20px缩略图，保持当前用户美术。',
        version=version,depends_on=base_version,enabled=True,archive=name,archive_size=len(archive),chain=[name],
        archive_integrity=[integrity],files=sorted(members),created_at='2026-09-10',local_test_only=True,
        audit=dict(directory=audit.relative_to(REPO).as_posix(),report='report.json'))
    manifest['cdn_version']=version;manifest['patches'].append(entry)
    contract.validate_manifest(manifest)
    server=work/'candidate-server'
    for src in (old_server/'assets/asset-patch/active').glob('*.zip'):
        dest=server/'assets/asset-patch/active'/src.name;dest.parent.mkdir(parents=True,exist_ok=True)
        os.link(src,dest)
    os.link(destination,server/'assets/asset-patch/active'/name)
    for member,raw in members.items():save(server/'assets/asset-patch'/member,raw)
    save(server/'assets/asset-patch/manifest.json',jsonbytes(manifest))
    for filename in ('rush_event_quest.json','rush_event_quest_folder.json'):
        save(server/'server/assets'/filename,(old_server/'server/assets'/filename).read_bytes())
    os.environ['WF_SERVER_DIR']=str(server);live.clear_cache()
    view=live.describe()
    assert view['tail']==version and set(view['platform_tails'].values())=={version}
    inventory={r['logical']:copy.deepcopy(r) for r in p.readj(previous/'resource-inventory.json')}
    for logical,raw in resources.items():
        inventory[logical]=dict(logical=logical,member=p.member(('common',p.hrel(logical))),size=len(raw),sha256=p.sha(raw),before_sha256=p.sha(before[logical]) if before[logical] is not None else None)
    for logical,proof in stale_loose.items():
        inventory[logical]=dict(logical=logical,member=p.member(('common',p.hrel(logical))),size=len(before[logical]),sha256=proof['sha256'])
    for row in inventory.values():assert p.sha(live.read_logical(row['logical']).data)==row['sha256'],row['logical']
    for logical,raw in before.items():assert live.read_logical(logical).data==resources.get(logical,raw),logical
    # Keep the source authoring master aligned so regeneration cannot restore the old ticket picture.
    source_seed=(REPO/SEED).read_bytes();runtime_seed=(RUNTIME/SEED).read_bytes()
    assert json.loads(source_seed)==json.loads(runtime_seed), 'review source/runtime master differences'
    plans=[]
    def plan(root,rel,raw):
        target=(root/rel).resolve()
        assert target.is_relative_to(root.resolve()) and not target.is_relative_to(cdn)
        before_raw=target.read_bytes() if target.exists() else None
        if raw==before_raw:return
        stage=work/'delivery'/root.name/rel;save(stage,raw)
        plans.append(dict(root=str(root),path=rel,source=str(stage),size=len(raw),sha256=p.sha(raw),
            before_sha256=p.sha(before_raw) if before_raw is not None else None))
    plan(REPO,SEED,update_seed(source_seed,ticket))
    for filename,raw in originals.items():plan(REPO,(ART/filename).relative_to(REPO).as_posix(),raw)
    plan(RUNTIME,SEED,update_seed(runtime_seed,ticket))
    plan(RUNTIME,'assets/asset-patch/active/'+name,archive)
    for member,raw in members.items():plan(RUNTIME,'assets/asset-patch/'+member,raw)
    for logical in stale_loose:
        plan(RUNTIME,'assets/asset-patch/'+p.member(('common',p.hrel(logical))),before[logical])
    assert (RUNTIME/'assets/asset-patch/manifest.json').read_bytes()==runtime_manifest_bytes, 'runtime manifest changed during build'
    plan(RUNTIME,'assets/asset-patch/manifest.json',jsonbytes(manifest))
    for rel,digest in protected.items():assert p.sha((REPO/rel).read_bytes())==digest
    report=dict(status='built_verified',base=base_version,version=version,archive=integrity,source_reads=reads,
        changed_logicals=sorted(resources),atlas=atlas_report,required_small_icons=required,negative_missing_icon_checks=len(required),
        artwork={filename:dict(sha256=p.sha(raw),size=[20,20]) for filename,raw in originals.items()},
        source_to_logical=source_map,weapon_render='Original 20x20 pixels; native UI scales by 6 into a 168px frame; lv0 and lv120',
        source_manifest_preserved=True,protected_local_hold_sha256=protected,previous_published_archives_preserved=old_archives,
        effective_inventory_checked=len(inventory),shop_changed_cells=generated['shop_changed_cells'],
        item_changed_cells=generated['item_changed_cells'],equipment_master_unchanged=True,
        trim_updated_keys=generated['trim_updated_keys'],display_contract=generated['display'],manifest_metadata_repairs=metadata_repairs,
        runtime_manifest_preimage_sha256=p.sha(runtime_manifest_bytes),audit_manifest_preimage_sha256=p.sha(manifest_bytes),
        shared_platforms=['Android','iOS'],air_started=False,apk_changed=False,gameplay_or_device_ui_verified=False,
        reconciled_loose_to_existing_chain=stale_loose,
        committed=False,pushed=False,cloud_deployed=False,cloud_overlay_created=False)
    for filename,value in [('manifest.json',manifest),('manifest-entry.json',entry),('resource-inventory.json',list(inventory.values())),('report.json',report)]:p.savej(audit/filename,value)
    delivery=dict(status='preflight_passed',audit=str(audit),version=version,mode='authorized_uncommitted_local_test_increment',files=plans)
    p.savej(work/'delivery-plan.json',delivery);p.savej(audit/'local-sync-plan.json',delivery)
    print(json.dumps(dict(status=report['status'],version=version,resources=len(resources),archive_bytes=len(archive),audit=str(audit)),ensure_ascii=False))


def apply(work):
    plan=p.readj(work/'delivery-plan.json')
    assert plan['status']=='preflight_passed'
    audit=Path(plan['audit']);report=p.readj(audit/'report.json')
    cdn=(REPO/'.cdn').resolve()
    for rel,digest in report['protected_local_hold_sha256'].items():assert p.sha((REPO/rel).read_bytes())==digest
    for filename,digest in report['previous_published_archives_preserved'].items():
        assert p.sha((RUNTIME/'assets/asset-patch/active'/filename).read_bytes())==digest
    for row in plan['files']:
        root=Path(row['root']).resolve();assert root in (REPO.resolve(),RUNTIME.resolve())
        target=(root/row['path']).resolve()
        assert target.is_relative_to(root) and not target.is_relative_to(cdn)
        assert (p.sha(target.read_bytes()) if target.exists() else None)==row['before_sha256'],row['path']
        assert p.sha(Path(row['source']).read_bytes())==row['sha256']
    backup=RUNTIME/'.codex-backups'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-five-boss-item-art')
    assert not backup.exists()
    preimages={}
    for row in plan['files']:
        target=Path(row['root'])/row['path']
        before=target.read_bytes() if target.exists() else None;preimages[str(target)]=before
        if before is not None:
            saved=(backup if Path(row['root'])==RUNTIME else work/'source-before')/row['path']
            save(saved,before)
    p.savej(backup/'sync-plan.json',plan)
    written=[]
    try:
        for row in plan['files']:
            target=Path(row['root'])/row['path'];raw=Path(row['source']).read_bytes()
            assert (target.read_bytes() if target.exists() else None)==preimages[str(target)],row['path']
            temp=target.with_name(target.name+'.five-boss-art.tmp');assert not temp.exists()
            save(temp,raw);written.append(target);os.replace(temp,target)
            assert target.read_bytes()==raw
    except BaseException:
        for target in reversed(written):
            assert target.resolve().is_relative_to(REPO.resolve()) or target.resolve().is_relative_to(RUNTIME.resolve())
            assert not target.resolve().is_relative_to(cdn)
            raw=preimages[str(target)]
            if raw is None:target.unlink(missing_ok=True)
            else:save(target,raw)
        raise
    plan.update(status='local_test_increment_synced',backup=str(backup))
    p.savej(audit/'local-sync-report.json',plan);p.savej(work/'delivery-plan.json',plan)
    print(json.dumps(dict(status=plan['status'],version=plan['version'],backup=str(backup),files=len(plan['files'])),ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    b=sub.add_parser('build')
    for arg in ('work','server','pristine','previous-audit','images'):b.add_argument('--'+arg,type=Path,required=True)
    a=sub.add_parser('apply');a.add_argument('--work',type=Path,required=True)
    args=parser.parse_args()
    if args.command=='build':build(args)
    else:apply(args.work.resolve())
