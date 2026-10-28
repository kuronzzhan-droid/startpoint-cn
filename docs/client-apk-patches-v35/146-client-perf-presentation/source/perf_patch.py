"""第十四轮：纯表现层性能补丁（伤害数字合并 / 命中特效每帧预算 / 队友镜像累计浮字不建视图）。

三组互相独立，可按组开关（build.py --patches）。只做：被锁方法内插入指令、
已有类追加助手方法和静态槽、常量池尾部追加名字。不碰伤害结算、连击、触发计数、
联机命令、战斗随机数。上限常量集中在 LIMITS，改值后重跑 build.py 即可。
"""
import asm

EFFECT_NS = "pinball.scene.battle.battle.effect::"
EMI = EFFECT_NS + "EffectManagerImpl"
DIM = EFFECT_NS + "DamageIndicatorManager"
BV = "pinball.scene.battle.view::BattleView"

DIM_SHOW = "DamageIndicatorManager/show"
DIM_UPDATE = "DamageIndicatorManager/update"
EMI_ADD = "EffectManagerImpl/addDamageEffect"
EMI_SHOW = "EffectManagerImpl/show"
BV_SHOW = "BattleView/show"

# 上限常量（全部 pushbyte，范围 1..127）。默认值见 README。
LIMITS = {
    "DMG_PER_TARGET": 2,    # 同一目标、同一合并窗口内单独显示的伤害数字条数，超出的并入一条合计
    "DMG_GLOBAL": 16,       # 全场每逻辑帧单独显示的敌方伤害数字条数，超出的并入各自目标的合计
    "DMG_WINDOW": 1,        # 合并窗口（逻辑帧）。1 = 同帧合并，合计数字在下一帧开头显示
    "HIT_PER_FRAME": 6,     # 全场每逻辑帧新建的命中特效（SimpleEffectKind 63）上限
}

GROUPS = ("merge", "hitbudget", "otheraccum")
CAPABILITY = "client-perf-presentation-v1"


def _limit(name):
    value = LIMITS[name]
    if not (isinstance(value, int) and 1 <= value <= 127):
        raise asm.AsmError(f"{name} 必须是 1..127 的整数: {value!r}")
    return ("pushbyte", value)


def _ins(editor, label):
    return asm.decode(editor.body(label)[5])


def _mn(editor, label, name, ops=("getproperty",)):
    """取被锁原方法里某条指令实际使用的 multiname 下标（复用原名字，不猜命名空间）。"""
    hits = {x.args[0] for x in _ins(editor, label)
            if x.name in ops and editor.abc.mn_name(x.args[0]).split("::")[-1] == name}
    if len(hits) != 1:
        raise asm.AsmError(f"{label} 中 {ops}/{name} 的 multiname 不唯一: {sorted(hits)}")
    return hits.pop()


def _rt(editor, label):
    hits = {x.args[0] for x in _ins(editor, label) if x.name == "getproperty"
            and editor.abc.multinames[x.args[0]][0] == 0x1B}
    if len(hits) != 1:
        raise asm.AsmError(f"{label} 运行时下标 multiname 不唯一: {sorted(hits)}")
    return hits.pop()


def _check_shape(ins, expect):
    for index, name in expect.items():
        if ins[index].name != name:
            raise asm.AsmError(f"锁定形状不符 #{index}: {ins[index].name} != {name}")


def _weak_state(editor, lex, slot, key, init, map_local, st_local, tag):
    """静态槽里懒建 haxe.ds.WeakMap，按 key 取状态数组，没有就用 init 建一个并登记。"""
    q = editor.q
    return [
        lex, ("getproperty", slot), ("setlocal", map_local),
        ("getlocal", map_local), ("iftrue", tag + "HAVE"),
        ("getlex", q("haxe.ds::WeakMap")), ("construct", 0), ("setlocal", map_local),
        lex, ("getlocal", map_local), ("setproperty", slot),
        ("label", tag + "HAVE"),
        ("getlocal", map_local), *key, ("callproperty", q("get"), 1), ("setlocal", st_local),
        ("getlocal", st_local), ("iftrue", tag + "READY"),
        *init, ("newarray", len(init)), ("setlocal", st_local),
        ("getlocal", map_local), *key, ("getlocal", st_local), ("callpropvoid", q("set"), 2),
        ("label", tag + "READY"),
    ]


