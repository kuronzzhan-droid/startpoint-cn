# -*- coding: utf-8 -*-
"""PARADOX（5920001）：作者 2026-09-28 设计的单件武器生成器。

纯函数：读 live 模板行 → 输出 flat / nested / dsl / server 增量（与 ``wf_cursed_weapons`` 共用装配件与校验）。
效果（写在 ability_soul，觉醒 1→5 数值不变）：

- 自身攻击力 +550%；直接攻击 / 技能 / 强化弹射 / 能力伤害各 +550%；
- 独立乘区（全伤害 723 / 直击 693 / 技能 694 / 能力 695 / 强化弹射 696）各 +10%；
- 自身直接攻击判定额外 +5（629 → ACAdditionalDirectAttack 共 6 段；引擎把一次直击的伤害均分到各段，
  段数本身不加总伤，加的是连击与命中次数）；
- 每次弹射连击 +35；自身技能充能速度 +20%；技能槽上限 +50%；
- 自身为基诺维 / 杰拉德 / 凯尔 / 赛瑞斯时攻击力再 +150%。角色组只认属性/类型/性别/种族/角色标签，
  所以新增 4 个角色标签（character_tag）并写进这四人 character 表 c5（逗号列表，保留原有标签）。

未含：「每多装备一件武器/魂珠效果衰减 25%」需要客户端补丁（client-patch/equipment-rules，另行实现）；
四人放技能时的 25% 技能复刻另行设计。
"""
from __future__ import annotations

from typing import Any

import wf_client_legality as L
import wf_cursed_weapons as W
from wf_cursed_weapons import Eff

ITEM, EQUIPMENT, EQUIPMENT_STATUS, SOUL, CAS = W.ITEM, W.EQUIPMENT, W.EQUIPMENT_STATUS, W.SOUL, W.CAS
CHARACTER = "master/character/character.orderedmap"
CHARACTER_TAG = "master/character/character_tag.orderedmap"
FLAT_TABLES = (ITEM, EQUIPMENT, SOUL, CAS, CHARACTER_TAG, CHARACTER)

ID = "5920001"
NAME = "PARADOX"
SLUG = "paradox"
CATEGORY = "剑"                                  # 服务端 equipment_lookup 类别
ICON = "item/equipment/mod/paradox/paradox"
DSL_DIR = "battle/action/skill/action/ability_skill/paradox"
HITS = f"{DSL_DIR}$hits"
HITS_TEXT = "自身的直接攻击判定额外+5次（共6段）"
FLAVOR = "莫比乌斯环扭成的双色长剑。握着它的人越是孤身一人，就越是无可匹敌。"
EQUIPMENT_STATUS_ROWS = {"1": "330,148", "5": "495,221"}
TAG_COLUMN = 5                                   # character 表 c5 = 角色标签列表（逗号分隔）
PRE_MY_SELF = "3"                                # 前置 MySelf：自身属于角色组

#: (角色 ID, 标签, 标签显示名)。标签显示名进词条说明「自身为…时」。
TAGS = (
    ("169999", "tag_paradox_ginovi", "基诺维"),
    ("149999", "tag_paradox_gerald", "杰拉德"),
    ("139990", "tag_paradox_kyle", "凯尔"),
    ("129999", "tag_paradox_seris", "赛瑞斯"),
)


def _count(n: int) -> str:
    return W.times(n)


def abilities() -> list[Eff]:
    self_ = W.T_SELF
    chosen = (PRE_MY_SELF, {"character_groups": ",".join(tag for _, tag, _ in TAGS)})
    return [
        Eff("0", W.stat("32", self_, 550), note="自身攻击力 +550%"),
        Eff("0", W.stat("33", self_, 550), note="自身直接攻击伤害 +550%"),
        Eff("0", W.stat("34", self_, 550), note="自身技能伤害 +550%"),
        Eff("0", W.stat("55", None, 550), note="强化弹射伤害 +550%"),
        Eff("0", W.stat("388", self_, 550), note="自身能力伤害 +550%"),
        Eff("0", W.stat("723", self_, 10), note="自身全伤害独立乘区 +10%"),
        Eff("0", W.stat("693", self_, 10), note="自身直接攻击伤害独立乘区 +10%"),
        Eff("0", W.stat("694", self_, 10), note="自身技能伤害独立乘区 +10%"),
        Eff("0", W.stat("695", self_, 10), note="自身能力伤害独立乘区 +10%"),
        Eff("0", W.stat("696", None, 10), note="强化弹射伤害独立乘区 +10%"),
        Eff("0", W.invoke("paradox_hits", HITS), note="开局：自身直接攻击变为 6 段（判定额外 +5）"),
        Eff("0", ("226", {"strength": (_count(35), _count(35))}), trig=W.trig("6", threshold=_count(1)),
            note="每次弹射连击 +35"),
        Eff("0", W.stat("35", self_, 20), note="自身技能充能速度 +20%"),
        Eff("0", W.stat("245", self_, 50), note="自身技能槽上限 +50%"),
        Eff("0", W.stat("32", self_, 150), pre=(chosen,), note="自身为基诺维/杰拉德/凯尔/赛瑞斯时攻击力再 +150%"),
    ]


