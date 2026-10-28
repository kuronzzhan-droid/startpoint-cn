"""Generate server and CAS overlays from one reviewed spec; never publish."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_INT = 2147483647
PREFIX = "continue_cost_"


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate key: {key}")
        result[key] = value
    return result


def validate_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError("spec must be a quest-id object")
    for quest_id, cost in spec.items():
        if not re.fullmatch(r"[1-9][0-9]{0,9}", quest_id) or int(quest_id) > MAX_INT:
            raise ValueError(f"invalid quest id: {quest_id}")
        if not isinstance(cost, dict) or set(cost) != {"item_id", "amount"}:
            raise ValueError(f"{quest_id}: expected item_id and amount only")
        for field in ("item_id", "amount"):
            value = cost[field]
            if type(value) is not int or not 1 <= value <= MAX_INT:
                raise ValueError(f"{quest_id}.{field}: positive int32 required")
    return {key: spec[key] for key in sorted(spec, key=int)}


def encode_json(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def make_outputs(spec_path):
    raw = spec_path.read_bytes()
    spec = validate_spec(json.loads(raw.decode("utf-8-sig"), object_pairs_hook=unique_object))
    values = {PREFIX + key: f"{cost['item_id']}:{cost['amount']}" for key, cost in spec.items()}
    # Rows are a merge overlay, never a replacement for the complete CAS table.
    rows = {key: [value] for key, value in values.items()}
    outputs = {
        "work/server/assets/continue_cost.json": encode_json(spec),
        "generated/client-cas-values.json": encode_json(values),
        "generated/client-cas-rows.json": encode_json(rows),
    }
    manifest = {
        "schema": "continue-cost-v1",
        "spec_sha256": sha(raw),
        "quest_count": len(spec),
        "key_prefix": PREFIX,
        "client_table": "master/string/custom_ability_string.orderedmap",
        "mode": "merge rows by key; remove obsolete continue_cost_ keys",
        "keys": list(values),
        "files": {path: sha(content) for path, content in outputs.items()},
    }
    outputs["generated/config-manifest.json"] = encode_json(manifest)
    return outputs


def write_outputs(outputs, check=False):
    mismatches = []
    for relative, content in outputs.items():
        destination = (ROOT / relative).resolve()
        if not destination.is_relative_to(ROOT):
            raise ValueError("output outside workspace")
        if check:
            if not destination.is_file() or destination.read_bytes() != content:
                mismatches.append(relative)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
    if mismatches:
        raise ValueError("generated files differ: " + ", ".join(mismatches))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=ROOT / "config/continue-cost.spec.json")
    parser.add_argument("--check", action="store_true", help="read-only consistency check")
    args = parser.parse_args()
    outputs = make_outputs(args.spec)
    write_outputs(outputs, args.check)
    print(json.dumps({"status": "PASS", "action": "check" if args.check else "generate",
                      "files": list(outputs)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
