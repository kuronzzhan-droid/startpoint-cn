"""Append an isolated .105 -> .106 local-test repair of Standard Boss families.

Build from the reviewed source .105 projection; --apply synchronizes only the
new archive, its sparse resources and the local-test manifest. No HP reroll,
APK change, source held-manifest replacement, Git or cloud operation.
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
import zlib

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path(r'F:\startpoint-cn-main')
PREVIOUS = ROOT/'assets/asset-patch/audit/abyss-pre-action-empty-1.4.105-test'
TOWER = ROOT/'assets/asset-patch/audit/abyss-element-sponsor-laite-1.4.104-test'
OLD_SERVER = Path(r'F:\codex\work\abyss-pre-action-repair-20260910\candidate-server')
PRISTINE = Path(r'F:\codex\work\abyss-element-local-test-20260910\pristine-read-links\cn')
PATCH_ID = 'abyss-standard-links-1.4.106-test'
AUDIT = ROOT/'assets/asset-patch/audit'/PATCH_ID
NAME = 'pinball-1.4.105-1.4.106-1-abyss-standard-links-test.zip'
ROUNDS = (6, 12, 15, 21)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def readj(path): return json.loads(path.read_text('utf8'))
def save(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    assert path.read_bytes() == raw
def jsonbytes(value): return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
def savej(path, value): save(path, jsonbytes(value))


def main(work, apply):
    work=work.resolve()
    cdn=(ROOT/'.cdn').resolve()
    assert not work.is_relative_to(cdn)
    before_manifest=(PREVIOUS/'manifest.json').read_bytes()
    assert (RUNTIME/'assets/asset-patch/manifest.json').read_bytes()==before_manifest
    assert (OLD_SERVER/'assets/asset-patch/manifest.json').read_bytes()==before_manifest
    manifest=json.loads(before_manifest)
    assert manifest['cdn_version']=='1.4.105'
    held=(ROOT/'assets/asset-patch/manifest.json').read_bytes()
    protected=readj(TOWER/'report.json')['preserved_local_hold_sha256']
    for rel,digest in protected.items(): assert sha((ROOT/rel).read_bytes())==digest
    # The two published local-test archives are immutable source inputs.
    old_archives={}
    for audit in (TOWER,PREVIOUS):
        entry=readj(audit/'manifest-entry.json')
        path=ROOT/'assets/asset-patch/active/candidates'/entry['archive']
        raw=path.read_bytes()
        assert sha(raw)==entry['archive_integrity'][0]['sha256']
        assert (RUNTIME/'assets/asset-patch/active'/path.name).read_bytes()==raw
        old_archives[path.name]=sha(raw)
    os.environ.update(WF_SERVER_DIR=str(OLD_SERVER),WF_CDN_DIR=str(PRISTINE),WF_LIVE_CDN='1')
    import wf_live_cdn as live
    import wf_rogue_build as rb
    import wf_dsl
    import wf_standard_enemy_links as links
    import publish_sponsor_special_thanks as sponsor
    p=sponsor.p
    assert live.describe()['tail']=='1.4.105'
    resources={}
    provenance={}
    def read(logical):
        result=live.read_logical(logical)
        provenance[logical]=dict(sha256=sha(result.data),archive=str(result.archive),member=result.member)
        return result.data
    def tree(logical): return wf_dsl.parse_dsl(zlib.decompress(read(logical),-15))['tree']
    def action(path): return tree(path+'.action.dsl.amf3.deflate')
    sb=rb.q.load_table(rb.STANDARD_BOSS)
    sf=rb.q.load_table(rb.STANDARD_FUNNEL)
    funnel_before=read(rb.STANDARD_FUNNEL)
    funnel_map=p.rawmap(funnel_before)
    original_funnel_map=dict(funnel_map)
    floors=readj(TOWER/'hp-audit.json')['floors']
    receipts=[]
    updated_boss_paths=set()
    before_resources={rb.STANDARD_FUNNEL:funnel_before}
    for floor in floors:
        number=int(floor['round'])
        if number not in ROUNDS: continue
        level=int(floor['enemy_level'])
        ids=dict(zip(floor['source_bosses'],floor['runtime_bosses'],strict=True))
        actors={}
        actor_paths={}
        selected_levels={}
        def load_actor(code,table,lookup,column):
            node=table[lookup]
            selected=min(int(k) for k in node if int(k)>=level)
            row=rb.cells(node[str(selected)])
            logical=row[column]+'.esdl.amf3.deflate'
            actors[code]=tree(logical)
            actor_paths[code]=logical
            selected_levels[code]=selected
        for code,dest in ids.items():
            load_actor(code,sb,dest,1)
            logical=actor_paths[code]
            before_resources[logical]=read(logical)
            updated_boss_paths.add(logical)
        queue=sorted(set().union(*(links.action_roots(t) for t in actors.values())))
        actions={}
        while queue:
            path=queue.pop(0)
            if path in actions: continue
            assert len(actions)<512
            t=action(path);actions[path]=t
            for value in links.walk(t):
                if isinstance(value,str) and value.startswith('battle/action/'):
                    child=value.removesuffix('.action.dsl.amf3.deflate')
                    if child not in actions:queue.append(child)
                if isinstance(value,list) and len(value)==2 and value[0] in ('StandardBoss','StandardFunnel'):
                    kind,code=value
                    if code in actors:continue
                    assert kind=='StandardFunnel',('undeclared external Boss',value)
                    load_actor(code,sf,code,0)
                    queue.extend(sorted(links.action_roots(actors[code])))
        for code in sorted(set(actors)-set(ids)):
            ids[code]=f'mod_rogue_r{number}_f_'+hashlib.sha256(code.encode()).hexdigest()[:10]
            assert ids[code] not in sf
        bundle=links.clone_family(actors,ids,actions.__getitem__,
            namespace=f'battle/action/enemy/action/mod_rogue/r{number}_links')
        assert set(bundle['original_actions'])==set(actions)
        actor_receipts=[]
        for code,dest in sorted(ids.items()):
            repaired=bundle['actors'][dest]
            if code in floor['source_bosses']:
                logical=actor_paths[code]
            else:
                base=f'battle/enemy/boss/mod_rogue/r{number}_links/{dest}'
                logical=base+'.esdl.amf3.deflate'
                # These private IDs are pinned to this floor's selected level.
                raw_row=p.rawmap(original_funnel_map[code])[str(selected_levels[code])]
                rows=p.csvrows(raw_row)
                assert len(rows)==1 and len(rows[0])==1
                rows[0][0]=base
                assert dest not in funnel_map
                funnel_map[dest]=p.packmap({str(selected_levels[code]):p.packcsv(rows)})
            assert logical not in resources
            resources[logical]=rb.build_standard_enemy_dsl_blob(repaired)
            assert rb.standard_enemy_hp_base(repaired)==rb.standard_enemy_hp_base(actors[code])
            # Trial objects, windows and branches are identical under the
            # inverse identity map; this repair does not rebalance old HP.
            actor_receipts.append(dict(source_id=code,runtime_id=dest,
                source_logical=actor_paths[code],logical=logical,selected_level=selected_levels[code],
                hp=rb.standard_enemy_hp_base(repaired),
                before_links=links.reverse_boss_references(actors[code]),
                after_links=links.reverse_boss_references(repaired)))
        for path,t in sorted(bundle['actions'].items()):
            logical=path+'.action.dsl.amf3.deflate'
            assert logical not in resources
            resources[logical]=rb.build_immunity_dsl_blob(t)
        savej(work/f'verified-family-{number}.json',bundle)
        receipts.append(dict(round=number,enemy_level=level,actors=actor_receipts,
            action_count=len(bundle['actions']),id_map=ids,prefix_map=bundle['prefix_map'],
            action_map=bundle['action_map'],inverse_identity_replay_passed=True,
            hp_trials_timers_and_unrelated_values_unchanged=True))
    assert len(receipts)==4 and len(updated_boss_paths)==5
    assert len(funnel_map)-len(original_funnel_map)==25
    for code,raw in original_funnel_map.items():assert funnel_map[code]==raw
    resources[rb.STANDARD_FUNNEL]=p.packmap(funnel_map)
    readback=p.rawmap(resources[rb.STANDARD_FUNNEL])
    assert readback==funnel_map
    assert len(resources)==268
    for logical,raw in resources.items():save(work/'resources'/logical,raw)
    members={'production/upload/'+rb.q.hashed_rel(logical):raw for logical,raw in resources.items()}
    assert len(members)==len(resources)
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,raw in sorted(members.items()):
            info=zipfile.ZipInfo(name,(2026,9,10,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info,raw)
    archive=buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        assert z.testzip() is None and set(z.namelist())==set(members)
        for name,raw in members.items():assert z.read(name)==raw
    dest=ROOT/'assets/asset-patch/active/candidates'/NAME
    assert not dest.exists() or dest.read_bytes()==archive
    save(dest,archive)
    integrity=dict(name=NAME,size=len(archive),sha256=sha(archive),members=len(members),files=sorted(members))
    entry=dict(id=PATCH_ID,type='patch',name='深渊本体与核心关联修复（本地测试）',
        description='修复第6、12、15、21关克隆编号导致的核心伤害共享及状态监视失联；保留原塔、血量与属性封锁。',
        version='1.4.106',depends_on='1.4.105',enabled=True,archive=NAME,archive_size=len(archive),
        chain=[NAME],archive_integrity=[integrity],files=sorted(members),created_at='2026-09-10',
        local_test_only=True,required_client_capability='cn.rules.QuestElementResistance/v1',
        audit=dict(directory=AUDIT.relative_to(ROOT).as_posix(),report='report.json'))
    manifest['cdn_version']='1.4.106';manifest['patches'].append(entry)
    server=work/'candidate-server'
    for src in (OLD_SERVER/'assets/asset-patch/active').glob('*.zip'):
        target=server/'assets/asset-patch/active'/src.name
        target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():os.link(src,target)
        assert target.read_bytes()==src.read_bytes()
    target=server/'assets/asset-patch/active'/NAME
    if not target.exists():os.link(dest,target)
    assert target.read_bytes()==archive
    for member,raw in members.items():save(server/'assets/asset-patch'/member,raw)
    savej(server/'assets/asset-patch/manifest.json',manifest)
    for name in ('rush_event_quest.json','rush_event_quest_folder.json'):
        save(server/'server/assets'/name,(OLD_SERVER/'server/assets'/name).read_bytes())
    os.environ.update(WF_SERVER_DIR=str(server),WF_TARGET_STORE=str(server/'assets/asset-patch/production/upload'))
    live.clear_cache()
    view=live.describe()
    assert view['tail']=='1.4.106' and set(view['platform_tails'].values())=={'1.4.106'}
    inventory={x['logical']:copy.deepcopy(x) for x in readj(PREVIOUS/'resource-inventory.json')}
    for logical,raw in resources.items():
        inventory[logical]=dict(logical=logical,member='production/upload/'+rb.q.hashed_rel(logical),
            sha256=sha(raw),size=len(raw))
    for item in inventory.values():assert sha(live.read_logical(item['logical']).data)==item['sha256'],item['logical']
    # Every original donor remains effective and byte-identical; only the five
    # existing private Boss scripts and appended private dependencies change.
    for logical,record in provenance.items():
        if logical not in before_resources:assert sha(live.read_logical(logical).data)==record['sha256']
    checks=rb.validate_event_chain('700099')
    assert len(checks)==31 and all(c['ok'] for c in checks)
    assert (ROOT/'assets/asset-patch/manifest.json').read_bytes()==held
    for rel,digest in protected.items():assert sha((ROOT/rel).read_bytes())==digest
    report=dict(status='repair_built_verified',base='1.4.105',version='1.4.106',archive=integrity,
        affected_rounds=list(ROUNDS),families=receipts,source_resources=provenance,
        changed_existing_logicals=sorted(before_resources),new_standard_funnel_ids=25,
        preserved_published_archives=old_archives,event_chain_checks=checks,
        floor_configuration_unchanged=True,hp_and_trial_configuration_unchanged=True,
        old_funnel_rows_byte_identical=True,original_donor_resources_unchanged=True,
        texture_and_animation_references_unchanged=True,source_manifest_preserved=True,
        generator_guard='Standard Funnel ESDL reverse links now forbid unproved partial Boss identity clones.',
        damage_check_schema='Standard state.e=animation; state.m/T2=DamageCheck; script thresholds require separate HP proof.',
        regression_test_scope='5 Standard family regressions plus 9 existing Standard Boss HP regressions',
        apk_changed=False,committed=False,pushed=False,cloud_deployed=False,android_retest_passed=False,
        branch='staging',head='8f6252bb31c7f18a8cb61f11fa699282e68ebc4b')
    savej(AUDIT/'manifest.json',manifest);savej(AUDIT/'manifest-entry.json',entry)
    savej(AUDIT/'resource-inventory.json',list(inventory.values()));savej(AUDIT/'report.json',report)
    manifest_rel='assets/asset-patch/manifest.json'
    payloads={'assets/asset-patch/active/'+NAME:archive}
    payloads.update({'assets/asset-patch/'+member:raw for member,raw in members.items()})
    payloads[manifest_rel]=jsonbytes(manifest) # Manifest is atomically replaced last.
    preimages={rel:(RUNTIME/rel).read_bytes() if (RUNTIME/rel).exists() else None for rel in payloads}
    assert preimages[manifest_rel]==before_manifest
    assert preimages['assets/asset-patch/active/'+NAME] is None
    for logical,raw in resources.items():
        rel='assets/asset-patch/production/upload/'+rb.q.hashed_rel(logical)
        if logical in before_resources:
            assert preimages[rel] is None or preimages[rel]==before_resources[logical],('runtime drift',logical)
        else:assert preimages[rel] is None,('new path exists',rel)
    for rel in payloads:
        target=(RUNTIME/rel).resolve()
        assert target.is_relative_to(RUNTIME.resolve()) and not target.is_relative_to(cdn)
    plan=dict(status='preflight_passed',target=str(RUNTIME),mode='authorized_uncommitted_local_test_repair',
        files=[dict(path=rel,size=len(raw),sha256=sha(raw),
            before_sha256=sha(preimages[rel]) if preimages[rel] is not None else None) for rel,raw in payloads.items()])
    savej(AUDIT/'local-sync-plan.json',plan)
    if apply:
        backup=RUNTIME/'.codex-backups'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-abyss-standard-links')
        assert not backup.exists() and backup.resolve().is_relative_to(RUNTIME.resolve())
        backup.mkdir(parents=True)
        for rel,raw in preimages.items():
            if raw is not None:save(backup/rel,raw)
        savej(backup/'sync-plan.json',plan)
        written=[]
        try:
            for rel,raw in payloads.items():
                target=RUNTIME/rel
                assert (target.read_bytes() if target.exists() else None)==preimages[rel],('runtime drift',rel)
                temp=target.with_name(target.name+'.abyss-links.tmp')
                assert not temp.exists()
                save(temp,raw);written.append(rel);os.replace(temp,target)
                assert target.read_bytes()==raw
        except BaseException:
            for rel in reversed(written):
                target=(RUNTIME/rel).resolve()
                assert target.is_relative_to(RUNTIME.resolve()) and not target.is_relative_to(cdn)
                if preimages[rel] is None:target.unlink(missing_ok=True)
                else:save(target,preimages[rel])
            raise
        plan.update(status='local_test_repair_synced',backup=str(backup))
        savej(AUDIT/'local-sync-report.json',plan)
    print(json.dumps(dict(status=plan['status'],version='1.4.106',archive_sha256=sha(archive),
        resources=len(resources),archive_bytes=len(archive),backup=plan.get('backup')),ensure_ascii=False))


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--work',type=Path,required=True)
    ap.add_argument('--apply',action='store_true')
    args=ap.parse_args();main(args.work,args.apply)
