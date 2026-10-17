#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""新角色 package 的唯一编排入口：workspace → preflight → publish → rollback。"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sys
import uuid
import zipfile
import zlib
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

import wf_character_pack as character_pack
import wf_character_gates as character_gates
import wf_character_requirements as requirements
import wf_character_workspace as workspace_module
import wf_apk_paths
import wf_dsl
import wf_mod_tool as core
import wf_release


class FlowError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# 边界门禁(2026-10-06 凉月复盘):发布默认输出不得写 .cdn;发布前外层 key
# union;live store 漂移 fail-closed;作者声明(来源与声明)分组。
# 纯逻辑在 wf_character_gates;这里只做 I/O 与编排。
# ---------------------------------------------------------------------------

BASE_STATE_SLOTS = (
    "neutral", "walk_front", "walk_back", "kachidoki",
    "into_coffin", "ghost_raise", "ghost_neutral", "revive",
)
COMPANION_SLOTS = ("skill_ready", "special_land", "special_pose")
KEY_UI_SLOTS = ("square", "thumb_party_main", "skill_cutin",
                "battle_control_board", "cutin_skill_chain")
UI_MASK_VALUES = frozenset({"auto", "none", "rounded", "cone", "hexagon", "circle"})
EFFECT_ORIGINS = frozenset({"reuse", "reskin", "original"})
VOICE_ENTRIES = frozenset({"ally", "battle", "home", "login", "words"})


def _resolve_write_paths(release_module, profile_id: str):
    """测试注入的 release 模块没有路径解析器时返回 None。"""
    resolver = getattr(release_module, "_resolve_repo_paths", None)
    if resolver is None:
        return None
    return resolver(profile_id)


def assert_writable_release_root(paths) -> None:
    """默认输出不得写 ``.cdn``(pristine 基线;2026-10-06 发布路径违规事故)。"""
    if paths is None:
        return
    cdn_root = Path(paths.cdn_root)
    resolved = cdn_root.resolve() if cdn_root.exists() else cdn_root
    if (
        character_gates.resolved_parts_include_cdn(cdn_root)
        or character_gates.resolved_parts_include_cdn(resolved)
    ):
        raise FlowError(
            "发布根落在受保护的 .cdn 基线内: "
            f"{cdn_root} -> {resolved}。发布默认不得写 .cdn;"
            "新角色资源必须走 assets/asset-patch/active/ + manifest + audit/,"
            "或用 WF_CDN_DIR 指向仓库外的可写 CDN 根。"
        )


def _live_table_path(store: Path | None, server_root: Path | None, root: str, logical: str):
    if root == "common":
        return core.table_path(Path(store), logical) if store is not None else None
    if root == "server":
        if server_root is None:
            return None
        return Path(server_root) / Path(*logical.split("/"))
    return None


def production_key_union_report(
    package_dir: Path,
    *,
    stores: tuple[Path, ...],
    server_root: Path | None,
) -> dict:
    """发布前外层 key union:包内每张有序表都不得丢有效链既有 outer key。"""
    report: dict = {"tables": [], "problems": [], "warnings": []}
    try:
        manifest = character_pack.load_manifest(Path(package_dir) / "manifest.json")
    except (OSError, ValueError) as exc:
        report["problems"].append(f"无法读取 manifest.json: {type(exc).__name__}: {exc}")
        return report
    roots = manifest.get("roots")
    if not isinstance(roots, dict):
        report["problems"].append("manifest.roots 结构无效")
        return report
    store = stores[0] if stores else None
    for root in ("common", "server"):
        entries = roots.get(root)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("logical_path"), str):
                continue
            logical = entry["logical_path"]
            candidate = Path(package_dir) / "roots" / root / Path(*logical.split("/"))
            if not candidate.is_file():
                continue
            try:
                after = core.read_orderedmap_file_from_bytes(candidate.read_bytes())
            except Exception:  # noqa: BLE001 - 非 orderedmap 资产跳过
                continue
            if not after:
                continue
            live_path = _live_table_path(store, server_root, root, logical)
            row = {"root": root, "logical_path": logical,
                   "package_keys": len(after), "live_keys": None}
            if live_path is None or not live_path.is_file():
                row["live_state"] = "absent"
                report["warnings"].append(
                    f"live store 缺少该表(首次发布或新表): {root}:{logical}"
                )
                report["tables"].append(row)
                continue
            try:
                before = core.read_orderedmap_file_from_bytes(live_path.read_bytes())
            except Exception as exc:  # noqa: BLE001
                report["problems"].append(
                    f"无法解码 live 表 {root}:{logical}: {type(exc).__name__}"
                )
                report["tables"].append(row)
                continue
            union = character_gates.outer_key_union_report(before, after)
            row.update({
                "live_keys": union["before_keys"],
                "added": union["added"][:40],
                "changed": union["changed"][:40],
                "removed": union["removed"][:40],
            })
            for problem in union["problems"]:
                report["problems"].append(
                    f"{root}:{logical}: {problem}。"
                    "包必须整表合并而不是只装声明行(C8601 整表覆盖事故)。"
                )
            report["tables"].append(row)
    return report


