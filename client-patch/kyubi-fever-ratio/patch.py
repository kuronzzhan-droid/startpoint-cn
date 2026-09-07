#!/usr/bin/env python3
"""instant_content 724 `AddFeverPointRatio` —— 补丁意图与锁定输入。

本文件不产生任何二进制:它把 V12 这一半补丁的**契约**写死在一处
(基线哈希、方法体下标、每个体改前/改后的头部、以及等价 ActionScript),
真正的字节码由 `abcpatch.py` 生成、`verify.py` 独立复核。

## 这条 kind 是什么

  * 数据侧:`ability.orderedmap` 的 `instant_content`(ability 表 c47)写 724,
    强度沿用 213 `AddFeverPoint` 的同一列(c51/c52,`AbilityValues.parseAt51`,
    Decimal ×100000,**允许负号**)。`-10000` = Fever 槽上限的 −10%。
  * 运行时:触发时给当前 zone 的 Fever 槽加 `strength/100000 × 当前槽上限`,
    带符号,并且和 213 一样**绕过 Fever 上升率乘区**
    (`AbilitySlotImpl.applyInstantBattle` 的 213 分支 → `Zone.addFeverPoint`
    → `FeverPointGaugeImpl.addFeverPoint` → `feverPoint.add`)。
    槽上限每进一次 Fever ×1.25(`FeverPointGaugeImpl.as:243/348`),所以
    「上限的 10%」在第 3 次 Fever 时比第 1 次多 56%。
  * 钳位:`ClosedInterval.set` 本来就把值夹在 `[min, max]`,而 Fever 槽的
    `min` 恒为 0(`FeverPointGaugeImpl.as:243` `new ClosedInterval(0, …, 0)`),
    所以 `[0, max]` 是**官方代码自带**的,补丁不另写钳位。

## 官方 APK 上会怎样

`AbilityValues.parseAt47` 的 else 分支是 `throw new ClientError(7050,"不存在的构造函数。")`
—— 没打补丁的客户端一打开带 724 的角色详情页就崩。所以数据必须**先换包再发**,
这条闸门登记在 `mod-tools/wf_client_legality.py` 的 `CLIENT_PATCH_CONTENT_KINDS`。

## 为什么走 ABC 字节层而不是 FFDec

见 `client-patch/abcasm/asm.py` 的模块注释:FFDec 的 P-code 往返会在这些巨型
方法体里重写上千条死 jump,虽然可证明无害,却会淹掉「只有目标体变了」的判据。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

CAPABILITY = "kyubi-fever-ratio-v1"

# 数据侧 kind(= Haxe 枚举 InstantAbilityContentMasterValue 的 index;
# 官方 __constructs__ 有 724 条,占满 0..723,所以 724 正好是下一个空位)。
CONTENT_KIND = 724
CONTENT_CTOR = "AddFeverPointRatio"

# InstantAbilityInstantBattleContent 官方 5 个构造(0..4),新值取 5。
BATTLE_CONTENT_INDEX = 5

# `Zone.addFeverPoint(value, isChangeable, statsKind)` 的第三参哨兵:
# 传 `100 + 官方 statsKind` 表示「第一参是**上限比例**而不是绝对 Decimal」。
# FeverPointGaugeImpl 收到后先换算再把 statsKind 减回去,于是 stats 统计、
# `abilityTrigger.countUp(9,…)`(「因能力增加 FEVER 槽」触发)全部与 213 一致。
# 官方全库只有 5 处调用 addFeverPoint,常量 statsKind 只有 0/1/2/3/4
# (verify.py 会重新枚举一遍并断言 < 100)。
RATIO_STATS_SENTINEL = 100
RATIO_STATS_KIND = 1        # 与 213 相同:kind 1 = 由能力效果增减

# 面板文案。官方 ui_string 没有「上限的 N%」这种键,故直接内联中文字面量,
# 再喂给官方的 `AbilityDescriptionTools.stringfy`(把任意值包成描述闭包)。
PANEL_TEXT_INCREASE = "FEVER槽上升（槽上限的）"
PANEL_TEXT_DECREASE = "FEVER槽减少（槽上限的）"
PANEL_TEXT_PERCENT = "%"

# 锁定输入(V12 的基线 = V11 产物)。
V11_SWF_SHA256 = "9c86430e7dc230e2abd7aa799a9ecaeb9be6056278712d9b2939878912ed5900"
V11_APK_SHA256 = "77a31e160d744f08da62578a7381447b4ee77066727869925f6852a75acd73ad"

# 被改的方法体。键 = 报告里用的短名;值 = (主 ABC 里的体下标,
# 基线 code 的 sha256, (maxstack, localcount) 改前, (maxstack, localcount) 改后)。
# 体下标由 client-patch/tests/test_kyubi_fever_ratio.py 按方法名重新解析后断言,
# 不是抄来的常量。
TARGETS = {
    "AbilityValues$/parseAt47": (
        39128, "dd353039ee17361f7b511bc5bc66279973fed78894a6646c2f0e03bbe5a372fd",
        (30, 3), (30, 3)),
    "InstantAbilitySource$/resolveInstantContent": (
        14582, "c6be23a330b67c5fa62ee056075a7df10fc2cb6b89334fc7dcc7e554814afd19",
        (18, 24), (18, 24)),
    "InstantAbilityContentTools$/mergeForDescription": (
        14504, "e73aa9f5e14cf4790329624c4863e885b69e0896873782df1cf36e27a78d0ee6",
        (6, 12), (6, 12)),
    "InstantAbilityDescriptionGenerator/stringfyInstantBattleContent": (
        11983, "e1491b4eb4fe3ae04ac7a06c397b3d0a1d50e0c885ee9a4ada382310d5064477",
        (2, 3), (4, 3)),
    "InstantAbilityDescriptionGenerator/stringfyInstantBattleContentAccordingToPrecontent": (
        11919, "c521b38f33cdc46375e97893677f0663a08e070f33237da63a6eacf7e830e27d",
        (6, 13), (6, 13)),
    "AbilitySlotImpl/applyInstantBattle": (
        51510, "b7201ce2674c1f3cd0571f968f09c6881444cb91543ea0ce525cde1b5e27e88d",
        (14, 13), (14, 13)),
    "FeverPointGaugeImpl/addFeverPoint": (
        60988, "7cb61a7b7237f823656b3accca361200733cd7553028e73d30b074f5ece66d92",
        (4, 5), (4, 5)),
}

# 每个体的插入点(指令下标)。全部是「在原有指令之前整块插入」,
# 不改写任何一条原指令的操作码或操作数,只重算分支偏移。
INSERT_AT = {
    "AbilityValues$/parseAt47": 6,                     # setlocal_2 之后(_loc2_ 已就绪)
    "InstantAbilitySource$/resolveInstantContent": 56,  # setlocal 5 之后(_loc5_ = 内容 index)
    "InstantAbilityContentTools$/mergeForDescription": 26,  # 大 lookupswitch 之前
    "InstantAbilityDescriptionGenerator/stringfyInstantBattleContent": 2,
    "InstantAbilityDescriptionGenerator/stringfyInstantBattleContentAccordingToPrecontent": 2,
    "AbilitySlotImpl/applyInstantBattle": 27,           # 大 lookupswitch 之前
    "FeverPointGaugeImpl/addFeverPoint": 2,             # getlocal0/pushscope 之后
}

# 补丁的等价 ActionScript(只用于人读与 README,永不重新编译)。
EQUIVALENT_SOURCE = {
    "AbilityValues$/parseAt47": """
      // 插在 `var _loc2_:String = param1[47];` 之后
      if(_loc2_ == "724")
      {
         return new InstantAbilityContentMasterValue("AddFeverPointRatio",724,[{
            "strength":AbilityValues.parseAt51(param1)
         }]);
      }
