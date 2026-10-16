"""Build/apply the verified .111 -> .112 local test edge without touching .cdn."""
import argparse,copy,io,json,os,zipfile
from datetime import datetime
from pathlib import Path
import prepare_content as p
from five_boss_art_contract import validate_manifest
R=p.REPO;T=Path('F:/startpoint-cn-main')
def save(path,raw):path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
def jb(value):return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
def shafile(path):return p.sha(path.read_bytes()) if path.exists() else None
def build(work,server,pristine):
    assert not (work/'delivery-plan.json').exists()
    data=p.readj(work/'prepared.json');assert data['target_version']=='1.4.112'
    for f in ['resource-verification.json','candidate-accessor-verification.json']:assert p.readj(work/f)['status']=='passed'
    apk=p.readj(R/'outputs/lens0910-abyss-details-lan-test-20260910/verification-report.json')
    assert apk['required_resource_version']=='1.4.112' and shafile(Path(apk['apk']))==apk['apk_sha256']
    old_manifest=(T/'assets/asset-patch/manifest.json').read_bytes();manifest=json.loads(old_manifest)
    assert manifest==p.readj(server/'assets/asset-patch/manifest.json') and manifest['cdn_version']=='1.4.111'
    validate_manifest(manifest)
    holds=data['protected_local_hold_sha256'];assert all(shafile(R/k)==v for k,v in holds.items())
    archives={}
    for entry in manifest['patches']:
        if not entry.get('enabled'):continue
        for name in entry.get('chain') or [entry['archive']]:
            raw=(server/'assets/asset-patch/active'/name).read_bytes()
            assert (T/'assets/asset-patch/active'/name).read_bytes()==raw
            integrity=next((r for r in entry.get('archive_integrity',[]) if r['name']==name),None)
            if integrity:assert p.sha(raw)==integrity['sha256']
            archives[name]=p.sha(raw)
    members={row['member']:(work/'after'/row['root']/row['logical']).read_bytes() for row in data['resources']}
    assert len(members)==295
    for row in data['resources']:assert p.sha(members[row['member']])==row['sha256']
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,raw in sorted(members.items()):
            assert name.startswith('production/') and '..' not in Path(name).parts and ':' not in name
            info=zipfile.ZipInfo(name,(2026,9,10,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,raw)
    raw=buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        assert z.testzip() is None and z.namelist()==sorted(members)
        assert all(z.read(k)==v for k,v in members.items())
    name='pinball-1.4.111-1.4.112-1-lens0910-details-test.zip'
    archive=R/'assets/asset-patch/active/candidates'/name;assert not archive.exists();save(archive,raw)
    patch_id='lens0910-1.4.112-test';audit=R/'assets/asset-patch/audit'/patch_id;assert not audit.exists()
    integrity=dict(name=name,size=len(raw),sha256=p.sha(raw),members=len(members),files=sorted(members))
    entry=dict(id=patch_id,type='patch',name='Lens 0910 角色更新（保留深渊详情，本地测试）',description='夏白、雷白、秋九尾更新，角色图像语音与杰拉尔文案；保留本地卡池及深渊累计修正。',version='1.4.112',depends_on='1.4.111',enabled=True,archive=name,archive_size=len(raw),chain=[name],archive_integrity=[integrity],files=sorted(members),created_at='2026-09-10',local_test_only=True,audit=dict(directory=audit.relative_to(R).as_posix(),report='report.json'))
    manifest['cdn_version']='1.4.112';manifest['patches'].append(entry);validate_manifest(manifest)
    candidate=work/'candidate-server'
    for old in (server/'assets/asset-patch/active').glob('*.zip'):
        dest=candidate/'assets/asset-patch/active'/old.name;dest.parent.mkdir(parents=True,exist_ok=True);os.link(old,dest)
    os.link(archive,candidate/'assets/asset-patch/active'/name)
    for member,b in members.items():save(candidate/'assets/asset-patch'/member,b)
    save(candidate/'assets/asset-patch/manifest.json',jb(manifest))
    for n in ('rush_event_quest.json','rush_event_quest_folder.json'):
        save(candidate/'server/assets'/n,(server/'server/assets'/n).read_bytes())
    os.environ.update(WF_SERVER_DIR=str(candidate),WF_CDN_DIR=str(pristine),WF_LIVE_CDN='1')
    import wf_live_cdn as live
    live.clear_cache();assert live.describe()['tail']=='1.4.112' and set(live.describe()['platform_tails'].values())=={'1.4.112'}
    prior=p.readj(R/'assets/asset-patch/audit/five-boss-item-art-1.4.111-test/resource-inventory.json')
    inventory={('common',r['logical']):dict(root='common',**r) for r in prior}
    inventory.update({(r['root'],r['logical']):copy.deepcopy(r) for r in data['resources']})
    for (root,logical),r in inventory.items():assert p.sha(live.read_relative(p.hrel(logical),roots=(root,)).data)==r['sha256'],(root,logical)
    plans=[]
    def plan(root,rel,raw,expected):
        target=(root/rel).resolve();assert target.is_relative_to(root.resolve()) and not target.is_relative_to((R/'.cdn').resolve())
        assert shafile(target)==expected,('preimage drift',str(target))
        if p.sha(raw)==expected:return
        staged=work/'delivery'/root.name/rel;save(staged,raw)
        plans.append(dict(root=str(root),path=rel,source=str(staged),sha256=p.sha(raw),size=len(raw),before_sha256=expected))
    for rel in data['server_files']:
        updated=(work/'server-after/assets'/rel).read_bytes()
        plan(R,'assets/'+rel,updated,shafile(work/'server-before/assets'/rel))
        plan(T,'assets/'+rel,updated,shafile(work/'runtime-server-before/assets'/rel))
    plan(T,'assets/asset-patch/active/'+name,raw,None)
    drift={r['member']:r['before_sha256'] for r in data['runtime_loose_overrides']}
    for r in data['resources']:
        rel='assets/asset-patch/'+r['member'];existing=shafile(T/rel)
        if existing is not None:assert existing==drift.get(r['member'],r['before_sha256']),rel
        plan(T,rel,members[r['member']],existing)
    plan(T,'assets/asset-patch/manifest.json',jb(manifest),p.sha(old_manifest))
    report={**data,'status':'built_verified','archive':integrity,'previous_published_archives_preserved':archives,'effective_inventory_checked':len(inventory),'apk':apk,'source_manifest_preserved':True,'committed':False,'pushed':False,'cloud_overlay_created':False,'cloud_deployed':False}
    for filename,value in [('manifest.json',manifest),('manifest-entry.json',entry),('resource-inventory.json',list(inventory.values())),('report.json',report),('resource-verification.json',p.readj(work/'resource-verification.json'))]:p.savej(audit/filename,value)
    delivery=dict(status='preflight_passed',audit=str(audit),version='1.4.112',files=plans,mode='authorized_uncommitted_local_test_increment')
    p.savej(work/'delivery-plan.json',delivery);p.savej(audit/'local-sync-plan.json',delivery)
    print(json.dumps(dict(status='built_verified',archive_bytes=len(raw),inventory=len(inventory),files=len(plans),audit=str(audit)),ensure_ascii=False))

def apply(work):
    plan=p.readj(work/'delivery-plan.json');assert plan['status']=='preflight_passed'
    audit=Path(plan['audit']);report=p.readj(audit/'report.json');cdn=(R/'.cdn').resolve()
    bytecode=p.readj(work/'client/bytecode-verification.json')
    assert bytecode['status']=='passed' and bytecode['swf_sha256']==report['apk']['swf_sha256']
    assert shafile(Path(report['apk']['apk']))==report['apk']['apk_sha256']
    for k,v in report['protected_local_hold_sha256'].items():assert shafile(R/k)==v
    for k,v in report['previous_published_archives_preserved'].items():assert shafile(T/'assets/asset-patch/active'/k)==v
    before={}
    for row in plan['files']:
        root=Path(row['root']).resolve();assert root in (R.resolve(),T.resolve())
        path=(root/row['path']).resolve();assert path.is_relative_to(root) and not path.is_relative_to(cdn)
        assert shafile(path)==row['before_sha256'] and shafile(Path(row['source']))==row['sha256']
        before[path]=path.read_bytes() if path.exists() else None
    backup=T/'.codex-backups'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-lens0910');assert not backup.exists()
    for row in plan['files']:
        path=Path(row['root'])/row['path'];raw=before[path]
        if raw is not None:save((backup if Path(row['root'])==T else work/'source-before')/row['path'],raw)
    p.savej(backup/'sync-plan.json',plan);written=[]
    try:
        for row in plan['files']:
            path=Path(row['root'])/row['path'];assert shafile(path)==row['before_sha256']
            raw=Path(row['source']).read_bytes();temp=path.with_name(path.name+'.lens0910.tmp');assert not temp.exists()
            save(temp,raw);written.append(path);os.replace(temp,path);assert shafile(path)==row['sha256']
    except BaseException:
        for path in reversed(written):
            assert not path.resolve().is_relative_to(cdn)
            if before[path] is None:path.unlink(missing_ok=True)
            else:save(path,before[path])
        raise
    plan.update(status='local_test_increment_synced',backup=str(backup));p.savej(audit/'local-sync-report.json',plan);p.savej(work/'delivery-plan.json',plan)
    print(json.dumps(dict(status=plan['status'],backup=str(backup),files=len(plan['files'])),ensure_ascii=False))

if __name__=='__main__':
    ap=argparse.ArgumentParser();sub=ap.add_subparsers(dest='command',required=True)
    b=sub.add_parser('build')
    for name in ('work','server','pristine'):b.add_argument('--'+name,type=Path,required=True)
    sub.add_parser('apply').add_argument('--work',type=Path,required=True)
    args=ap.parse_args()
    if args.command=='build':build(args.work,args.server,args.pristine)
    else:apply(args.work)