def live_store_drift_report(package_dir: Path, *, stores: tuple[Path, ...],
                            server_root: Path | None) -> dict:
    """live store 漂移 fail-closed:rebase 记录 live_before_sha256 必须仍然成立。"""
    report: dict = {"tables": [], "problems": [], "warnings": []}
    try:
        manifest = character_pack.load_manifest(Path(package_dir) / "manifest.json")
    except (OSError, ValueError) as exc:
        report["problems"].append(f"无法读取 manifest.json: {type(exc).__name__}: {exc}")
        return report
    snapshot = manifest.get("snapshot")
    rebase = snapshot.get("runtime_rebase") if isinstance(snapshot, dict) else None
    facts = rebase.get("tables") if isinstance(rebase, dict) else None
    if not isinstance(facts, list):
        report["status"] = "no-rebase-facts"
        return report
    store = stores[0] if stores else None
    for fact in facts:
        if not isinstance(fact, dict):
            continue
        root, logical = fact.get("root"), fact.get("logical_path")
        expected = fact.get("live_before_sha256")
        row = {"root": root, "logical_path": logical, "expected_sha256": expected}
        if root not in ("common", "server") or not isinstance(logical, str):
            report["problems"].append(f"rebase 记录字段无效: {fact!r}")
            report["tables"].append(row)
            continue
        path = _live_table_path(store, server_root, root, logical)
        if path is None or not path.is_file():
            row["actual_sha256"] = None
            report["problems"].append(
                f"live store 漂移: {root}:{logical} 已不存在"
                f"(rebase 时 {str(expected)[:12]}…);请重跑 rebase 后再发布"
            )
            report["tables"].append(row)
            continue
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        row["actual_sha256"] = actual
        if expected and actual != expected:
            report["problems"].append(
                f"live store 漂移: {root}:{logical} 期望 {str(expected)[:12]}… "
                f"实际 {actual[:12]}…;说明 rebase 之后 live 表被其它任务改写,"
                "禁止按旧基线发布,请重跑 rebase。"
            )
        report["tables"].append(row)
    return report


def declaration_report(package_dir: Path) -> dict:
    """作者声明(来源与声明)分组;基础状态带合成帧且未声明 = 阻断。"""
    package_dir = Path(package_dir)
    payload = None
    source = None
    path = package_dir / "declarations.json"
    if path.is_file():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            source = str(path)
        except (OSError, ValueError) as exc:
            return {"blocking": [f"declarations.json 无法解析: {type(exc).__name__}"],
                    "warnings": [], "summary": {}, "source": str(path)}
    else:
        try:
            manifest = character_pack.load_manifest(package_dir / "manifest.json")
            payload = manifest.get("declarations")
            source = "manifest.declarations"
        except (OSError, ValueError):
            payload = None
    if not isinstance(payload, dict):
        return {"blocking": [], "warnings": [],
                "summary": {"status": "undeclared"},
                "source": source,
                "note": "包内没有 declarations.json / manifest.declarations;"
                        "基础状态是否带附属物无法核对(E2 来源与声明分组)"}
    blocking: list[str] = []
    warnings: list[str] = []
    animations = payload.get("animations")
    if isinstance(animations, list):
        for item in animations:
            if not isinstance(item, dict):
                continue
            slot = str(item.get("slot") or "")
            variant = str(item.get("variant") or item.get("frameVariant") or "")
            companion = item.get("includesCompanion")
            composite = variant in ("composite", "mixed")
            if slot in BASE_STATE_SLOTS and composite and companion is not True:
                blocking.append(
                    f"基础状态 {slot} 使用合成帧(_sp)但未声明包含附属物;"
                    "请替换为纯本体帧,或把该状态声明为包含召唤物(2026-10-06 事故组合)"
                )
            elif slot in COMPANION_SLOTS and composite and companion not in (True, False):
                warnings.append(
                    f"获取/技能状态 {slot} 使用合成帧但未二选一声明是否包含附属物"
                )
            elif composite and companion not in (True, False):
                warnings.append(f"动作 {slot} 使用合成帧但未声明是否包含附属物")
    else:
        warnings.append("声明缺少 animations[]:基础状态/附属物来源无法核对")
    ui_declarations = payload.get("uiDeclarations")
    if isinstance(ui_declarations, dict):
        for key, spec in ui_declarations.items():
            if not isinstance(spec, dict):
                continue
            mask = spec.get("mask")
            if mask is not None and mask not in UI_MASK_VALUES:
                blocking.append(f"UI 声明 {key}.mask={mask!r} 不在 {sorted(UI_MASK_VALUES)}")
        for slot in KEY_UI_SLOTS:
            if not any(str(key).endswith(slot) for key in ui_declarations):
                warnings.append(f"UI 用途 {slot} 未声明取景/遮罩意图")
    else:
        warnings.append("声明缺少 uiDeclarations:五类重点 UI 用途的取景/遮罩意图未登记")
    effects = payload.get("effects")
    if isinstance(effects, list):
        for item in effects:
            if not isinstance(item, dict):
                continue
            origin = item.get("origin")
            if origin in (None, ""):
                warnings.append(f"特效 {item.get('name') or item.get('id') or '?'} 未声明来源"
                                "(reuse/reskin/original)")
            elif origin not in EFFECT_ORIGINS:
                blocking.append(f"特效来源 {origin!r} 不在 {sorted(EFFECT_ORIGINS)}")
    else:
        warnings.append("声明缺少 effects[]:特效来源未登记")
    voices = payload.get("voiceDeclarations")
    if isinstance(voices, list):
        for item in voices:
            if not isinstance(item, dict):
                continue
            entry = item.get("entry")
            if entry in (None, ""):
                warnings.append(f"语音 {item.get('file') or '?'} 缺少入口分类")
            elif entry not in VOICE_ENTRIES:
                blocking.append(f"语音入口 {entry!r} 不在 {sorted(VOICE_ENTRIES)}")
    else:
        warnings.append("声明缺少 voiceDeclarations[]:语音入口/台词未登记")
    summary = {
        "animations": len(animations) if isinstance(animations, list) else 0,
        "ui_declarations": len(ui_declarations) if isinstance(ui_declarations, dict) else 0,
        "effects": len(effects) if isinstance(effects, list) else 0,
        "voices": len(voices) if isinstance(voices, list) else 0,
    }
    return {"blocking": blocking, "warnings": warnings, "summary": summary,
            "source": source}


