#!/usr/bin/env python3
"""Build the 11 integrated Fantasy Rush weapon candidates.

The candidates reserve their final ID range and install one independent icon
for each weapon.  The ability-soul rows carry the weapon's level-1 -> level-5
interpolation; the server dissolve metadata makes every awakening generate the
same-ID soul, which the client evaluates at the row's level-1 value.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sys
import time
from pathlib import Path

from PIL import Image, UnidentifiedImageError


SOURCE_WEAPON = "5005000"
EQUIPMENT_STATUS_LOGICAL = "master/item/equipment_status.orderedmap"
ITEM_LOGICAL = "master/item/item.orderedmap"
IMAGE_PREFIX = "item/equipment/mod/fantasy"
LEGACY_WEAPON_IDS = tuple(str(value) for value in range(8_000_201, 8_000_212))
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CLIENT_ASSET_SIZE = (20, 20)
SOURCE_ASSET_SIZE = CLIENT_ASSET_SIZE
MODE15_RESTRICTION = "※仅可在「幻想连战」中使用。"

WEAPONS = (
    {
        "id": "100013",
        "image_slug": "skill_core",
        "name": "幻星术式核心",
        "description": "技能伤害与技能发动叠层；发动技能时为全队充能。",
        "case": "skill_core",
        "base_hp": 540,
        "base_attack": 580,
    },
    {
        "id": "100014",
        "image_slug": "direct_blade",
        "name": "双星追迹刃",
        "description": "强化全队直接攻击；发动技能时赋予全队20秒双击效果。",
        "case": "direct_blade",
        "base_hp": 510,
        "base_attack": 600,
    },
    {
        "id": "100015",
        "image_slug": "powerflip_hammer",
        "name": "坠星破界锤",
        "description": "强化三级强化弹射、降低所需连击并在发动后追加15 COMBO。",
        "case": "powerflip_hammer",
        "base_hp": 599,
        "base_attack": 520,
    },
    {
        "id": "100016",
        "image_slug": "multiball_hangar",
        "name": "群星自律机库",
        "description": "强化所有协力球；场上协力球达到2个时强化全队，消失时回充。",
        "case": "multiball_hangar",
        "base_hp": 580,
        "base_attack": 500,
    },
    {
        "id": "100017",
        "image_slug": "ability_terminal",
        "name": "因果演算终端",
        "description": "强化能力伤害并叠层；能力伤害时追加全体光属性能力追击。",
        "case": "ability_terminal",
        "base_hp": 500,
        "base_attack": 590,
    },
    {
        "id": "100018",
        "image_slug": "fever_ring",
        "name": "热寂共鸣环",
        "description": "延长Fever并强化Fever队伍；发动技能时提升Fever获取量。",
        "case": "fever_ring",
        "base_hp": 550,
        "base_attack": 540,
    },
    {
        "id": "100019",
        "image_slug": "adversity_sword",
        "name": "半月蚀心剑",
        "description": "开场使全队损失最大HP的50%，在低血量时大幅强化队伍。",
        "case": "adversity_sword",
        "base_hp": 590,
        "base_attack": 510,
    },
    {
        "id": "100020",
        "image_slug": "flying_wing",
        "name": "天穹无坠之翼",
        "description": "延长浮游并强化浮游队伍；浮游中每30连击为全队充能。",
        "case": "flying_wing",
        "base_hp": 520,
        "base_attack": 570,
    },
    {
        "id": "100021",
        "image_slug": "revival_staff",
        "name": "冥灯返魂杖",
        "description": "降低棺柩计数；复活时强化队伍并恢复复活角色生命与技能槽。",
        "case": "revival_staff",
        "base_hp": 570,
        "base_attack": 530,
    },
    {
        "id": "100022",
        "image_slug": "piercing_lance",
        "name": "无界贯星枪",
        "description": "开场获得长时间且不可驱散的贯通；贯通期间强化队伍与自身直接攻击。",
        "case": "piercing_lance",
        "base_hp": 530,
        "base_attack": 560,
    },
    {
        "id": "100023",
        "image_slug": "six_element_wheel",
        "name": "六相万华轮",
        "description": "按队伍属性种类强化全队，并提供开局技能槽和充能速度。",
        "case": "six_element_wheel",
        "base_hp": 560,
        "base_attack": 550,
    },
)


def load_modules(tools: Path):
    sys.path.insert(0, str(tools))
    import wf_describe as describe  # type: ignore
    import wf_gui as gui  # type: ignore
    import wf_mod_tool as core  # type: ignore
    import wf_assets  # type: ignore
    import wf_quest_lib as quest_lib  # type: ignore

    return gui, core, describe, quest_lib, wf_assets


def validate_source_assets(asset_dir: Path) -> dict[str, Path]:
    """Validate the exact 11 master PNGs and return them by image slug."""
    expected = {f"{spec['image_slug']}.png" for spec in WEAPONS}
    if not asset_dir.is_dir():
        raise ValueError(f"missing Fantasy weapon icon directory: {asset_dir}")
    actual = {path.name for path in asset_dir.iterdir() if path.is_file()}
    missing = sorted(expected.difference(actual))
    unexpected = sorted(actual.difference(expected))
    if missing or unexpected:
        raise ValueError(
            "Fantasy icon directory must contain exactly the 11 canonical PNGs: "
            f"missing={missing}, unexpected={unexpected}"
        )

    sources: dict[str, Path] = {}
    digests: dict[str, str] = {}
    for spec in WEAPONS:
        slug = spec["image_slug"]
        source = asset_dir / f"{slug}.png"
        raw = source.read_bytes()
        if raw[:8] != PNG_SIGNATURE:
            raise ValueError(f"{source.name} is not a standard PNG")
        try:
            with Image.open(io.BytesIO(raw)) as image:
                image.load()
                if image.format != "PNG":
                    raise ValueError(f"{source.name} is not decoded as PNG")
                if image.size != SOURCE_ASSET_SIZE:
                    raise ValueError(
                        f"{source.name} must be 20x20, got "
                        f"{image.size[0]}x{image.size[1]}"
                    )
                if image.mode != "RGBA":
                    raise ValueError(f"{source.name} must be RGBA, got {image.mode}")
                alpha = image.getchannel("A")
                alpha_min, alpha_max = alpha.getextrema()
                if alpha_min != 0 or alpha_max <= 0:
                    raise ValueError(
                        f"{source.name} must contain both transparent and visible pixels"
                    )
                bounds = alpha.getbbox()
                if bounds is None:
                    raise ValueError(f"{source.name} has no visible pixels")
                left, top, right, bottom = bounds
                if min(left, top, SOURCE_ASSET_SIZE[0] - right,
                       SOURCE_ASSET_SIZE[1] - bottom) < 1:
                    raise ValueError(f"{source.name} must keep a 1px transparent margin")
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError(f"cannot decode {source.name}: {exc}") from exc

        digest = hashlib.sha256(raw).hexdigest()
        duplicate = digests.get(digest)
        if duplicate is not None:
            raise ValueError(f"duplicate icon content: {duplicate}.png and {source.name}")
        digests[digest] = slug
        sources[slug] = source
    return sources


def render_client_icon(source: Path) -> bytes:
    """Return the native 20px pixel-art icon without resampling it."""
    return source.read_bytes()


def install_source_assets(gui, quest_lib, wf_assets, sources: dict[str, Path]) -> list[str]:
    """Encode, install, and register all independent icons for publication."""
    rendered = {
        spec["image_slug"]: render_client_icon(sources[spec["image_slug"]])
        for spec in WEAPONS
    }
    installed: list[str] = []
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for spec in WEAPONS:
        slug = spec["image_slug"]
        logical = f"{IMAGE_PREFIX}/{slug}.png"
        relative = quest_lib.hashed_rel(logical)
        destination = gui.TARGET_STORE / relative
        stored = wf_assets.png_encode(rendered[slug])
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_file() and destination.read_bytes() != stored:
            shutil.copy2(
                destination,
                destination.with_name(
                    destination.name + ".bak-wfmod-fantasy-icons-" + stamp
                ),
            )
        destination.write_bytes(stored)
        if wf_assets.png_decode(destination.read_bytes()) != rendered[slug]:
            raise RuntimeError(f"icon write/readback mismatch: {logical}")
        gui.add_pending(destination)
        installed.append(relative)
    if len(installed) != len(WEAPONS) or len(set(installed)) != len(WEAPONS):
        raise RuntimeError("Fantasy weapon icons did not map to 11 unique paths")
    return installed


def audit_assets(gui, quest_lib, wf_assets, sources: dict[str, Path]) -> dict:
    result = {}
    for spec in WEAPONS:
        slug = spec["image_slug"]
        logical = f"{IMAGE_PREFIX}/{slug}.png"
        relative = quest_lib.hashed_rel(logical)
        destination = gui.TARGET_STORE / relative
        expected = render_client_icon(sources[slug])
        installed = destination.is_file()
        matches = False
        if installed:
            try:
                matches = wf_assets.png_decode(destination.read_bytes()) == expected
            except (OSError, ValueError):
                matches = False
        result[spec["id"]] = {
            "source": str(sources[slug]),
            "source_sha256": hashlib.sha256(sources[slug].read_bytes()).hexdigest(),
            "logical": logical,
            "relative": relative,
            "client_size": list(CLIENT_ASSET_SIZE),
            "installed": installed,
            "matches": matches,
        }
    return result


def _blocks(describe) -> dict[str, int]:
    return {k: int(v) for k, v in describe.layout("ability_soul")["blocks"].items()}


def _limit(row: list[str], tbase: int, count: int | None) -> None:
    if count is not None:
        row[tbase + 7] = str(count)


def _cooldown(row: list[str], tbase: int, frames: int | None) -> None:
    if frames is not None:
        row[tbase + 8] = str(frames)


def _trigger_party(row: list[str], tbase: int) -> None:
    row[tbase + 1] = "5"
    row[tbase + 2] = "(None)"


def _trigger_revived_member(row: list[str], tbase: int) -> None:
    """Use the native Revival puller so one revival is counted once globally."""
    row[tbase + 1] = "7"
    row[tbase + 2] = "(None)"


def _status_tail(
    row: list[str], cbase: int, seconds: float, *, clear_strength: bool = False
) -> None:
    if clear_strength:
        row[cbase + 4] = row[cbase + 5] = ""
    duration = str(int(seconds * 6_000_000))
    row[cbase + 10] = row[cbase + 11] = duration
    row[cbase + 12] = row[cbase + 13] = "100000"
    row[cbase + 14] = "(None)"
    row[cbase + 15] = "(None)"
    row[cbase + 16] = "(None)"
    row[cbase + 17] = "(None)"
    row[cbase + 18] = "(None)"
    row[cbase + 20] = "0"
    row[cbase + 25] = "false"


def _instant(
    gui,
    *,
    trigger: str = "0",
    effect: str,
    unit: str = "pct",
    value: float,
    value_max: float | None = None,
    threshold: float | None = None,
    target: str = "0",
    groups: str = "",
    precondition: str | None = None,
) -> list[str]:
    return gui.composer_generate(
        "S:" + SOURCE_WEAPON,
        mode="instant",
        trigger_kind=trigger,
        effect_kind=effect,
        effect_unit=unit,
        value=value,
        value_max=value if value_max is None else value_max,
        threshold=threshold,
        target=target,
        groups=groups,
        precondition_kind=precondition,
    )["row"]


def _during(
    gui,
    *,
    trigger: str,
    effect: str,
    value: float,
    value_max: float,
    threshold: float | None = None,
    threshold_unit: str = "count",
    target: str = "0",
    groups: str = "",
) -> list[str]:
    return gui.composer_generate(
        "S:" + SOURCE_WEAPON,
        mode="during",
        trigger_kind=trigger,
        effect_kind=effect,
        effect_unit="pct",
        value=value,
        value_max=value_max,
        threshold=threshold,
        threshold_unit=threshold_unit,
        target=target,
        groups=groups,
    )["row"]


def make_rows(gui, core, describe) -> dict[str, list[list[str]]]:
    b = _blocks(describe)
    tbase = b["instant_trigger"]
    cbase = b["instant_content"]
    dbase = b["during_trigger"]

    # 1. Skill damage.
    skill_base = _instant(gui, effect="34", value=200, value_max=400)
    skill_stack = _instant(
        gui, trigger="23", effect="34", value=40, value_max=80, threshold=1
    )
    _limit(skill_stack, tbase, 10)
    skill_gauge = _instant(
        gui,
        trigger="23",
        effect="211",
        value=10,
        value_max=20,
        threshold=1,
        target="5",
        groups="(None)",
    )
    _limit(skill_gauge, tbase, 18)

    # 2. Direct attack and the validated 20-second party double-hit status.
    direct_base = _instant(
        gui, effect="33", value=250, value_max=1200, target="5", groups="(None)"
    )
    direct_stack = _instant(
        gui,
        trigger="20",
        effect="33",
        value=60,
        value_max=120,
        threshold=30,
        target="5",
        groups="(None)",
    )
    _limit(direct_stack, tbase, 10)
    double_hit = _instant(
        gui,
        trigger="23",
        effect="223",
        value=10,
        value_max=20,
        threshold=1,
        target="5",
        groups="(None)",
    )
    _status_tail(double_hit, cbase, 20)
    double_hit[cbase + 27] = "1"
    double_hit[cbase + 28] = "0"

    # 3. Power flip.
    pf_base = _instant(gui, effect="55", value=500, value_max=1000)
    pf_stack = _instant(
        gui, trigger="65", effect="55", value=20, value_max=40, threshold=1
    )
    _limit(pf_stack, tbase, 20)
    # Reuse the complete native equipment-soul row.  This common battle
    # effect intentionally leaves several optional columns blank; a generic
    # composer row can display correctly without behaving identically.
    native_soul = core.load_table(gui.SOUL_LOGICAL, gui.TARGET_STORE, gui.SOURCE_STORE)
    pf_count_down = list(gui._read_ml(native_soul.text_rows()["5070017"])[1])
    pf_count_down[cbase + 4] = "100000"
    pf_count_down[cbase + 5] = "500000"
    pf_combo = _instant(
        gui, trigger="65", effect="226", unit="count", value=15, threshold=1
    )
    # Official AddCombo rows leave the content target Option empty.
    pf_combo[cbase + 1] = ""

    # 4. All multiballs. Native equipment 4030008 uses generic AttackPoint
    # and Hp with target kind 8 (all multiballs). SpecificMultiball effects
    # require exactly one OrCharacterGroup and therefore cannot represent
    # the intended generic effect without C2038.
    native_multiball_rows = gui._read_ml(native_soul.text_rows()["4030008"])
    mb_attack = list(native_multiball_rows[0])
    mb_attack[cbase + 4] = "1000000"
    mb_attack[cbase + 5] = "2000000"
    mb_hp = list(native_multiball_rows[1])
    mb_hp[cbase + 4] = "100000"
    mb_hp[cbase + 5] = "200000"
    mb_party_attack = _during(
        gui,
        trigger="208",  # CountMultiball
        effect="0",
        value=100,
        value_max=400,
        threshold=2,
        target="5",
        groups="(None)",
    )
    # CountMultiball needs an explicit one-stack limit.  Blank is rendered
    # by the client as "maximum +0%"; one stack keeps the intended flat
    # bonus while allowing level interpolation from 100% to 400%.
    mb_party_attack[dbase + 5] = "1"
    mb_gauge = _instant(
        gui,
        trigger="194",
        effect="211",
        value=1,
        value_max=5,
        threshold=1,
        target="5",
        groups="(None)",
    )

    # 5. Ability damage and a 0.5-second-recursion-safe light AoE chase.
    ability_attack = _instant(gui, effect="32", value=250, value_max=500)
    ability_base = _instant(gui, effect="388", value=250, value_max=500)
    ability_attack_stack = _instant(
        gui, trigger="144", effect="32", value=5, value_max=10, threshold=1
    )
    _limit(ability_attack_stack, tbase, 60)
    ability_damage_stack = _instant(
        gui, trigger="144", effect="388", value=10, value_max=20, threshold=1
    )
    _limit(ability_damage_stack, tbase, 60)
    ability_chase = _instant(
        gui,
        trigger="144",
        effect="DMG:all",
        unit="x",
        value=1,
        threshold=1,
        groups="White",
    )
    _cooldown(ability_chase, tbase, 30)

    # 6. Fever.
    fever_time = _instant(gui, effect="56", value=100, value_max=200)
    fever_attack = _during(
        gui,
        trigger="4",
        effect="0",
        value=500,
        value_max=1000,
        target="5",
        groups="(None)",
    )
    fever_direct = _instant(
        gui,
        trigger="8",
        effect="33",
        value=300,
        value_max=600,
        threshold=1,
        target="5",
        groups="(None)",
    )
    _limit(fever_direct, tbase, 1)
    fever_gain = _instant(
        gui,
        trigger="23",
        # Native effect 213 directly adds Fever points instead of creating
        # a temporary Fever-gain-rate status.
        effect="213",
        # 150 / 200 / 250 / 300 / 350 Fever points by awakening level.
        value=15000,
        value_max=35000,
        threshold=1,
    )

    # 7. Adversity.
    opening_hp = _instant(
        gui, effect="209", value=50, target="5", groups="(None)"
    )
    low_hp_attack = _during(
        gui,
        trigger="1",
        effect="0",
        value=500,
        value_max=1000,
        threshold=50,
        threshold_unit="pct",
        target="5",
        groups="(None)",
    )
    low_hp_skill = _during(
        gui,
        trigger="1",
        effect="2",
        value=500,
        value_max=1000,
        threshold=50,
        threshold_unit="pct",
        target="5",
        groups="(None)",
    )

    # 8. Flying.
    flying_extend = _instant(gui, effect="191", value=100, value_max=200)
    flying_attack = _during(
        gui,
        trigger="31",
        effect="0",
        value=400,
        value_max=800,
        target="5",
        groups="(None)",
    )
    flying_gauge = _instant(
        gui,
        trigger="12",
        effect="211",
        value=2,
        value_max=10,
        threshold=30,
        target="5",
        groups="(None)",
        precondition="39",
    )

    # 9. Coffin/revival.  A generic party trigger catches any revived member;
    # the heal and gauge contents target the actual trigger puller.
    coffin_down = _instant(
        gui, effect="203", value=200, value_max=400, target="5", groups="(None)"
    )
    revival_attack = _instant(
        gui,
        trigger="18",
        effect="32",
        value=75,
        value_max=150,
        threshold=1,
        target="5",
        groups="(None)",
    )
    revival_skill = _instant(
        gui,
        trigger="18",
        effect="34",
        value=50,
        value_max=100,
        threshold=1,
        target="5",
        groups="(None)",
    )
    revival_heal = _instant(
        gui, trigger="18", effect="206", value=10, threshold=1, target="7"
    )
    revival_gauge = _instant(
        gui, trigger="18", effect="211", value=100, threshold=1, target="7"
    )
    # Native party-wide revival buffs use the revived member (puller 7) as
    # their source.  Using party (puller 5) creates one counter per member,
    # which turns an 8-count cap into 24 in the equipment UI and battle.
    for row in (revival_attack, revival_skill):
        _trigger_revived_member(row, tbase)
    for row in (revival_heal, revival_gauge):
        _trigger_party(row, tbase)
    _limit(revival_attack, tbase, 10)
    _limit(revival_skill, tbase, 10)

    # 10. Piercing.
    long_piercing = _instant(
        gui, effect="26", unit="raw", value=0, target="5", groups="(None)"
    )
    _status_tail(long_piercing, cbase, 1800, clear_strength=True)
    # Native condition effects use this flag for buffs that enemy dispels
    # cannot remove. The status still expires normally at the end of battle
    # or after its configured duration.
    long_piercing[cbase + 20] = "1"
    piercing_attack = _during(
        gui,
        trigger="30",
        effect="0",
        value=300,
        value_max=600,
        target="5",
        groups="(None)",
    )
    piercing_direct = _during(
        gui, trigger="30", effect="1", value=500, value_max=1000
    )

    # 11. Six elements.
    element_attack = _instant(
        gui,
        trigger="60",
        effect="32",
        value=150,
        value_max=300,
        threshold=1,
        target="5",
        groups="(None)",
    )
    element_independent = _instant(
        gui,
        trigger="60",
        effect="723",
        value=2.4,
        value_max=4.8,
        threshold=1,
        target="5",
        groups="(None)",
    )
    _limit(element_attack, tbase, 6)
    _limit(element_independent, tbase, 5)
    opening_gauge = _instant(
        gui, effect="211", value=40, value_max=200, target="5", groups="(None)"
    )
    charge_speed = _instant(
        gui,
        trigger="60",
        effect="35",
        value=5,
        value_max=25,
        threshold=1,
        target="5",
        groups="(None)",
    )
    _limit(charge_speed, tbase, 5)

    rows = {
        "skill_core": [skill_base, skill_stack, skill_gauge],
        "direct_blade": [direct_base, direct_stack, double_hit],
        "powerflip_hammer": [pf_base, pf_stack, pf_count_down, pf_combo],
        "multiball_hangar": [mb_attack, mb_hp, mb_party_attack, mb_gauge],
        "ability_terminal": [
            ability_attack,
            ability_base,
            ability_attack_stack,
            ability_damage_stack,
            ability_chase,
        ],
        "fever_ring": [fever_time, fever_attack, fever_direct, fever_gain],
        "adversity_sword": [opening_hp, low_hp_attack, low_hp_skill],
        "flying_wing": [flying_extend, flying_attack, flying_gauge],
        "revival_staff": [
            coffin_down,
            revival_attack,
            revival_skill,
            revival_heal,
            revival_gauge,
        ],
        "piercing_lance": [long_piercing, piercing_attack, piercing_direct],
        "six_element_wheel": [
            element_attack,
            element_independent,
            opening_gauge,
            charge_speed,
        ],
    }

    # Rows sharing a slot are awakening alternatives, so every simultaneous
    # candidate effect needs an independent slot.
    for case_rows in rows.values():
        for slot, row in enumerate(case_rows):
            row[0] = str(slot)
            problems = gui._client_legality_problems("ability_soul", row)
            if problems:
                raise RuntimeError(
                    "client legality check failed: " + "; ".join(problems)
                )
    return rows


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json_backup(path: Path, value, tag: str) -> str:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = path.with_name(path.name + f".bak-{tag}-{stamp}")
    shutil.copy2(path, backup)
    temp = path.with_name(path.name + f".tmp-{stamp}")
    temp.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temp.replace(path)
    return str(backup)


def server_metadata_state(gui) -> dict:
    assets = gui.SERVER_ASSETS
    ids = _load_json(assets / "equipment_ids.json")
    item_ids = _load_json(assets / "item_ids.json")
    lookup = _load_json(assets / "equipment_lookup.json")
    dissolve = _load_json(assets / "equipment_dissolve.json")
    max_level = _load_json(assets / "equipment_max_level.json")
    element = _load_json(assets / "equipment_element.json")
    result = {}
    for spec in WEAPONS:
        key, num = spec["id"], int(spec["id"])
        result[key] = {
            "equipment_ids": num in ids,
            "item_ids": num in item_ids,
            "lookup": lookup.get(key),
            "dissolve": dissolve.get(key),
            "max_level": max_level.get(key),
            "element": element.get(key),
        }
    return result


def ensure_server_metadata(gui) -> dict:
    assets = gui.SERVER_ASSETS
    paths = {
        "equipment_ids": assets / "equipment_ids.json",
        "item_ids": assets / "item_ids.json",
        "equipment_lookup": assets / "equipment_lookup.json",
        "equipment_dissolve": assets / "equipment_dissolve.json",
        "equipment_max_level": assets / "equipment_max_level.json",
        "equipment_element": assets / "equipment_element.json",
    }
    data = {name: _load_json(path) for name, path in paths.items()}
    legacy_numbers = {int(value) for value in LEGACY_WEAPON_IDS}
    data["equipment_ids"] = [
        value for value in data["equipment_ids"] if int(value) not in legacy_numbers
    ]
    data["item_ids"] = [
        value for value in data["item_ids"] if int(value) not in legacy_numbers
    ]
    for name in (
        "equipment_lookup",
        "equipment_dissolve",
        "equipment_max_level",
        "equipment_element",
    ):
        for key in LEGACY_WEAPON_IDS:
            data[name].pop(key, None)
    for spec in WEAPONS:
        key, num = spec["id"], int(spec["id"])
        if num not in data["equipment_ids"]:
            data["equipment_ids"].append(num)
        if num not in data["item_ids"]:
            data["item_ids"].append(num)
        data["equipment_lookup"][key] = {
            "name": spec["name"],
            "rarity": "5",
            "category": "幻想连战候选",
        }
        data["equipment_dissolve"][key] = {
            "ability_soul_id": num,
            "obtain_source": 1,
            "generate_ability_soul": True,
            "max_level": 5,
        }
        data["equipment_max_level"][key] = 5
        data["equipment_element"][key] = -1
    data["equipment_ids"] = sorted(set(data["equipment_ids"]))
    data["item_ids"] = sorted(set(data["item_ids"]))
    backups = {
        name: _write_json_backup(path, data[name], "fantasy-candidates")
        for name, path in paths.items()
    }
    return {"backups": backups, "state": server_metadata_state(gui)}


def _client_tables(gui, core) -> dict[str, dict]:
    equipment = core.load_table(gui.EQUIP_LOGICAL, gui.TARGET_STORE, gui.SOURCE_STORE)
    soul = core.load_table(gui.SOUL_LOGICAL, gui.TARGET_STORE, gui.SOURCE_STORE)
    item = core.load_table(ITEM_LOGICAL, gui.TARGET_STORE, gui.SOURCE_STORE)
    status_path = core.table_path(gui.TARGET_STORE, EQUIPMENT_STATUS_LOGICAL)
    if not status_path.is_file() and gui.SOURCE_STORE is not None:
        status_path = core.table_path(gui.SOURCE_STORE, EQUIPMENT_STATUS_LOGICAL)
    status = core.read_orderedmap_file_raw_rows(status_path, EQUIPMENT_STATUS_LOGICAL)
    return {
        "equipment": equipment.text_rows(),
        "ability_soul": soul.text_rows(),
        "item": item.text_rows(),
        "equipment_status": dict(zip(status.keys, status.rows)),
    }


def audit(gui, core, describe) -> dict:
    generated = make_rows(gui, core, describe)
    tables = _client_tables(gui, core)
    stored_souls = {
        key: gui._read_ml(text) for key, text in tables["ability_soul"].items()
    }
    weapons = {}
    for spec in WEAPONS:
        key = spec["id"]
        weapons[key] = {
            "name": spec["name"],
            "case": spec["case"],
            "client": {name: key in rows for name, rows in tables.items()},
            "ability_row_count": len(generated[spec["case"]]),
            "stored_ability_rows_match": stored_souls.get(key)
            == generated[spec["case"]],
            "descriptions": [
                describe.describe_line(row, "ability_soul")
                for row in generated[spec["case"]]
            ],
        }
    return {
        "source_weapon": SOURCE_WEAPON,
        "target_store": str(gui.TARGET_STORE),
        "server_root": str(gui.SERVER_ASSETS.parent),
        "weapons": weapons,
        "server": server_metadata_state(gui),
        "pending": gui.read_pending(),
    }


def ensure_equipment_rows(gui, core) -> dict:
    equipment = core.load_table(gui.EQUIP_LOGICAL, gui.TARGET_STORE, gui.SOURCE_STORE)
    parsed = {key: gui._read_ml(text) for key, text in equipment.text_rows().items()}
    changed = []
    for spec in WEAPONS:
        rows = parsed.get(spec["id"])
        if not rows:
            raise RuntimeError(f"equipment key {spec['id']} is missing after clone")
        row = rows[0]
        touched = False
        image = f"{IMAGE_PREFIX}/{spec['image_slug']}"
        for index, value in (
            (1, spec["name"]),
            (6, image),
            (7, spec["description"].rstrip() + "\n\n" + MODE15_RESTRICTION),
            (10, spec["id"]),
        ):
            if row[index] != value:
                row[index] = value
                touched = True
        if touched:
            changed.append(spec["id"])
    if changed:
        gui._write_with_backup_ml(
            equipment,
            parsed,
            ["同步幻想连战正式候选武器名称/描述: " + ",".join(changed)],
            ".bak-wfmod-fantasy-candidates-equipment-",
        )
    return {"changed": changed}


def ensure_item_rows(gui, core) -> dict:
    item = core.load_table(ITEM_LOGICAL, gui.TARGET_STORE, gui.SOURCE_STORE)
    parsed = {key: gui._read_ml(text) for key, text in item.text_rows().items()}
    if SOURCE_WEAPON not in parsed:
        raise RuntimeError(f"item source key {SOURCE_WEAPON} is missing")
    source = list(parsed[SOURCE_WEAPON][0])
    changed = []
    for spec in WEAPONS:
        row = list(source)
        row[0] = f"mod_fantasy_{spec['image_slug']}"
        row[1] = spec["id"]
        row[2] = spec["name"] + "魂珠"
        row[3] = f"{IMAGE_PREFIX}/{spec['image_slug']}"
        row[5] = MODE15_RESTRICTION
        if parsed.get(spec["id"]) != [row]:
            parsed[spec["id"]] = [row]
            changed.append(spec["id"])
    if changed:
        gui._write_with_backup_ml(
            item,
            parsed,
            ["新增幻想连战正式候选魂珠物品键: " + ",".join(changed)],
            ".bak-wfmod-fantasy-candidates-item-",
        )
    return {"changed": changed}


def ensure_status_rows(gui, core) -> dict:
    path = core.table_path(gui.TARGET_STORE, EQUIPMENT_STATUS_LOGICAL)
    source_path = path
    if not source_path.is_file() and gui.SOURCE_STORE is not None:
        source_path = core.table_path(gui.SOURCE_STORE, EQUIPMENT_STATUS_LOGICAL)
    ordered = core.read_orderedmap_file_raw_rows(source_path, EQUIPMENT_STATUS_LOGICAL)
    rows = dict(zip(ordered.keys, ordered.rows))
    if SOURCE_WEAPON not in rows:
        raise RuntimeError(f"equipment_status source key {SOURCE_WEAPON} is missing")
    source = rows[SOURCE_WEAPON]
    changed = []
    for spec in WEAPONS:
        key = spec["id"]
        if key not in rows:
            ordered.keys.append(key)
            ordered.rows.append(source)
            rows[key] = source
            changed.append(key)
        elif rows[key] != source:
            raise RuntimeError(f"equipment_status collision for {key}")
    if changed:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        path.parent.mkdir(parents=True, exist_ok=True)
        backup = None
        if path.is_file():
            backup = path.with_name(
                path.name + ".bak-wfmod-fantasy-candidates-status-" + stamp
            )
            shutil.copy2(path, backup)
        path.write_bytes(core.build_orderedmap_raw_rows(ordered))
        gui.add_pending(path)
        gui.record_change(
            EQUIPMENT_STATUS_LOGICAL,
            "新增幻想连战正式候选武器状态键: " + ",".join(changed),
            backup or source_path,
        )
    return {"changed": changed}


def ensure_balanced_status_rows(gui, core) -> dict:
    """Install the formal high-stat curve for all eleven Fantasy weapons."""
    import wf_quest_lib as quest_lib

    path = core.table_path(gui.TARGET_STORE, EQUIPMENT_STATUS_LOGICAL)
    table = quest_lib.load_table(EQUIPMENT_STATUS_LOGICAL)
    changed = []
    for spec in WEAPONS:
        key = spec["id"]
        base_hp = int(spec["base_hp"])
        base_attack = int(spec["base_attack"])
        # The native table stores levels 1/3/5 and interpolates levels 2/4.
        # These three points therefore yield exactly +100 HP / +100 ATK for
        # every level from 1 through 5.
        desired = {
            "1": f"{base_hp},{base_attack}",
            "3": f"{base_hp + 200},{base_attack + 200}",
            "5": f"{base_hp + 400},{base_attack + 400}",
        }
        if table.get(key) != desired:
            table[key] = dict(desired)
            changed.append(key)
    if changed:
        quest_lib.save_table(
            EQUIPMENT_STATUS_LOGICAL, table, path=path, backup=True
        )
        gui.add_pending(path)
        gui.record_change(
            EQUIPMENT_STATUS_LOGICAL,
            "Fantasy Rush per-weapon stats: base HP 500-600 / ATK 500-600, "
            "+100 HP / +100 ATK per level: "
            + ",".join(changed),
            path,
        )
    return {"changed": changed}


def write_batch(gui, core, describe, quest_lib, wf_assets, sources: dict[str, Path]) -> dict:
    before = audit(gui, core, describe)
    for key, state in before["weapons"].items():
        flags = state["client"]
        if any(flags.values()) and not all(flags.values()):
            raise RuntimeError(f"partial client collision for {key}: {flags}")

    clone_logs = []
    for spec in WEAPONS:
        state = before["weapons"][spec["id"]]["client"]
        if not any(state.values()):
            result = gui.weapon_clone(
                SOURCE_WEAPON,
                spec["id"],
                spec["name"],
                spec["description"],
                SOURCE_WEAPON,
                False,
            )
            clone_logs.append(result["log"])

    ensure_equipment_rows(gui, core)
    generated = make_rows(gui, core, describe)
    soul = core.load_table(gui.SOUL_LOGICAL, gui.TARGET_STORE, gui.SOURCE_STORE)
    parsed = {key: gui._read_ml(text) for key, text in soul.text_rows().items()}
    changed = []
    logs = []
    for spec in WEAPONS:
        rows = generated[spec["case"]]
        if parsed.get(spec["id"]) != rows:
            parsed[spec["id"]] = rows
            changed.append(spec["id"])
        logs.append(
            f"{spec['id']} {spec['name']}: "
            + " | ".join(
                describe.describe_line(row, "ability_soul") for row in rows
            )
        )
    if changed:
        gui._write_with_backup_ml(
            soul,
            parsed,
            logs,
            ".bak-wfmod-fantasy-candidates-soul-",
        )
    ensure_item_rows(gui, core)
    ensure_balanced_status_rows(gui, core)
    server = ensure_server_metadata(gui)
    installed_icons = install_source_assets(gui, quest_lib, wf_assets, sources)
    after = audit(gui, core, describe)
    after["assets"] = audit_assets(gui, quest_lib, wf_assets, sources)
    after["installed_icons"] = installed_icons
    after["clone_logs"] = clone_logs
    after["changed_souls"] = changed
    after["server_write"] = server
    return after


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--tools",
        type=Path,
        default=Path(os.environ["WF_MOD_TOOLS_DIR"])
        if os.environ.get("WF_MOD_TOOLS_DIR")
        else Path(__file__).resolve().parent,
        help="工具目录（默认 WF_MOD_TOOLS_DIR 或当前脚本目录）",
    )
    parser.add_argument(
        "--asset-dir",
        type=Path,
        help="override the canonical 11-icon source directory",
    )
    parser.add_argument(
        "--target-store",
        type=Path,
        default=Path(os.environ["WF_TARGET_STORE"])
        if os.environ.get("WF_TARGET_STORE")
        else None,
        help="明确的 production/upload 目录（写入时必填，或设置 WF_TARGET_STORE）",
    )
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    if args.write and args.target_store is None:
        parser.error("--write 必须提供 --target-store 或 WF_TARGET_STORE")
    if args.target_store is not None:
        target_store = args.target_store.expanduser().resolve()
        if not target_store.is_dir():
            parser.error(f"--target-store 不存在或不是目录: {target_store}")
        os.environ["WF_TARGET_STORE"] = str(target_store)
    tools = args.tools.resolve()
    gui, core, describe, quest_lib, wf_assets = load_modules(tools)
    asset_dir = (
        args.asset_dir.resolve()
        if args.asset_dir is not None
        else tools / "assets" / "fantasy-equipment"
    )
    sources = validate_source_assets(asset_dir)
    if args.write:
        payload = write_batch(gui, core, describe, quest_lib, wf_assets, sources)
    else:
        payload = audit(gui, core, describe)
        payload["assets"] = audit_assets(gui, quest_lib, wf_assets, sources)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
