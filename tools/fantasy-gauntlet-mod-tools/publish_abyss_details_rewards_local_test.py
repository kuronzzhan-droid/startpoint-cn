"""Append corrected rewards and optional detail text to the verified local .108 chain.

--apply performs the authorized local test sync, backing up exact paths and
replacing the manifest last. Published patches and the source held chain stay
immutable. This does not build an APK, commit, push or deploy to the cloud.
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

from publish_sponsor_title_wide_local_test import sha, readj, save, savej, jsonbytes

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path(r'F:\startpoint-cn-main')
PREVIOUS = ROOT/'assets/asset-patch/audit/abyss-swap-thunder-pf-1.4.108-test'
TOWER = ROOT/'assets/asset-patch/audit/abyss-element-sponsor-laite-1.4.104-test'
OLD_SERVER = Path(r'F:\codex\work\abyss-swap-thunder-pf-20260910\candidate-server')
PRISTINE = Path(r'F:\codex\work\abyss-element-local-test-20260910\pristine-read-links\cn')
PATCH_ID = 'abyss-details-rewards-1.4.109-test'
AUDIT = ROOT/'assets/asset-patch/audit'/PATCH_ID
NAME = 'pinball-1.4.108-1.4.109-1-abyss-details-rewards-test.zip'
BEFORE = {
    'master/quest/event/rush_event_quest.orderedmap': '025cbe53c8ad7ce3c7f5f091f25daf303acc2a9edd8df584c0f7e433bead8bb6',
    'master/quest/event/rush_event_quest_folder.orderedmap': 'c960912a7860091586e26d124566ed5e3884b394f00326b83a27c7f1ba20edab',
}


def replace_leaves(raw, replacements, p):
    """Repack only ancestors of edited leaves, preserving every other blob."""
    old = p.rawmap(raw)
    out = dict(old)
    groups = {}
    for path, value in replacements.items():
        assert path and path[0] in old
        groups.setdefault(path[0], {})[path[1:]] = value
    for key, edits in groups.items():
        if () in edits:
            assert len(edits) == 1
            out[key] = edits[()]
        else:
            out[key] = replace_leaves(old[key], edits, p)
    result = p.packmap(out)
    assert p.rawmap(result) == out
    assert all(old[k] == out[k] for k in old if k not in groups)
    return result


def main(work, apply):
    work = work.resolve()
    cdn = (ROOT/'.cdn').resolve()
    assert not work.is_relative_to(cdn)
    before_manifest = (PREVIOUS/'manifest.json').read_bytes()
    assert (RUNTIME/'assets/asset-patch/manifest.json').read_bytes() == before_manifest
    assert (OLD_SERVER/'assets/asset-patch/manifest.json').read_bytes() == before_manifest
    manifest = json.loads(before_manifest)
    assert manifest['cdn_version'] == '1.4.108'
    protected = readj(TOWER/'report.json')['preserved_local_hold_sha256']
    for rel, digest in protected.items():
        assert sha((ROOT/rel).read_bytes()) == digest
    old_archives = {}
    for entry in manifest['patches']:
        if not entry.get('enabled'):
            continue
        for record in entry.get('archive_integrity', []):
            raw = (OLD_SERVER/'assets/asset-patch/active'/record['name']).read_bytes()
            assert sha(raw) == record['sha256']
            assert (RUNTIME/'assets/asset-patch/active'/record['name']).read_bytes() == raw
            old_archives[record['name']] = sha(raw)
    os.environ.update(WF_SERVER_DIR=str(OLD_SERVER), WF_CDN_DIR=str(PRISTINE), WF_LIVE_CDN='1')
    import wf_live_cdn as live
    import wf_rogue_build as rb
    import wf_abyss_quest_details as details
    import wf_rogue_element_channel as channel
    import publish_sponsor_special_thanks as sponsor
    p = sponsor.p
    assert live.describe()['tail'] == '1.4.108'
    before = {logical: live.read_logical(logical).data for logical in BEFORE}
    for logical, raw in before.items():
        assert sha(raw) == BEFORE[logical]
        save(work/'before'/logical, raw)
    original = readj(PREVIOUS/'floor-details.json')
    floors = copy.deepcopy(original)
    hp_audit = {x['round']: x for x in readj(TOWER/'hp-audit.json')['floors']}
    quests = p.rawmap(p.rawmap(before[rb.Q_QUEST])['700099'])
    for floor in floors:
        assert p.csvrows(quests[str(floor['r'])]) == [floor['row']]
        hp = None
        if floor['r'] in (26,30):
            hp = floor['hp_adjustment']['actual_hp']
        elif floor['r'] > 1:
            proof = hp_audit[floor['r']]
            assert proof['absolute_verified'] and proof['play_field'] == floor['row'][98]
            hp = proof['adapter']['final_readback_hp']
        floor['row'][3] = details.with_details(floor['row'][3],details.display_enemy(floor['pick']),hp)
        assert channel.decode(floor['row'][3]) == channel.decode(original[floor['r']-1]['row'][3])
        assert all(a == b for i,(a,b) in enumerate(zip(floor['row'],original[floor['r']-1]['row'],strict=True)) if i != 3)
    resources = {rb.Q_QUEST: replace_leaves(before[rb.Q_QUEST],
        {('700099',str(f['r'])): p.packcsv([f['row']]) for f in floors},p)}
    fixed = readj(ROOT/'assets/rush_event_quest_folder.json')['700099']['1']
    assert fixed == readj(RUNTIME/'assets/rush_event_quest_folder.json')['700099']['1']
    folder = p.rawmap(p.rawmap(before[rb.Q_FOLDER])['700099'])['1']
    row = rb.cells(rb.build_deep_abyss_folder_leaf(rb.join(p.csvrows(folder)[0],False),fixed))
    assert [dict(zip(('type','id','count'),map(int,row[i:i+3])))
            for i in range(7,37,3) if row[i] != '(None)'] == fixed
    resources[rb.Q_FOLDER] = replace_leaves(before[rb.Q_FOLDER],{('700099','1'):p.packcsv([row])},p)
    for logical, raw in resources.items():
        save(work/'after'/logical, raw)
    members = {'production/upload/' + rb.q.hashed_rel(k): v for k, v in resources.items()}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, raw in sorted(members.items()):
            info = zipfile.ZipInfo(name, (2026, 9, 10, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, raw)
    archive = buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        assert z.testzip() is None and set(z.namelist()) == set(members)
        for name, raw in members.items():
            assert z.read(name) == raw
    dest = ROOT/'assets/asset-patch/active/candidates'/NAME
    assert not dest.exists() or dest.read_bytes() == archive
    save(dest, archive)
    integrity = dict(name=NAME, size=len(archive), sha256=sha(archive), members=len(members), files=sorted(members))
    entry = dict(id=PATCH_ID, type='patch', name='深渊奖励预览与关卡详情（本地测试）',
        description='固定奖励预览与服务端一致；为关卡详情提供敌人与血量说明；保留全部战斗数据。',
        version='1.4.109', depends_on='1.4.108', enabled=True, archive=NAME, archive_size=len(archive),
        chain=[NAME], archive_integrity=[integrity], files=sorted(members), created_at='2026-09-10',
        local_test_only=True, required_client_capability='cn.ui.AbyssDetails/v1 + cn.rules.QuestElementResistance/v1',
        audit=dict(directory=AUDIT.relative_to(ROOT).as_posix(), report='report.json'))
    manifest['cdn_version'] = '1.4.109'
    manifest['patches'].append(entry)
    server = work/'candidate-server'
    for src in (OLD_SERVER/'assets/asset-patch/active').glob('*.zip'):
        target = server/'assets/asset-patch/active'/src.name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            os.link(src, target)
        assert target.read_bytes() == src.read_bytes()
    target = server/'assets/asset-patch/active'/NAME
    if not target.exists():
        os.link(dest, target)
    assert target.read_bytes() == archive
    for member, raw in members.items():
        save(server/'assets/asset-patch'/member, raw)
    savej(server/'assets/asset-patch/manifest.json', manifest)
    for name in ('rush_event_quest.json', 'rush_event_quest_folder.json'):
        raw = (OLD_SERVER/'server/assets'/name).read_bytes()
        assert readj(RUNTIME/'assets'/name) == json.loads(raw)
        save(server/'server/assets'/name, raw)
    os.environ.update(WF_SERVER_DIR=str(server), WF_TARGET_STORE=str(server/'assets/asset-patch/production/upload'))
    live.clear_cache()
    view = live.describe()
    assert view['tail'] == '1.4.109' and set(view['platform_tails'].values()) == {'1.4.109'}
    inventory = {x['logical']: copy.deepcopy(x) for x in readj(PREVIOUS/'resource-inventory.json')}
    for logical, raw in resources.items():
        inventory[logical] = dict(logical=logical, member='production/upload/' + rb.q.hashed_rel(logical),
            size=len(raw), sha256=sha(raw), before_sha256=sha(before[logical]))
    for item in inventory.values():
        assert sha(live.read_logical(item['logical']).data) == item['sha256'], item['logical']
    checks = rb.validate_event_chain('700099')
    assert len(checks) == 31 and all(c['ok'] for c in checks)
    # Read compressed output through the normal quest accessor and channel parser.
    effective_quests = rb.q.load_table(rb.Q_QUEST)['700099']
    for floor in floors:
        row = rb.cells(effective_quests[str(floor['r'])])
        assert row == floor['row']
        totals = channel.decode(row[3])
        assert 3 not in totals and 2 <= sum(v >= 99 for v in totals.values()) <= 5
    for rel, digest in protected.items():
        assert sha((ROOT/rel).read_bytes()) == digest
    report = dict(status='built_verified', base='1.4.108', version='1.4.109', archive=integrity,
        fixed_rewards=fixed, event_chain_checks=checks, changed_logicals=sorted(resources),
        effective_inventory_checked=len(inventory), source_manifest_preserved=True,
        protected_local_hold_sha256=protected, previous_published_archives_preserved=old_archives,
        original_combat_columns_preserved=True, original_element_channel_preserved=True,
        server_rewards_unchanged=True, gameplay_or_device_ui_verified=False,
        hp_source='Verified .104 HP audit, with .108 moved-floor HP readback for 26/30',
        committed=False,pushed=False,cloud_deployed=False,cloud_overlay_created=False)
    for name,value in [('manifest.json',manifest),('manifest-entry.json',entry),
        ('resource-inventory.json',list(inventory.values())),('report.json',report),('floor-details.json',floors)]:
        savej(AUDIT/name,value)
    savej(work/'floor-fixtures.json',[dict(r=f['r'],raw=f['row'][3]) for f in floors])
    payloads = {'assets/asset-patch/active/' + NAME: archive}
    payloads.update({'assets/asset-patch/' + member: raw for member, raw in members.items()})
    payloads['assets/asset-patch/manifest.json'] = jsonbytes(manifest)
    preimages = {rel: (RUNTIME/rel).read_bytes() if (RUNTIME/rel).exists() else None for rel in payloads}
    assert preimages['assets/asset-patch/manifest.json'] == before_manifest
    assert preimages['assets/asset-patch/active/' + NAME] is None
    for logical, raw in before.items():
        rel = 'assets/asset-patch/production/upload/' + rb.q.hashed_rel(logical)
        assert preimages[rel] == raw, ('runtime drift', logical)
    for rel in payloads:
        target = (RUNTIME/rel).resolve()
        assert target.is_relative_to(RUNTIME.resolve()) and not target.is_relative_to(cdn)
    plan = dict(status='preflight_passed', target=str(RUNTIME), mode='authorized_uncommitted_local_test_increment',
        files=[dict(path=rel, size=len(raw), sha256=sha(raw),
            before_sha256=sha(preimages[rel]) if preimages[rel] is not None else None) for rel, raw in payloads.items()])
    savej(AUDIT/'local-sync-plan.json', plan)
    if apply:
        backup = RUNTIME/'.codex-backups'/(datetime.now().strftime('%Y%m%d-%H%M%S') + '-abyss-details-rewards')
        assert not backup.exists() and backup.resolve().is_relative_to(RUNTIME.resolve())
        for rel, raw in preimages.items():
            if raw is not None:
                save(backup/rel, raw)
        savej(backup/'sync-plan.json', plan)
        written = []
        try:
            for rel, raw in payloads.items():
                target = RUNTIME/rel
                assert (target.read_bytes() if target.exists() else None) == preimages[rel], ('runtime drift', rel)
                temp = target.with_name(target.name + '.abyss-details.tmp')
                assert not temp.exists()
                save(temp, raw)
                written.append(rel)
                os.replace(temp, target)
                assert target.read_bytes() == raw
        except BaseException:
            for rel in reversed(written):
                target = (RUNTIME/rel).resolve()
                assert target.is_relative_to(RUNTIME.resolve()) and not target.is_relative_to(cdn)
                if preimages[rel] is None:
                    target.unlink(missing_ok=True)
                else:
                    save(target, preimages[rel])
            raise
        plan.update(status='local_test_increment_synced', backup=str(backup))
        savej(AUDIT/'local-sync-report.json', plan)
    print(json.dumps(dict(status=plan['status'], version='1.4.109', archive_sha256=sha(archive),
        archive_bytes=len(archive), fixed_rewards=fixed, backup=plan.get('backup')), ensure_ascii=False))



if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--work', type=Path, required=True)
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    main(args.work, args.apply)
