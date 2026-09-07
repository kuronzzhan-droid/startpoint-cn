#!/usr/bin/env python3
"""把 `kyubi-pf-damage-v1` 的语义拼进主 ABC —— 全程指令级插入，绝不回编 AS3。

同一份语义的**旧实现**（`patch.py` + FFDec 整类 AS3 回编）已经废弃：它产出的 V9
在真机战斗里抛 `ReferenceError #1069`，栈顶是 `ActionEvaluator/evalCommand`。
原因见 `README.md` 的「为什么整类回编被废弃」。`patch.py` 保留下来只作为**意图**
的可读版本（每一处改动的 AS3 原文），不再参与构建。

本模块只做两件事：

1. **追加成员**（只往 trait 表末尾加，不挪任何已有槽序号）：
   * `MemberImpl.kyubiLastPowerFlipChargeLv : int` 槽；
   * `MemberImpl.kyubiIsPfAbilityDamage(InstantAbilityAddress) : Boolean` 方法；
   * `MemberImpl.kyubiGetPowerFlipChargeLv() : int` 方法；
   * `AbilityDamageShot.kyubiPfDamage : Boolean`、`AbilityDamageShot.kyubiPfChargeLv : int` 槽。
2. **在 5 个既有方法体的指令边界上整块插入**，一条原指令都不改写
   （连操作数都不动，只重算分支的 s24 偏移）。

第三块 —— `SquadManagerImpl.invokeActionSkill` —— 不在这里，它继续走已经验证过的
单方法 P-code：`patch_squad_pcode.py`（V8 那个方法体里有赛瑞斯双形态语音补丁，
FFDec 反编译不出可回编的 AS3，所以当初就是 P-code）。

## 与旧实现的差异（语义相同，写法不同）

| 旧（AS3 回编） | 新（指令插入） | 为什么 |
|---|---|---|
| `public var kyubiLastPowerFlipChargeLv:int = 1;` | 槽默认值 0 | 唯一的读点 `kyubiGetPowerFlipChargeLv()` 会 `max(1, min(3, x))`，0 和 1 读出来都是 1 |
| `public var kyubiPfChargeLv:int = 1;` | 槽默认值 0 | 唯一的读点是 `kyubiPfDamage ? kyubiPfChargeLv : 0`，而构造函数在置 `kyubiPfDamage=true` 时一定同时写了它 |
| 629 的 context 字面量 `newobject 12` → `14` | `newobject 12` 之后 `dup/setproperty` 两次 | 不改写任何一条原指令；对象字面量是 dynamic Object，两种写法等价 |
| `finish` 里 5 个值表达式被替换 | 原指令保留，后面插入「pop 掉再压新值」 | 同上；栈中性，且「原指令逐条不变」这条验收判据继续成立 |
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "abcasm"))
sys.path.insert(0, str(HERE))

import asm                                              # noqa: E402
import bodies                                           # noqa: E402
from swfabc import PoolEditor, SwfAbc                    # noqa: E402

abcfmt = asm.load_abc_module("abcfmt")

CAPABILITY = "kyubi-pf-damage-v1"

MAIN_1 = "battle/action/skill/action/rare5/fox_oracle_autumn$fox_oracle_autumn_1"
MAIN_2 = "battle/action/skill/action/rare5/fox_oracle_autumn$fox_oracle_autumn_2"
SPECIAL = ("battle/action/skill/action/ability_skill/"
           "ability_skill_fox_oracle_autumn_fever_pf$ability_skill_fox_oracle_autumn_fever_pf")

ABILITY2_CHARACTER_ID = 1399952      # 稻穗能力 2 第 0 行的词条 id
ORIGIN_MAIN = 2000                   # 主位能力 2 第 0 行 = 能力编号 2 × 1000 + 行号 0
ORIGIN_UNISON = 1002000              # 副位同理（能力编号 1002）
ABILITY_SLOT_INDEX = 2               # getAbilityIdAt(2)
POWER_FLIP_ACTION_KIND = 5           # ActionKind.PowerFlip 的 index
CHARGE_LV_MIN, CHARGE_LV_MAX = 1, 3

CONTEXT_KEY_DAMAGE = "kyubiPfDamage"
CONTEXT_KEY_CHARGE = "kyubiPfChargeLv"
MEMBER_SLOT = "kyubiLastPowerFlipChargeLv"
MEMBER_IS_PF = "kyubiIsPfAbilityDamage"
MEMBER_GET_LV = "kyubiGetPowerFlipChargeLv"
SHOT_SLOTS = ("kyubiPfDamage", "kyubiPfChargeLv")

MEMBER_CLASS = "pinball.scene.battle.battle.squad.member::MemberImpl"
SHOT_CLASS = "pinball.scene.battle.battle.ability::AbilityDamageShot"

# `evalCommand` 里这几个寄存器就是反编译源码里的 `_locN_`（FFDec 用寄存器号命名）。
# 逐个由 verify.py 用「消费点」反证：CreateNormalAttack 的对象字面量里
# `createdByPowerFlipAction` 后面紧跟 `getlocal 63`，依此类推。
EVAL_REG_IS_PF = 63          # _loc63_  createdByPowerFlipAction
EVAL_REG_MAIN_SKILL = 4      # _loc4_   createdByMainSkillAction
EVAL_REG_UNISON_SKILL = 5    # _loc5_   createdByUnisonSkillAction
EVAL_REG_CHARGE_LV = 24      # _loc24_  powerFlipChargeLv

# 被改的方法体。键 = 方法名（`client-patch/abcasm/bodies.py` 的标签写法）；
# 值 =（V13a 基线 code 的 sha256, 改前 (maxstack, localcount), 改后 (maxstack, localcount)）。
# 体下标一律按名字解析，locked 的哈希才是判据。
TARGETS = {
    "MemberImpl/startPowerFlip": (
        "675b4a9e5874e5bba8502ea998963a20ab198d3553e0159a5f8422b7c9987f51",
        (27, 19), (27, 19)),
    "MemberImpl/applyInstantAbility": (
        "b105b6fef9c7699d34f178aa34022c47369612c159ac2e5259de7cb45e59b298",
        (48, 37), (48, 37)),
    "ActionEvaluator/evalCommand": (
        "105f258ab3649922848391d6515c42df4a91d9f64e8ea3849884071a9255ecbc",
        (109, 190), (109, 190)),
    "AbilityDamageShot/<ctor>": (
        "3b79ab2160c225e9fc26581ae9f4e86d595cf8caf4efbb2b8c69c2455cf1f431",
        (5, 18), (5, 18)),
    "AbilityDamageShot/finish": (
        "6c0fc4ed11b91ae17deb0b8fdcddc430a2d9924b3c4c6ba6f1b228ab9ce30d1a",
        (108, 35), (108, 35)),
}

FORBID = asm.FORBID

# 插入点（**基线**指令下标，升序）。全部是「在这条原指令之前整块插入」。
INSERTIONS = {
    # 16 = `if(isLeader())` 的 findproperty 之前（局部变量初始化刚跑完）
    "MemberImpl/startPowerFlip": [(16, "record_charge_lv", FORBID)],
    # 1380 = case 19 的 context 字面量 `newobject 12` 之后
    "MemberImpl/applyInstantAbility": [(1380, "context_keys", FORBID)],
    # 1895 = `_loc63_ = _loc62_.index == 5;` 的 setlocal 63 之后
    "ActionEvaluator/evalCommand": [(1895, "pf_override", FORBID)],
    # 40 = `incrementCombo = param11;` 的 initproperty 之后
    "AbilityDamageShot/<ctor>": [(40, "detect", FORBID)],
    # 361/369/371/422/426 = 对象字面量里 5 个值表达式的原指令之后
    "AbilityDamageShot/finish": [(361, "is_pf", FORBID), (369, "not_ability", FORBID),
                                 (371, "not_unison", FORBID), (422, "charge_lv", FORBID),
                                 (426, "no_combo", FORBID)],
}

ADDED_MEMBER_TRAITS = (MEMBER_SLOT, MEMBER_IS_PF, MEMBER_GET_LV)
ADDED_SHOT_TRAITS = SHOT_SLOTS
ADDED_METHODS = 2

# 常量池里必须已经存在的名字：(命名空间, 名字) -> 期望下标（V8/V13a 上实测）。
# `_resolve` 会按名字重新查一遍并核对唯一性，下标只是交叉验证。
EXPECTED_MULTINAMES = {
    ("", "get_context"): 43311, ("", "index"): 46, ("", "params"): 80,
    ("", "squad"): 42391, ("", "getLeader"): 40977, ("", "source"): 4798,
    ("", "abilitySlot"): 49339, ("", "instantAbilities"): 42457,
    ("", "address"): 42359, ("", "origin"): 10229, ("", "logic"): 9604,
    ("", "getAbilityIdAt"): 16510, ("", "getUnisonCharacter"): 16619,
    ("", "length"): 35, ("", "Math"): 83, ("", "min"): 59, ("", "max"): 61,
    ("", "int"): 38, ("", "Boolean"): 55,
    ("pinball.scene.battle.battle.squad.member", "MemberImpl"): 12768,
    ("pinball.common.data.character", "CalculatedBattleCharacterLogic"): 16687,
    ("pinball.online.battle.address", "InstantAbilityAddress"): 9975,
    ("haxe.ds", "Option"): 79,
}
ARRAY_INDEX_MULTINAME = 14           # MultinameL([PackageNamespace("")])


class PatchError(ValueError):
    """拒绝未知基线、拒绝重复施工、拒绝任何一处形状对不上。"""


def _resolve(abc) -> dict:
    """按 (命名空间, 名字) 唯一定位常量池里的 QName，并与实测下标交叉验证。"""
    found = {}
    for (namespace, name), expected in EXPECTED_MULTINAMES.items():
        matches = []
        for index in range(1, len(abc.multinames)):
            entry = abc.multinames[index]
            if entry[0] != abcfmt.MN_QName:
                continue
            kind, namespace_string = abc.namespaces[entry[1]]
            if kind == 0x16 and abc.s(namespace_string) == namespace \
                    and abc.s(entry[2]) == name:
                matches.append(index)
        if len(matches) != 1:
            raise PatchError("%r is not a unique public QName (%d matches)"
                             % ((namespace, name), len(matches)))
        if matches[0] != expected:
            raise PatchError("%r resolved to multiname %d, expected %d"
                             % ((namespace, name), matches[0], expected))
        found[name] = matches[0]
    entry = abc.multinames[ARRAY_INDEX_MULTINAME]
    if entry[0] != abcfmt.MN_MultinameL:
        raise PatchError("multiname %d is not the array-index MultinameL"
                         % ARRAY_INDEX_MULTINAME)
    found["array_index"] = ARRAY_INDEX_MULTINAME
    return found


# ---------------------------------------------------------------------------
def _field_read(mn: int):
    """读自己的实例字段 —— 抄官方现场（`findproperty` + `getproperty`）。"""
    return [("findproperty", mn), ("getproperty", mn)]


def _context():
    """`get_context()` —— 抄 evalCommand 现场的调用形状。"""
    return [("findproperty", MN["get_context"]), ("callproperty", MN["get_context"], 0)]


MN: dict = {}


def _blocks(pool: PoolEditor, new: dict) -> dict:
    """全部插入块。返回 {块名: 助记符列表}。"""
    s_damage = pool.string(CONTEXT_KEY_DAMAGE)
    s_special = pool.string(SPECIAL)
    # 官方这份 ABC 里 `pushshort` 从没出现过大于 255 的操作数，而 pushshort 的宽度
    # 在各家 AVM2 实现上有 u30 / s16 之争。整数一律走 int 池，不制造新形状。
    i_main = pool.integer(ORIGIN_MAIN)
    i_unison = pool.integer(ORIGIN_UNISON)
    i_ability = pool.integer(ABILITY2_CHARACTER_ID)

    def option_is_kyubi_ability2(label_false):
        """`o.index == 0 && o.params[0] == 1399952` —— 结果留在栈上并返回。"""
        return [
            ("getlocal", 5), ("getproperty", MN["index"]), ("pushbyte", 0),
            ("ifne", label_false),
            ("getlocal", 5), ("getproperty", MN["params"]), ("pushbyte", 0),
            ("getproperty", MN["array_index"]),
            ("pushint", i_ability), ("equals",), ("convert_b",), ("returnvalue",),
        ]

    return {
        # ── MemberImpl.startPowerFlip：记下这一次真实 PF 的档位 ────────────
        # `kyubiLastPowerFlipChargeLv = param2;`
        "record_charge_lv": [
            ("findproperty", new[MEMBER_SLOT]),
            ("getlocal_2",),
            ("initproperty", new[MEMBER_SLOT]),
        ],
        # ── MemberImpl.applyInstantAbility：629 的 context 多两个键 ────────
        "context_keys": [
            ("dup",),
            ("getlocal_3",), ("getproperty", MN["params"]), ("pushbyte", 1),
            ("getproperty", MN["array_index"]),
            ("pushstring", s_special), ("equals",), ("convert_b",),
            ("setproperty", new[CONTEXT_KEY_DAMAGE]),
            ("dup",),
            ("findproperty", new[MEMBER_GET_LV]),
            ("callproperty", new[MEMBER_GET_LV], 0),
            ("convert_i",),
            ("setproperty", new[CONTEXT_KEY_CHARGE]),
        ],
        # ── ActionEvaluator.evalCommand：CreateNormalAttack 改判成 PF ─────
        "pf_override": [
            ("pushstring", s_damage), *_context(), ("in",),
            ("iffalse", "END"),
            *_context(), ("getproperty", new[CONTEXT_KEY_DAMAGE]), ("convert_b",),
            ("iffalse", "END"),
            ("pushtrue",), ("setlocal", EVAL_REG_IS_PF),
            ("pushfalse",), ("setlocal", EVAL_REG_MAIN_SKILL),
            ("pushfalse",), ("setlocal", EVAL_REG_UNISON_SKILL),
            *_context(), ("getproperty", new[CONTEXT_KEY_CHARGE]), ("convert_i",),
            ("setlocal", EVAL_REG_CHARGE_LV),
            # `if(lv < 1 || lv > 3) lv = 1;` —— 两个分支各写一次赋值,不共用落点。
            # 共用落点的写法字节码同样正确,但 FFDec 反编译会把那条赋值提到两个 if
            # 外面渲染成「无条件执行」,回读证据就废了。这里多花 3 条指令换可读性。
            ("getlocal", EVAL_REG_CHARGE_LV), ("pushbyte", CHARGE_LV_MIN),
            ("ifge", "CHECK_HIGH"),
            ("pushbyte", CHARGE_LV_MIN), ("setlocal", EVAL_REG_CHARGE_LV),
            ("jump", "END"),
            ("label", "CHECK_HIGH"),
            ("getlocal", EVAL_REG_CHARGE_LV), ("pushbyte", CHARGE_LV_MAX),
            ("ifle", "END"),
            ("pushbyte", CHARGE_LV_MIN), ("setlocal", EVAL_REG_CHARGE_LV),
        ],
        # ── AbilityDamageShot 构造器：认出稻穗能力 2 的专属追击 ────────────
        "detect": [
            ("getlocal", 4), ("istype", MN["MemberImpl"]),
            ("iffalse", "END"),
            ("findproperty", new[SHOT_SLOTS[0]]),
            ("getlocal", 4), ("astype", MN["MemberImpl"]),
            ("getlocal", 6),
            ("callproperty", new[MEMBER_IS_PF], 1), ("convert_b",),
            ("initproperty", new[SHOT_SLOTS[0]]),
            *_field_read(new[SHOT_SLOTS[0]]), ("convert_b",),
            ("iffalse", "END"),
            ("findproperty", new[SHOT_SLOTS[1]]),
            ("getlocal", 4), ("astype", MN["MemberImpl"]),
            ("callproperty", new[MEMBER_GET_LV], 0), ("convert_i",),
            ("initproperty", new[SHOT_SLOTS[1]]),
        ],
        # ── AbilityDamageShot.finish：5 个值表达式 ────────────────────────
        # `"createdByPowerFlipAction": false` -> `kyubiPfDamage`
        "is_pf": [("pop",), *_field_read(new[SHOT_SLOTS[0]])],
        # `"createdByAbility": true` -> `!kyubiPfDamage`
        "not_ability": [("pop",), *_field_read(new[SHOT_SLOTS[0]]), ("not",)],
        # `"createdByUnisonAbility": _loc10_` -> `!kyubiPfDamage && _loc10_`
        "not_unison": [
            *_field_read(new[SHOT_SLOTS[0]]), ("convert_b",),
            ("iffalse", "END"),
            ("pop",), ("pushfalse",),
        ],
        # `"powerFlipChargeLv": 0` -> `kyubiPfDamage ? kyubiPfChargeLv : 0`
        "charge_lv": [
            *_field_read(new[SHOT_SLOTS[0]]), ("convert_b",),
            ("iffalse", "END"),
            ("pop",), *_field_read(new[SHOT_SLOTS[1]]),
        ],
        # `"incrementCombo": _loc23_` -> `!kyubiPfDamage && _loc23_`
        "no_combo": [
            *_field_read(new[SHOT_SLOTS[0]]), ("convert_b",),
            ("iffalse", "END"),
            ("pop",), ("pushfalse",),
        ],
        # ── 两个新方法的方法体（不是插入块，单独装配）────────────────────
        "_method_is_pf": [
            ("getlocal_0",), ("pushscope",),
            *_field_read(MN["source"]),
            ("astype", MN["CalculatedBattleCharacterLogic"]),
            ("coerce", MN["CalculatedBattleCharacterLogic"]),
            ("setlocal_2",),
            ("getlocal_2",), ("pushnull",), ("ifne", "SCAN"),
            ("pushfalse",), ("returnvalue",),
            ("label", "SCAN"),
            ("pushbyte", 0), ("convert_i",), ("setlocal_3",),
            ("label", "LOOP"),
            ("getlocal_3",),
            *_field_read(MN["abilitySlot"]),
            ("getproperty", MN["instantAbilities"]),
            ("getproperty", MN["length"]), ("convert_i",),
            ("ifge", "NOT_FOUND"),
            *_field_read(MN["abilitySlot"]),
            ("getproperty", MN["instantAbilities"]),
            ("getlocal_3",), ("getproperty", MN["array_index"]),
            ("setlocal", 4),
            ("inclocal_i", 3),
            ("getlocal", 4), ("getproperty", MN["address"]),
            ("getlocal_1",),
            ("ifstrictne", "LOOP"),
            # 命中同一个地址对象：只认主位 2000 / 副位 1002000 两个来源号
            ("getlocal", 4), ("getproperty", MN["source"]),
            ("getproperty", MN["origin"]),
            ("pushint", i_main),
            ("ifne", "TRY_UNISON"),
            ("getlocal_2",), ("getproperty", MN["logic"]),
            ("pushbyte", ABILITY_SLOT_INDEX),
            ("callproperty", MN["getAbilityIdAt"], 1),
            ("coerce", MN["Option"]), ("setlocal", 5),
            *option_is_kyubi_ability2("NO"),
            ("label", "TRY_UNISON"),
            ("getlocal", 4), ("getproperty", MN["source"]),
            ("getproperty", MN["origin"]),
            ("pushint", i_unison),
            ("ifne", "NO"),
            ("getlocal_2",),
            ("callproperty", MN["getUnisonCharacter"], 0),
            ("coerce", MN["Option"]), ("setlocal", 5),
            ("getlocal", 5), ("getproperty", MN["index"]), ("pushbyte", 0),
            ("ifne", "NO"),
            ("getlocal", 5), ("getproperty", MN["params"]), ("pushbyte", 0),
            ("getproperty", MN["array_index"]),
            ("pushbyte", ABILITY_SLOT_INDEX),
            ("callproperty", MN["getAbilityIdAt"], 1),
            ("coerce", MN["Option"]), ("setlocal", 5),
            *option_is_kyubi_ability2("NO"),
            ("label", "NO"),
            ("pushfalse",), ("returnvalue",),
            ("label", "NOT_FOUND"),
            ("pushfalse",), ("returnvalue",),
        ],
        "_method_get_lv": [
            ("getlocal_0",), ("pushscope",),
            *_field_read(MN["squad"]),
            ("callproperty", MN["getLeader"], 0),
            ("coerce", MN["Option"]), ("setlocal_1",),
            ("getlocal_1",), ("getproperty", MN["index"]), ("pushbyte", 0),
            ("ifne", "FALLBACK"),
            ("getlex", MN["Math"]), ("pushbyte", CHARGE_LV_MIN),
            ("getlex", MN["Math"]), ("pushbyte", CHARGE_LV_MAX),
            ("getlocal_1",), ("getproperty", MN["params"]), ("pushbyte", 0),
            ("getproperty", MN["array_index"]),
            ("getproperty", new[MEMBER_SLOT]), ("convert_i",),
            ("callproperty", MN["min"], 2),
            ("callproperty", MN["max"], 2),
            ("convert_i",), ("returnvalue",),
            ("label", "FALLBACK"),
            ("pushbyte", CHARGE_LV_MIN), ("returnvalue",),
        ],
    }


# ---------------------------------------------------------------------------
def _instance(abc, full_name):
    matches = [row for row in abc.instances if abc.mn_name(row[0]) == full_name]
    if len(matches) != 1:
        raise PatchError("expected exactly one %s instance" % full_name)
    return matches[0]


def _slot_trait(name_mn, type_mn):
    trait = abcfmt.Trait()
    trait.name, trait.kind, trait.attr = name_mn, 0, 0
    # slot_id 0 = 自动分配：追加在 trait 表末尾不会挪动任何一个已有槽。
    # 类型的原生默认值（int -> 0，Boolean -> false）就是我们要的，不写 vindex。
    trait.data, trait.metadata = ["slot", 0, type_mn, 0, None], []
    return trait


def _method_trait(name_mn, method_index):
    trait = abcfmt.Trait()
    trait.name, trait.kind, trait.attr = name_mn, 1, 0
    trait.data, trait.metadata = ["method", 0, method_index], []
    return trait


def _append_method(abc, return_type, parameter_types, block, localcount):
    method_index = len(abc.methods)
    abc.methods.append([return_type, list(parameter_types), 0, 0, None, None])
    instructions = asm.assemble(block)
    needed = asm.block_locals(instructions)
    if needed > localcount:
        raise PatchError("the new method needs %d locals, declared %d" % (needed, localcount))
    code, _offsets = asm.encode(instructions)
    maximum_stack, maximum_scope, unreachable = asm.simulate(instructions, 1, abc.multinames)
    if unreachable:
        raise PatchError("the new method has %d unreachable instructions" % unreachable)
    abc.bodies.append([method_index, max(maximum_stack, 1), localcount, 1,
                       max(maximum_scope, 2), code, [], []])
    return method_index, {
        "maxstack": max(maximum_stack, 1), "localcount": localcount,
        "code_bytes": len(code), "instructions": len(instructions),
        "code_sha256": hashlib.sha256(code).hexdigest(),
    }


def _add_members(abc, pool):
    """给 MemberImpl 追加 1 槽 + 2 方法，给 AbilityDamageShot 追加 2 槽。"""
    member = _instance(abc, MEMBER_CLASS)
    shot = _instance(abc, SHOT_CLASS)
    for instance, names in ((member, ADDED_MEMBER_TRAITS), (shot, ADDED_SHOT_TRAITS)):
        for name in names:
            if any(abc.mn_name(t.name) == name for t in instance[6]):
                raise PatchError("%s already carries a %s trait"
                                 % (abc.mn_name(instance[0]), name))

    donor = MN["index"]                      # QName(PackageNamespace(""), "index")
    new = {
        MEMBER_SLOT: pool.public_qname(MEMBER_SLOT, donor),
        MEMBER_IS_PF: pool.public_qname(MEMBER_IS_PF, donor),
        MEMBER_GET_LV: pool.public_qname(MEMBER_GET_LV, donor),
        CONTEXT_KEY_DAMAGE: pool.public_qname(CONTEXT_KEY_DAMAGE, donor),
        CONTEXT_KEY_CHARGE: pool.public_qname(CONTEXT_KEY_CHARGE, donor),
    }
    # AbilityDamageShot 的两个槽与 context 的两个键同名，复用同一个 QName。
    new[SHOT_SLOTS[0]] = new[CONTEXT_KEY_DAMAGE]
    new[SHOT_SLOTS[1]] = new[CONTEXT_KEY_CHARGE]

    blocks = _blocks(pool, new)
    is_pf_index, is_pf_report = _append_method(
        abc, MN["Boolean"], [MN["InstantAbilityAddress"]], blocks["_method_is_pf"], 6)
    get_lv_index, get_lv_report = _append_method(
        abc, MN["int"], [], blocks["_method_get_lv"], 2)

    member[6].append(_slot_trait(new[MEMBER_SLOT], MN["int"]))
    member[6].append(_method_trait(new[MEMBER_IS_PF], is_pf_index))
    member[6].append(_method_trait(new[MEMBER_GET_LV], get_lv_index))
    shot[6].append(_slot_trait(new[SHOT_SLOTS[0]], MN["Boolean"]))
    shot[6].append(_slot_trait(new[SHOT_SLOTS[1]], MN["int"]))
    return new, blocks, {
        MEMBER_IS_PF: dict(is_pf_report, method_index=is_pf_index),
        MEMBER_GET_LV: dict(get_lv_report, method_index=get_lv_index),
    }


# ---------------------------------------------------------------------------
def apply_to_abc(swf: SwfAbc) -> dict:
    global MN
    abc = swf.abc
    if CONTEXT_KEY_DAMAGE.encode() in abc.strings:
        raise PatchError("this SWF already carries %s" % CAPABILITY)
    MN = _resolve(abc)
    MN["InstantAbilityAddress"] = EXPECTED_MULTINAMES[
        ("pinball.online.battle.address", "InstantAbilityAddress")]
    pool = PoolEditor(abc)
    new, blocks, methods = _add_members(abc, pool)

    report = {}
    for name, (base_sha256, before_header, after_header) in TARGETS.items():
        body_index = bodies.resolve(abc, name)
        body = abc.bodies[body_index]
        if hashlib.sha256(body[5]).hexdigest() != base_sha256:
            raise PatchError("%s: unrecognized baseline code (sha256=%s)"
                             % (name, hashlib.sha256(body[5]).hexdigest()))
        if (body[1], body[2]) != before_header:
            raise PatchError("%s: unexpected baseline header %r" % (name, (body[1], body[2])))
        if body[6]:
            raise PatchError("%s: this body unexpectedly has an exception table" % name)
        insertions = [(index, asm.assemble(blocks[key]), policy)
                      for index, key, policy in INSERTIONS[name]]
        for _index, block, _policy in insertions:
            needed = asm.block_locals(block)
            if needed > after_header[1]:
                raise PatchError("%s: block needs %d locals, header declares %d"
                                 % (name, needed, after_header[1]))
        code, exceptions, merged, placed = asm.splice_many(body, insertions)
        if exceptions != body[6]:
            raise PatchError("%s: the exception table moved" % name)
        if asm.unsplice_many(code, placed) != body[5]:
            raise PatchError("%s: the splice is not exactly reversible" % name)
        original_code = body[5]
        body[1], body[2] = after_header
        body[5] = code
        maximum_stack, maximum_scope, _unreachable = asm.simulate(
            merged, body[3], abc.multinames)
        if maximum_stack > body[1]:
            raise PatchError("%s: computed maxstack %d exceeds declared %d"
                             % (name, maximum_stack, body[1]))
        if maximum_scope > body[4]:
            raise PatchError("%s: computed maxscope %d exceeds declared %d"
                             % (name, maximum_scope, body[4]))
        report[name] = {
            "body_index": body_index,
            "insertions": [{"at_instruction": at, "instructions": count, "incoming": policy}
                           for at, count, policy in placed],
            "code_bytes": [len(original_code), len(code)],
            "code_sha256_after": hashlib.sha256(code).hexdigest(),
            "header": {"maxstack": body[1], "localcount": body[2]},
            "computed": {"maxstack": maximum_stack, "maxscope": maximum_scope},
        }
    report["_members"] = {"multinames": new, "methods": methods,
                          "member_traits": list(ADDED_MEMBER_TRAITS),
                          "shot_traits": list(ADDED_SHOT_TRAITS)}
    report["_pool"] = pool.report()
    return report


def apply(source: Path, output: Path) -> dict:
    source, output = Path(source), Path(output)
    if source.resolve() == output.resolve():
        raise PatchError("the input SWF must stay immutable")
    swf = SwfAbc(source)
    report = apply_to_abc(swf)
    swf.save(output)
    report["capability"] = CAPABILITY
    report["source_swf_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    report["output_swf_sha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
    report["output_swf_bytes"] = output.stat().st_size
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = apply(args.source, args.output)
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.report:
        args.report.write_text(text, encoding="utf-8", newline="\n")
    print(text)


if __name__ == "__main__":
    main()
