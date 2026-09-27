# -*- coding: utf-8 -*-
"""PARADOX（5920001）：作者 2026-09-28 设计的单件武器生成器。

纯函数：读 live 模板行 → 输出 flat / nested / dsl / server 增量（与 ``wf_cursed_weapons`` 共用装配件与校验）。
效果（写在 ability_soul，觉醒 1→5 数值不变）：

- 自身攻击力 +550%；直接攻击 / 技能 / 强化弹射 / 能力伤害各 +550%；
- 独立乘区（全伤害 723 / 直击 693 / 技能 694 / 能力 695 / 强化弹射 696）各 +10%；
- 自身直接攻击判定额外 +5（629 → ACAdditionalDirectAttack 共 6 段；引擎把一次直击的伤害均分到各段，
  段数本身不加总伤，加的是连击与命中次数）；
- 每次弹射连击 +35；自身技能充能速度 +20%；技能槽上限 +50%；
- 自身弱体无效（58 DebuffPrevent = ConditionPrevent(All(Bad))：毒/麻痹/冻结/沉默/回复无效/增益无效与各类数值降低全挡，
  不用 57——它是 All(Both)，连增益也挡）；自身攻击力再加上 100% 合击角色攻击力（717）；
- 自身为基诺维 / 杰拉德 / 凯尔时攻击力再 +150%。角色组只认属性/类型/性别/种族/角色标签，
  所以新增 3 个角色标签（character_tag）并写进这三人 character 表 c5（逗号列表，保留原有标签）。
  赛瑞斯按作者 0928 要求移出（之后重做）；生成器会把不在名单里的 tag_paradox_* 从角色行与标签表清掉。

强化（作者 0928：「觉醒 120 级满级属性、数值高一点、添加诅咒」）：照诅咒武器的强化体系——强化类目 6「诅咒武器·觉醒」、
五重决战材料 6 阶、需满破；1→119 线性成长 + 120 级补足到终值（攻击/四类伤害 800%、独立乘区 20%、直击 8 段、弹射连击 50、
充能 30%、槽上限 100%、合击攻击 150%、三人专属 250%）。120 级解放诅咒「孤立」（自身以外队员攻击 -50%、技能充能 -30%）与
「代价」（自身放技能时受最大 HP 15% 伤害，不致死）——都是数值/伤害而非状态，自身弱体无效挡不住。

未含：「每多装备一件武器/魂珠效果衰减 25%」需要客户端补丁（client-patch/equipment-rules，另行实现）；
三人放技能时的 25% 技能复刻另行设计。
"""
from __future__ import annotations

from typing import Any

import wf_client_legality as L
import wf_cursed_weapons as W
from wf_cursed_weapons import Eff

ITEM, EQUIPMENT, EQUIPMENT_STATUS, SOUL, CAS = W.ITEM, W.EQUIPMENT, W.EQUIPMENT_STATUS, W.SOUL, W.CAS
ENH, EA, ENH_STATUS, ENH_SHOP = W.ENH, W.EA, W.ENH_STATUS, W.ENH_SHOP
CHARACTER = "master/character/character.orderedmap"
CHARACTER_TAG = "master/character/character_tag.orderedmap"
FLAT_TABLES = (ITEM, EQUIPMENT, SOUL, ENH, EA, ENH_SHOP, CAS, CHARACTER_TAG, CHARACTER)

ID = "5920001"
NAME = "PARADOX"
SLUG = "paradox"
CATEGORY = "剑"                                  # 服务端 equipment_lookup 类别
ICON = "item/equipment/mod/paradox/paradox"
ICON120 = "item/equipment/mod/paradox/paradox_lv120"
NAME120 = f"{NAME}·终式"
ENH_DESCRIPTION = "强化至120级进入终式：数值全面提升，同时解放诅咒。效果见能力说明。"
DSL_DIR = "battle/action/skill/action/ability_skill/paradox"
HITS = f"{DSL_DIR}$hits"
HITS_TEXT = "自身的直接攻击判定额外+5次（共6段）"
HITS_FINAL = f"{DSL_DIR}$hits_final"
HITS_FINAL_TEXT = "自身的直接攻击判定额外+7次（共8段）"
FLAVOR = "莫比乌斯环扭成的双色长剑。握着它的人越是孤身一人，就越是无可匹敌。"
EQUIPMENT_STATUS_ROWS = {"1": "330,148", "5": "495,221"}
TAG_COLUMN = 5                                   # character 表 c5 = 角色标签列表（逗号分隔）
PRE_MY_SELF = "3"                                # 前置 MySelf：自身属于角色组
TAG_PREFIX = "tag_paradox_"

