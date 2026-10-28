"""第十四轮补丁构建（可重放、可分组开关、幂等）。

用法（在 run14 目录，PowerShell 先 $env:PYTHONIOENCODING='utf-8'）：
  python -B build.py                                   # 测试服 v35m.swf → v35n.swf（三组全开）
  python -B build.py --input ..\\run13\\v35m-local-wf.swf  # 本地服 → v35n-local-wf.swf
  python -B build.py --input X.swf --output Y.swf --allow-other-base   # 联机线合并用：任何
        含相同 5 个被锁方法（SHA+header）的 SWF 都可，例如联机线自己的 v35n 候选
  python -B build.py --patches merge,otheraccum ...     # 只打其中几组（输出到 work/ 下，非发布）
输入整包 SHA 不认识且未加 --allow-other-base → 停；任一被锁方法 SHA/header 不符 → 停；
已打过（5 个方法都等于发布后锁）→ 原样复制并报 already_present；已有不同内容的输出 → 拒绝覆盖。
"""
import argparse
import difflib
import json
from pathlib import Path

import bootstrap
from bootstrap import ROOT, INPUTS, sha
import bodies
from common import listing
from framework import Editor
from static_check import check_body
from swfabc import SwfAbc
import perf_patch

ALL = perf_patch.GROUPS


def json_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def locks():
    return json.loads((ROOT / "baseline-locks.json").read_text(encoding="utf-8"))


def release_locks():
    path = ROOT / "release-locks.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def construct(path, groups):
    editor = Editor(path, locks())
    targets = [t for g in groups for t in perf_patch.TARGETS[g]]
    for label in targets:
        lock = editor.locks[label]
        body = editor.body(label)
        if sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
            raise ValueError("输入方法 SHA/header 与 v35m 基线不符（可能已打过别的补丁）: " + label)
    for cls, name in ((perf_patch.EMI, "wfxDamageMode"), (perf_patch.EMI, "wfxHitAllow"),
                      (perf_patch.DIM, "wfxMergeDamage"), (perf_patch.BV, "wfxKeepOtherAccumView")):
        index, row = editor.instance(cls)
        names = [editor.abc.mn_name(t.name) for t in row[6] + editor.abc.classes[index][1]]
        if any(x.split("::")[-1] == name for x in names):
            raise ValueError(f"输入已含本轮名字 {cls}.{name}，但方法锁不符，拒绝叠打")
    report = perf_patch.build(editor, groups)
    editor.apply()
    raw = editor.swf.serialize()
    return raw, editor, report


def method_record(editor):
    labels = list(editor.report) + [row["label"] for row in editor.new_methods]
    return {label: {"sha256": sha(editor.body(label)[5]), "header": editor.body(label)[1:5]}
            for label in sorted(labels)}


def write_pcode(editor, outdir):
    manifest = []
    for label in list(editor.report) + [row["label"] for row in editor.new_methods]:
        index = bodies.resolve(editor.abc, label)
        after = editor.abc.bodies[index]
        before = editor.original_bodies[index] if index < editor.original_count else None
        name = label.replace("/", "__").replace("$", "_static")
        right = [f"# {label} header={after[1:5]} sha={sha(after[5])}", *listing(editor.abc, after[5])]
        left = [] if before is None else [f"# {label} header={before[1:5]} sha={sha(before[5])}",
                                          *listing(editor.abc, before[5])]
        if before is None:
            diff = ["# 新增方法（无 before）", *right[1:]]
        else:
            diff = [f"# {label}: 只插入，不删改原指令；逆拼接后与原方法体逐字节相同",
                    f"# before header={before[1:5]} sha={sha(before[5])}",
                    f"# after  header={after[1:5]} sha={sha(after[5])}"]
            for at, count, policy in editor.report[label].get("insertions", []):
                diff.append(f"@@ 插入于新下标 #{at}，{count} 条，原分支入边策略={policy} @@")
                for line in right[1 + max(0, at - 3):1 + at]:
                    diff.append("  " + line)
                for line in right[1 + at:1 + at + count]:
                    diff.append("+ " + line)
                for line in right[1 + at + count:1 + at + count + 3]:
                    diff.append("  " + line)
        for suffix, lines in (("after.pcode.txt", right), ("before.pcode.txt", left), ("diff.txt", diff)):
            (outdir / f"{name}.{suffix}").write_text("\n".join(lines) + "\n", encoding="utf-8")
        manifest.append({"label": label, "body": index,
                         "before_sha256": None if before is None else sha(before[5]),
                         "after_sha256": sha(after[5]), "header": after[1:5],
                         "path_prefix": f"pcode/{name}"})
    json_write(outdir / "manifest.json", manifest)


def normalized(abc, code):
    from common import describe
    import asm
    return [describe(abc, x) for x in asm.decode(code)]


