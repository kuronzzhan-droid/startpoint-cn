"""只为五条校园希尔媞动作追加能力伤害来源标记，不改变 ActionKind。"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "client-patch/abcasm"))
import asm
import bodies
from swfabc import PoolEditor, SwfAbc

CAPABILITY = "celtie-ability-actions-v1"
METHOD = "ActionEvaluator/evalCommand"
CODE_SHA = "105f258ab3649922848391d6515c42df4a91d9f64e8ea3849884071a9255ecbc"
HEADER = [109, 190, 1, 2]
INSERT_AT = 2257
ACTION_PATHS = tuple(
    f"battle/action/skill/action/rare5/wind_spgirl_campus$wind_spgirl_campus_{i}"
    for i in (1, 2)
) + tuple(
    f"battle/action/skill/action/power_flip/campus_celtie_fever/campus_celtie_fever_lv{i}"
    for i in (1, 2, 3)
)
QNAME_IDS = {
    "get_action": 18810, "get_zone": 43331, "asset": 6899,
    "_getActionDsl": 8582, "originMemberKind": 37162,
    "NormalAttackReferenceParameter": 37202, "AttackParameter": 37276,
    "multiplierOfAttackPoint": 37203, "createdByAbility": 37153,
    "createdByUnisonAbility": 37154, "createdByMainSkillAction": 37151,
    "createdByUnisonSkillAction": 37152, "createdByPowerFlipAction": 37150,
    "createdBySkillInvoker": 37223, "buffTargetAs": 37217,
    "reference": 16564, "powerFlipChargeLv": 37219, "NormalAttack": 42393,
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def qnames(abc):
    """按 public QName 的完整命名空间和名称唯一定位，另锁原索引。"""
    result = {}
    for name, expected in QNAME_IDS.items():
        namespace = (b"pinball.online.battle.impact.attack"
                     if name == "NormalAttackReferenceParameter" else b"")
        found = []
        for index, entry in enumerate(abc.multinames):
            if not entry or entry[0] != 7 or abc.strings[entry[2]] != name.encode():
                continue
            kind, text = abc.namespaces[entry[1]]
            if kind == 0x16 and abc.strings[text] == namespace:
                found.append(index)
        if found != [expected]:
            raise asm.AsmError(f"public QName differs or is ambiguous: {name}: {found}")
        result[name] = found[0]
    return result


def validate_baseline(abc):
    index = bodies.resolve(abc, METHOD)
    body = abc.bodies[index]
    if sha(body[5]) != CODE_SHA or body[1:5] != HEADER or body[6] or body[7]:
        raise asm.AsmError("evalCommand differs from reviewed native baseline")
    refs = qnames(abc)
    ins = asm.decode(body[5])
    if (len(ins) != 11602 or ins[INSERT_AT - 1].name != "newobject"
            or ins[INSERT_AT - 1].args != [49]
            or ins[INSERT_AT].name != "callproperty"
            or ins[INSERT_AT].args != [refs["NormalAttack"], 1]):
        raise asm.AsmError("CreateNormalAttack object boundary differs")
    return index, refs


def block(pool, refs):
    """入口/出口均保留栈顶动态对象和其下所有值，不使用新 local。"""
    code = [("getlocal_0",), ("callproperty", refs["get_action"], 0),
            ("iffalse", "END")]
    # Null current action must never match five missing cache entries (null).
    for path in ACTION_PATHS:
        code += [("getlocal_0",), ("callproperty", refs["get_action"], 0),
                 ("getlocal_0",), ("callproperty", refs["get_zone"], 0),
                 ("getproperty", refs["asset"]), ("pushstring", pool.string(path)),
                 ("callproperty", refs["_getActionDsl"], 1),
                 ("ifstricteq", "MATCH")]
    code += [("jump", "END"), ("label", "MATCH")]
    for name, value in (("createdByAbility", True),
                        ("createdByMainSkillAction", False),
                        ("createdByUnisonSkillAction", False),
                        ("createdByPowerFlipAction", False),
                        ("createdBySkillInvoker", False)):
        code += [("dup",), ("pushtrue" if value else "pushfalse",),
                 ("setproperty", refs[name])]
    code += [("dup",), ("dup",), ("getproperty", refs["originMemberKind"]),
             ("pushbyte", 1), ("strictequals",),
             ("setproperty", refs["createdByUnisonAbility"])]
    for name in ("buffTargetAs", "powerFlipChargeLv"):
        code += [("dup",), ("pushbyte", 0), ("setproperty", refs[name])]
    # object, object-for-set, multiplier, class -> swap -> class(multiplier).
    code += [("dup",), ("dup",), ("getproperty", refs["multiplierOfAttackPoint"]),
             ("getlex", refs["NormalAttackReferenceParameter"]), ("swap",),
             ("callproperty", refs["AttackParameter"], 1),
             ("setproperty", refs["reference"]), ("label", "END")]
    return asm.assemble(code)


def verify_structure(old_raw, new_raw, index, count):
    """独立 myabc 读取器复核；其代码不依赖 abcasm/abcfmt。"""
    path = REPO / "client-patch/rank-scene-p2/independent/myabc.py"
    spec = importlib.util.spec_from_file_location("celtie_independent_abc", path)
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    old, new = reader.parse_abc(old_raw), reader.parse_abc(new_raw)
    for key in ("minor", "major", "methods", "metadata", "instances", "classes", "scripts"):
        if old[key] != new[key]:
            raise asm.AsmError("unrelated ABC structure changed: " + key)
    for key, values in old["pools"].items():
        after = new["pools"][key]
        if values != after[:len(values)] or (key != "strs" and values != after):
            raise asm.AsmError("constant pool prefix changed: " + key)
    if len(old["bodies"]) != len(new["bodies"]):
        raise asm.AsmError("method body count changed")
    changed = [i for i, (a, b) in enumerate(zip(old["bodies"], new["bodies"])) if a != b]
    if changed != [index]:
        raise asm.AsmError(f"unexpected changed methods: {changed}")
    a, b = old["bodies"][index], new["bodies"][index]
    if {k: v for k, v in a.items() if k != "code"} != {k: v for k, v in b.items() if k != "code"}:
        raise asm.AsmError("target method header/traits/exceptions changed")
    if asm.unsplice(b["code"], INSERT_AT, count) != a["code"]:
        raise asm.AsmError("native instructions are not byte-exact recoverable")
    return len(old["bodies"]) - 1


def patch_swf(swf):
    index, refs = validate_baseline(swf.abc)
    body = swf.abc.bodies[index]
    original_code = body[5]
    pool = PoolEditor(swf.abc)
    insertion = block(pool, refs)
    code, exceptions, ins = asm.splice(body, INSERT_AT, insertion, incoming=asm.ENTER)
    if asm.unsplice(code, INSERT_AT, len(insertion)) != original_code:
        raise asm.AsmError("native bytecode changed outside insertion")
    analysis = [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]
    metrics = asm.simulate(analysis, body[3], swf.abc.multinames)
    if metrics[0] > body[1] or metrics[1] != body[4]:
        raise asm.AsmError(f"unexpected stack/scope requirements: {metrics}")
    body[5], body[6] = code, exceptions
    unchanged = verify_structure(swf._raw, swf.abc.serialize(), index, len(insertion))
    return {"status": "fixture_static_verified_runtime_pending", "capability": CAPABILITY,
            "method": METHOD, "body_index": index, "before_code_sha256": CODE_SHA,
            "after_code_sha256": sha(code), "insert_at": INSERT_AT,
            "insert_count": len(insertion), "incoming": "enter", "metrics": metrics,
            "header": body[1:5], "qnames": refs, "action_paths": ACTION_PATHS,
            "unchanged_method_bodies": unchanged, "pool": pool.report(),
            "independent_abc_verified": True, "device_apk_store_writes": False}


def apply(source, output, report):
    source, output, report = map(Path, (source, output, report))
    if (len({p.resolve() for p in (source, output, report)}) != 3
            or output.exists() or report.exists()):
        raise asm.AsmError("input stays immutable; output and report must be distinct new paths")
    data = source.read_bytes()
    swf = SwfAbc(source)
    result = patch_swf(swf)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as stream:
        stream.write(swf.serialize())
    after = SwfAbc(output)
    if (swf.body[:swf._offset] != after.body[:after._offset]
            or swf.body[swf._offset + swf._length:] != after.body[after._offset + after._length:]
            or swf._prefix != after._prefix or source.read_bytes() != data):
        raise asm.AsmError("input or non-ABC SWF content changed")
    result.update(source=str(source), source_sha256=sha(data), output=str(output),
                  output_sha256=sha(output.read_bytes()), non_abc_tags_preserved=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    with report.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(apply(args.source, args.output, args.report), ensure_ascii=False, indent=2))
