#!/usr/bin/env python3
"""Stage custom General Shop exchanges for StartPointCN.

Dry-run is the default. Pass --write to update the server asset files.
This tool deliberately does not publish an asset patch or edit manifest.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SHOP_ITEM_ID = 9_100_011
FORGING_STONE_ITEM_ID = 100_000
FORGING_STONE_COST = 5_000
EXP_REWARD_TYPE = 1
EXP_REWARD_COUNT = 5_000
STOCK = 9_999


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path: Path, value) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def desired_shop_item() -> dict:
    return {
        "costs": [{"id": FORGING_STONE_ITEM_ID, "amount": FORGING_STONE_COST}],
        "rewards": [{"type": EXP_REWARD_TYPE, "count": EXP_REWARD_COUNT}],
        "availableFrom": "2015-12-31 23:59:59",
        "availableUntil": None,
        "stock": STOCK,
    }


def stage(server_root: Path, write: bool) -> bool:
    assets = server_root / "assets"
    shop_path = assets / "general_shop.json"
    whitelist_path = assets / "cdn_general_shop_whitelist.json"

    shop = load_json(shop_path)
    whitelist = load_json(whitelist_path)
    if not isinstance(shop, dict):
        raise TypeError(f"{shop_path} must contain an object")
    if not isinstance(whitelist, list):
        raise TypeError(f"{whitelist_path} must contain an array")

    key = str(SHOP_ITEM_ID)
    wanted = desired_shop_item()
    shop_changed = shop.get(key) != wanted
    whitelist_changed = SHOP_ITEM_ID not in whitelist

    shop[key] = wanted
    whitelist = sorted({int(item_id) for item_id in whitelist} | {SHOP_ITEM_ID})

    print(f"general_shop item {SHOP_ITEM_ID}: {'update' if shop_changed else 'ok'}")
    print(
        f"  forging stone {FORGING_STONE_ITEM_ID} x{FORGING_STONE_COST}"
        f" -> EXP x{EXP_REWARD_COUNT}; stock={STOCK}"
    )
    print(
        f"general-shop whitelist: "
        f"{'append' if whitelist_changed else 'ok'}"
    )

    changed = shop_changed or whitelist_changed
    if write and changed:
        dump_json(shop_path, shop)
        dump_json(whitelist_path, whitelist)
        print("wrote server asset files; no client patch was published")
    elif changed:
        print("dry-run only; pass --write to apply")
    else:
        print("already staged; no files changed")
    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-root", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    stage(args.server_root.resolve(), args.write)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
