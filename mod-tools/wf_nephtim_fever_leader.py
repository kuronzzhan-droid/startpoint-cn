"""校园奈芙提姆队长原生表行；特殊PF程序与文本由PF模块提供。"""
from copy import deepcopy

from wf_nephtim_fever_abilities import CODE, _during, _instant, _set

PF_ID = CODE + "_fever"
PF_STRING_ID = PF_ID + "_powerflip"


def leader_rows(source, *, piercing_extension="dark_resonance",
                power_flip_id=PF_ID, power_flip_string_id=PF_STRING_ID):
    """返回124列队长行；贯穿延时采用作者确认的暗共鸣常驻方案。"""
    if piercing_extension != "dark_resonance":
        raise ValueError("piercing_extension must be the approved dark_resonance strategy")
    pf = _instant(source, 722, pre="dark")
    _set(pf, {82: power_flip_id, 83: "1,2,3", 84: power_flip_string_id})
    direct = _instant(source, 33, 400_000, pre="dark", target=5)
    attack = _instant(source, 32, 200_000, pre="dark", target=5)
    maximum = _during(source, 124, 10_000, target=5)
    # Native I190 adds the party modifier once at initialization. Keeping it
    # constant avoids Fever/death/zone transitions adding unmatched increments.
    piercing = _instant(source, 190, 20_000, pre="dark")
    # Native T12 crosses multiples of the current combo; I50 permanently adds
    # the general Fever gain modifier. Both I50/I56 exist in LeaderAbilityValues.
    growth = _instant(source, 50, 20_000, pre="dark", target=5,
                      trigger=12, threshold=35)
    duration = _instant(source, 56, 30_000, pre="dark")
    rows = [pf, direct, attack, maximum, piercing, growth, duration]
    return [[CODE, "0", ""] + deepcopy(row[5:]) for row in rows]


def flat_string_rows():
    # I722's single string dependency belongs to the combined-PF module.
    return {}


def metadata():
    return {
        "required_client_capabilities": [],
        "power_flip_id": PF_ID, "power_flip_string_id": PF_STRING_ID,
        "dark_direct_damage_percent": 400, "dark_attack_percent": 200,
        "fever_dark_extra_skill_gauge_percent": 10,
        "fever_gain_growth": {"combo_step": 35, "increase_percent": 20,
                              "target": "dark party", "requires_fever": False,
                              "trigger_limit": None, "persists_after_combo_reset": True,
                              "counter": "native T12 current-combo multiples; remainder resets on combo reset"},
        "fever_duration_percent": 30,
        "piercing_extension": {"strategy": "dark_resonance", "target": "party",
                               "increase_percent": 20, "requires_fever": False,
                               "trigger": 0, "content": 190,
                               "with_ability2_percent": 40},
    }
