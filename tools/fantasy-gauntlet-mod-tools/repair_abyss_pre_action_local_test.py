"""Append the local .104 -> .105 repair; never replace the published .104 ZIP.

Builds from the source audit and regenerated reviewed tower. --apply syncs only
the repair archive, General Boss table and independent local-test manifest.
The held source manifest, APK, server code and player state are not inputs.
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

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path(r'F:\startpoint-cn-main')
PREVIOUS = ROOT / 'assets/asset-patch/audit/abyss-element-sponsor-laite-1.4.104-test'
OLD_WORK = Path(r'F:\codex\work\abyss-element-local-test-20260910')
PATCH_ID = 'abyss-pre-action-empty-1.4.105-test'
AUDIT = ROOT / 'assets/asset-patch/audit' / PATCH_ID
NAME = 'pinball-1.4.104-1.4.105-1-abyss-pre-action-empty-test.zip'
LOGICAL = 'master/battle/boss/general_boss.orderedmap'
MEMBER = 'production/upload/ec/d8f66b60947ca05643c4080a6cc925c750b9d6'
BEFORE_SHA = '19310bb3d96794fa3d206cac77bfd194077a3557ee35c9a2a0c2332a4dfbce2c'
OLD_ZIP_SHA = 'd6cee14a122878c3c97f33c910ac8fd1b585de63d1b6e52860f195521dad5fc1'


def sha(raw): return hashlib.sha256(raw).hexdigest()
def readj(path): return json.loads(path.read_text('utf8'))
def save(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    assert path.read_bytes() == raw
def savej(path, value): save(path, (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode())


def main(work, apply):
    work = work.resolve()
    cdn = (ROOT/'.cdn').resolve()
    assert not work.is_relative_to(cdn)
    source_manifest = (ROOT/'assets/asset-patch/manifest.json').read_bytes()
    manifest_before = (PREVIOUS/'manifest.json').read_bytes()
    manifest = json.loads(manifest_before)
    assert manifest['cdn_version'] == '1.4.104'
    assert (RUNTIME/'assets/asset-patch/manifest.json').read_bytes() == manifest_before
    previous_archive = ROOT/'assets/asset-patch/inactive/candidates'/manifest['patches'][-1]['archive']
    assert sha(previous_archive.read_bytes()) == OLD_ZIP_SHA
    assert (RUNTIME/'assets/asset-patch/active'/previous_archive.name).read_bytes() == previous_archive.read_bytes()
    with zipfile.ZipFile(previous_archive) as z:
        before = z.read(MEMBER)
    assert sha(before) == BEFORE_SHA
    assert (RUNTIME/'assets/asset-patch'/MEMBER).read_bytes() == before
    protected = readj(PREVIOUS/'report.json')['preserved_local_hold_sha256']
    for rel, digest in protected.items(): assert sha((ROOT/rel).read_bytes()) == digest

    import publish_sponsor_special_thanks as sponsor
    import wf_rogue_element_channel as channel
    p = sponsor.p
    after = (work/'regenerated/candidate-server/assets/asset-patch'/MEMBER).read_bytes()
    changes = []
    paths = []
    def compare(left, right, path=()):
        try: old, new = p.rawmap(left), p.rawmap(right)
        except Exception:
            old, new = p.csvrows(left), p.csvrows(right)
            assert len(old) == len(new)
            for i, (a, b) in enumerate(zip(old, new)):
                assert len(a) == len(b)
                cols = [j for j in range(len(a)) if a[j] != b[j]]
                if cols:
                    assert path[0].startswith('mod_rogue_') and cols == [109]
                    assert a[109] == '(None)' and b[109] == ''
                    changes.append(dict(path=list(path), row=i, column=109, before=a[109], after=b[109]))
                if path[0].startswith('mod_rogue_'):
                    refs = channel.pre_action_programs(b[109])
                    paths.append(dict(path=list(path), pre_actions=refs))
            if left != right: assert old != new, ('unnecessary leaf rewrite', path)
        else:
            assert list(old) == list(new)
            for key in old: compare(old[key], new[key], path+(key,))
    compare(before, after)
    expected_paths = {tuple(c['path']) for c in readj(PREVIOUS/'element-channel-receipt.json')['carrier_changes'] if c['after'] == '(None)'}
    assert {tuple(c['path']) for c in changes} == expected_paths and len(changes) == 13
    assert len(paths) == 30
    assert (work/'regenerated/floor-details.json').read_bytes() == (PREVIOUS/'floor-details.json').read_bytes()
    assert (work/'regenerated/hp-audit.json').read_bytes() == (PREVIOUS/'hp-audit.json').read_bytes()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        info = zipfile.ZipInfo(MEMBER, (2026, 9, 10, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, after)
    archive = buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        assert z.testzip() is None and z.namelist() == [MEMBER] and z.read(MEMBER) == after
    dest = ROOT/'assets/asset-patch/inactive/candidates'/NAME
    assert not dest.exists() or dest.read_bytes() == archive
    save(dest, archive)
    integrity = dict(name=NAME, size=len(archive), sha256=sha(archive), members=1, files=[MEMBER])
    entry = dict(id=PATCH_ID, type='patch', name='深渊空初始化脚本修复（本地测试）',
        description='修正九关十三条 General Boss 配置的空脚本列表，避免加载 (None).action.dsl.amf3.deflate；保留原塔和属性封锁。',
        version='1.4.105', depends_on='1.4.104', enabled=True, archive=NAME, archive_size=len(archive),
        chain=[NAME], archive_integrity=[integrity], files=[MEMBER], created_at='2026-09-10',
        local_test_only=True, required_client_capability='cn.rules.QuestElementResistance/v1',
        audit=dict(directory=AUDIT.relative_to(ROOT).as_posix(), report='report.json'))
    manifest['cdn_version'] = '1.4.105'
    manifest['patches'].append(entry)
    server = work/'candidate-server'
    # An isolated chain reuses immutable archives; no baseline extraction.
    for src in (OLD_WORK/'candidate-server/assets/asset-patch/active').glob('*.zip'):
        target = server/'assets/asset-patch/active'/src.name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists(): os.link(src, target)
        assert sha(target.read_bytes()) == sha(src.read_bytes())
    target = server/'assets/asset-patch/active'/NAME
    if not target.exists(): os.link(dest, target)
    assert target.read_bytes() == archive
    save(server/'assets/asset-patch'/MEMBER, after)
    savej(server/'assets/asset-patch/manifest.json', manifest)
    for name in ['rush_event_quest.json', 'rush_event_quest_folder.json']:
        save(server/'server/assets'/name, (OLD_WORK/'candidate-server/server/assets'/name).read_bytes())
    os.environ.update(WF_SERVER_DIR=str(server), WF_CDN_DIR=str(OLD_WORK/'pristine-read-links/cn'),
        WF_TARGET_STORE=str(server/'assets/asset-patch/production/upload'), WF_LIVE_CDN='1')
    import wf_live_cdn as live
    import wf_rogue_build as rb
    live.clear_cache()
    view = live.describe()
    assert view['tail'] == '1.4.105' and set(view['platform_tails'].values()) == {'1.4.105'}
    inventory = copy.deepcopy(readj(PREVIOUS/'resource-inventory.json'))
    for item in inventory:
        if item['logical'] == LOGICAL: item.update(sha256=sha(after), size=len(after))
        assert sha(live.read_logical(item['logical']).data) == item['sha256'], item['logical']
    references = []
    for ref in sorted({ref for row in paths for ref in row['pre_actions']}):
        # Preserve the full native reference, including '$' in asset names.
        logical = ref+'.action.dsl.amf3.deflate'
        data = live.read_logical(logical)
        assert data.data
        references.append(dict(reference=ref, logical=logical, sha256=sha(data.data), archive=data.archive.name))
    checks = rb.validate_event_chain('700099')
    assert len(checks) == 31 and all(c['ok'] for c in checks)
    assert sha(previous_archive.read_bytes()) == OLD_ZIP_SHA
    for rel, digest in protected.items(): assert sha((ROOT/rel).read_bytes()) == digest
    assert (ROOT/'assets/asset-patch/manifest.json').read_bytes() == source_manifest
    report = dict(status='repair_built_verified', version='1.4.105', base='1.4.104',
        cause='GeneralBossValues c109 parses only empty string as an empty list; (None) is a literal action path.',
        client_error=dict(code=8100, missing_asset='(None).action.dsl.amf3.deflate', resource_version='1.4.104'),
        archive=integrity, changes=changes, affected_rounds=[2,3,4,5,8,13,17,20,27],
        general_boss_before_sha256=sha(before), general_boss_after_sha256=sha(after),
        custom_general_rows_checked=len(paths), pre_action_references=references, event_chain_checks=checks,
        all_other_resources_unchanged=True, floor_configuration_unchanged=True, hp_audit_unchanged=True,
        generator_reproduces_repair=True, source_manifest_preserved=True, apk_changed=False,
        committed=False, pushed=False, cloud_deployed=False, android_retest_passed=False)
    savej(AUDIT/'manifest.json', manifest)
    savej(AUDIT/'manifest-entry.json', entry)
    savej(AUDIT/'resource-inventory.json', inventory)
    savej(AUDIT/'pre-action-rows.json', paths)
    savej(AUDIT/'report.json', report)
    manifest_rel = 'assets/asset-patch/manifest.json'
    payloads = {
        'assets/asset-patch/active/'+NAME: archive,
        'assets/asset-patch/'+MEMBER: after,
        manifest_rel: (AUDIT/'manifest.json').read_bytes(),
    }
    preimages = {rel: (RUNTIME/rel).read_bytes() if (RUNTIME/rel).exists() else None for rel in payloads}
    assert preimages['assets/asset-patch/active/'+NAME] is None
    assert preimages[manifest_rel] == manifest_before
    assert preimages['assets/asset-patch/'+MEMBER] == before
    for rel in payloads:
        resolved = (RUNTIME/rel).resolve()
        assert resolved.is_relative_to(RUNTIME.resolve()) and not resolved.is_relative_to(cdn)
    plan = dict(status='preflight_passed', target=str(RUNTIME),
        mode='authorized_uncommitted_local_test_repair',
        files=[dict(path=rel, size=len(raw), sha256=sha(raw),
                    before_sha256=sha(preimages[rel]) if preimages[rel] is not None else None)
               for rel, raw in payloads.items()])
    savej(AUDIT/'local-sync-plan.json', plan)
    if apply:
        backup = RUNTIME/'.codex-backups'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-abyss-pre-action-repair')
        assert not backup.exists() and backup.resolve().is_relative_to(RUNTIME.resolve())
        backup.mkdir(parents=True)
        for rel, raw in preimages.items():
            if raw is not None: save(backup/rel, raw)
        savej(backup/'sync-plan.json', plan)
        written = []
        try:
            for rel, raw in payloads.items():
                target = RUNTIME/rel
                assert (target.read_bytes() if target.exists() else None) == preimages[rel], ('runtime drift', rel)
                # Atomic replacement keeps hot manifest readers from seeing partial JSON.
                temp = target.with_name(target.name+'.abyss-repair.tmp')
                assert not temp.exists()
                save(temp, raw)
                written.append(rel)
                os.replace(temp, target)
                assert target.read_bytes() == raw
        except BaseException:
            for rel in reversed(written):
                target = (RUNTIME/rel).resolve()
                assert target.is_relative_to(RUNTIME.resolve()) and not target.is_relative_to(cdn)
                if preimages[rel] is None: target.unlink(missing_ok=True)
                else: save(target, preimages[rel])
            raise
        plan.update(status='local_test_repair_synced', backup=str(backup))
        savej(AUDIT/'local-sync-report.json', plan)
    print(json.dumps(dict(status=plan['status'], archive=integrity, changed_rows=len(changes),
        backup=plan.get('backup')), ensure_ascii=False))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--work', type=Path, required=True)
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    main(args.work, args.apply)
