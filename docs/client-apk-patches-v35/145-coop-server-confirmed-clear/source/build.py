"""第十三轮双输入同源补丁构建；普通重放按输入与最终方法双锁拒绝漂移。"""
import argparse
import difflib
import json
from pathlib import Path

import bootstrap
from bootstrap import ROOT, INPUTS, sha, output_path, checked_output_path
import bodies
from common import listing
from framework import Editor
from static_check import check_body
from swfabc import SwfAbc


def json_write(path, value):
    output_path(path).write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def locked_sources():
    selected = {p for p in ROOT.rglob("*.py")
                if not any(part in ("apk-patches-additions", "work") for part in p.parts)}
    selected.update(ROOT / rel for rel in (
        "baseline-locks.json", "release-locks.json", "README.md", "task-evidence/TASK13.md"))
    return {str(p.relative_to(ROOT)).replace("\\", "/"): sha(p.read_bytes())
            for p in sorted(selected)}


def locks():
    return json.loads((ROOT / "baseline-locks.json").read_text(encoding="utf-8"))


def construct(path):
    import coop_patch
    bootstrap.check_baseline()
    path = Path(path)
    if sha(path.read_bytes()) not in {value[1] for value in INPUTS.values()}:
        raise ValueError("未知输入整包 SHA，停止")
    editor = Editor(path, locks())
    for label, lock in editor.locks.items():
        body = editor.body(label)
        if sha(body[5]) != lock["sha"] or body[1:5] != lock["header"]:
            raise ValueError("输入方法 SHA/header 不符: " + label)
    groups = [coop_patch.build(editor)]
    editor.apply()
    return editor.swf.serialize(), editor, groups


def release_record(raw, editor):
    labels = list(editor.report) + [row["label"] for row in editor.new_methods]
    return {"sha256": sha(raw), "methods": {
        label: {"sha256": sha(editor.body(label)[5]),
                "header": editor.body(label)[1:5],
                "body": bodies.resolve(editor.abc, label)}
        for label in sorted(labels)}}


def pcode(editor):
    manifest = []
    for label in list(editor.report) + [row["label"] for row in editor.new_methods]:
        index = bodies.resolve(editor.abc, label)
        after = editor.abc.bodies[index]
        before = editor.original_bodies[index] if index < editor.original_count else None
        filename = label.replace("/", "__").replace("$", "_static")
        right = [f"# {label} header={after[1:5]} sha={sha(after[5])}",
                 *listing(editor.abc, after[5])]
        left = [] if before is None else [
            f"# {label} header={before[1:5]} sha={sha(before[5])}",
            *listing(editor.abc, before[5])]
        diff = list(difflib.unified_diff(left, right, "before", "after", lineterm=""))
        for suffix, lines in (("after.pcode.txt", right),
                              ("before.pcode.txt", left), ("diff.txt", diff)):
            output_path(ROOT / "pcode" / f"{filename}.{suffix}").write_text(
                "\n".join(lines) + "\n", encoding="utf-8")
        manifest.append({
            "label": label, "body": index,
            "before_sha256": None if before is None else sha(before[5]),
            "after_sha256": sha(after[5]), "header": after[1:5],
            "path_prefix": f"pcode/{filename}"})
    json_write(ROOT / "pcode/manifest.json", manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--prepare-locks", action="store_true")
    args = parser.parse_args()
    bootstrap.check_baseline()
    release_path = ROOT / "release-locks.json"
    release = json.loads(release_path.read_text(encoding="utf-8")) if release_path.exists() else {}
    if not args.prepare_locks and not release:
        raise ValueError("普通重放必须有固定 release-locks.json")
    source = args.input or INPUTS["test"][0]
    digest = sha(source.read_bytes())
    profiles = [key for key, value in INPUTS.items() if value[1] == digest]
    already = False
    if not profiles:
        profiles = [key for key, value in release.items() if value["sha256"] == digest]
        already = bool(profiles)
    if len(profiles) != 1:
        raise ValueError("未知或不唯一的输入 SHA")
    profile = profiles[0]
    destination = checked_output_path(args.output or ROOT / INPUTS[profile][2])
    if destination.exists() and any(
            destination.samefile(value[0]) for value in INPUTS.values()):
        raise ValueError("拒绝通过路径别名或硬链接覆盖任一固定原输入")
    if source.resolve() == destination or (
            destination.exists() and destination.samefile(source)):
        if not already:
            raise ValueError("拒绝覆盖原输入")
    if already:
        swf = SwfAbc(source)
        for label, lock in release[profile]["methods"].items():
            body = swf.abc.bodies[bodies.resolve(swf.abc, label)]
            if sha(body[5]) != lock["sha256"] or body[1:5] != lock["header"]:
                raise ValueError("已打输入方法锁不符: " + label)
            check_body(swf.abc, body)
        raw = source.read_bytes()
    else:
        raw, editor, groups = construct(source)
        record = release_record(raw, editor)
        if args.prepare_locks:
            release[profile] = record
            json_write(release_path, release)
        elif record != release.get(profile):
            raise ValueError("最终 SHA/header 与固定 release 不符")
        pcode(editor)
        json_write(ROOT / f"build-{profile}.json", {
            "input_sha256": digest, "output_sha256": sha(raw),
            "groups": groups, "changed": editor.report,
            "added": editor.new_methods, "traits": editor.traits,
            "pool": editor.pool.report()})
    if destination.exists() and destination.read_bytes() != raw and not args.prepare_locks:
        raise ValueError("输出已存在且内容不同，拒绝覆盖")
    output_path(destination).write_bytes(raw)
    output_path(destination.with_suffix(destination.suffix + ".sha256")).write_text(
        sha(raw) + "  " + destination.name + "\n", encoding="ascii")
    print(json.dumps({"status": "already_present" if already else "built",
                      "profile": profile, "output": str(destination), "sha256": sha(raw)}))


if __name__ == "__main__":
    main()
