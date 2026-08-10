#!/usr/bin/env python3
"""Install the transparent 20x20 Ultimate Totem icon."""
from pathlib import Path
import sys

from PIL import Image

TOOLS = Path(r"F:\startpoint-cn-mode15\mod-tools")
SOURCE = Path(r"F:\image\V3\native_20x20_token.png")
LOGICAL = "item/item/mod/fantasy/fantasy_core_token.png"
sys.path.insert(0, str(TOOLS))

import wf_assets  # type: ignore  # noqa: E402
import wf_gui as gui  # type: ignore  # noqa: E402
import wf_quest_lib as q  # type: ignore  # noqa: E402


def main() -> int:
    if not SOURCE.is_file():
        raise SystemExit(f"missing icon: {SOURCE}")
    with Image.open(SOURCE) as image:
        image.load()
        if image.format != "PNG" or image.size != (20, 20):
            raise SystemExit("token icon must be a 20x20 PNG")
        if image.mode != "RGBA":
            raise SystemExit("token icon must use RGBA transparency")
    raw = SOURCE.read_bytes()
    payload = wf_assets.png_encode(raw)
    destination = gui.TARGET_STORE / q.hashed_rel(LOGICAL)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    gui.add_pending(destination)
    print(f"installed {LOGICAL} -> {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
