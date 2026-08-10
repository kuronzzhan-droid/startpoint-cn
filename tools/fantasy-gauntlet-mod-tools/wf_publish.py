#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WF mod 发布器:把改动的数据表打成客户端增量包(diff zip),经 asset-patch 下发。

原理(与官方增量更新同构):
  客户端 POST /get_path 报当前 res_ver → 服务端返回启用的 asset-patch
  pinball-<from>-<to>-N-<tag>.zip 列表 → 客户端下载高于自己版本的包,
  解包 production/upload/<xx>/<hash> 覆盖本地 → res_ver 升级。
  因此:把改好的表按同样结构打包、版本号 +0.0.1,客户端重启即自动拉取。
  (服务端 buildDiffList 每次请求动态扫描 active,放入 zip 并登记 manifest 即生效。)

用法:
  python mod-tools/wf_publish.py                 # 发布 pending 列表里的文件
  python mod-tools/wf_publish.py --tables ability,character_status
  python mod-tools/wf_publish.py --list          # 只看将发布什么/版本推进
注意:CN 表含觉醒列(col3/4 awake_kind),打包为原样字节复制,不做重编码。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_mod_tool as core  # noqa: E402
import wf_final_state_guard as final_state_guard  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# Mode15 的工具和服务端是两个独立目录。优先使用新版四级解析链，
# profiles.json 已显式固定到 isolated-server，避免回落到共享项目。
SERVER_ROOT = core.resolve_server_dir()
CDN_ROOT = (
    Path(os.environ["WF_CDN_DIR"])
    if os.environ.get("WF_CDN_DIR")
    else core.resolve_cdn_root_lax()
)
CDN_DIFF = CDN_ROOT / "archive-common-diff"
ACTIVE_PATCH = SERVER_ROOT / "assets" / "asset-patch" / "active"
PATCH_MANIFEST = SERVER_ROOT / "assets" / "asset-patch" / "manifest.json"
WORK = Path(__file__).resolve().parent / "work"
PENDING = WORK / "sync_pending.json"
CHANGELOG = WORK / "changelog.jsonl"
CHANGELOG_MD = WORK / "changelog.md"
REQUIRED_KEYS_CONTRACT = Path(__file__).resolve().parent / "publish_required_keys.json"


def stamp_changelog(version: str) -> int:
    """把日志里所有未发布(version=None)的条目标记为本次版本,并渲染 changelog.md。"""
    if not CHANGELOG.exists():
        return 0
    entries, n = [], 0
    for line in CHANGELOG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("version") is None:
            e["version"] = version
            n += 1
        entries.append(e)
    CHANGELOG.write_text(
        "\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n", encoding="utf-8")
    md = ["# WF Mod 改动日志", "",
          "| 时间 | 表 | 键 | 改动 | 发布版本 | 备份(回溯用) |",
          "|---|---|---|---|---|---|"]
    for e in reversed(entries):
        keys = ",".join(e.get("keys") or []) or "-"
        summ = (e.get("summary") or "").replace("\n", " / ").replace("|", "/")
        bak = Path(e["backup"]).name if e.get("backup") else "-"
        md.append(f"| {e.get('ts','')} | {e.get('table','')} | {keys} | {summ} | {e.get('version') or '(未发布)'} | {bak} |")
    CHANGELOG_MD.write_text("\n".join(md) + "\n", encoding="utf-8")
    return n

