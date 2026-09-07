#!/usr/bin/env python3
"""during_content 422 `DashParameter` —— 补丁意图与锁定输入。

## 这是什么

一族**可调冲刺参数**。数据侧写一行持续词条(ability c109 = 422),用
`param_id` 选中要调哪一个冲刺常量、用 `strength` 给出调整量;以后想调冲刺的
别的方面,只要加一个 param_id,不用再打一次 APK 补丁。

  * `param_id` 列 = during_content 块内偏移 9 = **ability c118**
    (`AbilityValues.parseAt118` → `int(Std.parseInt(...))`)。
    这一列在 `mod-tools/ability_enum_map.json` 的 `block_fields` 里叫
    `unique_condition_id`;422 行**借**这一列装 param_id。借它而不是借
    `element`(偏移 10)的理由:`wf_client_legality.ability_element_column_problems`
    会把 element 列按 `ElementTargetKind`(0..6,1-based)判值域,param_id
    以后超过 6 就会被误报;`unique_condition_id` 没有值域规则,而且
    「声明即必填」通用律照样能强制这一列非空。
  * `strength` 列 = 块内偏移 4/5 = **ability c113/c114**
    (`AbilityValues.parseAt113`,Decimal ×100000,允许负号)。

## param_id 语义(全表)

除 2 之外**一律是官方常量的倍率**:`生效值 = 官方常量 × (1 + strength/100000)`。
`strength = -30000` ⇒ ×0.7 ⇒ 面板读作「冲刺冷却时间−30%」。

| id | 名称 | 官方常量(反编译出处) | 生效点 |
|----|------|----------------------|--------|
| 0 | 冲刺冷却时间 | 90 帧;飞行形态 60;疾走时取 `EscapeSwiftLogic.get_escapeRecoveringTime()` 的更小值(`BallImpl.as:309-322`) | `BallImpl.update` 的 `escapePoint.add(1/frames)` 之前,`frames = Math.max(1, frames × 倍率)` |
| 1 | 冲刺弹射速度 | `23 × getSpeedupCorrectionFactor() + 23`(`BallImpl.as:2189`) | `BallImpl.findEscapeTarget` 存进 `_loc7_` 之前 × 倍率 |
| 2 | 冲刺锁定距离上限 | **官方无此常量**(不限距,全场取最近) | `BallImpl.findEscapeTarget` 拿到 `getResult()` 之后:`strength > 0` 且 `EscapeTargetScoutContext.currentDistance > strength/100000`(**像素**,已含官方的 `getEscapeTargetDistanceCorrectionFactor` 修正)时丢弃锁定目标,退回官方的左右兜底方向。`0` = 官方行为 |
| 3 | 冲刺蓄力帧数 | 8 帧(`BallImpl.as:405`) | `BallImpl.update` 把 `stateFrame == 8` 换成 `stateFrame >= Math.max(1, 8 × 倍率)`(用 `>=` 而不是 `==`,避免阈值被中途调小后永远撞不上、卡在蓄力态) |
| 4 | 冲刺回拉距离 | 16 px(`BallImpl.as:526-529/547-550`,`cos/sin × 16`,case 1 / case 2 共 4 处) | `BallImpl.tryEscape` 每一处 `× 16` 之后再 × 倍率 |
| 5 | 冲刺惯性 | 0.2;飞行形态 0(`BallImpl.as:2190-2191`) | `BallImpl.findEscapeTarget` 两处 `速度 × 0.2` 各 × 倍率(飞行形态那条常量是 0,乘完还是 0) |
| 6 | 可冲刺高度上限 | 1200(`BallImpl.as:2590` `localToGlobalY() < 1200`) | `BallImpl.canEscapeNow` 把 1200 换成 `1200 × 倍率` |

这些常量都是 Haxe **内联**进 `BallImpl` 的字面量,改 `BattleConstants` 一个字节都不生效,
所以只能在这 4 个方法体的字面量现场动手。

## 数据怎么流过来

    ability 行 c109=422
      → AbilityValues.parseAt109            (认识 "422",构造 master value)
      → DuringAbilitySource.createFromDuringAbilityValues
                                            (master value → CommonAbilityContent.Battle(
                                             CommonAbilityBattleContent("DashParameter",21,[id,strength])))
      → BattleAbilityTotalizerImpl.addDuringContent
                                            (按 param_id 分桶累加到新槽 duringDashParameters)
      → BattleAbilityTotalizerImpl.getTotalDashParameter(id)   ← **新增方法**
      → BallImpl 的 4 个方法在各自的常量现场读它

`getTotalDashParameter` 走官方的 `DuringCheckerWithDecimal.sum(list, null)`,
所以持续条件(during checker)的启停、层数倍乘全部沿用官方语义。

## 官方 APK 上会怎样

`AbilityValues.parseAt109` 的 else 分支同样是 `throw new ClientError(7050)` ——
没打补丁的客户端读到 422 就崩在角色详情页。闸门登记在
`mod-tools/wf_client_legality.py` 的 `CLIENT_PATCH_CONTENT_KINDS`。
"""
from __future__ import annotations

