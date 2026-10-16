# -*- coding: utf-8 -*-
"""v25 测试服客户端补丁（从 v17 原包整套重打；不含已取消的 v24「分数×0.01」）。

只做单方法指令级插入（author-merge 的 abcasm：splice + 逐字节可逆校验 + 栈/作用域模拟），不回编 AS3。
常量池只追加。每个被改方法都按官方方法体 sha256 前缀 + header 锁定（LOCKS），对不上即拒绝。

战斗（v23 继承并修正）：
- scheduleDirectAttack：段数 N>=4 的合并结算只对 isLeader() && kyle_moon 生效（A1）；其他角色逐段官方结算。
  凯尔倍率块 / 合并时韧性=N、Fever=N 不变。删除 v23 的「第 2 段起 hitEffect=None」（A2）。
- EnemyImpl.applyAttack：只保留凯尔 PF 追加判定区标记（randomRotation=false + attack_to_hostile_hit）静音；
  官方 2–3 段直击每段数字/特效/音效恢复。
- getStatModifierSkillGaugeCharging：先比原始和与官方 MAX，超了才查固有层数（A6）。
- getConditionsIncludingOuterEnvironments 隐藏 hidden_ 固有图标；getTotalConditions 改为过滤后长度（A3）。
- boss 韧性条常显（v22 起，不变）。
- 五重 proceedBattles：第 1 轮掉线宽限只保留 myBattle.currentFrame < 600。
非战斗：
- ReproduceFileRecordImpl.saveLog：latest.log 只写 Snapshot（崩溃 errorMessage/stackTrace 所在），不写逐事件 Instant/Ready（C11）。
- MiscDataLogic.setAutoSpeedLevel：已有记录且值不变不 store（C12）。
- 杰拉德 149999 技能准备语音轮换（HUD 选择 / 战斗预载 / 语音图鉴三处）。
- 角色表：屏外已隐藏格 draw 早退、离视口两屏外且非下落中的格不推进 playhead、applyCharacters 排序 O(N)、
  关闭日志的 Std.string/遍历拼串跳过、轻量模式分支常开且每帧最多应用 3 格、主城 antiAliasing 4→0。

用法：
  python wf_hitfx_silence.v25.py --apk IN.apk --out OUT.apk --signer local|debug [--work DIR]
  debug = 测试服 com.leiting.wt（~/.android/debug.keystore / androiddebugkey）
  每次构建轮换 AndroidManifest 里的 AIR uniqueappversionid（同长 UTF-16 替换），使 AIR 重新解包 SWF。
"""
from __future__ import annotations

import argparse, ast, hashlib, json, os, re, shutil, subprocess, sys, uuid, zipfile
from pathlib import Path

ABCASM = Path(r"D:/WF/startpoint-cn-kulo/client-patch/author-merge-20261001/abcasm")
sys.path.insert(0, str(ABCASM))
import asm, bodies  # noqa: E402
from swfabc import SwfAbc, PoolEditor  # noqa: E402

SWF_MEMBER = "assets/worldflipper_android_release.swf"
TOOLS = Path(r"D:/WF/runtimes/android-toolchain/sdk/build-tools/34.0.0")
JAVA_HOME = Path(r"D:/WF/runtimes/android-toolchain/jdk/jdk-17.0.19+10")
LOCAL_KS = Path(r"D:/WF/_archive/kept/弹国服-tools-and-decompile/instrument/wf_new.keystore")
LOCAL_KS_SRC = LOCAL_KS.with_name("build_instrumented_apk.py")
DEBUG_KS = Path(os.path.expanduser("~")) / ".android" / "debug.keystore"
MARKER = b"battle/common/layer0/attack_to_hostile_hit"
CAPABILITY = ["hitfx-silence-v2-kyle-pf-marker-only", "kyle-direct-params-v2-merge-kyle-leader-only", "charge-cap-unique-v2-max-first",
              "boss-stun-gauge-v1", "hidden-unique-icons-v2-filtered-page-count", "reproduce-log-snapshot-only-v1",
              "autospeed-store-skip-unchanged-v1", "voice-rotation-149999-v1", "party-ui-log-skip-v1", "home-msaa-off-v1",
              "character-table-throttled-apply-3-v1",
              "character-table-offscreen-skip-v1", "character-table-rank-sort-v1", "five-boss-round1-grace-600f-v1",
              "atlas-overflow-spill-pages-v1", "local-loading-gc-view-only-v1",
              "battle-pack-slicer-frame-sliced-v1",
              "shop-top-skip-exchange-scan-v1", "transition-gc-dedupe-v1"]

LOCKS = {
    "MemberImpl/scheduleDirectAttack": {"sha": "fe24bf97e3da", "header": [110, 38, 1, 2]},
    "EnemyImpl/applyAttack": {"sha": "d3bbb8fbe858", "header": [23, 25, 1, 2]},
    "MemberImpl/getStatModifierSkillGaugeCharging": {"sha": "dc4a5916bb83", "header": [3, 22, 1, 2]},
    "EnemyImpl/isBattleDebugToughnessPointGaugeVisible": {"sha": "f22ed568b3d1", "header": [1, 1, 1, 2]},
    "MemberImpl/getConditionsIncludingOuterEnvironments": {"sha": "37257280c482", "header": [1, 1, 1, 2]},
    # v25 新增
    "MemberImpl/getTotalConditions": {"sha": "24ab0f911fad", "header": [2, 1, 1, 2]},
    "ReproduceFileRecordImpl/saveLog": {"sha": "a3f44be61f72", "header": [3, 2, 1, 2]},
    "MiscDataLogic/setAutoSpeedLevel": {"sha": "c3fbb8ac315e", "header": [3, 6, 1, 2]},
    "HudMemberStatus/update": {"sha": "6e9410cdab30", "header": [7, 5, 1, 2]},
    "BattleCharacterLogic/resolveFollowingPathCollection": {"sha": "be6b2b0efb10", "header": [3, 12, 6, 7]},
    "CharacterVoiceLogic/createVoicePathMap": {"sha": "76793ea193c6", "header": [4, 36, 1, 2]},
    "CharacterTableView/present": {"sha": "c89bdddd20bc", "header": [10, 5, 1, 2]},
    "PartyCarouselPageView/apply": {"sha": "e62c6980e042", "header": [10, 9, 1, 2]},
    "HomeView/<ctor>": {"sha": "4fcc157b3ee8", "header": [10, 4, 1, 2]},
    "CharacterTableView/draw": {"sha": "a6e57959c372", "header": [5, 13, 1, 2]},
    "CharacterTable/updateCells": {"sha": "ea7b61a9b8d5", "header": [5, 7, 1, 2]},
    "CharacterCellView/drawWithAdvanceFlag": {"sha": "0266a4cb63cb", "header": [4, 49, 1, 2]},
    "CharacterTable/applyCharacters": {"sha": "c830d532bd2d", "header": [5, 14, 1, 2]},
    "CharacterTableView/applyPatch": {"sha": "e4917e49f303", "header": [10, 7, 1, 2]},
    "CharacterScene/viewDidChange": {"sha": "334df0a00fe8", "header": [10, 4, 1, 2]},
    "BattleScenePlayingStateImpl/proceedBattles": {"sha": "4f68cf457467", "header": [10, 37, 1, 2]},
    # v26 新增
    "BattleStartProductionViewService/setupTextureAtlas": {"sha": "4f4f555dbf94", "header": [10, 5, 1, 2]},
    "LocalLoading/startChild": {"sha": "772081a63339", "header": [3, 3, 1, 2]},
    # v27 新增
    "BattleStartProductionViewService/prepare": {"sha": "3d5055ba1611", "header": [10, 7, 1, 2]},
    # v28 新增
    "ShopTopScene/listCellEnabledResolver": {"sha": "dc43147661af", "header": [2, 2, 1, 2]},
    "LogicSceneTransition/deactivatePreviousScene": {"sha": "61c657f7c029", "header": [11, 4, 1, 2]},
    "ProductionLoading/resetAssets": {"sha": "70aba8421334", "header": [2, 2, 1, 2]},
}
SLICER_SWC = Path(os.environ.get("WF_V28_HELPER_SWC", str(Path(__file__).resolve().parent / "out" / "helpers.swc")))
FORCE_SPILL = int(os.environ.get("WF_V26_FORCE_SPILL", "0") or 0)   # 仅测试包：>0 时 layer0_null 首轮页面边长强制为该值
HIDDEN_PREFIX = "hidden_"   # unique_condition string_id 以此开头 → 状态栏不画图标（状态本身照常生效、计数照常）
KYLE_CODE = "kyle_moon"          # character c0 / SquadMemberSource.mainCharacterStringId
KYLE_BASE_UNIQUE = 13999011      # 凯尔直击基础倍率：层数 = 倍数（0/无 → 不改）
KYLE_PERCOMBO_UNIQUE = 13999012  # 每连击加成：层数 × 0.01%
KYLE_COMBO_CAP = None            # 不设设计上限：引擎 MAX_COMBO=9999、单段伤害钳 MAX_DAMAGE=9,999,999,999（全程 Number，无 int32 截断）
CHARGE_CAP_UNIQUE = 13999010     # 「强化充能速度」固有状态：层数 n → 充能速度上限 n%（n/100；仅当 > 官方 100% 时生效）
CHARGE_CAP_DIV = 100
MERGE_MIN = 4                    # 直击段数 ≥ 4（只有 DSL ACAdditionalDirectAttack 能达到）才合并结算


def sha(b):
    return hashlib.sha256(b).hexdigest()


class Fail(SystemExit):
    pass


def expect(ins, i, op, name=None, abc=None, arg=None):
    x = ins[i]
    if x.op != asm.MNEMONICS[op]:
        raise Fail(f"anchor #{i}: expected {op}, got {x.name}")
    if name is not None and abc.mn_name(x.args[0]).split("::")[-1].split(":")[-1] != name:
        raise Fail(f"anchor #{i}: expected {op} {name}, got {abc.mn_name(x.args[0])}")
    if arg is not None and x.args[0] != arg:
        raise Fail(f"anchor #{i}: operand {x.args} != {arg}")
    return x.args[0] if x.args else None


