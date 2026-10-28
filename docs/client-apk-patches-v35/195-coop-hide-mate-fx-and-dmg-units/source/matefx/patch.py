"""Insert-only client patch suppressing coop teammate heavy visual effects, adding k/m/b/t damage notation
with tier-colored m/b/t digits and untinted m/b/t unit glyphs, merging all direct-attack damage numbers in
lightweight mode, and restricting drill-dash target lock to in-bounds enemies (BOSS first, then in-bounds enemies;
no dash when no in-bounds target exists) (P1-P8).

Only the 13 approved methods are touched (pure instruction insertions, no classes/methods/traits added,
constant pool append-only):
  * P1:  BattleViewInputSettings/isOtherBattleActionVisible -> always return false
  * P2:  Battle/preparation -> assign showOthersMultiball = false after native assignment
  * P2b: BattleView/show (owner != -1 branch, case 43 Ball) -> return removeKey if !param2.params[0].isPrimary()
  * P3:  BattleView/show (owner != -1 branch, case 55 CutinActionSkill) -> return removeKey immediately
  * P4:  EffectManagerImpl/canPlayEffect -> return false immediately when primary (param1) is false
  * P5:  EffectManagerImpl/show (SimpleEffectKind case 63 HitEffect) -> suppress when battle.lightweightModeLevel >= 1
         while preserving getRandomRotation() call count
  * P6:  DamageEffectView$/unitPrefix, DamageEffectView$/resolvePath, DamageEffectView/createSprite,
         AccumulationDamageIndicatorView/createDigit, AccumulationDamageIndicatorView/updateDigits
         -> add >= 1e13 't', >= 1e10 'b', >= 1e7 'm' notation, texture/frame mapping, tint all digits and decimal
            point ('@') of m/b/t numbers with tier colors (m: 0x40D8FF, b: 0xFF4FB4, t: 0xA070FF) while keeping
            m/b/t unit glyphs untinted (0xFFFFFF) and non-abbreviated / 'k' numbers at their original damage-type color
  * P7:  DamageIndicatorManager/wfxMergeDamage -> treat per-target individual display cap as 0 when
         battle.lightweightModeLevel >= 1 and info.createdByDirectAttack is true
  * P8:  BallImpl/wfxFindDashEnemy -> skip candidate enemies whose (getPosX(), getPosY()) is outside
         zoneManager.getCurrentZone().bounds (keeping BOSS-first + nearest in-bounds selection);
         BallImpl/wfxTryDashReplacement -> when local5[0] == "wfx_dash_v2" and !this.wfxFindDashEnemy(),
         silently return true (no dash, no failure animation, no fallback to native escape)
"""
from __future__ import annotations

import hashlib
import json

import asm
import bodies
from avm_interp import slice_method

P1_LABEL = "BattleViewInputSettings/isOtherBattleActionVisible"
P2_LABEL = "Battle/preparation"
P3_LABEL = "BattleView/show"
P4_LABEL = "EffectManagerImpl/canPlayEffect"
P5_LABEL = "EffectManagerImpl/show"
P6_UNIT_PREFIX_LABEL = "DamageEffectView$/unitPrefix"
P6_RESOLVE_PATH_LABEL = "DamageEffectView$/resolvePath"
P6_CREATE_SPRITE_LABEL = "DamageEffectView/createSprite"
P6_CREATE_DIGIT_LABEL = "AccumulationDamageIndicatorView/createDigit"
P6_UPDATE_DIGITS_LABEL = "AccumulationDamageIndicatorView/updateDigits"
P7_LABEL = "DamageIndicatorManager/wfxMergeDamage"
P8_FIND_ENEMY_LABEL = "BallImpl/wfxFindDashEnemy"
P8_TRY_REPLACEMENT_LABEL = "BallImpl/wfxTryDashReplacement"

TARGETS = (
    P1_LABEL,
    P2_LABEL,
    P3_LABEL,
    P4_LABEL,
    P5_LABEL,
    P6_UNIT_PREFIX_LABEL,
    P6_RESOLVE_PATH_LABEL,
    P6_CREATE_SPRITE_LABEL,
    P6_CREATE_DIGIT_LABEL,
    P6_UPDATE_DIGITS_LABEL,
    P7_LABEL,
    P8_FIND_ENEMY_LABEL,
    P8_TRY_REPLACEMENT_LABEL,
)

UNIT_PREFIX_M_PATH = "battle/common/layer1/damage_font/unit_prefix_m"
UNIT_PREFIX_B_PATH = "battle/common/layer1/damage_font/unit_prefix_b"
UNIT_PREFIX_T_PATH = "battle/common/layer1/damage_font/unit_prefix_t"

TIER_M_COLOR = 0x40D8FF  # 4249855 (cyan)
TIER_B_COLOR = 0xFF4FB4  # 16732084 (pink)
TIER_T_COLOR = 0xA070FF  # 10514687 (purple)
UNIT_GLYPH_COLOR = 0xFFFFFF  # 16777215 (untinted)

# Exact method locks for unmodified methods (P1, P2, P4, P6, P7, P8).
EXACT_METHOD_LOCKS = {
    P1_LABEL: {
        "sha": "d46ba2ae3f96d22aa71dfc7e38981756d9b300c18feaea381355b95b23095bff",
        "header": [2, 1, 1, 2],
    },
    P2_LABEL: {
        "sha": "4a8a50eb363cf8cb301f26b96073f65c2feb148f4a3ef05891e0f35077635f5b",
        "header": [13, 10, 1, 2],
    },
    P4_LABEL: {
        "sha": "a7e15c6d738a4435d599fad14075e1e40db060cd14f49bd2e73dcc6fd8fcfdf9",
        "header": [2, 3, 1, 2],
    },
    P6_UNIT_PREFIX_LABEL: {
        "sha": "f4fa62a29a9a4ae7249ea9f2ce7ac58084a8c8235c6042a86af2d2d7d36fb49f",
        "header": [4, 6, 1, 1],
    },
    P6_RESOLVE_PATH_LABEL: {
        "sha": "7124bb28cb2f392b9e7406f60915d7572c08b3683f80497cdbc32e40bb97f506",
        "header": [2, 3, 1, 1],
    },
    P6_CREATE_SPRITE_LABEL: {
        "sha": "0ac0261ec8513ccc05ed668f67d2efdaed5ee07f4b0063e8a290b822ba0051d8",
        "header": [4, 9, 1, 2],
    },
    P6_CREATE_DIGIT_LABEL: {
        "sha": "612c8257e30de1731aa0e71a52a44c904cebe51abc12f866e64942de7424082c",
        "header": [13, 2, 1, 2],
    },
    P6_UPDATE_DIGITS_LABEL: {
        "sha": "0ca955f7911d8711364b50f0d45c2ffd368ea42a6de648d4072ecc2f17bce427",
        "header": [5, 8, 1, 2],
    },
    P7_LABEL: {
        "sha": "17efcd692f84bccd8008f0f42c7c6922551854639bdfec060c6c6f0e11e1e930",
        "header": [5, 10, 1, 2],
    },
    P8_FIND_ENEMY_LABEL: {
        "sha": "fd25278f7439aa0bc3a9b8b2ef9ff1337133e8b1ca953e80b1e567a0b16f9189",
        "header": [3, 11, 1, 2],
    },
    P8_TRY_REPLACEMENT_LABEL: {
        "sha": "980cb0b4564588e0de1a9eb49110551c38bdf58162e2ed16595a1c9ddcec01c3",
        "header": [8, 9, 1, 2],
    },
}

# P2b + P3 (BattleView/show) may or may not carry v35n's case 47 splice; lock header + case 43 & case 55 slices.
P3_HEADER_LOCK = [10, 15, 1, 2]
P2B_CASE43_NORMALIZED_SHA256 = "446afca99926d1fdf2a8ffd94274b3664e126467b4539d236b4b0965ddb9ac76"
P3_CASE55_NORMALIZED_SHA256 = "da508a81f3fd933eefa05733df72609c33ea5b426472e72a493873f40d4200bc"
P3_CASE55_TAIL_RAW_SHA256 = "537f4a1e199881bc215621ae46a3d44067d1da354443cfbc994aa6ab3b942766"

# P5 (EffectManagerImpl/show) may or may not carry v35n's hitbudget splice at case 63; lock header + case 63 slice.
P5_HEADER_LOCK = [11, 9, 1, 2]
P5_CASE63_NATIVE_NORMALIZED_SHA256 = "59b13adc06f857d443c6911eb6f0242b5facebbdf87c7d4b75bde8f318dea4e2"


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _short(abc, mn_index: int) -> str:
    return abc.mn_name(mn_index).split("::")[-1]


def _check_op_names(ins, expected: dict[int, str], context: str) -> None:
    for idx, op_name in expected.items():
        if idx >= len(ins) or ins[idx].name != op_name:
            actual = ins[idx].name if idx < len(ins) else "<out-of-range>"
            raise asm.AsmError(f"{context} anchor shape mismatch at #{idx}: {actual} != {op_name}")


def _normalize_slice_ins(abc, ins_item, base: int, epilogue: int) -> list:
    args = []
    for pos, val in enumerate(ins_item.args):
        kind = asm.opwalk.KIND.get((ins_item.op, pos))
        if kind == "multiname":
            mn = abc.multinames[val]
            args.append(f"rt:{mn[0]:02x}" if mn[0] in (0x1B, 0x1C) else abc.mn_name(val))
        elif kind == "string":
            args.append(abc.s(val))
        elif kind in ("int", "uint", "double"):
            args.append(getattr(abc, kind + "s")[val])
        else:
            args.append(val)
    tgt = None if ins_item.target is None else ("EPILOGUE" if ins_item.target == epilogue else ins_item.target - base)
    return [ins_item.name, args, tgt]


