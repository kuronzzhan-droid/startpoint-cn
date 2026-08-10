#!/usr/bin/env python3
"""Install the transparent 20x20 Ultimate Totem icon."""
import argparse
import json
import os
from pathlib import Path
import sys

from PIL import Image

TOOLS = Path(__file__).resolve().parent
DEFAULT_SOURCE = TOOLS / "assets" / "mode15-token" / "native_20x20_token.png"
LOGICAL = "item/item/mod/fantasy/fantasy_core_token.png"
sys.path.insert(0, str(TOOLS))


def add_pending(target_store: Path, destination: Path, pending_file: Path) -> None:
    relative = destination.relative_to(target_store).as_posix()
    try:
        items = json.loads(pending_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        items = []
    if relative not in items:
        items.append(relative)
    pending_file.parent.mkdir(parents=True, exist_ok=True)
    pending_file.write_text(json.dumps(items, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(os.environ.get("WF_MODE15_TOKEN_ICON", DEFAULT_SOURCE)),
        help="20x20 RGBA PNG（默认 WF_MODE15_TOKEN_ICON 或工具内 assets/mode15-token）",
    )
    parser.add_argument(
        "--target-store",
        type=Path,
        default=Path(os.environ["WF_TARGET_STORE"])
        if os.environ.get("WF_TARGET_STORE")
        else None,
        help="明确的 production/upload 写入目录（或设置 WF_TARGET_STORE）",
    )
    parser.add_argument(
        "--pending-file",
        type=Path,
        default=TOOLS / "work" / "sync_pending.json",
        help="pending 账本（默认工具 work/sync_pending.json）",
    )
    args = parser.parse_args(argv)
    if args.target_store is None:
        parser.error("写入操作必须提供 --target-store 或 WF_TARGET_STORE")
    target_store = args.target_store.expanduser().resolve()
    if not target_store.is_dir():
        parser.error(f"--target-store 不存在或不是目录: {target_store}")
    source = args.source.expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"missing icon: {source}")
    with Image.open(source) as image:
        image.load()
        if image.format != "PNG" or image.size != (20, 20):
            raise SystemExit("token icon must be a 20x20 PNG")
        if image.mode != "RGBA":
            raise SystemExit("token icon must use RGBA transparency")
    import wf_assets  # type: ignore  # noqa: E402
    import wf_quest_lib as q  # type: ignore  # noqa: E402

    raw = source.read_bytes()
    payload = wf_assets.png_encode(raw)
    destination = target_store / q.hashed_rel(LOGICAL)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    add_pending(target_store, destination, args.pending_file.expanduser().resolve())
    print(f"installed {LOGICAL} -> {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