def mn_from(abc, label, index, op, name):
    body = abc.bodies[bodies.resolve(abc, label)]
    ins = asm.decode(body[5])
    return expect(ins, index, op, name, abc)


def body_ins(abc, label):
    return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])


def find_mn(abc, label, op, name):
    """在参考方法体里找唯一的 (op, 名字) 多名下标——不新建、不猜。"""
    hits = {x.args[0] for x in body_ins(abc, label)
            if x.op == asm.MNEMONICS[op] and x.args and abc.mn_name(x.args[0]).split("::")[-1].split(":")[-1] == name}
    if len(hits) != 1:
        raise Fail(f"multiname {name} via {op} in {label}: {sorted(hits)}")
    return hits.pop()


def trait_mn(abc, cls, name):
    k = [i for i, r in enumerate(abc.instances)
         if (abc.mn_name(r[0]) == cls if "::" in cls else abc.mn_name(r[0]).endswith("::" + cls))]
    if len(k) != 1:
        raise Fail("class " + cls)
    t = [t for t in abc.instances[k[0]][6] if abc.mn_name(t.name).split(":")[-1] == name]
    if len(t) != 1:
        raise Fail(f"trait {cls}.{name}")
    return t[0].name


def slicer_tag():
    """swc → library.swf → 每个 DoABC 标签各含一个 cn.loading 辅助类（BattlePackSlicer、GcGate），原样作为新标签插在主 ABC 之前。"""
    from swfabc import swftags, abcfmt
    if not SLICER_SWC.is_file():
        raise Fail("helper swc missing: " + str(SLICER_SWC))
    with zipfile.ZipFile(SLICER_SWC) as z:
        lib = z.read("library.swf")
    tmp = SLICER_SWC.with_name("helpers_library.swf"); tmp.write_bytes(lib)
    _, _, _, body = swftags.load_swf(str(tmp))
    tags = [(c, o, h, l) for c, o, h, l in swftags.iter_tags(body) if c in (72, 82)]
    import struct as _st
    out = b""; info = []
    for c, o, h, l in tags:
        if c != 82:
            raise Fail("unexpected DoABC1 tag in helper swc")
        content = body[o + h:o + h + l]
        nul = content.index(b"\0", 4)
        a = abcfmt.ABC(content[nul + 1:])
        names = [a.mn_name(r[0]) for r in a.instances]
        if len(names) != 1 or names[0] not in ("cn.loading::BattlePackSlicer", "cn.loading::GcGate"):
            raise Fail("helper ABC defines unexpected classes: " + repr(names))
        for b in a.bodies:
            asm.decode(b[5])
        name = names[0].replace("::", ".").encode()
        payload = (1).to_bytes(4, "little") + name + b"\0" + content[nul + 1:]
        out += _st.pack("<HI", (82 << 6) | 63, len(payload)) + payload
        info.append({"class": names[0], "abc_sha256": sha(content[nul + 1:]), "bodies": len(a.bodies)})
    if sorted(x["class"] for x in info) != ["cn.loading::BattlePackSlicer", "cn.loading::GcGate"]:
        raise Fail("helper set mismatch: " + repr(info))
    return out, {"classes": info, "swc_sha256": sha(SLICER_SWC.read_bytes())}


