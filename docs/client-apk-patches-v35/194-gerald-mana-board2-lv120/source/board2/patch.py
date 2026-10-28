"""水杰拉德(129989)玛纳板 2 等级门槛 120 级可逆插片补丁。

范围说明:
  1. `BattleCharacterLogic/getRequiredConditionsToOpenManaBoard(param1:int):Array`
     当 `param1 == 2` 时，把比较 (`get_level() < cap`) 与推入条件
     (`ManaBoardOpenRequiredCondition.Level(cap)`) 的等级门槛 `cap` 从
     `get_baseLevelCap()` 改为 `(this.id == 129989 ? 120 : get_baseLevelCap())`。
     被 `ManaBoardScene/showManaBoardOpenRequiredCondition` 调用，使未解锁玛纳板 2 时点击切换板按钮弹窗显示「需要等级 120」。
  2. `BattleCharacterLogic/getMaxOpenableManaBoard():int`
     把开板门槛判断 `if (get_level() < cap) return 1;` 的 `cap` 同步从
     `get_baseLevelCap()` 改为 `(this.id == 129989 ? 120 : get_baseLevelCap())`。
     该方法是客户端玛纳板 2 能否开启与按钮状态的唯一上游判定源:
       - `OwnedCharacterLogic/existsOpenableManaBoard()` (`get_openedManaBoardIndex() < getMaxOpenableManaBoard()`)
         被 `ManaBoardScene/afterTransitionHandler`、`BoardLogic/characterOpenManaBoardIfPossible`、
         `CharacterLearnManaNodeProcessingFlow/remoteInput` 调用以决定是否自动发 `character/open_mana_board` RPC；
       - `BoardLogic/characterOpenManaBoard()` 将 `getMaxOpenableManaBoard()` 作为目标板号传给服务端；
       - `ManaBoardScene/updateButtonState()` 与 `buttonClicked(1)` 检查 `get_openedManaBoardIndex()`，
         只有阻止 <120 级时自动开板，`openedManaBoardIndex` 才保持为 1（切换板按钮置灰、点击触发条件弹窗）；
       - `OwnedCharacterLogic/existsGettableBondTokenOrManaNode()` 用 `getMaxOpenableManaBoard()` 计算角色红点。
"""
from __future__ import annotations

import hashlib
import asm

CHARACTER_ID = 129989
ID_HIGH_SHIFT6 = 2000  # 2000 << 6 = 128000
ID_LOW_OFFSET = 1989   # 128000 + 1989 = 129989
assert (ID_HIGH_SHIFT6 << 6) + ID_LOW_OFFSET == CHARACTER_ID

REQUIRED_LEVEL_129989 = 120

REQ_COND = "BattleCharacterLogic/getRequiredConditionsToOpenManaBoard"
MAX_OPEN = "BattleCharacterLogic/getMaxOpenableManaBoard"
TARGETS = [REQ_COND, MAX_OPEN]
ADDED: list[str] = []

LOCKS = {
    REQ_COND: {
        "sha": "e541a5919d037a8ca7d5ced7bcc9582ef759491b711f6792196fa9caaff9acad",
        "header": [3, 7, 6, 7],
    },
    MAX_OPEN: {
        "sha": "f41babb70b601e2ae5a162bf0ffd73a927c150ad3dc650da60d49c2ca817469c",
        "header": [2, 8, 6, 7],
    },
}