def _verify_single_switch_entry(ins, switch_idx: int, case_no: int, target_pc: int, label: str) -> None:
    incoming_branches = []
    for idx, item in enumerate(ins):
        if item.target == target_pc:
            incoming_branches.append(("branch", idx))
        if item.cases is not None:
            if item.default == target_pc:
                incoming_branches.append(("switch_default", idx))
            for c_no, target in enumerate(item.cases):
                if target == target_pc:
                    incoming_branches.append(("switch_case", idx, c_no))
    if incoming_branches != [("switch_case", switch_idx, case_no)]:
        raise asm.AsmError(
            f"{label} unexpected incoming branches to case {case_no} (#{target_pc}): {incoming_branches}"
        )


def _verify_p1(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P1_LABEL)]
    lock = EXACT_METHOD_LOCKS[P1_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P1_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 9:
        raise asm.AsmError(f"{P1_LABEL} expected 9 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            0: "getlocal_0",
            1: "pushscope",
            2: "findproperty",
            3: "getproperty",
            4: "getlex",
            5: "getproperty",
            6: "callproperty",
            7: "convert_b",
            8: "returnvalue",
        },
        P1_LABEL,
    )
    if _short(abc, ins[2].args[0]) != "battle" or _short(abc, ins[3].args[0]) != "battle":
        raise asm.AsmError(f"{P1_LABEL} expected battle property at #2/#3")
    if abc.mn_name(ins[4].args[0]) != "pinball.scene.battle.battle::SkippableLogicKind":
        raise asm.AsmError(f"{P1_LABEL} expected SkippableLogicKind at #4")
    if _short(abc, ins[5].args[0]) != "Action" or _short(abc, ins[6].args[0]) != "isRichMode":
        raise asm.AsmError(f"{P1_LABEL} expected isRichMode(SkippableLogicKind.Action) at #5/#6")
    return {"insert_at": 2, "incoming": asm.FORBID, "before_sha256": _sha(body[5])}


