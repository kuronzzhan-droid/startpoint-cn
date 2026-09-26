"""校园奈芙提姆的官方模板面板文字；纯文本工厂，不改战斗表行。"""
from copy import deepcopy
from wf_featured_main_ability import main_description

from wf_nephtim_fever_abilities import (CID, CODE, CHANGE_SKILL_DESCRIPTION,
                                        CHANGE_SKILL_STRING_ID, COMBO_STRENGTH,
                                        PIERCING_EXTENSION_STRENGTH, PIERCING_GROWTH_STRENGTH,
                                        SKILL_GAUGE_MAXIMUM_STRENGTH, SKILL_NAME,
                                        SPAWN_DESCRIPTION, SPAWN_STRING_ID,
                                        SUMMON_PERIOD_FRAMES, _percent)
from wf_nephtim_fever_leader import PF_STRING_ID
import wf_nephtim_fever_skill as skill
import wf_nephtim_multiball_direct as multiball_direct
import wf_nephtim_ball_hit_count as ball_hit_count

REQUIRED_CAPABILITY = "panel-description-override-v2"
FLAT_STRING_TABLE = "master/string/custom_ability_string.orderedmap"
PIERCING_POLICIES = ("dark_resonance",)
MAIN_ICON = " <icon id='main'>  "
# 面板数字一律从战斗侧真源取，避免文案与实际强度漂移。
COMBO_PERCENT = _percent(COMBO_STRENGTH)
PIERCING_PERCENT = _percent(PIERCING_GROWTH_STRENGTH)
BALL_PERCENT = multiball_direct.per_ball_percent()
OVERFLOW_PERCENT = skill.overflow_attack_percent()
PIERCING_EXTENSION_PERCENT = _percent(PIERCING_EXTENSION_STRENGTH)
SKILL_GAUGE_MAXIMUM_PERCENT = _percent(SKILL_GAUGE_MAXIMUM_STRENGTH)
_PERIOD = SUMMON_PERIOD_FRAMES / 60
SUMMON_PERIOD_SECONDS = int(_PERIOD) if _PERIOD.is_integer() else _PERIOD
# I536「技能强化」条目：作者 2026-09-27 起随强化开关移入队长。
# 文案规则2：只写强化了什么，不写数字与时间。
ENHANCEMENT_LINES = (
    f"暗属性共鸣时，强化『{SKILL_NAME}』：额外赋予暗属性角色及协力球攻击力提升效果。",
    "暗属性共鸣时，Fever 模式中，强化后的技能发动时，自身获得或刷新「星夜茶会」，并赋予暗属性角色及协力球护盾。",
)

_TEXTS = {
    "active": (
        "赋予参战者及协力球贯穿效果，提升队伍内角色及协力球的直接攻击伤害。\n"
        "Fever 模式中，使暗属性角色的直接攻击分为多次，并提高总伤害。"
    ),
    # 第2、3 行是同一条 I536「技能强化」条目（2026-09-27 起由队长承载）。
    "leader": "\n".join((
        "暗属性共鸣时，强化弹射变为特殊型与辅助型组合。",
        *ENHANCEMENT_LINES,
        "暗属性共鸣时，暗属性角色攻击力+200%、直接攻击伤害+400%。",
        "暗属性共鸣时，每达成35连击，暗属性角色获得的 Fever 槽上升量+20%。",
        "暗属性共鸣时，Fever 时间+100%。",
        "暗属性共鸣时，每有1个协力球消失时，暗属性角色技能槽+5%。",
    )),
    # 召唤/溢出/清理仍在主位限制的能力1；强化开关已移入队长。
    "a1": (
        "战斗开始时，自身技能槽+50%。\n"
        f"暗属性共鸣时，Fever 模式中，持有「星夜茶会」时，每经过{SUMMON_PERIOD_SECONDS}秒交替召唤1个光、暗属性协力球，各持续25秒且无法回复生命值，协力球最多同时存在9个；再次发动技能不会延长已有协力球的存在时间。\n"
        f"暗属性共鸣时，Fever 模式中，持有「星夜茶会」时，协力球已达9个时，该次召唤改为自身攻击力+{OVERFLOW_PERCENT}%，持续20秒，可叠加。\n"
        "Fever 结束或自身倒下时，「星夜茶会」解除。"
    ),
    # 首行贯穿延时由 panel_descriptions 按已确认策略补上（2026-09-27 起在能力2）。
    "a2": (
        "暗属性共鸣时，暗属性角色直接攻击伤害+250%。\n"
        f"暗属性共鸣时，Fever 模式中，暗属性角色技能槽上限+{SKILL_GAUGE_MAXIMUM_PERCENT}%。"
    ),
    # 文案规则1：没有上限的成长写到效果为止，后面什么都不跟（不写「无上限」）。
    "a3": "\n".join(MAIN_ICON + line for line in (
        f"暗属性共鸣时，Fever 模式中，当前每有1连击，暗属性角色直接攻击造成的伤害+{COMBO_PERCENT}%（独立乘区）、攻击力+{COMBO_PERCENT}%。",
        f"暗属性共鸣时，Fever 模式中，处于贯穿效果的时间每累计2秒，暗属性角色攻击力+{PIERCING_PERCENT}%、直接攻击伤害+{PIERCING_PERCENT}%。",
        "暗属性共鸣时，暗属性角色合计每直接攻击45次，Fever 槽+15%。",
        f"暗属性共鸣时，每有1个协力球存在时，全队及协力球对敌人造成的直接攻击伤害+{BALL_PERCENT}%（独立乘区）。",
    )),
    "a4": "暗属性共鸣时，Fever 模式中，暗属性角色及协力球直接攻击造成的伤害+50%（独立乘区）。",
    "a5": (
        "非 Fever 模式中，每经过10秒，赋予全队贯穿效果，持续3秒。\n"
        "Fever 模式中，每经过5秒，赋予全队贯穿效果，持续3秒。"
    ),
    "a6": "暗属性共鸣时，暗属性角色直接攻击伤害+100%。",
}


def _piercing_line(policy):
    if policy == "dark_resonance":
        return f"暗属性共鸣时，全队贯穿效果时间+{PIERCING_EXTENSION_PERCENT}%。"
    raise ValueError(f"piercing_extension must be one of {PIERCING_POLICIES}: {policy!r}")


def panel_descriptions(*, piercing_extension="dark_resonance"):
    """返回主动、队长和六能力；贯穿延时使用已确认的常驻暗共鸣条件（2026-09-27 起在能力2）。"""
    texts = deepcopy(_TEXTS)
    texts["a1"] = main_description(texts["a1"])
    texts["a2"] = _piercing_line(piercing_extension) + "\n" + texts["a2"]
    texts["leader"] += "\n" + ball_hit_count.DESCRIPTION
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
        CHANGE_SKILL_STRING_ID: [[CHANGE_SKILL_DESCRIPTION]],
        SPAWN_STRING_ID: [[SPAWN_DESCRIPTION]],
        PF_STRING_ID: [["强化弹射变为特殊型与辅助型组合"]],
    }


def metadata(*, piercing_extension="dark_resonance"):
    _piercing_line(piercing_extension)
    return {
        "character_id": CID,
        "required_client_capabilities": [REQUIRED_CAPABILITY],
        "leader_piercing_extension": piercing_extension,
        "piercing_extension_panel": "a2",
        "override_key_source": "first ability/leader row c0 (string_id)",
        "combat_rows_modified": False,
        "numeric_text": "fixed authored values at all ability levels",
        "coverage": "character ability and leader panels; comparison and disabled-reason text remain native",
    }