def patch_swf(src: Path, dst: Path) -> dict:
    swf = SwfAbc(src)
    abc = swf.abc
    before_bodies = [bytes(b[5]) for b in abc.bodies]
    pool0 = (list(abc.strings), list(abc.multinames), list(abc.ints))
    ns0 = list(abc.namespaces)
    pool = PoolEditor(abc)
    idx = {lab: bodies.resolve(abc, lab) for lab in LOCKS}
    for lab, bi in idx.items():
        b = abc.bodies[bi]
        got = sha(b[5])
        if b[1:5] != LOCKS[lab]["header"] or (LOCKS[lab]["sha"] and not got.startswith(LOCKS[lab]["sha"])):
            raise Fail(f"unknown method baseline for {lab}: sha {got[:12]} header {b[1:5]} (locked {LOCKS[lab]}); already patched or different client")
    # ---------------- 锚点
    sd = asm.decode(abc.bodies[idx["MemberImpl/scheduleDirectAttack"]][5])
    option = expect(sd, 461, "getlex", "Option", abc)
    expect(sd, 465, "pushstring", abc=abc, arg=abc.strings.index(MARKER))
    expect(sd, 475, "callproperty", "Some", abc)
    expect(sd, 476, "coerce", "Option", abc)
    if sd[477].op != asm.MNEMONICS["pushstring"] or abc.strings[sd[477].args[0]] != b"createdByCoopCommand":
        raise Fail("anchor 477 is not createdByCoopCommand")
    none_mn = expect(sd, 350, "getproperty", "None", abc)
    if sd[349].op != asm.MNEMONICS["getlex"] or sd[349].args[0] != option:
        raise Fail("anchor 349 is not getlex Option")
    coerce_option = sd[476].args[0]
    expect(sd, 165, "setlocal", arg=11); expect(sd, 163, "inclocal_i", arg=9)
    decimal = expect(sd, 239, "getlex", "Decimal_Impl_", abc)
    expect(sd, 240, "pushbyte", arg=1)
    from_float = expect(sd, 241, "callproperty", "fromFloat", abc)
    expect(sd, 244, "setlocal", arg=26)
    for at, key, val in ((412, b"enablesComboBonus", "pushfalse"), (426, b"currentCombos", "pushbyte")):
        if sd[at].op != asm.MNEMONICS["pushstring"] or abc.strings[sd[at].args[0]] != key:
            raise Fail(f"anchor {at} is not {key!r}")
        expect(sd, at + 1, val)
    if sd[427].args[0] != 0:
        raise Fail("currentCombos literal is not 0")
    expect(sd, 399, "pushstring"); expect(sd, 400, "getlocal", arg=26)
    if abc.strings[sd[399].args[0]] != b"multiplierOfAttackPoint":
        raise Fail("local 26 is not multiplierOfAttackPoint")
    ap = asm.decode(abc.bodies[idx["EnemyImpl/applyAttack"]][5])
    expect(ap, 596, "initproperty", "lastAttackResult", abc)
    expect(ap, 597, "getlocal_2"); expect(ap, 598, "getproperty", "shouldShowDamageFont", abc)
    hit_mn = expect(ap, 656, "getproperty", "hitEffect", abc)
    primary_mn = expect(ap, 662, "getproperty", "createdByPrimaryBattle", abc)
    direct_mn = {x.args[0] for x in ap if x.op == 0x66 and abc.mn_name(x.args[0]).endswith("createdByDirectAttack")}
    if len(direct_mn) != 1:
        raise Fail("createdByDirectAttack multiname not unique")
    direct_mn = direct_mn.pop()
    index_mn = mn_from(abc, "EnemyImpl/showHitEffect", 3, "getproperty", "index")
    params_mn = mn_from(abc, "EnemyImpl/showHitEffect", 11, "getproperty", "params")
    sh = body_ins(abc, "EnemyImpl/showHitEffect")
    expect(sh, 12, "pushbyte", arg=0)
    elem_mn = sh[13].args[0]
    if sh[13].op != 0x66 or abc.multinames[elem_mn][0] != 0x1B:
        raise Fail("element access multiname is not MultinameL")
    paths_mn = mn_from(abc, "ImpactHitEffectManager/show", 18, "getproperty", "paths")
    rot_mn = mn_from(abc, "ImpactHitEffectManager/show", 48, "getproperty", "randomRotation")
    marker_str = abc.strings.index(MARKER)
    gc = asm.decode(abc.bodies[idx["MemberImpl/getStatModifierSkillGaugeCharging"]][5])
    expect(gc, 179, "getlocal_1"); expect(gc, 180, "getlocal_2"); expect(gc, 181, "add"); expect(gc, 184, "setlocal", arg=8)
    bconst = expect(gc, 194, "getlex", "BattleConstants", abc)
    max_mn = expect(gc, 195, "getproperty", "MAX_STAT_MIDIFIER_SKILL_GAUGE_CHARGING", abc)
    expect(gc, 202, "setlocal", arg=8)
    expect(gc, 203, "findproperty", "stats", abc)
    # 其余多名：只取既有条目
    is_leader = trait_mn(abc, "MemberImpl", "isLeader")
    source_mn = trait_mn(abc, "MemberImpl", "source")
    combo_calc = trait_mn(abc, "MemberImpl", "comboCalculator")
    acc_mn = trait_mn(abc, "MemberImpl", "getConditionAccumulationCount")
    main_id = find_mn(abc, "MemberImpl/isExchangedPowerFlip", "getproperty", "mainCharacterStringId")
    mask_cls = find_mn(abc, "ActionEvaluator/evalCommand", "getlex", "MaskGeneral")
    mask_bit = find_mn(abc, "ActionEvaluator/evalCommand", "getproperty", "maskBit")
    get_combo = find_mn(abc, "ActionEvaluator/evalCommand", "callproperty", "getCombo")
    ctk = find_mn(abc, "GeneralEnemy/testUniqueCondition", "getlex", "ConditionTargetKind")
    unique_mn = find_mn(abc, "GeneralEnemy/testUniqueCondition", "callproperty", "Unique")
    kyle_str = pool.string(KYLE_CODE)
    iuniq = pool.integer(CHARGE_CAP_UNIQUE)
    i_base = pool.integer(KYLE_BASE_UNIQUE)
    i_per = pool.integer(KYLE_PERCOMBO_UNIQUE)
    i_10000 = pool.integer(10000)

    # ---------------- 块
    L_B, L_CC, L_P, L_C = 38, 39, 43, 44   # scheduleDirectAttack 新局部（原 localcount 38；40-42 给合并块）
    def acc(uid_idx, dst):
        return [("getlocal_0",), ("getlex", ctk), ("pushint", uid_idx), ("callproperty", unique_mn, 1),
                ("callproperty", acc_mn, 1), ("convert_i",), ("setlocal", dst)]
    kyle = [  # 原 #245：_loc26_ 初值之后。倍率全部由数据（固有层数）决定：
        # mult = B × (1 + P/10000 × combo)；B = 13999011 层数（0/无 → 不改），P = 13999012 层数（单位 0.01%/连击）
        ("getlocal_0",), ("callproperty", is_leader, 0), ("iffalse", "END"),
        ("getlocal_0",), ("getproperty", source_mn), ("getproperty", main_id),
        ("pushstring", kyle_str), ("ifne", "END"),
        *acc(i_base, L_B),
        ("getlocal", L_B), ("pushbyte", 0), ("ifngt", "END"),
        *acc(i_per, L_P),
        ("pushbyte", 0), ("setlocal", L_C),
        ("getlocal_0",), ("getproperty", combo_calc), ("setlocal", L_CC),
        ("getlocal", L_CC), ("iffalse", "NOC"),
        ("getlex", mask_cls), ("getproperty", mask_bit), ("getlocal", L_CC), ("callproperty", get_combo, 0),
        ("convert_i",), ("bitxor",), ("convert_i",), ("setlocal", L_C),
        ("label", "NOC"),
        ("getlex", decimal),
        ("getlocal", L_B), ("pushbyte", 1), ("getlocal", L_P), ("getlocal", L_C), ("multiply",),
        ("pushint", i_10000), ("divide",), ("add",), ("multiply",),
        ("callproperty", from_float, 1), ("convert_d",), ("setlocal", 26),
    ]
    # v25：删除 v23 的 block_a（第 2 段起 hitEffect=None）与 applyAttack 的 (a) 分支。
    # 合并只对凯尔队长生效，被合并的段根本不再排程（单段=总伤，数字照常显示），
    # 所以「被合并段的表现」无需另行静音；官方 2–3 段直击的每段数字/特效/音效恢复原样。
    hit = [("getlocal_1",), ("getproperty", hit_mn)]
    some0 = hit + [("getproperty", params_mn), ("pushbyte", 0), ("getproperty", elem_mn)]
    block_b = [  # 只保留 (b)：凯尔 PF 追加判定区专用标记（randomRotation=false + attack_to_hostile_hit）
        *hit, ("getproperty", index_mn), ("pushbyte", 0), ("ifne", "END"),
        *some0, ("getproperty", rot_mn), ("iftrue", "END"),
        *some0, ("getproperty", paths_mn), ("pushbyte", 0), ("getproperty", elem_mn),
        ("pushstring", marker_str), ("ifne", "END"),
        ("returnvoid",),
    ]
    L_N, L_SUM, L_CAP = 22, 23, 24   # getStatModifierSkillGaugeCharging 新局部（原 localcount 22）
    charge = [  # 原 #203：官方上限钳完之后；持有固有 n 层 → 上限 n/100（仅当 > 官方 MAX）
        # v25(A6)：先比原始和与官方 MAX，和 ≤ MAX（绝大多数帧）直接走官方结果，不再每帧构造 Unique 枚举、扫状态
        ("getlocal_1",), ("getlocal_2",), ("add",), ("convert_d",), ("setlocal", L_SUM),
        ("getlocal", L_SUM), ("getlex", bconst), ("getproperty", max_mn), ("ifngt", "END"),
        ("getlocal_0",), ("getlex", ctk), ("pushint", iuniq), ("callproperty", unique_mn, 1),
        ("callproperty", acc_mn, 1), ("convert_i",), ("setlocal", L_N),
        ("getlocal", L_N), ("pushbyte", 0), ("ifngt", "END"),
        ("getlex", decimal), ("getlocal", L_N), ("pushbyte", CHARGE_CAP_DIV), ("divide",),
        ("callproperty", from_float, 1), ("convert_d",), ("setlocal", L_CAP),
        ("getlocal", L_CAP), ("getlex", bconst), ("getproperty", max_mn), ("ifngt", "END"),
        ("getlocal", L_SUM), ("getlocal", L_CAP), ("ifngt", "USESUM"),
        ("getlocal", L_CAP), ("setlocal", 8), ("jump", "END"),
        ("label", "USESUM"),
        ("getlocal", L_SUM), ("setlocal", 8),
    ]
    # ---- 多段直击合并结算（段数 N ≥ MERGE_MIN）
    at_trig = trait_mn(abc, "MemberImpl", "abilityTrigger")
    stats_mn = trait_mn(abc, "MemberImpl", "stats")
    zm_mn = trait_mn(abc, "MemberImpl", "zoneManager")
    battle_mn = trait_mn(abc, "MemberImpl", "battle")
    mv = body_ins(abc, "DirectAttackScheduler/move")
    parent_mn = expect(mv, 33, "getproperty", "parent", abc)
    enemy_t = expect(mv, 34, "coerce", "Enemy", abc)
    count_up = expect(mv, 44, "callpropvoid", "countUp", abc)
    one_of = expect(mv, 51, "callpropvoid", "oneOfEnemyCountUp", abc)
    da_cnt = expect(mv, 86, "getproperty", "directAttackCount", abc)
    is_fever = expect(mv, 92, "callproperty", "isFeverMode", abc)
    da_fev = expect(mv, 100, "getproperty", "directAttackCountInFever", abc)
    is_my = find_mn(abc, "MemberImpl/update", "callproperty", "__isMyBattle__")
    create_combo = find_mn(abc, "EnemyImpl/applyAttack", "callpropvoid", "createCombo")
    from_int = expect(sd, 253, "callproperty", "fromInt", abc)
    expect(sd, 157, "getlocal", arg=5); expect(sd, 159, "setlocal", arg=10); expect(sd, 160, "jump")
    expect(sd, 406, "getlocal", arg=5); expect(sd, 408, "pushbyte", arg=1); expect(sd, 409, "convert_d")
    expect(sd, 411, "getlocal", arg=28)
    if abc.strings[sd[407].args[0]] != b"basicDetoughness" or abc.strings[sd[410].args[0]] != b"basicFeverPoint":
        raise Fail("source field anchors moved")
    L_N2, L_X, L_K = 40, 41, 42
    enemy = [("getlocal_2",), ("getproperty", parent_mn), ("coerce", enemy_t)]
    merge = [  # 原 #160：循环前。N ≥ 4 → 只排 1 段，伤害不再 ÷N（单段=原 N 段总和），其余 N-1 段的计数/连击在此一次补齐
        ("pushbyte", 0), ("setlocal", L_N2),
        ("getlocal", 5), ("pushbyte", MERGE_MIN), ("iflt", "END"),
        # v25(A1)：只对凯尔队长路径合并（与凯尔倍率块同一判据）；其他角色 N≥4 段走官方逐段结算
        ("getlocal_0",), ("callproperty", is_leader, 0), ("iffalse", "END"),
        ("getlocal_0",), ("getproperty", source_mn), ("getproperty", main_id),
        ("pushstring", kyle_str), ("ifne", "END"),
        ("getlocal", 5), ("setlocal", L_N2),
        ("pushbyte", 1), ("setlocal", 5), ("pushbyte", 1), ("setlocal", 10),
        ("getlocal", L_N2), ("pushbyte", 1), ("subtract_i",), ("setlocal", L_X),
        ("getlocal_0",), ("getproperty", at_trig), *enemy, ("pushbyte", 3), ("getlocal", L_X), ("pushtrue",),
        ("callpropvoid", count_up, 4),
        ("getlocal_0",), ("getproperty", stats_mn), ("dup",), ("getproperty", da_cnt), ("getlocal", L_X), ("add_i",),
        ("initproperty", da_cnt),
        ("getlocal_0",), ("getproperty", zm_mn), ("callproperty", is_fever, 0), ("convert_b",), ("iffalse", "NOFEV"),
        ("getlocal_0",), ("getproperty", stats_mn), ("dup",), ("getproperty", da_fev), ("getlocal", L_X), ("add_i",),
        ("initproperty", da_fev),
        ("label", "NOFEV"),
        ("pushbyte", 0), ("setlocal", L_K), ("jump", "LCHK"),
        ("label", "LOOP"), ("avm_label",),
        ("getlocal_0",), ("getproperty", at_trig), *enemy, ("pushbyte", 2), ("callpropvoid", one_of, 2),
        ("getlocal_0",), ("getproperty", battle_mn), ("callproperty", is_my, 0), ("iffalse", "SKIPC"),
        ("getlocal_0",), ("getproperty", combo_calc), ("callpropvoid", create_combo, 0),
        ("label", "SKIPC"),
        ("inclocal_i", L_K),
        ("label", "LCHK"),
        ("getlocal", L_K), ("getlocal", L_X), ("iflt", "LOOP"),
    ]
    tough = [("getlocal", L_N2), ("pushbyte", MERGE_MIN), ("iflt", "END"), ("pop",), ("getlocal", L_N2)]   # 原 #409
    fever = [("getlocal", L_N2), ("pushbyte", MERGE_MIN), ("iflt", "END"), ("pop",),
             ("getlex", decimal), ("getlocal", L_N2), ("callproperty", from_int, 1), ("convert_d",)]       # 原 #412
    # ---- boss 韧性（击晕）调试条常显：kind == 3 → true
    kind_mn = expect(body_ins(abc, "EnemyImpl/hasBattleDebugToughnessPointProtected"), 5, "getproperty", "kind", abc)
    tv = asm.decode(abc.bodies[idx["EnemyImpl/isBattleDebugToughnessPointGaugeVisible"]][5])
    expect(tv, 4, "getproperty", "viewShowEnemyToughnessPointGauge", abc); expect(tv, 5, "returnvalue")
    stun = [("getlocal_0",), ("getproperty", kind_mn), ("pushbyte", 3), ("ifne", "END"), ("pushtrue",), ("returnvalue",)]
    # ---- 状态栏隐藏 hidden_* 固有状态
    gc2 = asm.decode(abc.bodies[idx["MemberImpl/getConditionsIncludingOuterEnvironments"]][5])
    if len(gc2) != 7:
        raise Fail("getConditionsIncludingOuterEnvironments body changed")
    expect(gc2, 4, "callproperty", "getConditionsIncludingOuterEnvironments", abc); expect(gc2, 6, "returnvalue")
    uc = asm.decode(abc.bodies[bodies.resolve(abc, "UniqueConditionLogic/<ctor>")][5])
    uct = expect(uc, 11, "getlex", "UniqueConditionTable", abc)
    get_mt = expect(uc, 12, "callproperty", "getMasterTable", abc)
    get_data = expect(uc, 14, "callproperty", "get_data", abc)
    mm_get = expect(uc, 17, "callproperty", "get", abc)
    la_mn = trait_mn(abc, "MemberImpl", "logicAssets")
    gi = body_ins(abc, "ConditionIcon/getIconIndex")
    content_mn = expect(gi, 13, "getproperty", "content", abc)
    sid_mn = find_mn(abc, "UniqueConditionLogic/get_stringId", "getproperty", "string_id") if any(
        v == "UniqueConditionLogic/get_stringId" for v in bodies.label_map(abc).values()) else None
    def any_mn(name):
        import collections
        c = collections.Counter()
        for b in abc.bodies:
            for x in asm.decode(b[5]):
                if x.args and x.op in (0x46, 0x4F, 0x66) and abc.multinames[x.args[0]][0] == 7 and abc.mn_name(x.args[0]) == name:
                    c[x.args[0]] += 1
            if c and sum(c.values()) > 20:
                break
        if not c:
            raise Fail("no public multiname " + name)
        return c.most_common(1)[0][0]
    if sid_mn is None:
        sid_mn = any_mn("string_id")
    push_mn, len_mn, indexof_mn = any_mn("push"), any_mn("length"), any_mn("indexOf")
    pfx = pool.string(HIDDEN_PREFIX)
    filt = [  # 原 #6（returnvalue 前，栈顶 = 原数组）
        ("setlocal_1",), ("newarray", 0), ("setlocal_2",),
        ("getlocal_0",), ("getproperty", la_mn), ("getlex", uct), ("callproperty", get_mt, 1),
        ("callproperty", get_data, 0), ("setlocal", 6),
        ("pushbyte", 0), ("setlocal_3",), ("jump", "CHK"),
        ("label", "LOOP"), ("avm_label",),
        ("getlocal_1",), ("getlocal_3",), ("getproperty", elem_mn), ("setlocal", 4),
        ("getlocal", 4), ("getproperty", content_mn), ("getproperty", index_mn), ("pushbyte", 31), ("ifne", "KEEP"),
        ("getlocal", 6), ("getlocal", 4), ("getproperty", content_mn), ("getproperty", params_mn), ("pushbyte", 0),
        ("getproperty", elem_mn), ("callproperty", mm_get, 1), ("setlocal", 5),
        ("getlocal", 5), ("iffalse", "KEEP"),
        ("getlocal", 5), ("getproperty", sid_mn), ("pushstring", pfx), ("callproperty", indexof_mn, 1),
        ("pushbyte", 0), ("ifeq", "SKIP"),
        ("label", "KEEP"),
        ("getlocal_2",), ("getlocal", 4), ("callpropvoid", push_mn, 1),
        ("label", "SKIP"),
        ("inclocal_i", 3),
        ("label", "CHK"),
        ("getlocal_3",), ("getlocal_1",), ("getproperty", len_mn), ("iflt", "LOOP"),
        ("getlocal_2",),
    ]
    # ---- v25(A3)：翻页计数与取页用同一套 hidden_ 过滤：getTotalConditions = 过滤后数组长度
    tcb = body_ins(abc, "MemberImpl/getTotalConditions")
    if len(tcb) != 8:
        raise Fail("getTotalConditions body changed")
    expect(tcb, 5, "callproperty", "getTotalNumberOfConditionsIncludingOuterEnvironments", abc)
    expect(tcb, 6, "convert_i"); expect(tcb, 7, "returnvalue")
    gcioe = trait_mn(abc, "MemberImpl", "getConditionsIncludingOuterEnvironments")
    total = [("pop",), ("getlocal_0",), ("callproperty", gcioe, 0), ("getproperty", len_mn), ("convert_i",)]
    # ---- v25(C11)：latest.log 只写 Snapshot（崩溃后的 errorMessage/stackTrace 就在快照里），逐事件 Instant/Ready 不再序列化落盘
    sl = body_ins(abc, "ReproduceFileRecordImpl/saveLog")
    expect(sl, 2, "findproperty", "closed", abc); expect(sl, 10, "callproperty", "print", abc)
    logway_mn = find_mn(abc, "Reproduce/executeEvent", "getproperty", "logway")
    snaponly = [("getlocal_1",), ("getproperty", logway_mn), ("getproperty", index_mn), ("pushbyte", 2), ("ifeq", "END"),
                ("returnvoid",)]
    # ---- v25(C12)：setAutoSpeedLevel 已有记录且 auto 值不变 → 不 store()（JSON+zlib+同步写盘）
    sa = body_ins(abc, "MiscDataLogic/setAutoSpeedLevel")
    reflect = expect(sa, 40, "getlex", "Reflect", abc); expect(sa, 41, "getlocal_3"); expect(sa, 42, "getlocal", arg=4)
    rfield = expect(sa, 43, "callproperty", "field", abc); auto_mn = expect(sa, 46, "initproperty", "auto", abc)
    expect(sa, 39, "iffalse"); expect(sa, 61, "callpropvoid", "store", abc)
    autoskip = [("getlex", reflect), ("getlocal_3",), ("getlocal", 4), ("callproperty", rfield, 2), ("getproperty", auto_mn),
                ("getlocal_2",), ("ifne", "END"), ("returnvoid",)]
    # ---- v25：杰拉德 149999 white_wolf_gerald 技能准备语音轮换（author-content-1043 已烘进 v17 的三处之后各补一段）
    GER, GER_ID = "white_wolf_gerald", 149999
    gpath = lambda t: f"character/{GER}/voice/battle/{t}"
    alts = [gpath(f"skill_ready_alt_{i}") for i in (1, 2, 3)]
    s_ger = pool.string(GER); s_alt = [pool.string(p) for p in alts]; i_ger = pool.integer(GER_ID)
    hu = body_ins(abc, "HudMemberStatus/update")
    expect(hu, 335, "getlocal_0"); h_char = expect(hu, 336, "getproperty", "character", abc); h_main = expect(hu, 337, "getproperty", "mainCharacterStringId", abc)
    if abc.strings[hu[338].args[0]] != b"samurai_robot_plum":
        raise Fail("HUD anchor 338 is not samurai_robot_plum")
    h_logic = expect(hu, 386, "getproperty", "logic", abc); h_la = expect(hu, 387, "getproperty", "logicAssets", abc)
    h_exists = expect(hu, 389, "callproperty", "existsVoiceFileReader", abc)
    h_opt = expect(hu, 391, "getlex", "Option", abc); h_some = expect(hu, 393, "callproperty", "Some", abc)
    h_coerce = expect(hu, 394, "coerce", "Option", abc); expect(hu, 395, "setlocal", arg=4)
    expect(hu, 382, "pushbyte", arg=0); h_next = expect(hu, 383, "setproperty", "geraldReadyNext", abc)
    expect(hu, 397, "getlocal", arg=4); expect(hu, 398, "getproperty", "index", abc); h_index = hu[398].args[0]
    def h_try(k):
        return [("getlocal_0",), ("getproperty", h_char), ("getproperty", h_logic), ("getproperty", h_la),
                ("pushstring", s_alt[k]), ("callproperty", h_exists, 1), ("iffalse", "END"),
                ("getlex", h_opt), ("pushstring", s_alt[k]), ("callproperty", h_some, 1), ("coerce", h_coerce), ("setlocal", 4)]
    hud = [  # 原 #397（samurai 块之后、播放前；8 条分支落点 ⇒ ENTER）：原生→alt_1→alt_2→alt_3 四拍循环；缺文件=保留原生
        ("getlocal_0",), ("getproperty", h_char), ("getproperty", h_main), ("pushstring", s_ger), ("ifne", "END"),
        ("getlocal", 4), ("getproperty", h_index), ("pushbyte", 0), ("ifne", "END"),
        ("getlocal_0",), ("getproperty", h_next), ("pushbyte", 0), ("ifeq", "S0"),
        ("getlocal_0",), ("getproperty", h_next), ("pushbyte", 1), ("ifeq", "S1"),
        ("getlocal_0",), ("getproperty", h_next), ("pushbyte", 2), ("ifeq", "S2"),
        ("getlocal_0",), ("pushbyte", 0), ("setproperty", h_next), *h_try(2), ("jump", "END"),
        ("label", "S0"), ("getlocal_0",), ("pushbyte", 1), ("setproperty", h_next), ("jump", "END"),
        ("label", "S1"), ("getlocal_0",), ("pushbyte", 2), ("setproperty", h_next), *h_try(0), ("jump", "END"),
        ("label", "S2"), ("getlocal_0",), ("pushbyte", 3), ("setproperty", h_next), *h_try(1),
    ]
    pl = body_ins(abc, "BattleCharacterLogic/resolveFollowingPathCollection")
    expect(pl, 188, "getlocal", arg=5); p_cid = expect(pl, 189, "getproperty", "characterId", abc)
    if abc.ints[pl[190].args[0]] != 159998:
        raise Fail("preload anchor 190 is not 159998")
    p_la = expect(pl, 201, "getproperty", "logicAssets", abc); p_exists = expect(pl, 203, "callproperty", "existsVoiceFileReader", abc)
    p_add = expect(pl, 207, "callpropvoid", "addSoundEffect", abc); expect(pl, 208, "getlocal", arg=5)
    preload = [("getlocal", 5), ("getproperty", p_cid), ("pushint", i_ger), ("ifne", "END")]
    for k in range(3):
        preload += [("getlocal", 5), ("getproperty", p_la), ("pushstring", s_alt[k]), ("callproperty", p_exists, 1),
                    ("iffalse", f"N{k}"), ("getlocal_1",), ("pushstring", s_alt[k]), ("callpropvoid", p_add, 1), ("label", f"N{k}")]
    vp = body_ins(abc, "CharacterVoiceLogic/createVoicePathMap")
    expect(vp, 301, "getlocal_2"); v_cid = expect(vp, 302, "getproperty", "characterId", abc)
    if abc.ints[vp[303].args[0]] != 159998:
        raise Fail("voice page anchor 303 is not 159998")
    v_la = expect(vp, 333, "getproperty", "logicAssets", abc); v_exists = expect(vp, 335, "callproperty", "existsVoiceFileReader", abc)
    expect(vp, 337, "getlocal", arg=21); v_push = expect(vp, 339, "callpropvoid", "push", abc)
    expect(vp, 341, "findproperty", "toPathWithEnabledByPath", abc)
    vpage = [("getlocal_2",), ("getproperty", v_cid), ("pushint", i_ger), ("ifne", "END")]   # 原生列表(skill_ready 等)之后追加 alt_1..3
    for k in range(3):
        vpage += [("getlocal_2",), ("getproperty", v_la), ("pushstring", s_alt[k]), ("callproperty", v_exists, 1),
                  ("iffalse", f"N{k}"), ("getlocal", 21), ("pushstring", s_alt[k]), ("callpropvoid", v_push, 1), ("label", f"N{k}")]
    # ---- v25 协调者追加（编队/角色列表 UI，非战斗）
    def asm_ext(at, src):
        """assemble + 允许 ("@<branch>", 原始下标) 跳到插入点之后的原始指令（同一方法内两插入点之间不得夹别的插入）。"""
        fix, plain, n = [], [], 0
        for e in src:
            if e[0] == "label":
                plain.append(e)
                continue
            if e[0].startswith("@"):
                fix.append((n, e[1]))
                plain.append((e[0][1:], "END"))
            else:
                plain.append(e)
            n += 1
        blk = asm.assemble(plain)
        for k, j in fix:
            if j <= at:
                raise Fail("orig branch must go forward")
            blk[k].target = j - at + len(blk)
        return blk
    def skip_to(at, orig_target):
        """pushtrue; iftrue -> 原始下标 orig_target（被跳过的指令仍可达，校验器照常验证，不制造死代码）。"""
        return asm_ext(at, [("pushtrue",), ("@iftrue", orig_target)])
    pr = body_ins(abc, "CharacterTableView/present")
    expect(pr, 60, "findproperty", "note", abc); expect(pr, 65, "callproperty", "string", abc)
    expect(pr, 78, "callpropvoid", "log", abc); expect(pr, 79, "findproperty", "cellPool", abc)
    pa = body_ins(abc, "PartyCarouselPageView/apply")
    expect(pa, 66, "findproperty", "note", abc); expect(pa, 71, "callproperty", "string", abc)
    expect(pa, 84, "callpropvoid", "log", abc); expect(pa, 85, "pushbyte", arg=0)
    hv = body_ins(abc, "HomeView/<ctor>")
    expect(hv, 18, "findproperty", "antiAliasing", abc); expect(hv, 19, "pushbyte", arg=4); expect(hv, 20, "initproperty", "antiAliasing", abc)
    noaa = [("pop",), ("pushbyte", 0)]
    td = body_ins(abc, "CharacterTableView/draw")
    expect(td, 109, "callproperty", "getWeightSavingMode", abc); expect(td, 110, "convert_i")
    if td[111].op != 0x1B or len(td[111].cases) != 2:
        raise Fail("CharacterTableView.draw anchor 111 is not the weight-saving switch")
    expect(td, 331, "getlocal", arg=4); expect(td, 332, "pushbyte", arg=1); expect(td, 333, "ifnge")
    expect(td, 344, "callpropvoid", "drawInAdvance", abc)
    force_ws = [("pop",), ("pushbyte", 1)]
    per_frame3 = [("pop",), ("pushbyte", 3)]
    # ---- 协调者第二批：角色表（全体角色/编队底栏共用 CharacterTable）N≈500 时每帧全量遍历
    # (1a) CharacterCellView.drawWithAdvanceFlag：屏外格跳过前段 ~380 条颜色/坐标计算，直接进官方「隐藏」块（#437 起）。
    #      v25 初版用「已隐藏就 return」会让异步加载完成后重新显示的台座停在旧位置（真机出现残影），故改为每帧照常执行隐藏块。
    dw = body_ins(abc, "CharacterCellView/drawWithAdvanceFlag")
    expect(dw, 41, "getlocal_1"); expect(dw, 42, "getproperty", "x", abc); expect(dw, 44, "getlocal_2")
    expect(dw, 47, "subtract"); expect(dw, 49, "setlocal", arg=6)
    within_mn = expect(dw, 432, "callproperty", "isWithinScreen", abc)
    expect(dw, 436, "iffalse"); expect(dw, 437, "pushbyte", arg=0); expect(dw, 439, "setlocal", arg=33)
    expect(dw, 440, "findproperty", "hitQuads", abc)
    if dw[436].target != 534:
        raise Fail("drawWithAdvanceFlag hide-branch anchor moved")
    drawskip = [("findproperty", within_mn), ("getlocal", 6), ("callproperty", within_mn, 1), ("iftrue", "END"),
                ("pushtrue",), ("@iftrue", 437)]
    # (1b) CharacterTable.updateCells：离视口超过 ±2160px（约两屏）且不在下落中的格不推进 playhead（z/alpha 照写）
    uc_ = body_ins(abc, "CharacterTable/updateCells")
    expect(uc_, 102, "getlocal", arg=5); expect(uc_, 103, "callpropvoid", "update", abc); expect(uc_, 104, "getlocal_1")
    t_scroll = trait_mn(abc, "pinball.scene.character.characterTable::CharacterTable", "getScrollX")
    c_left = trait_mn(abc, "CharacterCell", "isInLeftSideOutOfScreen"); c_right = trait_mn(abc, "CharacterCell", "isInRightSideOutOfScreen")
    c_fall = trait_mn(abc, "CharacterCell", "isFalling")
    i_margin = pool.integer(2160)
    cellskip = [("getlocal", 5), ("getlocal_0",), ("callproperty", t_scroll, 0), ("pushint", i_margin), ("subtract",),
                ("callproperty", c_left, 1), ("iftrue", "FAR"),
                ("getlocal", 5), ("getlocal_0",), ("callproperty", t_scroll, 0), ("pushint", i_margin), ("add",),
                ("callproperty", c_right, 1), ("iffalse", "END"),
                ("label", "FAR"),
                ("getlocal", 5), ("callproperty", c_fall, 0), ("iftrue", "END"),
                ("pushtrue",), ("@iftrue", 104)]
    # (2) CharacterTable.applyCharacters：indexOf 比较器 O(N^2 log N) → 方法内局部 rank 表 O(N)
    ac = body_ins(abc, "CharacterTable/applyCharacters")
    expect(ac, 98, "getlocal", arg=7); expect(ac, 100, "iffalse"); expect(ac, 101, "pushbyte", arg=0)
    expect(ac, 171, "getlocal", arg=12); expect(ac, 172, "getlocal", arg=5); expect(ac, 173, "getlocal", arg=8)
    expect(ac, 174, "callproperty", "indexOf", abc); expect(ac, 179, "initproperty", "visible", abc)
    cc_mn = expect(ac, 188, "findproperty", "characterCells", abc); keys_mn = expect(ac, 190, "getproperty", "_keys", abc)
    expect(ac, 199, "callpropvoid", "sort", abc); expect(ac, 200, "findproperty", "visibleCharacterKeys", abc)
    map_mn = expect(ac, 133, "getproperty", "map", abc); intmap_t = expect(ac, 134, "coerce", "IntMap", abc)
    h_mn = expect(ac, 135, "getproperty", "h", abc); arr_t = expect(ac, 107, "coerce", "Array", abc)
    a_push = expect(ac, 42, "callpropvoid", "push", abc); a_len = expect(ac, 45, "getproperty", "length", abc)
    R, J, T = 14, 15, 16     # 新局部（原 localcount 14）
    rank = [("newobject", 0), ("setlocal", R), ("pushbyte", 0), ("setlocal", J), ("jump", "C"),
            ("label", "L"), ("avm_label",),
            ("getlocal", R), ("getlocal", 5), ("getlocal", J), ("getproperty", elem_mn), ("pushtrue",), ("setproperty", elem_mn),
            ("inclocal_i", J),
            ("label", "C"), ("getlocal", J), ("getlocal", 5), ("getproperty", a_len), ("convert_i",), ("iflt", "L")]
    # #172 前栈顶 = _loc12_（格）；本块压 (key in rank) 后直接跳到 #179 initproperty visible，原 indexOf 序列不再执行
    # 不可能走到的落空路径先 pop 掉本块结果，保证 #179 汇合点两条路径栈深一致（校验器照常验证原序列）
    visin = [("getlocal", 8), ("getlocal", R), ("in",), ("pushtrue",), ("@iftrue", 179), ("pop",)]
    cells_keys = [("findproperty", cc_mn), ("getproperty", cc_mn), ("getproperty", keys_mn), ("coerce", arr_t), ("setlocal", 10)]
    reorder = [*cells_keys, ("newarray", 0), ("coerce", arr_t), ("setlocal", T),
               ("pushbyte", 0), ("setlocal_3",), ("jump", "P1C"),
               ("label", "P1L"), ("avm_label",),
               ("getlocal", 10), ("getlocal_3",), ("getproperty", elem_mn), ("convert_i",), ("setlocal", 8), ("inclocal_i", 3),
               ("getlocal", 8), ("getlocal", R), ("in",), ("iftrue", "P1C"),
               ("getlocal", T), ("getlocal", 8), ("callpropvoid", a_push, 1),
               ("label", "P1C"), ("getlocal_3",), ("getlocal", 10), ("getproperty", a_len), ("convert_i",), ("iflt", "P1L"),
               ("pushbyte", 0), ("setlocal_3",), ("jump", "P2C"),
               ("label", "P2L"), ("avm_label",),
               ("getlocal", 5), ("getlocal_3",), ("getproperty", elem_mn), ("convert_i",), ("setlocal", 8), ("inclocal_i", 3),
               ("getlocal", 8), ("findproperty", cc_mn), ("getproperty", cc_mn), ("getproperty", map_mn), ("coerce", intmap_t),
               ("getproperty", h_mn), ("in",), ("iffalse", "P2C"),
               ("getlocal", T), ("getlocal", 8), ("callpropvoid", a_push, 1),
               ("label", "P2C"), ("getlocal_3",), ("getlocal", 5), ("getproperty", a_len), ("convert_i",), ("iflt", "P2L"),
               # 长度不一致（列表里有重复键等）→ 退回官方 sort
               ("getlocal", T), ("getproperty", a_len), ("convert_i",), ("getlocal", 10), ("getproperty", a_len), ("convert_i",),
               ("ifne", "END"),
               ("pushbyte", 0), ("setlocal_3",), ("jump", "P3C"),
               ("label", "P3L"), ("avm_label",),
               ("getlocal", 10), ("getlocal_3",), ("getlocal", T), ("getlocal_3",), ("getproperty", elem_mn), ("setproperty", elem_mn),
               ("inclocal_i", 3),
               ("label", "P3C"), ("getlocal_3",), ("getlocal", 10), ("getproperty", a_len), ("convert_i",), ("iflt", "P3L"),
               ("pushtrue",), ("@iftrue", 200)]
    # (3) 关闭的调试日志仍求值：CharacterTableView.applyPatch「更新 」Std.string、CharacterScene.viewDidChange 遍历全部持有角色拼名
    ap2 = body_ins(abc, "CharacterTableView/applyPatch")
    expect(ap2, 40, "findproperty", "note", abc); expect(ap2, 45, "callproperty", "string", abc)
    expect(ap2, 58, "callpropvoid", "log", abc); expect(ap2, 59, "findproperty", "cells", abc)
    vd = body_ins(abc, "CharacterScene/viewDidChange")
    expect(vd, 34, "callpropvoid", "changeState", abc); expect(vd, 35, "findpropstrict", "OrderedMapIterator", abc)
    expect(vd, 40, "callproperty", "getOwnedCharacters", abc); expect(vd, 83, "callpropvoid", "log", abc)
    expect(vd, 87, "iftrue"); expect(vd, 88, "findproperty", "needsHideHeader", abc)
    # ---- 五重：第 1 轮掉线宽限只保留本战斗前 600 帧（约 10 s），之后与其他轮一样 isolateAsForceAbort
    pb = body_ins(abc, "BattleScenePlayingStateImpl/proceedBattles")
    get_my = expect(pb, 110, "findproperty", "get_myBattle", abc); expect(pb, 111, "callproperty", "get_myBattle", abc)
    cur_mn = expect(pb, 113, "getproperty", "currentFrame", abc)
    i600 = pool.integer(600)
    grace = {}
    for at_, iso in ((773, 786), (978, 991), (1057, 1070)):
        expect(pb, at_ - 1, "iffalse"); expect(pb, at_, "getlex", "Log", abc)
        expect(pb, iso, "findproperty", "scene", abc); expect(pb, iso + 2, "callpropvoid", "isolateAsForceAbort", abc)
        if pb[at_ - 1].target != iso or abc.mn_name(pb[at_ - 5].args[0]).split(":")[-1] != "round":
            raise Fail(f"five-boss grace anchor {at_} moved")
        grace[at_] = [("findproperty", get_my), ("callproperty", get_my, 0), ("getproperty", cur_mn), ("pushint", i600),
                      ("@ifge", iso)]
    # ---- v26：LocalLoading.startChild 只给画面子任务（3）挂 System.gc，逻辑前/后段（0/1）、声音（2）不再各做一次全堆 GC（4→1）
    sc = body_ins(abc, "LocalLoading/startChild")
    expect(sc, 16, "getlocal_2"); expect(sc, 17, "getproperty", "waitCompleteImpl", abc)
    expect(sc, 19, "getlex", "System", abc); expect(sc, 20, "getproperty", "gc", abc)
    expect(sc, 22, "callpropvoid", "addCompleteHandler", abc); expect(sc, 23, "getlocal_2"); expect(sc, 24, "returnvalue")
    gc_one = [("getlocal_1",), ("pushbyte", 3), ("@ifne", 23)]
    # ---- v27：分帧合成辅助类 cn.loading.BattlePackSlicer（独立 ABC 标签注入，同 R9/R10）。
    # prepare 在 autoDistribute 之后：BattlePackSlicer.start(this, "layer0_"+gachaId) 为真 → return（辅助类分帧做完再 completeHandler）；
    # 为假（gachaId != null / 开关关 / 初始化异常）→ 原同步路径（含 v26 溢出分页兜底）。
    pr2 = body_ins(abc, "BattleStartProductionViewService/prepare")
    expect(pr2, 111, "findproperty", "autoDistribute", abc); expect(pr2, 112, "getlocal_3")
    expect(pr2, 113, "callpropvoid", "autoDistribute", abc); expect(pr2, 114, "findproperty", "setupTextureAtlas", abc)
    expect(pr2, 115, "getlocal_2")
    def pkg_qname(ns, name):
        want_ns = [i for i, n in enumerate(abc.namespaces) if i and n[0] == 22 and abc.strings[n[1]] == ns.encode()]
        if want_ns:
            nsi = want_ns[0]
        else:
            abc.namespaces.append((22, pool.string(ns))); nsi = len(abc.namespaces) - 1
        si = pool.string(name)
        for i in range(1, len(abc.multinames)):
            if abc.multinames[i] == (7, nsi, si):
                return i
        abc.multinames.append((7, nsi, si)); pool.added_multinames.append(ns + "::" + name)
        return len(abc.multinames) - 1
    slicer_mn = pkg_qname("cn.loading", "BattlePackSlicer"); start_mn = pkg_qname("", "start")
    slicer_gate = [("getlex", slicer_mn), ("getlocal_0",), ("getlocal_2",), ("callproperty", start_mn, 2),
                   ("iffalse", "END"), ("returnvoid",)]
    # ---- v28 (1)：商店首页「活动交换所」格子的可用判断 existsExchangeableEvents() 首次进入会全表扫 EventItemShop
    # （测试服约 8.6k 行，实测 3.9–4.2 s 卡帧）。该判断只决定格子是否灰显；改为恒 Enabled，进入交换所后照常列出可兑换活动。
    lc = body_ins(abc, "ShopTopScene/listCellEnabledResolver")
    if lc[6].op != 0x1B or lc[6].cases[3] != 38:
        raise Fail("shop resolver switch moved")
    expect(lc, 38, "findproperty", "existsExchangeableEvents", abc); expect(lc, 39, "callproperty", "existsExchangeableEvents", abc)
    expect(lc, 42, "getlex", "CellEnabledState", abc); expect(lc, 43, "getproperty", "Enabled", abc); expect(lc, 44, "returnvalue")
    shop_fast = [("pushtrue",), ("@iftrue", 42)]
    # ---- v28 (2)：一次转场里连续两次全堆 GC（resetAssets 处理器里一次 + deactivatePreviousScene 末尾一次）→ 1.5 s 内只做一次
    gate_mn = pkg_qname("cn.loading", "GcGate"); skip_mn = pkg_qname("", "skip")
    dp = body_ins(abc, "LogicSceneTransition/deactivatePreviousScene")
    gc_at = [i for i, x in enumerate(dp) if x.op == 0x4F and abc.mn_name(x.args[0]).split(":")[-1] == "gc"]
    if len(gc_at) != 1 or dp[gc_at[0] - 1].op != 0x60 or dp[gc_at[0] + 1].op != 0x47:
        raise Fail("deactivatePreviousScene gc anchor moved")
    dp_gc = gc_at[0] - 1
    rs = body_ins(abc, "ProductionLoading/resetAssets")
    gc_at2 = [i for i, x in enumerate(rs) if x.op == 0x4F and abc.mn_name(x.args[0]).split(":")[-1] == "gc"]
    if len(gc_at2) != 1 or rs[gc_at2[0] - 1].op != 0x60 or rs[gc_at2[0] + 1].op != 0x47:
        raise Fail("ProductionLoading.resetAssets gc anchor moved")
    rs_gc = gc_at2[0] - 1
    def gate(after):
        return [("getlex", gate_mn), ("callproperty", skip_mn, 0), ("@iftrue", after)]
    plan = {
        "MemberImpl/getConditionsIncludingOuterEnvironments": [(6, filt, asm.FORBID)],
        "EnemyImpl/isBattleDebugToughnessPointGaugeVisible": [(2, stun, asm.FORBID)],
        "MemberImpl/scheduleDirectAttack": [(160, merge, asm.FORBID), (245, kyle, asm.FORBID), (409, tough, asm.FORBID),
                                            (412, fever, asm.FORBID)],
        "EnemyImpl/applyAttack": [(597, block_b, asm.FORBID)],
        # #203 是官方 `if(MAX < x)` 假分支的落点 ⇒ ENTER：两条路径都要经过本块
        "MemberImpl/getStatModifierSkillGaugeCharging": [(203, charge, asm.ENTER)],
        "MemberImpl/getTotalConditions": [(7, total, asm.FORBID)],
        "ReproduceFileRecordImpl/saveLog": [(2, snaponly, asm.FORBID)],
        "MiscDataLogic/setAutoSpeedLevel": [(40, autoskip, asm.FORBID)],
        "HudMemberStatus/update": [(397, hud, asm.ENTER)],
        "BattleCharacterLogic/resolveFollowingPathCollection": [(208, preload, asm.ENTER)],
        "CharacterVoiceLogic/createVoicePathMap": [(341, vpage, asm.ENTER)],
        "CharacterTableView/present": [(60, skip_to(60, 79), asm.FORBID)],
        # #66 是 `if(abilitySouls.length != 0)` 的落点 ⇒ ENTER：两条路径都跳过日志
        "PartyCarouselPageView/apply": [(66, skip_to(66, 85), asm.ENTER)],
        "HomeView/<ctor>": [(20, noaa, asm.FORBID)],
        "CharacterTableView/draw": [(111, force_ws, asm.FORBID), (333, per_frame3, asm.FORBID)],
        "CharacterCellView/drawWithAdvanceFlag": [(50, drawskip, asm.FORBID)],
        "CharacterTable/updateCells": [(102, cellskip, asm.FORBID)],
        "CharacterTable/applyCharacters": [(101, rank, asm.FORBID), (172, visin, asm.FORBID), (188, reorder, asm.FORBID)],
        "CharacterTableView/applyPatch": [(40, skip_to(40, 59), asm.FORBID)],
        "CharacterScene/viewDidChange": [(35, skip_to(35, 88), asm.FORBID)],
        "BattleScenePlayingStateImpl/proceedBattles": [(k, v, asm.FORBID) for k, v in sorted(grace.items())],
        "LocalLoading/startChild": [(16, gc_one, asm.FORBID)],
        "BattleStartProductionViewService/prepare": [(114, slicer_gate, asm.FORBID)],
        # #38 是 lookupswitch case 3 的落点 ⇒ ENTER
        "ShopTopScene/listCellEnabledResolver": [(38, shop_fast, asm.ENTER)],
        "LogicSceneTransition/deactivatePreviousScene": [(dp_gc, gate(dp_gc + 2), asm.ENTER)],
        "ProductionLoading/resetAssets": [(rs_gc, gate(rs_gc + 2), asm.ENTER)],
    }
    report = {}
    for lab, adds in plan.items():
        body = abc.bodies[idx[lab]]
        before = bytes(body[5]); header_before = list(body[1:5])
        code, exc, merged, placed = asm.splice_many(body, [(at, bl if isinstance(bl[0], asm.Instruction) else asm_ext(at, bl), pol) for at, bl, pol in adds])
        if asm.unsplice_many(code, placed) != before:
            raise Fail("not reversible: " + lab)
        analysis = [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in merged]
        try:
            metrics = asm.simulate(analysis, body[3], abc.multinames)
        except Exception as e:
            raise Fail(f"simulate {lab}: {e}")
        base_ins = [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in asm.decode(before)]
        base_unreach = asm.simulate(base_ins, body[3], abc.multinames)[2]   # 官方体本身的死代码(throw 后的 jump 等)
        if metrics[1] != body[4] or metrics[2] != base_unreach:
            raise Fail(f"stack/scope check failed: {lab} {metrics}")
        body[1] = max(body[1], metrics[0])
        body[2] = max(body[2], asm.block_locals(merged))
        body[5], body[6] = code, exc
        report[lab] = {"body": idx[lab], "before": sha(before), "after": sha(code), "inserted_at": placed,
                       "header_before": header_before, "header_after": list(body[1:5]), "metrics": list(metrics)}
    # ======== v26：图集溢出分页（U_1d93f4 根治的「必须」部分） + LocalLoading GC 4→1
    # setupTextureAtlas(name, target, color, colorChanges)：原体 registerTextureAtlas(name, target, pack(name, target, 4096, 4096, ...))。
    # 给 #2..#14 包一层异常处理：pack 抛 "size exceeded" 且条目 >= 2 时，按全局奇偶把 image/dynamicTexture/spriteSheet
    # 拆成两半，前半沿用原名（官方复用门 existsImage(layer0_xxx) 照常命中），后半名字加 "#2"，各自递归调用
    # setupTextureAtlas（还放不下就继续拆）。bitmapFont 列表全部交给后半，保证所有子图都已登记后才替换位图字体。
    # 子图按名字逐个登记进 textureCache（registerTextureAtlas 原逻辑），所有使用方按名字取图，分页对它们透明。
    # pack 在 packer.pack() 阶段就抛出，此时还没建 RenderTexture（发布版 opaqueBackgroundRenderTexture=false），无泄漏。
    st_lab = "BattleStartProductionViewService/setupTextureAtlas"
    st_bi = bodies.resolve(abc, st_lab); st_body = abc.bodies[st_bi]
    st_ins = asm.decode(st_body[5])
    if len(st_ins) != 16 or st_body[6]:
        raise Fail("setupTextureAtlas body changed")
    expect(st_ins, 2, "findproperty", "registerTextureAtlas", abc); expect(st_ins, 5, "findproperty", "pack", abc)
    expect(st_ins, 8, "pushint"); expect(st_ins, 9, "pushint")
    if abc.ints[st_ins[8].args[0]] != 4096 or abc.ints[st_ins[9].args[0]] != 4096:
        raise Fail("setupTextureAtlas size anchors moved")
    expect(st_ins, 12, "callproperty", "pack", abc); expect(st_ins, 14, "callpropvoid", "registerTextureAtlas", abc)
    expect(st_ins, 15, "returnvoid")
    setup_mn = find_mn(abc, "BattleStartProductionViewService/prepare", "callpropvoid", "setupTextureAtlas")
    ct = body_ins(abc, "BattleStartProductionViewService$/concatPackingTarget")
    k_mn = {"image": expect(ct, 2, "getproperty", "image", abc), "bitmapFont": expect(ct, 11, "getproperty", "bitmapFont", abc),
            "spriteSheet": expect(ct, 20, "getproperty", "spriteSheet", abc), "dynamicTexture": expect(ct, 29, "getproperty", "dynamicTexture", abc)}
    k_str = {k: pool.string(k) for k in k_mn}
    s_exceeded = pool.string("size exceeded"); s_page2 = pool.string("#2")
    E, A, Bv, K, I, ARR = 5, 6, 7, 8, 9, 10
    catch = [("getlocal_0",), ("pushscope",), ("setlocal", E),
             ("getlocal", E), ("convert_s",), ("pushstring", s_exceeded), ("callproperty", indexof_mn, 1),
             ("pushbyte", 0), ("iflt", "RETHROW"),
             ("getlocal_2",), ("getproperty", k_mn["image"]), ("getproperty", len_mn),
             ("getlocal_2",), ("getproperty", k_mn["dynamicTexture"]), ("getproperty", len_mn), ("add",),
             ("getlocal_2",), ("getproperty", k_mn["spriteSheet"]), ("getproperty", len_mn), ("add",),
             ("pushbyte", 2), ("iflt", "RETHROW")]
    for dvar, font in ((A, False), (Bv, True)):
        for k in ("image", "dynamicTexture", "spriteSheet"):
            catch += [("pushstring", k_str[k]), ("newarray", 0)]
        catch += [("pushstring", k_str["bitmapFont"])]
        catch += [("getlocal_2",), ("getproperty", k_mn["bitmapFont"])] if font else [("newarray", 0)]
        catch += [("newobject", 4), ("setlocal", dvar)]
    catch += [("pushbyte", 0), ("setlocal", K)]
    for k in ("image", "dynamicTexture", "spriteSheet"):
        catch += [("getlocal_2",), ("getproperty", k_mn[k]), ("setlocal", ARR), ("pushbyte", 0), ("setlocal", I),
                  ("jump", "C" + k),
                  ("label", "L" + k), ("avm_label",),
                  ("getlocal", K), ("pushbyte", 1), ("bitand",), ("iftrue", "TB" + k),
                  ("getlocal", A), ("jump", "P" + k),
                  ("label", "TB" + k), ("getlocal", Bv),
                  ("label", "P" + k), ("getproperty", k_mn[k]), ("getlocal", ARR), ("getlocal", I), ("getproperty", elem_mn),
                  ("callpropvoid", push_mn, 1),
                  ("inclocal_i", K), ("inclocal_i", I),
                  ("label", "C" + k), ("getlocal", I), ("getlocal", ARR), ("getproperty", len_mn), ("iflt", "L" + k)]
    catch += [("getlocal_0",), ("getlocal_1",), ("getlocal", A), ("getlocal_3",), ("getlocal", 4), ("callpropvoid", setup_mn, 4),
              ("getlocal_0",), ("getlocal_1",), ("pushstring", s_page2), ("add",), ("convert_s",), ("getlocal", Bv), ("getlocal_3",),
              ("getlocal", 4), ("callpropvoid", setup_mn, 4),
              ("returnvoid",),
              ("label", "RETHROW"), ("getlocal", E), ("throw",)]
    st_adds = []
    if FORCE_SPILL:   # 仅测试包：layer0_null 首轮用 FORCE_SPILL² 页面，逼出分页路径
        s_l0 = pool.string("layer0_null"); i_force = pool.integer(FORCE_SPILL)
        st_adds.append((10, [("getlocal_1",), ("pushstring", s_l0), ("ifne", "END"), ("pop",), ("pop",),
                             ("pushint", i_force), ("pushint", i_force)], asm.FORBID))
    st_adds.append((16, catch, asm.FORBID))
    st_before = bytes(st_body[5]); st_header_before = list(st_body[1:5])
    code, exc, merged, placed = asm.splice_many(st_body, [(at, asm_ext(at, bl), pol) for at, bl, pol in st_adds])
    if asm.unsplice_many(code, placed) != st_before:
        raise Fail("not reversible: " + st_lab)
    shift = placed[0][1] if FORCE_SPILL else 0
    catch_at = placed[-1][0]
    offs = asm.encode(merged)[1]
    exc = list(exc) + [(offs[2], offs[15 + shift], offs[catch_at], 0, 0)]
    st_metrics = asm.simulate(merged, st_body[3], abc.multinames, exception_targets=[catch_at])
    if st_metrics[1] != st_body[4] or st_metrics[2]:
        raise Fail(f"stack/scope check failed: {st_lab} {st_metrics}")
    st_body[1] = max(st_body[1], st_metrics[0]); st_body[2] = max(st_body[2], asm.block_locals(merged))
    st_body[5], st_body[6] = code, exc
    report[st_lab] = {"body": st_bi, "before": sha(st_before), "after": sha(code), "inserted_at": placed,
                      "header_before": st_header_before, "header_after": list(st_body[1:5]), "metrics": list(st_metrics),
                      "exception_table_added": exc[-1], "force_spill_test_only": FORCE_SPILL}
    idx[st_lab] = st_bi
    changed = [i for i, b in enumerate(abc.bodies) if bytes(b[5]) != before_bodies[i]]
    if sorted(changed) != sorted(idx.values()):
        raise Fail(f"unexpected body changes: {changed}")
    # 常量池只追加：原有条目逐个不变
    if abc.strings[:len(pool0[0])] != pool0[0] or abc.multinames[:len(pool0[1])] != pool0[1] or abc.ints[:len(pool0[2])] != pool0[2]:
        raise Fail("existing constant pool entries changed")
    if abc.namespaces[:len(ns0)] != ns0:
        raise Fail("existing namespaces changed")
    helper_tag, helper_info = slicer_tag()
    import struct as _st, zlib as _z
    raw_main = swf.abc.serialize()
    content = swf._prefix + raw_main
    main_tag = _st.pack("<HI", (82 << 6) | 63, len(content)) + content
    body2 = swf.body[:swf._offset] + helper_tag + main_tag + swf.body[swf._offset + swf._length:]
    payload = _z.compress(body2) if swf.signature == b"CWS" else body2
    data = swf.signature + bytes([swf.version]) + _st.pack("<I", len(body2) + 8) + payload
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(data)
    back = SwfAbc(dst)
    for lab, bi in idx.items():
        if sha(back.abc.bodies[bi][5]) != report[lab]["after"]:
            raise Fail("readback mismatch " + lab)
    return {"source_swf_sha256": sha(src.read_bytes()), "output_swf_sha256": sha(data),
            "source_abc_sha256": sha(SwfAbc(src).abc.serialize()), "output_abc_sha256": sha(back.abc.serialize()),
            "methods": report, "bodies_total": len(abc.bodies), "bodies_changed": len(changed),
            "constant_pool_appended": pool.report(),
            "helper_abc": helper_info,
            "constants": {"kyle_code": KYLE_CODE, "kyle_formula": "mult = n(13999011) * (1 + n(13999012)/10000 * combo), leader && kyle_moon only", "kyle_combo_cap": "none (engine MAX_COMBO 9999; MAX_DAMAGE clamp)",
                          "charge_cap_unique": CHARGE_CAP_UNIQUE, "charge_cap_formula": f"stacks/{CHARGE_CAP_DIV} (only if above engine max 1.0)", "merge_min_segments": MERGE_MIN, "merge_scope": "isLeader() && mainCharacterStringId == kyle_moon",
                          "score_patch": "absent (v24 battle-score-x0.01 NOT included)", "voice_149999": "native skill_ready -> alt_1 -> alt_2 -> alt_3 (missing file keeps native)",
                          "character_table_apply_per_frame": 3, "home_antialiasing": 0}}