def _verify_p2(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P2_LABEL)]
    lock = EXACT_METHOD_LOCKS[P2_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P2_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    _check_op_names(
        ins,
        {
            84: "findproperty",
            98: "initproperty",
            99: "findproperty",
            110: "initproperty",
            111: "findproperty",
            124: "initproperty",
            125: "findproperty",
            138: "initproperty",
            139: "findproperty",
            140: "pushtrue",
            141: "findproperty",
            142: "getproperty",
            143: "getproperty",
            144: "pushbyte",
            145: "ifeq",
            146: "pop",
            147: "findproperty",
            148: "getproperty",
            149: "pushbyte",
            150: "lessthan",
            151: "convert_b",
            152: "initproperty",
            153: "findproperty",
        },
        P2_LABEL,
    )
    expected_props = {
        84: "lightweightModeLevel",
        98: "lightweightModeLevel",
        99: "shouldEmitParticle",
        110: "shouldEmitParticle",
        111: "enableGuideline",
        124: "enableGuideline",
        125: "enableEscapeMarker",
        138: "enableEscapeMarker",
        139: "showOthersMultiball",
        152: "showOthersMultiball",
        153: "xdebugSettings",
    }
    for idx, prop_name in expected_props.items():
        if _short(abc, ins[idx].args[0]) != prop_name:
            raise asm.AsmError(f"{P2_LABEL} expected {prop_name} at #{idx}, got {abc.mn_name(ins[idx].args[0])}")
    if ins[139].args[0] != ins[152].args[0]:
        raise asm.AsmError(f"{P2_LABEL} showOthersMultiball multiname mismatch between #139 and #152")
    if ins[145].target != 152:
        raise asm.AsmError(f"{P2_LABEL} #145 ifeq target mismatch: {ins[145].target} != 152")
    multiball_writes = [
        i for i, x in enumerate(ins)
        if x.name in ("initproperty", "setproperty") and _short(abc, x.args[0]) == "showOthersMultiball"
    ]
    if multiball_writes != [152]:
        raise asm.AsmError(f"{P2_LABEL} unexpected showOthersMultiball writes: {multiball_writes}")
    return {
        "insert_at": 153,
        "incoming": asm.FORBID,
        "show_others_multiball_mn": ins[152].args[0],
        "before_sha256": _sha(body[5]),
    }


def _normalize_p3_ins(abc, ins_item, base: int, epilogue: int) -> list:
    args = []
    for pos, val in enumerate(ins_item.args):
        kind = asm.opwalk.KIND.get((ins_item.op, pos))
        if kind == "multiname":
            mn = abc.multinames[val]
            args.append(f"rt:{mn[0]:02x}" if mn[0] in (0x1B, 0x1C) else abc.mn_name(val))
        else:
            args.append(val)
    tgt = None if ins_item.target is None else ("EPILOGUE" if ins_item.target == epilogue else ins_item.target - base)
    return [ins_item.name, args, tgt]


def _verify_p3(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P3_LABEL)]
    if body[1:5] != P3_HEADER_LOCK:
        raise asm.AsmError(f"{P3_LABEL} header lock mismatch: {body[1:5]} != {P3_HEADER_LOCK}")
    ins = asm.decode(body[5])
    _check_op_names(
        ins,
        {
            41: "setlocal",
            42: "getlocal_1",
            43: "pushbyte",
            44: "ifne",
            45: "getlocal_2",
            46: "getproperty",
            47: "lookupswitch",
        },
        f"{P3_LABEL} prologue",
    )
    if ins[41].args != [5] or ins[43].args != [255]:
        raise asm.AsmError(f"{P3_LABEL} prologue removeKey/owner check mismatch")
    mine_sw = ins[47]
    if len(mine_sw.cases) != 106:
        raise asm.AsmError(f"{P3_LABEL} primary switch case count mismatch: {len(mine_sw.cases)}")
    mine_c43 = mine_sw.cases[43]
    if "BallView" not in abc.mn_name(ins[mine_c43 + 2].args[0]):
        raise asm.AsmError(f"{P3_LABEL} primary case 43 is not BallView")
    mine_c55 = mine_sw.cases[55]
    if "CutinActionSkillView1" not in abc.mn_name(ins[mine_c55 + 2].args[0]):
        raise asm.AsmError(f"{P3_LABEL} primary case 55 is not CutinActionSkillView1")

    else_entry = ins[44].target
    _check_op_names(
        ins,
        {
            else_entry: "getlocal_2",
            else_entry + 1: "getproperty",
            else_entry + 2: "lookupswitch",
        },
        f"{P3_LABEL} other-branch dispatch",
    )
    other_sw = ins[else_entry + 2]
    if len(other_sw.cases) != 106:
        raise asm.AsmError(f"{P3_LABEL} other-branch switch case count mismatch: {len(other_sw.cases)}")
    epilogue = len(ins) - 2

    # --- P2b: other-branch case 43 (BallView) ---
    c43 = other_sw.cases[43]
    if c43 == mine_c43:
        raise asm.AsmError(f"{P3_LABEL} other-branch case 43 collides with primary case 43")
    if ins[c43 - 1].name != "jump" or ins[c43 - 1].target != epilogue:
        raise asm.AsmError(f"{P3_LABEL} instruction before case 43 is not break jump to epilogue")
    _verify_single_switch_entry(ins, else_entry + 2, 43, c43, P3_LABEL)

    c43_norm_repr = [_normalize_slice_ins(abc, ins[i], c43, epilogue) for i in range(c43, c43 + 22)]
    c43_norm_sha = _sha(json.dumps(c43_norm_repr, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    if c43_norm_sha != P2B_CASE43_NORMALIZED_SHA256:
        raise asm.AsmError(f"{P3_LABEL} case 43 normalized anchor sha mismatch: {c43_norm_sha}")

    m_params = ins[c43 + 9].args[0]
    rt = ins[c43 + 11].args[0]
    m_ball_peek = ins[c43 + 12].args[0]
    if _short(abc, m_params) != "params" or abc.multinames[rt][0] != 0x1B:
        raise asm.AsmError(f"{P3_LABEL} case 43 params/rt operand mismatch")
    if abc.mn_name(m_ball_peek) != "pinball.scene.battle.battle.squad.ball::BallPeek":
        raise asm.AsmError(f"{P3_LABEL} case 43 coerce is not BallPeek: {abc.mn_name(m_ball_peek)}")

    bv_is_primary_ins = asm.decode(abc.bodies[bodies.resolve(abc, "BallView/isPrimary")][5])
    _check_op_names(bv_is_primary_ins, {4: "callproperty", 5: "convert_b", 6: "returnvalue"}, "BallView/isPrimary")
    m_ball_is_primary = bv_is_primary_ins[4].args[0]
    if abc.mn_name(m_ball_is_primary) != "pinball.scene.battle.battle.squad.ball:BallPeek::isPrimary":
        raise asm.AsmError(f"BallView/isPrimary unexpected multiname: {abc.mn_name(m_ball_is_primary)}")

    # --- P3: other-branch case 55 (CutinActionSkill) ---
    c55 = other_sw.cases[55]
    if c55 == mine_c55:
        raise asm.AsmError(f"{P3_LABEL} other-branch case 55 collides with primary case 55")
    if ins[c55 - 1].name != "jump" or ins[c55 - 1].target != epilogue:
        raise asm.AsmError(f"{P3_LABEL} instruction before case 55 is not break jump to epilogue")
    _verify_single_switch_entry(ins, else_entry + 2, 55, c55, P3_LABEL)

    slice_repr = {
        "case55": [_normalize_p3_ins(abc, ins[i], c55, epilogue) for i in range(c55, c55 + 17)],
        "epilogue": [_normalize_p3_ins(abc, ins[i], epilogue, epilogue) for i in range(epilogue, epilogue + 2)],
    }
    norm_raw = json.dumps(slice_repr, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    norm_sha = _sha(norm_raw)
    if norm_sha != P3_CASE55_NORMALIZED_SHA256:
        raise asm.AsmError(f"{P3_LABEL} case 55 normalized anchor sha mismatch: {norm_sha}")

    tail_raw = asm.encode(slice_method(ins, c55, len(ins), ()))[0]
    tail_sha = _sha(tail_raw)
    if tail_sha != P3_CASE55_TAIL_RAW_SHA256:
        raise asm.AsmError(f"{P3_LABEL} case 55 tail bytecode sha mismatch: {tail_sha}")

    return {
        "case43_insert_at": c43,
        "case43_incoming": asm.ENTER,
        "case43_normalized_sha256": c43_norm_sha,
        "params_mn": m_params,
        "rt_mn": rt,
        "ball_peek_mn": m_ball_peek,
        "ball_is_primary_mn": m_ball_is_primary,
        "insert_at": c55,
        "incoming": asm.ENTER,
        "return_local": ins[epilogue].args[0],
        "else_switch_at": else_entry + 2,
        "epilogue_at": epilogue,
        "case55_normalized_sha256": norm_sha,
        "case55_tail_raw_sha256": tail_sha,
        "before_sha256": _sha(body[5]),
    }


def _verify_p4(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P4_LABEL)]
    lock = EXACT_METHOD_LOCKS[P4_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P4_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 33:
        raise asm.AsmError(f"{P4_LABEL} expected 33 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            0: "getlocal_0",
            1: "pushscope",
            2: "getlocal_1",
            3: "iffalse",
            4: "pushtrue",
            5: "returnvalue",
            6: "getlocal_2",
            7: "getproperty",
            8: "pushbyte",
            9: "ifne",
            16: "lookupswitch",
            18: "findproperty",
            25: "findproperty",
            31: "pushfalse",
            32: "returnvalue",
        },
        P4_LABEL,
    )
    if ins[3].target != 6 or ins[9].target != 31:
        raise asm.AsmError(f"{P4_LABEL} branch target mismatch: #3->{ins[3].target}, #9->{ins[9].target}")
    if ins[16].cases[33] != 18 or ins[16].cases[34] != 25:
        raise asm.AsmError(f"{P4_LABEL} SimpleEffectKind 33/34 switch targets mismatch")
    if _short(abc, ins[19].args[0]) != "battle" or _short(abc, ins[20].args[0]) != "lightweightModeLevel":
        raise asm.AsmError(f"{P4_LABEL} expected battle.lightweightModeLevel at #19/#20")
    return {
        "insert_at": 6,
        "incoming": asm.ENTER,
        "battle_mn": ins[19].args[0],
        "lightweight_mode_level_mn": ins[20].args[0],
        "before_sha256": _sha(body[5]),
    }


def _verify_p5(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P5_LABEL)]
    if body[1:5] != P5_HEADER_LOCK:
        raise asm.AsmError(f"{P5_LABEL} header lock mismatch: {body[1:5]} != {P5_HEADER_LOCK}")
    ins = asm.decode(body[5])
    _check_op_names(
        ins,
        {
            20: "findproperty",
            24: "callproperty",
            27: "iffalse",
            28: "returnvoid",
            29: "getlocal_1",
            30: "getproperty",
            31: "lookupswitch",
            33: "getlocal_1",
            39: "setlocal_2",
            40: "getlocal_2",
            41: "getproperty",
            42: "lookupswitch",
        },
        f"{P5_LABEL} prologue",
    )
    if _short(abc, ins[24].args[0]) != "canPlayEffect":
        raise asm.AsmError(f"{P5_LABEL} expected canPlayEffect at #24")
    outer_sw = ins[31]
    inner_sw = ins[42]
    if len(outer_sw.cases) != 9 or outer_sw.cases[0] != 33:
        raise asm.AsmError(f"{P5_LABEL} outer switch mismatch")
    if len(inner_sw.cases) != 96:
        raise asm.AsmError(f"{P5_LABEL} inner SimpleEffectKind switch case count mismatch: {len(inner_sw.cases)}")

    c63 = inner_sw.cases[63]
    _verify_single_switch_entry(ins, 42, 63, c63, P5_LABEL)

    has_hitbudget = (
        ins[c63].name == "getlocal_0"
        and ins[c63 + 1].name == "callproperty"
        and _short(abc, ins[c63 + 1].args[0]) == "wfxHitAllow"
    )
    if has_hitbudget:
        _check_op_names(
            ins,
            {
                c63: "getlocal_0",
                c63 + 1: "callproperty",
                c63 + 2: "iftrue",
                c63 + 3: "getlocal_2",
                c63 + 4: "getproperty",
                c63 + 5: "pushbyte",
                c63 + 6: "getproperty",
                c63 + 7: "convert_b",
                c63 + 8: "iffalse",
                c63 + 9: "getlocal_0",
                c63 + 10: "callproperty",
                c63 + 11: "pop",
                c63 + 12: "returnvoid",
            },
            f"{P5_LABEL} hitbudget prefix",
        )
        if ins[c63 + 2].target != c63 + 13 or ins[c63 + 8].target != c63 + 12:
            raise asm.AsmError(f"{P5_LABEL} hitbudget internal branch targets mismatch")
        native_c63 = c63 + 13
    else:
        native_c63 = c63

    break_jump = ins[native_c63 + 76]
    if break_jump.name != "jump" or ins[c63 - 1].name != "jump" or ins[c63 - 1].target != break_jump.target:
        raise asm.AsmError(f"{P5_LABEL} case 63 break jump mismatch")
    exit_pc = break_jump.target
    while ins[exit_pc].name == "jump":
        exit_pc = ins[exit_pc].target
    if ins[exit_pc].name != "returnvoid":
        raise asm.AsmError(f"{P5_LABEL} case 63 break exit does not resolve to returnvoid")

    c63_norm_repr = [
        _normalize_slice_ins(abc, ins[i], native_c63, break_jump.target)
        for i in range(native_c63, native_c63 + 77)
    ]
    c63_norm_sha = _sha(json.dumps(c63_norm_repr, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    if c63_norm_sha != P5_CASE63_NATIVE_NORMALIZED_SHA256:
        raise asm.AsmError(f"{P5_LABEL} case 63 native slice sha mismatch: {c63_norm_sha}")

    m_params = ins[native_c63 + 1].args[0]
    rt = ins[native_c63 + 3].args[0]
    m_rot = ins[native_c63 + 33].args[0]
    if _short(abc, m_params) != "params" or abc.multinames[rt][0] != 0x1B or _short(abc, m_rot) != "getRandomRotation":
        raise asm.AsmError(f"{P5_LABEL} case 63 operand mismatch")

    p4_info = _verify_p4(abc)
    return {
        "insert_at": c63,
        "incoming": asm.ENTER,
        "has_v35n_hitbudget": has_hitbudget,
        "native_case63_at": native_c63,
        "case63_native_normalized_sha256": c63_norm_sha,
        "battle_mn": p4_info["battle_mn"],
        "lightweight_mode_level_mn": p4_info["lightweight_mode_level_mn"],
        "params_mn": m_params,
        "rt_mn": rt,
        "get_random_rotation_mn": m_rot,
        "before_sha256": _sha(body[5]),
    }


def _verify_p6_unit_prefix(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P6_UNIT_PREFIX_LABEL)]
    lock = EXACT_METHOD_LOCKS[P6_UNIT_PREFIX_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P6_UNIT_PREFIX_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 88:
        raise asm.AsmError(f"{P6_UNIT_PREFIX_LABEL} expected 88 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            10: "setlocal",
            11: "getlocal_1",
            12: "pushint",
            13: "ifnge",
            14: "getlex",
            15: "getlex",
            16: "getlocal_1",
            17: "pushbyte",
            18: "divide",
            19: "pushdouble",
            25: "callproperty",
            29: "callproperty",
            32: "setlocal_2",
            34: "pushstring",
            35: "callproperty",
            38: "setlocal_3",
            41: "ifne",
            46: "pushstring",
            49: "returnvalue",
            54: "callproperty",
            63: "callproperty",
            71: "pushstring",
            77: "pushstring",
            80: "returnvalue",
            81: "getlex",
            85: "callproperty",
            87: "returnvalue",
        },
        P6_UNIT_PREFIX_LABEL,
    )
    if abc.ints[ins[12].args[0]] != 10000 or ins[13].target != 81 or ins[41].target != 51:
        raise asm.AsmError(f"{P6_UNIT_PREFIX_LABEL} k-branch threshold/target mismatch")
    if abc.doubles[ins[19].args[0]] != 1e-10 or abc.doubles[ins[22].args[0]] != 1e-10:
        raise asm.AsmError(f"{P6_UNIT_PREFIX_LABEL} expected 1e-10 double constants at #19/#22")
    if abc.s(ins[34].args[0]) != "." or abc.s(ins[46].args[0]) != "@0k" or abc.s(ins[71].args[0]) != "@" or abc.s(ins[77].args[0]) != "k":
        raise asm.AsmError(f"{P6_UNIT_PREFIX_LABEL} expected string constants mismatch")
    return {
        "insert_at": 11,
        "incoming": asm.FORBID,
        "string_type_mn": ins[1].args[0],
        "std_mn": ins[14].args[0],
        "math_mn": ins[15].args[0],
        "double_1e_10_idx": ins[19].args[0],
        "floor_mn": ins[25].args[0],
        "string_mn": ins[29].args[0],
        "dot_str_idx": ins[34].args[0],
        "index_of_mn": ins[35].args[0],
        "empty_str_idx": ins[42].args[0],
        "substr_mn": ins[54].args[0],
        "at_str_idx": ins[71].args[0],
        "before_sha256": _sha(body[5]),
    }


def _verify_p6_resolve_path(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P6_RESOLVE_PATH_LABEL)]
    lock = EXACT_METHOD_LOCKS[P6_RESOLVE_PATH_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P6_RESOLVE_PATH_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 82:
        raise asm.AsmError(f"{P6_RESOLVE_PATH_LABEL} expected 82 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            69: "getlocal_2",
            70: "pushstring",
            71: "ifne",
            72: "pushstring",
            73: "returnvalue",
            74: "jump",
            75: "getlex",
            79: "pushstring",
            80: "throw",
        },
        P6_RESOLVE_PATH_LABEL,
    )
    if abc.s(ins[70].args[0]) != "k" or abc.s(ins[72].args[0]) != "battle/common/layer1/damage_font/unit_prefix_k":
        raise asm.AsmError(f"{P6_RESOLVE_PATH_LABEL} expected 'k' branch at #69..#73")
    if ins[71].target != 75 or abc.s(ins[79].args[0]) != "UNEXPECTED CHAR":
        raise asm.AsmError(f"{P6_RESOLVE_PATH_LABEL} expected throw 'UNEXPECTED CHAR' at #75..#80")
    return {
        "insert_at": 75,
        "incoming": asm.ENTER,
        "before_sha256": _sha(body[5]),
    }


def _verify_p6_create_sprite(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P6_CREATE_SPRITE_LABEL)]
    lock = EXACT_METHOD_LOCKS[P6_CREATE_SPRITE_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P6_CREATE_SPRITE_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 142:
        raise asm.AsmError(f"{P6_CREATE_SPRITE_LABEL} expected 142 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            75: "getlocal_1",
            76: "getlex",
            77: "findproperty",
            78: "getproperty",
            79: "getlocal",
            80: "getproperty",
            82: "callproperty",
            84: "callproperty",
            87: "setlocal",
            88: "getlocal",
            89: "findproperty",
            90: "getproperty",
            91: "callproperty",
            92: "convert_u",
            93: "initproperty",
            94: "getlocal",
        },
        P6_CREATE_SPRITE_LABEL,
    )
    if (
        _short(abc, ins[77].args[0]) != "digits"
        or ins[77].args[0] != ins[78].args[0]
        or ins[79].args != [7]
        or abc.multinames[ins[80].args[0]][0] != 0x1B
        or _short(abc, ins[82].args[0]) != "resolvePath"
        or _short(abc, ins[84].args[0]) != "getImage"
        or ins[87].args != [8]
        or ins[88].args != [8]
        or _short(abc, ins[89].args[0]) != "damageEffect"
        or _short(abc, ins[91].args[0]) != "getColor"
        or _short(abc, ins[93].args[0]) != "color"
        or ins[94].args != [8]
    ):
        raise asm.AsmError(f"{P6_CREATE_SPRITE_LABEL} digit image color assignment anchor mismatch at #75..#94")

    incoming_to_94 = [
        idx
        for idx, item in enumerate(ins)
        if item.target == 94 or (item.cases is not None and (item.default == 94 or 94 in item.cases))
    ]
    if incoming_to_94:
        raise asm.AsmError(f"{P6_CREATE_SPRITE_LABEL} unexpected incoming branches to #94: {incoming_to_94}")

    return {
        "insert_at": 94,
        "incoming": asm.FORBID,
        "digits_mn": ins[77].args[0],
        "rt_mn": ins[80].args[0],
        "color_mn": ins[93].args[0],
        "before_sha256": _sha(body[5]),
    }


