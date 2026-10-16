"""Append the requested tower adjustment to the verified local .107 chain.

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
PREVIOUS = ROOT/'assets/asset-patch/audit/sponsor-title-wide-1.4.107-test'
TOWER = ROOT/'assets/asset-patch/audit/abyss-element-sponsor-laite-1.4.104-test'
OLD_SERVER = Path(r'F:\codex\work\sponsor-title-wide-patch-20260910\candidate-server')
PRISTINE = Path(r'F:\codex\work\abyss-element-local-test-20260910\pristine-read-links\cn')
PATCH_ID = 'abyss-swap-thunder-pf-1.4.108-test'
AUDIT = ROOT/'assets/asset-patch/audit'/PATCH_ID
NAME = 'pinball-1.4.107-1.4.108-1-abyss-swap-thunder-pf-test.zip'
SEED = 46454236
BEFORE = {
    'master/quest/event/rush_event_quest.orderedmap': 'b0d893abfad4b6e169d61399f8cf0c77f9c42fd610ba1ae59f2f8bb0216017cc',
    'master/battle/boss/boss_level.orderedmap': 'e4360d8b2389bfc0576452f8dd19520f8ef3e71d886ee049655973dfb43cfe3b',
    'master/battle/boss/general_boss_state.orderedmap': '6ec9ed11b40d8db8012d0784d473dd424ec2001082c670686f11bb73231a519e',
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
    assert manifest['cdn_version'] == '1.4.107'
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
    import wf_abyss_tower_adjustments as adj
    import wf_rogue_element_channel as channel
    import publish_sponsor_special_thanks as sponsor
    p = sponsor.p
    assert live.describe()['tail'] == '1.4.107'
    before = {logical: live.read_logical(logical).data for logical in BEFORE}
    for logical, raw in before.items():
        assert sha(raw) == BEFORE[logical]
        save(work/'before'/logical, raw)
    original = readj(TOWER/'floor-details.json')
    quests = p.rawmap(p.rawmap(before[rb.Q_QUEST])['700099'])
    for floor in original:
        assert p.csvrows(quests[str(floor['r'])]) == [floor['row']]
    floors, policy = adj.adjust_floors(original, SEED)
    replacements = {(str(f['r']),): p.packcsv([f['row']]) for f in floors}
    resources = {rb.Q_QUEST: replace_leaves(before[rb.Q_QUEST],
        {('700099', *path): v for path, v in replacements.items()}, p)}

    # Preserve encounter identities and complete native field/reference closure.
    # The moved General clones use private routines; no shared donor is edited.
    level_table = rb.q.load_table(rb.BOSS_LEVEL)
    adjusted_levels = copy.deepcopy(level_table)
    state_table = rb.q.load_table(rb.GENERAL_BOSS_STATE)
    general = rb.q.load_table(rb.GENERAL_BOSS)
    standard = rb.q.load_table(rb.STANDARD_BOSS)
    hp_receipts, trial_receipts = [], []
    level_edits, state_edits = {}, {}
    for r in (26, 30):
        floor = floors[r - 1]
        bosses = floor['pick']['runtime_bosses']
        level = int(floor['row'][95])
        assert level == 100 and floor['row'][86:89] == ['1', '1', '1']
        old_hp = rb.floor_native_hp(bosses, level, standard, level_table)
        assert old_hp['absolute_verified']
        target_base = rb.boss_target_hp(r, 30)
        target = target_base * floor['curse']['hp']
        for code in bosses:
            assert code not in level_edits
            leaf, column = rb.clone_general_boss_level_hp(level_table[code], target / old_hp['native_hp'])
            assert column == 2
            old_row, new_row = rb.cells(level_table[code]), rb.cells(leaf)
            assert all(a == b for i, (a, b) in enumerate(zip(old_row, new_row, strict=True)) if i != 2)
            adjusted_levels[code] = leaf
            level_edits[(code,)] = p.packcsv([new_row])
        new_hp = rb.floor_native_hp(bosses, level, standard, adjusted_levels)
        assert new_hp['absolute_verified'] and abs(new_hp['native_hp'] - target) <= 100
        floor['hp_adjustment'] = dict(target_base_hp=target_base, curse_multiplier=floor['curse']['hp'],
                                     target_hp=target, actual_hp=new_hp['native_hp'])
        for old, new in zip(old_hp['components'], new_hp['components'], strict=True):
            code = old['code']
            assert code == new['code']
            selected = min(int(k) for k in general[code] if int(k) >= level)
            routine = rb.cells(general[code][str(selected)])[42]
            records = rb.general_damage_check_records(state_table[routine])
            if not records:
                continue
            users = [(c, lv) for c, rows in general.items() for lv, leaf in rows.items()
                     if rb.cells(leaf)[42] == routine]
            assert users == [(code, str(selected))], ('routine is shared', routine, users)
            assert routine == code + '_state'
            scaled = rb.scale_general_damage_checks(state_table[routine],
                source_max_hp=old['native_hp'], target_max_hp=new['native_hp'])
            contract = rb.general_damage_check_contract(state_table[routine], scaled, scaled,
                source_max_hp=old['native_hp'], baseline_max_hp=new['native_hp'], final_max_hp=new['native_hp'],
                source_routine_id=routine, final_routine_id=routine, materialized=True)
            contract.update(round=r, private_routine_updated_in_place=True, routine_cloned=False,
                enemy_watch_lookup_preserved=True, hp_curse_multiplier=floor['curse']['hp'],
                source_hp_is_previous_verified_local_test=True)
            trial_receipts.append(contract)
            for record in records:
                path = tuple(record['path'])
                leaf = scaled
                for key in path:
                    leaf = leaf[key]
                state_edits[(routine, *path)] = p.packcsv([rb.cells(leaf)])
        hp_receipts.append(dict(round=r, source_round=floor['adjustment_policy']['source_round'],
            bosses=bosses, target_base_hp=target_base, curse_multiplier=floor['curse']['hp'],
            target_hp=target, before=old_hp, after=new_hp, non_hp_level_columns_preserved=True))
    assert len(level_edits) == 4 and len(state_edits) == 210 and len(trial_receipts) == 2
    resources[rb.BOSS_LEVEL] = replace_leaves(before[rb.BOSS_LEVEL], level_edits, p)
    resources[rb.GENERAL_BOSS_STATE] = replace_leaves(before[rb.GENERAL_BOSS_STATE], state_edits, p)
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
    entry = dict(id=PATCH_ID, type='patch', name='深渊换层与雷/PF调校（本地测试）',
        description='26与30层完整战斗互换并按新层数调整血量；移除全塔附加雷抗及雷封锁；随机15层额外PF抗性-15个百分点。',
        version='1.4.108', depends_on='1.4.107', enabled=True, archive=NAME, archive_size=len(archive),
        chain=[NAME], archive_integrity=[integrity], files=sorted(members), created_at='2026-09-10',
        local_test_only=True, required_client_capability='cn.rules.QuestElementResistance/v1',
        audit=dict(directory=AUDIT.relative_to(ROOT).as_posix(), report='report.json'))
    manifest['cdn_version'] = '1.4.108'
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
    assert view['tail'] == '1.4.108' and set(view['platform_tails'].values()) == {'1.4.108'}
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
        source = original[floor['adjustment_policy']['source_round'] - 1]
        assert row[98] == source['row'][98] and row[5] == source['row'][5]
    effective_levels = rb.q.load_table(rb.BOSS_LEVEL)
    effective_states = rb.q.load_table(rb.GENERAL_BOSS_STATE)
    for item in hp_receipts:
        assert rb.floor_native_hp(item['bosses'], 100, standard, effective_levels) == item['after']
    for item in trial_receipts:
        assert rb.general_damage_check_records(effective_states[item['final_routine_id']]) == rb.general_damage_check_records(
            rb.scale_general_damage_checks(state_table[item['source_routine_id']],
                source_max_hp=item['source_max_hp'], target_max_hp=item['final_max_hp']))
    for rel, digest in protected.items():
        assert sha((ROOT/rel).read_bytes()) == digest
    report = dict(status='built_verified', base='1.4.107', version='1.4.108', archive=integrity,
        policy=policy, hp=hp_receipts, damage_trial_count=210,
        damage_trial_absolute_thresholds_preserved=True, event_chain_checks=checks,
        changed_logicals=sorted(resources), effective_inventory_checked=len(inventory),
        source_manifest_preserved=True, protected_local_hold_sha256=protected,
        previous_published_archives_preserved=old_archives,
        previous_missing_preaction_and_standard_link_repairs_preserved=True,
        field_boss_thumbnail_and_native_mechanisms_move_together=True,
        no_added_thunder_resistance=True, innate_enemy_mechanisms_unchanged=True,
        random_pf_selection='uniform sample without replacement; independent domain-separated seed',
        pf_formula='native quest kind 2; existing merged condition strength minus 0.15',
        no_silent_condition_truncation=True, server_quest_metadata_unchanged=True,
        apk_changed=False, ipa_changed=False, gameplay_or_device_ui_verified=False,
        branch='staging', head='8f6252bb31c7f18a8cb61f11fa699282e68ebc4b',
        committed=False, pushed=False, cloud_deployed=False, cloud_overlay_created=False)
    for name, value in [('manifest.json', manifest), ('manifest-entry.json', entry),
        ('resource-inventory.json', list(inventory.values())), ('report.json', report),
        ('floor-details.json', floors), ('hp-trial-contracts.json', trial_receipts)]:
        savej(AUDIT/name, value)
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
        backup = RUNTIME/'.codex-backups'/(datetime.now().strftime('%Y%m%d-%H%M%S') + '-abyss-swap-thunder-pf')
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
                temp = target.with_name(target.name + '.abyss-balance.tmp')
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
    print(json.dumps(dict(status=plan['status'], version='1.4.108', archive_sha256=sha(archive),
        archive_bytes=len(archive), pf_floors=policy['pf_floors'],
        hp={x['round']: x['after']['native_hp'] for x in hp_receipts}, backup=plan.get('backup')), ensure_ascii=False))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--work', type=Path, required=True)
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    main(args.work, args.apply)