# ---------------------------------------------------------------------------
def build_merge(editor):
    """组 A：同帧同目标伤害数字合并（逐条保留 ≥5000万 溢出统计）。"""
    q = editor.q
    show = _ins(editor, DIM_SHOW)
    _check_shape(show, {2: "findproperty", 9: "callproperty", 10: "coerce", 11: "callpropvoid",
                        12: "pushfalse", 112: "returnvoid"})
    add = _ins(editor, EMI_ADD)
    _check_shape(add, {2: "getlocal_3", 8: "iffalse", 17: "initproperty", 18: "findproperty",
                       33: "constructprop", 34: "callpropvoid", 35: "returnvoid"})
    if add[8].target != 18:
        raise asm.AsmError("addDamageEffect 溢出判断分支落点不是 #18")
    upd = _ins(editor, DIM_UPDATE)
    _check_shape(upd, {2: "findproperty", 17: "returnvoid"})

    rt = _rt(editor, EMI_SHOW)               # 原 show 里 params[N] 用的运行时下标名
    m_primary = _mn(editor, DIM_SHOW, "primaryBattle")
    m_em = _mn(editor, DIM_SHOW, "effectManager")
    m_effectkind = show[4].args[0]          # getlex EffectKind
    m_dth = show[9].args[0]                 # callproperty DamageToHostile
    m_coerce_kind = show[10].args[0]        # coerce EffectKind
    m_show = show[11].args[0]               # callpropvoid EffectManager::show
    hostile = "EffectManagerImpl/addDamageToHostile"
    m_poison = _mn(editor, hostile, "createdByPoison")
    m_damage = _mn(editor, hostile, "damage")
    # 伤害是 Decimal100 定点数（原始值 = 显示值 × RESOLTION）。原 addDamageToHostile 用 Damage.ffloor
    # = Decimal100.toFloat(Decimal100.dfloor(raw)) 得到显示整数。合计必须仍是原始单位：逐条累加
    # Decimal100.dfloor(raw)，最后经原路径 ffloor 一次，显示值恰为各条显示值之和（复核方第二轮 P1）。
    m_dec100 = _mn(editor, "Damage_Impl_$/ffloor", "Decimal100_Impl_", ("getlex",))
    m_dfloor = _mn(editor, "Decimal100_Impl_$/ffloor", "dfloor", ("callproperty",))
    m_battle = _mn(editor, hostile, "battle")
    m_frame = _mn(editor, "EffectManagerImpl/supressHitEffect", "currentFrame")
    flags = {}
    for name in ("createdByPowerFlipAction", "createdBySkillAction", "specificDamageResistance",
                 "damageIncreasedBecauseTargetIsPinched", "damageIncreasedBecauseOppositeElement"):
        flags[name] = _mn(editor, hostile, name)
    for name in ("createdByAbility", "createdByDirectAttack"):
        flags[name] = _mn(editor, DIM_SHOW, name)

    mode = editor.add_slot(EMI, "wfxDamageMode", "*", static=True)
    states = editor.add_slot(DIM, "wfxMergeStates", "*", static=True)
    gstates = editor.add_slot(DIM, "wfxGlobalStates", "*", static=True)
    lex_dim, lex_emi = ("getlex", q(DIM)), ("getlex", q(EMI))
    n = editor.number

    # 目标状态（弱键 WeakMap：键=本 DamageIndicatorManager 实例，静态槽不强引用任何战斗对象）
    # [0 本帧已单独显示条数, 1 待合计伤害, 2 最后一条原始信息, 3 x, 4 y, 5 角度, 6 待合计起始帧, 7 计数所属帧]
    state = editor.add_method(DIM, "wfxMergeState", "*", [], [
        ("getlocal_0",), ("pushscope",),
        *_weak_state(editor, lex_dim, states, [("getlocal_0",)],
                     [n(0), n(0), ("pushnull",), n(0), n(0), n(0), n(0), n(-1)], 1, 2, "S"),
        ("getlocal_2",), ("returnvalue",),
    ], 3)

    # 出合计：有待合计伤害就以最后一条的样式出一条合计数字。wfxDamageMode=2 让 addDamageEffect
    # 跳过溢出统计（合计值不是一次真实伤害，原始各条已在命中当次逐条统计）。参数 = 目标状态数组。
    pairs = [("pushstring", editor.string("damage")[1]), ("getlocal_1",), n(1), ("getproperty", rt),
             ("pushstring", editor.string("createdByPoison")[1]), ("pushfalse",)]
    for name in ("createdByPowerFlipAction", "createdBySkillAction", "createdByAbility",
                 "createdByDirectAttack", "specificDamageResistance",
                 "damageIncreasedBecauseOppositeElement", "damageIncreasedBecauseTargetIsPinched"):
        pairs += [("pushstring", editor.string(name)[1]), ("getlocal_2",), ("getproperty", flags[name])]
    emit = editor.add_method(DIM, "wfxEmitPending", "void", ["*"], [
        ("getlocal_0",), ("pushscope",),
        ("getlocal_1",), n(1), ("getproperty", rt), n(0), ("ifngt", "DONE"),
        ("getlocal_1",), n(2), ("getproperty", rt), ("setlocal_2",),
        *pairs, ("newobject", 9), ("setlocal_3",),
        ("getlocal_1",), n(1), n(0), ("setproperty", rt),
        ("getlocal_1",), n(2), ("pushnull",), ("setproperty", rt),
        lex_emi, n(2), ("setproperty", mode),
        ("getlocal_0",), ("getproperty", m_em),
        ("getlex", m_effectkind),
        ("getlocal_1",), n(3), ("getproperty", rt), ("convert_d",),
        ("getlocal_1",), n(4), ("getproperty", rt), ("convert_d",),
        ("getlocal_1",), n(5), ("getproperty", rt), ("convert_d",),
        ("getlocal_3",), ("callproperty", m_dth, 4), ("coerce", m_coerce_kind),
        ("callpropvoid", m_show, 1),
        lex_emi, n(0), ("setproperty", mode),
        ("label", "DONE"), ("returnvoid",),
    ], 4)

    def frame_of_em(dst):
        return [("getlocal_0",), ("getproperty", m_em), ("getproperty", m_battle),
                ("getproperty", m_frame), ("convert_i",), ("setlocal", dst)]

    def aged(st, frame, skip):
        # 待合计 > 0 且 (当前帧 - 起始帧) >= DMG_WINDOW → 出合计
        return [("getlocal", st), n(1), ("getproperty", rt), n(0), ("ifngt", skip),
                ("getlocal", frame), ("getlocal", st), n(6), ("getproperty", rt), ("subtract",),
                _limit("DMG_WINDOW"), ("iflt", skip),
                ("getlocal_0",), ("getlocal", st), ("callpropvoid", emit, 1),
                ("label", skip)]

    # 闸门（命中当次，在原 effectManager.show 之前）：主战斗、非中毒才参与。按 battle.currentFrame
    # 分帧：换帧就清本目标计数，并把到期的旧合计先出掉（不依赖 update 是否被调用）。本目标本帧已单独
    # 显示 >= DMG_PER_TARGET，或同一 EffectManager 本帧已显示 >= DMG_GLOBAL → 并入合计，
    # 置 wfxDamageMode=1：原 show→addDamageToHostile→addDamageEffect 照走，溢出统计原指令逐条执行，
    # 只在 new DamageEffectImpl 前返回。
    gate = editor.add_method(DIM, "wfxMergeDamage", "void", ["*", "*", "*", "*"], [
        ("getlocal_0",), ("pushscope",),
        ("getlocal_0",), ("getproperty", m_primary), ("iffalse", "DONE"),
        ("getlocal", 4), ("getproperty", m_poison), ("iftrue", "DONE"),
        ("getlocal_0",), ("callproperty", state, 0), ("setlocal", 5),
        *frame_of_em(7),
        ("getlocal", 5), n(7), ("getproperty", rt), ("getlocal", 7), ("ifeq", "SAMEFRAME"),
        ("getlocal", 5), n(7), ("getlocal", 7), ("setproperty", rt),
        ("getlocal", 5), n(0), n(0), ("setproperty", rt),
        ("label", "SAMEFRAME"),
        *aged(5, 7, "FRESH"),
        ("getlocal_0",), ("getproperty", m_em), ("setlocal", 6),
        *_weak_state(editor, lex_dim, gstates, [("getlocal", 6)], [n(-1), n(0)], 8, 9, "G"),
        ("getlocal", 9), n(0), ("getproperty", rt), ("getlocal", 7), ("ifeq", "GSAME"),
        ("getlocal", 9), n(0), ("getlocal", 7), ("setproperty", rt),
        ("getlocal", 9), n(1), n(0), ("setproperty", rt),
        ("label", "GSAME"),
        ("getlocal", 5), n(0), ("getproperty", rt), _limit("DMG_PER_TARGET"), ("ifge", "MERGE"),
        ("getlocal", 9), n(1), ("getproperty", rt), _limit("DMG_GLOBAL"), ("ifge", "MERGE"),
        ("getlocal", 5), n(0), ("getlocal", 5), n(0), ("getproperty", rt), ("convert_i",),
        n(1), ("add_i",), ("setproperty", rt),
        ("getlocal", 9), n(1), ("getlocal", 9), n(1), ("getproperty", rt), ("convert_i",),
        n(1), ("add_i",), ("setproperty", rt),
        ("returnvoid",),
        ("label", "MERGE"),
        ("getlocal", 5), n(1), ("getproperty", rt), n(0), ("ifgt", "HASPENDING"),
        ("getlocal", 5), n(6), ("getlocal", 7), ("setproperty", rt),
        ("label", "HASPENDING"),
        ("getlocal", 5), n(1), ("getlocal", 5), n(1), ("getproperty", rt), ("convert_d",),
        ("getlex", m_dec100), ("getlocal", 4), ("getproperty", m_damage), ("convert_d",),
        ("callproperty", m_dfloor, 1), ("convert_d",), ("add",), ("setproperty", rt),
        ("getlocal", 5), n(2), ("getlocal", 4), ("setproperty", rt),
        ("getlocal", 5), n(3), ("getlocal_1",), ("setproperty", rt),
        ("getlocal", 5), n(4), ("getlocal_2",), ("setproperty", rt),
        ("getlocal", 5), n(5), ("getlocal_3",), ("setproperty", rt),
        lex_emi, n(1), ("setproperty", mode),
        ("label", "DONE"), ("returnvoid",),
    ], 10)

    # 冲刷（每次 DamageIndicatorManager.update 开头）：只出到期的旧合计，不建状态。
    flush = editor.add_method(DIM, "wfxFlushDamage", "void", [], [
        ("getlocal_0",), ("pushscope",),
        lex_dim, ("getproperty", states), ("setlocal_1",),
        ("getlocal_1",), ("iffalse", "DONE"),
        ("getlocal_1",), ("getlocal_0",), ("callproperty", q("get"), 1), ("setlocal_2",),
        ("getlocal_2",), ("iffalse", "DONE"),
        *frame_of_em(3),
        *aged(2, 3, "DONE"),
        ("returnvoid",),
    ], 4)

    editor.insert(DIM_SHOW, 2, [
        ("getlocal_0",), ("getlocal_1",), ("getlocal_2",), ("getlocal_3",), ("getlocal", 4),
        ("callpropvoid", gate, 4)])
    editor.insert(DIM_SHOW, 12, [lex_emi, n(0), ("setproperty", mode)])
    editor.insert(DIM_UPDATE, 2, [("getlocal_0",), ("callpropvoid", flush, 0)])

    # addDamageEffect：入口一次性取走模式（取后立即清 0）。模式 2 = 不计溢出直接建数字；
    # 原 #18（溢出判断两条路的汇合点，ENTER）前：模式 1 = 已计溢出、不建数字。
    create = [(x.name, *x.args) for x in add[18:35]]
    if any(x.target is not None or x.cases is not None for x in add[18:35]):
        raise asm.AsmError("复制段含分支")
    editor.insert(EMI_ADD, 2, [
        lex_emi, ("getproperty", mode), ("convert_i",), ("setlocal", 7),
        lex_emi, n(0), ("setproperty", mode),
        ("getlocal", 7), n(2), ("ifne", "OLD"),
        *create, ("returnvoid",),
        ("label", "OLD")])
    editor.insert(EMI_ADD, 18, [
        ("getlocal", 7), n(1), ("ifne", "OLD"), ("returnvoid",), ("label", "OLD")],
        incoming=asm.ENTER)
    return {"group": "merge", "targets": [DIM_SHOW, DIM_UPDATE, EMI_ADD],
            "limits": {k: LIMITS[k] for k in ("DMG_PER_TARGET", "DMG_GLOBAL", "DMG_WINDOW")},
            "helpers": ["DamageIndicatorManager/wfxMergeState", "DamageIndicatorManager/wfxEmitPending",
                        "DamageIndicatorManager/wfxMergeDamage", "DamageIndicatorManager/wfxFlushDamage"],
            "slots": ["EffectManagerImpl$wfxDamageMode", "DamageIndicatorManager$wfxMergeStates",
                      "DamageIndicatorManager$wfxGlobalStates"]}


