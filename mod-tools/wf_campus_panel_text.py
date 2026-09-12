"""两位校园角色的简洁说明；只返回文字，不修改任何战斗表行。

整组覆盖依赖 panel-description-override-v2，键取该组首行 c0。
原生 ability c3/c4、leader c1/c2 是觉醒字段，不能拿来写描述。
"""
from __future__ import annotations

from copy import deepcopy

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
        "火属性共鸣：火属性角色攻击力+200%、能力伤害+400%；Fever中攻击力再+200%。\n"
        "火属性共鸣时，每次获得「幼龙回应」：Fever槽+500，火属性角色技能槽+25%。\n"
        "火属性角色发动技能时：对全场敌人造成50倍火属性能力伤害。"
    ),
    "a1": (
        "战斗开始时：自身技能槽+75%。\n"
        "火属性共鸣：强化幼龙吐息，使全场敌人能力伤害抗性-20%（15秒）。\n"
        "火属性共鸣时，每次获得「幼龙吐息」：自身技能槽+50%，队长攻击力+200%（15秒）。"
    ),
    "a2": (
        "火属性共鸣时，火属性角色发动技能：\n"
        "对最近敌人造成10倍火属性能力伤害（伤害触发冷却1秒）。\n"
        "队长攻击力+100%（8秒，每次技能均可触发）。"
    ),
    "a3": (
        "主位／火属性共鸣／Fever中：火属性角色技能槽上限+20%。\n"
        "同条件下，每2秒：队长技能槽+10%，自身获得1层「焰域研修」；每层使火属性角色能力伤害+50%。\n"
        "「焰域研修」在Fever结束或自身倒下时清空。"
    ),
    "a4": "火属性共鸣：Fever时间+15%。\nFever中：火属性角色技能充能速度+10%。",
    "a5": "火属性共鸣时，火属性角色发动技能：Fever槽+5%。",
    "a6": (
        "火属性角色发动技能时：火属性角色能力伤害+10%（本场累计，最多+100%）。\n"
        "Fever中，火属性角色发动技能时：火属性角色攻击力+10%（本场累计，最多+100%）。"
    ),
}

_CELTIE = {
    "active": (
        "向最近敌人突进，释放十字双空牙，对命中敌人造成风属性伤害"
        "（伤害量以能力伤害加成判定）。"
    ),
    "leader": (
        "风属性角色攻击力+200%、能力伤害+400%。\n"
        "风属性共鸣：强化弹射变为特殊剑士型，"
        "造成风属性伤害（伤害量以能力伤害加成判定）。\n"
        "风属性共鸣／Fever中：每次强化弹射对全场敌人追加10倍风属性能力伤害；"
        "风属性角色发动技能时获得2层「星风快门」。\n"
        "同条件下，每次弹射消耗1层快门，连击+7；与能力3分别结算。"
        "两者齐备时，每次技能共获得3层，每次弹射最多消耗2层、连击+14。\n"
        "快门可累积，本场保留；非风属性共鸣或非Fever期间暂停获取与消耗。"
    ),
    "a1": (
        "战斗开始时：自身技能槽+50%。\n"
        "风属性共鸣：强化技能，额外赋予全队贯穿、风属性角色能力伤害+100%，"
        "并使命中敌人风属性抗性-25%（均持续15秒）。"
    ),
    "a2": (
        "风属性共鸣：风属性角色直接攻击分为3次，能力伤害+200%。\n"
        "风属性共鸣／Fever中：每消耗1层「星风快门」，Fever槽+5%"
        "（一次消耗2层时共+10%）。"
    ),
    "a3": (
        "主位／风属性共鸣：风属性角色合计每直接攻击35次，非Fever时Fever槽+5%；"
        "Fever中对全场敌人造成25倍风属性能力伤害。\n"
        "同条件且Fever中，当前连击每达到70的倍数：风属性角色攻击力+70%"
        "（本场累计，最多+700%）、技能槽+7%（无次数上限）。\n"
        "同条件且Fever中，风属性角色发动技能时获得1层「星风快门」；"
        "每次弹射消耗1层快门，连击+7，与队长技分别结算。\n"
        "每获得1层「星风快门」，本场累计1层「星风心得」；"
        "主位／风属性共鸣／Fever中，每层心得使风属性角色能力伤害+25%。"
        "消耗快门不减少心得，快门与心得均保留至战斗结束。"
    ),
    "a4": "风属性共鸣／Fever中：每3秒赋予全队贯穿，持续1.5秒。",
    "a5": "风属性共鸣／Fever中：每3秒赋予全队浮游，持续1.5秒。",
    "a6": (
        "风属性共鸣／Fever中：每3秒固定为二档最大速度（最大速度+200%），持续1.5秒；"
        "期间技能槽获取不衰减。"
    ),
}


def panel_descriptions(character_id):
    """返回主动、队长、A1–6全文；返回副本，调用方不会污染下次构建。"""
    cid = str(character_id)
    if cid not in CODES:
        raise ValueError(f"unsupported campus character: {cid}")
    return deepcopy(_BIANCA if cid == "119989" else _CELTIE)


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
