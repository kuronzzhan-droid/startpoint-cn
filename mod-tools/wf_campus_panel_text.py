"""两位校园角色的简洁说明；只返回文字，不修改任何战斗表行。

整组覆盖依赖 panel-description-override-v2，键取该组首行 c0。
原生 ability c3/c4、leader c1/c2 是觉醒字段，不能拿来写描述。
"""
from __future__ import annotations

from copy import deepcopy
from wf_featured_main_ability import main_description

REQUIRED_CAPABILITY = "panel-description-override-v2"
FLAT_STRING_TABLE = "master/string/custom_ability_string.orderedmap"
CODES = {"119989": "lady_summoner_campus", "149989": "wind_spgirl_campus"}

_BIANCA = {
    "active": (
        "幼龙不在场：召唤幼龙协力球，降低全场敌人攻击力；成功召唤后自身获得「幼龙回应」。\n"
        "幼龙在场：令其飞至上空向下吐息，对全场敌人造成火属性能力伤害，"
        "降低火属性抗性、增加FEVER槽，并使自身获得「幼龙吐息」，随后幼龙退场。\n"
        "幼龙持续驻场，直至被击倒或再次施放技能令其退场。"
    ),
    "leader": (
        "火属性共鸣时，火属性角色攻击力+200%、能力伤害+400%。\n"
        "火属性共鸣时，Fever模式中，火属性角色攻击力+200%。\n"
        "火属性共鸣时，每次获得「幼龙回应」：Fever槽+500，火属性角色技能槽+25%。\n"
        "火属性角色发动技能时：对全场敌人造成50倍火属性能力伤害。"
    ),
    # 2026-09-27 第二批（wf_balance_20260927b_bianca）：开局自充 75%→50%、吐息自充 50%→20%；a5 去主位后不带图标。
    "a1": (
        "战斗开始时：自身技能槽+50%。\n"
        "火属性共鸣时，强化幼龙吐息，赋予全场敌人能力伤害抗性降低20%效果，持续15秒。\n"
        "火属性共鸣时，每次获得「幼龙吐息」，自身技能槽+20%，赋予队长攻击力提升200%效果，持续15秒。"
    ),
    "a2": (
        "火属性共鸣时，火属性角色发动技能时，对最近敌人造成10倍火属性能力伤害，冷却1秒。\n"
        "火属性共鸣时，火属性角色发动技能时，赋予队长攻击力提升100%效果，持续8秒。"
    ),
    "a3": (
        " <icon id='main'>  火属性共鸣时，Fever模式中，火属性角色技能槽上限+20%。\n"
        " <icon id='main'>  火属性共鸣时，Fever模式中，每经过2秒，队长技能槽+5%，自身获得1层「焰域研修」。\n"
        " <icon id='main'>  火属性共鸣时，Fever模式中，每层「焰域研修」使火属性角色能力伤害+50%。\n"
        " <icon id='main'>  火属性共鸣时，Fever模式中，每层「焰域研修」使火属性角色能力伤害额外乘区+1%。\n"
        " <icon id='main'>  Fever结束或自身倒下时，「焰域研修」清空。"
    ),
    "a4": "火属性共鸣时，Fever时间+15%。\nFever模式中，火属性角色技能充能速度+10%。",
    "a5": "火属性共鸣时，火属性角色发动技能：Fever槽+15%。",
    "a6": (
        "火属性角色发动技能时，火属性角色能力伤害+10%（最大+100%）。\n"
        "Fever模式中，火属性角色发动技能时，火属性角色攻击力+10%（最大+100%）。"
    ),
}

