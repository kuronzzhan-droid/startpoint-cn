"""校园奈芙提姆的官方模板面板文字；纯文本工厂，不改战斗表行。"""
from copy import deepcopy

from wf_nephtim_fever_abilities import CID, CODE, CHANGE_SKILL_STRING_ID, SPAWN_STRING_ID
from wf_nephtim_fever_leader import PF_STRING_ID

REQUIRED_CAPABILITY = "panel-description-override-v2"
FLAT_STRING_TABLE = "master/string/custom_ability_string.orderedmap"
PIERCING_POLICIES = ("dark_resonance",)
MAIN_ICON = " <icon id='main'>  "

_TEXTS = {
    "active": (
        "赋予参战者及协力球贯穿效果，提升队伍内角色及协力球的直接攻击伤害。\n"
        "Fever 模式中，使暗属性角色及协力球的直接攻击分为多次，并提高总伤害。\n"
        "技能强化后，额外提升暗属性角色及协力球的攻击力；"
        "在 Fever 模式中发动技能时，自身获得「星夜茶会」，期间交替召唤光、暗属性协力球。"
    ),
    "leader": (
        "暗属性共鸣时，强化弹射变为特殊型与辅助型组合。\n"
        "暗属性共鸣时，暗属性角色合计每直接攻击50次，Fever 槽+5%。\n"
        "暗属性共鸣时，暗属性角色攻击力+200%、直接攻击伤害+400%。\n"
        "暗属性共鸣时，Fever 模式中，暗属性角色技能槽上限+10%。"
    ),
    "a1": (
        "自身技能槽上限+50%。\n"
        "暗属性共鸣时，强化技能，额外赋予暗属性角色及协力球攻击力提升100%效果，持续20秒。\n"
        "暗属性共鸣时，Fever 模式中，发动技能时，自身获得「星夜茶会」，持续20秒。\n"
        "暗属性共鸣时，Fever 模式中，持有「星夜茶会」时，每经过2秒交替召唤1个光、暗属性协力球，各持续20秒。\n"
        "Fever 结束或自身倒下时，「星夜茶会」解除。"
    ),
    "a2": (
        "暗属性共鸣时，全队贯穿效果时间+20%。\n"
        "暗属性共鸣时，暗属性角色直接攻击伤害+250%。"
    ),
    "a3": "\n".join(MAIN_ICON + line for line in (
        "暗属性共鸣时，暗属性角色获得的 Fever 槽上升量+500%。",
        "暗属性共鸣时，Fever 时间+10%。",
        "暗属性共鸣时，Fever 模式中，当前每有1连击，暗属性角色直接攻击造成的伤害+0.5%。",
        "暗属性共鸣时，Fever 模式中，处于贯穿效果的时间每累计2秒，暗属性角色攻击力+20%、直接攻击伤害+20%。",
    )),
    "a4": "暗属性共鸣时，Fever 模式中，暗属性角色及协力球直接攻击造成的伤害+20%。",
    "a5": (
        "非 Fever 模式中，每经过10秒，赋予全队贯穿效果，持续3秒。\n"
        "Fever 模式中，每经过5秒，赋予全队贯穿效果，持续3秒。"
    ),
    "a6": "暗属性共鸣时，暗属性角色直接攻击伤害+100%。",
}


def _piercing_line(policy):
    if policy == "dark_resonance":
        return "暗属性共鸣时，全队贯穿效果时间+20%。"
    raise ValueError(f"piercing_extension must be one of {PIERCING_POLICIES}: {policy!r}")


def panel_descriptions(*, piercing_extension="dark_resonance"):
    """返回主动、队长和六能力；队长贯穿使用已确认的常驻暗共鸣条件。"""
    texts = deepcopy(_TEXTS)
    texts["leader"] += "\n" + _piercing_line(piercing_extension)
    return texts


def active_description():
    """同步到 action_skill / character_text 的主动说明，不含具体数值。"""
    return _TEXTS["active"]


def panel_rows(ability_rows, leader_rows, *, piercing_extension="dark_resonance"):
    """检查各组实际首行 c0，返回七条 v2 覆盖；不改变原行或觉醒字段。"""
    texts = panel_descriptions(piercing_extension=piercing_extension)
    groups = {"leader": leader_rows}
    groups.update({f"a{slot}": ability_rows.get(CID + str(slot), [])
                   for slot in range(1, 7)})
    result = {}
    for slot, rows in groups.items():
        expected = CODE if slot == "leader" else CODE + "_" + slot[1:]
        if not rows or not rows[0] or rows[0][0] != expected:
            raise ValueError(f"{CID} {slot}: first-row string_id must be {expected}")
        result["desc_override_" + expected] = [[texts[slot]]]
    return result


def native_flat_string_rows():
    """保留实际 I536/I629/I722 字符串依赖，比较面板也使用可读说明。"""
    return {
        CHANGE_SKILL_STRING_ID: [[
            "强化技能：暗属性角色及协力球攻击力+100%，持续20秒；"
            "Fever 模式中发动技能时，自身获得「星夜茶会」，持续20秒"
        ]],
        SPAWN_STRING_ID: [["交替召唤1个光、暗属性协力球，持续20秒"]],
        PF_STRING_ID: [["强化弹射变为特殊型与辅助型组合"]],
    }


def metadata(*, piercing_extension="dark_resonance"):
    _piercing_line(piercing_extension)
    return {
        "character_id": CID,
        "required_client_capabilities": [REQUIRED_CAPABILITY],
        "leader_piercing_extension": piercing_extension,
        "override_key_source": "first ability/leader row c0 (string_id)",
        "combat_rows_modified": False,
        "numeric_text": "fixed authored values at all ability levels",
        "coverage": "character ability and leader panels; comparison and disabled-reason text remain native",
    }