# ---------------------------------------------------------------------------
HIT_CASE = 1866


def build_hitbudget(editor):
    """组 B：命中特效（SimpleEffectKind 63）创建前的全场每逻辑帧预算。"""
    q = editor.q
    ins = _ins(editor, EMI_SHOW)
    outer = ins[42]
    if outer.name != "lookupswitch" or len(outer.cases) <= 63 or outer.cases[63] != HIT_CASE:
        raise asm.AsmError("EffectManagerImpl.show 内层 switch case 63 落点不是 #1866")
    _check_shape(ins, {1866: "getlocal_2", 1892: "iffalse", 1899: "callproperty",
                       1910: "constructprop", 1921: "callproperty", 1940: "constructprop",
                       1942: "jump", 2983: "returnvoid"})
    # case 63 的所有出口都是 break → #2779 → … → returnvoid，块内 returnvoid 与之等价。
    exit_ = ins[1942].target
    while ins[exit_].name == "jump":
        exit_ = ins[exit_].target
    if ins[exit_].name != "returnvoid":
        raise asm.AsmError("case 63 break 出口不是 returnvoid")
    m_params = ins[1867].args[0]
    rt = ins[1890].args[0]
    m_rot = ins[1899].args[0]
    if editor.abc.mn_name(m_rot).split("::")[-1] != "getRandomRotation":
        raise asm.AsmError("#1899 不是 getRandomRotation")
    m_battle = _mn(editor, "EffectManagerImpl/supressHitEffect", "battle")
    m_frame = _mn(editor, "EffectManagerImpl/supressHitEffect", "currentFrame")
    hstates = editor.add_slot(EMI, "wfxHitStates", "*", static=True)
    n = editor.number
    # 每个 EffectManager 一份 [帧, 本帧已建条数]（弱键 WeakMap，不强引用战斗对象）。
    allow = editor.add_method(EMI, "wfxHitAllow", "Boolean", [], [
        ("getlocal_0",), ("pushscope",),
        ("getlocal_0",), ("getproperty", m_battle), ("getproperty", m_frame), ("convert_i",),
        ("setlocal_1",),
        *_weak_state(editor, ("getlex", q(EMI)), hstates, [("getlocal_0",)], [n(-1), n(0)], 2, 3, "H"),
        ("getlocal_3",), n(0), ("getproperty", rt), ("getlocal_1",), ("ifeq", "CHECK"),
        ("getlocal_3",), n(0), ("getlocal_1",), ("setproperty", rt),
        ("getlocal_3",), n(1), n(0), ("setproperty", rt),
        ("label", "CHECK"),
        ("getlocal_3",), n(1), ("getproperty", rt), _limit("HIT_PER_FRAME"), ("iflt", "OK"),
        ("pushfalse",), ("returnvalue",),
        ("label", "OK"),
        ("getlocal_3",), n(1), ("getlocal_3",), n(1), ("getproperty", rt), ("convert_i",),
        n(1), ("add_i",), ("setproperty", rt),
        ("pushtrue",), ("returnvalue",),
    ], 4)
    # 超预算：不建 SimpleEffect；随机旋转分支照样调一次 getRandomRotation（表现随机数调用次数不变）。
    editor.insert(EMI_SHOW, HIT_CASE, [
        ("getlocal_0",), ("callproperty", allow, 0), ("iftrue", "OLD"),
        ("getlocal_2",), ("getproperty", m_params), editor.number(1), ("getproperty", rt),
        ("convert_b",), ("iffalse", "OUT"),
        ("getlocal_0",), ("callproperty", m_rot, 0), ("pop",),
        ("label", "OUT"), ("returnvoid",),
        ("label", "OLD")], incoming=asm.ENTER)
    return {"group": "hitbudget", "targets": [EMI_SHOW],
            "limits": {"HIT_PER_FRAME": LIMITS["HIT_PER_FRAME"]},
            "helpers": ["EffectManagerImpl/wfxHitAllow"],
            "slots": ["EffectManagerImpl$wfxHitStates"]}


