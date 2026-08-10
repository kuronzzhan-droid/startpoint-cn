#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Iterable

import wf_mod_tool as core

TOOL_DIR = Path(__file__).resolve().parent
SERVER_ROOT = TOOL_DIR.parent.parent
ACTIVE = SERVER_ROOT / "assets" / "asset-patch" / "active"
MANIFEST = SERVER_ROOT / "assets" / "asset-patch" / "manifest.json"
STORE_ROOT = SERVER_ROOT / "assets" / "asset-patch" / "production" / "upload"
POLICY_PATH = TOOL_DIR / "final_state_policy.json"
WORK = TOOL_DIR / "work"
BASELINE_PATH = WORK / "final_state_baseline.json"
BASELINE_FILES = WORK / "final_state_baseline_files"
APPROVAL_PATH = WORK / "final_state_approval.json"
REPORT_PATH = WORK / "final_state_report.json"
ARCHIVE_RE = re.compile(r"pinball-(\d+\.\d+\.\d+)-(\d+\.\d+\.\d+)-(\d+)-")
PAYLOAD_RE = re.compile(
    r"^production/(?:upload|medium_upload|android_upload)/[0-9a-f]{2}/[0-9a-f]{38}$"
)


class GuardError(RuntimeError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _version_key(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def _atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, raw = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    os.close(handle)
    temporary = Path(raw)
    try:
        temporary.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        json.loads(temporary.read_text(encoding="utf-8"))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def load_policy() -> dict:
    data = json.loads(POLICY_PATH.read_text(encoding="utf-8-sig"))
    if data.get("schema_version") != 1 or data.get("base_version") != "1.4.55":
        raise GuardError("final-state policy must be schema 1 anchored at 1.4.55")
    return data


def _fallback_store_root() -> Path | None:
    profiles_path = TOOL_DIR / "profiles.json"
    if not profiles_path.is_file():
        return None
    profiles = json.loads(profiles_path.read_text(encoding="utf-8-sig"))
    active = profiles.get("active")
    fallback = profiles.get("profiles", {}).get(active, {}).get("fallback")
    return Path(fallback) if isinstance(fallback, str) and fallback else None


def _archives(base_version: str) -> list[tuple[str, str, int, Path]]:
    found = []
    for path in ACTIVE.glob("*.zip"):
        match = ARCHIVE_RE.match(path.name)
        if match is None or _version_key(match.group(1)) < _version_key(base_version):
            continue
        found.append((match.group(1), match.group(2), int(match.group(3)), path))
    return sorted(found, key=lambda item: (_version_key(item[1]), item[2], item[3].name))


def _validate_manifest_chain(base_version: str) -> str:
    document = json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    enabled = [p for p in document.get("patches", []) if isinstance(p, dict) and p.get("enabled")]
    cursor = base_version
    for patch in enabled:
        depends = str(patch.get("depends_on", ""))
        version = str(patch.get("version", ""))
        if _version_key(version) <= _version_key(base_version):
            continue
        if depends != cursor:
            raise GuardError(
                f"asset-patch chain is not continuous at {cursor}: got {depends}->{version}"
            )
        cursor = version
    if cursor != document.get("cdn_version"):
        raise GuardError(
            f"manifest tail mismatch: chain={cursor}, cdn_version={document.get('cdn_version')}"
        )
    return cursor


def _logical_archive_names(policy: dict) -> dict[str, str]:
    result = {}
    for logical in policy["high_risk_tables"]:
        digest = core.sha1_path(logical)
        result[logical] = f"production/upload/{digest[:2]}/{digest[2:]}"
    return result


def _rows(payload: bytes, logical: str) -> dict[str, bytes]:
    """Return exact outer-row bytes for both flat and nested orderedmaps.

    Several high-risk master tables (for example action_skill and character
    status) store an inner orderedmap as the outer row and therefore must not
    be passed through the legacy zlib-per-row text reader.  The strict raw-row
    reader understands the common outer index used by both layouts and keeps
    the comparison byte-exact.
    """
    ordered = core.read_orderedmap_raw_rows_from_bytes(payload, logical)
    return dict(zip(ordered.keys, ordered.rows))


def _row_hashes(payload: bytes, logical: str) -> dict[str, str]:
    return {key: _sha(value) for key, value in _rows(payload, logical).items()}


def initialize_baseline() -> dict:
    policy = load_policy()
    base = policy["base_version"]
    tail = _validate_manifest_chain(base)
    archives = _archives(base)
    if not archives:
        raise GuardError("no active archives found from the 1.4.55 baseline")

    latest: dict[str, tuple[bytes, str]] = {}
    receipts = []
    for source, target, part, path in archives:
        blob = path.read_bytes()
        receipts.append({
            "name": path.name,
            "from": source,
            "to": target,
            "part": part,
            "size": len(blob),
            "sha256": _sha(blob),
        })
        with zipfile.ZipFile(path) as archive:
            bad = archive.testzip()
            if bad is not None:
                raise GuardError(f"corrupt archive {path.name}: {bad}")
            for name in archive.namelist():
                if PAYLOAD_RE.fullmatch(name):
                    latest[name] = (archive.read(name), path.name)

    logical_names = _logical_archive_names(policy)
    entries = {}
    BASELINE_FILES.mkdir(parents=True, exist_ok=True)
    for logical, common_name in logical_names.items():
        matches = [name for name in latest if name.endswith(common_name.split("/", 2)[-1])]
        if matches:
            name = sorted(matches)[0]
            payload, source_archive = latest[name]
        else:
            # A table untouched by every post-.55 patch still belongs to the
            # protected final state.  Seed it from the materialized store so
            # a later whole-table export cannot silently replace it.
            relative = common_name.removeprefix("production/upload/")
            store_path = STORE_ROOT / relative
            if not store_path.is_file():
                fallback_root = _fallback_store_root()
                if fallback_root is not None:
                    store_path = fallback_root / relative
            if not store_path.is_file():
                continue
            name = common_name
            payload = store_path.read_bytes()
            source_archive = "base-store:unchanged-since-1.4.55"
        file_name = core.sha1_path(logical) + ".orderedmap"
        snapshot = BASELINE_FILES / file_name
        snapshot.write_bytes(payload)
        entries[name] = {
            "logical": logical,
            "sha256": _sha(payload),
            "size": len(payload),
            "row_count": len(_rows(payload, logical)),
            "rows": _row_hashes(payload, logical),
            "snapshot": snapshot.name,
            "source_archive": source_archive,
        }

    chain_digest = _sha(
        "\n".join(f"{item['name']}:{item['sha256']}" for item in receipts).encode("utf-8")
    )
    baseline = {
        "schema_version": 1,
        "base_version": base,
        "current_version": tail,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "chain_sha256": chain_digest,
        "archives": receipts,
        "entries": entries,
    }
    _atomic_json(BASELINE_PATH, baseline)
    return baseline


def load_baseline() -> dict:
    try:
        data = json.loads(BASELINE_PATH.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise GuardError(f"final-state baseline is missing or invalid: {exc}") from exc
    if data.get("schema_version") != 1 or data.get("base_version") != "1.4.55":
        raise GuardError("final-state baseline is not anchored at 1.4.55")
    return data


def verify_archive_history(baseline: dict) -> None:
    failures = []
    for receipt in baseline.get("archives", []):
        path = ACTIVE / receipt["name"]
        if not path.is_file():
            failures.append(f"missing {path.name}")
            continue
        blob = path.read_bytes()
        if len(blob) != receipt["size"] or _sha(blob) != receipt["sha256"]:
            failures.append(f"changed {path.name}")
    if failures:
        raise GuardError("1.4.55 archive history changed: " + "; ".join(failures))


def _diff(entry: dict | None, payload: bytes) -> dict:
    result = {
        "old_sha256": entry.get("sha256") if entry else None,
        "new_sha256": _sha(payload),
        "added": [], "modified": [], "deleted": [],
        "protected_changed": [],
    }
    if entry is None or entry.get("logical") is None:
        result["binary_changed"] = entry is None or result["old_sha256"] != result["new_sha256"]
        return result
    old = entry.get("rows", {})
    new = _row_hashes(payload, entry["logical"])
    result["added"] = sorted(set(new) - set(old))
    result["deleted"] = sorted(set(old) - set(new))
    result["modified"] = sorted(key for key in set(old) & set(new) if old[key] != new[key])
    prefixes = load_policy().get("protected_prefixes", {}).get(entry["logical"], [])
    result["protected_changed"] = sorted(
        key for key in result["added"] + result["deleted"] + result["modified"]
        if any(key.startswith(prefix) for prefix in prefixes)
    )
    return result


def build_report(prepared: Iterable[object], baseline: dict | None = None) -> dict:
    baseline = baseline or load_baseline()
    entries = baseline.get("entries", {})
    changes = {}
    for item in prepared:
        if not item.archive_name.startswith("production/"):
            continue
        entry = entries.get(item.archive_name)
        current_sha = _sha(item.payload)
        if entry is not None and current_sha == entry.get("sha256"):
            continue
        changes[item.archive_name] = _diff(entry, item.payload)
    report = {
        "schema_version": 1,
        "base_version": baseline["base_version"],
        "current_version": baseline["current_version"],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "changes": changes,
    }
    _atomic_json(REPORT_PATH, report)
    return report


def approve(prepared: Iterable[object], reason: str) -> dict:
    baseline = load_baseline()
    verify_archive_history(baseline)
    report = build_report(prepared, baseline)
    if not report["changes"]:
        APPROVAL_PATH.unlink(missing_ok=True)
        return report
    approval = {
        "schema_version": 1,
        "base_version": baseline["base_version"],
        "current_version": baseline["current_version"],
        "reason": reason,
        "created_at": report["created_at"],
        "changes": report["changes"],
    }
    _atomic_json(APPROVAL_PATH, approval)
    return report


def preflight(prepared: Iterable[object], *, approve_reason: str | None = None) -> dict:
    baseline = load_baseline()
    verify_archive_history(baseline)
    report = approve(prepared, approve_reason) if approve_reason else build_report(prepared, baseline)
    changes = report["changes"]
    if not changes:
        return report
    if not APPROVAL_PATH.is_file():
        raise GuardError(
            f"final-state changes require explicit approval; review {REPORT_PATH}"
        )
    approval = json.loads(APPROVAL_PATH.read_text(encoding="utf-8-sig"))
    expected = {
        "schema_version": 1,
        "base_version": baseline["base_version"],
        "current_version": baseline["current_version"],
        "changes": changes,
    }
    for key, value in expected.items():
        if approval.get(key) != value:
            raise GuardError(
                f"final-state approval is stale or does not match {REPORT_PATH}"
            )
    return report


def commit(prepared: Iterable[object], archive: Path, version: str) -> None:
    baseline = load_baseline()
    for item in prepared:
        if not item.archive_name.startswith("production/"):
            continue
        entry = baseline.get("entries", {}).get(item.archive_name)
        logical = entry.get("logical") if entry else None
        if logical is None:
            continue
        snapshot = BASELINE_FILES / (core.sha1_path(logical) + ".orderedmap")
        snapshot.write_bytes(item.payload)
        baseline["entries"][item.archive_name] = {
            "logical": logical,
            "sha256": _sha(item.payload),
            "size": len(item.payload),
            "row_count": len(_rows(item.payload, logical)),
            "rows": _row_hashes(item.payload, logical),
            "snapshot": snapshot.name,
            "source_archive": archive.name,
        }
    blob = archive.read_bytes()
    match = ARCHIVE_RE.match(archive.name)
    baseline["archives"].append({
        "name": archive.name,
        "from": match.group(1) if match else baseline["current_version"],
        "to": match.group(2) if match else version,
        "part": int(match.group(3)) if match else 1,
        "size": len(blob),
        "sha256": _sha(blob),
    })
    baseline["current_version"] = version
    baseline["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    baseline["chain_sha256"] = _sha(
        "\n".join(f"{x['name']}:{x['sha256']}" for x in baseline["archives"]).encode("utf-8")
    )
    _atomic_json(BASELINE_PATH, baseline)
    APPROVAL_PATH.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="1.4.55-anchored final-state guard")
    parser.add_argument("command", choices=("init", "verify"))
    args = parser.parse_args(argv)
    if args.command == "init":
        data = initialize_baseline()
        print(f"[OK] baseline {data['base_version']} -> {data['current_version']}")
        print(f"[OK] archives={len(data['archives'])} tables={len(data['entries'])}")
    else:
        data = load_baseline()
        verify_archive_history(data)
        print(f"[OK] archive history verified: {len(data['archives'])} archives")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