TABLE_ALIASES = {
    "ability": core.ABILITY_LOGICAL,
    "character": core.CHARACTER_LOGICAL,
    "character_status": core.STATUS_LOGICAL,
    "leader_ability": "master/ability/leader_ability.orderedmap",
    "ability_soul": "master/ability/ability_soul.orderedmap",
    "character_awake_status": "master/character/character_awake_status.orderedmap",
    "action_skill": "master/skill/action_skill.orderedmap",
    "assist_yakumono": "master/battle/assist/assist_yakumono.orderedmap",
    "power_flip_action": "master/skill/power_flip_action.orderedmap",
    "weapon_ability": "master/equipment_enhancement/equipment_enhancement_ability.orderedmap",
    "character_text": "master/character/character_text.orderedmap",
    "character_speech": "master/character/character_speech.orderedmap",
    "skill_preview_character": "master/skill_preview/skill_preview_character.orderedmap",
    "mana_board2_open_condition": "master/mana_board/mana_board2_open_condition.orderedmap",
    "upskill": "master/mana_board/upskill.orderedmap",
    "character_stance_detail": "master/stance_detail/character_stance_detail.orderedmap",
    "character_image": "master/generated/character_image.orderedmap",
    "full_shot_image_attribute": "master/character/full_shot_image_attribute.orderedmap",
    "mana_board": "master/generated/mana_board.orderedmap",
    "mana_node": "master/mana_board/mana_node.orderedmap",
    "character_gacha_sound": "master/character/character_gacha_sound.orderedmap",
    # --- 特殊效果(固有状态)+ 商店 ---
    "unique_condition": "master/character/unique_condition.orderedmap",
    "custom_ability_string": "master/string/custom_ability_string.orderedmap",
    "boss_coin_shop": "master/shop/boss_coin_shop.orderedmap",
    "boss_coin_shop_category": "master/shop/boss_coin_shop_category.orderedmap",
    "item": "master/item/item.orderedmap",
    "event_item_shop": "master/shop/event_item_shop.orderedmap",
    "general_shop": "master/shop/general_shop.orderedmap",
    "additional_reward": "master/reward/event/additional_reward.orderedmap",
    "trimmed_image": "master/generated/trimmed_image.orderedmap",
    # --- boss 战 / 副本 / 连战(roguelike boss rush 方案用,见 docs/boss连战roguelike方案.md) ---
    "general_boss": "master/battle/boss/general_boss.orderedmap",
    "general_boss_state": "master/battle/boss/general_boss_state.orderedmap",
    "general_boss_variable": "master/battle/boss/general_boss_variable.orderedmap",
    "boss_level": "master/battle/boss/boss_level.orderedmap",
    "standard_boss": "master/battle/boss/standard_boss.orderedmap",
    "general_zako": "master/battle/zako/general_zako.orderedmap",
    "zako_level": "master/battle/zako/zako_level.orderedmap",
    "zone": "master/battle/zone.orderedmap",
    "field_data": "master/battle/field_data.orderedmap",
    "field": "master/battle/field.orderedmap",
    "boss_battle_quest": "master/quest/boss_battle_quest.orderedmap",
    # --- activity entry / mixed single + co-op modes ---
    "event_list": "master/quest/event/event_list.orderedmap",
    "event_folder": "master/quest/event/event_folder.orderedmap",
    "event_folder_events": "master/quest/event/event_folder_events.orderedmap",
    "game_system_unlock": "master/game_system_unlock/game_system_unlock.orderedmap",
    "game_system_unlock_condition": "master/game_system_unlock/game_system_unlock_condition.orderedmap",
    "carnival_event": "master/quest/event/carnival_event.orderedmap",
    "carnival_event_quest_folder": "master/quest/event/carnival_event_quest_folder.orderedmap",
    "carnival_event_quest": "master/quest/event/carnival_event_quest.orderedmap",
    "advent_event": "master/quest/event/advent_event.orderedmap",
    "advent_event_quest": "master/quest/event/advent_event_quest.orderedmap",
    "quest_set": "master/quest/quest_set.orderedmap",
    "hard_multi_event": "master/quest/event/hard_multi_event.orderedmap",
    "hard_multi_event_quest": "master/quest/event/hard_multi_event_quest.orderedmap",
    "rush_event": "master/quest/event/rush_event.orderedmap",
    "rush_event_quest_folder": "master/quest/event/rush_event_quest_folder.orderedmap",
    "rush_event_quest": "master/quest/event/rush_event_quest.orderedmap",
    "rush_event_correction": "master/quest/event/rush_event_battle_quest_correction.orderedmap",
    "boss_battle_stage_node": "master/quest/boss_battle_stage_node.orderedmap",
    "rush_event": "master/quest/event/rush_event.orderedmap",
    "rush_event_quest": "master/quest/event/rush_event_quest.orderedmap",
    "rush_event_quest_folder": "master/quest/event/rush_event_quest_folder.orderedmap",
    "rush_event_correction": "master/quest/event/rush_event_battle_quest_correction.orderedmap",
    "event_list": "master/quest/event/event_list.orderedmap",
    "floor": "master/battle/floor.orderedmap",
    "challenge_dungeon_event": "master/quest/event/challenge_dungeon_event.orderedmap",
    "challenge_dungeon_event_quest": "master/quest/event/challenge_dungeon_event_quest.orderedmap",
    "tower_dungeon_event": "master/quest/event/tower_dungeon_event.orderedmap",
    "tower_dungeon_event_quest": "master/quest/event/tower_dungeon_event_quest.orderedmap",
    "switched_action_skill": "master/skill/switched_action_skill.orderedmap",
    # --- EX Boost(EX词条效果/EX强化数值/EX素材定义) ---
    "ex_ability": "master/ex_boost/ex_ability.orderedmap",
    "ex_status": "master/ex_boost/ex_status.orderedmap",
    "ex_boost": "master/ex_boost/ex_boost.orderedmap",
}