def production_boundary_gates(
    package_dir: Path,
    *,
    profile_id: str,
    release_module,
) -> dict:
    """发布前统一边界门禁报告(供 preflight/publish 共用)。"""
    report: dict = {"problems": [], "warnings": []}
    paths = _resolve_write_paths(release_module, profile_id)
    if paths is not None:
        assert_writable_release_root(paths)
    stores = _master_gate_stores(profile_id)
    try:
        server_root = Path(core.resolve_server_dir(profile_id))
    except (OSError, ValueError):
        server_root = None
    key_union = production_key_union_report(
        package_dir, stores=stores, server_root=server_root,
    )
    drift = live_store_drift_report(
        package_dir, stores=stores, server_root=server_root,
    )
    declarations = declaration_report(package_dir)
    report["key_union"] = key_union
    report["live_store_drift"] = drift
    report["declarations"] = declarations
    report["problems"].extend(key_union["problems"])
    report["problems"].extend(drift["problems"])
    report["problems"].extend(declarations["blocking"])
    report["warnings"].extend(key_union["warnings"])
    report["warnings"].extend(drift["warnings"])
    report["warnings"].extend(declarations["warnings"])
    return report


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise FlowError(message)


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init")
    init.add_argument("--root", type=Path, default=Path("work/character_packs"))
    init.add_argument("--template-id", required=True, type=int)
    init.add_argument("--character-id", required=True, type=int)
    init.add_argument("--code-name", required=True)
    init.add_argument("--package-id", required=True)

    for name in ("status", "preflight", "publish"):
        child = sub.add_parser(name)
        child.add_argument("--workspace", required=True, type=Path)
        if name in {"preflight", "publish"}:
            child.add_argument("--profile", default="cn")
            child.add_argument("--installed-package-dir", type=Path)
        if name == "publish":
            child.add_argument("--confirm", required=True)

    rebase = sub.add_parser("rebase")
    rebase.add_argument("--workspace", required=True, type=Path)
    rebase.add_argument("--profile", default="cn")
    rebase.add_argument("--output", type=Path)
    rebase.add_argument("--git-head")

    reanchor = sub.add_parser("reanchor")
    reanchor.add_argument("--profile", default="cn")
    reanchor.add_argument("--target-base")
    reanchor.add_argument("--confirm")

    rollback = sub.add_parser("rollback")
    rollback.add_argument("--snapshot-dir", required=True, type=Path)
    rollback.add_argument("--profile", default="cn")
    rollback.add_argument("--installed-package-dir", type=Path)
    rollback.add_argument("--confirm", required=True)
    return parser


def _base_payload(
    *,
    stage: str,
    workspace: str | None,
    release_ready: bool,
    errors: list[str] | None = None,
    next_command: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "ok": not errors,
        "stage": stage,
        "workspace": workspace,
        "release_ready": bool(release_ready),
        "errors": errors or [],
        "next_command": next_command,
        **extra,
    }