def _verify_p6_create_digit(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P6_CREATE_DIGIT_LABEL)]
    lock = EXACT_METHOD_LOCKS[P6_CREATE_DIGIT_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P6_CREATE_DIGIT_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 74:
        raise asm.AsmError(f"{P6_CREATE_DIGIT_LABEL} expected 74 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            57: "findproperty",
            58: "getproperty",
            59: "pushstring",
            60: "callproperty",
            61: "coerce",
            62: "newarray",
            63: "coerce",
            64: "setlocal_1",
            65: "findpropstrict",
            72: "constructprop",
            73: "returnvalue",
        },
        P6_CREATE_DIGIT_LABEL,
    )
    if ins[62].args != [12] or abc.s(ins[59].args[0]) != "battle/common/layer1/damage_font/unit_prefix_k":
        raise asm.AsmError(f"{P6_CREATE_DIGIT_LABEL} expected 12-item texture array ending with unit_prefix_k")

    ctor_ins = asm.decode(abc.bodies[bodies.resolve(abc, "AccumulationDamageIndicatorView/<ctor>")][5])
    _check_op_names(ctor_ins, {69: "callpropvoid"}, "AccumulationDamageIndicatorView/<ctor>")
    m_array_push = ctor_ins[69].args[0]
    if abc.mn_name(m_array_push) != "http://adobe.com/AS3/2006/builtin::push":
        raise asm.AsmError(f"AccumulationDamageIndicatorView/<ctor> unexpected push multiname: {abc.mn_name(m_array_push)}")

    return {
        "insert_at": 65,
        "incoming": asm.FORBID,
        "asset_mn": ins[57].args[0],
        "get_texture_mn": ins[60].args[0],
        "texture_mn": ins[61].args[0],
        "array_push_mn": m_array_push,
        "before_sha256": _sha(body[5]),
    }


def _verify_p6_update_digits(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P6_UPDATE_DIGITS_LABEL)]
    lock = EXACT_METHOD_LOCKS[P6_UPDATE_DIGITS_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P6_UPDATE_DIGITS_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 185:
        raise asm.AsmError(f"{P6_UPDATE_DIGITS_LABEL} expected 185 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            55: "setlocal",
            56: "getlocal",
            57: "pushtrue",
            58: "initproperty",
            59: "getlocal_3",
            60: "getlocal_3",
            61: "getproperty",
            62: "pushbyte",
            63: "subtract_i",
            64: "getlocal",
            65: "add_i",
            66: "callproperty",
            147: "getlocal",
            148: "pushstring",
            149: "ifne",
            150: "getlocal",
            151: "pushbyte",
            152: "initproperty",
            153: "jump",
            154: "getlocal",
            155: "pushfalse",
            156: "initproperty",
            157: "getlocal",
        },
        P6_UPDATE_DIGITS_LABEL,
    )
    if ins[55].args != [6] or ins[56].args != [6] or _short(abc, ins[58].args[0]) != "visible":
        raise asm.AsmError(f"{P6_UPDATE_DIGITS_LABEL} expected _loc6_.visible = true at #56..#58")
    if (
        _short(abc, ins[61].args[0]) != "length"
        or ins[62].args != [10]
        or ins[64].args != [5]
        or _short(abc, ins[66].args[0]) != "charAt"
        or ins[66].args[1] != 1
    ):
        raise asm.AsmError(f"{P6_UPDATE_DIGITS_LABEL} expected _loc3_.charAt(_loc3_.length - 10 + _loc5_) at #59..#66")
    if ins[147].args != [7] or abc.s(ins[148].args[0]) != "k" or ins[149].target != 154:
        raise asm.AsmError(f"{P6_UPDATE_DIGITS_LABEL} expected _loc7_ == 'k' check at #147..#149")
    if ins[150].args != [6] or ins[151].args != [11] or _short(abc, ins[152].args[0]) != "currentFrame":
        raise asm.AsmError(f"{P6_UPDATE_DIGITS_LABEL} expected _loc6_.currentFrame = 11 at #150..#152")
    if ins[154].args != [6] or _short(abc, ins[156].args[0]) != "visible":
        raise asm.AsmError(f"{P6_UPDATE_DIGITS_LABEL} expected _loc6_.visible = false at #154..#156")

    for target_pc in (59, 156):
        incoming_branches = [
            idx
            for idx, item in enumerate(ins)
            if item.target == target_pc or (item.cases is not None and (item.default == target_pc or target_pc in item.cases))
        ]
        if incoming_branches:
            raise asm.AsmError(f"{P6_UPDATE_DIGITS_LABEL} unexpected incoming branches to #{target_pc}: {incoming_branches}")

    ctor_ins = asm.decode(abc.bodies[bodies.resolve(abc, "AccumulationDamageIndicatorView/<ctor>")][5])
    _check_op_names(
        ctor_ins,
        {63: "getlocal", 64: "pushint", 65: "initproperty"},
        "AccumulationDamageIndicatorView/<ctor>",
    )
    if (
        ctor_ins[63].args != [5]
        or abc.ints[ctor_ins[64].args[0]] != 16768318
        or _short(abc, ctor_ins[65].args[0]) != "color"
    ):
        raise asm.AsmError("AccumulationDamageIndicatorView/<ctor> default digit color anchor mismatch at #63..#65")

    return {
        "reset_color_insert_at": 59,
        "reset_color_incoming": asm.FORBID,
        "insert_at": 156,
        "incoming": asm.FORBID,
        "length_mn": ins[61].args[0],
        "char_at_mn": ins[66].args[0],
        "current_frame_mn": ins[152].args[0],
        "color_mn": ctor_ins[65].args[0],
        "default_color_int_idx": ctor_ins[64].args[0],
        "before_sha256": _sha(body[5]),
    }


