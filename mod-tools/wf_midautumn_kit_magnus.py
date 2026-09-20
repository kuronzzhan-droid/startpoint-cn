# -*- coding: utf-8 -*-
"""玛格诺斯（119990 ``lion_swordman_moon``）：火 · 用强化弹射打技能伤害。

**rework1（2026-09-21）**——目标面板 ``B/rework1/panel/magnus.json``，施工单
``B/rework1/impl/magnus.md``，原语配方 ``B/rework1/research/{A,B,C}``。

- 队长位授予**特殊强化弹射**（722 + ``power_flip_action`` 三档覆盖树，火共鸣门）：
  赛达「锥形」枪体三档 scale 递增、朝球的飞行方向（EF）、命中点爆克拉莉丝末端圆形爆炸；
- 冲刺强化：422 param0 ``-30%`` 常驻 + ``+245%`` 疾走抵消行（**只写 ability 表**，前置 42 队长）；
- 主技能把上一轮的情娅式骑行段换成**魏虎式光圈**（球上长寿命判定区，按技能伤害结算）；
- 「引擎点火」固有改成 **99 层 / 99999999 帧**，靠 during 134 按层给技能伤害、攻击力与独立乘区；
- PF **命中敌人**（触发 180，CT 0.6 秒）→ 629 追击「引擎之炎」并消耗 1 层；629 行排在 525 之前。

面板文案由 5 个 ``desc_override_*`` 接管（队长技 + 槽 1/2/3/5）；槽 4/6 用客户端自动文案。
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import wf_dsl
import wf_midautumn_kitlib as KL
import wf_midautumn_specs as MS

# ---------------------------------------------------------------- 身份与自有键

CID, CODE = 119990, "lion_swordman_moon"
CID_S = str(CID)
TEMPLATE_ID, TEMPLATE_CODE = 111129, "lion_swordman_playable"
UID = MS.unique_condition_id(CID, 1)                       # "11999001"

PFA = "master/skill/power_flip_action.orderedmap"
PF_KEY = f"{CODE}_pf"
PF_PROGRAMS = tuple(f"battle/action/power_flip/action/override/{PF_KEY}${PF_KEY}_lv{n}"
                    for n in (1, 2, 3))
SPECIAL_PROGRAMS = {n: f"battle/action/power_flip/action/special$special_lv{n}" for n in (1, 2, 3)}
# 官方 special 底座指纹（2026-09-21 实读 .cdn/cn 官方归档）。漂移 ⇒ 底座换了，倍率要重算。
SPECIAL_SHA = {
    1: "569f2082c4633bae7e71610c296d6ab141cfabe1f3c4e5e0034c46dbf3e22961",
    2: "4ed6440b9ded6d435e2c2fb9a640541b2c3fc43c5c0068de41077bab07ad73f2",
    3: "7bebfdd5fc3ff46f2a789f7d631ac02084afa0cd11f4f19f71037f7faba3447d",
}

CHASE_STRING = f"ability_skill_{CODE}_ignite"
SWITCH_STRING = f"change_skill_{CODE}"
PF_STRING = f"override_string_{CODE}_pf"
LEADER_OVERRIDE = f"desc_override_{CODE}"
SLOT_OVERRIDE_SLOTS = (1, 2, 3, 5)
SLOT_OVERRIDE = {slot: f"desc_override_{CODE}_{slot}" for slot in SLOT_OVERRIDE_SLOTS}
VOICE_KEY = f"{CODE}_voice_ready"

CHASE_PROGRAM = f"battle/action/skill/action/ability_skill/{CHASE_STRING}${CHASE_STRING}"
UC_ICON_ROW = f"battle/common/unique_condition/unique_{CODE}_ignition"
UC_ICON_LOGICAL = UC_ICON_ROW + ".png"
UC_ICON_FRAME_DONOR = "battle/common/unique_condition/unique_fire_dragon_zenith.png"

# 母本特效：只引用、不改色 ⇒ 直接引用官方路径，不复制（裁决 §4 / 框架 §10.3）。
DONOR_FX_DIR = f"battle/effect/skill_unique/{TEMPLATE_CODE}"
FLAME = f"{DONOR_FX_DIR}/{TEMPLATE_CODE}_flame"

# 克隆三族（调研卡 C §2）：赛达「锥形」枪体 / 克拉莉丝末端爆炸 / 魏虎光圈
#
# 反馈轮 1（作者原话「泽塔的只要锥形的效果黄色的小方框不要」）：`zeta_lance_hit` / `zeta_lance_end`
# 的主体就是那两块实心黄色六边形（实测 atlas rect `zeta_lance_hit/n` 46×53、`zeta_lance_end/k`
# 46×53 纯 #FFFF00，屏上读作「黄色小方框」）＋一颗橙色光球，**整族不再克隆也不再引用**；
# 三档「逐渐增强」改由同一个锥形 `zeta_lance` 的 scale 递增承担（PF_LANCE_SCALE）。
FX_CLONES = (
    ("lance", "battle/effect/skill_unique/zeta", ("zeta_lance",)),
    ("burst", "battle/effect/skill_unique/clarisse", ("clarisse",)),
    ("aura", "battle/effect/skill_unique/anger_investigator", ("anger_investigator_aura",)),
)
FX_ROOT = f"battle/effect/skill_unique/{CODE}"
ZETA_LANCE = f"{FX_ROOT}/lance/zeta_lance"
CLARISSE = f"{FX_ROOT}/burst/clarisse"
AURA = f"{FX_ROOT}/aura/anger_investigator_aura"

CHASE_DONOR = ("battle/action/skill/action/ability_skill/"
               "ability_skill_fire_dragon_zenith$ability_skill_fire_dragon_zenith")
AURA_DONOR = "battle/action/skill/action/rare5/anger_investigator$anger_investigator_1"

_SKILL_DESC = ("挥舞缠绕着火焰的剑向前方斩劈，对敌人造成火属性伤害／"
               "发动技能后的一段时间内，自身获得光圈效果，对与光圈碰撞到的敌人造成技能伤害／"
               "赋予火属性角色及火属性协力球攻击力提升效果／"
               "强化弹射变为特殊强化弹射时：火焰突进随发动次数分三档逐渐增强，"
               "命中敌人后引爆大范围火焰")

TEXTS = {
    "title": "月下归途的机车骑士",
    "profile": "中秋夜赶着回乡的狮族青年。后座绑着一大包月饼，说是给等门的家人带的。"
               "他把油门拧到底，说这样月亮就追不上他——其实只是怕团圆饭凉了。",
    "leader": "月下全油门",
    "skill1": "月下咆哮·烈焰甩尾",
    "skill2": "月下咆哮·烈焰甩尾＋",
    "desc1": _SKILL_DESC,
    "desc2": _SKILL_DESC,
    "cv": "AI 合成配音",
}

SPEC = {
    "required_capabilities": ("dash-parameter-v1", "panel-description-override-v2"),
    "extra_keys": {
        MS.UNIQUE_CONDITION_LOGICAL: (UID,),
        KL.CAS: (CHASE_STRING, SWITCH_STRING, PF_STRING, LEADER_OVERRIDE,
                 *(SLOT_OVERRIDE[s] for s in SLOT_OVERRIDE_SLOTS)),
        KL.SWITCHED: (VOICE_KEY,),
        PFA: (PF_KEY,),
    },
}

# ---------------------------------------------------------------- 行计划（donor + 逐格改）

# 固有状态：官方 unique_condition[19] unique_fire_dragon_zenith「勇敢之焰」
# c3=99999999 无时间限制 / c4=99 不设上限（作者原话）。c4 写 (None) ＝ 上限 1，叠层机制全死。
UNIQUE_DONOR = "19"
UNIQUE_NAME = "引擎点火"
UNIQUE_FRAMES = "99999999"
UNIQUE_CAP = "99"
UNIQUE_CELLS = {0: f"unique_{CODE}_ignition", 2: UC_ICON_ROW, 3: UNIQUE_FRAMES,
                4: UNIQUE_CAP, 14: CODE}

FIRE_LEADER = {4: "2", 7: "600000", 8: "600000", 9: "Red"}     # leader 前置1 = 火编成≥6
FIRE_ABILITY = {6: "2", 9: "600000", 10: "600000", 11: "Red"}  # ability 前置1 = 火编成≥6

# 队长技 5 行（面板 6 行：2 条冲刺文案对应的 422 行在词条槽 5，见施工单偏离 D-1）
LEADER: tuple[tuple[str, str, dict[int, str], str], ...] = (
    ("141201#1", "official",
     {0: CODE, **FIRE_LEADER, 45: "722", 80: PF_KEY, 81: "1,2,3", 82: PF_STRING},
     "火·编成≥6 时: 自身 强化弹射覆盖"),
    ("111183#1", "official",
     {0: CODE, **FIRE_LEADER, 32: "(None)", 45: "34", 46: "5", 47: "Red",
      49: "100000", 50: "100000"},
     "火·编成≥6 时: 强化弹射≥3 → 赋予全队(火) 技能伤害 100%"),
    ("111183#1", "official",
     {0: CODE, **FIRE_LEADER, 32: "(None)", 45: "32", 46: "5", 47: "Red",
      49: "50000", 50: "50000"},
     "火·编成≥6 时: 强化弹射≥3 → 赋予全队(火) 攻击力 50%"),
    ("111183#2", "official",
     {0: CODE, 46: "0", 47: "", 49: "10000", 50: "10000"},
     "火·编成≥6 时: 强化弹射≥5 → 自身 技能槽 10%"),
    ("111183#3", "official",
     {0: CODE, 25: "2", 26: "", 28: "500000", 29: "500000",
      49: "200000", 50: "200000", 66: UID},
     "火·编成≥6 时: 强化弹射≥5 → 自身 状态固有 200%×1次"),
)

_A = "action_skill"

# 六个词条键。每键 c1（主位限制）与 c2（雕像组）必须全键一致（kitlib.check_ability_key）。
PLAN: dict[int, tuple[tuple[str, str, dict[int, str], str], ...]] = {
    1: (
        ("1111831#0", "official",
         {0: f"{CODE}_1", 1: "true", 2: _A, 6: "0", 11: "", 51: "50000", 52: "50000"},
         "自身 技能槽 50%"),
        ("1111296#0", "official",
         {0: f"{CODE}_1", 1: "true", 2: _A, **FIRE_ABILITY, 70: SWITCH_STRING},
         f"火·编成≥6 时: 自身 切换技能形态[{SWITCH_STRING}]"),
        ("1111833#1", "official",
         {0: f"{CODE}_1", 1: "true", 2: _A, **FIRE_ABILITY,
          30: "300000", 31: "300000", 34: "(None)", 47: "34", 51: "25000", 52: "25000"},
         "火·编成≥6 时: 强化弹射≥3 → 自身 技能伤害 25%"),
    ),
    2: (
        ("1611232#0", "official",
         {0: f"{CODE}_2", 1: "true", 2: _A, **FIRE_ABILITY,
          102: "(None)", 104: UID, 109: "2", 110: "0", 113: "50000", 114: "50000"},
         f"火·编成≥6 时: 持续·状态累积计数固有≥1[固有{UID}] → 自身 技能伤害 50%"),
        ("1611231#1", "official",
         {0: f"{CODE}_2", 1: "true", 2: _A, **FIRE_ABILITY,
          102: "(None)", 104: UID, 109: "0", 110: "0", 113: "50000", 114: "50000"},
         f"火·编成≥6 时: 持续·状态累积计数固有≥1[固有{UID}] → 自身 攻击力 50%"),
    ),
    3: (
        ("1111652#0", "official",
         {0: f"{CODE}_3", 1: "false", 2: _A, **FIRE_ABILITY,
          28: "5", 29: "Red", 51: "300000", 52: "300000", 68: UID},
         "火·编成≥6 时: 技能发动≥1 → 自身 状态固有 300%×1次"),
        # 629：字符串键 c70 + 程序路径 c71；必须排在下面的 525 消耗行之前。
        ("1611053#0", "official",
         {0: f"{CODE}_3", 1: "false", 2: _A, 6: "188", 7: "0", 9: "100000", 10: "100000",
          12: UID, 27: "180", 28: "0", 30: "100000", 31: "100000", 34: "(None)", 35: "36",
          70: CHASE_STRING, 71: CHASE_PROGRAM},
         f"状态计数固有≥1[固有{UID}] 时: 任一敌方强化弹射HitLv1≥1(CT0.6秒) → "
         f"自身 发动技能动作[{CHASE_STRING}]"),
        ("1111652#2", "official",
         {0: f"{CODE}_3", 1: "false", 2: _A, 6: "188", 7: "0", 9: "100000", 10: "100000",
          12: UID, 27: "180", 28: "0", 30: "100000", 31: "100000", 34: "(None)", 35: "36",
          68: UID},
         f"状态计数固有≥1[固有{UID}] 时: 任一敌方强化弹射HitLv1≥1(CT0.6秒) → 自身 消耗固有状态 100%"),
        ("1310323#3", "official",
         {0: f"{CODE}_3", 1: "false", 2: _A, 6: "0", 7: "", 9: "", 10: "",
          98: "0", 100: "500000", 101: "500000", 102: "1", 104: UID,
          109: "411", 110: "0", 111: "", 113: "100000", 114: "100000"},
         f"持续·状态累积计数固有≥5(限1次)[固有{UID}] → 自身 独立乘区技能伤害 100%"),
        ("1310323#2", "official",
         {0: f"{CODE}_3", 1: "false", 2: _A, 6: "0", 7: "", 9: "", 10: "",
          98: "0", 100: "100000", 101: "100000", 102: "(None)", 104: UID,
          109: "411", 110: "5", 111: "Red", 113: "5000", 114: "5000"},
         f"持续·状态累积计数固有≥1[固有{UID}] → 赋予全队(火) 独立乘区技能伤害 5%"),
    ),
    4: (
        ("1111833#1", "official",
         {0: f"{CODE}_4", 1: "true", 2: "attack_common",
          30: "200000", 31: "200000", 47: "32", 51: "30000", 52: "30000"},
         "强化弹射≥2(限10次) → 自身 攻击力 30%"),
        ("1110993#1", "official",
         {0: f"{CODE}_4", 1: "true", 2: "attack_common", 51: "37500", 52: "37500"},
         "强化弹射≥5(限4次) → 自身 技能伤害 37.5%"),
    ),
    5: (
        # kind 694（瞬发独立乘区技能伤害）官方 0 行，只有 live 先例 ⇒ 这一行取 store。
        ("1299925#1", "store",
         {0: f"{CODE}_5", 1: "true", 2: _A, 51: "15000", 52: "15000"},
         "自身 独立乘区技能伤害 15%"),
        ("1110993#2", "official",
         {0: f"{CODE}_5", 1: "true", 2: _A, 51: "5000", 52: "5000"},
         "火·编成≥6 时: 强化弹射≥5(CT15秒) → 自身 技能槽 5%"),
        # 422 冲刺参数：只许 ability 表（队长表写 = C7050），前置 42 Leader ⇒ 只在他当队长时生效。
        # c118 = param_id 必须逐格钉死 "0"：live 里这两个 donor 键各带 4~6 条 422，
        # 记录号会随别的角色改动漂移（2026-09-21 实测 1699885#1 的 param_id 已从 0 漂成 1），
        # 而 describe 回读看不出 param_id ⇒ 只有显式写 0 才不会被别人的改动带偏。
        ("1699885#1", "store",
         {0: f"{CODE}_5", 1: "true", 2: _A, 113: "-30000", 114: "-30000", 118: "0"},
         "队长 时: 持续·HP≤1 → 自身 冲刺参数(可调) -30%"),
        ("1699991#7", "store",
         {0: f"{CODE}_5", 1: "true", 2: _A, 113: "245000", 114: "245000", 118: "0"},
         "队长 时: 持续·状态冲刺 → 自身 冲刺参数(可调) 245%"),
    ),
    6: (
        ("1110996#0", "official",
         {0: f"{CODE}_6", 1: "true", 2: "special", 6: "0", 11: "",
          51: "20000", 52: "20000"},
         "自身 技能槽充能 20%"),
        ("1110013#0", "official",
         {0: f"{CODE}_6", 1: "true", 2: "special", 51: "500000", 52: "500000"},
         "自身 强化弹射连击数↓ 5"),
    ),
}

DASH_PARAM0_BASE = -30000          # 常驻 CD −30%
DASH_PARAM0_SWIFT = 245000         # 3.5 × (1 + (−0.30)) = 2.45 ⇒ Swift 中帧数与非 Swift 相同

MAIN_ICON = " <icon id='main'>  "   # desc_override 会盖掉客户端逐行画的 Ⓜ，主位键必须自带

# 面板字符串（custom_ability_string）。629 / 536 的条目不写数字与时间（裁决 §3）。
CAS_TEXTS = {
    CHASE_STRING: "发动技能「引擎之炎」：在命中点引爆积蓄的引擎火焰，造成火属性伤害（以技能伤害计算）",
    SWITCH_STRING: "强化『月下咆哮·烈焰甩尾』：光环的范围扩大",
    PF_STRING: "强化弹射变为特殊强化弹射时：火焰突进随发动次数分三档逐渐增强，"
               "命中敌人后引爆大范围火焰",
    LEADER_OVERRIDE: "\n".join((
        "火属性共鸣时，自身的强化弹射变为特殊强化弹射",
        "火属性共鸣时，自身获得冲刺强化效果，冲刺冷却时间－30%",
        "火属性共鸣时，冲刺间隔缩短效果不会让自身的冲刺冷却时间进一步缩短",
        "火属性共鸣时，每发动3次强化弹射，火属性角色技能伤害＋100%、攻击力＋50%",
        "火属性共鸣时，每发动5次强化弹射，自身技能槽＋10%",
        "火属性共鸣时，每发动5次强化弹射，自身引擎点火＋2层",
    )),
    SLOT_OVERRIDE[1]: "\n".join((
        "战斗开始时，自身技能槽＋50%",
        "火属性共鸣时，强化自身技能：光环范围扩大，自身技能伤害随强化弹射次数按层叠加提升",
    )),
    SLOT_OVERRIDE[2]: "火属性共鸣时，引擎点火每提升1层，自身技能伤害＋50%、攻击力＋50%",
    SLOT_OVERRIDE[3]: "\n".join(MAIN_ICON + line for line in (
        "火属性共鸣时，火属性角色发动技能时，自身引擎点火＋3层",
        "自身处于「引擎点火」期间，强化弹射命中敌人时，发动「引擎之炎」：造成技能伤害",
        "自身处于「引擎点火」期间，强化弹射命中敌人时，消耗1层「引擎点火」",
        "自身引擎点火在5层以上时：自身技能伤害额外乘区＋100%",
        "自身引擎点火每提升1层，火属性角色技能伤害额外乘区＋5%",
    )),
    SLOT_OVERRIDE[5]: "\n".join((
        "自身独立乘区技能伤害＋15%",
        "火属性共鸣时，每发动5次强化弹射，自身技能槽＋5%（冷却时间：15秒）",
    )),
}
SKILL_FLAG_TEXT_KEYS = (CHASE_STRING, SWITCH_STRING)

# action_skill c4/c5/c6（作者放行第 5 条：两档都写 600）
ENERGY = {"1": ("600", "600", "1"), "2": ("600", "600", "1")}

# 语音路由：kind 1 ConditionExist（引擎点火）。kind 3 会因 536 常驻而让 skill_ready 永不播。
VOICE_ROUTE = {"kind": 1, "condition_kind": "28", "condition_id": UID}

# ---- DSL 旋钮 ----------------------------------------------------------------
AURA_FRAMES = 600
# 光圈「画出来的环」与「判定圆」必须等大，否则玩家看到环压住敌人却不掉血
# （反馈轮 1 作者原话「光环稍微小一点，而且没有碰撞到的技能伤害」）。
# 实测（`_donor/anger_investigator/*`，脚本见 W/impl/magnus.md「反馈轮 1」）：
#   `anger_investigator_aura` 的 4 张子图最大 rect 宽 68px，parts 矩阵最大线性缩放 1.9517
#   ⇒ 屏上直径 = 68 × 1.9517 × ShowEffect scale = 132.71 × scale。
# 官方魏虎的 scale 3.75 ⇒ 环半径 248.8，而判定只有 Circle 200 —— 外圈 48.8px 是纯装饰。
AURA_RING_PX_PER_SCALE = 68 * 1.9517  # 132.71 px/scale（母本 rect × parts 矩阵，实测）
AURA_RADIUS = {"1": 200, "2": 270}    # 判定圆半径不动（缩的是画面，不是强度）


def aura_scale(radius: int) -> float:
    """把 ShowEffect scale 反算成「环刚好压在判定圆上」，禁止再手写魔数。"""
    return round(2 * radius / AURA_RING_PX_PER_SCALE, 2)


AURA_MULTIPLIER = {"1": 4.0, "2": 5.5}
AURA_TUNING = {                       # 档 → (ShowEffect scale, 判定圆半径, 每跳倍率)
    level: (aura_scale(AURA_RADIUS[level]), AURA_RADIUS[level], AURA_MULTIPLIER[level])
    for level in ("1", "2")
}
# 母本把 p14 写成 CalculatedUsingMaxNumOfHits(10)，客户端据此推出的最小间隔是
# lifetime/(N-0.5) = 600/9.5 ≈ 63 帧 —— 球只是擦过敌人时，第二跳往后几乎全被这道闸吃掉。
# 改成显式 30 帧（live 杰拉德 149999 同族光环用的就是 SpecifyMinHitIntervalDirectly），
# p15 的每目标硬上限仍是 10 跳 ⇒ 单次技能的总伤不变，只是更快打完、看得见。
AURA_HIT_INTERVAL = 30
AURA_MAX_HITS = 10
AURA_BINDS = (10, 11, 12)             # 母本 111129 自己占 0–5
CHASE_MULT = 3.0
BURST_SCALE = 6.5                     # 克拉莉丝演出缩放（母本 clarisse_1 是 5，火龙树是 4）
BURST_RADIUS = 330                    # 「范围增大一些」：250/200 → 330
BURST_MAX_HITS = 5
PF_SCALE = 2.0                        # 官方 special 合计 5 / 7.667 / 13 ⇒ 10 / 15.33 / 26
PF_SUPPRESS = 90                      # 底座 SetPowerFilpSuppress
# 反馈轮 1：三档只留锥形本体，靠 scale 递增表达「逐渐增强」（不再叠 hit/end 的黄色六边形）。
PF_LANCE_SCALE = {1: 1.0, 2: 1.4, 3: 1.8}
# 锥形朝向：官方赛达 `zeta$zeta_1` 就是 `ShowEffect zeta_lance, 主体 -18(球), 坐标系 ["EF"]`；
# `BallImpl.getDirEF()` 直接返回球的飞行角（`getDirCD()` 才是 throw）。底座 special 的
# オーラ演出写的是 AB（绝对坐标、角度恒 0）⇒ 枪体恒定朝上，这就是作者说的「现在恒定朝上」。
PF_LANCE_COORD = ["EF"]

# 克拉莉丝末端裁段（调研卡 C §2.2 落法 A）：母本漂移即拒绝
CLARISSE_TOTAL = 157
CLARISSE_CUT = 78
CLARISSE_ROOT_R = 1073741824
CLARISSE_NEW_R = (1 << 30) | CLARISSE_CUT
CLARISSE_NEW_T = CLARISSE_TOTAL - CLARISSE_CUT


class KitError(KL.KitError):
    pass


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------- 设计稿对账

def _design(ctx) -> dict[str, Any] | None:
    path = ctx.pack.batch_dir / "design" / "magnus.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _norm_cells(cells: Any) -> dict[int, str]:
    return {int(k): ("" if v is None else str(v)) for k, v in dict(cells or {}).items()}


def _design_problems(design: dict[str, Any]) -> list[str]:
    """kit 的行计划与设计稿 ``plan_rework1`` 逐项对账（donor / source / cells / 预期面板文案）。"""
    problems: list[str] = []
    plan = design.get("plan_rework1")
    if not plan:
        return ["design/magnus.json lacks the plan_rework1 block"]

    def cmp(label: str, got: tuple[str, str, dict[int, str], str], want: dict[str, Any]) -> None:
        donor, source, cells, expect = got
        if donor != want.get("donor"):
            problems.append(f"{label}: donor {donor!r} != design {want.get('donor')!r}")
        if source != want.get("source"):
            problems.append(f"{label}: source {source!r} != design {want.get('source')!r}")
        if _norm_cells(cells) != _norm_cells(want.get("cells")):
            problems.append(f"{label}: cells differ from design")
        if expect != want.get("desc_expected"):
            problems.append(f"{label}: desc {expect!r} != design {want.get('desc_expected')!r}")

    rows = plan.get("leader_ability", {}).get("rows", [])
    if len(rows) != len(LEADER):
        problems.append(f"leader row count {len(LEADER)} != design {len(rows)}")
    for index, (got, want) in enumerate(zip(LEADER, rows)):
        cmp(f"leader#{index}", got, want)

    keys = plan.get("ability", {}).get("keys", {})
    for slot, records in PLAN.items():
        want_block = keys.get(f"{CID}{slot}")
        if want_block is None:
            problems.append(f"ability {CID}{slot}: missing from design")
            continue
        want_records = want_block.get("records", [])
        if len(want_records) != len(records):
            problems.append(f"ability {CID}{slot}: {len(records)} records != design {len(want_records)}")
        for index, (got, want) in enumerate(zip(records, want_records)):
            cmp(f"ability {CID}{slot}#{index}", got, want)

    add = plan.get("unique_conditions", {}).get("add", [])
    if len(add) != 1 or add[0].get("key") != UID:
        problems.append(f"unique_conditions design block unexpected: {[a.get('key') for a in add]}")
    elif _norm_cells(add[0].get("cells")) != _norm_cells(UNIQUE_CELLS):
        problems.append("unique cells differ from design")

    energy = plan.get("skills", {}).get("energy", {})
    for level in ("1", "2"):
        want = tuple(str(x) for x in energy.get(f"level{level}", ()))
        if want != ENERGY[level]:
            problems.append(f"energy level{level} {ENERGY[level]} != design {want}")

    cas = {row.get("key"): row.get("text")
           for row in plan.get("texts", {}).get("custom_ability_string", {}).get("rows", [])}
    for key, text in CAS_TEXTS.items():
        if cas.get(key) != text:
            problems.append(f"custom_ability_string {key}: text differs from design")

    pf = plan.get("pf_override", {})
    if pf.get("key") != PF_KEY or list(pf.get("programs", ())) != list(PF_PROGRAMS):
        problems.append("power_flip_action design block drift")

    route = design.get("voice", {}).get("route", {})
    if {str(k): str(v) for k, v in route.items()} != {str(k): str(v) for k, v in VOICE_ROUTE.items()}:
        problems.append(f"voice route {VOICE_ROUTE} != design {route}")
    return problems


# ---------------------------------------------------------------- 固有状态 + 图标

def build_unique(ctx) -> tuple[str, list[str]]:
    key, row = KL.unique_row(ctx, ctx.spec, 1, UNIQUE_DONOR, UNIQUE_CELLS, name=UNIQUE_NAME)
    if key != UID:
        raise KitError(f"unique id {key} != {UID}")
    if row[3] != UNIQUE_FRAMES or row[4] != UNIQUE_CAP:
        raise KitError(f"unique duration/cap unexpected: c3={row[3]!r} c4={row[4]!r}")
    KL.write_unique(ctx, ctx.spec, {key: row})
    return key, row


def draw_icon(frame):
    """48×48「引擎点火」：夜黑圆角底 + 金边，上弦月剪影，凹侧一簇火苗。

    与 seasonal7 同工艺：8× 画布绘制 → LANCZOS 缩回 48×48 → 用官方图标的 alpha 当外框
    （alpha 一格不改，避免图集 alpha 门禁变红）。
    """
    from PIL import Image, ImageDraw
    if frame.size != (48, 48):
        raise KitError(f"icon frame donor must be 48x48, got {frame.size}")
    K = 8
    N = 48 * K
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    inner = Image.new("L", (N, N), 0)
    ImageDraw.Draw(inner).rounded_rectangle((3 * K, 3 * K, 45 * K - 1, 45 * K - 1),
                                            radius=5 * K, fill=255)
    top, bot = (36, 30, 44), (18, 14, 22)
    grad = Image.new("RGBA", (1, N))
    for y in range(N):
        t = y / (N - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    layer.paste(grad.resize((N, N)), (0, 0), inner)

    gold, moon = (216, 150, 58, 255), (242, 212, 121, 255)
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((4 * K, 4 * K, 44 * K - 1, 44 * K - 1), radius=4 * K,
                        outline=gold, width=2 * K)

    # 上弦月：大圆减去偏右上的小圆，凹侧朝右下
    disc = Image.new("L", (N, N), 0)
    ImageDraw.Draw(disc).ellipse((8.5 * K, 9.5 * K, 31.5 * K, 32.5 * K), fill=255)
    cut = Image.new("L", (N, N), 0)
    ImageDraw.Draw(cut).ellipse((15.0 * K, 6.5 * K, 38.0 * K, 29.5 * K), fill=255)
    crescent = Image.composite(Image.new("L", (N, N), 0), disc, cut)
    layer.paste(Image.new("RGBA", (N, N), moon), (0, 0),
                Image.composite(crescent, Image.new("L", (N, N), 0), inner))

    # 火苗：外焰 #FF8A3C → 内焰 #FFE08A（竖向渐变，走蒙版）
    outer = [(31.0, 20.0), (35.6, 27.2), (36.4, 32.6), (33.6, 37.8), (28.4, 38.4),
             (25.0, 34.6), (25.6, 29.6), (28.4, 25.6), (29.4, 28.2)]
    flame = Image.new("L", (N, N), 0)
    ImageDraw.Draw(flame).polygon([(x * K, y * K) for x, y in outer], fill=255)
    fgrad = Image.new("RGBA", (1, N))
    lo, hi = (255, 138, 60), (255, 224, 138)
    for y in range(N):
        t = max(0.0, min(1.0, (y / (N - 1) - 0.40) / 0.45))
        fgrad.putpixel((0, y), tuple(round(lo[i] + (hi[i] - lo[i]) * (1 - t)) for i in range(3)) + (255,))
    layer.paste(fgrad.resize((N, N)), (0, 0),
                Image.composite(flame, Image.new("L", (N, N), 0), inner))
    core = [(31.0, 27.0), (33.4, 31.4), (31.6, 35.8), (28.6, 34.4), (28.8, 30.4)]
    ImageDraw.Draw(layer).polygon([(x * K, y * K) for x, y in core], fill=(255, 240, 196, 255))

    small = layer.resize((48, 48), Image.LANCZOS)
    out = Image.new("RGBA", (48, 48), (255, 255, 255, 0))
    fp, op, sp = frame.load(), out.load(), small.load()
    for y in range(48):
        for x in range(48):
            r, g, b, a = sp[x, y]
            fa = fp[x, y][3]
            if a:
                op[x, y] = (round((r * a + 255 * (255 - a)) / 255),
                            round((g * a + 255 * (255 - a)) / 255),
                            round((b * a + 255 * (255 - a)) / 255), fa)
            else:
                op[x, y] = (255, 255, 255, fa)
    return out


def install_unique_icon(ctx) -> dict[str, Any]:
    raw = ctx.official_read(UC_ICON_FRAME_DONOR)
    if raw is None:
        _root, raw, _how = ctx.pack.template_asset(UC_ICON_FRAME_DONOR)
    frame = ctx.png_open(raw)
    data = ctx.png_store_bytes(draw_icon(frame))
    ctx.write_asset("common", UC_ICON_LOGICAL, data)
    back = ctx.png_open(ctx.pack.pkg_path("common", UC_ICON_LOGICAL).read_bytes())
    if back.size != (48, 48):
        raise KitError(f"unique_condition icon must stay 48x48, got {back.size}")
    if back.getchannel("A").tobytes() != frame.getchannel("A").tobytes():
        raise KitError("unique_condition icon alpha differs from the official frame donor")
    return {"logical": UC_ICON_LOGICAL, "frame_donor": UC_ICON_FRAME_DONOR,
            "sha256": _sha256(data), "bytes": len(data)}


# ---------------------------------------------------------------- 词条 / 队长技 / 面板串

def build_rows(ctx) -> dict[str, Any]:
    spec = ctx.spec
    evidence: list[dict[str, Any]] = []
    caps: set[str] = set()

    leader: list[list[str]] = []
    for index, (donor, source, cells, expect) in enumerate(LEADER):
        row, ev = KL.build_row(ctx, "leader_ability", donor, cells, source=source,
                               element=spec.element, expect_describe=expect,
                               label=f"leader#{index}")
        leader.append(row)
        evidence.append(ev)
        caps.update(ev["capabilities"])
    if any(r[0] != CODE for r in leader):
        raise KitError(f"leader c0 must be {CODE}: {[r[0] for r in leader]}")
    _leader_forbidden(leader)

    ability: dict[str, list[list[str]]] = {}
    for slot, records in PLAN.items():
        key = f"{CID}{slot}"
        rows: list[list[str]] = []
        for index, (donor, source, cells, expect) in enumerate(records):
            row, ev = KL.build_row(ctx, "ability", donor, cells, source=source,
                                   element=spec.element, expect_describe=expect,
                                   label=f"{key}#{index}")
            rows.append(row)
            evidence.append(ev)
            caps.update(ev["capabilities"])
        KL.check_ability_key(rows, key, CODE, slot)
        ability[key] = rows

    _order_problems(ability[f"{CID}3"])
    _dash_problems(ability[f"{CID}5"])
    return {"leader": leader, "ability": ability, "evidence": evidence,
            "capabilities": sorted(caps)}


LEADER_FORBIDDEN_KINDS = ("422", "724", "713")


def _leader_forbidden(rows: list[list[str]]) -> None:
    """队长表写 422/724/713 = 角色详情页 C7050（记忆卡 wf-dash-parameter-leader-table-trap）。"""
    bad = [(i, r[45], r[107]) for i, r in enumerate(rows)
           if r[45] in LEADER_FORBIDDEN_KINDS or r[107] in LEADER_FORBIDDEN_KINDS]
    if bad:
        raise KitError(f"leader rows carry a forbidden kind (C7050): {bad}")


def _order_problems(rows: list[list[str]]) -> None:
    """槽 3 的硬顺序契约：629 发动追击必须排在同触发的 525 消耗行之前（记忆卡 R3）。

    顺序反了 ⇒ 最后一层先被吃掉，最后一次强化弹射打不出追击。
    """
    kinds = [row[47] for row in rows]
    if "629" not in kinds or "525" not in kinds:
        raise KitError(f"ability slot 3 lost the 629/525 pair: {kinds}")
    if kinds.index("629") > kinds.index("525"):
        raise KitError(f"629 must precede the 525 consume row, got {kinds}")
    invoke, consume = rows[kinds.index("629")], rows[kinds.index("525")]
    for col, what in ((27, "trigger kind"), (30, "threshold"), (31, "threshold"),
                      (34, "trigger limit"), (35, "cooldown")):
        if invoke[col] != consume[col]:
            raise KitError(f"629/525 {what} differ at c{col}: {invoke[col]!r} vs {consume[col]!r}")
    if invoke[6] != consume[6] or invoke[12] != consume[12]:
        raise KitError("629/525 preconditions differ; both must gate on the same unique condition")


def _dash_problems(rows: list[list[str]]) -> None:
    """422 行契约：前置 42 队长、param_id 显式写 '0'、两条强度就是抵消公式的两端。"""
    dash = [r for r in rows if r[109] == "422"]
    if len(dash) != 2:
        raise KitError(f"slot 5 must carry exactly 2 dash rows, got {len(dash)}")
    for row in dash:
        if row[6] != "42":
            raise KitError(f"422 row must gate on precondition 42 (Leader), got {row[6]!r}")
        if row[118] != "0":
            raise KitError(f"422 param_id must be an explicit '0', got {row[118]!r}")
    strengths = sorted(int(r[113]) for r in dash)
    if strengths != sorted((DASH_PARAM0_BASE, DASH_PARAM0_SWIFT)):
        raise KitError(f"dash strengths {strengths} differ from the offset formula")
    # 3.5 × (1 + s0) —— 非 Swift 90×(1+s0) 帧与 Swift 中 20×(1+s0+m) 帧相等
    want = round(3.5 * (1 + DASH_PARAM0_BASE / 100000) * 100000)
    if DASH_PARAM0_SWIFT != want:
        raise KitError(f"swift offset {DASH_PARAM0_SWIFT} != 3.5×(1+s0) = {want}")


def write_strings(ctx) -> dict[str, str]:
    """custom_ability_string：629 / 536 / 722 条目 + 5 个 desc_override。"""
    declared = set(ctx.spec.extra_keys.get(KL.CAS, ()))
    missing = [key for key in CAS_TEXTS if key not in declared]
    if missing:
        raise KitError(f"custom_ability_string keys not declared in SPEC['extra_keys']: {missing}")
    for key, text in CAS_TEXTS.items():
        for line in text.split("\n"):
            KL.check_panel(line.replace(MAIN_ICON, ""),
                           skill_flag=key in SKILL_FLAG_TEXT_KEYS, label=key)
    for slot in SLOT_OVERRIDE_SLOTS:
        rendered = CAS_TEXTS[SLOT_OVERRIDE[slot]].split("\n")
        wants_icon = PLAN[slot][0][2].get(1) == "false"
        if any(line.startswith(MAIN_ICON) != wants_icon for line in rendered):
            raise KitError(f"slot {slot} desc_override main-position icon does not match c1")
    official = ctx.official_flat(KL.CAS)
    clashes = [key for key in CAS_TEXTS if key in official]
    if clashes:
        raise KitError(f"custom_ability_string keys already exist officially: {clashes}")
    ctx.write_flat(KL.CAS, {key: [[text]] for key, text in CAS_TEXTS.items()})
    return dict(CAS_TEXTS)


# ---------------------------------------------------------------- 语音路由

def write_voice_route(ctx) -> list[str]:
    import wf_seasonal7_voice as V
    cols = KL.voice_route(CODE, VOICE_ROUTE)
    if cols != ["1", "28", UID, "", "", VOICE_KEY, "false", "false"]:
        raise KitError(f"unexpected voice route columns: {cols}")
    row = ctx.csv_split(ctx.pkg_flat(KL.CHARACTER)[CID_S])[0]
    new_row = V.route_character_row(list(row), cols, CODE)
    ctx.write_flat(KL.CHARACTER, {CID_S: [new_row]})
    return cols


# ---------------------------------------------------------------- action_skill

def write_action_skill(ctx) -> dict[str, list[str]]:
    inner = ctx.pkg_nested(CODE)
    if set(inner) != {"1", "2"}:
        raise KitError(f"package action_skill inner keys {sorted(inner)}")
    out: dict[str, list[str]] = {}
    for level, cells in sorted(inner.items()):
        cells = list(cells)
        if len(cells) != 24:
            raise KitError(f"action_skill {level} has {len(cells)} columns, expected 24")
        if cells[7] != ctx.program_path(level):
            raise KitError(f"action_skill {level} program path {cells[7]!r} unexpected")
        if cells[0] != TEXTS[f"skill{level}"] or cells[1] != TEXTS[f"desc{level}"]:
            raise KitError(f"action_skill {level} name/desc differ from TEXTS (rerun tables)")
        if cells[2] != "dynamic/skill/atk_front":
            raise KitError(f"action_skill {level} auto-cast target {cells[2]!r} differs from the template")
        cells[4], cells[5], cells[6] = ENERGY[level]
        out[level] = cells
    ctx.write_nested(KL.ACTION, CODE, {lv: [cells] for lv, cells in out.items()},
                     replace_inner=True)
    return out


# ---------------------------------------------------------------- 特效克隆 + 染色 + parts 手术

def fx_lut_path(ctx) -> Path | None:
    """特效染色 LUT：特效素材代理交付到 ``W/fx/magnus/``；缺文件就不染色，照常克隆。"""
    batch = ctx.pack.batch_dir
    for candidate in (batch / "rework1" / "fx" / "magnus" / "fx_lut.json",
                      batch / "fx" / "magnus" / "fx_lut.json",
                      KL.pixel_dir(ctx) / "fx_lut.json"):
        if candidate.is_file():
            return candidate
    return None


def fx_transforms(ctx) -> tuple[Path | None, dict[str, Any]]:
    """把交付的 LUT 拆成 {donor 族名: png_transform}。

    交付件有两种形状：单族的裸 ``ma-fx-lut/1``（对三族统一套用），或特效代理用的
    ``{"families": {"<donor>": <ma-fx-lut/1>, …}}`` 合集（每族一份）。
    ``KL.png_transform_from_lut`` 只吃文件，所以合集会先拆进 workspace 的 evidence 目录。
    """
    lut = fx_lut_path(ctx)
    if lut is None:
        return None, {}
    data = json.loads(lut.read_text(encoding="utf-8"))
    if data.get("schema") == KL.LUT_SCHEMA:
        shared = KL.png_transform_from_lut(lut)
        return lut, {src.rsplit("/", 1)[-1]: shared for _sub, src, _n in FX_CLONES}
    families = data.get("families")
    if not isinstance(families, dict):
        raise KitError(f"unrecognised fx_lut shape (no schema, no families): {lut}")
    out: dict[str, Any] = {}
    target = ctx.pack.evidence / "fx"
    target.mkdir(parents=True, exist_ok=True)
    for _sub, src_dir, _names in FX_CLONES:
        donor = src_dir.rsplit("/", 1)[-1]
        block = families.get(donor)
        if block is None:
            continue
        split = target / f"fx_lut_{donor}.json"
        split.write_text(json.dumps(block, ensure_ascii=False, indent=1) + "\n",
                         encoding="utf-8")
        out[donor] = KL.png_transform_from_lut(split)
    if not out:
        raise KitError(f"fx_lut {lut} carries none of the three donor families")
    return lut, out


def clone_effects(ctx):
    lut, transforms = fx_transforms(ctx)
    families: dict[str, Any] = {}
    for subdir, src_dir, names in FX_CLONES:
        donor = src_dir.rsplit("/", 1)[-1]
        fam = ctx.clone_effect_family(src_dir, subdir, list(names),
                                      layout="codename",
                                      png_transform=transforms.get(donor))
        missing = list(fam.get("missing_effects") or ())
        if missing:
            raise KitError(f"effect family {src_dir} missing bases {missing}")
        if sorted(fam.get("copied_bases") or ()) != sorted(names):
            raise KitError(f"effect family {src_dir} copied {fam.get('copied_bases')} != {names}")
        families[subdir] = fam
    surgery = cut_clarisse_tail(ctx, families["burst"])
    return {"lut": str(lut) if lut is not None else None,
            "recolored": sorted(transforms),
            "families": {k: {"src_dir": v["src_dir"], "dst_dir": v["dst_dir"],
                             "copied_bases": v["copied_bases"],
                             "files": [f["target"] for f in v["files"]]}
                         for k, v in families.items()},
            "clarisse_tail": surgery}, families


def _pkg_amf(ctx, root: str, logical: str):
    return ctx.amf_parse(ctx.pack.pkg_path(root, logical).read_bytes())


def cut_clarisse_tail(ctx, family) -> dict[str, Any]:
    """只留克拉莉丝的末端圆形爆炸（调研卡 C §2.2 落法 A：改 3 个数字，零结构手术）。

    ``clone_effect_family`` 只有 ``png_transform`` 钩子、没有 parts 钩子 ⇒ 手术必须在 clone
    之后重新施加，否则每次 ``--step kit`` 都会被官方母本冲掉（09-16 特克托激光的教训）。
    母本任何一处漂移都直接拒绝。
    """
    dst = family["dst_dir"]
    root = family["files"][0]["root"]
    parts_logical = f"{dst}/clarisse.parts.amf3.deflate"
    timeline_logical = f"{dst}/clarisse.timeline.amf3.deflate"
    parts = _pkg_amf(ctx, root, parts_logical)
    timeline = _pkg_amf(ctx, root, timeline_logical)

    g0 = parts["g"][0]
    keyframe = g0["s"][0]["l"][0]
    if int(keyframe["r"]) != CLARISSE_ROOT_R or int(keyframe["t"]) != CLARISSE_TOTAL:
        raise KitError(f"clarisse root keyframe drift: r={keyframe['r']} t={keyframe['t']}")
    if int(g0["t"]) != CLARISSE_TOTAL or len(g0["s"]) != 1:
        raise KitError(f"clarisse root group drift: t={g0['t']} segments={len(g0['s'])}")
    seq = timeline["sequences"]
    if len(seq) != 1 or seq[0]["begin"] != 1 or int(seq[0]["end"]) != CLARISSE_TOTAL:
        raise KitError(f"clarisse timeline drift: {seq}")

    keyframe["r"] = float(CLARISSE_NEW_R)      # kind=1（播一次），起始帧 78
    keyframe["t"] = CLARISSE_NEW_T
    g0["t"] = CLARISSE_NEW_T
    seq[0]["end"] = CLARISSE_NEW_T             # begin 保持 1

    for logical, tree in ((parts_logical, parts), (timeline_logical, timeline)):
        data = ctx.amf_bytes(tree)
        ctx.write_asset(root, logical, data)
        if _pkg_amf(ctx, root, logical) != tree:
            raise KitError(f"{logical} readback differs from the written tree")
    return {"start_frame": CLARISSE_CUT, "frames": CLARISSE_NEW_T,
            "r": CLARISSE_NEW_R, "files": [parts_logical, timeline_logical]}


# ---------------------------------------------------------------- DSL 工具

def _commands(tree, name: str | None = None) -> list[list]:
    return list(wf_dsl.iter_dsl_commands(tree, name) if name
                else wf_dsl.iter_dsl_commands(tree))


def _declared_ids(tree) -> list[int]:
    """树里声明的绑定 id：RP c10、CreateHitArea c19/c21/c22、FindAllSubjects c1。"""
    ids: list[int] = []
    for c in _commands(tree):
        if c[0] == "CreateReferencePoint":
            ids.append(c[10])
        elif c[0] == "CreateHitArea":
            ids.extend((c[19], c[21], c[22]))
        elif c[0] == "FindAllSubjects":
            ids.append(c[1])
    return ids


def _only(items: list, what: str) -> Any:
    if len(items) != 1:
        raise KitError(f"expected exactly 1 {what}, got {len(items)}")
    return items[0]


def _slv(value: float) -> list[dict[str, float]]:
    return [{"min": value, "max": value}]


def _rewrite(ctx, tree, families) -> Any:
    for fam in families.values():
        tree, _info = ctx.rewrite_effect_refs(tree, fam)
    return tree


# ---------------------------------------------------------------- 主技能：魏虎式光圈

def aura_block(ctx, level: str) -> tuple[list[list], dict[str, Any]]:
    """从魏虎 111105 的技能树里摘出「球上光圈 + 长寿命碰撞判定」整块（调研卡 C §2.3）。

    官方原块里的 ``ACToleranceOfElement``（火耐性↓）丢掉——目标面板没有这一条；
    命中特效换引擎内置 ``Fine`` ⇒ 只需克隆 ``_aura`` 一个基名。
    """
    donor = ctx.template_dsl(AURA_DONOR)
    show = _only([c for c in _commands(donor, "ShowEffect")
                  if str(c[2][1]).endswith("_aura")], "anger_investigator aura ShowEffect")
    area = _only([c for c in _commands(donor, "CreateHitArea") if c[2] == -18],
                 "anger_investigator ball hit area")
    if show[3] != -18 or show[6] != ["AB"] or area[3] != ["AB"]:
        raise KitError(f"anger_investigator aura donor drift: subject={show[3]} coord={show[6]}/{area[3]}")
    if (area[19], area[21], area[22]) != (0, 1, 2) or area[24] != 0:
        raise KitError(f"anger_investigator hit-area binds drift: {area[19:25]}")
    # 命中跳数/寿命/跟随球这三格是「碰到就打」的命门：母本漂移就别继续往下改
    if area[7] is not True or area[13] != ["SpecifyHitAreaLifetimeDirectly", 600]:
        raise KitError(f"anger_investigator hit-area tracking/lifetime drift: {area[7]} {area[13]}")
    if area[14][0] != "CalculatedUsingMaxNumOfHits" or area[15][0] != "Some":
        raise KitError(f"anger_investigator hit accounting drift: {area[14]} {area[15]}")

    show, area = copy.deepcopy(show), copy.deepcopy(area)
    scale, radius, mult = AURA_TUNING[level]
    show[1] = "aura_ring"
    show[5] = ["SpecifyEffectLifetimeDirectly", AURA_FRAMES]
    show[12] = ["Some", _slv(scale)]

    area[9] = ["Circle", _slv(radius)]
    area[13] = ["SpecifyHitAreaLifetimeDirectly", AURA_FRAMES]
    # 母本的 CalculatedUsingMaxNumOfHits(10) 会被客户端换算成 600/9.5≈63 帧的最小间隔；
    # 显式写 30 帧，每目标硬上限仍由 p15 管（总跳数不变，见 AURA_HIT_INTERVAL 注释）。
    area[14] = ["SpecifyMinHitIntervalDirectly", AURA_HIT_INTERVAL]
    area[15] = ["Some", _slv(AURA_MAX_HITS)]
    area[19], area[21], area[22] = AURA_BINDS
    body = area[23][1]
    keep = [n for n in body
            if not (n[0] == "Command" and n[1][0] == "CreateCondition")]
    if len(keep) != len(body) - 1:
        raise KitError(f"aura on-hit block shape drift ({len(body)} → {len(keep)})")
    area[23][1][:] = keep
    cna = _only(_commands(area, "CreateNormalAttack"), "aura CreateNormalAttack")
    cna[1] = AURA_BINDS[2]
    cna[6] = _slv(mult)
    cna[15] = ["Fine"]
    if area[24] != 0:
        raise KitError("aura hit area p24 must stay 0")
    if cna[1] != area[22]:
        raise KitError(f"aura CNA target {cna[1]} must be the hit-area p22 bind {area[22]}")
    return ([["Command", show], ["Command", area]],
            {"scale": scale, "radius": radius, "multiplier": mult,
             "ring_diameter_px": round(AURA_RING_PX_PER_SCALE * scale, 1),
             "hit_interval": AURA_HIT_INTERVAL, "max_hits": AURA_MAX_HITS,
             "lifetime": AURA_FRAMES, "binds": list(AURA_BINDS)})


def build_main_tree(ctx, level: str, families) -> tuple[Any, dict[str, Any]]:
    template_program = ctx.program_path(level).replace(CODE, TEMPLATE_CODE)
    tree = copy.deepcopy(ctx.template_dsl(template_program))
    before = _declared_ids(tree)
    if sorted(before) != [0, 1, 2, 3, 4, 5]:
        raise KitError(f"template {template_program} declares ids {sorted(before)}, expected 0..5")
    if tree[10] != 0:
        raise KitError(f"template root buffTargetAs {tree[10]} != 0 (skill-damage attribution)")

    block, meta = aura_block(ctx, level)
    root = tree[11]
    positions = [i for i, node in enumerate(root[1])
                 if isinstance(node, list) and node[0] == "Command"
                 and node[1][0] == "CreateReferencePoint"]
    if len(positions) != 1:
        raise KitError(f"template root has {len(positions)} CreateReferencePoint commands")
    root[1][positions[0] + 1:positions[0] + 1] = block

    ids = _declared_ids(tree)
    if len(ids) != len(set(ids)):
        raise KitError(f"merged tree binding ids not unique: {sorted(ids)}")
    if set(AURA_BINDS) - set(ids):
        raise KitError(f"aura binds lost during the merge: {sorted(ids)}")
    sword = [c for c in _commands(tree, "CreateNormalAttack") if c[6][0].get("max", 0) > 10]
    if len(sword) != 1:
        raise KitError(f"expected exactly 1 main-slash CreateNormalAttack, got {len(sword)}")
    tree = _rewrite(ctx, tree, families)
    if AURA not in _effect_paths(tree):
        raise KitError("main tree lost the cloned aura reference after rewrite_effect_refs")
    return tree, {"level": level, "aura": meta, "slash": dict(sword[0][6][0]),
                  "root_commands": [n[1][0] if n[0] == "Command" else n[1][0]
                                    for n in tree[11][1]]}


# ---------------------------------------------------------------- 629 追击「引擎之炎」

def build_chase_tree(ctx, families) -> tuple[Any, dict[str, Any]]:
    """官方火龙 ability_skill 原树：球身光环留母本 ``_flame``，命中点爆炸换裁段后的克拉莉丝。

    根头 ``tree[10]=0`` 保持不动：629 以 AbilitySkill 执行 ⇒ 自动按**技能伤害**结算
    （记忆卡 wf-dsl-damage-attribution-bufftargetas）。写 2 会被掰成能力伤害，那是卖点的反面。
    """
    tree = copy.deepcopy(ctx.template_dsl(CHASE_DONOR))
    if tree[10] != 0:
        raise KitError(f"chase donor root buffTargetAs {tree[10]} != 0")
    effects = _commands(tree, "ShowEffect")
    if len(effects) != 2:
        raise KitError(f"chase donor should carry 2 ShowEffect, got {len(effects)}")
    names = []
    for show in effects:
        aura = str(show[2][1]).endswith("_player")
        show[1] = "ignite_aura" if aura else "ignite_burst"
        if aura:
            if show[5] != ["SpecifyEffectLifetimeDirectly", 100]:
                raise KitError(f"chase aura lifetime {show[5]} differs from the donor")
            show[2] = ["SpecifyEffectDirectly", FLAME]     # 母本件，直接引用官方路径
            show[5] = ["PlayOnlyFirstSequence"]            # _flame 是 once/70 帧
        else:
            if show[5] != ["SpecifyEffectLifetimeDirectly", 30]:
                raise KitError(f"chase burst lifetime {show[5]} differs from the donor")
            show[2] = ["SpecifyEffectDirectly", CLARISSE]
            show[5] = ["SpecifyEffectLifetimeDirectly", CLARISSE_NEW_T]
            show[12] = ["Some", _slv(BURST_SCALE)]
        if show[6] not in (["AB"], ["GH"]):
            raise KitError(f"chase ShowEffect coord system {show[6]} must stay AB/GH")
        names.append(show[1])
    if sorted(names) != ["ignite_aura", "ignite_burst"]:
        raise KitError(f"chase effect names unexpected: {names}")
    for hide in _commands(tree, "HideEffect"):
        hide[1] = "ignite_aura"
    cna = _only(_commands(tree, "CreateNormalAttack"), "chase CreateNormalAttack")
    cna[6] = _slv(CHASE_MULT)
    areas = _commands(tree, "CreateHitArea")
    if len(areas) != 2:
        raise KitError(f"chase donor should carry 2 CreateHitArea, got {len(areas)}")
    burst = _only([a for a in areas if a[9][1][0]["max"] == 250], "chase burst hit area")
    burst[9] = ["Circle", _slv(BURST_RADIUS)]
    if burst[14][0] != "CalculatedUsingMaxNumOfHits":
        raise KitError(f"chase burst hit accounting drift: {burst[14]}")
    burst[14] = ["CalculatedUsingMaxNumOfHits", BURST_MAX_HITS]
    tree = _rewrite(ctx, tree, families)
    return tree, {"multiplier": CHASE_MULT, "burst_scale": BURST_SCALE,
                  "burst_radius": BURST_RADIUS, "burst_max_hits": BURST_MAX_HITS,
                  "hit_areas": [[a[9], a[13], a[14]] for a in _commands(tree, "CreateHitArea")]}


# ---------------------------------------------------------------- 722 特殊强化弹射

def build_pf_tree(ctx, level: int, families) -> tuple[Any, dict[str, Any]]:
    """官方 ``special_lv{n}`` 整树作底座（sha 锁定）+ 赛达锥形三档 + 克拉莉丝爆炸。

    反馈轮 1：不再有「追踪 boss」那一套（Repeat/FindNearSubjects/MoveBall/RemoveEvent），
    弹道完全是官方 special 底座的原生弹道。
    """
    program = SPECIAL_PROGRAMS[level]
    raw = ctx.official_read(wf_dsl.dsl_logical(program))
    if raw is None:
        raise KitError(f"official baseline lacks the special PF base {program}")
    if _sha256(raw) != SPECIAL_SHA[level]:
        raise KitError(f"special lv{level} base drift: {_sha256(raw)}")
    tree = copy.deepcopy(ctx.template_dsl(program))
    if tree[0] != "ActionDsl" or tree[1] != 1 or tree[10] != 0:
        raise KitError(f"special lv{level} head drift: {tree[:2]} bta={tree[10]}")
    suppress = _only(_commands(tree, "SetPowerFilpSuppress")[:1], "SetPowerFilpSuppress")
    if suppress[1] != PF_SUPPRESS:
        raise KitError(f"special lv{level} suppress {suppress[1]} != {PF_SUPPRESS}")
    if not _commands(tree, "NotifyPowerflipEnd"):
        raise KitError(f"special lv{level} lost NotifyPowerflipEnd (PF 会卡死)")

    root_body = tree[11][1]
    aura_at = [n for n, e in enumerate(root_body)
               if e[0] == "Command" and e[1][0] == "ShowEffect" and e[1][1] == "オーラ演出"]
    if len(aura_at) != 1:
        raise KitError(f"special lv{level} オーラ演出 not unique ({len(aura_at)})")
    aura = root_body[aura_at[0]][1]
    if aura[6] != ["AB"] or aura[3] != -18:
        raise KitError(f"special lv{level} aura subject/coord drift: {aura[3]} {aura[6]}")
    aura[2] = ["SpecifyEffectDirectly", ZETA_LANCE]
    aura[12] = ["Some", _slv(PF_LANCE_SCALE[level])]
    # 朝弹射方向：照抄官方赛达 zeta$zeta_1 的 (-18, ["EF"])。AB 是绝对坐标 ⇒ 恒定朝上。
    aura[6] = list(PF_LANCE_COORD)

    # 命中爆炸：克拉莉丝末端 + 判定圆放大
    bursts = [c for c in _commands(tree, "ShowEffect") if c[1] == "特殊演出"]
    if not bursts:
        raise KitError(f"special lv{level} lost the 特殊演出 burst ShowEffect")
    for show in bursts:
        show[2] = ["SpecifyEffectDirectly", CLARISSE]
        show[5] = ["SpecifyEffectLifetimeDirectly", CLARISSE_NEW_T]
        show[12] = ["Some", _slv(BURST_SCALE)]
        if show[6] != ["AB"]:
            raise KitError(f"special lv{level} burst coord {show[6]} must stay AB")
    radii = []
    for area in _commands(tree, "CreateHitArea"):
        if area[24] != 0:
            raise KitError("PF CreateHitArea p24 must stay 0 (4 = 按直击算，整块 PF 乘区被跳过)")
        if area[9][0] != "Circle":
            raise KitError(f"unexpected PF hit-area shape {area[9][0]}")
        radii.append(area[9][1][0]["max"])
        area[9] = ["Circle", _slv(BURST_RADIUS)]

    scaled = []
    for cna in _commands(tree, "CreateNormalAttack"):
        mult = cna[6]
        if len(mult) != 1 or mult[0]["min"] != mult[0]["max"]:
            raise KitError(f"special lv{level} CNA multiplier shape drift: {mult}")
        value = round(mult[0]["min"] * PF_SCALE, 6)
        cna[6] = _slv(value)
        scaled.append(value)
    if not scaled:
        raise KitError(f"special lv{level} carries no CreateNormalAttack")

    # 反馈轮 1：作者要求去掉「强化弹射追踪 boss」⇒ 底座的弹道原样保留，
    # 不再往 root 挂 Repeat/FindNearSubjects/MoveBall，碰撞块里也没有 RemoveEvent 要清。
    # 这里只留底座形状断言：收尾仍然靠 CollisionOfBallAndEnemy + NotifyPowerflipEnd。
    # 底座自己就带一条 RemoveEvent("ヒット判定")，所以判据是「与底座逐条同名同数」，
    # 不是「一条 RemoveEvent 都不许有」。
    collisions = [n for n in root_body
                  if n[0] == "Event" and n[1][0] == "CollisionOfBallAndEnemy"]
    _only(collisions, "root CollisionOfBallAndEnemy")
    base = ctx.template_dsl(program)
    for name in ("MoveBall", "FindNearSubjects", "RemoveEvent", "Repeat"):
        here = len(_commands(tree, name))
        there = len(_commands(base, name))
        if here != there:
            raise KitError(f"PF lv{level} {name} count {here} != official base {there} "
                           "(反馈轮 1 已去掉追踪，弹道必须与底座一致)")
    if any(n[0] == "Event" and n[1][0] == "Repeat" for n in root_body):
        raise KitError(f"PF lv{level} still carries a Repeat steering event")

    ids = _declared_ids(tree)
    if len(ids) != len(set(ids)):
        raise KitError(f"PF lv{level} binding ids not unique: {sorted(ids)}")
    tree = _rewrite(ctx, tree, families)
    return tree, {"level": level, "multipliers": scaled, "total": round(sum(scaled), 6),
                  "lance_scale": PF_LANCE_SCALE[level],
                  "lance_coord": list(PF_LANCE_COORD), "extra_effects": [],
                  "donor_radii": radii, "burst_radius": BURST_RADIUS, "chase": None}


# ---------------------------------------------------------------- DSL 闸门与落盘

def _effect_paths(tree) -> set[str]:
    return {v for v in (x for x in _walk_strings(tree)) if v.startswith("battle/effect/")}


def _walk_strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, list):
        for child in node:
            yield from _walk_strings(child)
    elif isinstance(node, dict):
        for child in node.values():
            yield from _walk_strings(child)


def _dsl_problems(tree) -> None:
    problems = wf_dsl.player_side_dsl_problems(tree)
    if problems:
        raise KitError(f"player-side DSL problems: {problems}")


def _effect_ref_problems(ctx, tree) -> list[str]:
    """DSL 引用的特效必须真的存在：官方归档里有（直接引用），或包里有（本轮克隆）。"""
    missing = []
    for value in sorted(_effect_paths(tree)):
        if any(ctx.official_read(f"{value}.{kind}.amf3.deflate") is not None
               for kind in ("parts", "timeline")):
            continue
        if any(ctx.pack.pkg_path("common", f"{value}.{kind}.amf3.deflate").is_file()
               for kind in ("parts", "timeline")):
            continue
        missing.append(value)
    return missing


def _write_tree(ctx, program: str, tree) -> str:
    _dsl_problems(tree)
    refs = _effect_ref_problems(ctx, tree)
    if refs:
        raise KitError(f"{program} references effects absent from baseline and package: {refs}")
    logical = ctx.write_dsl(program, tree)
    if ctx.amf_parse(ctx.pack.pkg_path("common", logical).read_bytes()) != tree:
        raise KitError(f"{program} readback differs from the written tree")
    return logical


def write_skills(ctx, families) -> dict[str, Any]:
    info: dict[str, Any] = {}
    programs = []
    for level in ("1", "2"):
        tree, meta = build_main_tree(ctx, level, families)
        logical = _write_tree(ctx, ctx.program_path(level), tree)
        meta["logical"] = logical
        meta["sha256"] = _sha256(ctx.pack.pkg_path("common", logical).read_bytes())
        info[level] = meta
        programs.append(ctx.program_path(level))

    tree, meta = build_chase_tree(ctx, families)
    logical = _write_tree(ctx, CHASE_PROGRAM, tree)
    meta["logical"] = logical
    meta["sha256"] = _sha256(ctx.pack.pkg_path("common", logical).read_bytes())
    info["ignite"] = meta
    programs.append(CHASE_PROGRAM)

    pf: dict[str, Any] = {}
    for level in (1, 2, 3):
        tree, meta = build_pf_tree(ctx, level, families)
        program = PF_PROGRAMS[level - 1]
        logical = _write_tree(ctx, program, tree)
        meta["logical"] = logical
        meta["sha256"] = _sha256(ctx.pack.pkg_path("common", logical).read_bytes())
        pf[str(level)] = meta
        programs.append(program)
    ctx.write_flat(PFA, {PF_KEY: [list(PF_PROGRAMS)]})
    return {"skills": info, "power_flip": pf, "programs": programs}


# ---------------------------------------------------------------- 入口

SUMMARY = ("玛格诺斯 rework1：火 · 特殊强化弹射主C"
           "（722 三档锥形 PF → 629「引擎之炎」→ 引擎点火按层堆技能伤害）")

NOTES = [
    "722 带火共鸣门（官方 141201#1 先例）：非共鸣队伍或他不当队长时是原生剑士 PF，面板已写明",
    "422 冲刺两行在词条槽 5（前置 42 队长），队长表写 422 = 角色页 C7050；文案挪到队长技 desc_override",
    "Swift 抵消 +245% 只对非飞行形态精确（飞行基数 60 而非 90）⇒ 面板不写「完全无法获得」",
    "629 触发改成 180（PF 命中敌人）并带 CT 0.6 秒：空挥不触发，多敌时靠 CT 限流；629 排在 525 之前",
    "「引擎点火」固有 99999999 帧 / 99 层：能力 3 每次火属性技能 +3 层，队长技每 5 次 PF 再 +2 层",
    "引擎点火的「≥5 层」用 during 134 + limit 1 的平坦门槛（前置 188 数实例恒为 1，写 ≥5 永不成立）",
    "三族特效克隆到 skill_unique/lion_swordman_moon/{lance,burst,aura}/，预算 0.44% → 约 2.19%",
    "克拉莉丝只播末端 79 帧（parts 根层 r=(1<<30)|78），手术在 clone 之后施加并带母本漂移断言",
    "像素交付件（sprite_sheet / special_sprite_sheet）若是标准 PNG，装包时由 kitlib 换成 WF 存储态魔数",
    "反馈轮 1：去掉 PF 追踪 boss（Repeat/FindNearSubjects/MoveBall 整块删，弹道回官方 special 原生）",
    "反馈轮 1：赛达只留锥形 zeta_lance（黄色六边形来自 zeta_lance_hit/_end，整族不再克隆），"
    "三档改 scale 1.0/1.4/1.8；坐标系 AB→EF ⇒ 枪体朝球的飞行方向（官方 zeta$zeta_1 同写法）",
    "反馈轮 1：光圈环画出来是 132.71×scale px，scale 3.75 时半径 248.8 却只有 Circle 200 判定 ⇒ "
    "外圈 48.8px 碰到敌人不掉血；scale 改由判定半径反算（3.01/4.07），并把命中间隔从推导的 63 帧改显式 30 帧",
]

DEVIATIONS = [
    {"want": "队长技面板第 2/3 行「冲刺强化 + CD−30%」「冲刺间隔缩短不再叠加」写在队长表",
     "got": "422 行落在词条槽 5（前置 42 Leader），文案由 desc_override 挪到队长技面板",
     "why": "422 写进队长表 = 角色详情页 C7050（LeaderAbilityValues.parseAt107 没打补丁）；"
            "同澄波响 _deviations 的裁决。"},
    {"want": "「无法获得冲刺间隔缩短效果」",
     "got": "「冲刺间隔缩短效果不会让自身的冲刺冷却时间进一步缩短」+ 422 param0 数值抵消 +245%",
     "why": "引擎没有「拒绝某一个具体增益」的 kind（ACBuffRejection 是拒绝全部）；"
            "Swift 把 CD 基数 90 换成 20，补回 3.5×(1+s0) 即等价。"},
    {"want": "「技能倍率随强化弹射次数提升」",
     "got": "词条「火共鸣时，每发动 3 次强化弹射，自身技能伤害 +25%」（无上限叠加）",
     "why": "DSL 没有表达式求值，倍率槽是静态两端值；_deviations.magnus[2] 原样。"},
    {"want": "「引擎点火在 5 以上时强化所有技能伤害倍率（翻倍）」",
     "got": "during 134 阈值 5 层 + limit 1 的平坦门槛 → 自身独立乘区技能伤害 +100%",
     "why": "前置 188 / during 194 数的是实例个数（461 叠层恒为 1），「≥5 层」永不成立。"},
    {"want": "面板里的「塞达式技能特效」「克拉莉丝式圆形爆炸（范围较原版增大）」",
     "got": "改写成玩家可读的描述（「火焰突进随发动次数分三档逐渐增强」「造成技能伤害」），机制不变",
     "why": "面板是给玩家看的，不能出现其它官方角色的内部代号；已回写 panel/magnus.json 并标 dev:true。"},
    {"want": "面板 skill 第 4 行（特殊强化弹射说明）单独成行",
     "got": "落成 action_skill 描述的第 4 段；722 行自带 override_string_…_pf 说明串",
     "why": "队长技面板被 desc_override 整段接管后，722 行自己的说明串不会显示。"},
    {"want": "能力 1 第 1 行、能力 6 第 1 行保留 donor 的「火·MySelf」前置",
     "got": "去掉该前置（c6=0）",
     "why": "对火属性的玛格诺斯恒真，属裁决 §3 禁止的恒真条件文案；行为完全一致。"},
    {"want": "设计稿先行、kit 与设计稿双向对账",
     "got": "design/magnus.json 的 plan_rework1 由 kit 常量生成，对账退化为漂移探测",
     "why": "额度约束下不重复手写同一份 23 行；仍能抓住事后单边改动，抓不到首次录入的共同错误。"},
    {"want": "魏虎光圈块自带的 ACToleranceOfElement（火耐性↓）与 _shot 命中特效",
     "got": "丢掉耐性行；命中特效换引擎内置 Fine",
     "why": "目标面板没有耐性这一条；命中特效用内置件后特效族只需克隆 _aura 一个基名。"},
    {"want": "像素件（小人 sprite_sheet 等）随 kit 一起装包",
     "got": "B/pixel/magnus/install.json 不存在时自动跳过，包内保持母本像素件",
     "why": "像素/立绘/语音不归本代理；像素代理交付后重跑 kit 即可装入。"},
    {"want": "面板 / 技能描述里的「并可追击敌方boss目标」",
     "got": "整句删除（PF_STRING 与 action_skill 描述第 4 段同步）",
     "why": "反馈轮 1 作者要求去掉强化弹射的追踪，行为没了文案就不能留。"},
    {"want": "赛达三档靠叠加 zeta_lance_hit / zeta_lance_end 表达「逐渐增强」",
     "got": "三档都只用锥形 zeta_lance，靠 scale 1.0/1.4/1.8 递增；两个 hit/end 族不再克隆",
     "why": "作者原话「只要锥形的效果黄色的小方框不要」——实测那两族的主体就是实心黄色六边形。"},
    {"want": "光圈「稍微小一点」＝ ShowEffect scale 与判定半径一起按 15–20% 缩",
     "got": "只缩画面（scale 3.75→3.01、5.00→4.07，−19.7%/−18.6%），判定半径 200/270 不动",
     "why": "环和判定本来差 24%（环 248.8 vs 判定 200）——那圈差值就是「碰到了没伤害」的来源；"
            "缩画面到刚好压在判定圆上，既是作者要的更小，也让看得见的部分全部生效，强度不变。"},
]


def build(ctx) -> dict[str, Any]:
    spec = ctx.spec
    if (spec.cid, spec.code) != (CID, CODE):
        raise KitError(f"kit bound to {CID}/{CODE}, got {spec.cid}/{spec.code}")
    if (spec.template_id, spec.template_code) != (TEMPLATE_ID, TEMPLATE_CODE):
        raise KitError(f"template must stay {TEMPLATE_ID}/{TEMPLATE_CODE}, "
                       f"got {spec.template_id}/{spec.template_code}")
    if spec.element != 0:
        raise KitError(f"magnus stays fire (element 0), got {spec.element}")

    design = _design(ctx)
    design_problems = _design_problems(design) if design else ["design/magnus.json absent"]
    if design and design_problems:
        raise KitError(f"kit drifted from the design document: {design_problems}")

    voice_cols = write_voice_route(ctx)
    unique_key, unique_row = build_unique(ctx)
    icon = install_unique_icon(ctx)

    rows = build_rows(ctx)
    ctx.write_flat(KL.LEADER, {CID_S: rows["leader"]})
    ctx.write_flat(KL.ABILITY, rows["ability"])
    strings = write_strings(ctx)

    action = write_action_skill(ctx)
    fx_report, families = clone_effects(ctx)
    skills = write_skills(ctx, families)
    voice_ready = KL.write_voice_ready(ctx)
    pixel = KL.install_staged_assets(ctx)
    mirrors = ctx.sync_character_mirrors()

    panel = [ev["describe"] for ev in rows["evidence"]] + list(strings.values())
    ctx.evidence_write("kit-rows.json", {
        "leader": rows["leader"], "ability": rows["ability"],
        "unique_condition": {unique_key: unique_row},
        "custom_ability_string": strings, "action_skill": action,
        "power_flip_action": {PF_KEY: list(PF_PROGRAMS)},
        "voice_route": voice_cols, "evidence": rows["evidence"], "effects": fx_report,
    })
    return KL.report(
        ctx,
        summary=SUMMARY,
        status=KL.READY,
        panel=panel,
        notes=NOTES + [{"icon": icon, "pixel": pixel, "voice_ready": voice_ready,
                        "mirrors": mirrors, "design_checked": bool(design),
                        "effects": fx_report}],
        programs=skills["programs"],
        unique_condition={unique_key: {"name": UNIQUE_NAME, "icon": UC_ICON_LOGICAL,
                                       "duration_frames": int(unique_row[3]),
                                       "cap": int(unique_row[4])}},
        required_capabilities=sorted(set(rows["capabilities"])
                                     | set(SPEC["required_capabilities"])),
        deviations=DEVIATIONS,
        extra={"skills_detail": {"trees": skills["skills"],
                                 "power_flip": skills["power_flip"],
                                 "energy": {lv: list(ENERGY[lv]) for lv in ("1", "2")}},
               "effects": fx_report,
               "voice_route": voice_cols},
    )
