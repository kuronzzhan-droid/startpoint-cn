#!/usr/bin/env python3
"""Read-only Boss HP audit for the isolated Deep Abyss (700099) project.

The audit deliberately does not write any master table or publish a patch.  It
collects the same candidate pools used by ``wf_rogue_build`` and reports which
Bosses have a readable ``boss_level`` HP baseline, which are standard/client
embedded Bosses, and which fields contain duplicated or phase-linked entities.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

MOD_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(MOD_DIR))

import wf_rogue_build as rb  # noqa: E402


POOL_CATEGORIES = (
    "boss_battle", "hard_multi", "advent", "world_story", "story_event",
    "raid", "expert_single", "solo_time_attack", "world_story_boss",
    "ranking", "carnival",
)


def _classify(code: str, special_tables: dict[str, set[str]]) -> str:
    kinds = [name for name, values in special_tables.items() if code in values]
    return "+".join(kinds) if kinds else "unknown"


def collect() -> list[dict[str, object]]:
    fd = rb._tbl(rb.FIELD_DATA_T)
    zone = rb._tbl(rb.ZONE_T)
    sb = rb._tbl(rb.STANDARD_BOSS)
    gb = rb._tbl(rb.GENERAL_BOSS)
    gz = rb._tbl(rb.GENERAL_ZAKO)
    special = rb.special_boss_levels()
    phase = rb.phase_linked_bosses(fd_t=fd, zone_t=zone)
    boss_names = rb.wb.boss_names()

    special_tables = {
        "general_boss": set(gb),
        "standard_boss": set(sb),
        "general_zako": set(gz),
        "special_level": set(special),
    }

    fields: dict[str, set[str]] = {}
    sources: dict[str, set[str]] = {}
    for cat in POOL_CATEGORIES:
        try:
            entries = rb.quest_pool(cat)
        except Exception:
            entries = []
        for entry in entries:
            field = str(entry.get("field", ""))
            bosses = {str(x) for x in entry.get("bosses", []) if x}
            if field and bosses:
                fields.setdefault(field, set()).update(bosses)
                sources.setdefault(field, set()).add(cat)

    # Include fixed and previously generated fields, so the current 700099
    # floor can always be audited even if its source quest was not in a pool.
    current = rb.q.load_table(rb.Q_QUEST).get(rb.EVENT_ID, {})
    current_fields: dict[str, list[dict[str, object]]] = {}
    for round_key, row in current.items() if isinstance(current, dict) else ():
        if isinstance(row, dict):
            continue
        cols = rb.cells(row)
        if len(cols) <= 98:
            continue
        field = cols[98]
        if not field or field == "(None)":
            continue
        bosses, _ = rb._zone_pick(field)
        if bosses:
            fields.setdefault(field, set()).update(bosses)
            sources.setdefault(field, set()).add("rush_700099")
            current_fields.setdefault(field, []).append({
                "round": int(round_key) if str(round_key).isdigit() else round_key,
                "level": int(cols[95]) if cols[95].isdigit() else None,
                "hp_multiplier": float(cols[86]) if cols[86] else None,
            })

    rows: list[dict[str, object]] = []
    for field in sorted(fields):
        frow = fd.get(field)
        fcols = rb.cells(frow) if isinstance(frow, (str, bytes, bytearray)) else []
        slots = rb.zone_boss_slots(zone.get(fcols[2])) if len(fcols) > 2 else []
        if not slots:
            slots = [{code} for code in sorted(fields[field])]
        # A slot is one physical Boss entity.  Each set contains its
        # single-/multi-battle alternatives, not multiple HP bars.
        bosses = [sorted(slot)[0] for slot in slots]
        slot_labels = ["/".join(sorted(slot)) for slot in slots]
        mode_variants = ["/".join(sorted(slot)) for slot in slots if len(slot) > 1]
        hp_values: list[float] = []
        hp_groups: list[str] = []
        missing: list[str] = []
        for slot, label in zip(slots, slot_labels):
            stats = [rb.true_stat(code, "hp", 100) for code in slot]
            known = [stat for stat in stats if stat is not None]
            if not known:
                missing.append(label)
            else:
                # If the single/multi alternatives differ, use the larger
                # readable value as the conservative calibration baseline.
                stat = max(known, key=lambda x: x[0])
                hp_values.append(float(stat[0]))
                hp_groups.append(str(stat[1]))
        phase_hits = sorted(code for code in set(bosses) if code in phase)
        is_multi = len(slots) > 1
        status = ("unknown" if missing else "known") + ("_multi" if is_multi else "_single")
        if missing:
            risk = "high"
        elif is_multi or phase_hits:
            risk = "medium"
        else:
            risk = "low"
        active = current_fields.get(field, [])
        effective: list[str] = []
        if not missing:
            for rec in active:
                level = rec["level"]
                mult = rec["hp_multiplier"]
                if level is None or mult is None:
                    continue
                values = []
                for slot in slots:
                    stats = [rb.true_stat(code, "hp", level) for code in slot]
                    known = [stat for stat in stats if stat is not None]
                    if not known:
                        values = []
                        break
                    values.append(max(known, key=lambda x: x[0])[0])
                if values:
                    effective.append(f"{rec['round']}:{sum(values) * mult:.3f}")
        rows.append({
            "field": field,
            "source_categories": ";".join(sorted(sources.get(field, set()))),
            "current_rounds": ";".join(str(x["round"]) for x in active),
            "current_enemy_levels": ";".join(str(x["level"]) for x in active),
            "current_hp_multipliers": ";".join(str(x["hp_multiplier"]) for x in active),
            "boss_codes": ";".join(slot_labels),
            "boss_names": ";".join(str(boss_names.get(x, x)).split("/")[0] for x in bosses),
            "boss_entity_count": len(slots),
            "mode_variant_slots": ";".join(mode_variants),
            "phase_linked_bosses": ";".join(phase_hits),
            "boss_types": ";".join(sorted({_classify(x, special_tables) for x in set(bosses)})),
            "known_hp_at_lv100_sum": round(sum(hp_values), 3) if not missing else "",
            "known_hp_at_lv100_max": round(max(hp_values), 3) if hp_values else "",
            "current_effective_known_hp_by_round": ";".join(effective),
            "hp_curve_groups": ";".join(sorted(set(hp_groups))),
            "missing_hp_bosses": ";".join(missing),
            "status": status,
            "risk": risk,
        })
    return rows


def write_outputs(rows: list[dict[str, object]], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0]) if rows else []
    csv_path = out_dir / "boss_hp_audit.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    md_path = out_dir / "boss_hp_audit.md"
    known = sum(str(r["status"]).startswith("known") for r in rows)
    multi = sum(str(r["status"]).endswith("_multi") for r in rows)
    unknown = sum(str(r["status"]).startswith("unknown") for r in rows)
    with md_path.open("w", encoding="utf-8") as fh:
        fh.write("# 深渊连战 Boss 血量审计表\n\n")
        fh.write("本表为只读审计结果，不修改主表、不发布客户端补丁。\n\n")
        fh.write(f"- 场地数：{len(rows)}\n- 可直接归一化单体：{known}\n")
        fh.write(f"- 多实体/阶段：{multi}\n- 缺少可读基础 HP：{unknown}\n\n")
        fh.write("状态说明：`known_single` 可直接按基础 HP 反算；`known_multi` 需要按多个实体的总血条校准；带 `unknown` 的场地需要人工测量或暂时排除。单人/多人代码双列不视为双血条。\n\n")
        fh.write("|当前层|场地|Boss|类型|HP倍率|Lv100可读HP总和|缺少HP|状态|风险|\n|---:|---|---|---|---:|---:|---|---|---|\n")
        for r in rows:
            fh.write("|{rounds}|{field}|{boss_names}|{boss_types}|{mult}|{hp}|{missing}|{status}|{risk}|\n".format(
                rounds=r["current_rounds"] or "—", field=r["field"], boss_names=r["boss_names"],
                boss_types=r["boss_types"], mult=r["current_hp_multipliers"] or "—",
                hp=r["known_hp_at_lv100_sum"], missing=r["missing_hp_bosses"] or "—",
                status=r["status"], risk=r["risk"]))
    print(f"[OK] rows={len(rows)} known={known} multi_or_phase={multi} unknown={unknown}")
    print(f"[OUT] {csv_path}")
    print(f"[OUT] {md_path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=MOD_DIR / "work" / "boss-hp-audit")
    args = ap.parse_args()
    rows = collect()
    write_outputs(rows, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