def _verify_p7(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P7_LABEL)]
    lock = EXACT_METHOD_LOCKS[P7_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P7_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 158:
        raise asm.AsmError(f"{P7_LABEL} expected 158 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            0: "getlocal_0",
            1: "pushscope",
            2: "getlocal_0",
            3: "getproperty",
            4: "iffalse",
            5: "getlocal",
            6: "getproperty",
            7: "iftrue",
            8: "getlocal_0",
            9: "callproperty",
            10: "setlocal",
            11: "getlocal_0",
            12: "getproperty",
            13: "getproperty",
            14: "getproperty",
            15: "convert_i",
            16: "setlocal",
            44: "callpropvoid",
            45: "getlocal_0",
            46: "getproperty",
            47: "setlocal",
            86: "getlocal",
            87: "pushbyte",
            88: "getproperty",
            89: "pushbyte",
            90: "ifge",
            91: "getlocal",
            92: "pushbyte",
            93: "getproperty",
            94: "pushbyte",
            95: "ifge",
            114: "returnvoid",
            115: "getlocal",
            156: "setproperty",
            157: "returnvoid",
        },
        P7_LABEL,
    )
    if ins[4].target != 157 or ins[7].target != 157:
        raise asm.AsmError(f"{P7_LABEL} primaryBattle/poison exit branch target mismatch")
    if ins[5].args != [4] or ins[10].args != [5] or ins[16].args != [7] or ins[47].args != [6]:
        raise asm.AsmError(f"{P7_LABEL} local register assignment mismatch")
    if ins[86].args != [5] or ins[87].args != [0] or ins[89].args != [2] or ins[90].target != 115:
        raise asm.AsmError(f"{P7_LABEL} per-target cap check at #86..#90 mismatch")
    if ins[91].args != [9] or ins[92].args != [1] or ins[94].args != [16] or ins[95].target != 115:
        raise asm.AsmError(f"{P7_LABEL} global cap check at #91..#95 mismatch")
    if (
        _short(abc, ins[3].args[0]) != "primaryBattle"
        or _short(abc, ins[6].args[0]) != "createdByPoison"
        or _short(abc, ins[12].args[0]) != "effectManager"
        or ins[46].args[0] != ins[12].args[0]
        or _short(abc, ins[13].args[0]) != "battle"
        or _short(abc, ins[14].args[0]) != "currentFrame"
        or _short(abc, ins[44].args[0]) != "wfxEmitPending"
        or _short(abc, ins[156].args[0]) != "wfxDamageMode"
    ):
        raise asm.AsmError(f"{P7_LABEL} property/method multiname mismatch")

    emit_ins = asm.decode(abc.bodies[bodies.resolve(abc, "DamageIndicatorManager/wfxEmitPending")][5])
    _check_op_names(emit_ins, {27: "getlocal_2", 28: "getproperty"}, "DamageIndicatorManager/wfxEmitPending")
    m_direct = emit_ins[28].args[0]
    if _short(abc, m_direct) != "createdByDirectAttack":
        raise asm.AsmError(f"DamageIndicatorManager/wfxEmitPending unexpected multiname at #28: {abc.mn_name(m_direct)}")

    p4_info = _verify_p4(abc)
    if ins[13].args[0] != p4_info["battle_mn"]:
        raise asm.AsmError(f"{P7_LABEL} battle multiname mismatch with {P4_LABEL}")

    return {
        "insert_at": 90,
        "incoming": asm.FORBID,
        "battle_mn": ins[13].args[0],
        "lightweight_mode_level_mn": p4_info["lightweight_mode_level_mn"],
        "created_by_direct_attack_mn": m_direct,
        "before_sha256": _sha(body[5]),
    }


def _verify_p8_find_enemy(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P8_FIND_ENEMY_LABEL)]
    lock = EXACT_METHOD_LOCKS[P8_FIND_ENEMY_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P8_FIND_ENEMY_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 82:
        raise asm.AsmError(f"{P8_FIND_ENEMY_LABEL} expected 82 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            0: "getlocal_0",
            1: "pushscope",
            2: "getlocal_0",
            3: "getproperty",
            4: "callproperty",
            5: "setlocal_1",
            6: "getlocal_1",
            7: "getproperty",
            17: "avm_label",
            18: "getlocal_2",
            19: "callproperty",
            20: "iffalse",
            21: "getlocal_2",
            22: "callproperty",
            23: "setlocal_3",
            44: "getlocal_3",
            45: "callproperty",
            50: "getlocal_3",
            51: "callproperty",
            63: "setlocal",
            64: "getlocal",
            65: "getlocal",
            66: "ifne",
            67: "getlocal",
            79: "jump",
            80: "getlocal",
            81: "returnvalue",
        },
        P8_FIND_ENEMY_LABEL,
    )
    if (
        _short(abc, ins[3].args[0]) != "zoneManager"
        or _short(abc, ins[4].args[0]) != "getCurrentZone"
        or _short(abc, ins[45].args[0]) != "getPosX"
        or _short(abc, ins[51].args[0]) != "getPosY"
    ):
        raise asm.AsmError(f"{P8_FIND_ENEMY_LABEL} zone/pos multiname mismatch")
    if ins[20].target != 80 or ins[63].args != [5] or ins[64].args != [5] or ins[65].args != [5] or ins[66].target != 17:
        raise asm.AsmError(f"{P8_FIND_ENEMY_LABEL} candidate loop / NaN filter mismatch")

    phys_ins = asm.decode(abc.bodies[bodies.resolve(abc, "BallImpl/physicalMove")][5])
    _check_op_names(phys_ins, {377: "getproperty", 383: "callproperty"}, "BallImpl/physicalMove")
    m_bounds = phys_ins[377].args[0]
    m_contains = phys_ins[383].args[0]
    if _short(abc, m_bounds) != "bounds" or _short(abc, m_contains) != "contains" or phys_ins[383].args[1] != 2:
        raise asm.AsmError("BallImpl/physicalMove bounds.contains(x, y) anchor mismatch")

    return {
        "insert_at": 64,
        "incoming": asm.FORBID,
        "bounds_mn": m_bounds,
        "contains_mn": m_contains,
        "get_pos_x_mn": ins[45].args[0],
        "get_pos_y_mn": ins[51].args[0],
        "before_sha256": _sha(body[5]),
    }


def _verify_p8_try_replacement(abc) -> dict:
    body = abc.bodies[bodies.resolve(abc, P8_TRY_REPLACEMENT_LABEL)]
    lock = EXACT_METHOD_LOCKS[P8_TRY_REPLACEMENT_LABEL]
    if _sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
        raise asm.AsmError(f"{P8_TRY_REPLACEMENT_LABEL} method lock mismatch: sha={_sha(body[5])} header={body[1:5]}")
    ins = asm.decode(body[5])
    if len(ins) != 133:
        raise asm.AsmError(f"{P8_TRY_REPLACEMENT_LABEL} expected 133 instructions, got {len(ins)}")
    _check_op_names(
        ins,
        {
            0: "getlocal_0",
            1: "pushscope",
            2: "getlocal_1",
            3: "getproperty",
            4: "pushbyte",
            5: "ifeq",
            8: "avm_label",
            32: "getlex",
            33: "getlex",
            37: "callproperty",
            39: "callproperty",
            40: "setlocal",
            41: "getlocal",
            42: "iffalse",
            43: "getlocal_0",
            44: "getlocal",
            45: "nop",
            46: "nop",
            47: "nop",
            48: "callproperty",
            49: "setlocal",
            50: "getlocal",
            51: "iffalse",
            64: "getlocal",
            65: "getlocal",
            66: "pushbyte",
            67: "getproperty",
            68: "callpropvoid",
            129: "pushtrue",
            130: "returnvalue",
            131: "pushfalse",
            132: "returnvalue",
        },
        P8_TRY_REPLACEMENT_LABEL,
    )
    if (
        _short(abc, ins[3].args[0]) != "index"
        or ins[4].args != [0]
        or ins[5].target != 131
        or _short(abc, ins[37].args[0]) != "wfxParseDashLeaderTags"
        or _short(abc, ins[39].args[0]) != "wfxFilterLeaderDash"
        or ins[40].args != [5]
        or ins[41].args != [5]
        or ins[42].target != 8
        or ins[44].args != [5]
        or _short(abc, ins[48].args[0]) != "wfxDashV2Landing"
        or ins[48].args[1] != 1
        or ins[49].args != [7]
        or ins[50].args != [7]
        or ins[51].target != 131
        or ins[65].args != [5]
        or ins[66].args != [1]
    ):
        raise asm.AsmError(f"{P8_TRY_REPLACEMENT_LABEL} dash config / wfxDashV2Landing call structure mismatch")

    incoming_to_43 = [
        idx
        for idx, item in enumerate(ins)
        if item.target == 43 or (item.cases is not None and (item.default == 43 or 43 in item.cases))
    ]
    if incoming_to_43:
        raise asm.AsmError(f"{P8_TRY_REPLACEMENT_LABEL} unexpected incoming branches to #43: {incoming_to_43}")

    rt_mn = ins[67].args[0]
    if abc.multinames[rt_mn][0] != 0x1B or ins[27].args[0] != rt_mn:
        raise asm.AsmError(f"{P8_TRY_REPLACEMENT_LABEL} dynamic subscript multiname mismatch at #67")

    v2_ins = asm.decode(abc.bodies[bodies.resolve(abc, "BallImpl/wfxDashV2Landing")][5])
    _check_op_names(
        v2_ins,
        {
            2: "getlocal_1",
            3: "pushbyte",
            4: "getproperty",
            5: "pushstring",
            6: "ifeq",
            14: "getlocal_0",
            15: "callproperty",
        },
        "BallImpl/wfxDashV2Landing",
    )
    wfx_dash_v2_str_idx = v2_ins[5].args[0]
    wfx_find_dash_enemy_mn = v2_ins[15].args[0]
    if (
        v2_ins[4].args[0] != rt_mn
        or abc.s(wfx_dash_v2_str_idx) != "wfx_dash_v2"
        or _short(abc, wfx_find_dash_enemy_mn) != "wfxFindDashEnemy"
        or v2_ins[15].args[1] != 0
    ):
        raise asm.AsmError("BallImpl/wfxDashV2Landing wfx_dash_v2 / wfxFindDashEnemy operand mismatch")

    return {
        "insert_at": 43,
        "incoming": asm.FORBID,
        "rt_mn": rt_mn,
        "wfx_dash_v2_str_idx": wfx_dash_v2_str_idx,
        "wfx_find_dash_enemy_mn": wfx_find_dash_enemy_mn,
        "before_sha256": _sha(body[5]),
    }