def _manifest_mode(workspace: workspace_module.Workspace) -> str:
    manifest = character_pack.load_manifest(workspace.package_dir / "manifest.json")
    qa = manifest.get("qa")
    if not isinstance(qa, dict) or qa.get("delivery_mode") not in {"production", "runtime_test"}:
        raise FlowError("manifest.qa.delivery_mode 必须是 production 或 runtime_test")
    return str(qa["delivery_mode"])


def _release_result_payload(result: Any) -> dict[str, Any]:
    if is_dataclass(result):
        values = asdict(result)
    else:
        values = dict(vars(result))
    archives = values.pop("archive_paths", ())
    snapshot = values.pop("snapshot_dir", None)
    return {
        **values,
        "archives": [str(path) for path in archives],
        "snapshot_dir": str(snapshot) if snapshot is not None else None,
    }


# ---------------------------------------------------------------------------
# 双路径产出(与 wf_publish 的发布后钩子同义):角色包发布提交后,追加重产 dev
# 启动前编译路径的输入(catalog manifest + 合并 EntityLists)。只在归档确实落进
# 真实 CDN 链根时发射——注入了假 release 模块的测试写不到链根,自然跳过。
# 失败仅 [WARN] 到 stderr,不改发布返回码(发布已提交,不可回滚)。
# ---------------------------------------------------------------------------


def _archives_inside(result: Any, cdn_root: Path) -> bool:
    try:
        root = cdn_root.resolve()
    except OSError:
        return False
    for archive in getattr(result, "archive_paths", ()) or ():
        try:
            if Path(archive).resolve().is_relative_to(root):
                return True
        except OSError:
            continue
    return False


def emit_dev_catalog_after_publish(result: Any) -> str | None:
    """返回 dev catalog manifest 路径;不满足发射条件时返回 None。"""
    if not getattr(result, "committed", False):
        return None
    import wf_dev_catalog as devcat

    cdn_root = Path(devcat.CDN_ROOT)
    if not (cdn_root / "archive-common-diff").is_dir():
        return None
    if not _archives_inside(result, cdn_root):
        return None
    manifest_path, _issues, _summary = devcat.emit_dev_catalog(
        cdn_root,
        devcat.ASSET_PATCH_ACTIVE,
        digest_mode="cache",
        allow_issues=True,
    )
    return str(manifest_path) if manifest_path is not None else None


# ---------------------------------------------------------------------------
# master 表资产引用门禁(2026-07-16 unique_seris_wet F1009 事故)
# 纯逻辑在 wf_character_requirements;这里只做 I/O:解码包内表/DSL、读 manifest
# 声明、探测 live store(sha1 桶),然后把缺失清单折进 preflight/publish 的
# release_ready 判定。runtime_test 只随 preflight 报告,不拦截。
# ---------------------------------------------------------------------------


def _master_gate_stores(profile_id: str) -> tuple[Path, ...]:
    profile = core.resolve_profile(profile_id)
    primary = core.resolve_active_store(profile=profile, profile_id=profile_id)
    candidates = [primary] if primary is not None else []
    if profile is not None and profile.fallback is not None:
        candidates.append(profile.fallback)
    return tuple(path for path in candidates if path.is_dir())


# APK 内置 bundle 是 CDN 之外的第二个资产来源:客户端
# FileReader.resolveFiles(:246-282) 先判 bundleFiles.contains(hash),命中就从
# getBundleRootDirectory() 读,根本不看 upload/。官方 supporter/knight/ranged 的
# PF 演出特效就只存在于 bundle(store 里没有),而借用官方 PF 演出的自制包
# (如基诺维"剑+辅助共存")会引用它们 —— 只查 CDN store 会把这类引用误报成缺失。
# 这里只**新增**一个满足来源,不放宽任何真正缺失的判定。
_BUNDLE_INDEX_CACHE: dict[str, frozenset[str]] = {}


def _bundle_asset_tails() -> frozenset[str]:
    """APK 内置 bundle 里的 `<xx>/<hash>` 集合;读不到时返回空集(=退回原行为)。"""
    repo_root = Path(__file__).resolve().parent.parent
    explicit_apk = wf_apk_paths.resolve_explicit_apk(os.environ)
    source = explicit_apk or repo_root / "弹国服" / "bundle.zip"
    key = str(source.resolve())
    cached = _BUNDLE_INDEX_CACHE.get(key)
    if cached is not None:
        return cached
    tails: set[str] = set()
    candidates = [source]
    for source in candidates:
        if not source.is_file():
            continue
        try:
            with zipfile.ZipFile(source) as archive:
                names = archive.namelist()
                if "assets/bundle.zip" in names:      # 直接给 APK 时再剥一层
                    with zipfile.ZipFile(
                        io.BytesIO(archive.read("assets/bundle.zip"))
                    ) as inner:
                        names = inner.namelist()
            for name in names:
                if name.endswith("/"):
                    continue
                parts = name.split("/")
                if len(parts) >= 2:
                    tails.add(f"{parts[-2]}/{parts[-1]}")
        except (OSError, zipfile.BadZipFile):
            continue
    result = frozenset(tails)
    _BUNDLE_INDEX_CACHE[key] = result
    return result


