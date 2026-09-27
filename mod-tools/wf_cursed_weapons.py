# -*- coding: utf-8 -*-
"""诅咒武器 29 把：腾讯文档「诅咒武器专题意见征集」提案 → 武器数据（纯函数生成器）。

作者口径（2026-09-27 首轮，0928 修订）：
- 把表里的武器全部做出来，图标仿官方 20×20 像素风；
- **未强化（本体，含满破）只有正面数值，而且很弱**（设计值 × BASE_SCALE）；
- **强化 1 级起诅咒全额生效**；**强化到 120 级为最终数值**；
- 强化材料来自五重决战（深界结晶 10000145 / 五王心核 10000147 / 终式武装图纸 10000144）。

数据面（全部新键，不改任何已有键）：

- 客户端：``item`` / ``equipment`` / ``equipment_status``（嵌套）/ ``ability_soul`` / ``equipment_enhancement`` /
  ``equipment_enhancement_ability`` / ``equipment_enhancement_status``（嵌套）/ ``equipment_enhancement_shop``（每把 6 阶）/
  ``equipment_enhancement_shop_category``（新类目 6「诅咒武器·觉醒」）/ ``boss_coin_shop``（五重分类 99 上架本体）/
  ``unique_condition``（诅咒与计时用固有状态）/ ``custom_ability_string``（629 行文案）+ 新 ability_skill DSL。
- 服务端：``equipment_ids`` / ``equipment_lookup`` / ``equipment_max_level`` / ``equipment_element`` / ``item_ids`` /
  ``item_sale`` / ``equipment_enhancement_shop`` / ``boss_coin_shop``（分类 99）/ ``boss_coin_shop_item_category_map``。

机制约束（反编译实证，写在这里防回退）：

1. 攻击力加成总和在 ``NormalAttackCalculator.totalAttackPoint`` 被钳到 ≥ -50%（boot_ffc6 STAT_MODIFIER_ATTACK_POINT_MIN）；
   单次伤害最终 ``max(floor(dmg), 1)``。所以「攻击 -9999% / 伤害归零」用 **独立乘区伤害 -100%**（723/421）表达，
   「输出 -99%」同理用独立乘区 -99%。
2. 装备词条 = 本体 concat 强化；同 slot 取 learn ≤ 当前等级最高一行 ⇒ 每行独占一个 slot；
   「只在 120 级生效」= learn=max=120 的行；「强化 1 级起全额」= learn=1、max=120、两端同值。
   本体行随觉醒等级 1→5 在 power1→first_max 线性插值。
3. 629 InvokeSkill 在 ability_soul（c67/c68）与强化表（c70/c71）解析器里都有分支；装备词条的 DSL 走
   ``BattleCharacterLogic.resolvePathCollection`` → ``equipment.getCurrentAbility()`` 正式预载。
   string_id 必须写进 custom_ability_string（缺键 C8601）。DSL 不带任何特效路径（杜绝 C8016）。
4. 玩家侧 DSL 的 CreateWindAttack / CreateGravitationalField / CreateFlood 在 MemberImpl 直接 throw ⇒ 风场推人、重力、
   淹水物理做不了（第 12、15 条按偏差记录）。
5. 「能力/被动回槽禁止」= 持续 423 GaugeGainRestriction：装备两表的解析只有客户端补丁 equipment-rules 认（1047 读到 C7050），
   ``build`` 按 ``client_capabilities`` 拦截（默认 1047 基线），本机已装补丁时显式传 ``PATCHED_CLIENT_CAPABILITIES``。
6. 带 mul 的 CreateCondition 必须带非空唯一键串（基诺维吞噬同款坑）。

接口：:func:`build` 只经 ``read`` 读 live（见 :class:`LiveReader`），返回全部新增内容；不写盘、不发布、不 git。
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from dataclasses import dataclass, field, replace
from typing import Any, Callable, Iterable

import wf_battle_rules as BR
import wf_client_legality as L
import wf_client_patch_scope as SCOPE
import wf_describe as D
import wf_balance_20260927d_ginovi as GINOVI

# ---------------------------------------------------------------------------
# 表与常量
# ---------------------------------------------------------------------------

ITEM = "master/item/item.orderedmap"
EQUIPMENT = "master/item/equipment.orderedmap"
EQUIPMENT_STATUS = "master/item/equipment_status.orderedmap"            # 嵌套（wf_quest_lib）
SOUL = "master/ability/ability_soul.orderedmap"
ENH = "master/equipment_enhancement/equipment_enhancement.orderedmap"
EA = "master/equipment_enhancement/equipment_enhancement_ability.orderedmap"
ENH_STATUS = "master/equipment_enhancement/equipment_enhancement_status.orderedmap"   # 嵌套
ENH_SHOP = "master/equipment_enhancement/equipment_enhancement_shop.orderedmap"
ENH_CATEGORY = "master/equipment_enhancement/equipment_enhancement_shop_category.orderedmap"
BOSS_COIN_SHOP = "master/shop/boss_coin_shop.orderedmap"
UNIQUE = "master/character/unique_condition.orderedmap"
CAS = "master/string/custom_ability_string.orderedmap"

FLAT_TABLES = (ITEM, EQUIPMENT, SOUL, ENH, EA, ENH_SHOP, ENH_CATEGORY, BOSS_COIN_SHOP, UNIQUE, CAS)
NESTED_TABLES = (EQUIPMENT_STATUS, ENH_STATUS)

ID_BASE = 5910100                      # 武器 / 魂珠 / 强化 / 强化组 ID = 5910100 + 提案表行号
UNIQUE_BASE = 59100000                 # 固有状态 ID = 59100000 + 行号×10 + k
BOSS_SHOP_BASE = 990099000             # 领主币商店五重分类 99：990099003 起
BOSS_SHOP_CATEGORY = "99"
ENH_CATEGORY_KEY = "6"
IMAGE_DIR = "item/equipment/mod/cursed"
BANNER = "dynamic/equipment_enhancement/cursed_weapon_banner"
HEADER = "dynamic/equipment_enhancement/cursed_weapon_header"
DSL_DIR = "battle/action/skill/action/ability_skill/cursed_weapon"
START_TIME = "2000-01-01 00:00:00"     # 服务器时钟偏移，自制内容一律写 2000-01-01（见 wf-custom-server-time-trap）
END_TIME = "2099-12-31 23:59:59"

BLUEPRINT = "10000144"                 # 终式武装图纸（五重：每局 50% 掉 1）
CRYSTAL = "10000145"                   # 深界结晶（五重：5×倍率）
CORE = "10000147"                      # 五王心核（五重：25%，数量=倍率）

#: 强化 6 阶（阶段上限, [(材料, 数量), ...]）——全部五重材料；阶段形状照 5900101 / 深渊觉醒。
ENH_STAGES = (
    (69, ((CRYSTAL, 1),)),
    (70, ((CRYSTAL, 10), (CORE, 1))),
    (98, ((CRYSTAL, 2),)),
    (99, ((CRYSTAL, 10), (CORE, 2))),
    (119, ((CRYSTAL, 3), (CORE, 1))),
    (120, ((CORE, 3), (BLUEPRINT, 2))),
)
#: 五重分类 99 上架本体：每把 2 图纸 + 10 结晶，库存 5（满破需 5 把）。
BODY_COSTS = ((BLUEPRINT, 2), (CRYSTAL, 10))
BODY_STOCK = 5
REQUIRE_AWAKENING = 5

#: 作者 0928 口径：强化前（本体含满破）非常弱且只有正面；强化 1 级诅咒全额生效；强化 120 级为最终数值。
#: 诅咒行与其配套机制行用 CURSE（learn=1、全额常量）；正面终值行用 FINAL（120 级）；成长行 1→119 + 120 补足。
CURSE = dict(learn=1, maxlvl=120)
FINAL = dict(learn=120, maxlvl=120)
#: 作者 0928「要的就是强化前非常弱」：本体（含满破）按设计值的 20% 生效，强化 1→119 成长行补回差额，120 级终值不变。
#: 只缩数值类效果；机制类（技能槽上限 245、连击、贯通、固有状态、629 调用、扣血回血等）保持设计值。
BASE_SCALE = 0.2
WEAK_KINDS = frozenset({"0", "1", "2", "28", "32", "33", "34", "35", "55", "156", "202", "205", "211", "227", "388", "470",
                        "486", "693", "694", "701", "717", "723"})
#: 官方 5★ 武器 HP/ATK 成长（照 5020042 哈尔波曼 / 5900101）与强化 status（照官方 120 级武器）。
EQUIPMENT_STATUS_ROWS = {"1": "330,148", "5": "495,221"}
ENH_STATUS_ROWS = {"98": "0,0", "99": "50,10", "120": "50,10"}

INF_FRAMES = "9.999999E11"             # 「永续」帧（×100000），照 cnmod_boss_limit 实机在役写法

#: 回槽限制规则码：只拦「能力」类回槽（角色/队长/武器/魂珠/EX 的能力加槽，含连击与施技触发；来源不限）。
GAUGE_MASK = BR.gauge_mask(["ability"])
#: 客户端 capability 门禁。基线 = 1047 客户端已有能力（与 client-patch/equipment-rules/rules.py INHERITED_CAPABILITIES
#: 同步，PARADOX 测试互证）；equipment-rules 补丁 APK 再加 R1/R2 的 equipment-rules-v1 与 R3 的 equipment-gauge-gain-rules-v1。
EQUIPMENT_RULES_CAP = "equipment-rules-v1"
BASE_CLIENT_CAPABILITIES = frozenset({
    "damage-type-rules-v1", "dash-parameter-v1", "gauge-gain-rules-v1", "kyubi-fever-ratio-v1",
    "kyubi-panel-description-override-v1", "kyubi-pf-initial-combo-v1", "panel-description-override-v2",
})
PATCHED_CLIENT_CAPABILITIES = BASE_CLIENT_CAPABILITIES | {EQUIPMENT_RULES_CAP, SCOPE.EQUIPMENT_GAUGE_CAP}

# 目标 / 来源 枚举
T_SELF, T_EXCEPT, T_LEADER, T_SECOND, T_THIRD, T_PARTY, T_TRIGGER, T_MULTIBALL = "0", "1", "2", "3", "4", "5", "7", "8"
P_SELF, P_LEADER, P_ONE_OF_PARTY, P_ONE_OF_MULTIBALL = "0", "1", "5", "9"
# 触发 kind
IT_INITIAL, IT_PF, IT_FEVER, IT_DIRECT, IT_SKILL, IT_SKILL_MAX, IT_HP_LOW, IT_ELAPSED, IT_REVIVAL, IT_MB_REMOVE = (
    "0", "2", "8", "20", "23", "24", "25", "77", "18", "194")
IT_SKILL_HIT, IT_PF_HIT = "107", "183"   # SkillHit（带来源）/ OneOfEnemyPowerFlipHitLvAny（官方 139998 队长技同款）
# 持续触发 kind
DT_HP_HIGH, DT_FEVER, DT_POISON, DT_UNIQUE, DT_HP_LOW_EX = "0", "4", "18", "134", "227"
# 前置 kind
PRE_MEMBER, PRE_HP_HIGH, PRE_UNIQUE_GE, PRE_HAS_UNIQUE, PRE_UNIQUE_LE, PRE_SAME_ELEMENT = "2", "8", "144", "187", "199", "208"
PRE_MY_SELF = "3"

ELEMENT_GROUP = {"fire": "Red", "water": "Blue", "thunder": "Yellow", "wind": "Green", "light": "White", "dark": "Black"}
ELEMENT_CODE = {"fire": 0, "water": 1, "thunder": 2, "wind": 3, "light": 4, "dark": 5}   # equipment_element.json（0 基）


class CursedWeaponError(RuntimeError):
    pass


def _require(ok: bool, message: str) -> None:
    if not ok:
        raise CursedWeaponError(message)


def pct(x: float) -> str:
    """百分比 → 词条强度（1000 = 1%）。"""
    return str(int(round(x * 1000)))


def times(n: float) -> str:
    """次数 / 层数 → ×100000。"""
    return str(int(round(n * 100000)))


def frames(n: int) -> str:
    """帧 → ×100000（frame 字段与 ElapsedTime 阈值同单位）。"""
    return str(int(n) * 100000)


# ---------------------------------------------------------------------------
# 词条行构建（ability_soul 123 列 / equipment_enhancement_ability 126 列）
# ---------------------------------------------------------------------------

SOUL_T = "ability_soul"
EA_T = "equipment_enhancement_ability"
_LAYOUT = {t: D.layout(t) for t in (SOUL_T, EA_T)}
_OFF = {block: {name: int(off) for off, name, _label in fields}
        for block, fields in D.enum_map()["block_fields"].items()}
_CASES = D.enum_map()["cases"]


def _col(table: str, block: str, name: str) -> int:
    fields = _OFF["precondition" if block.startswith("precondition") else block]
    return int(_LAYOUT[table]["blocks"][block]) + fields[name]


@dataclass(frozen=True)
class Eff:
    """一行装备词条（本体或强化）。数值字段直接给存储值（字符串）。"""
    mode: str                                   # "0" 瞬发 / "1" 持续
    content: tuple                              # (kind, {字段: 值})
    trig: tuple = (IT_INITIAL, {})              # 瞬发触发或持续触发 (kind, {字段: 值})
    pre: tuple = ()                             # ((kind, {字段: 值}), ...) 最多 3 个
    pc: tuple | None = None                     # 瞬发前置 (kind, {字段: 值})
    delay: int = 0                              # instant_delay（秒；客户端 ×60 帧。三重咒钥说明即「1秒后」）
    even_if_dead: bool = False
    learn: int = 1
    maxlvl: int = 1                             # 仅强化表
    note: str = ""                              # 人话说明（写进设计文档，不进数据）


def _fill_block(row: list[str], table: str, block: str, values: dict[str, str]) -> None:
    for name, value in values.items():
        row[_col(table, block, name)] = value


def _content_defaults(kind: str, block: str, given: dict[str, str]) -> dict[str, str]:
    """按 kind 声明的字段补官方哨兵（声明即必填）。"""
    case = _CASES["instant_content" if block == "instant_content" else "during_content"].get(kind)
    _require(case is not None, f"{block} kind {kind} 不在枚举域")
    fields = case["fields"]
    out: dict[str, str] = {"kind": kind}
    if "target" in fields:
        out["target"] = given.pop("target", T_SELF)
        out["target.character_groups"] = given.pop("target.character_groups", "(None)")
    pairs = {"strength": None, "frame": None, "number": times(1)}
    for name, default in pairs.items():
        if name in fields:
            value = given.pop(name, default)
            _require(value is not None, f"{block} kind {kind} 缺 {name}")
            lo, hi = value if isinstance(value, tuple) else (value, value)
            out[f"{name}.power1"], out[f"{name}.first_max"] = lo, hi
    sentinels = {
        "max_accumulation": "(None)", "flip_limit": "(None)", "power_flip_limit": "(None)",
        "end_power_flip_limit": "(None)", "end_power_flip_accepted_levels": "(None)",
        "cancelable": "0", "by_each_trigger_puller": "false", "initial_multiply": "1", "multiply_trigger": "0",
    }
    for name, default in sentinels.items():
        if name in fields:
            out[name] = given.pop(name, default)
    for name in ("unique_condition_id", "string_id", "action_path", "element"):
        if name in fields:
            _require(name in given, f"{block} kind {kind} 缺 {name}")
            out[name] = given.pop(name)
    _require(not given, f"{block} kind {kind} 多余字段 {sorted(given)}")
    return out


def _trigger_values(kind: str, block: str, given: dict[str, str]) -> dict[str, str]:
    case = _CASES["instant_trigger" if block == "instant_trigger" else "during_trigger"].get(kind)
    _require(case is not None, f"{block} kind {kind} 不在枚举域")
    fields = case["fields"]
    out = {"kind": kind}
    if "trigger_puller" in fields:
        puller = given.pop("trigger_puller", P_SELF)
        out["trigger_puller"] = puller
        # 4/5/6/7/9（含 OneOfMultiball）都带角色组参数；空串会被读成空组，说明里显示「null角色」（1.4.1057 叛乱军旗）
        if puller in ("4", "5", "6", "7", "9"):
            out["trigger_puller.character_groups"] = given.pop("trigger_puller.character_groups", "(None)")
    if "threshold" in fields:
        lo = given.pop("threshold", times(1))
        out["threshold.power1"], out["threshold.first_max"] = lo if isinstance(lo, tuple) else (lo, lo)
    if "trigger_limit" in fields:
        out["trigger_limit"] = given.pop("trigger_limit", "(None)")
    if "cooltime" in fields:
        out["cooltime"] = given.pop("cooltime", "0")
    if "unique_condition_id" in fields:
        _require("unique_condition_id" in given, f"{block} kind {kind} 缺 unique_condition_id")
        out["unique_condition_id"] = given.pop("unique_condition_id")
    _require(not given, f"{block} kind {kind} 多余字段 {sorted(given)}")
    return out


def _pre_values(kind: str, given: dict[str, str]) -> dict[str, str]:
    case = _CASES["precondition"].get(kind)
    _require(case is not None, f"precondition kind {kind} 不在枚举域")
    fields = case["fields"]
    out = {"kind": kind}
    if "trigger_puller" in fields:
        out["trigger_puller"] = given.pop("trigger_puller", P_SELF)
    if "threshold" in fields:
        lo = given.pop("threshold")
        out["threshold.power1"], out["threshold.first_max"] = lo if isinstance(lo, tuple) else (lo, lo)
    if "character_groups" in fields:
        out["character_groups"] = given.pop("character_groups")
    if "unique_condition_id" in fields:
        out["unique_condition_id"] = given.pop("unique_condition_id")
    _require(not given, f"precondition kind {kind} 多余字段 {sorted(given)}")
    return out


def build_row(table: str, slot: int, eff: Eff) -> list[str]:
    lay = _LAYOUT[table]
    row = [""] * int(lay["ncols"])
    if table == SOUL_T:
        row[0], row[1], row[2] = str(slot), str(eff.learn), eff.mode
    else:
        grow = eff.learn < eff.maxlvl
        power = ("24", "48") if grow else ("48", "48")
        row[0:6] = [str(slot), str(eff.learn), str(eff.maxlvl), power[0], power[1], eff.mode]
    _require(len(eff.pre) <= 3, "前置最多 3 个")
    for index, name in enumerate(("precondition1", "precondition2", "precondition3")):
        if index < len(eff.pre):
            kind, given = eff.pre[index]
            _fill_block(row, table, name, _pre_values(kind, dict(given)))
        else:
            row[_col(table, name, "kind")] = "0"
    if eff.mode == "0":
        kind, given = eff.trig
        _fill_block(row, table, "instant_trigger", _trigger_values(kind, "instant_trigger", dict(given)))
        if eff.pc is None:
            row[_col(table, "instant_precontent", "kind")] = "(None)"
        else:
            kind, given = eff.pc
            _fill_block(row, table, "instant_precontent", {"kind": kind, **given})
        row[_col(table, "instant_delay", "instant_delay")] = str(eff.delay)
        kind, given = eff.content
        _fill_block(row, table, "instant_content", _content_defaults(kind, "instant_content", dict(given)))
    else:
        row[_col(table, "during_accumulation_trigger", "kind")] = "(None)"
        kind, given = eff.trig
        _fill_block(row, table, "during_trigger", _trigger_values(kind, "during_trigger", dict(given)))
        row[_col(table, "even_if_owner_dead", "even_if_owner_dead")] = "true" if eff.even_if_dead else "false"
        kind, given = eff.content
        _fill_block(row, table, "during_content", _content_defaults(kind, "during_content", dict(given)))
    return row


# ---------------------------------------------------------------------------
# 词条速写（常用 kind）
# ---------------------------------------------------------------------------

def res(element: str) -> tuple:
    """属性共鸣（编成 6 人 = 全队含协力）。"""
    return (PRE_MEMBER, {"threshold": times(6), "character_groups": ELEMENT_GROUP[element]})


SAME_ELEMENT = (PRE_SAME_ELEMENT, {"threshold": times(6)})


def my_element(*elements: str) -> tuple:
    """自身为某属性（官方先例：魂珠 5040010「风·MySelf」）；多属性逗号并列 = 任一。"""
    return (PRE_MY_SELF, {"character_groups": ",".join(ELEMENT_GROUP[e] for e in elements)})


#: 队伍中除自身外还有其他角色（主位或合击位）：编成人数 ≥ 2（六属性并列 = 不限属性）。
HAS_TEAMMATE = (PRE_MEMBER, {"threshold": times(2), "character_groups": ",".join(ELEMENT_GROUP.values())})


def has_unique(uid: str) -> tuple:
    return (PRE_HAS_UNIQUE, {"trigger_puller": P_SELF, "unique_condition_id": uid})


def lacks_unique(uid: str) -> tuple:
    return (PRE_UNIQUE_LE, {"trigger_puller": P_SELF, "threshold": "0", "unique_condition_id": uid})


def stat(kind: str, target: str, lo: float, hi: float | None = None, **kw) -> tuple:
    """数值直改（瞬发 32/33/34/35/55/…，开幕永久）。"""
    hi = lo if hi is None else hi
    given = {"strength": (pct(lo), pct(hi))}
    if target is not None:
        given["target"] = target
    given.update(kw)
    return (kind, given)


def condition(kind: str, target: str | None, strength: float | None, frame_count: int | str,
              *, cancelable: bool = True, number: float = 1, **kw) -> tuple:
    given: dict[str, Any] = {}
    if target is not None:
        given["target"] = target
    if strength is not None:
        given["strength"] = pct(strength)
    given["frame"] = frame_count if isinstance(frame_count, str) else frames(frame_count)
    if "number" in _CASES["instant_content"][kind]["fields"]:
        given["number"] = times(number)
    given["cancelable"] = "0" if cancelable else "1"
    given.update(kw)
    return (kind, given)


def unique(uid: str, stacks: int = 1, target: str = T_SELF) -> tuple:
    return ("461", {"target": target, "strength": times(stacks), "number": times(1), "unique_condition_id": uid})


def invoke(string_id: str, program: str) -> tuple:
    return ("629", {"string_id": string_id, "action_path": program})


def during(kind: str, target: str | None, lo: float, hi: float | None = None) -> tuple:
    hi = lo if hi is None else hi
    given = {"strength": (pct(lo), pct(hi))}
    if target is not None:
        given["target"] = target
    return (kind, given)


def trig(kind: str, **given) -> tuple:
    return (kind, given)


def elapsed(frame_count: int, limit: str = "(None)") -> tuple:
    return (IT_ELAPSED, {"threshold": frames(frame_count), "trigger_limit": limit})


def gate_unique(uid: str, limit: str = "1", at_least: int = 1) -> tuple:
    """持续触发：自身持有固有状态 uid（≥at_least 层）；limit=倍乘上限（1 = 不随层数倍乘）。"""
    return (DT_UNIQUE, {"trigger_puller": P_SELF, "threshold": times(at_least), "trigger_limit": limit,
                        "unique_condition_id": uid})


# ---------------------------------------------------------------------------
# DSL 速写（ActionDsl 树，wf_dsl.encode_amf3 可直接编码）
# ---------------------------------------------------------------------------

def P(v: float) -> list[dict[str, float]]:
    return [{"min": v, "max": v}]


def C(name: str, *args) -> list:
    return ["Command", [name, *args]]


def B(*cmds) -> list:
    return ["Block", list(cmds)]


def dsl_root(*cmds) -> list:
    return ["ActionDsl", 1, ["None"], False, False, False, False, False, False, False, 0, B(*cmds)]


def ac(name: str, frame_count: int, *params) -> list:
    return [name, P(frame_count), *params]


def give(subject: int, acs: list, key: str = "", cancelable: bool = True) -> list:
    """CreateCondition(对象, AC 列表, 命中率 1, 通用演出, 可驱散, 去重, 键串, None, False, 付与种类 3, 层 1, False)。"""
    return C("CreateCondition", subject, acs, P(1), ["GenericConditionHitEffect"], cancelable, False, key, None,
             False, 3, P(1), False)


def party(bind: int, *body) -> list:
    """FindAllSubjects(bind, 82=主小队三人不含多球, …)。"""
    return C("FindAllSubjects", bind, 82, [], [], [], [], [], ["DoNothing"], B(*body))


def slot_member(bind: int, selector: int, *body) -> list:
    """83/84/85 = 直接点名 1/2/3 号位主位。"""
    return C("FindAllSubjects", bind, selector, [], [], [], [], [], ["DoNothing"], B(*body))


def roulette(*branches: tuple[int, list]) -> list:
    return C("ConditionalsProbability", B(*[B(C("ProbabilityWeight", w), B(*body)) for w, body in branches]))


def wait(frame_count: int, *body) -> list:
    return ["Event", ["Wait", frame_count, "*", B(*body)]]


def dsl_program(name: str) -> str:
    return f"{DSL_DIR}${name}"


#: 官方 CreateCondition 第 8 参（linkedHitCheckKind）一律写 null（夏琳/基诺维等在役 DSL 同形）。
NULLABLE_DSL_ENUMS = frozenset({"HitCountCheckTargetKind"})


def dsl_signature_problems(tree: list) -> list[str]:
    """按 wf_dsl_sig（反编译生成的白名单）逐参核对：命令/事件名、参数个数、枚举构造名与嵌套参数、
    CreateCondition 的 AC 构造名与参数个数。编码器对拼错的构造名不报错（静默吞节点），必须在这里拦住。"""
    import wf_dsl_sig as SIG
    probs: list[str] = []
    enums = SIG.ENUMS

    def value(typ: str, v: Any, where: str) -> None:
        if v is None and typ in NULLABLE_DSL_ENUMS:
            return
        if typ in enums:
            if not (isinstance(v, list) and v and isinstance(v[0], str)):
                probs.append(f"{where}: {typ} 需要构造 [名, …]，得到 {v!r:.60}")
                return
            ctor = v[0]
            if ctor not in enums[typ]:
                probs.append(f"{where}: {typ}.{ctor} 不在白名单")
                return
            args = enums[typ][ctor]
            if len(v) - 1 != len(args):
                probs.append(f"{where}: {typ}.{ctor} 参数 {len(v) - 1} != {len(args)}")
                return
            for i, (t, x) in enumerate(zip(args, v[1:])):
                value(t, x, f"{where}.{ctor}[{i}]")
        elif typ == "ActionDslExpression" and v is not None:     # 官方 44 处可空表达式（如召唤球回调）
            expr(v, where)

    def expr(node: Any, where: str) -> None:
        if not (isinstance(node, list) and node and node[0] in ("Block", "Command", "Event")):
            probs.append(f"{where}: 不是 Block/Command/Event：{node!r:.60}")
            return
        if node[0] == "Block":
            for i, child in enumerate(node[1]):
                expr(child, f"{where}/{i}")
            return
        table = SIG.COMMANDS if node[0] == "Command" else SIG.EVENTS
        name, params = node[1][0], node[1][1:]
        if name not in table:
            probs.append(f"{where}: 未知 {node[0]} {name}")
            return
        sig = table[name]
        if sig is None:
            sig = {"Wait": ["int", "String", "ActionDslExpression"]}.get(name)
            if sig is None:
                return
        if len(params) != len(sig):
            probs.append(f"{where}: {name} 参数 {len(params)} != {len(sig)}")
            return
        for i, (t, x) in enumerate(zip(sig, params)):
            if name == "CreateCondition" and i == 1:
                for j, acv in enumerate(x):
                    value("AdditionalConditionKind", acv, f"{where}:{name}.ac{j}")
            else:
                value(t, x, f"{where}:{name}[{i}]")

    _require(isinstance(tree, list) and tree[0] == "ActionDsl" and len(tree) == 12, "DSL 根形状不对")
    expr(tree[11], "root")
    return probs


#: 按属性取素材的命中特效；无属性没有这几套素材（ActionDslAssetResolver.resolveNormalAttackHitEffect 抛 10013）。
ELEMENT_COLORED_HIT_EFFECTS = frozenset({"Fine", "Coarse", "Slash", "CriticalSlash"})


def colorless_hit_effect_problems(tree: list) -> list[str]:
    """装备词条的 DSL 以装备为主体，主体属性恒为无属性（AbilitySoulAbilityLogic ownerElement=6）。
    继承属性(255)/无属性(7) 的 CreateNormalAttack 配上按属性取素材的命中特效，进战斗预载即 C10013
    （1.4.1057 终焉拳套实机）。"""
    probs: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, list):
            return
        if node and node[0] == "Command" and isinstance(node[1], list) and node[1][0] == "CreateNormalAttack":
            params = node[1][1:]
            element, effect = params[1], params[14]
            if element in (255, 7) and isinstance(effect, list) and effect and effect[0] in ELEMENT_COLORED_HIT_EFFECTS:
                probs.append(f"CreateNormalAttack 属性 {element} 配命中特效 {effect[0]}：装备主体无属性，预载抛 C10013")
        for child in node:
            walk(child)

    walk(tree)
    return probs


# ---------------------------------------------------------------------------
# 武器规格
# ---------------------------------------------------------------------------

@dataclass
class Weapon:
    row: int                   # 提案表行号（1..29）
    slug: str
    name: str
    category: str              # 服务端 equipment_lookup 类别
    elements: tuple[str, ...]  # 属性限制（空 = 通用）
    author: str
    look: str
    flavor: str
    summary_120: str           # 强化 120 解放说明（写进强化描述）
    soul: list[Eff] = field(default_factory=list)
    ea: list[Eff] = field(default_factory=list)
    uniques: dict[str, list[str]] = field(default_factory=dict)
    dsl: dict[str, list] = field(default_factory=dict)
    cas: dict[str, str] = field(default_factory=dict)
    deviations: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return str(ID_BASE + self.row)

    def uid(self, k: int) -> str:
        return str(UNIQUE_BASE + self.row * 10 + k)

    @property
    def icon(self) -> str:
        return f"{IMAGE_DIR}/{self.slug}_lv0"

    @property
    def icon120(self) -> str:
        return f"{IMAGE_DIR}/{self.slug}_lv120"

    def element_code(self) -> int:
        return ELEMENT_CODE[self.elements[0]] if len(self.elements) == 1 else -1


def unique_row(sid: str, name: str, icon: str, duration: str, max_acc: str, *, bad: bool,
               cancelable: bool = False, force: bool = True, keep_on_death: bool = True) -> list[str]:
    """unique_condition 15 列：sid,名称,图标,持续帧,最大层,弹射上限,PF上限,结束PF,结束PF档,可驱散,强制,方向,覆写,入棺移除,PF语音。"""
    return [sid, name, f"battle/common/unique_condition/{icon}", duration, max_acc, "(None)", "(None)", "(None)",
            "(None)", "true" if cancelable else "false", "true" if force else "false", "1" if bad else "0", "0",
            "false" if keep_on_death else "true", "(None)"]


ICON_CURSE = "unique_devil_leader"          # 官方「诅咒」图标
ICON_TIME = "unique_gerald_time_seal"       # 时之刻印（计时类）
ICON_BUFF = "unique_fire_dragon_zenith"     # 勇敢之焰（增益类）
ICON_STACK = "unique_wind_spgirl_1anv"      # 神速剑技（叠层类）


KIND_LABEL = {"32": "攻击力", "0": "攻击力", "34": "技能伤害", "2": "技能伤害", "33": "直接攻击伤害", "1": "直接攻击伤害",
              "55": "强化弹射伤害", "23": "强化弹射伤害", "28": "强化弹射伤害", "388": "能力伤害", "35": "技能充能速度",
              "156": "增益持续时间", "227": "护盾", "211": "技能槽", "470": "逆境", "701": "技能充能速度",
              "694": "技能伤害独立乘区", "723": "伤害独立乘区", "717": "合击角色攻击力白值"}
#: 瞬发「状态」类 kind 的名字（与持续类同号不同义：瞬发 1 = ConditionSkillDamage，持续 1 = 直击）。
COND_LABEL = {"0": "攻击力", "1": "技能伤害", "28": "强化弹射伤害", "470": "逆境", "701": "技能充能速度"}
TARGET_LABEL = {T_SELF: "自身", T_PARTY: "全队", T_LEADER: "队长", T_SECOND: "2号位", T_THIRD: "3号位",
                T_MULTIBALL: "协力球", T_TRIGGER: "触发者"}


def weak(x: float) -> float:
    """本体实际生效值（设计值 × BASE_SCALE）。"""
    return round(x * BASE_SCALE, 3)


def _grow(total: float, base: float) -> float:
    """强化 1→119 线性成长的满值：最终值 - 本体满破实际值 - 120 级补足（最终值的 2.5%）。base 为本体设计值。"""
    return round(total - weak(base) - total * 0.025, 3)


def _topup(total: float, base: float) -> float:
    return round(total - weak(base) - _grow(total, base), 3)


_PCT_IN_NOTE = re.compile(r"(?<=[+→])(\d+(?:\.\d+)?)(?=%)")


def _weaken(eff: Eff) -> Eff:
    """本体行按 BASE_SCALE 缩放（只缩 WEAK_KINDS 的强度；说明里「+N%」「→N%」同步改写）。"""
    kind, given = eff.content
    if kind not in WEAK_KINDS or "strength" not in given:
        return eff
    scale = lambda v: str(int(round(int(v) * BASE_SCALE)))
    s_ = given["strength"]
    strength = tuple(scale(v) for v in s_) if isinstance(s_, tuple) else scale(s_)
    note = _PCT_IN_NOTE.sub(lambda m: f"{float(m.group(1)) * BASE_SCALE:g}", eff.note)
    return replace(eff, content=(kind, {**given, "strength": strength}), note=note)


def growth_pair(kind: str, target: str | None, total: float, base: float, *, mode: str = "0",
                trig_: tuple = (IT_INITIAL, {}), pre: tuple = (), even_if_dead: bool = False,
                cond_frames: int | None = None, cancelable: bool = True, **extra) -> list[Eff]:
    """同一数值两行：强化 1→119 成长行（1/119 起步→满值）+ 120 级补足行。"""
    grow = _grow(total, base)
    top = _topup(total, base)
    rows = []
    label = (COND_LABEL if cond_frames is not None else KIND_LABEL).get(kind, kind)
    who = TARGET_LABEL.get(target, "") if target is not None else ""
    notes = (f"{who}{label}再 +{grow / 119:.3g}%→{grow:g}%（强化成长；本体实际 +{weak(base):g}%）",
             f"{who}{label}再 +{top:g}%（120 级补足，合计 +{total:g}%）")
    for (lo, hi, learn, maxlvl), note in zip(((grow / 119, grow, 1, 119), (top, top, 120, 120)), notes):
        if mode == "1":
            content = during(kind, target, lo, hi)
        elif cond_frames is not None:
            content = (kind, {**({"target": target} if target is not None else {}),
                              "strength": (pct(lo), pct(hi)), "frame": frames(cond_frames),
                              "number": times(1), "cancelable": "0" if cancelable else "1", **extra})
        else:
            content = stat(kind, target, lo, hi, **extra)
        rows.append(Eff(mode, content, trig=trig_, pre=pre, learn=learn, maxlvl=maxlvl, even_if_dead=even_if_dead,
                        note=note))
    return rows


def w01() -> Weapon:
    w = Weapon(1, "gluttony_knife", "饕餮餐刀", "剑", (), "神秘小罐头",
               "锯齿切肉刀，刃口带咬痕", "据说用它切过的面包，会连同主人的饥饿一起被吞下。",
               "发动技能时吞噬己方全部召唤协力球，每吞 1 个自身攻击力与技能伤害各 +50%（最多 9 个）")
    ids = list(GINOVI.DEVOUR_IDS)
    w.soul = [
        Eff("0", stat("32", T_SELF, 20, 40), note="自身攻击力 +20%→40%"),
        Eff("0", stat("32", T_SELF, 5, 10), trig=trig(IT_MB_REMOVE, threshold=times(1), trigger_limit="6"),
            note="己方协力球消失时，自身攻击力 +5%→10%（最多 6 次）"),
    ]
    program = dsl_program("gluttony_devour")
    w.dsl[program] = dsl_root(
        C("ConditionalsMultiballNumber", ids, [], 1, B(
            C("MultiballNumberVariable", 1, False, ids, [], 1, 9),
            C("RemoveMultiball", False, ids),
            give(-17, [["ACAttackPoint", P(900), [{"min": 0.5, "max": 0.5, "mul": 1}], P(1)]], "cursed_gluttony_atk"),
            give(-17, [["ACSkillDamage", P(900), [{"min": 0.5, "max": 0.5, "mul": 1}], P(1)]], "cursed_gluttony_skd"),
        ), B()))
    w.cas["cursed_gluttony_devour"] = "吞噬场上所有被召唤的协力球，每吞噬1个，自身攻击力与技能伤害各提升50%（15秒，最多9个）"
    w.ea = [
        *growth_pair("32", T_SELF, 100, 40),
        Eff("0", invoke("cursed_gluttony_devour", program), trig=trig(IT_SKILL, trigger_puller=P_SELF),
            **CURSE, note="【诅咒】发动技能时吞噬己方全部召唤协力球，每个 +50% 攻击/技伤（最多 9 个，15 秒）"),
    ]
    return w


def w02() -> Weapon:
    w = Weapon(2, "feast_drum", "狂宴战鼓", "饰品", (), "神秘小罐头",
               "红边战鼓与交叉鼓槌", "鼓声越狂，技能之力越被献给狂欢。",
               "进入 Fever 时全队技能槽 -50%；Fever 中全队攻击、技能伤害、强化弹射伤害 +200%")
    program = dsl_program("feast_drain")
    w.dsl[program] = dsl_root(party(0, C("SubtractSkillPoint", 0, P(0.5))))
    w.cas["cursed_feast_drain"] = "全队技能槽减少50%"
    fever = (DT_FEVER, {})
    w.soul = [
        Eff("1", during("0", T_PARTY, 20, 40), trig=fever, note="Fever 中全队攻击力 +20%→40%"),
        Eff("1", during("2", T_PARTY, 20, 40), trig=fever, note="Fever 中全队技能伤害 +20%→40%"),
    ]
    w.ea = [
        *growth_pair("0", T_PARTY, 200, 40, mode="1", trig_=fever),
        *growth_pair("2", T_PARTY, 200, 40, mode="1", trig_=fever),
        *growth_pair("23", None, 200, 0, mode="1", trig_=fever),
        Eff("0", invoke("cursed_feast_drain", program), trig=trig(IT_FEVER, threshold=times(1)),
            **CURSE, note="【诅咒】进入 Fever 时全队技能槽 -50%"),
    ]
    return w


def w03() -> Weapon:
    w = Weapon(3, "salted_fish_crown", "咸鱼王冠", "饰品", ("wind",), "百合色彩虹桥",
               "戴着小王冠的咸鱼", "躺平的咸鱼也有王冠——只是要攒满两倍才肯翻身。",
               "风属性共鸣时：自身技能充能速度 -50%（攒满需要约两倍时间），技能伤害独立乘区 +100%（伤害翻倍）")
    wind = (res("wind"),)
    w.soul = [
        Eff("0", stat("245", T_SELF, 100, 100), pre=wind, note="风属性共鸣时：自身技能槽上限 +100%（可蓄至 200%）"),
        Eff("0", stat("34", T_SELF, 30, 60), pre=wind, note="风属性共鸣时：自身技能伤害 +30%→60%"),
    ]
    w.ea = [
        *growth_pair("34", T_SELF, 160, 60, pre=wind),
        Eff("0", stat("35", T_SELF, -50), pre=wind, **CURSE,
            note="【诅咒】风属性共鸣时：自身技能充能速度 -50%"),
        Eff("0", stat("694", T_SELF, 100), pre=wind, **FINAL,
            note="风属性共鸣时：自身技能伤害独立乘区 +100%"),
    ]
    w.deviations.append("「技能条锁定 200% 才能用」客户端硬编码（槽满 100% 即可施放）；改为「充能速度 -50%」表达两倍攒槽，"
                        "配合本体技能槽上限 200% 与技能伤害独立乘区 ×2")
    return w


def w04() -> Weapon:
    w = Weapon(4, "rebel_banner", "叛乱军旗", "枪", (), "百合色彩虹桥",
               "破损的深红战旗", "面包们举起了叛旗——冲锋时不分敌我。",
               "协力球撞击敌人时，全队受到最大 HP 3% 的伤害（不致死，间隔 1 秒）；协力球攻击力 +200%")
    w.soul = [
        Eff("0", stat("32", T_MULTIBALL, 30, 60), note="协力球攻击力 +30%→60%"),
        Eff("0", stat("205", T_MULTIBALL, 20, 40), note="协力球最大 HP +20%→40%"),
    ]
    w.ea = [
        *growth_pair("32", T_MULTIBALL, 260, 60),
        Eff("0", stat("209", T_PARTY, 3), trig=trig(IT_DIRECT, trigger_puller=P_ONE_OF_MULTIBALL, cooltime="60"),
            **CURSE, note="【诅咒】协力球直接攻击时，全队受到最大 HP 3% 的伤害（CT1 秒，不致死）"),
    ]
    w.deviations.append("「面包攻击改为可伤害队友」是碰撞层行为；改为协力球每次撞击时对全队造成最大 HP 3% 的友伤（玩家侧伤害钳到 1HP）")
    return w


def w05() -> Weapon:
    w = Weapon(5, "stopped_watch", "停摆怀表", "饰品", (), "百合色彩虹桥",
               "指针冻结的裂纹怀表", "时间在表盘里停住了——祝福与诅咒都不会再结束。",
               "全队增益/减益持续时间 +1000%；每 10 秒随机赋予全队 1 种减益（10 秒，不含无法行动类）")
    program = dsl_program("watch_curse")
    minus = -0.2
    w.dsl[program] = dsl_root(party(0, roulette(
        (20, [give(0, [ac("ACAttackPoint", 600, P(minus), P(1))])]),
        (20, [give(0, [ac("ACSkillDamage", 600, P(minus), P(1))])]),
        (20, [give(0, [ac("ACPowerFlipDamage", 600, P(minus), P(1))])]),
        (20, [give(0, [ac("ACHealRejection", 600)])]),
        (20, [give(0, [ac("ACSkillGaugeCharging", 600, P(minus), P(1))])]),
    )))
    w.cas["cursed_watch_curse"] = "随机赋予全队1种减益（攻击力/技能伤害/强化弹射伤害/技能充能速度降低20%，或回复无效，10秒）"
    w.soul = [Eff("0", stat("156", T_PARTY, 25, 50), note="全队增益效果持续时间 +25%→50%")]
    w.ea = [
        *growth_pair("156", T_PARTY, 1000, 50),
        Eff("0", stat("155", T_PARTY, 1000), **CURSE, note="【诅咒】全队减益效果持续时间 +1000%"),
        Eff("0", invoke("cursed_watch_curse", program), trig=elapsed(600), **CURSE,
            note="【诅咒】每 10 秒随机赋予全队 1 种减益（10 秒）"),
    ]
    w.deviations.append("「无视时间无限延长」改为持续时间 +1000%（次数型/消耗型效果照常结束，也不附带防驱散）")
    return w


def w06() -> Weapon:
    w = Weapon(6, "burnout_candle", "燃尽之烛", "杖", (), "水鱼",
               "顶端点着蜡烛的法杖", "最亮的火焰，只照亮最初的几次咏唱。",
               "自身攻击力与技能伤害 +500%，每发动 1 次技能两者各 -100%（最多 5 次）；自身技能充能速度 -15%")
    w.soul = [
        Eff("0", stat("32", T_SELF, 100, 200), note="自身攻击力 +100%→200%"),
        Eff("0", stat("34", T_SELF, 100, 200), note="自身技能伤害 +100%→200%"),
    ]
    skill = trig(IT_SKILL, trigger_puller=P_SELF, trigger_limit="5")
    w.ea = [
        *growth_pair("32", T_SELF, 500, 200),
        *growth_pair("34", T_SELF, 500, 200),
        Eff("0", stat("32", T_SELF, -100), trig=skill, **CURSE,
            note="【诅咒】发动技能时自身攻击力 -100%（最多 5 次）"),
        Eff("0", stat("34", T_SELF, -100), trig=skill, **CURSE,
            note="【诅咒】发动技能时自身技能伤害 -100%（最多 5 次）"),
        Eff("0", stat("35", T_SELF, -15), **CURSE, note="【诅咒】自身技能充能速度 -15%"),
    ]
    w.deviations.append("「技能槽最大值 -15%」：引擎的槽容量不能低于 100%，改为技能充能速度 -15%")
    return w


def _full_screen_attack(multiplier: float) -> list:
    """对全体敌人造成自身攻击力 multiplier 倍的技能伤害。

    装备 DSL 的主体属性恒为无属性，命中特效只能用不按属性取素材的构造（见 colorless_hit_effect_problems）；
    这里用官方通用的 Explosion。伤害按无属性结算：不吃克制，也不会走到 10014（forceUncolorless 只在炸弹球里）。
    """
    # 26 参照 work/codex_out/hitarea_params.md：全屏 = 3600×3600 矩形（官方 8 例）；p15 每目标硬帽 1；
    # p16 eliminatedOnHit 必须 False（True 会命中第一个敌人就移除，打不到其余目标）。
    return dsl_root(C("CreateHitArea", "*", -18, ["AB"], 0, 0, 0, False, False,
                      ["Rectangle", P(3600), P(3600)], ["Center"], ["Center"],
                      ["Single"], ["SpecifyHitAreaLifetimeDirectly", 2], ["CalculatedUsingMaxNumOfHits", 1],
                      ["Some", P(1)], False, True, ["None"], 0, B(), 1, 2,
                      B(C("CreateNormalAttack", 2, 255, [], [], 0, P(multiplier), P(0), False, False, False, False,
                          False, P(0.25), P(0.25), ["Explosion"], True)),
                      0, 0, ["None"]))


def w07() -> Weapon:
    w = Weapon(7, "finality_gauntlet", "终焉拳套", "拳", ("fire", "water"), "P.P.P.P",
               "镶着彩色宝石的黄金拳套", "一拳之后，世界与你一同静止。",
               "火/水属性共鸣时：全队攻击、技能伤害、能力伤害 +600%；发动技能时全场 6 倍 + 10 倍技能伤害（各 CT0.5 秒）；"
               "8 秒后全队永续麻痹、封印，攻击力/技能伤害/能力伤害 -886%（不可驱散）")
    uid_end = w.uid(1)
    w.uniques[uid_end] = unique_row(f"cursed_finality_{uid_end}", "终焉", ICON_CURSE, "99999999", "1", bad=True)
    fist_a, fist_b, fist_c = (dsl_program(f"finality_fist_{k}") for k in "abc")
    w.dsl[fist_a], w.dsl[fist_b], w.dsl[fist_c] = (_full_screen_attack(x) for x in (1.0, 5.0, 10.0))
    w.cas["cursed_finality_fist_a"] = "对全体敌人造成1倍技能伤害"
    w.cas["cursed_finality_fist_b"] = "对全体敌人造成5倍技能伤害"
    w.cas["cursed_finality_fist_c"] = "对全体敌人造成10倍技能伤害"
    skill_ct = trig(IT_SKILL, trigger_puller=P_SELF, cooltime="30")
    eight_s = elapsed(480, "1")
    curse = dict(cancelable=False)
    revive = trig(IT_REVIVAL, trigger_puller=P_ONE_OF_PARTY)
    after = has_unique(uid_end)
    rows_s, rows_e = [], []
    for element in ("fire", "water"):
        gate = (res(element),)
        cn = "火" if element == "fire" else "水"
        rows_s += [
            Eff("0", stat("32", T_PARTY, 150, 300), pre=gate, note=f"{cn}属性共鸣时：全队攻击力 +150%→300%"),
            Eff("0", stat("34", T_PARTY, 150, 300), pre=gate, note=f"{cn}属性共鸣时：全队技能伤害 +150%→300%"),
            Eff("0", stat("388", T_PARTY, 150, 300), pre=gate, note=f"{cn}属性共鸣时：全队能力伤害 +150%→300%"),
            Eff("0", invoke("cursed_finality_fist_a", fist_a), trig=skill_ct, pre=gate,
                note=f"{cn}属性共鸣时：发动技能时对全体敌人造成 1 倍技能伤害（CT0.5 秒）"),
        ]
        rows_e += [
            *growth_pair("32", T_PARTY, 600, 300, pre=gate),
            *growth_pair("34", T_PARTY, 600, 300, pre=gate),
            *growth_pair("388", T_PARTY, 600, 300, pre=gate),
            Eff("0", invoke("cursed_finality_fist_b", fist_b), trig=skill_ct, pre=gate, **FINAL,
                note="发动技能时再对全体敌人造成 5 倍技能伤害（与本体合计 6 倍，CT0.5 秒）"),
            Eff("0", invoke("cursed_finality_fist_c", fist_c), trig=skill_ct, pre=gate, **FINAL,
                note="发动技能时再对全体敌人造成 10 倍技能伤害（CT0.5 秒）"),
            Eff("0", unique(uid_end), trig=eight_s, pre=gate, **CURSE, note="8 秒后刻下「终焉」"),
        ]
        for kind, strength, text in (("19", None, "麻痹"), ("219", None, "封印"), ("0", -886, "攻击力 -886%"),
                                     ("1", -886, "技能伤害 -886%"), ("486", -886, "能力伤害 -886%")):
            rows_e += [
                Eff("0", condition(kind, T_PARTY, strength, INF_FRAMES, **curse), trig=eight_s, pre=gate, **CURSE,
                    note=f"【诅咒】8 秒后全队永续{text}（不可驱散）"),
                Eff("0", condition(kind, T_PARTY, strength, INF_FRAMES, **curse), trig=revive, pre=(*gate, after),
                    **CURSE, note=f"「终焉」后复活时重新附加{text}"),
            ]
    w.soul, w.ea = rows_s, rows_e
    w.deviations.append("「攻刃 -886%」引擎攻击加成总和下限 -50%（STAT_MODIFIER_ATTACK_POINT_MIN），技能/能力伤害 -886% 会压到单次 1 伤害；"
                        "「无法接触的麻痹」按不可驱散的麻痹实现")
    return w


def w08() -> Weapon:
    w = Weapon(8, "sisyphus_stone", "西西弗斯的石头", "盾", (), "百合色彩虹桥",
               "被锁链缠住的巨石", "推到山顶的那一刻，石头总会滚落。",
               "HP≥50% 时自身攻击与技能伤害 +150%；HP<50% 时两者 -50%；HP 回满时 HP 降至 0.1% 并获得最大 HP 30% 的护盾")
    hp50 = (DT_HP_HIGH, {"trigger_puller": P_SELF, "threshold": pct(50)})
    low50 = (DT_HP_LOW_EX, {"trigger_puller": P_SELF, "threshold": pct(50)})
    w.soul = [
        Eff("1", during("0", T_SELF, 30, 60), trig=hp50, note="HP≥50% 时自身攻击力 +30%→60%"),
        Eff("1", during("2", T_SELF, 30, 60), trig=hp50, note="HP≥50% 时自身技能伤害 +30%→60%"),
    ]
    full = (elapsed(30), ((PRE_HP_HIGH, {"trigger_puller": P_SELF, "threshold": pct(100)}),))
    w.ea = [
        *growth_pair("0", T_SELF, 150, 60, mode="1", trig_=hp50),
        *growth_pair("2", T_SELF, 150, 60, mode="1", trig_=hp50),
        Eff("1", during("0", T_SELF, -50), trig=low50, **CURSE, note="【诅咒】HP<50% 时自身攻击力 -50%"),
        Eff("1", during("2", T_SELF, -50), trig=low50, **CURSE, note="【诅咒】HP<50% 时自身技能伤害 -50%"),
        Eff("0", stat("209", T_SELF, 99.9), trig=full[0], pre=full[1], **CURSE,
            note="【诅咒】HP 为 100% 时（每 0.5 秒检查）失去最大 HP 的 99.9%"),
        Eff("0", stat("227", T_SELF, 30), trig=full[0], pre=full[1], delay=1, **CURSE,
            note="随后获得最大 HP 30% 的护盾"),
    ]
    return w


def w09() -> Weapon:
    w = Weapon(9, "dormant_dragon_heart", "蛰龙之心", "饰品", ("fire", "thunder"), "脆脆鲨",
               "余烬与电光交织的龙心结晶", "沉睡的龙心只在两个时刻苏醒。",
               "火/雷属性共鸣时：0–49 秒全队伤害 -99%；50–59 秒攻击 +500%、伤害独立 +300%；61–109 秒再度 -99%；"
               "110–119 秒攻击 +1000%、伤害独立 +500%；121 秒起永久伤害 -90%（均不可驱散）")
    u_dorm, u_wake1, u_wake2, u_dry = w.uid(1), w.uid(2), w.uid(3), w.uid(4)
    w.uniques[u_dorm] = unique_row(f"cursed_dragon_{u_dorm}", "蛰伏", ICON_TIME, "2940", "1", bad=True)
    w.uniques[u_wake1] = unique_row(f"cursed_dragon_{u_wake1}", "苏醒", ICON_BUFF, "600", "1", bad=False)
    w.uniques[u_wake2] = unique_row(f"cursed_dragon_{u_wake2}", "龙怒", ICON_BUFF, "600", "1", bad=False)
    w.uniques[u_dry] = unique_row(f"cursed_dragon_{u_dry}", "枯竭", ICON_CURSE, "99999999", "1", bad=True)
    tick = elapsed(600, "12")
    for element in ("fire", "thunder"):
        gate = (res(element),)
        w.soul.append(Eff("0", stat("32", T_PARTY, 4, 8), trig=tick, pre=gate,
                          note=f"{'火' if element == 'fire' else '雷'}属性共鸣时：每 10 秒全队攻击力 +4%→8%（最多 12 次）"))
        w.ea += [
            *growth_pair("32", T_PARTY, 20, 8, trig_=tick, pre=gate),
            Eff("0", unique(u_dorm), pre=gate, **CURSE, note="开局「蛰伏」49 秒"),
            Eff("0", unique(u_wake1), trig=elapsed(3000, "1"), pre=gate, **CURSE, note="第 50 秒「苏醒」10 秒"),
            Eff("0", unique(u_dorm), trig=elapsed(3660, "1"), pre=gate, **CURSE, note="第 61 秒再度「蛰伏」49 秒"),
            Eff("0", unique(u_wake2), trig=elapsed(6600, "1"), pre=gate, **CURSE, note="第 110 秒「龙怒」10 秒"),
            Eff("0", unique(u_dry), trig=elapsed(7260, "1"), pre=gate, **CURSE, note="第 121 秒「枯竭」（永久）"),
            Eff("1", during("421", T_PARTY, -99), trig=gate_unique(u_dorm), pre=gate, even_if_dead=True,
                **CURSE, note="【诅咒】「蛰伏」期间全队伤害独立乘区 -99%"),
            Eff("1", during("0", T_PARTY, 50, 500), trig=gate_unique(u_wake1), pre=gate, even_if_dead=True,
                **CURSE, note="「苏醒」期间全队攻击力 +500%"),
            Eff("1", during("421", T_PARTY, 30, 300), trig=gate_unique(u_wake1), pre=gate, even_if_dead=True,
                **CURSE, note="「苏醒」期间全队伤害独立乘区 +300%"),
            Eff("1", during("0", T_PARTY, 100, 1000), trig=gate_unique(u_wake2), pre=gate, even_if_dead=True,
                **CURSE, note="「龙怒」期间全队攻击力 +1000%"),
            Eff("1", during("421", T_PARTY, 50, 500), trig=gate_unique(u_wake2), pre=gate, even_if_dead=True,
                **CURSE, note="「龙怒」期间全队伤害独立乘区 +500%"),
            Eff("1", during("421", T_PARTY, -90), trig=gate_unique(u_dry), pre=gate, even_if_dead=True,
                **CURSE, note="【诅咒】「枯竭」后全队伤害独立乘区 -90%"),
        ]
    w.deviations.append("时间点按战斗计时（ElapsedTime）；「输出 -99% / -90%」用伤害独立乘区实现（固定伤害等少数来源不经过该乘区）")
    return w


def w10() -> Weapon:
    w = Weapon(10, "fate_dice", "命运骰子", "饰品", (), "P.P.P.P",
               "一黑一白的两枚骰子", "骰子不在乎你的队伍——它只在乎点数。",
               "每 25 秒掷骰（直击/强化弹射/技能 × 增益/诅咒 六种结果，持续 10 秒）")
    u_mark = w.uid(1)
    w.uniques[u_mark] = unique_row(f"cursed_dice_{u_mark}", "命运之骰", ICON_STACK, "99999999", "1", bad=False)
    lite, full = dsl_program("fate_roll_lite"), dsl_program("fate_roll")
    w.dsl[lite] = dsl_root(party(0, roulette(
        (1, [give(0, [ac("ACDirectDamage", 600, P(0.12), P(1))])]),
        (1, [give(0, [ac("ACPowerFlipDamage", 600, P(0.16), P(1))])]),
        (1, [give(0, [ac("ACSkillDamage", 600, P(0.12), P(1))])]),
    )))
    w.cas["cursed_fate_roll_lite"] = "随机赋予全队1种增益（直接攻击伤害+12%/强化弹射伤害+16%/技能伤害+12%，10秒）"
    w.dsl[full] = dsl_root(roulette(
        (1, [party(0, give(0, [ac("ACFlying", 600)]), give(0, [ac("ACDirectDamage", 600, P(1.9), P(1))]),
                   give(0, [ac("ACSpeedup", 600, P(0.35), P(1))]))]),
        (1, [C("AddCombo", P(40)), party(0, give(0, [ac("ACPiercing", 600)]),
                                         give(0, [ac("ACPowerFlipDamage", 600, P(2.5), P(1))]))]),
        (1, [party(0, C("AddSkillPoint", 0, P(1.0)), give(0, [ac("ACSkillDamage", 600, P(2.0), P(1))]),
                   give(0, [ac("ACSkillGaugeCharging", 600, P(0.05), P(1))]))]),
        (1, [party(0, give(0, [ac("ACComboRestriction", 600, P(15))], cancelable=False),
                   give(0, [ac("ACPowerFlipDamage", 600, P(-1.5), P(1))], cancelable=False))]),
        (1, [roulette(
            (1, [slot_member(0, 83, give(0, [ac("ACParalysis", 300, True)], cancelable=False)),
                 slot_member(1, 84, give(1, [ac("ACParalysis", 300, True)], cancelable=False))]),
            (1, [slot_member(0, 83, give(0, [ac("ACParalysis", 300, True)], cancelable=False)),
                 slot_member(1, 85, give(1, [ac("ACParalysis", 300, True)], cancelable=False))]),
            (1, [slot_member(0, 84, give(0, [ac("ACParalysis", 300, True)], cancelable=False)),
                 slot_member(1, 85, give(1, [ac("ACParalysis", 300, True)], cancelable=False))]),
        ), C("SuppressBallActivity", -18, P(300))]),
        (1, [party(0, C("SubtractSkillPoint", 0, P(0.4)),
                   give(0, [ac("ACAttackPoint", 300, P(-0.5), P(1))], cancelable=False))]),
    ))
    w.cas["cursed_fate_roll"] = ("掷骰：直击（浮游、直接攻击伤害+190%、球速+35%）／强化弹射（连击+40、贯通、强化弹射伤害+250%）／"
                                 "技能（技能槽+100%、技能伤害+200%、充能速度+5%）三种增益，或对应诅咒：连击上限15且强化弹射伤害-150%／"
                                 "随机两名主位麻痹且弹球不受控制5秒／全队技能槽-40%且攻击力-50%（5秒）")
    every25 = elapsed(1500)
    w.soul = [Eff("0", invoke("cursed_fate_roll_lite", lite), trig=every25, pre=(lacks_unique(u_mark),),
                  note="每 25 秒随机赋予全队 1 种增益（10 秒）")]
    w.ea = [
        *growth_pair("32", T_PARTY, 60, 0),
        Eff("0", unique(u_mark), **CURSE, note="「命运之骰」：本体的温和掷骰换成完整命运骰"),
        Eff("0", invoke("cursed_fate_roll", full), trig=every25, **CURSE,
            note="【诅咒】每 25 秒掷骰：三种增益或三种诅咒（10 秒，诅咒不可驱散）"),
    ]
    w.deviations.append("「冲刺 CD 缩短 35%」无对应原生效果，改为球速 +35%；「对应属性的强化 PF」形态替换不做，保留伤害/连击/贯通部分；"
                        "PF 诅咒「消耗 5 次的 -150%」改为 10 秒内 -150%")
    return w


def w11() -> Weapon:
    w = Weapon(11, "hokuto_fist", "北斗百裂拳", "拳", (), "百合色彩虹桥",
               "北斗七星纹的拳套", "你的每一击都被拆成了百裂——可惜每一拳都很轻。",
               "直接攻击改为 10 段、每段 5%（合计 -50%）；每累计 100 次直接攻击，全队攻击与技能伤害 +100%（20 秒）")
    hundred = dsl_program("hokuto_hundred")
    w.dsl[hundred] = dsl_root(give(-17, [["ACAdditionalDirectAttack", P(9999999), P(10), P(-0.5), P(1)]],
                                   "cursed_hokuto", cancelable=False))
    w.cas["cursed_hokuto_hundred"] = "自身的直接攻击变为10段（每段伤害为原本的5%）"
    w.soul = [
        Eff("0", stat("33", T_SELF, 30, 60), note="自身直接攻击伤害 +30%→60%"),
        Eff("0", stat("202", T_SELF, 25, 50), note="自身直接攻击计为 3 次（合计伤害 +25%→50%）"),
    ]
    hit100 = trig(IT_DIRECT, trigger_puller=P_SELF, threshold=times(100))
    w.ea = [
        *growth_pair("33", T_SELF, 150, 60),
        Eff("0", invoke("cursed_hokuto_hundred", hundred), **CURSE,
            note="【诅咒】直接攻击变为 10 段、每段原伤害 5%（覆盖本体的 3 段）"),
        Eff("0", condition("0", T_PARTY, 100, 1200), trig=hit100, **FINAL,
            note="每累计 100 次直接攻击，全队攻击力 +100%（20 秒）"),
        Eff("0", condition("1", T_PARTY, 100, 1200), trig=hit100, **FINAL,
            note="每累计 100 次直接攻击，全队技能伤害 +100%（20 秒）"),
    ]
    w.deviations.append("「触发队里一个角色的技能」没有通用原语（每个角色技能 DSL 不同），按提案备选改为全队增伤")
    return w


def w12() -> Weapon:
    w = Weapon(12, "dancer_chakram", "剑舞圆环", "饰品", (), "P.P.P.P",
               "系着飘带的双刃圆环", "舞步未完成之前，观众只看见跌倒。",
               "未完成「剑舞」时：连击上限 9（强化弹射只能 Lv1）、强化弹射伤害降为 1；每 10 次强化弹射完成剑舞，"
               "15 秒内解除限制并获得强化弹射伤害 +200%、连击 +40、贯通")
    u_lock = w.uid(1)
    w.uniques[u_lock] = unique_row(f"cursed_dance_{u_lock}", "剑舞未成", ICON_CURSE, "99999999", "1", bad=True)
    init, release = dsl_program("dance_lock"), dsl_program("dance_release")
    lock = give(-17, [["ACComboRestriction", P(9999999), P(9)]], "cursed_dance_lock", cancelable=False)
    w.dsl[init] = dsl_root(lock, give(-17, [["ACUnique", int(u_lock), P(1)]], "cursed_dance_mark", cancelable=False))
    w.dsl[release] = dsl_root(
        C("DeleteCondition", -17, ["DCComboRestriction"], 99, 0, "", ["Default"]),
        C("ConsumeUniqueCondition", -17, int(u_lock), ["Some", 1]),
        wait(900, lock, give(-17, [["ACUnique", int(u_lock), P(1)]], "cursed_dance_mark", cancelable=False)),
    )
    w.cas["cursed_dance_lock"] = "连击上限变为9，并处于「剑舞未成」状态"
    w.cas["cursed_dance_release"] = "解除连击上限与「剑舞未成」15秒"
    pf10 = trig(IT_PF, threshold=times(10))
    w.soul = [
        Eff("0", condition("28", None, 50, 900), trig=pf10, note="每 10 次强化弹射：强化弹射伤害 +50%（15 秒）"),
        Eff("0", condition("26", None, None, 900), trig=pf10, note="每 10 次强化弹射：贯通（15 秒）"),
        Eff("0", ("226", {"strength": (times(4), times(4))}), trig=pf10, note="每 10 次强化弹射：连击 +4"),
    ]
    w.ea = [
        *growth_pair("28", None, 200, 50, trig_=pf10, cond_frames=900),
        Eff("0", ("226", {"strength": (times(36), times(36))}), trig=pf10, **FINAL,
            note="每 10 次强化弹射：连击再 +36（合计 +40）"),
        Eff("0", invoke("cursed_dance_lock", init), **CURSE, note="【诅咒】开局连击上限 9、进入「剑舞未成」"),
        Eff("0", invoke("cursed_dance_release", release), trig=pf10, **CURSE,
            note="每 10 次强化弹射解除限制 15 秒"),
        Eff("1", during("413", None, -100), trig=gate_unique(u_lock), even_if_dead=True, **CURSE,
            note="【诅咒】「剑舞未成」期间强化弹射伤害独立乘区 -100%（伤害降为 1）"),
    ]
    w.deviations.append("「场地变成有风的 boss 场地、把人往左右推」：玩家侧 DSL 的 CreateWindAttack 在 MemberImpl 直接 throw，不做")
    return w


def w13() -> Weapon:
    w = Weapon(13, "sealed_wind_flute", "封能风笛", "饰品", ("wind",), "脆脆鲨",
               "缠着封符的风笛", "封住了旁门，只剩风能灌满技能。",
               "风属性共鸣时：开局全队技能槽清空；全队技能充能速度 +100%；角色技能槽满时自身攻击与技能伤害 +500%（20 秒）")
    wind = (res("wind"),)
    drain = dsl_program("flute_drain")
    w.dsl[drain] = dsl_root(party(0, C("SubtractSkillPoint", 0, P(2.0))))
    w.cas["cursed_flute_drain"] = "清空全队技能槽"
    full = trig(IT_SKILL_MAX, trigger_puller=P_ONE_OF_PARTY, cooltime="1200")
    u_seal = w.uid(1)
    w.uniques[u_seal] = unique_row(f"cursed_flute_{u_seal}", "封能", ICON_CURSE, "99999999", "1", bad=True)
    w.soul = [Eff("0", stat("35", T_PARTY, 15, 30), pre=wind, note="风属性共鸣时：全队技能充能速度 +15%→30%")]
    w.ea = [
        *growth_pair("35", T_PARTY, 100, 30, pre=wind),
        Eff("0", invoke("cursed_flute_drain", drain), trig=elapsed(30, "1"), pre=wind, **CURSE,
            note="【诅咒】开局（0.5 秒后）清空全队技能槽"),
        Eff("0", condition("0", T_TRIGGER, 500, 1200, by_each_trigger_puller="true"), trig=full, pre=wind,
            **FINAL, note="角色技能槽满时，该角色攻击力 +500%（20 秒，每人各自 CT20 秒）"),
        Eff("0", condition("1", T_TRIGGER, 500, 1200, by_each_trigger_puller="true"), trig=full, pre=wind,
            **FINAL, note="角色技能槽满时，该角色技能伤害 +500%（20 秒，每人各自 CT20 秒）"),
        Eff("0", unique(u_seal), pre=wind, **CURSE, note="开局给自身刻上「封能」（永续、不可驱散）"),
        Eff("1", ("423", {"target": T_PARTY, "unique_condition_id": str(GAUGE_MASK)}), trig=gate_unique(u_seal),
            pre=wind, even_if_dead=True, **CURSE,
            note="【诅咒】持有「封能」时全队无法因能力和装备获得技能槽（423，规则码 8；持有者阵亡后仍生效）"),
    ]
    w.deviations.append("「无法因能力和被动得到充能」按回槽来源限制（423，规则码 8）实现：拦下能力/装备带来的加槽，"
                        "技能自身回槽、移动跑条与开局槽不受影响；需要 equipment-rules 客户端补丁（未装读到 C7050）。"
                        "充能速度 +100% 受引擎充能上限约束")
    return w


def w14() -> Weapon:
    w = Weapon(14, "triple_curse_key", "三重咒钥", "饰品", (), "脆脆鲨",
               "三齿咒纹钥匙", "第一次打开很难，之后的门会自己敞开。",
               "全队技能充能速度 -66%（约三倍充能）、开局清空技能槽；自身首次发动技能后，之后两次发动技能各回复 100% 技能槽；"
               "自身发动技能时攻击力 +1500%（10 秒）")
    u_key = w.uid(1)
    w.uniques[u_key] = unique_row(f"cursed_key_{u_key}", "咒钥", ICON_STACK, "99999999", "2", bad=False)
    drain = dsl_program("key_drain")
    w.dsl[drain] = dsl_root(party(0, C("SubtractSkillPoint", 0, P(2.0))))
    w.cas["cursed_key_drain"] = "清空全队技能槽"
    skill = trig(IT_SKILL, trigger_puller=P_SELF)
    w.soul = [
        Eff("0", ("0", {"target": T_SELF, "strength": (pct(100), pct(300)), "frame": frames(600), "number": times(1),
                        "cancelable": "0"}), trig=skill, note="发动技能时自身攻击力 +100%→300%（10 秒）")]
    consume = ("2", {"target": "0", "threshold.power1": times(1), "threshold.first_max": times(1),
                     "unique_condition_id": u_key})
    w.ea = [
        *growth_pair("0", T_SELF, 1500, 300, trig_=skill, cond_frames=600),
        Eff("0", ("211", {"target": T_SELF, "strength": (pct(100), pct(100))}), trig=skill, pc=consume,
            **CURSE, note="发动技能时消耗 1 层「咒钥」回复 100% 技能槽"),
        Eff("0", unique(u_key, 2), trig=trig(IT_SKILL, trigger_puller=P_SELF, trigger_limit="1"), delay=1,
            **CURSE, note="首次发动技能后获得「咒钥」2 层"),
        Eff("0", stat("35", T_PARTY, -66), **CURSE, note="【诅咒】全队技能充能速度 -66%"),
        Eff("0", invoke("cursed_key_drain", drain), trig=elapsed(30, "1"), **CURSE,
            note="【诅咒】开局（0.5 秒后）清空全队技能槽"),
    ]
    w.deviations.append("「需要三倍充能」：槽容量不能调，改为全队充能速度 -66%（约三倍时间）；回充只给装备者")
    return w


def w15() -> Weapon:
    w = Weapon(15, "expired_gasoline", "过期汽油", "饰品", ("fire",), "脆脆鲨",
               "漏油的红色油桶", "油是过期了，火还是会点着。",
               "火属性共鸣时：队长攻击 +250%、强化弹射伤害 +750%、强化弹射独立乘区 +15%；全队弹球速度 -30%（不可驱散）")
    fire = (res("fire"),)
    w.soul = [
        Eff("0", stat("32", T_LEADER, 50, 120), pre=fire, note="火属性共鸣时：队长攻击力 +50%→120%"),
        Eff("0", stat("55", None, 150, 360), pre=fire, note="火属性共鸣时：强化弹射伤害 +150%→360%"),
    ]
    w.ea = [
        *growth_pair("32", T_LEADER, 250, 120, pre=fire),
        *growth_pair("55", None, 750, 360, pre=fire),
        Eff("0", ("696", {"strength": (pct(15), pct(15))}), pre=fire, **FINAL,
            note="火属性共鸣时：强化弹射伤害独立乘区 +15%"),
        Eff("0", ("228", {"strength": (pct(-30), pct(-30)), "frame": INF_FRAMES, "number": times(1), "cancelable": "1"}),
            pre=fire, **CURSE, note="【诅咒】火属性共鸣时：全队弹球速度 -30%（永续，不可驱散）"),
    ]
    w.deviations.append("第二轮反馈「刃值和乘区减半」：队长攻击 500→250%、强化弹射伤害 1500→750%、独立乘区 30→15%")
    w.deviations.append("「冲刺冷却 +50%」没有原生能力（冲刺参数补丁只认角色表）；「重力」「溺水」是 boss 场地物理，"
                        "玩家侧 DSL 会 throw；统一改为弹球减速 -30%")
    return w


def w16() -> Weapon:
    w = Weapon(16, "all_in_blade", "孤注一掷", "剑", (), "脆脆鲨",
               "剑柄嵌着独颗宝石的大剑", "只出一拳——之后就是太空垃圾的时间。",
               "同属性编成时：全队充能速度 +100%、攻击与技能伤害 +1000%、技能伤害独立乘区 +20%；任一角色发动技能后自身封印 30 秒（不可驱散）")
    same = (SAME_ELEMENT,)
    w.soul = [
        Eff("0", stat("35", T_PARTY, 15, 30), pre=same, note="同属性编成时：全队技能充能速度 +15%→30%"),
        Eff("0", stat("32", T_PARTY, 120, 480), pre=same, note="同属性编成时：全队攻击力 +120%→480%"),
        Eff("0", stat("34", T_PARTY, 120, 480), pre=same, note="同属性编成时：全队技能伤害 +120%→480%"),
    ]
    w.ea = [
        *growth_pair("35", T_PARTY, 100, 30, pre=same),
        *growth_pair("32", T_PARTY, 1000, 480, pre=same),
        *growth_pair("34", T_PARTY, 1000, 480, pre=same),
        Eff("0", stat("694", T_PARTY, 20), pre=same, **FINAL, note="同属性编成时：全队技能伤害独立乘区 +20%"),
        Eff("0", condition("219", T_TRIGGER, None, 1800, cancelable=False),
            trig=trig(IT_SKILL, trigger_puller=P_ONE_OF_PARTY), pre=same, **CURSE,
            note="【诅咒】任一角色发动技能后，该角色封印 30 秒（不可驱散）"),
    ]
    return w


def w17() -> Weapon:
    w = Weapon(17, "overload_capacitor", "过载电容", "饰品", ("thunder",), "苍氿兮曰",
               "迸着电火花的电容", "放电两次之后，线圈会把你也电住。",
               "雷属性共鸣时：全队技能伤害 +600%；每名角色每发动 2 次技能后麻痹 10 秒（不可驱散）")
    thunder = (res("thunder"),)
    w.soul = [Eff("0", stat("34", T_PARTY, 125, 250), pre=thunder, note="雷属性共鸣时：全队技能伤害 +125%→250%")]
    w.ea = [
        *growth_pair("34", T_PARTY, 600, 250, pre=thunder),
        Eff("0", condition("19", T_TRIGGER, None, 600, cancelable=False, by_each_trigger_puller="true"),
            trig=trig(IT_SKILL, trigger_puller=P_ONE_OF_PARTY, threshold=times(2)), pre=thunder, **CURSE,
            note="【诅咒】每名角色每发动 2 次技能，该角色麻痹 10 秒（不可驱散；麻痹期间不能施放技能与直接攻击）"),
    ]
    return w


def _persona_dark_heal() -> list:
    """暗诅咒：每秒回复全队 50%，队长额外 20%（5 秒）。"""
    pulse = lambda: [party(0, C("CreateRatioHeal", 0, 2, P(0.5), [], P(0), ["GenericHealHitEffect"])),
                     slot_member(1, 83, C("CreateRatioHeal", 1, 2, P(0.2), [], P(0), ["GenericHealHitEffect"]))]
    return [*pulse()] + [wait(60 * i, *pulse()) for i in range(1, 5)]


def w18() -> Weapon:
    w = Weapon(18, "persona_pistol", "人格召唤枪", "铳", ("dark", "thunder"), "P.P.P.P",
               "萦绕面具幻影的银色小手枪", "扣下扳机，唤醒的是另一个自己。",
               "暗属性共鸣：开局全队 HP -25%；角色 HP 为 1% 时护盾 100%、攻击 +700%×2、逆境 +20%（2 秒）、全队充能 +40%（3 秒）；"
               "诅咒：任一角色施放技能后每秒回复全队 50%、队长再 +20%（5 秒）。雷属性共鸣：开局队长 HP -15%；队长 HP<20% 时"
               "护盾 80%、攻击 +500%×2、技能伤害 +600%（6 秒）、技能槽 +100%（限 2 次）；诅咒：队长施放技能后全队回复 20%、"
               "3 秒后再回复 80%，2、3 号位技能槽 -30%")
    dark, thunder = (res("dark"),), (res("thunder"),)
    near_death = trig(IT_HP_LOW, trigger_puller=P_ONE_OF_PARTY, threshold=pct(1), cooltime="60")
    leader20 = trig(IT_HP_LOW, trigger_puller=P_LEADER, threshold=pct(20), trigger_limit="2")
    heal = dsl_program("persona_heal")
    w.dsl[heal] = dsl_root(*_persona_dark_heal())
    w.cas["cursed_persona_heal"] = "每秒回复全队最大HP的50%，队长额外回复20%（5秒）"
    echo = dsl_program("persona_echo")
    w.dsl[echo] = dsl_root(
        party(0, C("CreateRatioHeal", 0, 2, P(0.2), [], P(0), ["GenericHealHitEffect"])),
        wait(180, party(1, C("CreateRatioHeal", 1, 2, P(0.8), [], P(0), ["GenericHealHitEffect"]))),
        slot_member(2, 84, C("SubtractSkillPoint", 2, P(0.3))),
        slot_member(3, 85, C("SubtractSkillPoint", 3, P(0.3))))
    w.cas["cursed_persona_echo"] = "回复全队最大HP的20%，3秒后再回复80%；2号位与3号位角色技能槽减少30%"
    w.soul = [
        Eff("0", stat("227", T_TRIGGER, 50, 100), trig=near_death, pre=dark,
            note="暗属性共鸣：角色 HP 为 1% 时获得最大 HP +50%→100% 的护盾"),
        Eff("0", condition("0", T_TRIGGER, 700, 120), trig=near_death, pre=dark, note="同上时攻击力 +700%（2 秒）"),
        Eff("0", condition("470", T_TRIGGER, 20, 120), trig=near_death, pre=dark, note="同上时逆境 +20%（2 秒）"),
        Eff("0", condition("701", T_PARTY, 40, 180), trig=near_death, pre=dark, note="同上时全队技能充能速度 +40%（3 秒）"),
        Eff("0", stat("227", T_LEADER, 40, 80), trig=leader20, pre=thunder,
            note="雷属性共鸣：队长 HP<20% 时获得最大 HP +40%→80% 的护盾（限 2 次）"),
        Eff("0", condition("0", T_LEADER, 500, 360), trig=leader20, pre=thunder, note="同上时队长攻击力 +500%（6 秒）"),
        Eff("0", condition("1", T_LEADER, 600, 360), trig=leader20, pre=thunder, note="同上时队长技能伤害 +600%（6 秒）"),
        Eff("0", stat("211", T_LEADER, 50, 100), trig=leader20, pre=thunder, note="同上时队长技能槽 +50%→100%"),
    ]
    w.ea = [
        *growth_pair("227", T_TRIGGER, 100, 100, trig_=near_death, pre=dark),
        *growth_pair("0", T_TRIGGER, 1400, 700, trig_=near_death, pre=dark, cond_frames=120),
        *growth_pair("470", T_TRIGGER, 20, 20, trig_=near_death, pre=dark, cond_frames=120),
        *growth_pair("701", T_PARTY, 40, 40, trig_=near_death, pre=dark, cond_frames=180),
        Eff("0", stat("209", T_PARTY, 25), pre=dark, **CURSE, note="【诅咒】暗：开局全队失去最大 HP 的 25%"),
        Eff("0", invoke("cursed_persona_heal", heal), trig=trig(IT_SKILL, trigger_puller=P_ONE_OF_PARTY), pre=dark,
            **CURSE, note="【诅咒】暗：任一角色施放技能后每秒回复全队 50%、队长再 +20%（5 秒）"),
        *growth_pair("227", T_LEADER, 80, 80, trig_=leader20, pre=thunder),
        *growth_pair("0", T_LEADER, 1000, 500, trig_=leader20, pre=thunder, cond_frames=360),
        *growth_pair("1", T_LEADER, 600, 600, trig_=leader20, pre=thunder, cond_frames=360),
        *growth_pair("211", T_LEADER, 100, 100, trig_=leader20, pre=thunder),
        Eff("0", stat("209", T_LEADER, 15), pre=thunder, **CURSE, note="【诅咒】雷：开局队长失去最大 HP 的 15%"),
        Eff("0", invoke("cursed_persona_echo", echo), trig=trig(IT_SKILL, trigger_puller=P_LEADER), pre=thunder,
            **CURSE, note="【诅咒】雷：队长施放技能后全队回复 20%、3 秒后再回复 80%，2、3 号位技能槽 -30%"),
    ]
    w.deviations.append("第二轮 v2：两套都取消次数上限（雷的濒死爆发保留提案写明的上限 2 次）；「攻击 +700%&+700%」按两段合计 +1400% 实现")
    w.deviations.append("「类似响的 buff」：没有可复用的状态外观，按「立刻回复 20%、3 秒后回复 80%」实现（原版暗响特殊 buff 持续 3 秒）")
    return w


def w19() -> Weapon:
    w = Weapon(19, "lone_star", "孤星", "剑", (), "苍氿兮曰",
               "剑尖缀着一颗星的细剑", "星光照不到的三秒里，连击不会增长。",
               "队长攻击 +500%、强化弹射伤害 +1000%；强化弹射后 3 秒内连击上限 10")
    lock = dsl_program("lonestar_lock")
    w.dsl[lock] = dsl_root(give(-17, [["ACComboRestriction", P(180), P(10)]], "cursed_lonestar", cancelable=False))
    w.cas["cursed_lonestar_lock"] = "3秒内连击上限变为10"
    w.soul = [
        Eff("0", stat("32", T_LEADER, 100, 240), note="队长攻击力 +100%→240%"),
        Eff("0", stat("55", None, 200, 480), note="强化弹射伤害 +200%→480%"),
    ]
    w.ea = [
        *growth_pair("32", T_LEADER, 500, 240),
        *growth_pair("55", None, 1000, 480),
        Eff("0", invoke("cursed_lonestar_lock", lock), trig=trig(IT_PF, threshold=times(1)), **CURSE,
            note="【诅咒】强化弹射后 3 秒内连击上限 10"),
    ]
    w.deviations.append("「PF 后 3 秒无法通过技能增加连击」没有按来源屏蔽连击的原语，改为 3 秒内连击上限 10（技能刷连击同样被压住）")
    return w


def w20() -> Weapon:
    w = Weapon(20, "master_eater_sword", "噬主魔剑", "剑", (), "来点关注谢谢喵",
               "锁链缠绕、剑柄带刺的暗紫魔剑", "剑认可所有人，唯独不认握着它的队长。",
               "除队长外攻击力 +550%，并额外获得协力角色攻击力 100% 的白值；队长攻击力 -9999%（伤害归零）")
    w.soul = [
        Eff("0", stat("32", T_SECOND, 120, 240), note="2 号位攻击力 +120%→240%"),
        Eff("0", stat("32", T_THIRD, 120, 240), note="3 号位攻击力 +120%→240%"),
    ]
    rows = []
    for target in (T_SECOND, T_THIRD):
        rows += [
            *growth_pair("32", target, 550, 240),
            Eff("0", stat("717", target, 100), **FINAL, note="获得协力角色攻击力 100% 的白值"),
        ]
    w.ea = rows + [
        Eff("0", stat("32", T_LEADER, -9999), **CURSE, note="【诅咒】队长攻击力 -9999%（引擎下限 -50%）"),
        Eff("0", stat("723", T_LEADER, -100), **CURSE, note="【诅咒】队长伤害独立乘区 -100%（伤害降为 1）"),
    ]
    w.deviations.append("「除队长外」按 2、3 号位实现；攻击 -9999% 受 -50% 下限，另加伤害独立乘区 -100% 让队长伤害归零")
    return w


def w21() -> Weapon:
    w = Weapon(21, "silent_bell", "失声之钟", "饰品", ("wind", "dark"), "来点关注谢谢喵",
               "裂开、没有钟舌的铜钟", "钟不再响了，可每个人都听见了它。",
               "风/暗属性共鸣时：全队技能伤害 +500%、技能伤害独立乘区 +100%；全队永续封印（不可驱散，复活后重新附加）")
    rows_s, rows_e = [], []
    for element in ("wind", "dark"):
        gate = (res(element),)
        cn = "风" if element == "wind" else "暗"
        rows_s.append(Eff("0", stat("34", T_PARTY, 120, 240), pre=gate, note=f"{cn}属性共鸣时：全队技能伤害 +120%→240%"))
        rows_e += [
            *growth_pair("34", T_PARTY, 500, 240, pre=gate),
            Eff("0", stat("694", T_PARTY, 100), pre=gate, **FINAL, note="全队技能伤害独立乘区 +100%"),
            Eff("0", condition("219", T_PARTY, None, INF_FRAMES, cancelable=False), pre=gate, **CURSE,
                note="【诅咒】全队永续封印（不可驱散）"),
            Eff("0", condition("219", T_PARTY, None, INF_FRAMES, cancelable=False),
                trig=trig(IT_REVIVAL, trigger_puller=P_ONE_OF_PARTY), pre=gate, **CURSE,
                note="【诅咒】复活后重新附加封印"),
        ]
    w.soul, w.ea = rows_s, rows_e
    return w


def w23() -> Weapon:
    w = Weapon(23, "coral_venom_claw", "珊瑚毒爪", "拳", ("water",), "阿关",
               "珊瑚与鱼骨组成的指刃", "毒是它的饵——没有毒的时候，爪子什么也抓不住。",
               "水属性共鸣时：强化弹射使自身中毒 10 秒，并叠加攻击 +100%（最多 +500%）、技能伤害 +120%（最多 +480%）；"
               "未中毒时自身直接攻击与技能伤害 -99%")
    water = (res("water"),)
    poison = dsl_program("coral_poison")
    w.dsl[poison] = dsl_root(give(-17, [["ACPoison", P(600), P(50), P(1)]], "cursed_coral_poison", cancelable=True))
    w.cas["cursed_coral_poison"] = "使自身中毒（10秒）"
    pf5 = trig(IT_PF, threshold=times(1), trigger_limit="5")
    pf4 = trig(IT_PF, threshold=times(1), trigger_limit="4")
    poisoned = (DT_POISON, {"trigger_puller": P_SELF})
    w.soul = [
        Eff("0", stat("32", T_SELF, 25, 50), trig=pf5, pre=water, note="水属性共鸣时：强化弹射时自身攻击力 +25%→50%（最多 5 次）"),
        Eff("0", stat("34", T_SELF, 30, 60), trig=pf4, pre=water, note="水属性共鸣时：强化弹射时自身技能伤害 +30%→60%（最多 4 次）"),
    ]
    w.ea = [
        *growth_pair("32", T_SELF, 100, 50, trig_=pf5, pre=water),
        *growth_pair("34", T_SELF, 120, 60, trig_=pf4, pre=water),
        Eff("0", invoke("cursed_coral_poison", poison), trig=trig(IT_PF, threshold=times(1)), pre=water,
            **CURSE, note="【诅咒】强化弹射时自身中毒（10 秒）"),
        Eff("0", stat("693", T_SELF, -99), pre=water, **CURSE, note="【诅咒】自身直接攻击伤害独立乘区 -99%"),
        Eff("0", stat("694", T_SELF, -99), pre=water, **CURSE, note="【诅咒】自身技能伤害独立乘区 -99%"),
        Eff("1", during("410", T_SELF, 99), trig=poisoned, pre=water, **CURSE,
            note="中毒期间抵消直接攻击 -99%（净效果：只有未中毒时 -99%）"),
        Eff("1", during("411", T_SELF, 99), trig=poisoned, pre=water, **CURSE,
            note="中毒期间抵消技能伤害 -99%（净效果：只有未中毒时 -99%）"),
    ]
    w.deviations.append("第二轮：攻击 +100%×5 次、技能伤害 +120%×4 次，删去直击叠加行；「未中毒时 -99%」扩到直击与技能伤害")
    w.deviations.append("「未中毒时 -99%」拆成常驻 -99% + 中毒期间 +99%（独立乘区相加抵消）")
    return w


def w24() -> Weapon:
    w = Weapon(24, "reverse_hourglass", "倒流沙漏", "饰品", ("thunder", "wind"), "阿关",
               "沙粒向上流的金框沙漏", "沙子往上流时，你的技能也慢了下来。",
               "雷/风属性共鸣时：发动技能或强化弹射时叠「逆沙」（最多 5 层），每层自身攻击 +160%（最多 +800%）、"
               "技能伤害 +150%（最多 +700%）；自身技能充能速度 -20%、全队 -5%")
    u_sand = w.uid(1)
    w.uniques[u_sand] = unique_row(f"cursed_sand_{u_sand}", "逆沙", ICON_TIME, "99999999", "5", bad=False)
    rows_s, rows_e = [], []
    for element in ("thunder", "wind"):
        gate = (res(element),)
        cn = "雷" if element == "thunder" else "风"
        stack5, stack4, fifth = gate_unique(u_sand, "5"), gate_unique(u_sand, "4"), gate_unique(u_sand, "1", at_least=5)
        rows_s += [
            Eff("0", unique(u_sand), trig=trig(IT_SKILL, trigger_puller=P_SELF), pre=gate, note=f"{cn}属性共鸣时：发动技能叠 1 层「逆沙」"),
            Eff("0", unique(u_sand), trig=trig(IT_PF, threshold=times(1)), pre=gate, note=f"{cn}属性共鸣时：强化弹射叠 1 层「逆沙」"),
            Eff("1", during("0", T_SELF, 40, 80), trig=stack5, pre=gate, note="每层「逆沙」自身攻击力 +40%→80%（最多 5 层）"),
            Eff("1", during("2", T_SELF, 37.5, 75), trig=stack4, pre=gate, note="每层「逆沙」自身技能伤害 +37.5%→75%（按 4 层计）"),
        ]
        rows_e += [
            *growth_pair("0", T_SELF, 160, 80, mode="1", trig_=stack5, pre=gate),
            *growth_pair("2", T_SELF, 150, 75, mode="1", trig_=stack4, pre=gate),
            *growth_pair("2", T_SELF, 100, 0, mode="1", trig_=fifth, pre=gate),
            Eff("0", stat("35", T_SELF, -20), pre=gate, **CURSE, note="【诅咒】自身技能充能速度 -20%"),
            Eff("0", stat("35", T_PARTY, -5), pre=gate, **CURSE, note="【诅咒】全队技能充能速度 -5%"),
        ]
    w.soul, w.ea = rows_s, rows_e
    w.deviations.append("第二轮：「逆沙」上限 5 层；技能伤害「+150%（最多 +700%）」= 前 4 层每层 +150%、第 5 层 +100%")
    w.deviations.append("「PF 命中敌人时」按强化弹射发动计；两种触发共用「逆沙」上限")
    return w


def w22() -> Weapon:
    w = Weapon(22, "diesel_engine", "柴油引擎", "饰品", ("fire",), "脆脆鲨",
               "冒着黑烟的铸铁柴油引擎", "引擎一响，后排的油就被抽干了。",
               "火属性共鸣时：队长攻击与技能伤害 +500%，伤害/技能伤害独立乘区各 +10%，获得合击角色攻击力 20% 的白值；"
               "队长每次发动技能，2、3 号位攻击力 -200%、技能槽 -50%")
    fire = (res("fire"),)
    drain = dsl_program("diesel_drain")
    w.dsl[drain] = dsl_root(slot_member(0, 84, C("SubtractSkillPoint", 0, P(0.5))),
                            slot_member(1, 85, C("SubtractSkillPoint", 1, P(0.5))))
    w.cas["cursed_diesel_drain"] = "2号位与3号位角色技能槽减少50%"
    leader_skill = trig(IT_SKILL, trigger_puller=P_LEADER)
    w.soul = [
        Eff("0", stat("32", T_LEADER, 125, 250), pre=fire, note="火属性共鸣时：队长攻击力 +125%→250%"),
        Eff("0", stat("34", T_LEADER, 125, 250), pre=fire, note="火属性共鸣时：队长技能伤害 +125%→250%"),
    ]
    w.ea = [
        *growth_pair("32", T_LEADER, 500, 250, pre=fire),
        *growth_pair("34", T_LEADER, 500, 250, pre=fire),
        Eff("0", stat("723", T_LEADER, 10), pre=fire, **FINAL, note="火属性共鸣时：队长伤害独立乘区 +10%"),
        Eff("0", stat("694", T_LEADER, 10), pre=fire, **FINAL, note="火属性共鸣时：队长技能伤害独立乘区 +10%"),
        Eff("0", stat("717", T_LEADER, 20), pre=fire, **FINAL, note="火属性共鸣时：队长获得合击角色攻击力 20% 的白值"),
        Eff("0", stat("32", T_SECOND, -200), trig=leader_skill, pre=fire, **CURSE,
            note="【诅咒】队长发动技能时 2 号位攻击力 -200%（每次叠加）"),
        Eff("0", stat("32", T_THIRD, -200), trig=leader_skill, pre=fire, **CURSE,
            note="【诅咒】队长发动技能时 3 号位攻击力 -200%（每次叠加）"),
        Eff("0", invoke("cursed_diesel_drain", drain), trig=leader_skill, pre=fire, **CURSE,
            note="【诅咒】队长发动技能时 2、3 号位技能槽 -50%"),
    ]
    w.deviations.append("「10% 火属性伤害乘区」在火属性共鸣下等价于伤害独立乘区 +10%；「50% 的充能」按技能槽 -50% 实现；"
                        "攻击力 -200% 叠加受引擎攻击加成下限 -50% 约束")
    return w


def w25() -> Weapon:
    w = Weapon(25, "overclock_chip", "超频芯片", "饰品", ("thunder",), "不要脸",
               "迸着蓝白电弧的限制解除核心", "解除限制的代价，是核心过热的二十秒。",
               "自身为雷属性时：技能伤害独立乘区 +400%；自身发动技能后进入「过载」20 秒，期间技能充能速度 -100%")
    thunder = (my_element("thunder"),)
    w.soul = [Eff("0", stat("694", T_SELF, 50, 100), pre=thunder, note="自身为雷属性时：技能伤害独立乘区 +50%→100%")]
    w.ea = [
        *growth_pair("694", T_SELF, 400, 100, pre=thunder),
        Eff("0", condition("701", T_SELF, -100, 1200, cancelable=False), trig=trig(IT_SKILL, trigger_puller=P_SELF),
            pre=thunder, **CURSE, note="【诅咒】自身发动技能后「过载」：20 秒内技能充能速度 -100%（不可驱散）"),
    ]
    w.deviations.append("「乘区 7」按技能伤害独立乘区；「无法获得任何充能」按充能速度 -100%（引擎钳到 0）实现，"
                        "技能槽直接增加类效果（如队友回槽）不受影响")
    return w


def w26() -> Weapon:
    w = Weapon(26, "lone_wolf_crown", "孤狼王冠", "饰品", (), "不要脸",
               "狼首造型的银色王冠", "王座只容得下一个人——多一个都不行。",
               "自身攻击、技能伤害、直击伤害、能力伤害、强化弹射伤害 +1000%，技能充能速度 +100%，伤害独立乘区 +100%；"
               "队伍中有其他角色时以上全部抵消")
    stats = (("32", T_SELF, 1000), ("34", T_SELF, 1000), ("33", T_SELF, 1000), ("388", T_SELF, 1000),
             ("55", None, 1000), ("35", T_SELF, 100), ("723", T_SELF, 100))
    w.soul = [Eff("0", stat(kind, target, total / 4, total / 2),
                  note=f"自身{KIND_LABEL.get(kind, '伤害独立乘区')} +{total / 4:g}%→{total / 2:g}%")
              for kind, target, total in stats]
    w.ea = [row for kind, target, total in stats for row in growth_pair(kind, target, total, total / 2)]
    w.ea += [Eff("0", stat(kind, target, -total), pre=(HAS_TEAMMATE,), **CURSE,
                 note=f"【诅咒】队伍中有其他角色时：{KIND_LABEL.get(kind, '伤害独立乘区')} -{total:g}%")
             for kind, target, total in stats]
    w.deviations.append("「除自身外没有队友」无直接前置：改为「编成 ≥2 人时」逐项抵消（强化 1 级起按终值扣，120 级正好归零）；"
                        "「乘区 9」按伤害独立乘区")
    return w


def w27() -> Weapon:
    w = Weapon(27, "triphase_prism", "三相之力", "饰品", ("wind", "water", "fire"), "不要脸",
               "三色棱面的三角晶体", "三角形最稳定——可力量从不在一个角停留。",
               "自身为风/水/火属性时：直击、技能、强化弹射伤害 +500%；强化弹射命中时强化弹射伤害 -20%、直击 +25%；"
               "直击时直击 -20%、技能伤害 +25%；技能命中时技能伤害 -20%、强化弹射伤害 +25%（各 CT1 秒，最多 20 次）")
    gate = (my_element("wind", "water", "fire"),)
    w.soul = [
        Eff("0", stat("33", T_SELF, 125, 250), pre=gate, note="自身为风/水/火属性时：直接攻击伤害 +125%→250%"),
        Eff("0", stat("34", T_SELF, 125, 250), pre=gate, note="自身为风/水/火属性时：技能伤害 +125%→250%"),
        Eff("0", stat("55", None, 125, 250), pre=gate, note="自身为风/水/火属性时：强化弹射伤害 +125%→250%"),
    ]
    pf_hit = trig(IT_PF_HIT, threshold=times(1), cooltime="60", trigger_limit="20")
    direct = trig(IT_DIRECT, trigger_puller=P_SELF, threshold=times(1), cooltime="60", trigger_limit="20")
    skill_hit = trig(IT_SKILL_HIT, trigger_puller=P_SELF, threshold=times(1), cooltime="60", trigger_limit="20")
    w.ea = [
        *growth_pair("33", T_SELF, 500, 250, pre=gate),
        *growth_pair("34", T_SELF, 500, 250, pre=gate),
        *growth_pair("55", None, 500, 250, pre=gate),
        Eff("0", stat("55", None, -20), trig=pf_hit, pre=gate, **CURSE, note="【诅咒】强化弹射命中时强化弹射伤害 -20%"),
        Eff("0", stat("33", T_SELF, 25), trig=pf_hit, pre=gate, **CURSE, note="同时自身直接攻击伤害 +25%"),
        Eff("0", stat("33", T_SELF, -20), trig=direct, pre=gate, **CURSE, note="【诅咒】自身直接攻击时直接攻击伤害 -20%"),
        Eff("0", stat("34", T_SELF, 25), trig=direct, pre=gate, **CURSE, note="同时自身技能伤害 +25%"),
        Eff("0", stat("34", T_SELF, -20), trig=skill_hit, pre=gate, **CURSE, note="【诅咒】自身技能命中时技能伤害 -20%"),
        Eff("0", stat("55", None, 25), trig=skill_hit, pre=gate, **CURSE, note="同时强化弹射伤害 +25%"),
    ]
    w.deviations.append("「若该伤害加成 >100%」：技能/强化弹射伤害提升量前置官方零用例、直击没有此类前置；改为每种转移 CT1 秒、"
                        "最多 20 次（120 级 +500% 起步最多降到 +100%）")
    return w


def w28() -> Weapon:
    w = Weapon(28, "flesh_for_bone", "肉斩骨断", "剑", ("wind",), "脆脆鲨",
               "刃口带血槽的厚背斩骨刀", "先斩自己的肉，才能断敌人的骨。",
               "风属性共鸣时：全队直击伤害 +1000%，获得合击角色攻击力 20% 的白值，伤害独立乘区 +10%；"
               "每次对敌人造成伤害时全队受到最大 HP 5% 的伤害、连击 +5（CT2 秒）")
    wind = (res("wind"),)
    u_cd = w.uid(1)
    w.uniques[u_cd] = unique_row(f"cursed_bone_{u_cd}", "骨断", ICON_CURSE, "120", "1", bad=True)
    w.soul = [Eff("0", stat("33", T_PARTY, 250, 500), pre=wind, note="风属性共鸣时：全队直接攻击伤害 +250%→500%")]
    w.ea = [
        *growth_pair("33", T_PARTY, 1000, 500, pre=wind),
        Eff("0", stat("717", T_PARTY, 20), pre=wind, **FINAL, note="风属性共鸣时：全队获得合击角色攻击力 20% 的白值"),
        Eff("0", stat("723", T_PARTY, 10), pre=wind, **FINAL, note="风属性共鸣时：全队伤害独立乘区 +10%"),
    ]
    ready = (*wind, lacks_unique(u_cd))
    for source, trigger in (("直接攻击", trig(IT_DIRECT, trigger_puller=P_ONE_OF_PARTY, threshold=times(1))),
                            ("技能命中", trig(IT_SKILL_HIT, trigger_puller=P_ONE_OF_PARTY, threshold=times(1))),
                            ("强化弹射命中", trig(IT_PF_HIT, threshold=times(1)))):
        w.ea += [
            Eff("0", stat("209", T_PARTY, 5), trig=trigger, pre=ready, **CURSE,
                note=f"【诅咒】{source}时全队受到最大 HP 5% 的伤害（CT2 秒）"),
            Eff("0", ("226", {"strength": (times(5), times(5))}), trig=trigger, pre=ready, **CURSE,
                note=f"{source}时连击 +5（CT2 秒）"),
            Eff("0", unique(u_cd), trig=trigger, pre=ready, **CURSE, note="进入「骨断」2 秒（共用冷却）"),
        ]
    w.deviations.append("「每次对敌人造成伤害」：官方「敌人受伤次数」触发只接场地系统、能力表零用例；按直击/技能命中/强化弹射命中三路触发，"
                        "以固有状态「骨断」2 秒做共用冷却；「10% 风属性伤害乘区」在风属性共鸣下等价于伤害独立乘区 +10%")
    return w


def w29() -> Weapon:
    w = Weapon(29, "cursed_mask", "被诅咒的面具", "饰品", ("dark",), "不要脸",
               "淌着血的鬼形面具", "戴上它就说不出咒语——但你已经不需要了。",
               "自身为暗属性时：伤害独立乘区 +100%，造成伤害时回复最大 HP 1%（CT0.5 秒）；永久封印且弹球速度固定为最大"
               "（复活后重新附加）；每 5 秒若 HP>30%，失去最大 HP 的 10%")
    dark = (my_element("dark"),)
    revive = trig(IT_REVIVAL, trigger_puller=P_SELF)
    speed = ("688", {"strength": (pct(200), pct(200)), "frame": INF_FRAMES, "number": times(1), "cancelable": "1"})
    silence = condition("219", T_SELF, None, INF_FRAMES, cancelable=False)
    w.soul = [
        Eff("0", stat("723", T_SELF, 15, 30), pre=dark, note="自身为暗属性时：伤害独立乘区 +15%→30%"),
        Eff("0", stat("206", T_SELF, 0.5, 1), trig=trig(IT_DIRECT, trigger_puller=P_SELF, threshold=times(1), cooltime="30"),
            pre=dark, note="自身为暗属性时：直接攻击时回复最大 HP 的 0.5%→1%（CT0.5 秒）"),
        Eff("0", stat("206", T_SELF, 0.5, 1), trig=trig(IT_PF_HIT, threshold=times(1), cooltime="30"),
            pre=dark, note="自身为暗属性时：强化弹射命中时回复最大 HP 的 0.5%→1%（CT0.5 秒）"),
    ]
    w.ea = [
        *growth_pair("723", T_SELF, 100, 30, pre=dark),
        Eff("0", silence, pre=dark, **CURSE, note="【诅咒】自身永久封印（不能施放技能，不可驱散）"),
        Eff("0", silence, trig=revive, pre=dark, **CURSE, note="【诅咒】复活后重新附加封印"),
        Eff("0", speed, pre=dark, **CURSE, note="弹球速度固定为 200%（永续）"),
        Eff("0", speed, trig=revive, pre=dark, **CURSE, note="复活后重新固定弹球速度"),
        Eff("0", stat("209", T_SELF, 10), trig=elapsed(300),
            pre=(*dark, (PRE_HP_HIGH, {"trigger_puller": P_SELF, "threshold": pct(30)})), **CURSE,
            note="【诅咒】每 5 秒若自身 HP ≥30%，失去最大 HP 的 10%"),
    ]
    w.deviations.append("「速度最大化」按官方速度固定 200%（ConditionFixedSpeed，风属性角色 1499896 同值）；「乘区 9」按伤害独立乘区；"
                        "「造成伤害时」按直击与强化弹射命中两路（本身已被封印，不会有技能伤害）")
    return w


WEAPON_BUILDERS: tuple[Callable[[], Weapon], ...] = (
    w01, w02, w03, w04, w05, w06, w07, w08, w09, w10, w11, w12, w13, w14, w15, w16, w17, w18, w19, w20, w21, w22, w23,
    w24, w25, w26, w27, w28, w29)
#: 五重商店上架顺序（= 商品键 990099003 起的偏移）。首轮 23 把的键已经上线，新武器只能接在后面，不能按行号重排。
SHOP_ORDER = (*range(1, 22), 23, 24, 22, 25, 26, 27, 28, 29)


def weapons() -> list[Weapon]:
    out = [builder() for builder in WEAPON_BUILDERS]
    _require([w.row for w in out] == list(range(1, 30)), "提案行号必须是 1..29")
    _require(sorted(SHOP_ORDER) == list(range(1, 30)), "SHOP_ORDER 必须覆盖 1..29")
    _require(len({w.slug for w in out}) == len(out), "slug 重复")
    for w in out:
        w.soul = [_weaken(e) for e in w.soul]
    return out


def shop_key(w: Weapon) -> str:
    return str(BOSS_SHOP_BASE + 3 + SHOP_ORDER.index(w.row))


# ---------------------------------------------------------------------------
# 读 live
# ---------------------------------------------------------------------------

class LiveReader:
    """最小只读接口：flat(logical) -> {key: [[cells]]}；nested(logical) -> {key: {...}}；
    server(name) -> 解析后的 JSON。由暂存脚本注入真实实现，测试注入 fixture。"""

    def __init__(self, flat: Callable[[str], dict], nested: Callable[[str], dict], server: Callable[[str], Any]):
        self.flat, self.nested, self.server = flat, nested, server


def _template(read: LiveReader, logical: str, key: str, width: int) -> list[str]:
    rows = read.flat(logical)[key]
    _require(len(rows) >= 1 and len(rows[0]) == width, f"{logical}[{key}] 模板形状漂移")
    return list(rows[0])


# ---------------------------------------------------------------------------
# 组装
# ---------------------------------------------------------------------------

#: 官方文案长度上限（live 实测）：equipment c7 ≤ 57、equipment_enhancement c6 ≤ 54、boss_coin_shop c10 ≤ 60。
#: 详细效果由客户端按词条行自动生成，文案只放风味与口径，超长会溢出详情框。
DESC_LIMITS = {"equipment": 57, "enhancement": 54, "shop": 60}
SHOP_DESCRIPTION = "诅咒武器：未强化只有微弱的正面效果，强化1级起诅咒全额生效，120级为最终数值。"


#: 客户端补丁 equipment-rules R2：本方（主位武器槽 + 魂珠槽）诅咒段装备 ≥2 件时全部整件失效（本体 + 强化）。
#: 装备详情页仍显示满档，玩家只能从说明里看到这条规则；PARADOX 不计入（作者确认）。
#: 魂珠槽同样计数（一把诅咒武器 + 另一把的魂珠也会两件都失效），所以写「两件（含魂珠）」不写「两把」，与 PARADOX 衰减说明口径一致。
CURSE_RULE = "【诅咒武器·同队两件以上（含魂珠）全部失效】"


def _description(w: Weapon) -> str:
    return f"{w.flavor}{CURSE_RULE}提案：{w.author}"


def _shop_description(w: Weapon) -> str:
    return f"{SHOP_DESCRIPTION}提案：{w.author}"


def _enh_description(w: Weapon) -> str:
    return f"强化1级起诅咒生效，120级为最终数值。提案：{w.author}"


def _cost_cells(costs: Iterable[tuple[str, int]]) -> list[str]:
    cells = []
    for item_id, amount in costs:
        cells += [item_id, str(amount)]
    while len(cells) < 8:
        cells += ["(None)", ""]
    return cells


def row_capabilities(table: str, row: list[str]) -> list[str]:
    """该行在客户端不 C7050 所需的 capability（wf_client_legality 已合并运行时与表解析器扩展两部分）。"""
    return list(L.required_client_capabilities(table, row))


def build(read: LiveReader, *, client_capabilities: Iterable[str] = BASE_CLIENT_CAPABILITIES) -> dict[str, Any]:
    """client_capabilities = 接收这批数据的**全部**客户端共有的 capability；默认 1047 基线，
    装备表 423 行（封能风笛）会作为缺 equipment-gauge-gain-rules-v1 进 problems。"""
    _require(not isinstance(client_capabilities, str), "client_capabilities 须是 capability 名的集合，不是单个字符串")
    have = frozenset(client_capabilities)
    capabilities: list[str] = []
    ws = weapons()
    flat: dict[str, dict[str, list[list[str]]]] = {t: {} for t in FLAT_TABLES}
    nested: dict[str, dict[str, dict]] = {t: {} for t in NESTED_TABLES}
    dsl: dict[str, list] = {}
    problems: list[str] = []

    item_tpl = _template(read, ITEM, "8000101", 23)
    equip_tpl = _template(read, EQUIPMENT, "8000101", 16)
    enh_tpl = _template(read, ENH, "5900101", 9)
    shop_tpls = [_template(read, ENH_SHOP, f"5900110{i}", 50) for i in range(1, 7)]
    cat_tpl = _template(read, ENH_CATEGORY, "5", 10)
    body_tpl = _template(read, BOSS_COIN_SHOP, "990099001", 50)

    for w in ws:
        wid = w.id
        for kind, text in (("equipment", _description(w)), ("enhancement", _enh_description(w)),
                           ("shop", _shop_description(w))):
            _require(len(text) <= DESC_LIMITS[kind], f"{w.name} {kind} 文案 {len(text)} 字超出官方上限 {DESC_LIMITS[kind]}")
            _require("," not in text and "\n" not in text, f"{w.name} {kind} 文案含半角逗号/换行")
        # item（同键魂珠物品行，缺了 ItemLogic 取空崩）
        row = list(item_tpl)
        row[0], row[1], row[2], row[3] = f"mod_cursed_{wid}", wid, f"{w.name}魂珠", w.icon
        flat[ITEM][wid] = [row]
        # equipment
        row = list(equip_tpl)
        row[0], row[1], row[6], row[7], row[9], row[10] = f"mod_cursed_{w.slug}", w.name, w.icon, _description(w), "false", wid
        _require(row[2] == "0" and row[8] == "5" and row[11] == "5", "equipment 模板列义漂移")
        flat[EQUIPMENT][wid] = [row]
        nested[EQUIPMENT_STATUS][wid] = dict(EQUIPMENT_STATUS_ROWS)
        # ability_soul / 强化词条
        soul_rows = [build_row(SOUL_T, slot, eff) for slot, eff in enumerate(w.soul)]
        ea_rows = [build_row(EA_T, slot, eff) for slot, eff in enumerate(w.ea)]
        for table, rows in ((SOUL_T, soul_rows), (EA_T, ea_rows)):
            for index, r in enumerate(rows):
                for p in L.client_legality_problems(table, r):
                    problems.append(f"{w.row:02d} {w.name} {table}#{index}: {p}")
                needed = row_capabilities(table, r)
                capabilities += [c for c in needed if c not in capabilities]
                problems += [f"{w.row:02d} {w.name} {table}#{index}: 目标客户端缺 capability {c}（未打补丁读到即 C7050）"
                             for c in needed if c not in have]
        flat[SOUL][wid] = soul_rows
        flat[EA][wid] = ea_rows
        # equipment_enhancement：名/图/描述/发光全部 120 级（最终形态）才切换
        row = list(enh_tpl)
        row[0:9] = ["120", "120", f"{w.name}·解咒", "120", w.icon120, "120", _enh_description(w), "120", START_TIME]
        flat[ENH][wid] = [row]
        nested[ENH_STATUS][wid] = dict(ENH_STATUS_ROWS)
        # 强化商店 6 阶（类目 6，组 = 武器 ID）
        for stage, ((cap, costs), tpl) in enumerate(zip(ENH_STAGES, shop_tpls), start=1):
            row = list(tpl)
            row[0], row[2], row[3] = ENH_CATEGORY_KEY, wid, str(stage)
            row[14:22] = _cost_cells(costs)
            row[22], row[23], row[29], row[30], row[31] = START_TIME, "(None)", wid, str(cap), str(REQUIRE_AWAKENING)
            flat[ENH_SHOP][f"{wid}{stage:02d}"] = [row]
        # 五重分类 99 上架本体
        key = shop_key(w)
        row = list(body_tpl)
        # c9 list_order：客户端默认按 list_order 倒序、同序再按商品 ID 升序（BossCoinExchangeSorter
        # orderDirection 0）。写 0（官方已有 13 行先例）让原有 990099002/001 留在顶部，诅咒武器按编号排其后。
        row[6], row[9] = w.name, "0"
        row[10] = _shop_description(w)
        row[12] = w.icon
        row[17:25] = _cost_cells(BODY_COSTS)
        row[25], row[26], row[28] = START_TIME, END_TIME, str(BODY_STOCK)
        row[32], row[33], row[34] = "4", wid, "1"
        flat[BOSS_COIN_SHOP][key] = [row]
        # 固有状态 / 文案 / DSL
        for uid, urow in w.uniques.items():
            flat[UNIQUE][uid] = [urow]
        for sid, text in w.cas.items():
            flat[CAS][sid] = [[text]]
        dsl.update(w.dsl)

    cas_keys = set(read.flat(CAS)) | set(flat[CAS])
    for w in ws:
        for table, logical in ((SOUL_T, SOUL), (EA_T, EA)):
            for index, r in enumerate(flat[logical][w.id]):
                problems += [f"{w.row:02d} {w.name} {table}#{index}: {p}"
                             for p in L.invoke_skill_string_problems(r, cas_keys, table)]
        programs = {r[_col(t, "instant_content", "action_path")]
                    for t, logical in ((SOUL_T, SOUL), (EA_T, EA)) for r in flat[logical][w.id]
                    if r[_col(t, "instant_content", "kind")] == "629"}
        _require(programs == set(w.dsl), f"{w.name} 629 行引用的 DSL 与生成的 DSL 不一致：{programs ^ set(w.dsl)}")

    row = list(cat_tpl)
    row[0], row[1], row[3], row[4], row[5], row[8] = "cursed_weapon", ENH_CATEGORY_KEY, "诅咒武器·觉醒", BANNER, HEADER, START_TIME
    flat[ENH_CATEGORY][ENH_CATEGORY_KEY] = [row]

    for program, tree in dsl.items():
        for check in (dsl_signature_problems, colorless_hit_effect_problems, L.action_dsl_element_problems,
                      L.action_dsl_subject_binding_problems, L.action_dsl_lookup_scope_problems,
                      L.action_dsl_hit_area_target_problems):
            problems += [f"DSL {program}: {p}" for p in check(tree)]

    _check_collisions(read, flat, nested)
    return {
        "flat": flat, "nested": nested, "dsl": dsl, "server": _server_delta(read, ws, flat),
        "problems": problems, "weapons": ws, "capabilities": capabilities,
    }


def _check_collisions(read: LiveReader, flat: dict, nested: dict) -> None:
    for logical, rows in flat.items():
        live = read.flat(logical)
        clash = sorted(set(rows) & set(live))
        _require(not clash, f"{logical} 键已存在：{clash[:5]}")
    for logical, rows in nested.items():
        live = read.nested(logical)
        clash = sorted(set(rows) & set(live))
        _require(not clash, f"{logical} 键已存在：{clash[:5]}")


def _server_delta(read: LiveReader, ws: list[Weapon], flat: dict) -> dict[str, Any]:
    ids = [int(w.id) for w in ws]
    shop = {}
    for key, rows in flat[ENH_SHOP].items():
        r = rows[0]
        costs = [{"id": int(r[i]), "amount": int(r[i + 1])} for i in (14, 16, 18, 20) if r[i] not in ("", "(None)")]
        shop[key] = {"availableFrom": START_TIME, "availableUntil": None, "costs": costs,
                     "enhancementMaxLevel": int(r[30]), "equipmentId": int(r[29]), "groupId": int(r[2]),
                     "requireAwakeningLevel": int(r[31]), "rewards": [], "shopCategoryId": int(r[0]),
                     "stage": int(r[3]), "stock": -1}
    body = {}
    for key, rows in flat[BOSS_COIN_SHOP].items():
        r = rows[0]
        body[key] = {"costs": [{"id": int(r[i]), "amount": int(r[i + 1])} for i in (17, 19) if r[i] not in ("", "(None)")],
                     "rewards": [{"type": 4, "id": int(r[33]), "count": 1}],
                     "availableFrom": START_TIME, "availableUntil": END_TIME, "stock": BODY_STOCK}
    return {
        "equipment_ids.json": ids,
        "equipment_lookup.json": {w.id: {"name": w.name, "rarity": "5", "category": w.category} for w in ws},
        "equipment_max_level.json": {w.id: 5 for w in ws},
        "equipment_element.json": {w.id: w.element_code() for w in ws},
        "item_ids.json": ids,
        "item_sale.json": {w.id: {"category": 5, "sale_price": 500, "sellable": True} for w in ws},
        "equipment_enhancement_shop.json": shop,
        "boss_coin_shop.json": {BOSS_SHOP_CATEGORY: body},
        "boss_coin_shop_item_category_map.json": {key: int(BOSS_SHOP_CATEGORY) for key in body},
    }


# ---------------------------------------------------------------------------
# 设计文档（由同一份规格生成，防止文档与数据漂移）
# ---------------------------------------------------------------------------

def _level_label(e: Eff) -> str:
    if e.learn == e.maxlvl:
        return f"Lv{e.learn}"
    return "Lv1 起" if e.maxlvl == 120 else f"Lv{e.learn}→{e.maxlvl}"


def design_markdown(ws: list[Weapon]) -> str:
    lines = [f"# 诅咒武器 {len(ws)} 把 · 设计与实现", "",
             f"口径（作者 0928）：未强化（本体/满破）只有正面效果且很弱（设计值 × {BASE_SCALE:g}）；强化 1 级起诅咒全额生效；"
             "强化 120 级为最终数值；强化材料全部来自五重决战。",
             f"获取：领主币商店「五重决战」分类，每把 {BODY_COSTS[0][1]} 终式武装图纸 + {BODY_COSTS[1][1]} 深界结晶，库存 {BODY_STOCK}（满破需 5 把）。",
             "强化：装备强化「诅咒武器·觉醒」分类，6 阶（→69 每级 1 结晶 / 70：10 结晶+1 心核 / →98 每级 2 结晶 / 99：10 结晶+2 心核 / "
             "→119 每级 3 结晶+1 心核 / 120：3 心核+2 图纸），需满破。", ""]
    for w in ws:
        el = "/".join({"fire": "火", "water": "水", "thunder": "雷", "wind": "风", "dark": "暗", "light": "光"}[e]
                      for e in w.elements) or "通用"
        lines += [f"## {w.row:02d}. {w.name}（{w.id}，{w.category}，{el}，提案：{w.author}）", "",
                  f"- 外形：{w.look}", f"- 120 级解放：{w.summary_120}", "- 本体（满破为箭头右值）："]
        lines += [f"  - {e.note}" for e in w.soul]
        lines.append("- 强化：")
        lines += [f"  - {_level_label(e)}：{e.note or '（成长/补足）'}" for e in w.ea]
        if w.deviations:
            lines.append("- 与提案原文的偏差：")
            lines += [f"  - {d}" for d in w.deviations]
        lines.append("")
    return "\n".join(lines)