def hits_dsl() -> list:
    """自身直接攻击 6 段、伤害修正 0（总伤害不变，均分到 6 段）；永续、不可驱散。"""
    return W.dsl_root(W.give(-17, [["ACAdditionalDirectAttack", W.P(9999999), W.P(6), W.P(0.0), W.P(1)]],
                             "paradox_hits", cancelable=False))


def description() -> str:
    return FLAVOR


def with_tag(row: list[str], tag: str) -> list[str]:
    out = list(row)
    tags = [t for t in out[TAG_COLUMN].split(",") if t]
    if tag not in tags:
        tags.append(tag)
    out[TAG_COLUMN] = ",".join(tags)
    return out


def build(read: W.LiveReader) -> dict[str, Any]:
    flat: dict[str, dict[str, list[list[str]]]] = {t: {} for t in FLAT_TABLES}
    problems: list[str] = []
    text = description()
    W._require(len(text) <= W.DESC_LIMITS["equipment"] and "," not in text and "\n" not in text, "装备说明超长或含逗号/换行")

    row = W._template(read, ITEM, "8000101", 23)
    row[0], row[1], row[2], row[3] = f"mod_{SLUG}_{ID}", ID, f"{NAME}魂珠", ICON
    flat[ITEM][ID] = [row]
    row = W._template(read, EQUIPMENT, "8000101", 16)
    W._require(row[2] == "0" and row[8] == "5" and row[11] == "5", "equipment 模板列义漂移")
    row[0], row[1], row[6], row[7], row[9], row[10] = f"mod_{SLUG}", NAME, ICON, text, "false", ID
    flat[EQUIPMENT][ID] = [row]

    effs = abilities()
    soul_rows = [W.build_row(W.SOUL_T, slot, eff) for slot, eff in enumerate(effs)]
    for index, r in enumerate(soul_rows):
        problems += [f"ability_soul#{index}: {p}" for p in L.client_legality_problems(W.SOUL_T, r)]
    flat[SOUL][ID] = soul_rows
    flat[CAS]["paradox_hits"] = [[HITS_TEXT]]
    cas_keys = set(read.flat(CAS)) | set(flat[CAS])
    for index, r in enumerate(soul_rows):
        problems += [f"ability_soul#{index}: {p}" for p in L.invoke_skill_string_problems(r, cas_keys, W.SOUL_T)]

    live_tags = read.flat(CHARACTER_TAG)
    live_chars = read.flat(CHARACTER)
    for cid, tag, label in TAGS:
        flat[CHARACTER_TAG][tag] = [[label]]
        W._require(cid in live_chars, f"character 表缺 {cid}")
        flat[CHARACTER][cid] = [with_tag(live_chars[cid][0], tag)]

    dsl = {HITS: hits_dsl()}
    for program, tree in dsl.items():
        for check in (W.dsl_signature_problems, W.colorless_hit_effect_problems, L.action_dsl_element_problems,
                      L.action_dsl_subject_binding_problems, L.action_dsl_lookup_scope_problems,
                      L.action_dsl_hit_area_target_problems):
            problems += [f"DSL {program}: {p}" for p in check(tree)]

    for logical, key_sets in ((ITEM, [ID]), (EQUIPMENT, [ID]), (SOUL, [ID]), (CAS, ["paradox_hits"]),
                              (CHARACTER_TAG, [t for _, t, _ in TAGS])):
        clash = sorted(set(key_sets) & set(read.flat(logical)))
        W._require(not clash, f"{logical} 键已存在：{clash}")
    W._require(ID not in read.nested(EQUIPMENT_STATUS), f"{EQUIPMENT_STATUS} 键已存在：{ID}")
    W._require(not (set(t for _, t, _ in TAGS) & set(live_tags)), "character_tag 键已存在")

    return {
        "flat": flat,
        "nested": {EQUIPMENT_STATUS: {ID: dict(EQUIPMENT_STATUS_ROWS)}},
        "dsl": dsl,
        "server": _server_delta(),
        "problems": problems,
        "abilities": effs,
    }


def _server_delta() -> dict[str, Any]:
    return {
        "equipment_ids.json": [int(ID)],
        "equipment_lookup.json": {ID: {"name": NAME, "rarity": "5", "category": CATEGORY}},
        "equipment_max_level.json": {ID: 5},
        "equipment_element.json": {ID: -1},
        "item_ids.json": [int(ID)],
        "item_sale.json": {ID: {"category": 5, "sale_price": 500, "sellable": True}},
    }