def _bundle_has(logical: str) -> bool:
    digest = core.sha1_path(logical)
    return f"{digest[:2]}/{digest[2:]}" in _bundle_asset_tails()


def _package_client_file(package_dir: Path, logical: str) -> Path:
    return package_dir / "roots" / "common" / Path(*logical.split("/"))


def _store_table_path(stores: tuple[Path, ...], logical: str) -> Path | None:
    for store in stores:
        path = core.table_path(store, logical)
        if path.is_file():
            return path
    return None


def _decode_nested(path: Path, logical: str) -> dict[str, dict[str, str]]:
    outer = core.read_orderedmap_file_raw_rows(path, logical)
    return {
        key: core.read_orderedmap_file_from_bytes(raw)
        for key, raw in zip(outer.keys, outer.rows)
    }


def master_reference_report(
    package_dir: Path,
    stores: tuple[Path, ...],
) -> dict[str, Any]:
    """包内 master 表/DSL 的全局资产引用 → 对照包声明与 live store 的缺失报告。

    角色包整表随包,基线行不归包负责(CN 基线本就有悬空引用,如 rare4/alk 的
    DSL 从未进国服包)。因此逐行 diff live store,只把**新增/修改行**交给提取器;
    live store 没有该表时保守全量检查。
    """
    package_dir = Path(package_dir)
    problems: list[str] = []

    flat_tables: dict[str, dict[str, str]] = {}
    changed_flat: dict[str, dict[str, str]] = {}
    for logical in (requirements.UNIQUE_CONDITION_TABLE, *requirements.ABILITY_TABLES):
        path = _package_client_file(package_dir, logical)
        if not path.is_file():
            continue
        try:
            rows = core.read_orderedmap_file_from_bytes(path.read_bytes())
        except Exception as exc:
            problems.append(f"无法解码 {logical}: {type(exc).__name__}")
            continue
        flat_tables[logical] = rows
        store_rows: dict[str, str] | None = None
        store_path = _store_table_path(stores, logical)
        if store_path is not None:
            try:
                store_rows = core.read_orderedmap_file_from_bytes(store_path.read_bytes())
            except Exception as exc:
                problems.append(f"无法解码 live store {logical}: {type(exc).__name__}")
        if store_rows is None:
            changed_flat[logical] = rows
        else:
            changed_flat[logical] = {
                key: text for key, text in rows.items()
                if store_rows.get(key) != text
            }

    nested_tables: dict[str, dict[str, dict[str, str]]] = {}
    for logical in requirements.NESTED_SKILL_PROGRAM_COLUMNS:
        path = _package_client_file(package_dir, logical)
        if not path.is_file():
            continue
        try:
            outer = _decode_nested(path, logical)
        except Exception as exc:
            problems.append(f"无法解码 {logical}: {type(exc).__name__}")
            continue
        store_outer: dict[str, dict[str, str]] | None = None
        store_path = _store_table_path(stores, logical)
        if store_path is not None:
            try:
                store_outer = _decode_nested(store_path, logical)
            except Exception as exc:
                problems.append(f"无法解码 live store {logical}: {type(exc).__name__}")
        changed_outer: dict[str, dict[str, str]] = {}
        for outer_key, inner in outer.items():
            store_inner = (store_outer or {}).get(outer_key, {})
            changed_inner = {
                inner_key: text for inner_key, text in inner.items()
                if store_outer is None or store_inner.get(inner_key) != text
            }
            if changed_inner:
                changed_outer[outer_key] = changed_inner
        if changed_outer:
            nested_tables[logical] = changed_outer

    dsl_trees: dict[str, Any] = {}
    common_root = package_dir / "roots" / "common"
    if common_root.is_dir():
        for path in sorted(common_root.rglob("*.action.dsl.amf3.deflate")):
            logical = path.relative_to(common_root).as_posix()
            try:
                dsl_trees[logical] = wf_dsl.parse_dsl(
                    zlib.decompress(path.read_bytes(), -15)
                )["tree"]
            except Exception as exc:
                problems.append(f"无法解码 {logical}: {type(exc).__name__}")

    references = requirements.extract_master_asset_references(
        changed_flat, nested_tables, dsl_trees,
    )

    # 包内可满足 = manifest roots.common 声明(发布只装声明过的文件,
    # 与 wf_character_pack._unique_condition_asset_errors 同口径)
    declared_common: set[str] = set()
    try:
        manifest = character_pack.load_manifest(package_dir / "manifest.json")
        roots = manifest.get("roots")
        entries = roots.get("common") if isinstance(roots, dict) else None
        for entry in entries if isinstance(entries, list) else ():
            if isinstance(entry, dict) and isinstance(entry.get("logical_path"), str):
                declared_common.add(entry["logical_path"])
    except (OSError, ValueError) as exc:
        problems.append(f"无法读取 manifest.json: {type(exc).__name__}")

    store_condition_ids: set[str] = set()
    if any(item.kind == "unique_condition_id" for item in references):
        for store in stores:
            path = core.table_path(store, requirements.UNIQUE_CONDITION_TABLE)
            if not path.is_file():
                continue
            try:
                store_condition_ids.update(
                    core.read_orderedmap_file_from_bytes(path.read_bytes())
                )
            except Exception as exc:
                problems.append(
                    f"无法解码 live store unique_condition 表: {type(exc).__name__}"
                )

    report = requirements.build_master_reference_report(
        references,
        package_asset_paths=declared_common,
        package_condition_ids=flat_tables.get(requirements.UNIQUE_CONDITION_TABLE, {}),
        asset_exists=lambda logical: any(
            core.table_path(store, logical).exists() for store in stores
        ) or _bundle_has(logical),
        condition_id_exists=lambda cid: cid in store_condition_ids,
    )
    runtime_texture_checks: list[dict[str, Any]] = []
    for reference in references:
        if reference.kind != "skill_effect":
            continue
        required_paths = requirements.required_asset_paths(reference)
        if len(required_paths) != 4:
            continue
        parts_logical, _timeline_logical, _sheet_logical, atlas_logical = required_paths
        if parts_logical not in declared_common or atlas_logical not in declared_common:
            continue
        parts_path = _package_client_file(package_dir, parts_logical)
        atlas_path = _package_client_file(package_dir, atlas_logical)
        try:
            parts_tree = wf_dsl.parse_dsl(
                zlib.decompress(parts_path.read_bytes(), -15)
            )["tree"]
            atlas_tree = wf_dsl.parse_dsl(
                zlib.decompress(atlas_path.read_bytes(), -15)
            )["tree"]
            if not isinstance(parts_tree, dict) or not isinstance(atlas_tree, list):
                raise ValueError("parts/atlas root type mismatch")
            texture_refs = {
                image["p"]
                for image in parts_tree.get("i", ())
                if isinstance(image, dict) and isinstance(image.get("p"), str)
            }
            loaded_textures = {
                image["n"]
                for image in atlas_tree
                if isinstance(image, dict) and isinstance(image.get("n"), str)
            }
            missing_textures = sorted(texture_refs - loaded_textures)
        except (OSError, KeyError, TypeError, ValueError, zlib.error) as exc:
            problems.append(
                f"cannot validate runtime effect textures for {reference.value}: "
                f"{type(exc).__name__}"
            )
            continue
        runtime_texture_checks.append({
            "effect": reference.value,
            "source": reference.source,
            "parts": parts_logical,
            "loader_atlas": atlas_logical,
            "texture_reference_count": len(texture_refs),
            "missing_textures": missing_textures,
        })
        if missing_textures:
            problems.append(
                f"runtime loader atlas misses textures for {reference.value}: "
                + ", ".join(missing_textures)
            )
    report["runtime_texture_checks"] = runtime_texture_checks
    report["stores"] = [str(store) for store in stores]
    report["problems"] = problems
    if problems:
        report["release_ready"] = False
    return report


