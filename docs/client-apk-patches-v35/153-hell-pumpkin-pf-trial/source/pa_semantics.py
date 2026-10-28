"""离线执行真实 matchTrial 指令；对象模型与需求 oracle 独立于补丁。"""
from __future__ import annotations

import copy
import itertools
import sys
from dataclasses import dataclass, replace
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
import avm_mini
from common import asm


class SemanticMismatch(AssertionError):
    """仅真实执行结果与需求不符时抛出，不能用解释器错误代替变异检出。"""


@dataclass
class EnumValue:
    tag: str
    index: int
    params: list

    def as3_string(self):
        return self.tag + "(" + ",".join(avm_mini.to_str(x) for x in self.params) + ")"


@dataclass
class Source:
    id: EnumValue


@dataclass
class Owner:
    source: Source
    invincible: bool


@dataclass
class Values:
    kind: EnumValue


@dataclass
class Check:
    currentValues: Values | None
    isGaugeAppeared: bool
    owner: Owner
    count: int


OWNERS = (
    ("Funnel", "mod_hp_pumpkin_p1"),
    ("Boss", "mod_hp_jack"),
    ("Funnel", "funnel_halloween_jack_rush"),
    ("Boss", "xmod_hp_a"),
    ("Zako", "mod_hp_z"),
)


@dataclass(frozen=True)
class Case:
    group: str
    kind: int
    p1: bool
    p2: bool
    p3: bool
    owner_tag: str
    code: str
    p4: int = 3
    p5: bool = False
    active: bool = True
    gauge: bool = True
    invincible: bool = False
    threshold: int = 3
    count: int = 37

    def describe(self):
        return (
            f"{self.group}:kind={self.kind},p1/p2/p3={self.p1}/{self.p2}/{self.p3},"
            f"owner={self.owner_tag}({self.code}),p4={self.p4},p5={self.p5},"
            f"active={self.active},gauge={self.gauge},phase={self.invincible},"
            f"threshold={self.threshold},count={self.count}"
        )


class TrialEnv(avm_mini.Env):
    """仅模拟已查明的字段和方法；不模拟补丁判定函数，不忽略未知调用。"""

    def __init__(self, abc):
        super().__init__(abc)
        self.trace = []
        self.identifier_reads = 0

    def event(self, action, obj, name):
        short = name.split("::")[-1]
        self.trace.append((action, type(obj).__name__, name))
        return short

    def findprop(self, name, this):
        short = self.event("findprop", this, name)
        if isinstance(this, Check) and short in {
            "isActive", "isGaugeAppeared", "owner", "currentValues", "count"
        }:
            return this
        raise AssertionError(f"未实现 findprop：{name}")

    def get(self, obj, name):
        short = self.event("get", obj, name)
        allowed = {
            Check: {"currentValues", "isGaugeAppeared", "owner", "count"},
            Owner: {"source"},
            Source: {"id"},
            Values: {"kind"},
            EnumValue: {"index", "params", "tag"},
        }
        if short not in allowed.get(type(obj), set()):
            raise AssertionError(f"未实现属性：{type(obj).__name__}.{name}")
        if isinstance(obj, Source) and short == "id":
            self.identifier_reads += 1
        return getattr(obj, short)

    def call(self, obj, name, args):
        short = self.event("call", obj, name)
        if isinstance(obj, Check) and short == "isActive" and not args:
            # ref/HitCountCheck.as：isActive() 直接返回 currentValues != null。
            return obj.currentValues is not None
        if isinstance(obj, Owner) and not args:
            if short == "isInvincibleByPhaseChange":
                return obj.invincible
            if short == "getMasterId":
                self.identifier_reads += 1
                return obj.source.id
        if isinstance(obj, str) and short == "indexOf" and len(args) in (1, 2):
            assert isinstance(args[0], str), "indexOf 搜索值应为字符串"
            start = max(0, avm_mini.to_int(args[1])) if len(args) == 2 else 0
            return obj.find(args[0], start)
        raise AssertionError(f"未实现调用：{type(obj).__name__}.{name}/{len(args)}")

    def coerce(self, name, value):
        short = name.split("::")[-1]
        if short == "Object":
            return value
        if short in {"TrialKind", "EnemyMasterId"}:
            assert value is None or isinstance(value, EnumValue), name
            return value
        raise AssertionError(f"未实现强制类型：{name}")

    def set(self, obj, name, value):
        raise AssertionError(f"未预期写入：{type(obj).__name__}.{name}")


def _make_check(case):
    if case.owner_tag == "Zako":
        master = EnumValue("Zako", 1, [case.code])
    else:
        inner = "GeneralBoss" if case.owner_tag == "Boss" else "Funnel"
        # 此模型只读取内层 params；内层 index 不参与补丁和 oracle。
        master = EnumValue(case.owner_tag, 0 if case.owner_tag == "Boss" else 2,
                           [EnumValue(inner, 0, [case.code])])
    trial = EnumValue(("DirectAttack", "Skill", "PowerFlip", "SkillChain")[case.kind],
                      case.kind, [case.threshold])
    values = Values(trial) if case.active else None
    return Check(values, case.gauge, Owner(Source(master), case.invincible), case.count)


def _gates_pass(case):
    return case.active and (case.p5 or case.gauge) and not case.invincible


def _oracle(case, patched):
    """直接按需求定义，既不解读指令，也不复用 enum/indexOf 判定实现。"""
    if not _gates_pass(case):
        return None
    passes = (
        case.p1 or (patched and case.p3 and case.code.startswith("mod_hp_")),
        case.p2,
        case.p3,
        case.p4 >= case.threshold,
    )[case.kind]
    return case.count if passes else None


