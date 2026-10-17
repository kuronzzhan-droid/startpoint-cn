"""v34 随包的两项超限客户端补丁（叠在 v33 之上；框架 = perf-v30 perf2_core，只用主 ABC 已有常量池）。

O8 PixelArtCharacter/getPedestalImagePath
   角色详情、玛纳盘、扭蛋结果等像素小人走 globalLogic.getGeneralCharacter(id)，拿到的 GeneralCharacterLogic
   没有突破次数，O6/O7 的超限台座（_6/_7）永远不生效。改为：玩家持有该角色时，改用
   player.getOwnedCharacter(id) 取台座（虚调用落到已打 O6/O7 的方法）。未持有或 player 为空时原样。
O9 OverLimitWindow/getOverLimitState
   超限模式（★5、overLimitStep ≥ 4 且可超限即 get_maxOverLimitStep > 4）且悖论之核（10000302）持有 0 时，传给角色的突破道具列表换成空数组，
   原生逻辑即返回 Impossible(InsufficientEitherStackOrItem)：突破按钮灰掉、点按提示道具不足，
   不再打开 Slider(1, max(1,0)) 的对话框去发注定被服务端拒绝的 count=1 请求。
O10 OverLimitWindow/run、O11 OverLimitWindow/getStatusInformation
   超限模式下突破窗口道具栏从 1 格（只有超限结晶）变成 2 格：超限结晶 + 悖论之核，各显示持有数、0 个灰掉，
   点悖论之核格 = 道具详情（原生 33554432+id 按钮）。原生布局本就支持 2 格（★4 及以下用）。
"""
from __future__ import annotations

import sys

sys.path.insert(0, r"D:/WF/perf-v30-20261015/tools")
from common import asm, bodies  # noqa: E402
from perf2_core import MAIN, Refused, mn_at, splice_with_exits  # noqa: E402

RARITY = 5
RETAIL_STEPS = 4
PARADOX_CORE = (10000, 1000, 302)   # 10000*1000+302 = 10000302，与 O5 相同写法（主 ABC 不追加 int 常量）


def _require(cond, what):
    if not cond:
        raise Refused(what)


def o8_apply(abc, index, pool):
    body = abc.bodies[index]
    _require(body[1:5] == [3, 4, 1, 2] and not body[6] and not body[7], "getPedestalImagePath header")
    code = asm.decode(body[5])
    _require(code[19].name == "setlocal_3" and code[20].name == "getlocal_1"
             and code[21].name == "lookupswitch", "pedestal switch anchor")
    m_gcl = code[17].args[0]
    _require(abc.mn_name(m_gcl).endswith("GeneralCharacterLogic"), "GeneralCharacterLogic coerce")
    run = abc.bodies[bodies.resolve(abc, "PixelArtCharacter/run")]
    m_player = mn_at(abc, run, 10, "initproperty", "player")
    m_id = pool.find("id", 0x07)
    m_has = pool.find("hasOwnedCharacter", 0x07)
    m_get = pool.find("getOwnedCharacter", 0x07)
    block = [
        ("getlocal_0",), ("getproperty", m_player), ("setlocal", 4),
        ("getlocal", 4), ("iffalse", "CONT"),
        ("getlocal", 4), ("getlocal_3",), ("getproperty", m_id), ("callproperty", m_has, 1), ("iffalse", "CONT"),
        ("getlocal", 4), ("getlocal_3",), ("getproperty", m_id), ("callproperty", m_get, 1), ("coerce", m_gcl),
        ("setlocal_3",),
        ("label", "CONT"),
    ]
    old = body[5]
    new, exc, _merged, n = splice_with_exits(body, 20, block, {})
    _require(asm.unsplice(new, 20, n) == old, "inverse splice differs")
    body[1:5] = [3, 5, 1, 2]
    body[5], body[6] = new, exc
    return {"inserted_at": 20, "block_len": n}