def _master_gate_errors(report: dict[str, Any]) -> list[str]:
    errors = [
        f"master 表引用缺失资产: {item['kind']} {item['missing']} (来源 {item['source']})"
        for item in report.get("missing", ())
    ]
    errors.extend(report.get("problems", ()))
    return errors


def _can_seal(status: workspace_module.WorkspaceStatus) -> bool:
    allowed_errors = {
        "manifest workspace_input_sha256 does not match status",
    }
    report = status.requirement_report
    return bool(
        report.get("release_ready") is True
        and report.get("required_total") == 37
        and report.get("required_present") == 37
        and status.three_layer_claim_status.get("consistent") is True
        and not (set(status.manifest_errors) - allowed_errors)
    )


def _activate_rebased_package(
    workspace: workspace_module.Workspace,
    output: Path,
) -> workspace_module.WorkspaceStatus:
    output = Path(output).absolute()
    if output.parent != workspace.root or output == workspace.package_dir:
        raise FlowError("production rebase output must be a direct workspace child")
    if not output.is_dir() or workspace_module._path_has_reparse_component(output):
        raise FlowError("production rebase output is missing or contains a reparse point")
    backup = workspace.root / f"package-pre-rebase-{uuid.uuid4().hex}"
    os.replace(workspace.package_dir, backup)
    activated = False
    try:
        os.replace(output, workspace.package_dir)
        activated = True
        sealed = workspace_module.seal_workspace(workspace)
        if workspace_module._is_reparse(backup):
            raise FlowError("rebase backup ownership changed; preserving it for inspection")
        shutil.rmtree(backup)
        return sealed
    except Exception as exc:
        restore_errors: list[str] = []
        if activated and workspace.package_dir.exists():
            try:
                os.replace(workspace.package_dir, output)
            except OSError as restore_exc:
                restore_errors.append(f"preserve rebased output: {restore_exc}")
        if backup.exists() and not workspace.package_dir.exists():
            try:
                os.replace(backup, workspace.package_dir)
            except OSError as restore_exc:
                restore_errors.append(f"restore original package: {restore_exc}")
        detail = f"production rebase activation failed: {exc}"
        if restore_errors:
            detail += "; " + "; ".join(restore_errors)
        raise FlowError(detail) from exc


