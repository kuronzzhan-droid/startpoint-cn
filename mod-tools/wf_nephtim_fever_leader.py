"""校园奈芙提姆队长原生表行；特殊PF程序与文本由PF模块提供。"""
from copy import deepcopy
import wf_nephtim_ball_hit_count as ball_hit_count

from wf_nephtim_fever_abilities import (CHANGE_SKILL_STRING_ID, CODE, PIERCING_EXTENSION_STRENGTH,
                                        _instant, _percent, _set, enhance_row)

PF_ID = CODE + "_fever"
PF_STRING_ID = PF_ID + "_powerflip"


def leader_rows(source, *, piercing_extension="dark_resonance",
                power_flip_id=PF_ID, power_flip_string_id=PF_STRING_ID):
    """返回124列队长行；贯穿延时采用作者确认的暗共鸣常驻方案（2026-09-27 起由能力2承载）。"""
    if piercing_extension != "dark_resonance":
        raise ValueError("piercing_extension must be the approved dark_resonance strategy")
    pf = _instant(source, 722, pre="dark")
    _set(pf, {82: power_flip_id, 83: "1,2,3", 84: power_flip_string_id})
    # 作者 2026-09-27（方案B）：只把 I536 技能强化开关从能力1搬进队长，紧跟 I722；
    # 召唤/清理行（T232/528/187/77 在官方队长表零先例）留在能力1。
    enhance = enhance_row(source)
    direct = _instant(source, 33, 400_000, pre="dark", target=5)
    attack = _instant(source, 32, 200_000, pre="dark", target=5)
    # 作者 2026-09-27：Fever 中技能槽上限+10%（during 124）与 I190 贯穿延时 20% 移出队长，
    # 由能力2承载（贯穿合并为单行 40%）。
    # Native T12 crosses multiples of the current combo; I50 permanently adds
    # the general Fever gain modifier. Both I50/I56 exist in LeaderAbilityValues.
    growth = _instant(source, 50, 20_000, pre="dark", target=5,
                      trigger=12, threshold=35)
    duration = _instant(source, 56, 100_000, pre="dark")
    removal_charge = _instant(source, 211, 5_000, pre="dark", target=5,
                              trigger=194, threshold=1)
    rows = [pf, enhance, direct, attack, growth, duration, removal_charge]
    return [[CODE, "0", ""] + deepcopy(row[5:]) for row in rows] + [ball_hit_count.leader_row(source)]


def flat_string_rows():
    # I722's single string dependency belongs to the combined-PF module.
    return {}


def metadata():
    return {
        "required_client_capabilities": [],
        "power_flip_id": PF_ID, "power_flip_string_id": PF_STRING_ID,
        "dark_direct_damage_percent": 400, "dark_attack_percent": 200,
        "skill_enhancement_flag": {"content": 536, "string_id": CHANGE_SKILL_STRING_ID,
                                   "requires_dark_resonance": True, "position": "after I722",
                                   "official_leader_precedent": "121189#3",
                                   "moved_from": "ability1 2026-09-27"},
        "fever_gain_growth": {"combo_step": 35, "increase_percent": 20,
                              "target": "dark party", "requires_fever": False,
                              "trigger_limit": None, "persists_after_combo_reset": True,
                              "counter": "native T12 current-combo multiples; remainder resets on combo reset"},
        "fever_duration_percent": 100,
        "multiball_removal_charge": {"trigger": 194, "content": 211,
            "per_multiball_percent": 5, "target": "dark party",
            "requires_dark_resonance": True, "requires_fever": False,
            "trigger_limit": None, "cooldown_frames": 0,
            "event": "native MultiballRemove; temporary inactive transition does not count"},
        "ball_hit_count": ball_hit_count.metadata(),
        "piercing_extension": {"strategy": "dark_resonance", "target": "party",
                               "leader_rows": 0, "location": "ability2",
                               "requires_fever": False, "trigger": 0, "content": 190,
                               "ability2_percent": _percent(PIERCING_EXTENSION_STRENGTH)},
    }
