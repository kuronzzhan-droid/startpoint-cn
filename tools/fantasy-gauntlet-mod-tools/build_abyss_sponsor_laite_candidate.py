"""Assemble the finalized element-channel tower, sponsor and Laite test candidate.

Requires finalized seed-46454236 outputs and verified .105/.106 donors.
The shared manifest and held entry-condition resources remain untouched. The
candidate lives below active/candidates because the runtime scans flat ZIPs.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[2]
BASE, VERSION, SEED = "1.4.103", "1.4.104", 46454236
PATCH_ID = "abyss-element-sponsor-laite-1.4.104-test"
NAME = f"pinball-{BASE}-{VERSION}-1-abyss-element-sponsor-laite-test.zip"
AUDIT = ROOT / "assets/asset-patch/audit" / PATCH_ID
HELD_MEMBER = "production/upload/d6/88e4a5f7d84cc422357cc8acbdb72817bc8670"
DONORS = {
    "pinball-1.4.104-1.4.105-1-sponsor-special-thanks-cn.zip":
        "f0d52b2c2ae2c3ff9bd7264a9e9c6fc07dce0baea08a7986257567482d5870f1",
    "pinball-1.4.105-1.4.106-1-abyss-laite-exchange.zip":
        "0cfac3b0e130b133d7d25fa4c455a8c840998f8e208fb512ea8b07f290b6db5e",
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def readj(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    assert path.read_bytes() == raw, path


def savej(path, value):
    save(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def semantic_table_deltas(before, after, p, logical):
    def decode(raw):
        try:
            children = p.rawmap(raw)
        except Exception:
            return p.csvrows(raw)
        return {key: decode(value) for key, value in children.items()}
    changes = []
    def visit(left, right, path):
        if left == right: return
        if isinstance(left, dict) and isinstance(right, dict):
            for key in sorted(set(left) | set(right)):
                visit(left.get(key), right.get(key), path + [key])
        else:
            scoped = any(str(k).startswith(("mod_rogue_", "700099")) for k in path)
            # Native wind-sphere private bundle IDs from the pinned HP audit.
            scoped = scoped or (logical.endswith("wind_sphere_micronucleus.orderedmap")
                                and path[-1] in {"2010280101", "2010280102", "2010280103"})
            assert scoped, ("unrelated master row changed", logical, path)
            changes.append(path)
    visit(decode(before), decode(after), [])
    return changes


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", type=Path, required=True)
    args = ap.parse_args()
    work = args.work.resolve()
    elements = readj(work / "element-channel-receipt.json")
    assert elements["schema"] == "abyss-element-channel-finalization/v1"
    assert elements["seed"] == SEED and elements["rounds"] == 30
    assert elements["generated_element_dsl_removed"]
    assert all(2 <= len(row["final_banned"]) <= 5 for row in elements["rows"])
    cdn = (ROOT / ".cdn").resolve()
    assert not work.is_relative_to(cdn)
    server = work / "candidate-server"
    manifest_path = ROOT / "assets/asset-patch/manifest.json"
    original_manifest = manifest_path.read_bytes()
    assert original_manifest == (work / "source-manifest-before.json").read_bytes()
    protected = [manifest_path, ROOT / "LOCAL-HOLD-entry-condition-message.md",
                 ROOT / "assets/asset-patch" / HELD_MEMBER,
                 ROOT / "assets/asset-patch/active/pinball-1.4.103-1.4.104-1-entry-condition-message-cn.zip"]
    protected += list((ROOT / "assets/asset-patch/audit/entry-condition-message-1.4.104").rglob("*"))
    protected += [ROOT / "tools/lens-integration/update_entry_condition_message.py"]
    protected_hashes = {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in protected if p.is_file()}
    # Read-only Git provenance; callers must record the workspace status first.
    committed = subprocess.check_output(["git", "show", "HEAD:assets/asset-patch/manifest.json"], cwd=ROOT)
    manifest = json.loads(committed)
    assert manifest["cdn_version"] == BASE
    assert readj(server / "assets/asset-patch/manifest.json") == manifest, "candidate projection must start at .103"
    assert readj(work / "source-state.json")["seed"] == SEED
    os.environ.update(WF_SERVER_DIR=str(server), WF_CDN_DIR=str(work / "pristine-read-links/cn"),
                      WF_TARGET_STORE=str(server / "assets/asset-patch/production/upload"), WF_LIVE_CDN="1")
    import wf_live_cdn as live
    import wf_rogue_build as rb
    import wf_rogue_element_channel as channel
    import publish_sponsor_special_thanks as sponsor
    import publish_abyss_laite_exchange as laite
    import wf_assets
    import wf_dsl
    from PIL import Image
    p = sponsor.p
    assert live.describe()["tail"] == BASE

    payloads, resources, table_deltas = {}, [], {}
    for item in readj(work / "tower-resource-inventory.json"):
        raw = (server / "assets/asset-patch" / item["member"]).read_bytes()
        assert sha(raw) == item["sha256"]
        if item['logical'] == 'master/battle/boss/general_boss.orderedmap':
            def validate_pre_actions(data, path=()):
                try: children = p.rawmap(data)
                except Exception:
                    if path[0].startswith('mod_rogue_'):
                        for row in p.csvrows(data):
                            channel.pre_action_programs(row[109])
                else:
                    for key, value in children.items():
                        validate_pre_actions(value, path + (key,))
            validate_pre_actions(raw)
        try:
            before = live.read_logical(item["logical"]).data
        except live.LiveCdnEntryMissing:
            before = None
        entry = dict(item, source="abyss", before_sha256=sha(before) if before else None,
                     included=raw != before)
        resources.append(entry)
        if before is not None and item["logical"].endswith(".orderedmap"):
            old, new = p.rawmap(before), p.rawmap(raw)
            table_deltas[item["logical"]] = {
                "added": [k for k in new if k not in old],
                "removed": [k for k in old if k not in new],
                "changed": [k for k in old if k in new and old[k] != new[k]],
                "semantic_changed_paths": semantic_table_deltas(before, raw, p, item["logical"]),
            }
        if entry["included"]:
            payloads[item["member"]] = raw

    degree_before = live.read_logical(sponsor.DEGREE_LOGICAL).data
    assert sha(degree_before) == sponsor.DEGREE_SHA
    formal = (ROOT / sponsor.ART_REL).read_bytes()
    assert sha(formal) == sponsor.ART_SHA
    expected = {
        sponsor.DEGREE_LOGICAL: sponsor.build_degree(degree_before),
        sponsor.IMAGE_LOGICAL: wf_assets.png_encode(formal),
        laite.ODDS: laite.patch_odds(live.read_logical(laite.ODDS).data),
        laite.NOTE: laite.patch_notice(live.read_logical(laite.NOTE).data),
    }
    donor_members = {}
    for name, digest in DONORS.items():
        raw = (ROOT / "assets/asset-patch/active" / name).read_bytes()
        assert sha(raw) == digest, name
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            assert z.testzip() is None and len(z.namelist()) == 2
            for member in z.namelist():
                assert member not in donor_members
                donor_members[member] = z.read(member)
    assert len(donor_members) == len(expected) == 4
    for logical, raw in expected.items():
        member = p.member(("common", p.hrel(logical)))
        assert donor_members[member] == raw and member not in payloads
        payloads[member] = raw
        resources.append(dict(logical=logical, member=member, size=len(raw), sha256=sha(raw),
                              source="sponsor" if logical.startswith(("master/degree/", "dynamic/degree/")) else "laite",
                              included=True))
    assert HELD_MEMBER not in payloads
    categories = p.rawmap(live.read_logical("master/degree/degree_category.orderedmap").data)
    assert p.csvrows(categories["8"]) == [["etc", "其他"]]
    assert live.read_logical("dynamic/degree/background.png").data
    frames = wf_dsl.parse_dsl(zlib.decompress(live.read_logical("item/sprite_sheet.atlas.amf3.deflate").data, -15))["tree"]
    icon = [f for f in frames if f.get("n") == "item/etc/degree"]
    assert len(icon) == 1
    with Image.open(io.BytesIO(wf_assets.png_decode_stored(live.read_logical("item/sprite_sheet.png").data))) as image:
        image.load()
        f = icon[0]
        assert 0 <= f["x"] < f["x"] + f["w"] <= image.width
        assert 0 <= f["y"] < f["y"] + f["h"] <= image.height

    release_files, server_deltas = [], {}
    for rel in (*laite.SERVER_FILES, "assets/degree_sponsor.json", "src/lib/content-master.ts", "out/lib/content-master.js",
                "assets/rush_event_quest.json", "assets/rush_event_quest_folder.json"):
        current = (ROOT / rel).read_bytes()
        if rel in laite.SERVER_FILES:
            before = subprocess.check_output(["git", "show", f"HEAD:{rel}"], cwd=ROOT)
            raw = laite.patch_server(before)
            assert json.loads(raw) == json.loads(current), f"unrelated local gacha edits: {rel}"
        elif "rush_event_quest" in rel:
            generated = (server / "server" / rel).read_bytes()
            old, new = json.loads(current), json.loads(generated)
            keys = [k for k in set(old) | set(new) if old.get(k) != new.get(k)]
            assert all(k.startswith("700099") for k in keys), (rel, keys)
            server_deltas[rel] = keys
            raw = current if not keys else generated
        else:
            raw = current
        save(server / rel, raw)
        release_files.append(dict(path=rel, sha256=sha(raw), size=len(raw),
                                  changed_from_working_source=raw != current))
    definitions = readj(server / "assets/degree_sponsor.json")
    assert definitions == {sponsor.DEGREE_ID: sponsor.DEFINITION}
    effective = laite.effective_gacha()
    pool = readj(server / "assets/gacha_cnmod.json")["990001"]
    assert effective == pool == readj(server / "assets/gacha.json")["990001"]
    entries = [r for bucket in pool["pool"].values() for r in bucket]
    exchange = [r for r in entries if r["isExchangeable"]]
    assert len(exchange) == 45 and sum(r["rank"] == 5 for r in exchange) == 38
    laite_row = next(r for r in entries if r["id"] == 131182)
    assert laite_row["isExchangeable"] and laite_row["odds"] == 5212 and not laite_row["isRateUp"]

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for member, raw in sorted(payloads.items()):
            assert member.startswith("production/upload/") and ".." not in Path(member).parts
            info = zipfile.ZipInfo(member, (2026, 9, 9, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, raw)
    archive = buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        assert z.testzip() is None and len(z.namelist()) == len(payloads)
        assert {m: z.read(m) for m in z.namelist()} == payloads
        sponsor.verify_degree(degree_before, z.read(p.member(("common", p.hrel(sponsor.DEGREE_LOGICAL)))))
        sponsor.verify_stored_png(z.read(p.member(("common", p.hrel(sponsor.IMAGE_LOGICAL)))), formal)
    dest = ROOT / "assets/asset-patch/active/candidates" / NAME
    assert not dest.resolve().is_relative_to(cdn)
    assert not dest.exists() or dest.read_bytes() == archive
    save(dest, archive)
    integrity = dict(name=NAME, size=len(archive), sha256=sha(archive), members=len(payloads), files=sorted(payloads))
    entry = dict(id=PATCH_ID, type="patch", name="深渊属性封锁、特别鸣谢称号与莱特兑换（本地测试）",
                 description="保留种子46454236的30层随机结果，每关至少封锁两属性、最多五属性；合入永久赞助称号9900012及雷属性莱特131182兑换资格。",
                 version=VERSION, depends_on=BASE, enabled=True, archive=NAME, archive_size=len(archive),
                 chain=[NAME], archive_integrity=[integrity], files=sorted(payloads), created_at="2026-09-10",
                 local_test_only=True, required_client_capability="cn.rules.QuestElementResistance/v1",
                 audit=dict(directory=str(AUDIT.relative_to(ROOT)).replace("\\", "/"), report="report.json"))
    manifest["patches"].append(entry)
    manifest["cdn_version"] = VERSION
    assert manifest["patches"][:-1] == json.loads(committed)["patches"]
    assert not any(x["id"] in {"entry-condition-message-1.4.104", "sponsor-special-thanks-1.4.105", "abyss-laite-exchange-1.4.106"} for x in manifest["patches"])
    projection_zip = server / "assets/asset-patch/active" / NAME
    assert not projection_zip.exists()
    os.link(dest, projection_zip)
    savej(server / "assets/asset-patch/manifest.json", manifest)
    for member, raw in payloads.items():
        save(server / "assets/asset-patch" / member, raw)
    live._CACHE.clear()
    view = live.describe()
    assert view["tail"] == VERSION and set(view["platform_tails"].values()) == {VERSION}
    for item in resources:
        result = live.read_logical(item["logical"])
        assert sha(result.data) == item["sha256"], item["logical"]
        if item["included"]:
            assert result.archive.name == NAME and result.root == "common"
    chains = rb.validate_event_chain("700099")
    assert len(chains) == 31 and all(x["ok"] for x in chains), chains
    assert all(sha((ROOT / rel).read_bytes()) == digest for rel, digest in protected_hashes.items())
    savej(AUDIT / "manifest.json", manifest)
    savej(AUDIT / "manifest-entry.json", entry)
    savej(AUDIT / "resource-inventory.json", resources)
    savej(AUDIT / "table-deltas.json", table_deltas)
    savej(AUDIT / "release-files.json", release_files)
    savej(AUDIT / "candidate-chain-check.json", chains)
    for name in ("hp-audit.json", "hp-report.md", "floor-details.json", "signature-validation.json", "baseline-inventory.json", "source-state.json", "element-channel-receipt.json"):
        save(AUDIT / name, (work / name).read_bytes())
    report = dict(status="isolated_local_candidate_verified_not_activated", base=BASE, version=VERSION,
                  archive=integrity, candidate_archive=str(dest.relative_to(ROOT)).replace("\\", "/"),
                  abyss=dict(seed=SEED, rounds=30, difficulty="hell", minimum_element_bans=2, maximum_element_bans=5,
                             channel="quest_initial_conditions", generated_element_dsl_removed=True,
                             matches_reviewed_preview=True, hp=readj(work / "hp-audit.json")["summary"],
                             inventory_resources=len(resources)-4, changed_resources=len(payloads)-4),
                  sponsor=dict(degree_id=int(sponsor.DEGREE_ID), definition=sponsor.DEFINITION,
                               client_fields=sponsor.client_fields(), artwork_sha256=sponsor.ART_SHA,
                               preserved_rows=len(p.rawmap(degree_before)), stored_png_strict_verified=True,
                               reused_preloaded_icon=icon[0], mail=dict(type=13, type_id=9900012, number=0, ownership="permanent")),
                  laite=dict(id=131182, row=laite_row, exchangeable_5star=38, exchangeable_4star=7,
                             effective_accessor_checked=True, winning_source="assets/gacha_cnmod.json"),
                  superseded_independent_donors=DONORS, preserved_local_hold_sha256=protected_hashes,
                  candidate_effective_view=view, server_quest_changed_keys=server_deltas,
                  validation=dict(zip_readback=True, all_resource_hashes=True, android_ios_tail_equal=True,
                                  event_chain_entries=len(chains), generated_dsl=readj(work / "signature-validation.json")),
                  source_manifest_unchanged=True, source_projection=str(server), device_tested=False,
                  runtime_delivered=False, real_player_mails_sent=0, committed=False, pushed=False)
    savej(AUDIT / "report.json", report)
    print(json.dumps(dict(status=report["status"], archive=integrity, server_deltas=server_deltas,
                          table_deltas=table_deltas), ensure_ascii=True))


if __name__ == "__main__":
    main()
