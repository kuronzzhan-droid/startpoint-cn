"""只读当前存档资源，生成两卡池服务端/客户端同步候选。"""
import argparse
import hashlib
import json
from pathlib import Path

import wf_content_gacha as rules
import wf_gacha_odds_sync as odds
import wf_mod_tool as core
from wf_enhancement_policy import OfficialBaseline


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def build(repo, output):
    repo, output = Path(repo).resolve(), Path(output).resolve()
    if not output.is_relative_to(repo / "work/codex_out"):
        raise ValueError("gacha candidate must remain in ignored output workspace")
    profile = json.loads((repo / "mod-tools/profiles.json").read_bytes())["profiles"]["cn"]
    store = Path(profile["store"])
    if not store.is_absolute():
        store = repo / store
    baseline = OfficialBaseline(repo / ".cdn/cn", write_cache=False)
    logical = core.CHARACTER_LOGICAL
    h = core.sha1_path(logical)
    official_raw = baseline.get("common", h[:2] + "/" + h[2:])
    if official_raw is None:
        raise ValueError("official character baseline missing")
    official = core.read_orderedmap_file_from_bytes(official_raw)
    current_raw = core.table_path(store, logical).read_bytes()
    current = core.read_orderedmap_file_from_bytes(current_raw)
    custom = ({int(cid) for cid in current if cid not in official} | {149988}) - rules.EARLY_CANARIES
    for cid in custom - {149988}:
        if core.read_csv_lines(current[str(cid)])[0][2] != "5":
            raise ValueError(f"custom character {cid} is not five-star")
    server_path = repo / "assets/gacha.json"
    server_raw = server_path.read_bytes()
    updated = rules.build(json.loads(server_raw), custom)
    cdn_path = core.table_path(store, "master/gacha/gacha.orderedmap")
    cdn_raw = cdn_path.read_bytes()
    cdn = {k: core.read_csv_lines(v)[0] for k, v in core.read_orderedmap_file_from_bytes(cdn_raw).items()}
    files = {("server", "gacha.json"): (server_raw, json.dumps(updated, ensure_ascii=False, separators=(",", ":")).encode())}
    claimed_ids = set()
    for pid in ("990001", "990002"):
        selected = updated[pid]
        row = cdn[pid]
        definitions = [(row[odds.COL_RARITY_ODDS_ID], [f"{rank},{rate}" for rank, rate in
                         zip((5, 4, 3), selected["rankRates"]["normal"])])]
        for group, rank in odds.GROUP_RANK.items():
            lines = []
            for entry in selected["pool"][group]:
                flags = ",".join("true" if entry.get(f) else "false" for f in odds.BOOL_FIELDS)
                lines.append(f"{entry['id']},{rank},{entry['odds']},{flags}")
            definitions.append((row[odds.COL_CHARACTER_ODDS_ID[rank]], lines))
        for string_id, lines in definitions:
            if string_id in claimed_ids:
                raise ValueError("two target pools share an odds table")
            claimed_ids.add(string_id)
            logical = odds._odds_path(string_id)
            path = core.table_path(store, logical)
            odds.assert_roundtrip(path, logical)
            outer, _, _ = odds.read_nested(path, logical)
            raw = odds.build_nested(outer, [str(i) for i in range(len(lines))], lines)
            files["common", logical] = (path.read_bytes(), raw)
    for pid, row in cdn.items():
        if pid not in ("990001", "990002") and claimed_ids.intersection(
                row[i] for i in (odds.COL_RARITY_ODDS_ID, *odds.COL_CHARACTER_ODDS_ID.values())):
            raise ValueError(f"odds tables are shared with unrelated pool {pid}")
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for (tier, logical), (before, after) in files.items():
        path = output / "roots" / tier / logical
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(after)
        records.append(dict(root=tier, logical_path=logical, before_sha256=digest(before),
                            after_sha256=digest(after), size=len(after), changed=before != after))
    logical = "master/character/character_text.orderedmap"
    text = core.read_orderedmap_file(core.table_path(store, logical), logical).text_rows()
    names = {cid: core.read_csv_lines(text[str(cid)])[0][0] for cid in custom if str(cid) in text}
    names[149988] = "盾牌座"
    report = dict(writes_live=False, custom_roster=[dict(id=cid, name=names[cid], overall_percent=1)
                                                  for cid in sorted(custom)],
                  excluded_test_characters=sorted(rules.EARLY_CANARIES),
                  abyss_minibosses=sorted(rules.MINIBOSSES), abyss_new_zero=sorted(rules.NEW_ABYSS_ZERO),
                  abyss_rank_per_mille=[405, 245, 350], racing_rank_per_mille=[950, 20, 30],
                  character_source_sha256=digest(current_raw), gacha_pointer_source_sha256=digest(cdn_raw),
                  files=records)
    (output / "candidate.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = build(args.repo, args.output)
    print(json.dumps(dict(custom_count=len(report["custom_roster"]), files=len(report["files"]), writes_live=False)))
