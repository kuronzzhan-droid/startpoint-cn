"""十五角色候选的窄范围装配；不发布，不改源包、live或服务器。"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import wf_character_pack as pack
import wf_client_legality as legality
import wf_describe
import wf_mod_tool as core
from wf_character_revision import RevisionCandidate
from wf_miniboss_kits import build
from wf_miniboss_roster import BY_ID
from wf_miniboss_text import ACTIVE, panel_rows
import wf_miniboss_stats as stats

ABILITY = "master/ability/ability.orderedmap"
LEADER = "master/ability/leader_ability.orderedmap"
STRINGS = "master/string/custom_ability_string.orderedmap"


def _digest(raw):
    return hashlib.sha256(raw).hexdigest()


def _store(repo):
    value = Path(json.loads((repo / "mod-tools/profiles.json").read_bytes())["profiles"]["cn"]["store"])
    return value if value.is_absolute() else repo / value


def prepare(repo, destination, cid):
    """复制源包后全表刷新到当前live；旧自有行不重放，留哈希证据。"""
    repo, destination = repo.resolve(), destination.resolve()
    char = BY_ID[str(cid)]
    allowed = repo / "work/character_packs/miniboss-rework-20260912"
    if not destination.is_relative_to(allowed) or destination == allowed or destination.exists():
        raise ValueError("new candidate must be an absent child of the assigned output root")
    source = repo / "work/character_packs" / char.package_id
    if any(p.is_symlink() or getattr(p, "is_junction", lambda: False)()
           for p in [source, *source.parents, *source.rglob("*")]):
        raise ValueError("source package contains a reparse point")
    destination.mkdir(parents=True)
    shutil.copy2(source / "workspace.json", destination / "workspace.json")
    shutil.copytree(source / "package", destination / "package")
    evidence = destination / "evidence"
    evidence.mkdir(exist_ok=True)
    manifest_path = destination / "package/manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    before_manifest = _digest(manifest_path.read_bytes())
    refreshed = []
    store = _store(repo)
    for tier, entries in manifest["roots"].items():
        for entry in entries:
            logical = entry["logical_path"]
            path = destination / "package/roots" / tier / logical
            previous = path.read_bytes()
            if _digest(previous) != entry["sha256"] or len(previous) != entry["size"]:
                raise ValueError(f"source package internal hash mismatch: {logical}")
            if tier == "common" and logical.startswith("master/"):
                raw = core.table_path(store, logical).read_bytes()
            elif tier == "server":
                raw = (repo / "assets" / logical).read_bytes()
            else:
                continue
            path.write_bytes(raw)
            entry.update(sha256=_digest(raw), size=len(raw))
            refreshed.append({"root": tier, "logical_path": logical,
                              "before": _digest(previous), "live_base": _digest(raw)})
    manifest_path.write_bytes(pack.canonical_manifest_bytes(manifest))
    (evidence / "live-base-refresh.json").write_text(json.dumps({
        "source_package": str(source / "package"), "source_manifest_sha256": before_manifest,
        "writes_live": False, "installed_ownership_not_rebound": True,
        "full_tables_refreshed": refreshed,
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def _flat(raw):
    return {key: core.read_csv_lines(value) for key, value in core.read_orderedmap_file_from_bytes(raw).items()}


def _leader_text(rows):
    lines = []
    for row in rows:
        if row[3] == "0" and row[45] == "722":
            lines.append("强化弹射替换为角色专属形态。")
            continue
        line = wf_describe.describe_line(row, "leader_ability")
        for a, b in {"Direct伤害": "直接攻击伤害", "Frozen": "冻结",
                     "Ease治疗": "获得的治疗量", "Flying": "浮游", "贯通": "贯穿",
                     "2号位技能槽": "技能槽上限"}.items():
            line = line.replace(a, b)
        lines.append(line + "。")
    return "\n".join(lines)


def assemble(repo, workspace, cid, *, apply=False):
    char = BY_ID[str(cid)]
    candidate = RevisionCandidate(repo, workspace, character_id=char.cid, code_name=char.code,
                                  package_version="2.0.0", snapshot_key="miniboss_rework_20260912")
    source_leader = _flat(candidate.read("common", LEADER))[char.cid]
    abilities, leaders, metadata = build(char.cid, source_leader=source_leader)
    text = panel_rows(char.cid, abilities, leaders[char.cid], _leader_text(leaders[char.cid]))
    for kind, mapping in (("ability", abilities), ("leader_ability", leaders)):
        for key, rows in mapping.items():
            for index, row in enumerate(rows):
                problems = legality.client_legality_problems(kind, row)
                if problems:
                    raise ValueError(f"{kind}:{key}:{index}: {problems}")
    candidate.splice(ABILITY, abilities)
    candidate.splice(LEADER, leaders)
    candidate.splice(STRINGS, text)
    candidate.splice(core.STATUS_LOGICAL,
                     {char.cid: stats.status_row(char.cid, candidate.official(core.STATUS_LOGICAL))},
                     codec="raw_outer")
    raw = core.read_orderedmap_raw_rows_from_bytes(candidate.read("common", core.ACTION_SKILL_LOGICAL))
    actions = core.decode_action_skill_row(raw.rows[raw.keys.index(char.code)])
    for _, row in actions:
        row[1] = ACTIVE[char.cid]
    candidate.splice(core.ACTION_SKILL_LOGICAL, {char.code: core.encode_action_skill_row(actions)}, codec="action_nested")
    logical = "master/character/character_text.orderedmap"
    character_text = _flat(candidate.read("common", logical))[char.cid]
    character_text[0][5] = character_text[0][7] = ACTIVE[char.cid]
    candidate.splice(logical, {char.cid: character_text})
    candidate.server_character_row("cdndata/character_text.json", character_text)
    candidate.manifest["required_capabilities"] = sorted(set(candidate.manifest.get("required_capabilities", []))
                                                         | {"panel-description-override-v2"})
    metadata.update(only_assigned_character_rows=True, requires_new_apk=False,
                    base_stats=stats.metadata(char.cid),
                    source_skill_names_preserved=True, main_marker_preserved=True,
                    protected_assets="portraits, pixels, audio, private conditions, multiballs and all DSL bytes",
                    runtime_acceptance="pending user in-game review")
    return candidate.finish(metadata, apply=apply)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--character-id", choices=BY_ID, required=True)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.prepare:
        prepare(args.repo_root, args.workspace, args.character_id)
    report = assemble(args.repo_root, args.workspace, args.character_id, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