_CELTIE = {
    "active": (
        "向Boss突进并持续朝其释放十字双空牙（无Boss时选择最近敌人），对命中敌人造成基础合计75倍风属性伤害，"
        "伤害量以能力伤害加成判定。风属性共鸣且Fever模式中，技能倍率随「星风心得」成长，每层额外增加10倍（最多10层）。"
    ),
    # 2026-09-27 第二批：心得无上限逐层成长从能力3搬进队长（每层2.5%），第4行注明队长同时给2层心得。
    "leader": (
        "风属性角色攻击力+200%、能力伤害+400%。\n"
        "风属性共鸣时，强化弹射变为特殊剑士型，造成风属性伤害，伤害量以能力伤害加成判定。\n"
        "风属性共鸣时，Fever模式中，强化弹射时，对全场敌人追加10倍风属性能力伤害。\n"
        "风属性共鸣时，Fever模式中，风属性角色发动技能时，自身获得2层「星风快门」与2层「星风心得」。\n"
        "风属性共鸣时，Fever模式中，弹射时消耗1层「星风快门」，连击+7。\n"
        "风属性共鸣时，Fever模式中，每层「星风心得」使风属性角色能力伤害+2.5%、攻击力+2.5%。"
    ),
    "a1": (
        "战斗开始时：自身技能槽+50%。\n"
        "风属性共鸣时，强化技能，额外赋予全队贯穿、风属性角色能力伤害提升100%、"
        "命中敌人风属性抗性降低25%效果，持续15秒。"
    ),
    "a2": (
        "风属性共鸣时，风属性角色直接攻击分为3次，能力伤害+200%。\n"
        "风属性共鸣时，Fever模式中，每消耗1层「星风快门」，Fever槽+5%。"
    ),
    "a3": (
        " <icon id='main'>  风属性共鸣时，Fever模式中，风属性角色合计每直接攻击35次，对全场敌人造成25倍风属性能力伤害。\n"
        " <icon id='main'>  风属性共鸣时，非Fever模式中，风属性角色合计每直接攻击35次，Fever槽+15%。\n"
        " <icon id='main'>  风属性共鸣时，Fever模式中，连击每达到7的倍数，风属性角色攻击力+70%（最大+700%）、技能槽+0.7%（回槽冷却时间：0.7秒）。\n"
        " <icon id='main'>  风属性共鸣时，Fever模式中，风属性角色发动技能时，自身获得1层「星风快门」。\n"
        " <icon id='main'>  风属性共鸣时，Fever模式中，弹射时消耗1层「星风快门」，连击+7。\n"
        " <icon id='main'>  风属性共鸣时，每获得1层「星风快门」，自身获得1层「星风心得」。\n"
        " <icon id='main'>  风属性共鸣时，Fever模式中，每层「星风心得」使风属性角色能力伤害+8%、攻击力+5%（最多10层）。"
    ),
    "a4": "风属性共鸣时，Fever模式中，每经过5秒，赋予全队贯穿效果，持续1秒。",
    "a5": "风属性共鸣时，Fever模式中，每经过5秒，赋予全队浮游效果，持续1秒。",
    "a6": (
        "风属性共鸣时，Fever模式中，每经过5秒，赋予全队1秒最大速度固定效果。"
    ),
}


def panel_descriptions(character_id):
    """返回主动、队长、A1–6全文；返回副本，调用方不会污染下次构建。"""
    cid = str(character_id)
    if cid not in CODES:
        raise ValueError(f"unsupported campus character: {cid}")
    texts = deepcopy(_BIANCA if cid == "119989" else _CELTIE)
    texts["a1"] = main_description(texts["a1"])
    # 2026-09-27 作者平衡第二批：碧安卡能力5 去主位限制，面板不再加主位图标（wf_balance_20260927b_bianca）。
    return texts


def active_description(character_id):
    """主动技能说明可直接写action_skill和character_text，不需要面板补丁。"""
    return panel_descriptions(character_id)["active"]


def native_flat_string_rows(character_id):
    """原生I536/I629/I722合法平表键；不靠空字符串隐藏任何能力行。"""
    cid = str(character_id)
    panel_descriptions(cid)  # 不支持的角色必须拒绝，不能落入另一角色的分支。
    if cid == "119989":
        return {
            "change_skill_lady_summoner_campus_dragon": [[
                "强化幼龙吐息：降低全场敌人的能力伤害抗性"
            ]],
            "lady_summoner_campus_fever_tick": [["获得1层「焰域研修」"]],
        }
    return {
        "change_skill_wind_spgirl_campus_fever": [[
            "强化技能：全队贯穿、风属性角色能力伤害+100%，"
            "命中敌人风属性抗性-25%（均15秒）"
        ]],
        "wind_spgirl_campus_flip_stock": [["获得2层「星风快门」"]],
        "wind_spgirl_campus_flip_stock_ability": [["获得1层「星风快门」"]],
        "wind_spgirl_campus_fever_powerflip": [[
            "强化弹射变为特殊剑士型：风属性伤害（伤害量以能力伤害加成判定）"
        ]],
    }


def override_string_rows(character_id, ability_rows, leader_rows):
    """仅返回7个整组覆盖键；检查实际c0，不移动、删除或改写原战斗行。"""
    cid = str(character_id)
    texts = panel_descriptions(cid)
    code = CODES[cid]
    groups = {"leader": leader_rows}
    groups.update({f"a{slot}": ability_rows.get(cid + str(slot), [])
                   for slot in range(1, 7)})
    result = {}
    for slot, rows in groups.items():
        expected = code if slot == "leader" else code + "_" + slot[1:]
        if not rows or not rows[0] or rows[0][0] != expected:
            raise ValueError(f"{cid} {slot}: first-row string_id must be {expected}")
        result["desc_override_" + rows[0][0]] = [[texts[slot]]]
    return result


def metadata():
    return {
        "required_client_capabilities": [REQUIRED_CAPABILITY],
        "override_key_source": "first ability/leader row c0 (string_id)",
        "combat_rows_modified": False,
        "numeric_text": "fixed authored values at all ability levels; no dynamic level interpolation",
        "unsupported_client": "native generated ability text remains; active and native strings still work",
        "coverage": "character ability and leader panels; comparison and disabled-reason text remain native",
    }
