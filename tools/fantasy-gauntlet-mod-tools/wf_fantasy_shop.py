#!/usr/bin/env python3
"""Build the formal Fantasy Rush weapon shop in both event entry points.

The client needs separate rows for the Rush (solo) and Advent (multiplayer)
shop screens.  The server keeps the rows separate too, while ``shop.ts`` maps
each pair to one private purchase counter so stock is shared across screens.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import tempfile
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODULE_DIR.parent if MODULE_DIR.name == "mod-tools" else MODULE_DIR
TOOLS_DIR = PROJECT_ROOT / "mod-tools"
SERVER_ASSETS = PROJECT_ROOT / "server" / "assets"
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(TOOLS_DIR))

import wf_mod_tool as core  # type: ignore  # noqa: E402
import wf_quest_lib as q  # type: ignore  # noqa: E402
import wf_gui as gui  # type: ignore  # noqa: E402
from build_fantasy_weapon_candidates import WEAPONS  # noqa: E402


SHOP_LOGICAL = "master/shop/event_item_shop.orderedmap"
SHOP_TEMPLATE = "310200"
TOKEN_ID = 2370098
PRICE = 99
STOCK = 1
AVAILABLE_FROM = "2000-01-01 12:00:00"
AVAILABLE_UNTIL = "2099-12-31 11:59:59"
MULTI_EVENT_ID = 300098
RUSH_EVENT_ID = 700098
MULTI_CLIENT_KIND = "0"
RUSH_CLIENT_KIND = "6"
MULTI_SERVER_TYPE = "0"
RUSH_SERVER_TYPE = "11"
PLACEHOLDER_IDS = ("9700098", "9700099")
MULTI_SHOP_IDS = tuple(str(9_700_201 + i) for i in range(len(WEAPONS)))
RUSH_SHOP_IDS = tuple(str(9_700_301 + i) for i in range(len(WEAPONS)))
ALL_SHOP_IDS = MULTI_SHOP_IDS + RUSH_SHOP_IDS
DESCRIPTION = "幻想连战专属武器。单人和多人商店共用库存，每件限购1次。"


def _leaf_text(leaf: bytes | str) -> str:
    return leaf.decode("utf-8") if isinstance(leaf, bytes) else leaf


def _single_row(leaf: bytes | str) -> tuple[list[str], bytes | str]:
    rows = core.read_csv_lines(_leaf_text(leaf))
    if len(rows) != 1:
        raise ValueError("event_item_shop leaf must contain one row")
    return list(rows[0]), leaf


def _join_like(row: list[str], template: bytes | str) -> bytes | str:
    text = core.write_csv_lines([row])
    return text.encode("utf-8") if isinstance(template, bytes) else text


def _sort_numeric(value):
    if isinstance(value, dict):
        items = list(value.items())
        if items and all(isinstance(k, str) and k.isdigit() for k, _ in items):
            items.sort(key=lambda item: int(item[0]))
        return {k: _sort_numeric(v) for k, v in items}
    if isinstance(value, list):
        return [_sort_numeric(v) for v in value]
    return value


def shop_pairs():
    return tuple(
        (MULTI_SHOP_IDS[i], RUSH_SHOP_IDS[i], spec)
        for i, spec in enumerate(WEAPONS)
    )


def _client_leaf(template: bytes | str, shop_id: str, spec: dict,
                 slot: int, client_kind: str, event_id: int) -> bytes | str:
    row, template_leaf = _single_row(template)
    row = core.normalize_row_length(row, 51)
    if len(row) != 51:
        raise ValueError("event_item_shop template is not 51 columns")
    fixed = {
        0: client_kind,
        1: str(event_id),
        2: "0",
        7: spec["name"],
        8: shop_id,
        9: "1",
        10: str(slot),
        11: DESCRIPTION,
        13: f"item/equipment/mod/fantasy/{spec['image_slug']}",
        14: "5",
        18: str(TOKEN_ID),
        19: str(PRICE),
        26: AVAILABLE_FROM,
        27: AVAILABLE_UNTIL,
        28: "0",
        29: str(STOCK),
        30: str(STOCK),
        31: "(None)",
        32: "4",
        33: spec["id"],
        34: "1",
        50: "false",
    }
    for index, value in fixed.items():
        row[index] = value
    return _join_like(row, template_leaf)


def build_client_shop(table: dict) -> dict:
    if SHOP_TEMPLATE not in table:
        raise KeyError(f"missing shop template {SHOP_TEMPLATE}")
    result = copy.deepcopy(table)
    for key in PLACEHOLDER_IDS + ALL_SHOP_IDS:
        result.pop(key, None)
    template = table[SHOP_TEMPLATE]
    for slot, (multi_id, rush_id, spec) in enumerate(shop_pairs(), start=1):
        result[multi_id] = _client_leaf(
            template, multi_id, spec, slot, MULTI_CLIENT_KIND, MULTI_EVENT_ID
        )
        result[rush_id] = _client_leaf(
            template, rush_id, spec, slot, RUSH_CLIENT_KIND, RUSH_EVENT_ID
        )
    return result


def _product(spec: dict) -> dict:
    return {
        "costs": [{"id": TOKEN_ID, "amount": PRICE}],
        "rewards": [{"type": 4, "id": int(spec["id"]), "count": 1}],
        "availableFrom": AVAILABLE_FROM,
        "availableUntil": AVAILABLE_UNTIL,
        "stock": STOCK,
    }


def _walk_products(shop: dict):
    for event_type, events in shop.items():
        if not isinstance(events, dict):
            continue
        for event_id, products in events.items():
            if isinstance(products, dict):
                yield str(event_type), str(event_id), products


def build_server_shop(shop: dict, id_map: dict) -> tuple[dict, dict]:
    result_shop = copy.deepcopy(shop)
    result_map = copy.deepcopy(id_map)
    owned = set(PLACEHOLDER_IDS + ALL_SHOP_IDS)
    for event_type, event_id, products in _walk_products(result_shop):
        for key in tuple(owned):
            if key in products:
                permitted = (
                    key in PLACEHOLDER_IDS
                    or (key in MULTI_SHOP_IDS and event_type == MULTI_SERVER_TYPE
                        and event_id == str(MULTI_EVENT_ID))
                    or (key in RUSH_SHOP_IDS and event_type == RUSH_SERVER_TYPE
                        and event_id == str(RUSH_EVENT_ID))
                )
                if not permitted:
                    raise ValueError(f"reserved shop id collision: {key} at {event_type}/{event_id}")
                products.pop(key, None)
    for key in owned:
        result_map.pop(key, None)

    multi_products = result_shop.setdefault(MULTI_SERVER_TYPE, {}).setdefault(
        str(MULTI_EVENT_ID), {}
    )
    rush_products = result_shop.setdefault(RUSH_SERVER_TYPE, {}).setdefault(
        str(RUSH_EVENT_ID), {}
    )
    for multi_id, rush_id, spec in shop_pairs():
        product = _product(spec)
        multi_products[multi_id] = copy.deepcopy(product)
        rush_products[rush_id] = copy.deepcopy(product)
        result_map[multi_id] = {
            "eventType": int(MULTI_SERVER_TYPE), "eventId": MULTI_EVENT_ID
        }
        result_map[rush_id] = {
            "eventType": int(RUSH_SERVER_TYPE), "eventId": RUSH_EVENT_ID
        }
    return _sort_numeric(result_shop), _sort_numeric(result_map)


def validate(client: dict, shop: dict, id_map: dict) -> None:
    for key in PLACEHOLDER_IDS:
        if key in client or key in id_map:
            raise ValueError(f"placeholder shop id remains: {key}")
        if any(key in products for _, _, products in _walk_products(shop)):
            raise ValueError(f"placeholder server product remains: {key}")
    if any(key not in client for key in ALL_SHOP_IDS):
        raise ValueError("one or more formal client products are missing")
    multi = shop[MULTI_SERVER_TYPE][str(MULTI_EVENT_ID)]
    rush = shop[RUSH_SERVER_TYPE][str(RUSH_EVENT_ID)]
    for slot, (multi_id, rush_id, spec) in enumerate(shop_pairs(), start=1):
        expected = _product(spec)
        if multi.get(multi_id) != expected or rush.get(rush_id) != expected:
            raise ValueError(f"server product pair mismatch for {spec['id']}")
        if id_map.get(multi_id) != {"eventType": 0, "eventId": MULTI_EVENT_ID}:
            raise ValueError(f"bad id map: {multi_id}")
        if id_map.get(rush_id) != {"eventType": 11, "eventId": RUSH_EVENT_ID}:
            raise ValueError(f"bad id map: {rush_id}")
        for shop_id, kind, event_id in (
            (multi_id, MULTI_CLIENT_KIND, MULTI_EVENT_ID),
            (rush_id, RUSH_CLIENT_KIND, RUSH_EVENT_ID),
        ):
            row, _ = _single_row(client[shop_id])
            checks = {
                0: kind, 1: str(event_id), 7: spec["name"], 8: shop_id,
                10: str(slot), 18: str(TOKEN_ID), 19: str(PRICE),
                29: str(STOCK), 30: str(STOCK), 32: "4", 33: spec["id"],
            }
            for index, expected_value in checks.items():
                if row[index] != expected_value:
                    raise ValueError(f"client {shop_id} c{index} mismatch")


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _save_json(path: Path, value) -> None:
    _atomic_write(
        path,
        (json.dumps(_sort_numeric(value), ensure_ascii=False, indent=4) + "\n").encode("utf-8"),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    client_before = q.load_table(SHOP_LOGICAL)
    shop_path = SERVER_ASSETS / "event_item_shop.json"
    map_path = SERVER_ASSETS / "event_item_shop_id_map.json"
    shop_before = _load_json(shop_path)
    map_before = _load_json(map_path)
    client_after = build_client_shop(client_before)
    shop_after, map_after = build_server_shop(shop_before, map_before)
    validate(client_after, shop_after, map_after)
    print(f"[PLAN] 11 weapons; ids 100013..100023; price={PRICE}; stock={STOCK}")
    print("[PLAN] 22 client rows; paired inventory counters are implemented in server shop.ts")
    if not args.write:
        print("[DRY-RUN] no files written")
        return 0

    targets = (Path(q.store_path(SHOP_LOGICAL)), shop_path, map_path)
    before = {path: (path.exists(), path.read_bytes() if path.exists() else None) for path in targets}
    try:
        q.save_table(SHOP_LOGICAL, client_after)
        gui.add_pending(Path(q.store_path(SHOP_LOGICAL)))
        _save_json(shop_path, shop_after)
        _save_json(map_path, map_after)
        validate(q.load_table(SHOP_LOGICAL), _load_json(shop_path), _load_json(map_path))
    except BaseException:
        for path, (existed, payload) in before.items():
            if existed and payload is not None:
                _atomic_write(path, payload)
            elif path.exists():
                path.unlink()
        raise
    print("[OK] formal Fantasy Rush shop written and read back")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