def o9_apply(abc, index, pool):
    body = abc.bodies[index]
    _require(body[1:5] == [2, 3, 1, 2] and not body[6] and not body[7], "OverLimitWindow.getOverLimitState header")
    code = asm.decode(body[5])
    _require(code[13].name == "setlocal_2" and code[14].name == "findproperty", "item list anchor")
    m_player = mn_at(abc, body, 3, "getproperty", "player")
    m_array = mn_at(abc, body, 11, "coerce", "Array")
    m_target = mn_at(abc, body, 15, "getproperty", "targetCharacter")
    m_rarity = pool.find("get_rarity", 0x07)
    m_step = pool.find("overLimitStep", 0x07)
    m_items = pool.find("getItemNumber", 0x07)
    a, b, c = PARADOX_CORE
    block = [
        ("getlocal_0",), ("getproperty", m_target), ("callproperty", m_rarity, 0), ("convert_i",),
        ("pushbyte", RARITY), ("ifne", "CONT"),
        ("getlocal_0",), ("getproperty", m_target), ("getproperty", m_step), ("convert_i",),
        ("pushbyte", RETAIL_STEPS), ("iflt", "CONT"),
        ("getlocal_0",), ("getproperty", m_target), ("callproperty", pool.find("get_maxOverLimitStep", 0x07), 0),
        ("convert_i",), ("pushbyte", RETAIL_STEPS), ("ifle", "CONT"),
        ("getlocal_0",), ("getproperty", m_player),
        ("pushshort", a), ("pushshort", b), ("multiply",), ("pushshort", c), ("add",), ("convert_i",),
        ("callproperty", m_items, 1), ("convert_i",), ("pushbyte", 0), ("ifgt", "CONT"),
        ("newarray", 0), ("coerce", m_array), ("setlocal_2",),
        ("label", "CONT"),
    ]
    old = body[5]
    new, exc, _merged, n = splice_with_exits(body, 14, block, {})
    _require(asm.unsplice(new, 14, n) == old, "inverse splice differs")
    body[1:5] = [4, 3, 1, 2]
    body[5], body[6] = new, exc
    return {"inserted_at": 14, "block_len": n}


PATCHES = [
    {"id": "O8", "tag": MAIN, "label": "PixelArtCharacter/getPedestalImagePath", "apply": o8_apply,
     "before": "7a286e705e1416d02a1d9dcbb811f80d238fe48976b8b1b0ab4cbb54888330ed",
     "after": "10eb1e21f915782bcd5715a3fb58670cb18737ae8a5f0f569781f774b1a48f0d"},
    {"id": "O9", "tag": MAIN, "label": "OverLimitWindow/getOverLimitState", "apply": o9_apply,
     "before": "d39a4847f5adfd05c660a4bacd1ea2bad9b13bdabe8b72a72927fa9bbca7bc9b",
     "after": "ae683cc1f5574ac7b415c43cf779ea642535cd6a66531aa1ee51a150d1492068"},
]


# --------------------------------------------------------------------------------------------- O10/O11 两格显示
def _paradox_slot_block(m_target, m_rarity, m_step, m_push, get_list, m_max):
    a, b, c = PARADOX_CORE
    return [
        ("getlocal_0",), ("getproperty", m_target), ("callproperty", m_rarity, 0), ("convert_i",),
        ("pushbyte", RARITY), ("ifne", "CONT"),
        ("getlocal_0",), ("getproperty", m_target), ("getproperty", m_step), ("convert_i",),
        ("pushbyte", RETAIL_STEPS), ("iflt", "CONT"),
        ("getlocal_0",), ("getproperty", m_target), ("callproperty", m_max, 0), ("convert_i",),
        ("pushbyte", RETAIL_STEPS), ("ifle", "CONT"),
        get_list, ("pushshort", a), ("pushshort", b), ("multiply",), ("pushshort", c), ("add",), ("convert_i",),
        ("callpropvoid", m_push, 1),
        ("label", "CONT"),
    ]


def _push_mn(abc):
    donor = abc.bodies[bodies.resolve(abc, "OwnedOverLimitLogic/getOverLimitState")]
    code = asm.decode(donor[5])
    for ins in code:
        if ins.name == "callpropvoid" and abc.mn_name(ins.args[0]).endswith("::push"):
            return ins.args[0]
    raise Refused("push multiname donor")


def _o10_like(abc, index, pool, at, local, header_in, header_out, what):
    body = abc.bodies[index]
    _require(body[1:5] == header_in and not body[6] and not body[7], f"{what} header")
    code = asm.decode(body[5])
    _require(code[at - 4].name == "callproperty" and abc.mn_name(code[at - 4].args[0]) == "getAwakingCrystalToOverLimit"
             and code[at - 1].name in ("setlocal", "setlocal_2"), f"{what} crystal list anchor")
    m_target = mn_at(abc, body, at - 5, "getproperty", "targetCharacter")
    block = _paradox_slot_block(m_target, pool.find("get_rarity", 0x07), pool.find("overLimitStep", 0x07),
                                _push_mn(abc), local, pool.find("get_maxOverLimitStep", 0x07))
    old = body[5]
    new, exc, _merged, n = splice_with_exits(body, at, block, {})
    _require(asm.unsplice(new, at, n) == old, "inverse splice differs")
    body[1:5] = header_out
    body[5], body[6] = new, exc
    return {"inserted_at": at, "block_len": n}