def run_command(
    argv: list[str] | None = None,
    *,
    release_module=wf_release,
    dev_catalog_hook=emit_dev_catalog_after_publish,
) -> tuple[int, dict[str, Any]]:
    command = "unknown"
    workspace_path: str | None = None
    try:
        args = _parser().parse_args(argv)
        command = args.command
        if command == "init":
            workspace = workspace_module.init_workspace(
                args.root,
                args.template_id,
                args.character_id,
                args.code_name,
                args.package_id,
            )
            status = workspace_module.workspace_status(workspace)
            workspace_path = str(workspace.root)
            return 0, _base_payload(
                stage="init",
                workspace=workspace_path,
                release_ready=False,
                next_command=(
                    f"python mod-tools/wf_character_flow.py status --workspace "
                    f"{workspace.root}"
                ),
                package_id=workspace.package_id,
                character_id=workspace.character_id,
                code_name=workspace.code_name,
                status=status.to_dict(),
            )

        if command == "reanchor":
            if not hasattr(release_module, "reanchor_active_ledger"):
                raise FlowError("release API 未提供 reanchor_active_ledger")
            assert_writable_release_root(
                _resolve_write_paths(release_module, args.profile)
            )
            dry_run = args.confirm is None
            if not dry_run and args.confirm != "REANCHOR_CHARACTER_LEDGER":
                raise FlowError("重锚必须使用确认口令 REANCHOR_CHARACTER_LEDGER")
            plan = release_module.reanchor_active_ledger(
                args.profile, target_base=args.target_base, dry_run=dry_run,
            )
            return 0, _base_payload(
                stage="reanchor",
                workspace=None,
                release_ready=False,
                next_command=(
                    "python mod-tools/wf_character_flow.py reanchor --confirm "
                    "REANCHOR_CHARACTER_LEDGER" if dry_run else None
                ),
                plan=plan,
            )

        if command == "rollback":
            if args.confirm != "ROLLBACK_CHARACTER_PACKAGE":
                raise FlowError("回滚必须使用确认口令 ROLLBACK_CHARACTER_PACKAGE")
            try:
                import wf_character_rollback as rollback_module
            except ImportError as exc:
                raise FlowError("snapshot 回滚模块尚不可用") from exc
            result = rollback_module.publish_snapshot_rollback(
                args.snapshot_dir,
                profile_id=args.profile,
                confirmation=args.confirm,
                installed_package_dir=args.installed_package_dir,
            )
            return 0, _base_payload(
                stage="rollback",
                workspace=None,
                release_ready=False,
                next_command=None,
                **_release_result_payload(result),
            )

        workspace = workspace_module.load_workspace(args.workspace)
        workspace_path = str(workspace.root)
        if command == "status":
            status = workspace_module.workspace_status(workspace)
            payload = status.to_dict()
            return 0, _base_payload(
                stage="status",
                workspace=workspace_path,
                release_ready=status.release_ready,
                next_command=status.next_command,
                status=payload,
            )

        if command == "preflight":
            status = workspace_module.workspace_status(workspace)
            mode = _manifest_mode(workspace)
            boundary = None
            if mode == "production":
                boundary = production_boundary_gates(
                    workspace.package_dir,
                    profile_id=args.profile,
                    release_module=release_module,
                )
            master_report = master_reference_report(
                workspace.package_dir, _master_gate_stores(args.profile)
            )
            if mode == "production" and (not master_report["release_ready"]
                                         or boundary["problems"]):
                errors = _master_gate_errors(master_report)
                errors.extend(boundary["problems"] if boundary else [])
                return 3, _base_payload(
                    stage="preflight",
                    workspace=workspace_path,
                    release_ready=False,
                    errors=errors,
                    next_command=(
                        "补齐 master_reference_report.missing 的资产并解决边界门禁问题后"
                        "重新运行 preflight"
                    ),
                    status=status.to_dict(),
                    master_reference_report=master_report,
                    boundary_gates=boundary,
                )
            if (
                mode == "production"
                and not status.release_ready
                and _can_seal(status)
            ):
                status = workspace_module.seal_workspace(workspace)
            report = release_module.preflight_package(
                workspace.package_dir,
                args.profile,
                installed_package_dir=args.installed_package_dir,
            )
            ready = bool(report.get("release_ready", report.get("can_prepare", False)))
            return (0 if ready else 3), _base_payload(
                stage="preflight",
                workspace=workspace_path,
                release_ready=ready,
                errors=[] if ready else ["package preflight 尚未达到发布条件"],
                next_command=(
                    f"python mod-tools/wf_character_flow.py publish --workspace {workspace.root} "
                    "--confirm PUBLISH_CHARACTER_PACKAGE"
                    if ready else status.next_command
                ),
                status=status.to_dict(),
                preflight=report,
                master_reference_report=master_report,
                boundary_gates=boundary,
            )

        if command == "publish":
            mode = _manifest_mode(workspace)
            expected = "DIRECT_REAL_TEST" if mode == "runtime_test" \
                else "PUBLISH_CHARACTER_PACKAGE"
            if args.confirm != expected:
                raise FlowError(f"{mode} 发布必须使用确认口令 {expected}")
            status = workspace_module.workspace_status(workspace)
            if mode == "production":
                if not status.release_ready:
                    raise FlowError("production workspace 未达到 release_ready=true")
                boundary = production_boundary_gates(
                    workspace.package_dir,
                    profile_id=args.profile,
                    release_module=release_module,
                )
                if boundary["problems"]:
                    raise FlowError(
                        "边界门禁未通过(路径/live key union/漂移/声明): "
                        + "; ".join(boundary["problems"])
                    )
                master_report = master_reference_report(
                    workspace.package_dir, _master_gate_stores(args.profile)
                )
                if not master_report["release_ready"]:
                    raise FlowError(
                        "master 表资产引用门禁未通过: "
                        + "; ".join(_master_gate_errors(master_report))
                    )
            else:
                boundary = None
            result = release_module.publish_package(
                workspace.package_dir,
                args.profile,
                args.confirm,
                installed_package_dir=args.installed_package_dir,
            )
            dev_catalog: str | None = None
            if dev_catalog_hook is not None:
                try:
                    dev_catalog = dev_catalog_hook(result)
                except Exception as exc:
                    print(
                        "[WARN] publish committed; dev catalog emit failed: "
                        f"{type(exc).__name__}: {exc}",
                        file=sys.stderr,
                    )
            return 0, _base_payload(
                stage="publish",
                workspace=workspace_path,
                release_ready=mode == "production",
                next_command=None,
                delivery_mode=mode,
                dev_catalog=dev_catalog,
                boundary_gates=boundary,
                **_release_result_payload(result),
            )

        if command == "rebase":
            if not hasattr(release_module, "rebase_package"):
                raise FlowError("release API 未提供 rebase_package")
            mode = _manifest_mode(workspace)
            if mode == "production":
                assert_writable_release_root(
                    _resolve_write_paths(release_module, args.profile)
                )
                status = workspace_module.workspace_status(workspace)
                if not status.release_ready:
                    raise FlowError("production workspace 未达到 release_ready=true")
            output = args.output or (workspace.root / "rebased-package")
            result = release_module.rebase_package(
                workspace.package_dir,
                args.profile,
                output_dir=output,
                generator_git_head=args.git_head,
            )
            if mode == "production":
                sealed = _activate_rebased_package(workspace, result.output_dir)
                manifest_sha256 = hashlib.sha256(
                    (workspace.package_dir / "manifest.json").read_bytes()
                ).hexdigest()
                return 0, _base_payload(
                    stage="rebase",
                    workspace=workspace_path,
                    release_ready=sealed.release_ready,
                    next_command=(
                        f"python mod-tools/wf_character_flow.py publish --workspace "
                        f"{workspace.root} --confirm PUBLISH_CHARACTER_PACKAGE"
                    ),
                    output=str(workspace.package_dir),
                    manifest_sha256=manifest_sha256,
                    table_count=result.table_count,
                    writes_live=False,
                    status=sealed.to_dict(),
                )
            return 0, _base_payload(
                stage="rebase",
                workspace=workspace_path,
                release_ready=False,
                next_command=f"检查 {result.output_dir} 后替换 workspace package",
                output=str(result.output_dir),
                manifest_sha256=result.manifest_sha256,
                writes_live=False,
            )
        raise FlowError(f"未知命令: {command}")
    except (
        OSError,
        ValueError,
        RuntimeError,
        workspace_module.WorkspaceError,
        character_pack.PackPreflightError,
        character_pack.PackStagingError,
        wf_release.ReleaseError,
    ) as exc:
        return 2, _base_payload(
            stage=command,
            workspace=workspace_path,
            release_ready=False,
            errors=[str(exc)],
            next_command=None,
        )


def main(argv: list[str] | None = None) -> int:
    code, payload = run_command(argv)
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
