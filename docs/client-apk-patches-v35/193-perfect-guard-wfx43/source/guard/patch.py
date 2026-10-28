"""码43「受伤必定完美防御」单方法插片及 wfxSpec 有符号参数放行。"""
from __future__ import annotations

import hashlib
import asm

CODE = 43
GUARD = "MemberImpl/hasGuarded"
SPEC = "ConditionSlot$/wfxSpec"
TARGETS = [GUARD, SPEC]
ADDED: list[str] = []

LOCKS = {
    GUARD: {
        "sha": "75b49c6aa198f2ccb62d0ab63693b491db806e5f0a3207816478afbf2c4431e0",
        "header": [1, 1, 1, 2],
    },
    SPEC: {
        "sha": "7b6dda3fdfd5f0704a0c02c6c4306eba136e109f130a65fba38432ed4fcd7936",
        "header": [5, 9, 1, 2],
    },
}


def _check_locks_and_anchors(e):
    for label, lock in LOCKS.items():
        body = e.body(label)
        actual_sha = hashlib.sha256(body[5]).hexdigest()
        if actual_sha != lock["sha"] or body[1:5] != lock["header"]:
            raise asm.AsmError(
                f"method lock mismatch for {label}: sha={actual_sha} header={body[1:5]}, expected {lock}"
            )

    # Anchor assertions for MemberImpl/hasGuarded
    guard_ins = asm.decode(e.body(GUARD)[5])
    if len(guard_ins) != 7:
        raise asm.AsmError(f"unexpected {GUARD} instruction count: {len(guard_ins)}")
    expected_ops = [
        "getlocal_0",
        "pushscope",
        "findproperty",
        "getproperty",
        "callproperty",
        "convert_b",
        "returnvalue",
    ]
    if [ins.name for ins in guard_ins] != expected_ops:
        raise asm.AsmError(f"unexpected {GUARD} opcodes: {[ins.name for ins in guard_ins]}")
    if e.abc.mn_name(guard_ins[2].args[0]) != "ball" or guard_ins[3].args[0] != guard_ins[2].args[0]:
        raise asm.AsmError(f"unexpected {GUARD} ball property reference")
    if (
        e.abc.mn_name(guard_ins[4].args[0]) != "pinball.scene.battle.battle.squad.ball:Ball::hasAura"
        or guard_ins[4].args[1] != 0
    ):
        raise asm.AsmError(f"unexpected {GUARD} hasAura call signature")

    # Anchor assertions for ConditionSlot$/wfxSpec
    spec_ins = asm.decode(e.body(SPEC)[5])
    if len(spec_ins) != 212:
        raise asm.AsmError(f"unexpected {SPEC} instruction count: {len(spec_ins)}")
    for at, prev_code in ((122, 36), (185, 36)):
        if spec_ins[at].name != "iflt" or spec_ins[at].target != 204:
            raise asm.AsmError(f"unexpected {SPEC} branch anchor at #{at}: {spec_ins[at]}")
        if spec_ins[at - 6].name != "pushbyte" or spec_ins[at - 6].args != [prev_code]:
            raise asm.AsmError(f"unexpected {SPEC} prior code anchor before #{at}")


def parser(e):
    """按 run12 码36 的做法在 wfxSpec 放行码43的有符号 int32 arg/flags，不动其它码。"""
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1B)
    for at in (122, 185):
        e.insert(
            SPEC,
            at,
            [
                ("getlocal", 6),
                e.number(1),
                ("getproperty", x),
                ("convert_i",),
                e.number(CODE),
                ("ifne", "OLD"),
                ("pop",),
                ("pop",),
                e.number(0),
                e.number(0),
                ("label", "OLD"),
            ],
            incoming=asm.ENTER,
        )


def patch_has_guarded(e):
    """保留原 ball.hasAura() 先判；为假时查 conditionSlot.wfxRows(43, true).length > 0。"""
    q = e.q
    e.insert(
        GUARD,
        6,
        [
            ("iftrue", "GUARDED"),
            ("getlocal_0",),
            ("getproperty", q("conditionSlot")),
            ("dup",),
            ("iffalse", "DONE"),
            e.number(CODE),
            ("pushtrue",),
            ("callproperty", q("wfxRows"), 2),
            ("getproperty", q("length")),
            e.number(0),
            ("greaterthan",),
            ("jump", "DONE"),
            ("label", "GUARDED"),
            ("pushtrue",),
            ("label", "DONE"),
            ("convert_b",),
        ],
        incoming=asm.FORBID,
    )


def build(e):
    _check_locks_and_anchors(e)
    parser(e)
    patch_has_guarded(e)
    return {
        "capability": "wfx-code43-forced-guard-v1",
        "wfx_code": CODE,
        "targets": TARGETS,
        "added_methods": ADDED,
        "holder_query": "this.conditionSlot.wfxRows(43, true).length > 0",
        "priority": "ball.hasAura() checked first; short-circuits to true before reading conditionSlot",
    }