""",
    "InstantAbilitySource$/resolveInstantContent": """
      // 插在 `_loc5_ = _loc4_.index;` 之后
      if(_loc5_ == 724)
      {
         return InstantAbilityContent.InstantBattle(
            new InstantAbilityInstantBattleContent("AddFeverPointRatio",5,
               [param2.resolveDecimal(_loc4_.params[0].strength)]));
      }
""",
    "InstantAbilityContentTools$/mergeForDescription": """
      // 插在 `switch(param1.index)` 之前:新 kind 一律不合并,免得 _loc3_ 留 null
      // 之后 `switch(_loc3_.index)` 空引用。
      if(param1.index == 5 && param2.index == 5
         && (param1.params[0].index == 5 || param2.params[0].index == 5))
      {
         return Option.None;
      }
""",
    "InstantAbilityDescriptionGenerator/stringfyInstantBattleContent": """
      // 插在方法开头(原体只是 newactivation + newfunction)
      if(param1.index == 5)
      {
         var _loc2_:* = param1.params[0];
         if(_loc2_ < 0)
         {
            return AbilityDescriptionTools.stringfy(
               "FEVER槽减少（槽上限的）" + Decimal_Impl_.toPercentString(-_loc2_) + "%");
         }
         return AbilityDescriptionTools.stringfy(
            "FEVER槽上升（槽上限的）" + Decimal_Impl_.toPercentString(_loc2_) + "%");
      }