def already_patched(path):
    """5 个被锁方法 + 4 个助手都等于发布版（同底包按 SHA，其它底包按解析名字后的指令序列）→ 已打。"""
    swf = SwfAbc(path)
    release = release_locks()
    ref = None
    for profile, record in release.items():
        ok = True
        for label, lock in record["methods"].items():
            try:
                body = swf.abc.bodies[bodies.resolve(swf.abc, label)]
            except Exception:
                return None
            if sha(body[5]) != lock["sha256"] or body[1:5] != lock["header"]:
                ok = False
                break
        if ok:
            return profile
    ref = SwfAbc(ROOT / INPUTS["test"][2]).abc
    for label in release["test"]["methods"]:
        mine, theirs = swf.abc.bodies[bodies.resolve(swf.abc, label)], ref.bodies[bodies.resolve(ref, label)]
        if normalized(swf.abc, mine[5]) != normalized(ref, theirs[5]) or mine[1:5] != theirs[1:5]:
            return None
        check_body(swf.abc, mine)
    return "other-normalized"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--patches", default=",".join(ALL))
    parser.add_argument("--allow-other-base", action="store_true")
    parser.add_argument("--prepare-locks", action="store_true")
    parser.add_argument("--limits", default="", help="调参/诊断用，如 HIT_PER_FRAME=3,DMG_WINDOW=2；产物只进 work/，不入发布锁")
    args = parser.parse_args()
    custom = {}
    for item in filter(None, (x.strip() for x in args.limits.split(","))):
        key, value = item.split("=")
        if key not in perf_patch.LIMITS:
            raise ValueError("未知上限名: " + key)
        custom[key] = int(value)
    perf_patch.LIMITS.update(custom)
    groups = tuple(g for g in ALL if g in {x.strip() for x in args.patches.split(",") if x.strip()})
    unknown = {x.strip() for x in args.patches.split(",") if x.strip()} - set(ALL)
    if unknown or not groups:
        raise ValueError(f"--patches 只能取 {ALL} 的子集: {args.patches}")
    full = groups == ALL
    release_build = full and not custom
    bootstrap.check_baseline()
    source = (args.input or INPUTS["test"][0]).resolve()
    data = source.read_bytes()
    digest = sha(data)
    profiles = [k for k, v in INPUTS.items() if v[1] == digest]
    profile = profiles[0] if profiles else "other"
    if profile == "other":
        done = already_patched(source) if release_build else None
        if done:
            raw = data
            status = "already_present"
        elif not args.allow_other_base:
            raise ValueError("未知输入整包 SHA；联机线合并请加 --allow-other-base（仍按方法锁校验）")
        else:
            status = "built"
    else:
        status = "built"
    if args.output:
        destination = args.output.resolve()
    elif profile != "other" and release_build:
        destination = ROOT / INPUTS[profile][2]
    else:
        tag = "-".join(groups) + "".join(f"-{k}{v}" for k, v in sorted(custom.items()))
        destination = ROOT / "work" / f"{source.stem}-{tag}.swf"
    for value in INPUTS.values():
        if destination.exists() and destination.samefile(value[0]):
            raise ValueError("拒绝覆盖固定输入")
    if destination == source:
        raise ValueError("拒绝原地覆盖输入")
    report = {"input": str(source), "input_sha256": digest, "profile": profile,
              "patches": list(groups), "limits": perf_patch.LIMITS}
    if status == "built":
        raw, editor, groups_report = construct(source, groups)
        record = method_record(editor)
        report.update(groups=groups_report, changed=editor.report, added=editor.new_methods,
                      traits=editor.traits, pool=editor.pool.report(), methods=record)
        if profile != "other" and release_build:
            release = release_locks()
            entry = {"sha256": sha(raw), "methods": record}
            if args.prepare_locks:
                release[profile] = entry
                json_write(ROOT / "release-locks.json", release)
            elif release.get(profile) != entry:
                raise ValueError("最终整包/方法锁与 release-locks.json 不符")
            outdir = ROOT / "pcode"
            outdir.mkdir(exist_ok=True)
            write_pcode(editor, outdir)
            json_write(ROOT / f"build-{profile}.json", {**report, "output_sha256": sha(raw)})
        elif release_build:
            # 其它底包：常量池下标会随底包不同而变，故按「解析名字后的指令序列 + header」
            # 与发布版 v35n.swf 逐条比较（证明是同一份补丁）。
            ref = SwfAbc(ROOT / INPUTS["test"][2]).abc
            for label in record:
                mine, theirs = editor.body(label), ref.bodies[bodies.resolve(ref, label)]
                if normalized(editor.abc, mine[5]) != normalized(ref, theirs[5]) or mine[1:5] != theirs[1:5]:
                    raise ValueError("其它底包打出的方法与发布版指令序列不一致: " + label)
            report["normalized_equal_to_release"] = sorted(record)
    if destination.exists() and destination.read_bytes() != raw and not args.prepare_locks:
        raise ValueError("输出已存在且内容不同，拒绝覆盖: " + str(destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(raw)
    destination.with_suffix(destination.suffix + ".sha256").write_text(
        sha(raw) + "  " + destination.name + "\n", encoding="ascii")
    print(json.dumps({"status": status, "profile": profile, "patches": list(groups),
                      "output": str(destination), "sha256": sha(raw)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