VER_RE = re.compile(r"pinball-(\d+\.\d+\.\d+)-(\d+\.\d+\.\d+)-\d+-")


def current_max_version(default: str = "1.4.54") -> str:
    # 三个 diff 目录都要扫:medium:/android: 分包发布也会推进版本号,
    # 只看 common 会把已存在的目标版本再发一遍(客户端已在该版本则不再拉取)。
    best = default
    for sub in ("archive-common-diff", "archive-medium-diff", "archive-android-diff"):
        for f in (CDN_ROOT / sub).glob("*.zip"):
            m = VER_RE.match(f.name)
            if m and _cmp(m.group(2), best) > 0:
                best = m.group(2)
    # 上游服务端(2026-07 起)另有 assets/asset-patch 补丁机制:getEffectiveVersion()
    # 取 max(CDN, 启用的 patch 版本)。若某启用 patch 版本高于 CDN,我们不越过它,
    # 客户端 res_ver 会停在 patch 版,新发的低版本 diff 拉取不到 —— 一并纳入 max。
    manifest = SERVER_ROOT / "assets" / "asset-patch" / "manifest.json"
    try:
        for p in json.loads(manifest.read_text(encoding="utf-8")).get("patches", []):
            v = str(p.get("version", ""))
            if p.get("enabled") and re.fullmatch(r"\d+\.\d+\.\d+", v) and _cmp(v, best) > 0:
                best = v
    except Exception:
        pass
    return best


def _manifest_files(prepared: list[PreparedFile]) -> list[str]:
    roots = {
        "production/upload/": "",
        "production/medium_upload/": "medium:",
        "production/android_upload/": "android:",
    }
    files: list[str] = []
    for entry in prepared:
        match = next(
            (
                (archive_root, label)
                for archive_root, label in roots.items()
                if entry.archive_name.startswith(archive_root)
            ),
            None,
        )
        if match is None:
            raise ValueError(
                "asset-patch contains an unsupported archive root: "
                f"got {entry.archive_name}"
            )
        archive_root, label = match
        files.append(label + entry.archive_name[len(archive_root):])
    return sorted(set(files))


