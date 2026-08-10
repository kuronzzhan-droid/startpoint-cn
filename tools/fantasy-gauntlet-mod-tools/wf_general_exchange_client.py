#!/usr/bin/env python3
from __future__ import annotations

import csv
import io
import sys
import time
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL_DIR))
import wf_mod_tool as core  # noqa: E402

GENERAL_SHOP = "master/shop/general_shop.orderedmap"
PRODUCT_ID = "9100011"


def decode_row(line: str) -> list[str]:
    return next(csv.reader([line]))


def encode_row(values: list[str]) -> str:
    stream = io.StringIO(newline="")
    csv.writer(stream, lineterminator="").writerow(values)
    return stream.getvalue()


def main() -> int:
    server_root = core.resolve_server_dir()
    profile = core.resolve_profile()
    store_value = core.resolve_active_store(TOOL_DIR.parent, profile=profile)
    if not store_value:
        raise RuntimeError(core.TARGET_STORE_HINT)
    store = Path(store_value).resolve()
    table = core.load_table(GENERAL_SHOP, store)
    rows = table.text_rows()
    if "9100001" not in rows:
        raise KeyError("general shop template 9100001 is missing")

    values = decode_row(rows["9100001"])
    if len(values) != 47:
        raise ValueError(f"unexpected general_shop schema width: {len(values)}")
    values[1] = "经验值 × 5000"
    values[2] = PRODUCT_ID
    values[4] = "8"
    values[5] = "等级强化时用于提升角色等级。获得时会自动积累到Expod里。"
    values[7] = "item/spends/ex_point/ex_point"
    values[8] = "5"
    values[11] = "(None)"
    values[12] = "100000"
    values[13] = "5000"
    for index in range(14, 20):
        values[index] = "(None)" if index % 2 == 0 else ""
    values[20] = "2015-12-31 23:59:59"
    values[21] = "(None)"
    values[22] = "1"
    values[23] = "9999"
    values[24] = "(None)"
    values[25] = "(None)"
    values[26] = "(None)"
    values[27] = "(None)"
    values[28] = "(None)"
    values[29] = "1"
    values[30] = ""
    values[31] = "5000"

    table.set_text_rows({PRODUCT_ID: encode_row(values)})
    suffix = time.strftime(".bak-general-exchange-%Y%m%d-%H%M%S")
    output = core.write_table(table, store, suffix)
    readback = core.load_table(GENERAL_SHOP, store).text_rows()
    if PRODUCT_ID not in readback:
        raise RuntimeError("general shop client row readback failed")
    print(f"[OK] client general shop row {PRODUCT_ID}: {output}")
    print(f"[OK] server root: {server_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