#: (角色 ID, 标签, 标签显示名)。标签显示名进词条说明「自身为…时」。
TAGS = (
    ("169999", "tag_paradox_ginovi", "基诺维"),
    ("149999", "tag_paradox_gerald", "杰拉德"),
    ("139990", "tag_paradox_kyle", "凯尔"),
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
        Eff("0", ("58", {"target": self_}), note="自身弱体无效（异常状态与数值降低全部无效）"),
        Eff("0", W.stat("717", self_, 100), note="自身攻击力再加上 100% 合击角色攻击力"),
        Eff("0", W.stat("32", self_, 150), pre=(chosen,), note="自身为基诺维/杰拉德/凯尔时攻击力再 +150%"),
    ]


def hits_dsl(segments: int = 6) -> list:
    """自身直接攻击 N 段、伤害修正 0（总伤害不变，均分到各段）；永续、不可驱散。同类状态段数多者胜（isBetterThan），
    120 级的 8 段会盖过本体的 6 段。"""
    return W.dsl_root(W.give(-17, [["ACAdditionalDirectAttack", W.P(9999999), W.P(segments), W.P(0.0), W.P(1)]],
                             "paradox_hits", cancelable=False))


def enhancement_abilities() -> list[Eff]:
    """强化词条：1→119 成长 + 120 补足到终值；120 级再加直击 8 段、弹射连击 +15（合计 50）与诅咒。"""
    self_ = W.T_SELF
    chosen = (PRE_MY_SELF, {"character_groups": ",".join(tag for _, tag, _ in TAGS)})
    rows: list[Eff] = []
    for kind, target, total, base in (("32", self_, 800, 550), ("33", self_, 800, 550), ("34", self_, 800, 550),
                                      ("55", None, 800, 550), ("388", self_, 800, 550),
                                      ("723", self_, 20, 10), ("693", self_, 20, 10), ("694", self_, 20, 10),
                                      ("695", self_, 20, 10), ("696", None, 20, 10),
                                      ("35", self_, 30, 20), ("245", self_, 100, 50), ("717", self_, 150, 100)):
        rows += W.growth_pair(kind, target, total, base)
    rows += W.growth_pair("32", self_, 250, 150, pre=(chosen,))
    final = dict(learn=120, maxlvl=120)
    rows += [
        Eff("0", W.invoke("paradox_hits_final", HITS_FINAL), **final, note="120 级：直接攻击变为 8 段（判定额外 +7）"),
        Eff("0", ("226", {"strength": (_count(15), _count(15))}), trig=W.trig("6", threshold=_count(1)), **final,
            note="120 级：每次弹射连击再 +15（合计 +50）"),
        Eff("0", W.stat("32", W.T_EXCEPT, -50), **final, note="【诅咒·孤立】自身以外的队员攻击力 -50%"),
        Eff("0", W.stat("35", W.T_EXCEPT, -30), **final, note="【诅咒·孤立】自身以外的队员技能充能速度 -30%"),
        Eff("0", W.stat("209", self_, 15), trig=W.trig(W.IT_SKILL, trigger_puller=W.P_SELF), **final,
            note="【诅咒·代价】自身发动技能时受到最大 HP 15% 的伤害（不致死）"),
    ]
    return rows


def description() -> str:
    return FLAVOR


def retag(row: list[str], tag: str | None) -> list[str]:
    """c5 去掉所有 tag_paradox_*，再按名单补上本角色的标签（保留其它标签与顺序）。"""
    out = list(row)
    tags = [t for t in out[TAG_COLUMN].split(",") if t and not t.startswith(TAG_PREFIX)]
    out[TAG_COLUMN] = ",".join(tags + ([tag] if tag else []))
    return out


