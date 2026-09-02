#!/usr/bin/env python3
"""Fail-closed guard: the page-title key used by surgery D must exist in the
CN `ui_string` master table.

WHY THIS EXISTS (found by adversarial review, 2026-08-27)
---------------------------------------------------------
`RichTextDataSceneView.run` does not print the title literally.  It calls
`view.asset.getUiString(peek.title)`, and that resolves through:

    getUiString(key)
      -> UiStringTable.data.get(key)                 (MasterMapBase.get)
      -> IMasterBinaryMap.getIndex(key)              (MasterBinaryMap.getIndex)

`MasterBinaryMap.getIndex` on a MISSING key does **not** degrade to a blank or
stale title.  Disassembled from the shipped SWF (method 6092)::

    ifnlt        +68                       ; if index >= 0 skip the whole block
    getlex       pinball.asset::FileUtilCommon
    getproperty  ::extraInfo
    pushstring   ','
    callproperty ::split, 1
    callpropvoid ::deleteFile, 2           ; <-- DELETES THE MASTER FILE
    findpropstrict pinball.error::ClientError
    pushint      8601
    pushstring   '指定的Key不存在。key='
    constructprop pinball.error::ClientError, 2
    throw                                  ; <-- ClientError 8601

So a wrong title key costs a crash *and* the deletion of cached master data --
not a cosmetic fallback.  The original build report only proved the key was
ABSENT FROM THE SWF STRING POOL (a statement about the constant-pool delta),
which is a different question and does not bear on runtime safety at all.

This guard checks the thing that actually matters, and fails the build if it
cannot be proven.  Run standalone, or via build_rank_scene_p2.py /
verify_rank_scene_p2.py, both of which call `assert_title_keys_shippable()`.
"""

from __future__ import annotations

import json
import re
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
MOD_TOOLS = REPO / "mod-tools"

UI_STRING_LOGICAL = "master/string/ui_string.orderedmap"

# A key that must NOT exist.  Without this control, a lookup that silently
# returned "present" for everything would sail through the guard.
NEGATIVE_CONTROL = "wf_rank_page_guard_key_that_must_not_exist"


class TitleKeyError(RuntimeError):
    pass


def _store_root() -> Path:
    """Resolve the CN store the same way mod-tools does (profiles.json)."""
    profiles = MOD_TOOLS / "profiles.json"
    if not profiles.exists():
        raise TitleKeyError(f"mod-tools/profiles.json not found at {profiles}")
    cfg = json.loads(profiles.read_text(encoding="utf-8"))
    active = cfg.get("active")
    entry = cfg.get("profiles", {}).get(active)
    if not entry or not entry.get("store"):
        raise TitleKeyError(f"profiles.json has no store for active profile {active!r}")
    store = (REPO / entry["store"]).resolve()
    if not store.is_dir():
        raise TitleKeyError(
            f"CN store not found: {store}\n"
            "The title-key invariant cannot be proven without it; refusing to "
            "build.  (A wrong ui_string key = ClientError 8601 + master file "
            "deletion on the device.)"
        )
    return store


def load_ui_string() -> dict[str, str]:
    """key -> value for the whole CN ui_string table."""
    sys.path.insert(0, str(MOD_TOOLS))
    import wf_mod_tool as core  # noqa: E402  (path set above)

    table = core.table_path(_store_root(), UI_STRING_LOGICAL)
    if not table.exists():
        raise TitleKeyError(f"ui_string table missing from store: {table}")
    ordered = core.read_orderedmap_file_raw_rows(table, UI_STRING_LOGICAL)
    out: dict[str, str] = {}
    for key, row in zip(ordered.keys, ordered.rows):
        try:
            out[key] = zlib.decompress(row).decode("utf-8")
        except Exception:
            out[key] = ""
    return out


def _keys_under_test() -> dict[str, str]:
    """Pull the title keys straight out of patch_rank_scene.py.

    Read from the patcher rather than restated here, so editing D_REPLACEMENT
    cannot drift away from what this guard checks.
    """
    sys.path.insert(0, str(HERE))
    import patch_rank_scene as patcher  # noqa: E402

    found = {}
    for label, source in (("replacement", patcher.D_REPLACEMENT),
                          ("anchor", patcher.D_ANCHOR)):
        m = re.fullmatch(r'pushstring "([^"]+)"', source.strip())
        if not m:
            raise TitleKeyError(f"cannot parse {label} instruction: {source!r}")
        found[label] = m.group(1)
    return found


def assert_title_keys_shippable(verbose: bool = True) -> dict:
    """Raise TitleKeyError unless every title key resolves in ui_string."""
    table = load_ui_string()
    keys = _keys_under_test()

    if NEGATIVE_CONTROL in table:
        raise TitleKeyError(
            "positive control failed: the deliberately bogus key "
            f"{NEGATIVE_CONTROL!r} was reported present, so a 'key exists' "
            "answer from this table proves nothing."
        )

    missing = {label: key for label, key in keys.items() if key not in table}
    if missing:
        raise TitleKeyError(
            "ui_string key(s) missing from the CN master table: "
            + ", ".join(f"{label}={key!r}" for label, key in missing.items())
            + "\nShipping this would crash the client with ClientError 8601 AND "
              "delete its cached master file (MasterBinaryMap.getIndex calls "
              "FileUtilCommon.deleteFile before throwing)."
        )

    result = {
        "ui_string_total_keys": len(table),
        "negative_control_absent": True,
        "keys": {label: {"key": key, "value": table[key]}
                 for label, key in keys.items()},
    }
    if verbose:
        print(f"ui_string table: {len(table)} keys "
              f"(negative control {NEGATIVE_CONTROL!r} correctly absent)")
        for label, info in result["keys"].items():
            print(f"  OK  {label:12s} {info['key']!r} = {info['value']!r}")
        print("title-key invariant holds: surgery D cannot trigger ClientError 8601")
    return result


if __name__ == "__main__":
    try:
        assert_title_keys_shippable()
    except TitleKeyError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
    raise SystemExit(0)
