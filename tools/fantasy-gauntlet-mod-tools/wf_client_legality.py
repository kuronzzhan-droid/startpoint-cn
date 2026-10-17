#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""客户端 AbilityValues.parseAt* 硬规则校验(与数据包无关)。

从 wf_gui 摘出来:写盘前的合法性门禁(wf_rogue_rewards._assert_soul_row_legal)
只需要这一个纯函数,但 wf_gui 在模块级解析 TARGET_STORE,导入即要求本机装好
数据包 —— 于是 CI/干净克隆里跑纯 fixture 的单元测试会直接 SystemExit。
本模块只依赖 wf_describe 的布局表,不碰任何 store。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_describe  # noqa: E402  行级中文描述器(逆向布局+枚举直译)

# instant_content 枚举里由生成解析器按 Bool 读取 `by_each_trigger_puller`
# (列 = instant_content + 25)的 kind:该列没有空串分支,空串即 C7101。
# 来源:注册客户端的 AbilityValues$/parseAt47 与 LeaderAbilityValues$/parseAt45
# 分支表(两者分支集合完全一致,共 120 个 kind);布尔列由 parseAt72
# (body sha256 ecaf73f64756879583ebb509956f6f8c2157d682433832e31f634f27743a6f78)与
# parseAt70 (26f5e75204767b00f7b2dfea46bc32923c347f1654ef98d4a5b88ebb2dc00b6c)解析。
INSTANT_CONTENT_BOOL_KINDS = frozenset({
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
    "30", "31", "214", "219", "223", "224", "228", "391", "392", "393", "394", "395",
    "396", "397", "398", "399", "400", "401", "402", "403", "404", "405", "406", "407",
    "408", "409", "410", "411", "412", "414", "415", "416", "417", "418", "419", "420",
    "421", "422", "423", "424", "425", "426", "427", "428", "429", "430", "431", "432",
    "433", "434", "435", "437", "438", "439", "440", "441", "442", "443", "444", "445",
    "446", "447", "448", "449", "450", "451", "452", "453", "454", "455", "456", "457",
    "458", "468", "470", "475", "479", "486", "489", "530", "531", "532", "688", "689",
    "701", "709", "710", "712", "713", "718",
})

# 同一批条件类 kind 里由 parseAt75(leader: parseAt73)按枚举读取
# `multiply_trigger`(列 = instant_content + 28)的 kind:空串抛 C7050,
# 官方取值 "(None)"/0/1/2。与 Bool 列不同,这个集合更小(41 个 kind),
# 来源:同一 SWF 的解析器分支表(461/525 只读该列,不读 Bool 列)。
INSTANT_CONTENT_MULTIPLY_KINDS = frozenset({
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    "17", "18", "20", "21", "22", "23", "24", "25", "28", "214", "223", "224", "228",
    "461", "468", "470", "486", "489", "525", "701", "709", "710", "712", "713", "718",
})

# 条件类瞬发 kind 里由 parseAtNN 按 Option 读取的字段(列 = instant_content
# +15/+16/+17/+18 = flip_limit / power_flip_limit / end_power_flip_limit /
# end_power_flip_accepted_levels)。这些解析器只把字面量 '(None)' 读成
# Option.None;空串会读成 Some(parseInt('')) = Some(null)(accepted_levels
# 经 convert_i = Some(0))。`InstantAbilitySource$/resolveEndPowerFlipLevels`
# (body sha256 3ad284a25a70fc620654526213b1cc0168648cb719c570c8185348100e416bde)
# 只对 None / Some(1|2|3|11|12) 返回数组,其余值落空返回 undefined;
# 描述生成器随后(`AbilityDescriptionTools$/getContentInstantEndPowerFlip
# AcceptedLevels` -> coerce Array -> .length)对 null 取长度,抛
# TypeError #1009(2026-10-06 凉月角色详情页实锤)。同表官方行 100% 使用
# '(None)' 或合法数字。来源:注册客户端 AbilityValues$/parseAt61..65 与
# LeaderAbilityValues$/parseAt59..63 的分支表(两表字段集合一致,78 个 kind)。
INSTANT_CONTENT_LIMIT_KINDS = frozenset({
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
    "30", "31", "76", "77", "78", "79", "80", "81", "82", "83", "84", "85", "86", "87",
    "88", "89", "90", "91", "92", "93", "94", "196", "198", "214", "216", "219", "221",
    "223", "224", "228", "463", "468", "470", "472", "475", "477", "479", "481", "486",
    "489", "688", "689", "701", "709", "710", "712", "713", "718",
})

