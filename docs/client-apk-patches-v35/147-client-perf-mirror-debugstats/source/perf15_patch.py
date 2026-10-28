"""第十五轮：镜像战斗（非本机 owner，Battle.primary == false）跳过两处纯统计计算。

A mirrordebug     ElapsedTimeCalculatorImpl.advanceTime 末尾对 DebugTimeCalculatorImpl.advanceTime 的调用
                  （每帧每成员的调试统计：buff/HP/技能槽直方图、getPlayStatistics 大对象），镜像且非 Raid 战斗跳过。
B mirrorreduction 【已放弃，不发布】NormalAttackCalculator._calculate 里只为「减伤统计」再跑一遍的 _calculate(..., true,
                  randomForReductionDamage)，镜像战斗且非 Raid 时跳过（reductionDamage 保持 0）。
                  开关是 Battle 上的静态槽 wfxSkipReduction：Battle.proceed 入口按 (!primary && !isRaid) 置位，
                  出口清 0；_calculate 读它。计算都发生在各自 Battle.proceed 内，出了 proceed 一律是原行为。

只插入指令、已有类追加静态槽、常量池尾部追加名字；本机战斗（primary）行为与 run14 逐字节等价的路径。
审计证据（字段写入清单与读者）见 README 与 D:\\WF\\outputs\\work\\client-perf-20261021\\run15-audit。
"""
import asm

BATTLE = "pinball.scene.battle.battle::Battle"
ETC_ADV = "ElapsedTimeCalculatorImpl/advanceTime"
NAC_CALC = "NormalAttackCalculator/_calculate"
BATTLE_PROCEED = "Battle/proceed"

# B（mirrorreduction）经核实会改变跨 Battle 的 Impact 结果字段 reductionDamage（虽无判定读者）、专用 RNG 游标，
# 且新增静态槽在异常出口不复位，按联机线「Impact 携带字段也不得改变」的规则放弃，不在发布组内（代码留档）。
GROUPS = ("mirrordebug",)
TARGETS = {"mirrordebug": [ETC_ADV]}
MARKERS = []
LIMITS = {}
CAPABILITY = "client-perf-mirror-debugstats-v1"


def _ins(editor, label):
    return asm.decode(editor.body(label)[5])


def _named(editor, x, name):
    return bool(x.args) and editor.abc.mn_name(x.args[0]).split("::")[-1] == name


def build_mirrordebug(editor):
    ins = _ins(editor, ETC_ADV)
    at = 125
    want = [("findproperty", "xDebugTimeCalculatorImpl"), ("getproperty", "xDebugTimeCalculatorImpl"),
            ("findproperty", "rawFrame"), ("getproperty", "rawFrame"), ("callpropvoid", "advanceTime"),
            ("returnvoid", None)]
    for k, (op, name) in enumerate(want):
        x = ins[at + k]
        if x.name != op or (name and not _named(editor, x, name)):
            raise asm.AsmError(f"advanceTime 形状不符 #{at + k}: {x.name}")
    if len(ins) != at + len(want):
        raise asm.AsmError("advanceTime 末尾不是调试统计调用")
    m_battle = ins[[i for i, x in enumerate(ins) if x.name == "getproperty" and _named(editor, x, "battle")][0]].args[0]
    m_find_battle = ins[[i for i, x in enumerate(ins) if x.name == "findproperty" and _named(editor, x, "battle")][0]].args[0]
    m_primary = editor.q("primary")
    m_raid = editor.q("isRaid")
    battle = [("findproperty", m_find_battle), ("getproperty", m_battle)]
    # 原 #108 的 iffalse 落在 #125：ENTER，两条路都先经过门控。
    # 只在 !primary && !isRaid 时跳过：Raid 会经 getOtherStatistics 上报其他战斗的统计（含调试统计 getter
    # 深层顺带刷新的成员 max 统计），故 Raid 保持原行为。
    editor.insert(ETC_ADV, at, [
        *battle, ("getproperty", m_primary), ("iftrue", "OLD"),
        *battle, ("getproperty", m_raid), ("iftrue", "OLD"),
        ("returnvoid",), ("label", "OLD")], incoming=asm.ENTER)
    return {"group": "mirrordebug", "targets": [ETC_ADV], "helpers": [], "slots": []}


def build_mirrorreduction(editor):
    q = editor.q
    ins = _ins(editor, NAC_CALC)
    calls = [i for i, x in enumerate(ins) if x.name == "callproperty" and _named(editor, x, "_calculate")]
    if len(calls) != 1:
        raise asm.AsmError("_calculate 内递归调用不唯一")
    c = calls[0]
    gate = c - 10                       # getlocal 5; not; iffalse → 跳过块
    if not (ins[gate - 2].name == "getlocal" and ins[gate - 2].args == [5] and ins[gate - 1].name == "not"
            and ins[gate].name == "iffalse" and ins[gate + 1].name == "findproperty"
            and _named(editor, ins[gate + 1], "_calculate")):
        raise asm.AsmError("减伤第二遍门形状不符")
    if not (ins[c - 2].name == "findproperty" and _named(editor, ins[c - 2], "randomForReductionDamage")
            and ins[c - 3].name == "pushtrue"):
        raise asm.AsmError("第二遍参数不是 (…, true, randomForReductionDamage)")
    skip_to = ins[gate].target
    if not (ins[skip_to].name == "getlocal" and ins[skip_to].args == [5]):
        raise asm.AsmError("跳过落点不是 if(param5) 复位块")
    flag = editor.add_slot(BATTLE, "wfxSkipReduction", "*", static=True)
    lex = ("getlex", q(BATTLE))
    # 栈上已有 !param5（Boolean）；与 !flag 按位与：只有 !param5 && !flag 才进第二遍。
    editor.insert(NAC_CALC, gate, [lex, ("getproperty", flag), ("convert_b",), ("not",), ("bitand",)])

    bins = _ins(editor, BATTLE_PROCEED)
    if bins[-1].name != "returnvalue" or sum(1 for x in bins if x.name in ("returnvalue", "returnvoid")) != 1:
        raise asm.AsmError("Battle.proceed 出口不唯一")
    m_primary = q("primary")
    m_raid = q("isRaid")
    editor.insert(BATTLE_PROCEED, 2, [
        lex, ("getlocal_0",), ("getproperty", m_primary), ("not",),
        ("getlocal_0",), ("getproperty", m_raid), ("not",), ("bitand",), ("convert_b",),
        ("setproperty", flag)])
    editor.insert(BATTLE_PROCEED, len(bins) - 1, [lex, ("pushfalse",), ("setproperty", flag)],
                  incoming=asm.ENTER)
    return {"group": "mirrorreduction", "targets": [NAC_CALC, BATTLE_PROCEED], "helpers": [],
            "slots": ["Battle$wfxSkipReduction"]}


BUILDERS = {"mirrordebug": build_mirrordebug}   # build_mirrorreduction 已放弃，见文件头


def build(editor, groups=GROUPS):
    return [BUILDERS[g](editor) for g in GROUPS if g in groups]