def _check_locks_and_anchors(e):
    abc = e.abc
    for label, lock in LOCKS.items():
        body = e.body(label)
        actual_sha = hashlib.sha256(body[5]).hexdigest()
        if actual_sha != lock["sha"] or body[1:5] != lock["header"]:
            raise asm.AsmError(
                f"method lock mismatch for {label}: sha={actual_sha} header={body[1:5]}, expected {lock}"
            )

    # Anchor assertions for BattleCharacterLogic/getRequiredConditionsToOpenManaBoard
    req_ins = asm.decode(e.body(REQ_COND)[5])
    if len(req_ins) != 82:
        raise asm.AsmError(f"unexpected {REQ_COND} instruction count: {len(req_ins)}")
    if (
        req_ins[28].name != "getlocal_1"
        or req_ins[29].name != "pushbyte"
        or req_ins[29].args != [2]
        or req_ins[30].name != "ifne"
        or req_ins[30].target != 80
    ):
        raise asm.AsmError(f"unexpected {REQ_COND} param1 == 2 guard at #28..#30")

    for at in (41, 46):
        if (
            req_ins[at].name != "findpropstrict"
            or abc.mn_name(req_ins[at].args[0]) != "get_baseLevelCap"
            or req_ins[at + 1].name != "callproperty"
            or abc.mn_name(req_ins[at + 1].args[0]) != "get_baseLevelCap"
            or req_ins[at + 1].args[1] != 0
        ):
            raise asm.AsmError(f"unexpected {REQ_COND} get_baseLevelCap call at #{at}..#{at + 1}")

    if (
        req_ins[39].name != "findpropstrict"
        or abc.mn_name(req_ins[39].args[0]) != "get_level"
        or req_ins[40].name != "callproperty"
        or abc.mn_name(req_ins[40].args[0]) != "get_level"
        or req_ins[43].name != "ifnlt"
        or req_ins[43].target != 50
    ):
        raise asm.AsmError(f"unexpected {REQ_COND} level comparison anchor at #39..#43")

    if (
        req_ins[45].name != "getlex"
        or abc.mn_name(req_ins[45].args[0]) != "pinball.common.data.ability::ManaBoardOpenRequiredCondition"
        or req_ins[48].name != "callproperty"
        or abc.mn_name(req_ins[48].args[0]) != "Level"
        or req_ins[48].args[1] != 1
    ):
        raise asm.AsmError(f"unexpected {REQ_COND} ManaBoardOpenRequiredCondition.Level anchor at #45..#48")

    # Anchor assertions for BattleCharacterLogic/getMaxOpenableManaBoard
    max_ins = asm.decode(e.body(MAX_OPEN)[5])
    if len(max_ins) != 100:
        raise asm.AsmError(f"unexpected {MAX_OPEN} instruction count: {len(max_ins)}")
    if (
        max_ins[34].name != "findpropstrict"
        or abc.mn_name(max_ins[34].args[0]) != "get_level"
        or max_ins[35].name != "callproperty"
        or abc.mn_name(max_ins[35].args[0]) != "get_level"
        or max_ins[36].name != "findpropstrict"
        or abc.mn_name(max_ins[36].args[0]) != "get_baseLevelCap"
        or max_ins[37].name != "callproperty"
        or abc.mn_name(max_ins[37].args[0]) != "get_baseLevelCap"
        or max_ins[37].args[1] != 0
        or max_ins[38].name != "ifnlt"
        or max_ins[38].target != 41
        or max_ins[39].name != "pushbyte"
        or max_ins[39].args != [1]
        or max_ins[40].name != "returnvalue"
    ):
        raise asm.AsmError(f"unexpected {MAX_OPEN} level cap anchor at #34..#40")


def _cap_override_block(q_id: int, keep_label: str) -> list[tuple]:
    """Replace stack top `get_baseLevelCap()` with 120 iff `this.id == 129989` (0 pool additions)."""
    return [
        ("getlocal_0",),
        ("getproperty", q_id),
        ("pushshort", ID_HIGH_SHIFT6),
        ("pushbyte", 6),
        ("lshift",),
        ("pushshort", ID_LOW_OFFSET),
        ("add_i",),
        ("ifne", keep_label),
        ("pop",),
        ("pushbyte", REQUIRED_LEVEL_129989),
        ("label", keep_label),
    ]


def patch_required_conditions(e):
    q_id = e.q("id")
    e.insert(REQ_COND, 43, _cap_override_block(q_id, "KEEP_CAP_CMP"), incoming=asm.FORBID)
    e.insert(REQ_COND, 48, _cap_override_block(q_id, "KEEP_CAP_PUSH"), incoming=asm.FORBID)


def patch_max_openable(e):
    q_id = e.q("id")
    e.insert(MAX_OPEN, 38, _cap_override_block(q_id, "KEEP_CAP_OPEN"), incoming=asm.FORBID)


def build(e):
    _check_locks_and_anchors(e)
    patch_required_conditions(e)
    patch_max_openable(e)
    return {
        "capability": "character-129989-mana-board2-level-120-v1",
        "character_id": CHARACTER_ID,
        "required_level": REQUIRED_LEVEL_129989,
        "id_access": "this.id (getlocal_0 + getproperty QName(PackageNamespace(''), 'id'), inherited public int slot on GeneralCharacterLogic)",
        "constant_encoding": "(2000 << 6) + 1989 via pushshort/pushbyte/lshift/add_i (0 constant pool additions)",
        "targets": TARGETS,
        "added_methods": ADDED,
    }