# 同一批条件类 kind 里 max_accumulation(列 = instant_content + 14)也是
# Option:空串 = Some(null) = 0 层(与官方 '(None)'=1 层不同),官方行没有这种
# 写法。95 个 kind,来源同上。
INSTANT_CONTENT_MAX_ACCUMULATION_KINDS = frozenset({
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
    "18", "20", "21", "22", "23", "24", "25", "28", "214", "223", "224", "228", "391",
    "392", "393", "394", "395", "396", "397", "398", "399", "400", "401", "402", "403",
    "404", "405", "408", "410", "411", "412", "414", "415", "416", "417", "418", "419",
    "420", "421", "422", "423", "424", "425", "426", "427", "428", "431", "433", "434",
    "435", "437", "438", "439", "440", "441", "442", "443", "444", "445", "446", "447",
    "448", "449", "450", "451", "454", "456", "457", "458", "470", "486", "688", "689",
    "701", "709", "710", "712", "713", "718",
})

# end_power_flip_accepted_levels 的合法编码:其余值 resolveEndPowerFlipLevels
# 落空返回 undefined(见上)。
END_POWER_FLIP_LEVEL_VALUES = frozenset({"1", "2", "3", "11", "12"})


def option_cell_problems(kind: str, row: list[str]) -> list[str]:
    """描述生成链所需的 Option 列门禁(空串=Some(null)/Some(0) -> 角色页 F1009)。

    - 限额族(flip_limit/power_flip_limit/end_power_flip_limit/
      end_power_flip_accepted_levels,列 = instant_content +15..+18):
      空串会被解析成 Some(null) / Some(0),`resolveEndPowerFlipLevels` 对
      Some(0) 返回 undefined,描述生成器再对 null 取 .length 抛
      TypeError #1009(2026-10-06 凉月实锤,详见常量注释)。
    - max_accumulation(+14):空串 = Some(null) = 0 层,官方行只用 '(None)'/数字。

    官方数据在 trigger=0 的整表上 100% 满足本规则(唯一例外是 time 列,它空串
    =0 段,不在此列);本函数只覆盖该缺陷类,不改动其他既有校验。
    """
    lay = wf_describe.layout(kind)
    B = {k: int(v) for k, v in lay["blocks"].items()}
    base = B["instant_content"]

    def cell(i):
        return (row[i] if i < len(row) else "").strip()

    def is_level(v):
        return v == "(None)" or (v and v.lstrip("-").isdigit())

    content = cell(base)
    probs = []
    if content in INSTANT_CONTENT_LIMIT_KINDS:
        for offset, field in ((15, "flip_limit"), (16, "power_flip_limit"),
                              (17, "end_power_flip_limit"),
                              (18, "end_power_flip_accepted_levels")):
            column = base + offset
            value = cell(column)
            if value == "":
                probs.append(
                    f"c{column} {field}='' 须为 '(None)' 或数字"
                    "(空串=Some(null)/Some(0),角色页F1009)"
                )
            elif (field == "end_power_flip_accepted_levels"
                    and value != "(None)"
                    and value not in END_POWER_FLIP_LEVEL_VALUES):
                probs.append(
                    f"c{column} {field}={value!r} 须为 '(None)' 或 "
                    f"1/2/3/11/12(resolveEndPowerFlipLevels 其余值返回 "
                    "undefined,角色页F1009)"
                )
    if content in INSTANT_CONTENT_MAX_ACCUMULATION_KINDS:
        column = base + 14
        value = cell(column)
        if value == "":
            probs.append(
                f"c{column} max_accumulation='' 须为 '(None)' 或数字"
                "(空串=Some(null)=0层,官方无此用法)"
            )
    return probs


