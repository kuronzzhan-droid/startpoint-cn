#!/usr/bin/env python
"""Install a dedicated Mode15 entry/Rush banner without overwriting official art.

Adapted from the open-source ``wf_rogue_banner.py`` workflow, but targets the
isolated Mode15 carrier (Rush 700098 + EventFolder 2) instead of Abyss 700099.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path

from PIL import Image


EVENT_ID = "700098"
EVENT_FOLDER_ID = "2"
Q_EVENT = "master/quest/event/rush_event.orderedmap"
Q_EVENT_FOLDER = "master/quest/event/event_folder.orderedmap"
MAIN_LOGICAL = "quest/event/banner/rush_event/mod_fifteen_stage_banner_001.png"
MAIN_SIZE = (1000, 184)


def row(value: bytes | str) -> list[str]:
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    return next(csv.reader(io.StringIO(value)))


def join(values: list[str], template: bytes | str) -> bytes | str:
    out = io.StringIO()
    csv.writer(out, lineterminator="").writerow(values)
    value = out.getvalue()
    return value.encode("utf-8") if isinstance(template, bytes) else value


def fit_png(source: Path) -> bytes:
    image = Image.open(source).convert("RGBA")
    if image.size != MAIN_SIZE:
        image = image.resize(MAIN_SIZE, Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--main", required=True, type=Path)
    parser.add_argument("--tools-root", required=True, type=Path)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    tools = args.tools_root.resolve()
    sys.path.insert(0, str(tools))
    import wf_assets as assets
    import wf_mod_tool as core
    import wf_quest_lib as quest

    source = args.main.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    png = fit_png(source)
    no_extension = MAIN_LOGICAL[:-4]

    event_table = quest.load_table(Q_EVENT)
    event_template = event_table[EVENT_ID]
    event_row = row(event_template)
    event_row[3] = ",".join([no_extension] * 3)
    event_table[EVENT_ID] = join(event_row, event_template)

    folder_table = quest.load_table(Q_EVENT_FOLDER)
    folder_template = folder_table[EVENT_FOLDER_ID]
    folder_row = row(folder_template)
    folder_row[1] = no_extension
    folder_table[EVENT_FOLDER_ID] = join(folder_row, folder_template)

    hashed = quest.hashed_rel(MAIN_LOGICAL)
    print(f"[PLAN] {source} -> {MAIN_SIZE[0]}x{MAIN_SIZE[1]} -> {MAIN_LOGICAL}")
    print(f"[PLAN] RushEvent[{EVENT_ID}].banner x3 + EventFolder[{EVENT_FOLDER_ID}].banner")
    if not args.write:
        print("[DRY-RUN] no files written")
        return 0

    profile = core.resolve_profile(None)
    destination = profile.store.joinpath(*hashed.split("/"))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(assets.png_encode(png))
    event_path = quest.save_table(Q_EVENT, event_table)
    folder_path = quest.save_table(Q_EVENT_FOLDER, folder_table)

    pending_path = tools / "work" / "sync_pending.json"
    pending = json.loads(pending_path.read_text("utf-8")) if pending_path.exists() else []
    for item in (
        hashed,
        event_path.relative_to(profile.store).as_posix(),
        folder_path.relative_to(profile.store).as_posix(),
    ):
        if item not in pending:
            pending.append(item)
    pending_path.write_text(json.dumps(pending, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"[OK] wrote banner and two Mode15 table references; pending={len(pending)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