import json

CAPABILITY = "dash-parameter-v1"

CONTENT_KIND = 422                  # CommonAbilityContentMasterValue 的下一个空 index
CONTENT_CTOR = "DashParameter"
BATTLE_CONTENT_INDEX = 21           # CommonAbilityBattleContent 的下一个空 index(官方 0..20)

PARAM_COUNT = 7
PARAM_NAMES = {
    0: "冲刺冷却时间",
    1: "冲刺弹射速度",
    2: "冲刺锁定距离",
    3: "冲刺蓄力帧数",
    4: "冲刺回拉距离",
    5: "冲刺惯性",
    6: "可冲刺高度",
}
PARAM_UNITS = {
    0: "倍率", 1: "倍率", 2: "像素上限", 3: "倍率", 4: "倍率", 5: "倍率", 6: "倍率",
}
TEXT_PLUS = "＋"
TEXT_MINUS = "−"
TEXT_PERCENT = "%"
TEXT_UP = "提升"
TEXT_DOWN = "降低"

TOTALIZER_SLOT = "duringDashParameters"
TOTALIZER_GETTER = "getTotalDashParameter"

# 锁定输入:V12 第一步(kyubi-fever-ratio)的产物。
V11_SWF_SHA256 = "9c86430e7dc230e2abd7aa799a9ecaeb9be6056278712d9b2939878912ed5900"

# 被改的方法体。(体下标, 基线 code sha256, 改前 (maxstack, localcount), 改后 (maxstack, localcount))
# 这些哈希是从 **V11 基线** 算的;dash-parameter 的输入是 fever-ratio 的产物,
# 而 fever-ratio 没碰这 13 个体,所以两边一致(verify.py 会重新核一遍)。
TARGETS = {
    "AbilityValues$/parseAt109": (
        39158, "af1ac9ba39907ecaa248d0bea913fa991d7a8e0d9fd6e1f6c3c53c1b6595f603",
        (10, 3), (10, 3)),
    "DuringAbilitySource$/createFromDuringAbilityValues": (
        13347, "0beea94826ac6f276d3bd295dfca7262dbfdbf30f0598e2027f85c9c7735a2a7",
        (8, 22), (8, 23)),
    "CommonAbilityContentTools$/getStrength": (
        13337, "8af807b7dddc804432eb78da824543bea27b8ec82945446b17db380f9be8e6ae",
        (4, 4), (4, 4)),
    "CommonAbilityContentTools$/hasAdvantage": (
        13338, "2e285a23b6bd2801ce3defc0d1ec8657bae0b240192cad6b73a50ea776e9ad7a",
        (3, 4), (3, 4)),
    "CommonAbilityContentTools$/mergeForDescription": (
        13343, "1fff92637077950e0c608fadaa16b8045f1470a93d82e290e8d4591325d819c9",
        (7, 14), (7, 14)),
    "AbilityDescriptionGenerator/stringfyCommonBattleContent": (
        9005, "85deac2986e49cdb52cb9657d07c47c55f816c6d3dccb8b5cd6a6c154db1bf55",
        (5, 19), (5, 23)),
    "AbilityDescriptionGenerator/stringfyStrengthByCommonBattleContent": (
        8384, "020cd353b233cc5585aa028cd00c701ac1789c9e9c99c89801eb9bdf4d9b8b03",
        (5, 10), (5, 10)),
    "AbilityDescriptionGenerator/stringfySummaryCommonContent": (
        8360, "3b3adf5a9f2eefff6d90da2bece32dab441b6416bd29e6a3fbf7b1dcdbe0c96c",
        (5, 20), (5, 24)),
    "BattleAbilityTotalizerImpl/addDuringContent": (
        51551, "159eafe418f31138623173968cefc80ba509a1b37bbec7867738944e197ea001",
        (9, 6), (9, 7)),
    "BallImpl/update": (
        59934, "c4a9ab4365c82b2a44b4a7add87cd9e37234616c37a167a7876700a36018e02a",
        (7, 9), (7, 10)),
    "BallImpl/findEscapeTarget": (
        60089, "321bcf65cfc4ac3eba5a720e84c48ca30d2a0e0ad8fa0abbfc4f979c5228e5d9",
        (3, 10), (5, 11)),
    "BallImpl/tryEscape": (
        59935, "57ad706724cd4c64900fb1cebf15e9e834d913d0f802ede0807a2bad50a0f8f8",
        (6, 8), (9, 8)),
    "BallImpl/canEscapeNow": (
        60127, "23f76abb169fa60f3f09b964e4eaf3a2596e77eec02cf547fb82f58733160b64",
        (7, 2), (10, 2)),
}

# 插入点本身是原有分支目标时的处理策略(见 client-patch/abcasm/asm.py)。
FORBID = "forbid"   # 默认:插入点不许有任何原有分支指向它
SKIP = "skip"       # 原有分支落到块之后
ENTER = "enter"     # 原有分支落到块开头(所有路径都要跑这一块)