def client_legality_problems(kind: str, row: list[str]) -> list[str]:
    """客户端 AbilityValues.parseAt* 硬规则(违者 C7050/7101 打开角色页即崩,2026-07-13 实锤):
    枚举列无空串分支,前置1-3/触发/内容 kind 必须数字;instant_precontent 哨兵 '(None)';
    during_accumulation_trigger 哨兵 '(None)';even_if_owner_dead 必须 true/false;
    条件类 instant_content(by_each_trigger_puller)必须 true/false;
    条件类 instant_content 的 Option 列(flip_limit/…/accepted_levels、
    max_accumulation) 必须 '(None)' 或合法数字(空串=角色页 F1009,2026-10-06 凉月实锤)。"""
    lay = wf_describe.layout(kind)
    B = {k: int(v) for k, v in lay["blocks"].items()}
    tcol = B["precondition1"] - 1

    def cell(i):
        return (row[i] if i < len(row) else "").strip()

    def is_num(v):
        return bool(v) and v.lstrip("-").isdigit()

    probs = []
    tmode = cell(tcol)
    if tmode not in ("0", "1", "2"):
        return [f"c{tcol} 触发模式={tmode!r},须为 0(瞬发)/1(持续)/2(开幕)"]
    for p in ("precondition1", "precondition2", "precondition3"):
        v = cell(B[p])
        if not is_num(v):
            probs.append(f"c{B[p]} {p}.kind={v!r} 须为数字(无条件填 0;空串=客户端C7050)")
    if tmode == "0":
        for name, label in (("instant_trigger", "瞬发触发kind"),
                            ("instant_delay", "延迟"), ("instant_content", "瞬发效果kind")):
            v = cell(B[name])
            if not is_num(v):
                probs.append(f"c{B[name]} {label}={v!r} 须为数字(空串=客户端C7050)")
        v = cell(B["instant_precontent"])
        if v != "(None)" and not is_num(v):
            probs.append(f"c{B['instant_precontent']} instant_precontent={v!r} 须为 '(None)' 或数字")
        # 条件类瞬发效果按 Bool 读 by_each_trigger_puller(instant_content + 25);
        # 空串会让 parseAt72/parseAt70 抛 ClientError 7101(打开角色详情即崩,2026-10-06 凉月实锤)。
        content = cell(B["instant_content"])
        if content in INSTANT_CONTENT_BOOL_KINDS:
            column = B["instant_content"] + 25
            v = cell(column)
            if v.lower() not in ("true", "false"):
                probs.append(
                    f"c{column} by_each_trigger_puller={v!r} 须为 true/false"
                    "(空串=客户端C7101)"
                )
        # multiply_trigger 同属必填枚举:空串 = C7050("不存在的构造函数")。
        if content in INSTANT_CONTENT_MULTIPLY_KINDS:
            column = B["instant_content"] + 28
            v = cell(column)
            if v != "(None)" and not is_num(v):
                probs.append(
                    f"c{column} multiply_trigger={v!r} 须为 '(None)' 或数字"
                    "(空串=客户端C7050)"
                )
        # 条件类瞬发的 Option 列(flip_limit 族 / max_accumulation):
        # 空串 -> Some(null)/Some(0) -> 描述生成器 F1009(2026-10-06 凉月实锤)。
        probs.extend(option_cell_problems(kind, row))
    elif tmode == "1":
        v = cell(B["during_accumulation_trigger"])
        if v != "(None)" and not is_num(v):
            probs.append(f"c{B['during_accumulation_trigger']} 累积触发={v!r} 须为 '(None)' 或数字")
        v = cell(B["during_trigger"])
        if not is_num(v):
            probs.append(f"c{B['during_trigger']} 持续触发kind={v!r} 须为数字")
        v = cell(B["even_if_owner_dead"])
        if v.lower() not in ("true", "false"):
            probs.append(f"c{B['even_if_owner_dead']} even_if_owner_dead={v!r} 须为 true/false(否则C7101)")
        v = cell(B["during_content"])
        if not is_num(v):
            probs.append(f"c{B['during_content']} 持续效果kind={v!r} 须为数字")
    else:
        v = cell(B["opening"])
        if not is_num(v):
            probs.append(f"c{B['opening']} 开幕kind={v!r} 须为数字")
    return probs