# ---------------------------------------------------------------------------
OTHER_ACCUM_CASE = 2959


def build_otheraccum(editor):
    """组 C：非本机 owner（队友镜像战斗）的 BattleView.show 不建 AccumulationDamageIndicatorView。"""
    q = editor.q
    ins = _ins(editor, BV_SHOW)
    sw = ins[2795]
    if sw.name != "lookupswitch" or len(sw.cases) <= 47 or sw.cases[47] != OTHER_ACCUM_CASE:
        raise asm.AsmError("BattleView.show 他人分支 case 47 落点不是 #2959")
    mine = ins[47]
    if mine.name != "lookupswitch" or mine.cases[47] == OTHER_ACCUM_CASE:
        raise asm.AsmError("本机分支形状不符")
    _check_shape(ins, {2959: "findproperty", 2968: "constructprop", 2969: "callpropvoid",
                       2970: "jump", 4467: "getlocal", 4468: "returnvalue"})
    if "AccumulationDamageIndicatorView" not in editor.abc.mn_name(ins[2968].args[0]):
        raise asm.AsmError("#2968 不是 AccumulationDamageIndicatorView")
    if ins[2970].target != 4467 or ins[4467].args != [5]:
        raise asm.AsmError("case 47 break 出口不是 return _loc5_")
    keep = editor.add_slot(BV, "wfxKeepOtherAccumView", "*", static=True)
    editor.insert(BV_SHOW, OTHER_ACCUM_CASE, [
        ("getlex", q(BV)), ("getproperty", keep), ("iftrue", "OLD"),
        ("getlocal", 5), ("returnvalue",),
        ("label", "OLD")], incoming=asm.ENTER)
    return {"group": "otheraccum", "targets": [BV_SHOW], "helpers": [],
            "slots": ["BattleView$wfxKeepOtherAccumView"]}


BUILDERS = {"merge": build_merge, "hitbudget": build_hitbudget, "otheraccum": build_otheraccum}
TARGETS = {"merge": [DIM_SHOW, DIM_UPDATE, EMI_ADD], "hitbudget": [EMI_SHOW], "otheraccum": [BV_SHOW]}


def build(editor, groups=GROUPS):
    return [BUILDERS[g](editor) for g in GROUPS if g in groups]
