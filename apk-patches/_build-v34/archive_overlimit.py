"""Create archive drafts 108–111 from read-only O8–O12 delivery sources."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys

from archive_overlimit_docs import render_entry, render_index
from archive_overlimit_specs import SHARED_SOURCE_SHA, SPECS

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apk-patches-additions"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def confined(path):
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f"output escapes workspace: {path}")
    return path


def write_json(path, value):
    path = confined(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def copy_file(source, target):
    target = confined(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    assert target.read_bytes() == source.read_bytes()
    return {"path": target.relative_to(OUT).as_posix(), "origin": str(source),
            "bytes": source.stat().st_size, "sha256": sha(source.read_bytes())}


def load_archive():
    name = "overlimit_archive_evidence"
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/verify_archive_preservation.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module, module.archive_entries()


def map_method(target, entries, r4, archive, support, original, candidate):
    body = target["body"]
    original_body = original.bodies[body]
    assert support.sha(original_body[5]) == target["before"]
    assert original_body[1:5] == target["before_header"]
    overlaps = [{"number": e["number"], "entry": e["entry"], "method": row}
                for e in entries for row in e["methods"]
                if row["abc"].replace("/", ".") == "boot_ffc6" and row["body"] == body]
    r4_overlap = [row for row in r4 if row["body"] == body]
    assert not overlaps and not r4_overlap and ("boot_ffc6", body) not in archive.ALLOWED
    mapping = {**target, "abc": "boot_ffc6", "v33_archive_intersection": overlaps,
               "r4_target_intersection": r4_overlap, "five_composed_methods_intersection": False,
               "composition": "无交集；按已锁定的方法体直接应用，不新增合成。"}
    if candidate:
        actual = candidate.bodies[body]
        assert support.sha(actual[5]) == target["after"]
        assert actual[1:5] == target["after_header"]
        mapping["actual_final_method"] = {"code_sha256": support.sha(actual[5]),
                                         "header": actual[1:5], "method_id": actual[0],
                                         "check": support.m.check_body(actual, candidate)}
    return mapping


def update_r4_final(manifest, candidate, final_sha, support):
    for row in manifest["entries"]:
        if not 102 <= row["number"] <= 107:
            continue
        entry_path = OUT / row["directory"] / "entry.json"
        entry = json.loads(entry_path.read_text(encoding="utf-8"))
        for target in entry["final_pcode"]:
            if target["abc"] == "boot_ffc6":
                assert support.sha(candidate.bodies[target["body"]][5]) == target["code_sha256"]
        old_sha = entry.get("final_swf_sha256")
        entry.setdefault("r4_stage_swf_sha256", old_sha)
        entry["final_swf_sha256"] = final_sha
        write_json(entry_path, entry)
        readme = entry_path.with_name("README.md")
        text = readme.read_text(encoding="utf-8")
        if old_sha:
            text = text.replace(f"最终 v34 SWF SHA-256：`{old_sha}`。", f"最终 v34 SWF SHA-256：`{final_sha}`。")
        confined(readme).write_text(text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--final-swf", type=Path)
    args = parser.parse_args()
    sources = list(Path(r"D:\WF\out").glob("v34*-20261016/apk-patches"))
    source = args.source or (sources[0] if len(sources) == 1 else None)
    if source is None:
        raise ValueError("exactly one read-only v34 delivery source is required")
    source_digests = [sha((source / f'{item["upstream_number"]}-{item["slug"]}' / "source/v34_patches.py").read_bytes())
                      for item in SPECS]
    assert set(source_digests) == {SHARED_SOURCE_SHA}, "read-only source revision differs from pinned r2"
    archive, entries = load_archive()
    archive_method_count = len({(r["abc"].replace("/", "."), r["body"])
                                for e in entries for r in e["methods"]})
    assert len(entries) == 101 and archive_method_count == 611
    support = archive.import_support()
    original = archive.abc_map(support, ROOT / "inputs/v33.swf")["boot_ffc6"][0][1]
    candidate = archive.abc_map(support, args.final_swf)["boot_ffc6"][0][1] if args.final_swf else None
    final_sha = support.sha(args.final_swf.read_bytes()) if args.final_swf else None
    r4 = json.loads((ROOT / "audits/overlap-audit.json").read_text(encoding="utf-8"))["targets"]
    r4_window_methods = [row for row in r4 if "OverLimitWindow" in row["method"]]
    r4_dialog_methods = [row for row in r4 if "ExpodOverLimitByItemDialog" in row["method"]]
    assert not r4_window_methods
    assert not r4_dialog_methods
    all_bodies = [target["body"] for item in SPECS for target in item["methods"]]
    assert len(set(all_bodies)) == len(all_bodies) == 5
    assert len({row["body"] for row in r4}) == 47 and len(r4) == 48
    evidence, added, shared_source_digests = [], [], []
    for item in SPECS:
        number = item["number"]
        folder = OUT / f'{number}-{item["slug"]}'
        upstream = source / f'{item["upstream_number"]}-{item["slug"]}'
        assert upstream.is_dir(), upstream
        methods = [map_method(t, entries, r4, archive, support, original, candidate) for t in item["methods"]]
        for target in methods:
            evidence.append({"number": number, "upstream_number": item["upstream_number"], **target})
        files = []
        for path in sorted(upstream.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(upstream)
            assert path.suffix.lower() in {".py", ".md", ".txt"}, path
            destination = folder / ("provenance/upstream-README.md" if relative.as_posix() == "README.md" else relative)
            files.append(copy_file(path, destination))
        shared_source_digests.append(sha((upstream / "source/v34_patches.py").read_bytes()))
        record = {**item, "first_apk_version": "v34", "status": "归档条目草稿",
                  "input_swf_sha256": support.sha((ROOT / "inputs/v33.swf").read_bytes()),
                  "r4_base_swf_sha256": "53890c19f5ced5c70ed2e327e62a8f2f800d8ce5f2fdff5f493ad5c758518642",
                  "final_swf_sha256": final_sha, "methods": methods, "source_files": files,
                  "upstream_source": str(upstream), "upstream_files_byte_identical": True,
                  "current_validation_scope": "离线；最终产物验证见根 build-report.json；本轮未运行设备。",
                  "upstream_history_scope": "provenance/upstream-README.md 中自测及真机记载仅属于来源线程，不冒认为本轮重跑。"}
        write_json(folder / "entry.json", record)
        confined(folder / "README.md").write_text(render_entry(item, candidate is not None), encoding="utf-8")
        added.append({"number": number, "module": item["id"], "directory": folder.name,
                      "method_count": len(methods), "helper_count": 0, "final_pcode_files": len(methods),
                      "before_pcode_files": len(methods), "upstream_number": item["upstream_number"],
                      "first_apk_version": "v34", "revision": item.get("revision", "unchanged-O8"),
                      "source_revision": item["source_revision"], "actual_final_method_verified": candidate is not None})
    assert len(set(shared_source_digests)) == 1
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entries"] = [r for r in manifest["entries"] if r["number"] not in {108, 109, 110, 111}] + added
    manifest.update(r4_unique_original_methods=47, overlimit_unique_original_methods=len(all_bodies),
                    unique_original_methods=47 + len(all_bodies), module_method_occurrences=len(r4) + len(all_bodies),
                    overlimit_shared_source_sha256=shared_source_digests[0], overlimit_source_revision="r2")
    if candidate:
        manifest["final_swf_sha256"] = final_sha
        update_r4_final(manifest, candidate, final_sha, support)
    write_json(manifest_path, manifest)
    audit = {"status": "passed", "r4_unique_target_count": 47, "original_archive_entries": 101,
             "original_archive_unique_methods": archive_method_count, "new_methods": evidence,
             "r4_overlimit_window_methods": r4_window_methods, "r4_overlimit_dialog_methods": r4_dialog_methods,
             "new_methods_mutually_disjoint": True,
             "archive_composition_allowlist_unchanged": sorted([list(x) for x in archive.ALLOWED]),
             "final_swf_sha256": final_sha, "shared_source_sha256": shared_source_digests[0],
             "source_revision": "r2", "scope": "静态方法映射；不声称运行或设备验收。"}
    write_json(ROOT / "audits/overlimit-archive-overlap-r2.json", audit)
    index = OUT / "README.md"
    confined(index).write_text(render_index(index.read_text(encoding="utf-8")), encoding="utf-8")
    forbidden = {".apk", ".swf", ".abc", ".swc", ".dex", ".so", ".jar", ".p12", ".jks", ".keystore"}
    assert not [p for p in OUT.rglob("*") if p.is_file() and p.suffix.lower() in forbidden]
    print(json.dumps({"status": "passed", "entries": added, "overlap": evidence}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