def build(read: W.LiveReader, *, allow_existing: bool = False) -> dict[str, Any]:
    """allow_existing=True 供补丁边同步暂存：自有键（5920001 / paradox_hits / tag_paradox_*）已在 live 时不算撞键。"""
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
    enh = enhancement_abilities()
    ea_rows = [W.build_row(W.EA_T, slot, eff) for slot, eff in enumerate(enh)]
    for table, rows in ((W.SOUL_T, soul_rows), (W.EA_T, ea_rows)):
        for index, r in enumerate(rows):
            problems += [f"{table}#{index}: {p}" for p in L.client_legality_problems(table, r)]
    flat[SOUL][ID] = soul_rows
    flat[EA][ID] = ea_rows
    flat[CAS]["paradox_hits"] = [[HITS_TEXT]]
    flat[CAS]["paradox_hits_final"] = [[HITS_FINAL_TEXT]]
    cas_keys = set(read.flat(CAS)) | set(flat[CAS])
    for table, rows in ((W.SOUL_T, soul_rows), (W.EA_T, ea_rows)):
        for index, r in enumerate(rows):
            problems += [f"{table}#{index}: {p}" for p in L.invoke_skill_string_problems(r, cas_keys, table)]

    # 强化：名/图/描述 120 级切换；强化 status 照诅咒武器；商店 6 阶挂诅咒武器类目 6、五重材料
    W._require(len(ENH_DESCRIPTION) <= W.DESC_LIMITS["enhancement"] and "," not in ENH_DESCRIPTION, "强化说明超长或含逗号")
    row = W._template(read, ENH, "5900101", 9)
    row[0:9] = ["120", "120", NAME120, "120", ICON120, "120", ENH_DESCRIPTION, "120", W.START_TIME]
    flat[ENH][ID] = [row]
    for stage, (cap, costs) in enumerate(W.ENH_STAGES, start=1):
        row = W._template(read, ENH_SHOP, f"5900110{stage}", 50)
        row[0], row[2], row[3] = W.ENH_CATEGORY_KEY, ID, str(stage)
        row[14:22] = W._cost_cells(costs)
        row[22], row[23], row[29], row[30], row[31] = W.START_TIME, "(None)", ID, str(cap), str(W.REQUIRE_AWAKENING)
        flat[ENH_SHOP][f"{ID}{stage:02d}"] = [row]

    live_tags = read.flat(CHARACTER_TAG)
    live_chars = read.flat(CHARACTER)
    designated = {cid: tag for cid, tag, _ in TAGS}
    for cid, tag, label in TAGS:
        flat[CHARACTER_TAG][tag] = [[label]]
        W._require(cid in live_chars, f"character 表缺 {cid}")
    for cid, rows in live_chars.items():
        row = rows[0]
        if cid in designated or any(t.startswith(TAG_PREFIX) for t in row[TAG_COLUMN].split(",")):
            flat[CHARACTER][cid] = [retag(row, designated.get(cid))]
    delete = {CHARACTER_TAG: sorted(k for k in live_tags if k.startswith(TAG_PREFIX) and k not in flat[CHARACTER_TAG])}

    dsl = {HITS: hits_dsl(6), HITS_FINAL: hits_dsl(8)}
    programs = {r[W._col(t, "instant_content", "action_path")] for t, rows in ((W.SOUL_T, soul_rows), (W.EA_T, ea_rows))
                for r in rows if r[W._col(t, "instant_content", "kind")] == "629"}
    W._require(programs == set(dsl), f"629 行引用的 DSL 与生成的 DSL 不一致：{programs ^ set(dsl)}")
    for program, tree in dsl.items():
        for check in (W.dsl_signature_problems, W.colorless_hit_effect_problems, L.action_dsl_element_problems,
                      L.action_dsl_subject_binding_problems, L.action_dsl_lookup_scope_problems,
                      L.action_dsl_hit_area_target_problems):
            problems += [f"DSL {program}: {p}" for p in check(tree)]

    if not allow_existing:
        for logical in (ITEM, EQUIPMENT, SOUL, ENH, EA, ENH_SHOP, CAS, CHARACTER_TAG):
            clash = sorted(set(flat[logical]) & set(read.flat(logical)))
            W._require(not clash, f"{logical} 键已存在：{clash}")
        for logical in (EQUIPMENT_STATUS, ENH_STATUS):
            W._require(ID not in read.nested(logical), f"{logical} 键已存在：{ID}")

    return {
        "flat": flat,
        "nested": {EQUIPMENT_STATUS: {ID: dict(EQUIPMENT_STATUS_ROWS)}, ENH_STATUS: {ID: dict(W.ENH_STATUS_ROWS)}},
        "dsl": dsl,
        "server": _server_delta(flat),
        "delete": delete,
        "problems": problems,
        "abilities": effs,
        "enhancement": enh,
    }


def _server_delta(flat: dict) -> dict[str, Any]:
    shop = {}
    for key, rows in flat[ENH_SHOP].items():
        r = rows[0]
        costs = [{"id": int(r[i]), "amount": int(r[i + 1])} for i in (14, 16, 18, 20) if r[i] not in ("", "(None)")]
        shop[key] = {"availableFrom": W.START_TIME, "availableUntil": None, "costs": costs,
                     "enhancementMaxLevel": int(r[30]), "equipmentId": int(r[29]), "groupId": int(r[2]),
                     "requireAwakeningLevel": int(r[31]), "rewards": [], "shopCategoryId": int(r[0]),
                     "stage": int(r[3]), "stock": -1}
    return {
        "equipment_enhancement_shop.json": shop,
        "equipment_ids.json": [int(ID)],
        "equipment_lookup.json": {ID: {"name": NAME, "rarity": "5", "category": CATEGORY}},
        "equipment_max_level.json": {ID: 5},
        "equipment_element.json": {ID: -1},
        "item_ids.json": [int(ID)],
        "item_sale.json": {ID: {"category": 5, "sale_price": 500, "sellable": True}},
    }