def _register_active_patch(
    output: Path,
    prepared: list[PreparedFile],
    from_ver: str,
    to_ver: str,
) -> None:
    """Atomically register a committed active archive in manifest.json."""
    if output.parent.resolve() != ACTIVE_PATCH.resolve():
        raise ValueError(f"archive is outside active patch directory: {output}")
    try:
        document = json.loads(PATCH_MANIFEST.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise ValueError(f"asset-patch manifest cannot be read: {exc}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("patches"), list):
        raise ValueError("asset-patch manifest has an invalid shape")

    patch_id = f"auto-{to_ver}-{output.stem}"
    entry = {
        "id": patch_id,
        "type": "patch",
        "name": f"Mode15 数据更新 {to_ver}",
        "description": f"由隔离发布器生成的 {from_ver} → {to_ver} 数据补丁。",
        "version": to_ver,
        "depends_on": from_ver,
        "enabled": True,
        "archive": output.name,
        "archive_size": output.stat().st_size,
        "files": _manifest_files(prepared),
        "changes": [f"更新 {len(prepared)} 个客户端数据文件。"],
        "created_at": time.strftime("%Y-%m-%d"),
    }
    patches = [
        patch
        for patch in document["patches"]
        if not (
            isinstance(patch, dict)
            and (
                patch.get("id") == patch_id
                or patch.get("archive") == output.name
            )
        )
    ]
    patches.append(entry)
    document["cdn_version"] = to_ver
    document["patches"] = patches

    PATCH_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(
        prefix=".manifest.", suffix=".tmp", dir=PATCH_MANIFEST.parent
    )
    os.close(handle)
    temporary = Path(temporary_name)
    try:
        temporary.write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        readback = json.loads(temporary.read_text(encoding="utf-8"))
        if readback.get("cdn_version") != to_ver:
            raise ValueError("manifest readback version mismatch")
        registered = [
            patch
            for patch in readback.get("patches", [])
            if isinstance(patch, dict) and patch.get("id") == patch_id
        ]
        if len(registered) != 1:
            raise ValueError("manifest readback registration mismatch")
        os.replace(temporary, PATCH_MANIFEST)
    finally:
        temporary.unlink(missing_ok=True)


def _cmp(a: str, b: str) -> int:
    av = [int(x) for x in a.split(".")]
    bv = [int(x) for x in b.split(".")]
    for x, y in zip(av, bv):
        if x != y:
            return x - y
    return 0


def bump(v: str) -> str:
    p = v.split(".")
    return f"{p[0]}.{p[1]}.{int(p[2]) + 1}"


def collect_files(args) -> list[str]:
    """返回相对 upload 的 'xx/hash' 列表。"""
    rels: list[str] = []
    if args.tables:
        for t in args.tables.split(","):
            t = t.strip()
            logical = TABLE_ALIASES.get(t, t)
            digest = core.sha1_path(logical)
            rels.append(f"{digest[:2]}/{digest[2:]}")
    else:
        try:
            rels = json.loads(PENDING.read_text(encoding="utf-8"))
        except Exception:
            rels = []
    return rels


@dataclass(frozen=True)
class PreparedFile:
    archive_name: str
    payload: bytes
    prefix: str


def _explicit_logicals(tables: str) -> list[str]:
    logicals = [
        TABLE_ALIASES.get(value.strip(), value.strip())
        for value in tables.split(",")
        if value.strip()
    ]
    if not logicals:
        raise ValueError("--tables is empty")
    return logicals


def _relative_for_logical(logical: str) -> str:
    digest = core.sha1_path(logical)
    return f"{digest[:2]}/{digest[2:]}"


def verify_required_keys(store: Path) -> list[tuple[str, int]]:
    """Fail closed when a newer build has dropped protected rows from a full table.

    Incremental archives contain complete OrderedMap files, so publishing a newer
    copy of a table can silently erase rows introduced by an older patch.  This
    contract validates the *final packed store* before every publication, even
    when the affected table is not part of the current --tables selection.
    """
    if not REQUIRED_KEYS_CONTRACT.is_file():
        raise ValueError(
            f"publish regression contract is missing: {REQUIRED_KEYS_CONTRACT}"
        )
    try:
        document = json.loads(
            REQUIRED_KEYS_CONTRACT.read_text(encoding="utf-8-sig")
        )
    except Exception as exc:
        raise ValueError(f"publish regression contract cannot be read: {exc}") from exc
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise ValueError("publish regression contract has an invalid schema")
    tables = document.get("tables")
    if not isinstance(tables, dict) or not tables:
        raise ValueError("publish regression contract contains no tables")

    checked: list[tuple[str, int]] = []
    failures: list[str] = []
    for logical, rule in tables.items():
        if not isinstance(logical, str) or not isinstance(rule, dict):
            failures.append(f"invalid contract rule: {logical!r}")
            continue
        required = rule.get("required_keys")
        if not isinstance(required, list) or not all(
            isinstance(key, str) and key for key in required
        ):
            failures.append(f"invalid required_keys for {logical}")
            continue
        try:
            rows = core.load_table(logical, store).text_rows()
        except Exception as exc:
            failures.append(f"{logical}: cannot load final table ({exc})")
            continue
        missing = [key for key in required if key not in rows]
        if missing:
            failures.append(f"{logical}: missing {','.join(missing)}")
        checked.append((logical, len(required)))
    if failures:
        raise ValueError(
            "final-table regression guard rejected publication: "
            + "; ".join(failures)
        )
    return checked


def _load_snapshot(
    path: Path,
    logicals: list[str],
    store: Path,
    profile_id: str | None,
) -> dict[str, dict[str, object]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"snapshot cannot be read: {type(exc).__name__}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("snapshot root must be an object")
    if set(data) != {"schema_version", "profile_id", "store", "entries"}:
        raise ValueError("snapshot root has an invalid shape")
    if type(data.get("schema_version")) is not int or data["schema_version"] != 1:
        raise ValueError("snapshot schema_version must be integer 1")
    snapshot_profile_id = data.get("profile_id")
    if not isinstance(snapshot_profile_id, str) or snapshot_profile_id != profile_id:
        raise ValueError(
            "snapshot profile mismatch: "
            f"expected={profile_id!r}, actual={snapshot_profile_id!r}"
        )
    snapshot_store = data.get("store")
    if not isinstance(snapshot_store, str):
        raise ValueError("snapshot store must be a path string")
    if Path(snapshot_store).resolve() != store.resolve():
        raise ValueError(
            f"snapshot store mismatch: expected={store.resolve()}, actual={snapshot_store}"
        )
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise ValueError("snapshot entries must be an array")
    if len(set(logicals)) != len(logicals):
        raise ValueError("snapshot --tables allowlist contains duplicates")
    if len(entries) != len(logicals):
        raise ValueError(
            f"snapshot allowlist length mismatch: expected={len(logicals)}, "
            f"actual={len(entries)}"
        )

    expected_keys = {"logical", "relative", "sha256", "size"}
    records: dict[str, dict[str, object]] = {}
    for index, (logical, entry) in enumerate(zip(logicals, entries)):
        if not isinstance(entry, dict) or set(entry) != expected_keys:
            raise ValueError(f"snapshot entry[{index}] has an invalid shape")
        if entry.get("logical") != logical:
            raise ValueError(
                f"snapshot allowlist order mismatch at {index}: "
                f"expected={logical!r}, actual={entry.get('logical')!r}"
            )
        relative = _relative_for_logical(logical)
        if entry.get("relative") != relative:
            raise ValueError(
                f"snapshot relative mismatch for {logical}: "
                f"expected={relative!r}, actual={entry.get('relative')!r}"
            )
        digest = entry.get("sha256")
        if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise ValueError(f"snapshot sha256 is invalid for {logical}")
        size = entry.get("size")
        if type(size) is not int or size < 0:
            raise ValueError(f"snapshot size is invalid for {logical}")
        records[relative] = entry
    return records


def _prepare_files(
    rels: list[str],
    store: Path,
    *,
    strict_explicit: bool,
    snapshot_records: dict[str, dict[str, object]] | None,
) -> tuple[list[PreparedFile], list[str]]:
    group_defs = {
        "": (store, "production/upload"),
        "medium:": (store.parent / "medium_upload", "production/medium_upload"),
        "android:": (store.parent / "android_upload", "production/android_upload"),
    }
    prepared: list[PreparedFile] = []
    skipped: list[str] = []
    for rel in rels:
        prefix = next(
            (value for value in ("medium:", "android:") if rel.startswith(value)),
            "",
        )
        relative = rel[len(prefix):]
        source_root, archive_root = group_defs[prefix]
        source = source_root / relative
        if not source.is_file():
            if strict_explicit:
                raise FileNotFoundError(f"missing explicit publish entry: {rel}")
            skipped.append(rel)
            continue
        payload = source.read_bytes()
        if snapshot_records is not None:
            if prefix:
                raise ValueError("snapshot entries may only target production/upload")
            record = snapshot_records.get(relative)
            if record is None:
                raise ValueError(f"snapshot has no record for {relative}")
            actual_digest = hashlib.sha256(payload).hexdigest()
            if len(payload) != record["size"] or actual_digest != record["sha256"]:
                raise ValueError(
                    f"snapshot bytes mismatch for {relative}: "
                    f"expected size={record['size']} sha256={record['sha256']}, "
                    f"actual size={len(payload)} sha256={actual_digest}"
                )
        prepared.append(
            PreparedFile(
                archive_name=f"{archive_root}/{relative}",
                payload=payload,
                prefix=prefix,
            )
        )
    return prepared, skipped


def _build_archives(
    prepared: list[PreparedFile],
    from_ver: str,
    to_ver: str,
    *,
    layer_placeholders: bool = False,
) -> list[Path]:
    if layer_placeholders:
        raise ValueError(
            "--layer-placeholders is incompatible with asset-patch active workflow"
        )
    outdirs = {"": ACTIVE_PATCH}
    # 纯数字同时兼容当前服务端和上游 dev Catalog 的十六进制后缀约束。
    tag = time.strftime("%m%d%H%M%S")
    staged: list[tuple[Path, Path]] = []
    backups: list[tuple[Path, Path]] = []
    published: list[Path] = []
    try:
        for prefix, outdir in outdirs.items():
            # active 是统一补丁容器；common/medium/android 三层写入同一个 ZIP，
            # 避免同版本同文件名在单目录内互相覆盖。
            files = list(prepared)
            if not files and not layer_placeholders:
                continue
            outdir.mkdir(parents=True, exist_ok=True)
            final = outdir / f"pinball-{from_ver}-{to_ver}-1-{tag}.zip"
            handle, temporary_name = tempfile.mkstemp(
                prefix=f".{final.name}.", suffix=".tmp", dir=outdir
            )
            os.close(handle)
            temporary = Path(temporary_name)
            staged.append((temporary, final))
            if files:
                with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                    for entry in files:
                        archive.writestr(entry.archive_name, entry.payload)
            else:
                # 仅显式启用时为 dev 三层契约补空层；Mode15 默认仍沿用旧发布行为。
                with zipfile.ZipFile(temporary, "w", zipfile.ZIP_STORED) as archive:
                    archive.writestr(".empty", b"\n")
        for _temporary, final in staged:
            if not final.exists():
                continue
            handle, backup_name = tempfile.mkstemp(
                prefix=f".{final.name}.", suffix=".rollback", dir=final.parent
            )
            os.close(handle)
            backup = Path(backup_name)
            backup.unlink()
            os.replace(final, backup)
            backups.append((backup, final))
        for temporary, final in staged:
            os.replace(temporary, final)
            published.append(final)
        for backup, _final in backups:
            try:
                backup.unlink(missing_ok=True)
            except OSError:
                # Publication is already committed. A leftover hidden backup is
                # safer than entering rollback after earlier backups were removed.
                pass
        return list(published)
    except Exception as exc:
        rollback_errors: list[str] = []
        for final in reversed(published):
            try:
                final.unlink(missing_ok=True)
            except OSError as rollback_exc:
                rollback_errors.append(f"remove {final}: {rollback_exc}")
        for backup, final in reversed(backups):
            try:
                os.replace(backup, final)
            except OSError as rollback_exc:
                rollback_errors.append(f"restore {final}: {rollback_exc}")
        for temporary, _final in staged:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        if rollback_errors:
            raise RuntimeError(
                f"archive publish failed ({exc}); rollback failed: "
                + "; ".join(rollback_errors)
            ) from exc
        raise


def committed_archive_size(output: Path) -> int:
    """已提交产物的字节数;独立成函数供测试注入 stat 失败(仅告警路径)。"""
    return output.stat().st_size


def main(argv: list[str] | None = None) -> int:
    global CDN_ROOT, CDN_DIFF

    ap = argparse.ArgumentParser(description="WF mod diff 发布器")
    ap.add_argument("--tables", help="逗号分隔的表别名/逻辑路径(默认用 pending 列表)")
    ap.add_argument(
        "--snapshot",
        type=Path,
        help="校验器生成的严格发布快照(必须与 --tables 同时使用)",
    )
    ap.add_argument("--list", action="store_true", help="只显示将发布的内容,不打包")
    ap.add_argument("--from-ver", help="覆盖起始版本(默认=CDN 现有最高版本)")
    ap.add_argument(
        "--approve-final-state",
        metavar="REASON",
        help="明确批准本次逐行差异；批准内容绑定旧/新 SHA256，不能复用于其他改动",
    )
    ap.add_argument(
        "--cdn-root",
        type=Path,
        help="仅覆盖官方基础版本扫描所用的 .cdn/cn 目录；发布位置始终为 asset-patch/active",
    )
    placeholder_group = ap.add_mutually_exclusive_group()
    placeholder_group.add_argument(
        "--layer-placeholders",
        dest="layer_placeholders",
        action="store_true",
        help="为无内容的 medium/android 层补 .empty 包（适配 dev 三层契约）",
    )
    placeholder_group.add_argument(
        "--no-layer-placeholders",
        dest="layer_placeholders",
        action="store_false",
        help="不生成无内容层占位包（Mode15 默认）",
    )
    catalog_group = ap.add_mutually_exclusive_group()
    catalog_group.add_argument(
        "--dev-catalog",
        dest="dev_catalog",
        action="store_true",
        help="发布成功后生成 dev Catalog/EntityLists",
    )
    catalog_group.add_argument(
        "--no-dev-catalog",
        dest="dev_catalog",
        action="store_false",
        help="不生成 dev Catalog（Mode15 默认）",
    )
    ap.set_defaults(layer_placeholders=False, dev_catalog=False)
    args = ap.parse_args(argv)

    if args.cdn_root is not None:
        CDN_ROOT = args.cdn_root.resolve()
        CDN_DIFF = CDN_ROOT / "archive-common-diff"

    try:
        if args.snapshot is not None and not args.tables:
            raise ValueError("--snapshot must be used with --tables")
        profile = core.resolve_profile()
        # 标准链：WF_TARGET_STORE > profiles.json 激活档案 > 自动探测。
        # 发布位置仍由本项目的 asset-patch/active 定制逻辑负责。
        store_value = core.resolve_active_store(ROOT, profile=profile)
        if not store_value:
            raise ValueError("未找到数据包 store。" + core.TARGET_STORE_HINT)
        store = Path(store_value).resolve()

        guarded_tables = verify_required_keys(store)
        print(
            "防回退校验   : "
            + ", ".join(
                f"{logical}({count} keys)" for logical, count in guarded_tables
            )
        )

        logicals = _explicit_logicals(args.tables) if args.tables else None
        rels = (
            [_relative_for_logical(logical) for logical in logicals]
            if logicals is not None
            else collect_files(args)
        )
        if not rels:
            raise ValueError("没有待发布文件(pending 为空且未指定 --tables)")
        snapshot_records = None
        if args.snapshot is not None:
            snapshot_records = _load_snapshot(
                args.snapshot,
                logicals or [],
                store,
                profile.id if profile else None,
            )

        prepared, skipped = _prepare_files(
            rels,
            store,
            strict_explicit=logicals is not None,
            snapshot_records=snapshot_records,
        )
        if not prepared:
            raise ValueError("没有可发布的文件")

        from_ver = args.from_ver or current_max_version()
        to_ver = bump(from_ver)
        baseline = final_state_guard.load_baseline()
        if baseline.get("current_version") != from_ver:
            raise ValueError(
                "final-state baseline tail mismatch: "
                f"baseline={baseline.get('current_version')}, publish={from_ver}"
            )
        final_report = final_state_guard.preflight(
            prepared,
            approve_reason=args.approve_final_state,
        )
        print(
            "最终态校验   : "
            f"base={baseline.get('base_version')} "
            f"changed_files={len(final_report.get('changes', {}))} "
            f"report={final_state_guard.REPORT_PATH}"
        )
        max_publish_version = os.environ.get("WF_MAX_PUBLISH_VERSION", "1.4.99")
        if _cmp(to_ver, max_publish_version) > 0:
            raise ValueError(
                f"Mode15 publish ceiling is {max_publish_version}; "
                f"refusing automatic version advance {from_ver} -> {to_ver}. "
                "Set WF_MAX_PUBLISH_VERSION explicitly only after approving a new client version."
            )
        print(f"数据源 store : {store}")
        print(f"版本推进     : {from_ver} -> {to_ver}")
        print("将发布文件   :")
        for relative in skipped:
            print(f"  [跳过] {relative} (本地不存在)")
        for entry in prepared:
            print(f"  {entry.archive_name}  ({len(entry.payload)} B)")
        if args.list:
            return 0

        if snapshot_records is not None:
            current_profile = core.resolve_profile()
            current_store_value = core.resolve_active_store(
                ROOT, profile=current_profile
            )
            if (
                current_profile is None
                or profile is None
                or current_profile.id != profile.id
                or not current_store_value
                or Path(current_store_value).resolve() != store
            ):
                raise ValueError(
                    "profile/store changed after snapshot preflight: "
                    f"expected profile={profile.id if profile else None!r} "
                    f"store={store}, actual profile="
                    f"{current_profile.id if current_profile else None!r} "
                    f"store={current_store_value}"
                )

        outputs = _build_archives(
            prepared,
            from_ver,
            to_ver,
            layer_placeholders=args.layer_placeholders,
        )
        if len(outputs) != 1:
            raise RuntimeError("asset-patch publication must create exactly one archive")
        try:
            _register_active_patch(outputs[0], prepared, from_ver, to_ver)
        except Exception:
            outputs[0].unlink(missing_ok=True)
            raise
        final_state_guard.commit(prepared, outputs[0], to_ver)
    except Exception as exc:
        print(f"[ERR] publish preflight failed: {exc}", file=sys.stderr)
        return 1

    for output in outputs:
        try:
            size_text = f"{committed_archive_size(output)} B"
        except Exception as exc:
            size_text = "size unavailable"
            print(
                "[WARN] publish committed; archive stat failed for "
                f"{output}: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
        print(
            f"\n[OK] 已发布: {output.parent.name}/{output.name}  "
            f"({size_text})"
        )
    print("客户端重启游戏即会自动下载更新(服务端动态扫描,无需重启)。")
    print(f"提示: .env 的 CN_RES_VERSION 可保持不变(/load 跟随客户端 res_ver)。")

    # 自动回填改动日志版本号。补丁目录只存 ZIP，展示信息统一写入 manifest.json。
    try:
        stamped = stamp_changelog(to_ver)
    except Exception as exc:
        print(
            "[WARN] publish committed; changelog update failed: "
            f"{type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
    else:
        print(
            f"改动日志: {stamped} 条标记为 {to_ver},"
            "已更新 work/changelog.md；版本展示已写入 asset-patch/manifest.json。"
        )

    # 当前 Mode15 服务端尚未消费 dev Catalog，因此默认关闭；明确传入
    # --dev-catalog 时才生成，失败只告警且不回滚已经提交的发布。
    if args.dev_catalog:
        try:
            import wf_dev_catalog as devcat

            manifest_path, dev_issues, _dev_summary = devcat.emit_dev_catalog(
                CDN_ROOT,
                SERVER_ROOT / "assets" / "asset-patch" / "active",
                digest_mode="cache",
                allow_issues=True,
            )
            print(
                f"dev catalog: {manifest_path} "
                f"(存量问题 {len(dev_issues)} 项，详见 report.json)"
            )
        except Exception as exc:
            print(
                "[WARN] publish committed; dev catalog emit failed: "
                f"{type(exc).__name__}: {exc}",
                file=sys.stderr,
            )

    # 发布来源=pending 时自动清空(与 GUI run_publish 语义对齐;CLI 直跑曾留残留,
    # 下次发布会把已发文件重复打进 diff——无害但包变大、日志变噪)
    if not args.tables and PENDING.exists():
        PENDING.write_text("[]", encoding="utf-8")
        print("pending 列表已清空。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