def is_sig(name):
    p = name.upper().split("/")
    return len(p) == 2 and p[0] == "META-INF" and (p[1] == "MANIFEST.MF" or p[1].endswith((".RSA", ".SF", ".DSA", ".EC")))


def run(args, env=None):
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True, encoding="utf8", errors="replace", env=env)
    if r.returncode:
        raise Fail(f"{Path(str(args[0])).name} failed ({r.returncode}); output withheld (signing inputs)")
    return r.stdout


def signer_env(kind):
    env = os.environ.copy()
    env["JAVA_HOME"] = str(JAVA_HOME)
    env["PATH"] = str(JAVA_HOME / "bin") + os.pathsep + env.get("PATH", "")
    if kind == "debug":
        env["WF_HITFX_KS"] = env["WF_HITFX_KEY"] = "android"   # Android SDK 标准 debug 口令
        return env, ["--ks", DEBUG_KS, "--ks-key-alias", "androiddebugkey"]
    tree = ast.parse(LOCAL_KS_SRC.read_text(encoding="utf8"))
    vals = {}
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "add_argument"
                and node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value in ("--ks-pass", "--ks-key-pass")):
            vals[node.args[0].value] = ast.literal_eval(next(k.value for k in node.keywords if k.arg == "default"))
    ks = (vals.get("--ks-pass") or "").removeprefix("pass:")
    kp = (vals.get("--ks-key-pass") or vals.get("--ks-pass") or "").removeprefix("pass:")
    if not ks:
        raise Fail("local keystore password not found")
    env["WF_HITFX_KS"], env["WF_HITFX_KEY"] = ks, kp or ks
    return env, ["--ks", LOCAL_KS]