def verify_anchors(abc) -> dict:
    """Validate all 13 target method anchors (P1-P8) against the given ABC."""
    return {
        P1_LABEL: _verify_p1(abc),
        P2_LABEL: _verify_p2(abc),
        P3_LABEL: _verify_p3(abc),
        P4_LABEL: _verify_p4(abc),
        P5_LABEL: _verify_p5(abc),
        P6_UNIT_PREFIX_LABEL: _verify_p6_unit_prefix(abc),
        P6_RESOLVE_PATH_LABEL: _verify_p6_resolve_path(abc),
        P6_CREATE_SPRITE_LABEL: _verify_p6_create_sprite(abc),
        P6_CREATE_DIGIT_LABEL: _verify_p6_create_digit(abc),
        P6_UPDATE_DIGITS_LABEL: _verify_p6_update_digits(abc),
        P7_LABEL: _verify_p7(abc),
        P8_FIND_ENEMY_LABEL: _verify_p8_find_enemy(abc),
        P8_TRY_REPLACEMENT_LABEL: _verify_p8_try_replacement(abc),
    }


def lock_for_abc(abc) -> dict:
    """Verify P1-P8 anchors and return Editor-compatible method locks for the given ABC."""
    verify_anchors(abc)
    locks = {}
    for label in TARGETS:
        body = abc.bodies[bodies.resolve(abc, label)]
        locks[label] = {"sha": _sha(body[5]), "header": list(body[1:5])}
    return locks