""",
    "InstantAbilityDescriptionGenerator/stringfyInstantBattleContentAccordingToPrecontent": """
      // 插在方法开头:官方 switch 只覆盖 0..4,新 kind 会让 _loc5_ 留 null,
      // 后面的 `env.push("content", value1)` 会调用 null 闭包。带前置内容的 724
      // 行目前数据层还造不出来,退化成「不带前置修饰的正文」而不是崩。
      if(param1.index == 5)
      {
         return stringfyInstantBattleContent(param1);
      }
""",
    "AbilitySlotImpl/applyInstantBattle": """
      // 插在 `switch(param1.index)` 之前
      if(param1.index == 5)
      {
         zoneManager.getCurrentZone().addFeverPoint(
            Number(param1.params[0]) * param2,true,101);
         return;
      }
""",
    "FeverPointGaugeImpl/addFeverPoint": """
      // 插在方法开头:param3 >= 100 表示 param1 是「上限比例」
      if(param3 >= 100)
      {
         param1 = param1 * feverPoint.max;   // Decimal 原始值 × 浮点上限
         param3 = param3 - 100;              // 还原成官方 statsKind
      }
""",
}


class PatchError(ValueError):
    """拒绝未知输入、拒绝半截补丁、拒绝歧义锚点。"""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def contract() -> dict:
    """给报告用的机器可读契约。"""
    return {
        "capability": CAPABILITY,
        "instant_content_kind": CONTENT_KIND,
        "constructor": CONTENT_CTOR,
        "strength_column": "instant_content 块内偏移 4(ability c51/c52),"
                           "AbilityValues.parseAt51,Decimal ×100000,允许负号",
        "battle_content_index": BATTLE_CONTENT_INDEX,
        "stats_kind_sentinel": RATIO_STATS_SENTINEL + RATIO_STATS_KIND,
        "base_swf_sha256": V11_SWF_SHA256,
        "base_apk_sha256": V11_APK_SHA256,
        "targets": {name: {"body_index": body, "base_code_sha256": code,
                           "header_before": list(before), "header_after": list(after),
                           "insert_at_instruction": INSERT_AT[name]}
                    for name, (body, code, before, after) in TARGETS.items()},
    }


if __name__ == "__main__":
    print(json.dumps(contract(), indent=2, ensure_ascii=False))