def certs(apk, env):
    out = run([TOOLS / "apksigner.bat", "verify", "--verbose", "--print-certs", apk], env)
    d = sorted(set(re.findall(r"certificate SHA-256 digest: ([0-9a-f]{64})", out)))
    if not d:
        raise Fail("no verified certificate")
    return d, {"v1": "Verified using v1 scheme (JAR signing): true" in out,
               "v2": "Verified using v2 scheme (APK Signature Scheme v2): true" in out}


def build(a):
    work = Path(a.work)
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    out = Path(a.out)
    if out.exists():
        raise Fail("output exists: " + str(out))
    base = Path(a.apk)
    base_bytes_sha = sha(base.read_bytes())
    env, ksargs = signer_env(a.signer)
    base_certs, _ = certs(base, env)
    src_swf = work / "base.swf"
    with zipfile.ZipFile(base) as z:
        names = z.namelist()
        if names.count(SWF_MEMBER) != 1 or len(set(names)) != len(names):
            raise Fail("missing/duplicate members")
        src_swf.write_bytes(z.read(SWF_MEMBER))
        manifest = z.read("AndroidManifest.xml")
    swf_report = patch_swf(src_swf, work / "patched.swf")
    swf = (work / "patched.swf").read_bytes()
    # AIR uniqueappversionid：清单里同长 UTF-16 替换
    text = manifest.decode("utf-16le", "ignore")
    olds = sorted(set(re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", text)))
    if len(olds) != 1 or manifest.count(olds[0].encode("utf-16le")) != 1:
        raise Fail(f"manifest uniqueappversionid not unique: {olds}")
    new_uid = str(uuid.uuid4())
    manifest2 = manifest.replace(olds[0].encode("utf-16le"), new_uid.encode("utf-16le"))
    unsigned, aligned = work / "unsigned.apk", work / "aligned.apk"
    kept = {}
    with zipfile.ZipFile(base) as s, zipfile.ZipFile(unsigned, "w") as d:
        d.comment = s.comment
        for m in s.infolist():
            if is_sig(m.filename):
                continue
            data = swf if m.filename == SWF_MEMBER else manifest2 if m.filename == "AndroidManifest.xml" else s.read(m)
            d.writestr(m, data)
            kept[m.filename] = (sha(data), m.compress_type)
    run([TOOLS / "zipalign.exe", "-p", "-f", "4", unsigned, aligned])
    out.parent.mkdir(parents=True, exist_ok=True)
    run([TOOLS / "apksigner.bat", "sign", "--v4-signing-enabled", "false", *ksargs,
         "--ks-pass", "env:WF_HITFX_KS", "--key-pass", "env:WF_HITFX_KEY", "--out", out, aligned], env)
    out_certs, schemes = certs(out, env)
    if out_certs != base_certs:
        raise Fail("signer certificate differs from base — would not install over it")
    run([TOOLS / "zipalign.exe", "-c", "-p", "4", out])
    with zipfile.ZipFile(out) as r:
        if {n for n in r.namelist() if not is_sig(n)} != set(kept) or r.testzip() is not None:
            raise Fail("member inventory/CRC differs")
        for n, exp in kept.items():
            if (sha(r.read(n)), r.getinfo(n).compress_type) != exp:
                raise Fail("member changed: " + n)
    if sha(base.read_bytes()) != base_bytes_sha:
        raise Fail("base APK changed during build")
    for p in (unsigned, aligned):
        p.unlink()
    rep = {"capability": CAPABILITY, "status": "signed_static_candidate", "installed": False, "runtime_verified": False,
           "base_apk": str(base), "base_apk_sha256": base_bytes_sha, "apk": str(out), "apk_sha256": sha(out.read_bytes()),
           "signer": a.signer, "certificate_sha256": out_certs, "signature_schemes": schemes,
           "uniqueappversionid": {"before": olds[0], "after": new_uid},
           "changed_members": ["AndroidManifest.xml", SWF_MEMBER, "META-INF signature"],
           "preserved_members": len(kept) - 2, **swf_report}
    out.with_suffix(".build-report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2) + "\n", "utf8")
    print(json.dumps({k: rep[k] for k in ("apk", "apk_sha256", "output_swf_sha256", "certificate_sha256", "uniqueappversionid")}, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apk", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--signer", choices=("local", "debug"), required=True)
    p.add_argument("--work", default=None)
    a = p.parse_args()
    a.work = a.work or str(Path(a.out).with_suffix(".work"))
    build(a)


if __name__ == "__main__":
    main()