def o10_apply(abc, index, pool):
    """突破窗口按钮：超限模式在超限结晶后追加悖论之核格（点按 = 道具详情）。"""
    return _o10_like(abc, index, pool, 88, ("getlocal", 4), [11, 12, 1, 2], [11, 12, 1, 2], "run")


def o11_apply(abc, index, pool):
    """突破窗口道具栏：超限模式显示两格（超限结晶 + 悖论之核，各自持有数，0 个灰掉）。"""
    return _o10_like(abc, index, pool, 19, ("getlocal_2",), [10, 7, 1, 2], [10, 7, 1, 2], "getStatusInformation")


PATCHES += [
    {"id": "O10", "tag": MAIN, "label": "OverLimitWindow/run", "apply": o10_apply,
     "before": "2787a647de463c9493d6347076db09a4b4417434174a9394f4e77c7352fbc14a",
     "after": "b96160fc0f1046a50cf78065ed8d907861a2a65fb13c4f365abad60cbd4b2a7e"},
    {"id": "O11", "tag": MAIN, "label": "OverLimitWindow/getStatusInformation", "apply": o11_apply,
     "before": "5a3d0744321eb787d738b56df42059611df979f493b0c121fdc239ce491ad83d",
     "after": "c64d19bbf7957fd9490406d4d251abb9d1e16eeb3062e1b49148f56afbd29aa4"},
]


# --------------------------------------------------------------------------------------------- O12 确认框文案
FULLWIDTH_PLUS = "＋"


def o12_apply(abc, index, pool):
    """超限模式确认框：「确定要消耗 1 个超限结晶＋悖论之核吗？」——itemName 后接「＋」+ 悖论之核道具名（取自道具表）。"""
    body = abc.bodies[index]
    _require(body[1:5] == [6, 2, 1, 2] and not body[6] and not body[7], "getDescription header")
    code = asm.decode(body[5])
    _require(code[10].name == "coerce" and code[11].name == "pushstring" and abc.strings[code[11].args[0]] == b"value",
             "itemName anchor")
    m_char = pool.find("character", 0x07)
    m_glob = pool.find("globalLogic", 0x07)
    m_getitem = pool.find("getItem", 0x07)
    m_name = mn_at(abc, body, 9, "callproperty", "get_name")
    m_string = code[10].args[0]
    a, b, c = PARADOX_CORE
    block = [
        ("getlocal_0",), ("getproperty", m_char), ("callproperty", pool.find("get_rarity", 0x07), 0), ("convert_i",),
        ("pushbyte", RARITY), ("ifne", "CONT"),
        ("getlocal_0",), ("getproperty", m_char), ("getproperty", pool.find("overLimitStep", 0x07)), ("convert_i",),
        ("pushbyte", RETAIL_STEPS), ("iflt", "CONT"),
        ("getlocal_0",), ("getproperty", m_char), ("callproperty", pool.find("get_maxOverLimitStep", 0x07), 0),
        ("convert_i",), ("pushbyte", RETAIL_STEPS), ("ifle", "CONT"),
        ("pushstring", pool.string(FULLWIDTH_PLUS)), ("add",),
        ("findproperty", m_glob), ("getproperty", m_glob),
        ("pushshort", a), ("pushshort", b), ("multiply",), ("pushshort", c), ("add",), ("convert_i",),
        ("callproperty", m_getitem, 1), ("callproperty", m_name, 0), ("add",), ("coerce", m_string),
        ("label", "CONT"),
    ]
    old = body[5]
    new, exc, _merged, n = splice_with_exits(body, 11, block, {})
    _require(asm.unsplice(new, 11, n) == old, "inverse splice differs")
    body[1:5] = [9, 2, 1, 2]
    body[5], body[6] = new, exc
    return {"inserted_at": 11, "block_len": n}


PATCHES += [
    {"id": "O12", "tag": MAIN, "label": "ExpodOverLimitByItemDialog/getDescription", "apply": o12_apply,
     "before": "479e1323bda6560e5033a2f4d303e2932412d19c39b340844ecfb9a2d46fbbec",
     "after": "a0468818a62ad753f0d18a755b29af19c61ebf5c3cd4a145c7a5a8cfc8a8be55"},
]