# 每个体的插入点(**基线**指令下标,升序)。全部是整块插入,不改写任何原指令。
# 第三项是 incoming 策略;写 FORBID 的那些点,基线里本来就没有分支指向它们
# (`asm.splice` 会当场核实,不是靠这里的注释)。
INSERTIONS = {
    "AbilityValues$/parseAt109": [(6, "parse", FORBID)],
    "DuringAbilitySource$/createFromDuringAbilityValues": [(7303, "resolve", FORBID)],
    "CommonAbilityContentTools$/getStrength": [(0, "get_strength", FORBID)],
    "CommonAbilityContentTools$/hasAdvantage": [(0, "has_advantage", FORBID)],
    "CommonAbilityContentTools$/mergeForDescription": [(32, "no_merge", FORBID)],
    "AbilityDescriptionGenerator/stringfyCommonBattleContent": [(2, "describe", FORBID)],
    "AbilityDescriptionGenerator/stringfyStrengthByCommonBattleContent":
        [(2, "describe_strength", FORBID)],
    "AbilityDescriptionGenerator/stringfySummaryCommonContent":
        [(2, "describe_summary", FORBID)],
    "BattleAbilityTotalizerImpl/addDuringContent": [(2, "accumulate", FORBID)],
    # 79  = escapePoint.add(1/_loc2_) 之前(冷却帧数已经算完,含疾走取小)。
    #       这一点同时是 `isSwifting()` 假分支(#64 iffalse)与
    #       `if(_loc3_ < _loc2_)` 假分支(#75 ifnlt)的落点 —— 三条路径都必须
    #       走一遍倍率换算,所以是 ENTER。按默认策略拼进去的话,倍率只会在
    #       「疾走且恢复更快」那一条路上生效,别的路径悄悄跳过(V12 施工时
    #       真的踩过,是 FFDec 反编译回读抓出来的)。
    # 288 = `stateFrame == 8` 的 ifne 之前
    "BallImpl/update": [(79, "cooldown", ENTER), (288, "charge", FORBID)],
    # 40  = _loc4_ = requestEscapeTarget(...).getResult() 之后
    # 214 = 23*f+23 存进 _loc7_ 之前
    # 227 / 249 = 两处 `速度 × 0.2` 的 multiply 之前。这两点是
    #       `isFlyingMove()` 真分支(pushbyte 0 之后的 jump)的落点:
    #       飞行形态的惯性常量本来就是 0,跳过倍率换算与乘完的结果一样
    #       (0 × 倍率 = 0),所以按 SKIP 处理 —— 反编译回读出来正是官方形状
    #       `isFlyingMove() ? 0 : 0.2 * 倍率`。
    "BallImpl/findEscapeTarget": [(40, "lock_distance", FORBID),
                                  (214, "launch_speed", FORBID),
                                  (227, "inertia", SKIP), (249, "inertia", SKIP)],
    # 四处 `cos/sin × 16` 的 multiply 之前(case 1 两处 + case 2 两处)
    "BallImpl/tryEscape": [(87, "pullback", FORBID), (98, "pullback", FORBID),
                           (192, "pullback", FORBID), (203, "pullback", FORBID)],
    # 14 = `localToGlobalY() < 1200` 的 iflt 之前
    "BallImpl/canEscapeNow": [(14, "height_gate", FORBID)],
}

# 新加进 ABC 的东西(verify.py 会逐项核对,多一个少一个都不放行)。
ADDED_INSTANCE_TRAITS = (TOTALIZER_SLOT, TOTALIZER_GETTER)
ADDED_METHODS = 1


class PatchError(ValueError):
    """拒绝未知输入、拒绝半截补丁、拒绝歧义锚点。"""


def contract() -> dict:
    return {
        "capability": CAPABILITY,
        "during_content_kind": CONTENT_KIND,
        "constructor": CONTENT_CTOR,
        "battle_content_index": BATTLE_CONTENT_INDEX,
        "param_id_column": "during_content 块内偏移 9(ability c118),"
                           "AbilityValues.parseAt118 → int",
        "strength_column": "during_content 块内偏移 4(ability c113/c114),"
                           "AbilityValues.parseAt113,Decimal ×100000,允许负号",
        "params": {str(k): {"name": PARAM_NAMES[k], "unit": PARAM_UNITS[k]}
                   for k in sorted(PARAM_NAMES)},
        "added_instance_traits": list(ADDED_INSTANCE_TRAITS),
        "added_methods": ADDED_METHODS,
        "targets": {name: {"body_index": body, "base_code_sha256": code,
                           "header_before": list(before), "header_after": list(after),
                           "insertions": [list(x) for x in INSERTIONS[name]]}
                    for name, (body, code, before, after) in TARGETS.items()},
    }


if __name__ == "__main__":
    print(json.dumps(contract(), indent=2, ensure_ascii=False))