def _cases():
    base = [
        Case("规定矩阵", kind, p1, p2, p3, tag, code)
        for kind, p1, p2, p3, (tag, code) in itertools.product(
            range(4), (False, True), (False, True), (False, True), OWNERS
        )
    ]
    yield from base
    for overrides in (
        {"gauge": False},
        {"gauge": False, "p5": True},
        {"invincible": True},
        {"invincible": True, "p5": True},
        {"active": False},
        {"active": False, "p5": True},
        {"gauge": False, "invincible": True, "p5": True},
    ):
        for case in base:
            yield replace(case, group="前置与状态链接", **overrides)
    for case in base:
        if case.kind == 3:
            for p4, p5 in itertools.product((-1, 0, 2, 3, 4, 2147483647), (False, True)):
                yield replace(case, group="连锁阈值", p4=p4, p5=p5)
        for count in (0, -1, 2147483647):
            yield replace(case, group="返回计数边界", count=count)


def _run_one(abc, body, case, patched):
    env = TrialEnv(abc)
    result = avm_mini.run(abc, body, env, _make_check(case),
                         [case.p1, case.p2, case.p3, case.p4, case.p5])
    expected = _oracle(case, patched)
    if result != expected or type(result) is not type(expected):
        raise SemanticMismatch(
            f"{'新' if patched else '原'}方法返回值错误；{case.describe()}；"
            f"实际={result!r}，期望={expected!r}"
        )
    return result, env


def verify_semantics(before_abc, before_body, after_abc, after_body):
    """执行原体、新体；返回值、未授权路径零新增访问及调用均需通过。"""
    groups = {}
    changes = candidate_reads = 0
    for case in _cases():
        old, old_env = _run_one(before_abc, before_body, case, False)
        new, new_env = _run_one(after_abc, after_body, case, True)
        candidate = _gates_pass(case) and case.kind == 0 and not case.p1 and case.p3
        assert old_env.identifier_reads == 0, "原方法不应读取 owner 代号"
        assert new_env.identifier_reads == int(candidate), (
            f"owner 代号读取次数错误：{case.describe()}，{new_env.identifier_reads}"
        )
        if not candidate:
            assert new_env.trace == old_env.trace, (
                f"非候选路径出现新增属性访问/调用：{case.describe()}"
            )
        if old != new:
            assert candidate and case.code.startswith("mod_hp_")
            assert old is None and new == case.count
            changes += 1
        candidate_reads += new_env.identifier_reads
        groups[case.group] = groups.get(case.group, 0) + 1
    assert groups["规定矩阵"] == 160
    total = sum(groups.values())
    return {
        "status": "通过",
        "method": "vendor/avm_mini.py 实际解释原/新方法体",
        "cases": total,
        "bytecode_runs": total * 2,
        "groups": groups,
        "changed_results": changes,
        "owner_identifier_reads": candidate_reads,
        "limits": [
            "离线对象模型，不是真机或完整 AVM2 验证；设备运行未核实。",
            "isActive 按源码由 currentValues 非空决定，空值在前置返回；"
            "同次调用内状态并发改变后抛 No Value 的路径未核实。",
            "只建模本方法涉及的属性、已知方法及 String.indexOf；未知操作立即失败。",
            "内层 enum.index 未参与执行，模型仅用 params 与已确认字符串表示。",
        ],
    }


def run_mutations(before_abc, before_body, after_abc, after_body):
    """仅内存变异：必须由返回值 oracle 检出，再完整重跑未修改基线。"""
    baseline_strings = tuple(after_abc.strings)
    baseline_code = bytes(after_body[5])
    mutants = []
    prefix_indexes = [
        i for i in range(len(before_abc.strings), len(after_abc.strings))
        if after_abc.strings[i] in (b"mod_hp_", b"(mod_hp_")
    ]
    assert len(prefix_indexes) == 1, "必须定位唯一新增前缀字符串"
    prefix_index = prefix_indexes[0]
    mutant_abc = copy.copy(after_abc)
    mutant_abc.strings = list(after_abc.strings)
    mutant_abc.strings[prefix_index] = after_abc.strings[prefix_index].replace(
        b"mod_hp_", b"mod_hpX"
    )
    mutants.append(("前缀 mod_hp_ 改为 mod_hpX", mutant_abc, after_body))

    instructions = asm.decode(after_body[5])
    switches = [ins for ins in instructions if ins.name == "lookupswitch"]
    assert len(switches) == 1 and len(switches[0].cases) == 4
    start, end = switches[0].cases[:2]
    p3_positions = [
        i for i in range(start, end)
        if instructions[i].name == "getlocal_3"
        or (instructions[i].name == "getlocal" and instructions[i].args == [3])
    ]
    assert len(p3_positions) == 1, "必须定位 case 0 唯一新增 param3 读取"
    ins = instructions[p3_positions[0]]
    if ins.name == "getlocal_3":
        ins.op = asm.MNEMONICS["getlocal_2"]
    else:
        ins.args[0] = 2
    mutant_body = list(after_body)
    mutant_body[5] = asm.encode(instructions)[0]
    mutants.append(("case 0 的 getlocal3 改为 getlocal2", after_abc, mutant_body))

    results = []
    for label, abc, body in mutants:
        try:
            verify_semantics(before_abc, before_body, abc, body)
        except SemanticMismatch as exc:
            results.append({"mutation": label, "detected_by": "实际返回值不符",
                            "failure": str(exc)})
        else:
            raise AssertionError(f"变异未被语义 oracle 检出：{label}")
    assert tuple(after_abc.strings) == baseline_strings
    assert bytes(after_body[5]) == baseline_code
    restored = verify_semantics(before_abc, before_body, after_abc, after_body)
    return {"mutations": results, "baseline_after_mutations": restored}
