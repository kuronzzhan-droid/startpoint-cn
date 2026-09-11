"""校园希尔媞六能力的原生表行；纯函数，不读写角色包或 live。"""
from __future__ import annotations

from copy import deepcopy

CID = "149989"
CODE = "wind_spgirl_campus"
CHANGE_SKILL_STRING_ID = "change_skill_wind_spgirl_campus_fever"
SCALE = 100_000


def _pre(row, kind=None, *, offset=6):
    row[offset:offset + 7] = ["0", "", "", "", "", "", ""]
    if kind in ("wind", "resonance"):
        row[offset] = "2" if kind == "wind" else "208"
        row[offset + 3:offset + 5] = ["600000", "600000"]
        if kind == "wind":
            row[offset + 5] = "Green"
    elif kind in ("fever", "not_fever"):
        row[offset] = "12" if kind == "fever" else "186"
    elif kind is not None:
        raise ValueError(f"unsupported precondition: {kind}")


def _instant(source, content, strength=None, *, pre=None, fever=None,
             trigger=0, threshold=1, wind_counter=False, target=None,
             limit=None):
    # 最新原版希尔媞开局充能行提供原生 126 列与 Option 哨兵。
    row = deepcopy(source["1412011"][0])
    if len(row) != 126:
        raise ValueError("official ability rows must have 126 columns")
    row[0:6] = [CODE, "true", "special", "0", "", "0"]
    row[27:39] = [""] * 12
    row[47:85] = [""] * 38
    _pre(row, pre)
    _pre(row, fever, offset=13)
    _pre(row, offset=20)
    row[27], row[47] = str(trigger), str(content)
    if trigger:
        row[30:32] = [str(threshold * SCALE)] * 2
        row[34:36] = ["(None)" if limit is None else str(limit), "0"]
    if wind_counter:
        row[28:30] = ["7", "Green"]
    if target is not None:
        row[48] = str(target)
        if target == 5:
            row[49] = "Green"
    if strength is not None:
        row[51:53] = [str(strength)] * 2
    return row


def _fever_status(source, content, strength=None):
    row = _instant(source, content, strength, pre="wind", fever="fever",
                   trigger=248, threshold=180)
    row[57:61] = [str(90 * SCALE)] * 2 + [str(SCALE)] * 2
    row[62:66] = ["(None)"] * 4
    row[67], row[72] = "0", "false"
    if content == 688:
        # I688 applies to the player ball; I689 would affect a multiball.
        row[61] = "(None)"
    return row


def ability_rows(source: dict) -> dict:
    """返回 1499891..6；source 是只读的官方 ability 表解码结果。"""
    opening = _instant(source, 211, 50_000, target=0)
    enhance = _instant(source, 536, pre="wind")
    enhance[70] = CHANGE_SKILL_STRING_ID
    # 原版 1412012[2]：DirectAttack3 强度 0，三段分伤而非总伤害三倍。
    triple = _instant(source, 202, 0, pre="resonance", target=5)
    ability_damage = _instant(source, 388, 200_000,
                              pre="resonance", target=5)

    all_enemy = _instant(source, 254, 25 * SCALE, pre="wind", fever="fever",
                         trigger=20, threshold=35, wind_counter=True, target=0)
    all_enemy[69] = "(None)"  # None selects AllEnemyDamage, not NearestOrder.
    fever_charge = _instant(source, 724, 5_000, pre="wind", fever="not_fever",
                            trigger=20, threshold=35, wind_counter=True)
    # T12 listens to current combo crossing 70, 140...; both rewards have
    # independent limits, so reaching the attack cap does not stop charging.
    attack = _instant(source, 32, 70_000, pre="wind", fever="fever",
                      trigger=12, threshold=70, target=5, limit=10)
    charge = _instant(source, 211, 7_000, pre="wind", fever="fever",
                      trigger=12, threshold=70, target=5)

    slots = [
        [opening, enhance],
        [triple, ability_damage],
        [all_enemy, fever_charge, attack, charge],
        [_fever_status(source, 26)],
        [_fever_status(source, 27)],
        [_fever_status(source, 688, SCALE)],
    ]
    result = {}
    for number, rows in enumerate(slots, 1):
        for row in rows:
            row[0] = f"{CODE}_{number}"
            row[1] = "false" if number == 3 else "true"
        result[f"{CID}{number}"] = rows
    return result


def flat_string_rows() -> dict:
    """I536 必读 custom_ability_string 平表；缺键可引发 C8601。"""
    return {CHANGE_SKILL_STRING_ID: [[
        "技能强化：额外赋予全队贯穿效果（15秒）、"
        "风属性角色能力伤害提升100%效果（15秒），"
        "并赋予命中敌人风属性抗性降低25%效果（15秒）"
    ]]}


def metadata() -> dict:
    return {
        "character_id": CID,
        "required_client_capabilities": ["kyubi-fever-ratio-v1"],
        "a1_enhancement": {
            "string_id": CHANGE_SKILL_STRING_ID,
            "flat_string_table": "master/string/custom_ability_string.orderedmap",
            "requires_skill_dsl_change_skill_flag_branch": True,
            "duration_seconds": 15,
            "piercing": True,
            "wind_party_ability_damage_percent": 100,
            "hit_enemy_wind_resistance_down_percent": 25,
        },
        "direct_attack": {
            "times": 3,
            "additional_total_damage_percent": 0,
            "native_damage_is_divided_by_hit_count": True,
            "wind_counter": "total of wind party direct attacks",
            "fever_counters": "independent; fractional period carries across Fever",
        },
        "combo": {
            "trigger": "current combo crosses each multiple of 70 during Fever",
            "attack_target": "wind party",
            "attack_gain_percent": 70,
            "attack_max_percent": 700,
            "attack_persists_after_fever": True,
            "skill_gauge_gain_percent": 7,
            "skill_gauge_trigger_limit": None,
        },
        "fever_ratio": "add 5% of maximum to current gauge; does not raise maximum",
        "periodic_status": {
            "timer": "native cumulative Fever frames; fractional period carries",
            "period_frames": 180,
            "duration_frames": 90,
            "target": "whole player party ball",
            "expires_naturally_after_fever": True,
            "fixed_speed_strength": 1.0,
            "fixed_speed_skill_charging_strength": 0,
        },
    }