def build(editor) -> dict:
    """Apply P1-P8 reversible instruction insertions using the verified anchors."""
    anchors = verify_anchors(editor.abc)

    # P1: BattleViewInputSettings/isOtherBattleActionVisible() -> always return false
    p1 = anchors[P1_LABEL]
    editor.insert(
        P1_LABEL,
        p1["insert_at"],
        [("pushfalse",), ("returnvalue",)],
        incoming=p1["incoming"],
    )

    # P2: Battle/preparation -> assign showOthersMultiball = false right after native assignment
    p2 = anchors[P2_LABEL]
    m_multiball = p2["show_others_multiball_mn"]
    editor.insert(
        P2_LABEL,
        p2["insert_at"],
        [("findproperty", m_multiball), ("pushfalse",), ("initproperty", m_multiball)],
        incoming=p2["incoming"],
    )

    # P2b: BattleView/show other-owner branch case 43 (Ball) -> return _loc5_ if !param2.params[0].isPrimary()
    p3 = anchors[P3_LABEL]
    editor.insert(
        P3_LABEL,
        p3["case43_insert_at"],
        [
            ("getlocal_2",),
            ("getproperty", p3["params_mn"]),
            ("pushbyte", 0),
            ("getproperty", p3["rt_mn"]),
            ("coerce", p3["ball_peek_mn"]),
            ("callproperty", p3["ball_is_primary_mn"], 0),
            ("convert_b",),
            ("iftrue", "KEEP"),
            ("getlocal", p3["return_local"]),
            ("returnvalue",),
            ("label", "KEEP"),
        ],
        incoming=p3["case43_incoming"],
    )

    # P3: BattleView/show other-owner branch case 55 (CutinActionSkill) -> return _loc5_ immediately
    editor.insert(
        P3_LABEL,
        p3["insert_at"],
        [("getlocal", p3["return_local"]), ("returnvalue",)],
        incoming=p3["incoming"],
    )

    # P4: EffectManagerImpl/canPlayEffect -> return false immediately when param1 (primary) is false
    p4 = anchors[P4_LABEL]
    editor.insert(
        P4_LABEL,
        p4["insert_at"],
        [("pushfalse",), ("returnvalue",)],
        incoming=p4["incoming"],
    )

    # P5: EffectManagerImpl/show case 63 (SimpleEffectKind.HitEffect) -> suppress when lightweightModeLevel >= 1
    p5 = anchors[P5_LABEL]
    editor.insert(
        P5_LABEL,
        p5["insert_at"],
        [
            ("getlocal_0",),
            ("getproperty", p5["battle_mn"]),
            ("getproperty", p5["lightweight_mode_level_mn"]),
            ("pushbyte", 1),
            ("iflt", "OLD"),
            ("getlocal_2",),
            ("getproperty", p5["params_mn"]),
            ("pushbyte", 1),
            ("getproperty", p5["rt_mn"]),
            ("convert_b",),
            ("iffalse", "OUT"),
            ("getlocal_0",),
            ("callproperty", p5["get_random_rotation_mn"], 0),
            ("pop",),
            ("label", "OUT"),
            ("returnvoid",),
            ("label", "OLD"),
        ],
        incoming=p5["incoming"],
    )

    # P6: Damage notation 't' (>= 1e13), 'b' (>= 1e10), 'm' (>= 1e7) + tier-colored digits/@ + untinted m/b/t unit glyphs
    d_1e13 = editor.pool.double(10000000000000.0)
    d_1e11 = editor.pool.double(100000000000.0)
    d_1e10 = editor.pool.double(10000000000.0)
    i_100000000 = editor.pool.integer(100000000)
    i_10000000 = editor.pool.integer(10000000)
    i_100000 = editor.pool.integer(100000)
    i_tier_m_color = editor.pool.integer(TIER_M_COLOR)
    i_tier_b_color = editor.pool.integer(TIER_B_COLOR)
    i_tier_t_color = editor.pool.integer(TIER_T_COLOR)
    i_16777215 = editor.pool.integer(UNIT_GLYPH_COLOR)
    s_t = editor.pool.string("t")
    s_at0t = editor.pool.string("@0t")
    s_b = editor.pool.string("b")
    s_at0b = editor.pool.string("@0b")
    s_m = editor.pool.string("m")
    s_at0m = editor.pool.string("@0m")
    s_unit_prefix_m = editor.pool.string(UNIT_PREFIX_M_PATH)
    s_unit_prefix_b = editor.pool.string(UNIT_PREFIX_B_PATH)
    s_unit_prefix_t = editor.pool.string(UNIT_PREFIX_T_PATH)

    p6_up = anchors[P6_UNIT_PREFIX_LABEL]
    m_str_t = p6_up["string_type_mn"]

    def _unit_tier_block(threshold_op, divisor_op, at0_str_idx: int, unit_str_idx: int, next_label: str, dot_label: str) -> list:
        return [
            ("getlocal_1",),
            threshold_op,
            ("ifnge", next_label),
            ("getlex", p6_up["std_mn"]),
            ("getlex", p6_up["math_mn"]),
            ("getlocal_1",),
            divisor_op,
            ("divide",),
            ("pushdouble", p6_up["double_1e_10_idx"]),
            ("add",),
            ("convert_d",),
            ("pushdouble", p6_up["double_1e_10_idx"]),
            ("add",),
            ("convert_d",),
            ("callproperty", p6_up["floor_mn"], 1),
            ("convert_d",),
            ("pushbyte", 10),
            ("divide",),
            ("callproperty", p6_up["string_mn"], 1),
            ("coerce", m_str_t),
            ("coerce", m_str_t),
            ("setlocal_2",),
            ("getlocal_2",),
            ("pushstring", p6_up["dot_str_idx"]),
            ("callproperty", p6_up["index_of_mn"], 1),
            ("convert_i",),
            ("convert_i",),
            ("setlocal_3",),
            ("getlocal_3",),
            ("pushbyte", 255),
            ("ifne", dot_label),
            ("pushstring", p6_up["empty_str_idx"]),
            ("getlocal_2",),
            ("add",),
            ("coerce", m_str_t),
            ("pushstring", at0_str_idx),
            ("add",),
            ("coerce", m_str_t),
            ("returnvalue",),
            ("label", dot_label),
            ("getlocal_2",),
            ("pushbyte", 0),
            ("getlocal_3",),
            ("callproperty", p6_up["substr_mn"], 2),
            ("coerce", m_str_t),
            ("coerce", m_str_t),
            ("setlocal", 4),
            ("getlocal_2",),
            ("getlocal_3",),
            ("pushbyte", 1),
            ("add_i",),
            ("pushbyte", 1),
            ("callproperty", p6_up["substr_mn"], 2),
            ("coerce", m_str_t),
            ("coerce", m_str_t),
            ("setlocal", 5),
            ("pushstring", p6_up["empty_str_idx"]),
            ("getlocal", 4),
            ("add",),
            ("coerce", m_str_t),
            ("pushstring", p6_up["at_str_idx"]),
            ("add",),
            ("coerce", m_str_t),
            ("getlocal", 5),
            ("add",),
            ("coerce", m_str_t),
            ("pushstring", unit_str_idx),
            ("add",),
            ("coerce", m_str_t),
            ("returnvalue",),
            ("label", next_label),
        ]

    editor.insert(
        P6_UNIT_PREFIX_LABEL,
        p6_up["insert_at"],
        (
            _unit_tier_block(("pushdouble", d_1e13), ("pushdouble", d_1e11), s_at0t, s_t, "BELOW_10T", "HAS_DOT_T")
            + _unit_tier_block(("pushdouble", d_1e10), ("pushint", i_100000000), s_at0b, s_b, "BELOW_10B", "HAS_DOT_B")
            + _unit_tier_block(("pushint", i_10000000), ("pushint", i_100000), s_at0m, s_m, "BELOW_10M", "HAS_DOT_M")
        ),
        incoming=p6_up["incoming"],
    )

    p6_rp = anchors[P6_RESOLVE_PATH_LABEL]
    editor.insert(
        P6_RESOLVE_PATH_LABEL,
        p6_rp["insert_at"],
        [
            ("getlocal_2",),
            ("pushstring", s_m),
            ("ifne", "CHECK_B"),
            ("pushstring", s_unit_prefix_m),
            ("returnvalue",),
            ("label", "CHECK_B"),
            ("getlocal_2",),
            ("pushstring", s_b),
            ("ifne", "CHECK_T"),
            ("pushstring", s_unit_prefix_b),
            ("returnvalue",),
            ("label", "CHECK_T"),
            ("getlocal_2",),
            ("pushstring", s_t),
            ("ifne", "UNEXPECTED"),
            ("pushstring", s_unit_prefix_t),
            ("returnvalue",),
            ("label", "UNEXPECTED"),
        ],
        incoming=p6_rp["incoming"],
    )

    p6_cs = anchors[P6_CREATE_SPRITE_LABEL]
    editor.insert(
        P6_CREATE_SPRITE_LABEL,
        p6_cs["insert_at"],
        [
            ("findproperty", p6_cs["digits_mn"]),
            ("getproperty", p6_cs["digits_mn"]),
            ("getlocal", 6),
            ("decrement_i",),
            ("getproperty", p6_cs["rt_mn"]),
            ("dup",),
            ("pushstring", s_m),
            ("ifne", "CHECK_TIER_B"),
            ("pop",),
            ("getlocal", 8),
            ("pushint", i_tier_m_color),
            ("jump", "APPLY_TIER_OR_UNIT_COLOR"),
            ("label", "CHECK_TIER_B"),
            ("dup",),
            ("pushstring", s_b),
            ("ifne", "CHECK_TIER_T"),
            ("pop",),
            ("getlocal", 8),
            ("pushint", i_tier_b_color),
            ("jump", "APPLY_TIER_OR_UNIT_COLOR"),
            ("label", "CHECK_TIER_T"),
            ("pushstring", s_t),
            ("ifne", "AFTER_UNIT_GLYPH"),
            ("getlocal", 8),
            ("pushint", i_tier_t_color),
            ("label", "APPLY_TIER_OR_UNIT_COLOR"),
            ("getlocal", 5),
            ("getlocal", 6),
            ("ifne", "STORE_COLOR"),
            ("pop",),
            ("pushint", i_16777215),
            ("label", "STORE_COLOR"),
            ("convert_u",),
            ("initproperty", p6_cs["color_mn"]),
            ("label", "AFTER_UNIT_GLYPH"),
        ],
        incoming=p6_cs["incoming"],
    )

    p6_cd = anchors[P6_CREATE_DIGIT_LABEL]
    editor.insert(
        P6_CREATE_DIGIT_LABEL,
        p6_cd["insert_at"],
        [
            ("getlocal_1",),
            ("findproperty", p6_cd["asset_mn"]),
            ("getproperty", p6_cd["asset_mn"]),
            ("pushstring", s_unit_prefix_m),
            ("callproperty", p6_cd["get_texture_mn"], 1),
            ("coerce", p6_cd["texture_mn"]),
            ("callpropvoid", p6_cd["array_push_mn"], 1),
            ("getlocal_1",),
            ("findproperty", p6_cd["asset_mn"]),
            ("getproperty", p6_cd["asset_mn"]),
            ("pushstring", s_unit_prefix_b),
            ("callproperty", p6_cd["get_texture_mn"], 1),
            ("coerce", p6_cd["texture_mn"]),
            ("callpropvoid", p6_cd["array_push_mn"], 1),
            ("getlocal_1",),
            ("findproperty", p6_cd["asset_mn"]),
            ("getproperty", p6_cd["asset_mn"]),
            ("pushstring", s_unit_prefix_t),
            ("callproperty", p6_cd["get_texture_mn"], 1),
            ("coerce", p6_cd["texture_mn"]),
            ("callpropvoid", p6_cd["array_push_mn"], 1),
        ],
        incoming=p6_cd["incoming"],
    )

    p6_ud = anchors[P6_UPDATE_DIGITS_LABEL]
    editor.insert(
        P6_UPDATE_DIGITS_LABEL,
        p6_ud["reset_color_insert_at"],
        [
            ("getlocal", 6),
            ("getlocal_3",),
            ("getlocal_3",),
            ("getproperty", p6_ud["length_mn"]),
            ("decrement_i",),
            ("callproperty", p6_ud["char_at_mn"], 1),
            ("dup",),
            ("pushstring", s_m),
            ("ifne", "TIER_CHECK_B"),
            ("pop",),
            ("pushint", i_tier_m_color),
            ("jump", "TIER_SET_COLOR"),
            ("label", "TIER_CHECK_B"),
            ("dup",),
            ("pushstring", s_b),
            ("ifne", "TIER_CHECK_T"),
            ("pop",),
            ("pushint", i_tier_b_color),
            ("jump", "TIER_SET_COLOR"),
            ("label", "TIER_CHECK_T"),
            ("pushstring", s_t),
            ("ifne", "TIER_DEFAULT_COLOR"),
            ("pushint", i_tier_t_color),
            ("jump", "TIER_SET_COLOR"),
            ("label", "TIER_DEFAULT_COLOR"),
            ("pushint", p6_ud["default_color_int_idx"]),
            ("label", "TIER_SET_COLOR"),
            ("initproperty", p6_ud["color_mn"]),
        ],
        incoming=p6_ud["reset_color_incoming"],
    )
    editor.insert(
        P6_UPDATE_DIGITS_LABEL,
        p6_ud["insert_at"],
        [
            ("getlocal", 7),
            ("pushstring", s_m),
            ("ifne", "CHECK_B"),
            ("getlocal", 6),
            ("pushbyte", 12),
            ("initproperty", p6_ud["current_frame_mn"]),
            ("jump", "SET_UNIT_GLYPH"),
            ("label", "CHECK_B"),
            ("getlocal", 7),
            ("pushstring", s_b),
            ("ifne", "CHECK_T"),
            ("getlocal", 6),
            ("pushbyte", 13),
            ("initproperty", p6_ud["current_frame_mn"]),
            ("jump", "SET_UNIT_GLYPH"),
            ("label", "CHECK_T"),
            ("getlocal", 7),
            ("pushstring", s_t),
            ("ifne", "NOT_UNIT_GLYPH"),
            ("getlocal", 6),
            ("pushbyte", 14),
            ("initproperty", p6_ud["current_frame_mn"]),
            ("label", "SET_UNIT_GLYPH"),
            ("pop",),
            ("pushtrue",),
            ("getlocal", 6),
            ("pushint", i_16777215),
            ("initproperty", p6_ud["color_mn"]),
            ("label", "NOT_UNIT_GLYPH"),
        ],
        incoming=p6_ud["incoming"],
    )

    # P7: DamageIndicatorManager/wfxMergeDamage -> treat per-target cap as 0 when lightweightModeLevel >= 1 and info.createdByDirectAttack
    p7 = anchors[P7_LABEL]
    editor.insert(
        P7_LABEL,
        p7["insert_at"],
        [
            ("getlocal", 6),
            ("getproperty", p7["battle_mn"]),
            ("getproperty", p7["lightweight_mode_level_mn"]),
            ("pushbyte", 1),
            ("iflt", "OLD"),
            ("getlocal", 4),
            ("getproperty", p7["created_by_direct_attack_mn"]),
            ("iffalse", "OLD"),
            ("pop",),
            ("pushbyte", 0),
            ("label", "OLD"),
        ],
        incoming=p7["incoming"],
    )

    # P8: BallImpl/wfxFindDashEnemy & BallImpl/wfxTryDashReplacement -> skip out-of-bounds enemies and block v2 dash when no in-bounds target exists
    p8_fe = anchors[P8_FIND_ENEMY_LABEL]
    editor.insert(
        P8_FIND_ENEMY_LABEL,
        p8_fe["insert_at"],
        [
            ("getlocal_1",),
            ("getproperty", p8_fe["bounds_mn"]),
            ("getlocal_3",),
            ("callproperty", p8_fe["get_pos_x_mn"], 0),
            ("getlocal_3",),
            ("callproperty", p8_fe["get_pos_y_mn"], 0),
            ("callproperty", p8_fe["contains_mn"], 2),
            ("iftrue", "IN_BOUNDS"),
            ("pushnan",),
            ("setlocal", 5),
            ("label", "IN_BOUNDS"),
        ],
        incoming=p8_fe["incoming"],
    )

    p8_tr = anchors[P8_TRY_REPLACEMENT_LABEL]
    editor.insert(
        P8_TRY_REPLACEMENT_LABEL,
        p8_tr["insert_at"],
        [
            ("getlocal", 5),
            ("pushbyte", 0),
            ("getproperty", p8_tr["rt_mn"]),
            ("pushstring", p8_tr["wfx_dash_v2_str_idx"]),
            ("ifne", "PROCEED"),
            ("getlocal_0",),
            ("callproperty", p8_tr["wfx_find_dash_enemy_mn"], 0),
            ("iftrue", "PROCEED"),
            ("pushtrue",),
            ("returnvalue",),
            ("label", "PROCEED"),
        ],
        incoming=p8_tr["incoming"],
    )

    return {
        "capability": "coop-hide-mate-fx-v6",
        "anchors": anchors,
        "patches": {
            "P1": {
                "target": P1_LABEL,
                "insert_at": p1["insert_at"],
                "incoming": p1["incoming"],
                "instructions": ["pushfalse", "returnvalue"],
                "effect": "isOtherBattleActionVisible() always returns false (blocks teammate ActionEffectView case 59 & AbilityDamageShotView case 60)",
            },
            "P2": {
                "target": P2_LABEL,
                "insert_at": p2["insert_at"],
                "incoming": p2["incoming"],
                "instructions": [
                    f"findproperty {m_multiball} [showOthersMultiball]",
                    "pushfalse",
                    f"initproperty {m_multiball} [showOthersMultiball]",
                ],
                "effect": "showOthersMultiball forced to false after native assignment (case 44 only builds MemberView for teammate main squadKind 0)",
            },
            "P2b": {
                "target": P3_LABEL,
                "insert_at": p3["case43_insert_at"],
                "incoming": p3["case43_incoming"],
                "instructions": [
                    "getlocal_2",
                    f"getproperty {p3['params_mn']} [params]",
                    "pushbyte 0",
                    f"getproperty {p3['rt_mn']} [<mn kind 0x1b>]",
                    f"coerce {p3['ball_peek_mn']} [BallPeek]",
                    f"callproperty {p3['ball_is_primary_mn']} [BallPeek::isPrimary], 0",
                    "convert_b",
                    "iftrue KEEP",
                    f"getlocal {p3['return_local']}",
                    "returnvalue",
                    "label KEEP",
                ],
                "effect": "owner != -1 case 43 (Ball) skips BallView construction and returns removeKey (_loc5_) when BallPeek.isPrimary() is false",
            },
            "P3": {
                "target": P3_LABEL,
                "insert_at": p3["insert_at"],
                "incoming": p3["incoming"],
                "instructions": [f"getlocal {p3['return_local']}", "returnvalue"],
                "effect": "owner != -1 case 55 (CutinActionSkill) returns removeKey (_loc5_) immediately without constructing CutinActionSkillView2",
            },
            "P4": {
                "target": P4_LABEL,
                "insert_at": p4["insert_at"],
                "incoming": p4["incoming"],
                "instructions": ["pushfalse", "returnvalue"],
                "effect": "canPlayEffect returns false immediately when primary (param1) is false; primary=true path is instruction-for-instruction unchanged",
            },
            "P5": {
                "target": P5_LABEL,
                "insert_at": p5["insert_at"],
                "incoming": p5["incoming"],
                "placed_before_v35n_hitbudget": p5["has_v35n_hitbudget"],
                "instructions": [
                    "getlocal_0",
                    f"getproperty {p5['battle_mn']} [battle]",
                    f"getproperty {p5['lightweight_mode_level_mn']} [lightweightModeLevel]",
                    "pushbyte 1",
                    "iflt OLD",
                    "getlocal_2",
                    f"getproperty {p5['params_mn']} [params]",
                    "pushbyte 1",
                    f"getproperty {p5['rt_mn']} [<mn kind 0x1b>]",
                    "convert_b",
                    "iffalse OUT",
                    "getlocal_0",
                    f"callproperty {p5['get_random_rotation_mn']} [getRandomRotation], 0",
                    "pop",
                    "label OUT",
                    "returnvoid",
                    "label OLD",
                ],
                "effect": "SimpleEffectKind 63 (HitEffect) suppressed when battle.lightweightModeLevel >= 1 while keeping getRandomRotation() call count identical",
            },
            "P6": {
                "targets": [
                    P6_UNIT_PREFIX_LABEL,
                    P6_RESOLVE_PATH_LABEL,
                    P6_CREATE_SPRITE_LABEL,
                    P6_CREATE_DIGIT_LABEL,
                    P6_UPDATE_DIGITS_LABEL,
                ],
                "unitPrefix_insert_at": p6_up["insert_at"],
                "resolvePath_insert_at": p6_rp["insert_at"],
                "createSprite_insert_at": p6_cs["insert_at"],
                "createDigit_insert_at": p6_cd["insert_at"],
                "updateDigits_reset_color_insert_at": p6_ud["reset_color_insert_at"],
                "updateDigits_insert_at": p6_ud["insert_at"],
                "tier_colors_hex": {
                    "m": f"0x{TIER_M_COLOR:06X}",
                    "b": f"0x{TIER_B_COLOR:06X}",
                    "t": f"0x{TIER_T_COLOR:06X}",
                    "unit_glyph": f"0x{UNIT_GLYPH_COLOR:06X}",
                },
                "effect": "Adds >=1e13 't', >=1e10 'b', >=1e7 'm' notation, resolves 'm'/'b'/'t' to unit_prefix_m/b/t texture paths, appends 13th..15th textures to AccumulationDamageIndicatorView MovieClip, maps 'm'/'b'/'t' to currentFrame 12/13/14, tints all digits and decimal point ('@') in m/b/t strings with tier colors (m: 0x40D8FF, b: 0xFF4FB4, t: 0xA070FF), keeps m/b/t unit glyphs untinted (0xFFFFFF), and preserves damage-type color on non-abbreviated and 'k' strings",
            },
            "P7": {
                "target": P7_LABEL,
                "insert_at": p7["insert_at"],
                "incoming": p7["incoming"],
                "instructions": [
                    "getlocal 6",
                    f"getproperty {p7['battle_mn']} [battle]",
                    f"getproperty {p7['lightweight_mode_level_mn']} [lightweightModeLevel]",
                    "pushbyte 1",
                    "iflt OLD",
                    "getlocal 4",
                    f"getproperty {p7['created_by_direct_attack_mn']} [createdByDirectAttack]",
                    "iffalse OLD",
                    "pop",
                    "pushbyte 0",
                    "label OLD",
                ],
                "effect": "When battle.lightweightModeLevel >= 1 and info.createdByDirectAttack is true, replaces per-target individual display cap (2) with 0 so direct-attack hits merge directly into next-frame sum without showing individual numbers",
            },
            "P8": {
                "targets": [
                    P8_FIND_ENEMY_LABEL,
                    P8_TRY_REPLACEMENT_LABEL,
                ],
                "findEnemy_insert_at": p8_fe["insert_at"],
                "findEnemy_incoming": p8_fe["incoming"],
                "findEnemy_instructions": [
                    "getlocal_1",
                    f"getproperty {p8_fe['bounds_mn']} [bounds]",
                    "getlocal_3",
                    f"callproperty {p8_fe['get_pos_x_mn']} [getPosX], 0",
                    "getlocal_3",
                    f"callproperty {p8_fe['get_pos_y_mn']} [getPosY], 0",
                    f"callproperty {p8_fe['contains_mn']} [contains], 2",
                    "iftrue IN_BOUNDS",
                    "pushnan",
                    "setlocal 5",
                    "label IN_BOUNDS",
                ],
                "tryReplacement_insert_at": p8_tr["insert_at"],
                "tryReplacement_incoming": p8_tr["incoming"],
                "tryReplacement_instructions": [
                    "getlocal 5",
                    "pushbyte 0",
                    f"getproperty {p8_tr['rt_mn']} [<mn kind 0x1b>]",
                    f"pushstring {p8_tr['wfx_dash_v2_str_idx']} [\"wfx_dash_v2\"]",
                    "ifne PROCEED",
                    "getlocal_0",
                    f"callproperty {p8_tr['wfx_find_dash_enemy_mn']} [wfxFindDashEnemy], 0",
                    "iftrue PROCEED",
                    "pushtrue",
                    "returnvalue",
                    "label PROCEED",
                ],
                "effect": "Skips out-of-bounds enemies (!zone.bounds.contains(enemy.getPosX(), enemy.getPosY())) in BallImpl/wfxFindDashEnemy (keeping BOSS-first + nearest in-bounds selection), and in BallImpl/wfxTryDashReplacement when local5[0] == 'wfx_dash_v2' and !this.wfxFindDashEnemy() silently returns true (no dash, no failure animation, no fallback to native escape)",
            },
        },
    }
