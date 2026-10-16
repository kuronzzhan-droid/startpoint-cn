#!/usr/bin/env python3
"""Build an Android test APK allowing party reuse in Deep Abyss auto-start."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import struct
import sys
import textwrap
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TARGET_CLASS = "pinball.common.data.quest.singleQuestAutoStart.RushEventAutoStartQuestGroup"
TARGET_METHOD = "getDuplicatedCharacterIdsForEachQuest"
CLASS_PATH = Path("scripts") / Path(*TARGET_CLASS.split("."))
BASE_SWFS = {
    "public": "ff96d39ae9dd30b7341958da0dbb19db38f557f5eb37ec9ed5284fd15f238a71",
    "lan": "1884e5b95a28db8e69d6a6c1de53c27e074c36550099ef1684b5d42dd7cd983c",
}
BASE_METHOD_COUNT = 96404
TARGET_CODE_SHA256 = "fa21597210049e5233e8e4af73bda2fca5834c27b842e0de7624b018365d971b"
LENS_PARSER_SHA256 = "4a035a6b48b89a8a1b3f60eb371c49dfcf8095b1fe129e7bff46730e3a81b065"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


common = load_module("abyss_apk_common", HERE.parent / "rush-leaderboard/apk_build_common.py")
baseline_checker = load_module("abyss_baseline_checker", HERE.parent / "verify_android_baseline.py")
model = load_module("abyss_swf_model", HERE.parent / "lens0907-0908/build_swf.py")


def resolve_identity(variant, *, reproduce=False):
    record = HERE.parent / "accepted-history/android-lens-v3-20260909.json" if reproduce else None
    identity = baseline_checker.verify(variant, record_path=record)
    if identity["swf_sha256"] != BASE_SWFS[variant]:
        raise ValueError("accepted registry advanced; audit a new patch or explicitly reproduce this historical Lens v3 step")
    return identity


def check_lens_base(source):
    """Reject the demonstrated pre-Lens regression before editing or signing."""
    if common.sha256(source) not in BASE_SWFS.values():
        raise ValueError("input must be the reviewed Lens v3 cumulative SWF")
    swf = model.SwfAbc(source)
    abc = swf.abc
    if len(abc.bodies) != 92561:
        raise ValueError("Lens main ABC method inventory differs")
    if hashlib.sha256(abc.bodies[24599][5]).hexdigest() != TARGET_CODE_SHA256:
        raise ValueError("reviewed auto-start target method changed")
    if hashlib.sha256(abc.bodies[39060][5]).hexdigest() != LENS_PARSER_SHA256:
        raise ValueError("Lens 422 ability parser is missing or changed")
    return swf


def check_cumulative_delta(source, candidate):
    """Independent ABC parser checks pools, metadata, exceptions and SWF tags."""
    before = check_lens_base(source)
    after = model.SwfAbc(candidate)
    a, b = before.abc, after.abc
    if before.version != after.version or before._prefix != after._prefix:
        raise ValueError("SWF version or main ABC header changed")
    if (before.body[:before._offset] != after.body[:after._offset]
            or before.body[before._offset + before._length:] != after.body[after._offset + after._length:]):
        raise ValueError("non-main SWF tags changed")
    for attr in ("methods", "metadata", "instances", "classes", "scripts"):
        if model.freeze(getattr(a, attr)) != model.freeze(getattr(b, attr)):
            raise ValueError(f"unrelated ABC metadata changed: {attr}")
    for attr in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames"):
        old = getattr(a, attr)
        new = getattr(b, attr)[:len(old)]
        equal = ([struct.pack('<d', x) for x in old] == [struct.pack('<d', x) for x in new]
                 if attr == "doubles" else model.freeze(old) == model.freeze(new))
        if not equal:
            raise ValueError(f"existing constant pool changed: {attr}")
    if len(a.bodies) != len(b.bodies):
        raise ValueError("main ABC body inventory changed")
    for i, (old, new) in enumerate(zip(a.bodies, b.bodies)):
        if i != 24599 and model.freeze(old) != model.freeze(new):
            raise ValueError(f"non-target body or exception/activation metadata changed: {i}")
    if hashlib.sha256(b.bodies[39060][5]).hexdigest() != LENS_PARSER_SHA256:
        raise ValueError("output lost the Lens 422 ability parser")
    return {"base_release": "Lens v3 2026-09-08", "main_abc_bodies": len(b.bodies),
            "ability_422_parser_sha256": LENS_PARSER_SHA256,
            "existing_constant_pools_preserved": True, "abc_metadata_preserved": True,
            "non_target_bodies_exceptions_and_activations_preserved": True,
            "non_main_swf_tags_preserved": True}


def run(command, *, capture=False, timeout=180):
    """Run synchronously and clean up the entire child tree on interruption."""
    process = None
    try:
        process = subprocess.Popen(
            [str(x) for x in command], stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
        )
        output, _ = process.communicate(timeout=timeout)
        if process.returncode:
            raise RuntimeError(f"child exited with {process.returncode}:\n{output}")
        if not capture and output.strip():
            print(output.strip(), flush=True)
        return output
    finally:
        if process is not None and process.poll() is None:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
            )
            process.wait(timeout=15)


# Reuse only generic APK packaging/verification, with bounded child cleanup.
common.run = run


def extract_method(full, name=TARGET_METHOD):
    lines = full.splitlines()
    marker = f'trait method QName(PackageNamespace(""),"{name}")'
    starts = [i for i, line in enumerate(lines) if line.strip() == marker]
    if len(starts) != 1:
        raise ValueError(f"expected exactly one {name}")
    start = starts[0]
    indent = len(lines[start]) - len(lines[start].lstrip())
    end = next(i for i in range(start + 1, len(lines))
               if lines[i].strip() == "end ; method"
               and len(lines[i]) - len(lines[i].lstrip()) == indent + 3)
    return textwrap.dedent("\n".join(lines[start:end + 1]) + "\n")


def code_lines(method):
    lines = [line.strip() for line in method.splitlines() if line.strip()]
    return lines[lines.index("code") + 1:lines.index("end ; code")]


def canonical(lines):
    """Ignore FFDec's address-derived label names, preserving all opcodes."""
    labels = {line[:-1]: f"L{i}" for i, line in enumerate(lines) if line.endswith(":")}
    pattern = re.compile(r"\b(" + "|".join(map(re.escape, labels)) + r")\b") if labels else None
    return [pattern.sub(lambda m: labels[m[0]], line) if pattern else line for line in lines]


def patch_method(source):
    original = code_lines(source)
    if original[:2] != ["getlocal0", "pushscope"] or source.count("localcount 20") != 1:
        raise ValueError("unexpected baseline method frame")
    if "700099" in source or "abyss_original" in source:
        raise ValueError("target is already patched or differs from baseline")
    # Only the new Deep Abyss path uses registers 20..22. All original paths
    # retain their complete instructions and jump graph after the guard.
    prefix = '''getlocal0
getproperty QName(PackageNamespace(""),"event")
getproperty QName(PackageNamespace(""),"id")
pushint 700099
ifne abyss_original
newarray 0
coerce QName(PackageNamespace(""),"Array")
setlocal 20
pushbyte 0
setlocal 21
getlocal0
getproperty QName(PackageNamespace(""),"folder")
callproperty QName(PackageNamespace(""),"getQuests"), 0
getproperty QName(PackageNamespace(""),"length")
convert_i
setlocal 22
jump abyss_check
abyss_round:
label
getlocal 20
newarray 0
callpropvoid QName(PackageNamespace(""),"push"), 1
inclocal_i 21
abyss_check:
getlocal 21
getlocal 22
iflt abyss_round
getlocal 20
returnvalue
abyss_original:'''
    scope = "            getlocal0\n            pushscope\n"
    if source.count(scope) != 1:
        raise ValueError("unexpected scope prologue")
    result = source.replace("localcount 20", "localcount 23", 1)
    return result.replace(scope, scope + textwrap.indent(prefix + "\n", "            "), 1)


def validate_readback(source, intended, actual):
    if canonical(code_lines(actual)) != canonical(code_lines(intended)):
        raise ValueError("re-exported target instructions differ from intended patch")
    for field, expected in (("maxstack", 7), ("localcount", 23),
                            ("initscopedepth", 1), ("maxscopedepth", 2)):
        if re.findall(rf"\b{field} (\d+)\b", actual) != [str(expected)]:
            raise ValueError(f"unexpected method frame: {field}")
    lines = code_lines(actual)
    fallback = next(x.split()[1] for x in lines if x.startswith("ifne "))
    tail = lines[lines.index(fallback + ":") + 1:]
    if canonical(tail) != canonical(code_lines(source)[2:]):
        raise ValueError("non-Deep-Abyss instructions were changed")


def exercise_readback(method):
    """Execute the actual exported guard/array loop with mock host objects.

    This checks emitted control flow, array dimensions/aliasing, and clean
    fallback. It does not claim to run Flash/AIR or replace device testing.
    """
    lines = code_lines(method)
    labels = {line[:-1]: i for i, line in enumerate(lines) if line.endswith(":")}
    fallback = next(x.split()[1] for x in lines if x.startswith("ifne "))
    cases = []
    for event_id, count in [(700099, 0), (700099, 1), (700099, 30), (700099, 60),
                            (700098, 15), (700007, 3), (700017, 3)]:
        instance = {"event": {"id": event_id}, "folder": {"getQuests": lambda: [None] * count}}
        # Repeated team IDs are deliberately irrelevant to the unlocked path.
        regs, stack, pc, returned = {0: instance, 1: [1] * count}, [], 0, False
        for _ in range(5000):
            if pc == labels[fallback]:
                assert event_id != 700099 and not stack and set(regs) == {0, 1}
                break
            line = lines[pc]
            pc += 1
            op, _, arg = line.partition(" ")
            if line.endswith(":") or op in ("label", "coerce"):
                continue
            if op == "getlocal0": stack.append(regs[0])
            elif op == "getlocal": stack.append(regs[int(arg)])
            elif op == "setlocal": regs[int(arg)] = stack.pop()
            elif op == "pushscope": stack.pop()
            elif op in ("pushint", "pushbyte"): stack.append(int(arg))
            elif op == "convert_i": stack.append(int(stack.pop()))
            elif op == "inclocal_i": regs[int(arg)] += 1
            elif op == "newarray":
                assert arg == "0"
                stack.append([])
            elif op == "getproperty":
                prop = re.search(r',"([^"]+)"\)', arg)[1]
                obj = stack.pop()
                stack.append(len(obj) if prop == "length" else obj[prop])
            elif op == "callproperty":
                assert arg == 'QName(PackageNamespace(""),"getQuests"), 0'
                stack.append(stack.pop()["getQuests"]())
            elif op == "callpropvoid":
                assert arg == 'QName(PackageNamespace(""),"push"), 1'
                value, obj = stack.pop(), stack.pop()
                obj.append(value)
            elif op == "jump": pc = labels[arg]
            elif op in ("ifne", "iflt"):
                right, left = stack.pop(), stack.pop()
                if (left != right if op == "ifne" else left < right): pc = labels[arg]
            elif op == "returnvalue":
                result = stack.pop()
                assert event_id == 700099 and result == [[] for _ in range(count)] and not stack
                assert len({id(row) for row in result}) == count
                returned = True
                break
            else:
                raise AssertionError(f"unexpected instruction before fallback: {line}")
        else:
            raise AssertionError("emitted loop did not terminate")
        assert returned == (event_id == 700099)
        cases.append({"event_id": event_id, "rounds": count,
                      "result": "empty_restriction_per_round" if returned else "original_path"})
    return cases


def export_class(args, swf, destination, *, pcode=True):
    command = [args.java, "-Xmx3g", "-jar", args.ffdec, "-onerror", "abort"]
    if pcode:
        command += ["-format", "script:pcode"]
    run(command + ["-selectclass", TARGET_CLASS, "-export", "script", destination, swf])
    path = (destination / CLASS_PATH).with_suffix(".pcode" if pcode else ".as")
    return path.read_text(encoding="utf-8-sig")


def main():
    # FFDec can emit replacement characters on Chinese Windows consoles.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=BASE_SWFS, default="public")
    parser.add_argument("--reproduce-lens-v3", action="store_true",
                        help="explicitly reproduce this historical step using its exact archived Lens v3 input")
    for name in ("out", "work", "java", "javac", "ffdec", "zipalign", "apksigner", "keystore", "credential"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    identity = resolve_identity(args.variant, reproduce=args.reproduce_lens_v3)
    if args.work.exists() or args.out.parent.exists():
        raise ValueError("use new task work/output directories; no existing artifacts are overwritten")
    args.work.mkdir(parents=True)
    base = Path(identity["apk"])
    source = args.work / "baseline.swf"
    common.extract_swf(base, source)
    check_lens_base(source)
    source_class = export_class(args, source, args.work / "source-pcode")
    source_method = extract_method(source_class)
    intended = patch_method(source_method)
    patch_file = args.work / "abyss-autostart.pcode"
    patch_file.write_text(intended, encoding="utf-8", newline="\n")

    helpers = args.work / "method-tools"
    helpers.mkdir()
    helper_source = HERE.parent / "character-carousel"
    run([args.javac, "-cp", args.ffdec, "-d", helpers,
         helper_source / "FindMethodBody.java", helper_source / "CompareMethodBodies.java"])
    cp = os.pathsep.join((str(helpers), str(args.ffdec)))
    location = run([args.java, "-cp", cp, "FindMethodBody", source, TARGET_CLASS, TARGET_METHOD], capture=True)
    match = re.fullmatch(re.escape(f"{TARGET_CLASS}.{TARGET_METHOD}") + r"\tabc=(\d+)\tbody=(\d+)\s*", location)
    if not match:
        raise ValueError(f"unexpected target location: {location}")
    abc, body = match.groups()
    changed_key = f"{abc}:{body}"
    if changed_key != "284:24599":
        raise ValueError("reviewed target method moved; audit required")
    candidate = args.work / "abyss-autostart.swf"
    run([args.java, "-Xmx3g", "-jar", args.ffdec, "-air", "-onerror", "abort",
         "-replace", source, candidate, TARGET_CLASS, patch_file, body])
    comparison = run([args.java, "-Xmx3g", "-cp", cp, "CompareMethodBodies", source, candidate], capture=True)
    if set(comparison.strip().splitlines()) != {
        f"method_bodies={BASE_METHOD_COUNT}", "changed_count=1", f"changed={changed_key}",
    }:
        raise ValueError(f"unexpected cumulative SWF delta: {comparison}")
    (args.work / "method-comparison.txt").write_text(comparison, encoding="utf-8")
    cumulative_checks = check_cumulative_delta(source, candidate)
    actual_class = export_class(args, candidate, args.work / "final-pcode")
    actual_method = extract_method(actual_class)
    validate_readback(source_method, intended, actual_method)
    # Whole target-class export must preserve every other method and trait.
    def without_target(value):
        method = extract_method(value)
        return "\n".join(line.strip() for line in value.splitlines() if line.strip()).replace(
            "\n".join(line.strip() for line in method.splitlines() if line.strip()), "<TARGET_METHOD>", 1)
    if without_target(source_class) != without_target(actual_class):
        raise ValueError("unrelated target-class metadata or instructions changed")
    cases = exercise_readback(actual_method)
    final_as = export_class(args, candidate, args.work / "final-as", pcode=False)
    if "700099" not in final_as or "getDuplicatedCharacterIdsForEachQuest" not in final_as:
        raise ValueError("final AS export did not retain the target branch")
    if not final_as.rstrip().endswith("}") or "Decompilation error" in final_as:
        raise ValueError("final AS export is incomplete")
    print(f"SWF verified: only {changed_key} changed; {len(cases)} emitted-code cases passed", flush=True)

    new_uuid = str(uuid.uuid4())
    unsigned = args.work / "unsigned.apk"
    aligned = args.work / "aligned.apk"
    signed = args.work / "signed.apk"
    common.replace_apk(base, candidate, unsigned, new_uuid, base_uuid=identity["uniqueappversionid"])
    run([args.zipalign, "-p", "-f", "4", unsigned, aligned])
    # Signing credentials exist only in the dedicated PowerShell signer and
    # its Java child, not throughout the decompiler/build process.
    run(["powershell.exe", "-NoProfile", "-NonInteractive", "-File", HERE / "sign_apk.ps1",
         "-Java", args.java, "-ApkSigner", args.apksigner, "-Keystore", args.keystore,
         "-CredentialPath", args.credential, "-InputApk", aligned, "-OutputApk", signed])
    run([args.zipalign, "-c", "-p", "4", signed])
    report = common.verify(base, signed, candidate, new_uuid, args.java, args.apksigner,
                           base_uuid=identity["uniqueappversionid"])
    args.out.parent.mkdir(parents=True)
    signed.replace(args.out)
    report.update({
        "schema_version": 1, "status": "locally_verified_test_candidate",
        "device_verified": False, "variant": args.variant,
        "base": identity, "apk": str(args.out.resolve()),
        "work": str(args.work.resolve()), "changed_methods": [changed_key],
        "target_class": TARGET_CLASS, "target_method": TARGET_METHOD,
        "event_id": 700099, "method_bodies_checked": BASE_METHOD_COUNT,
        "lens_cumulative_checks": cumulative_checks,
        "builder_sha256": common.sha256(Path(__file__)),
        "non_target_method_bodies_unchanged": True, "original_fallback_unchanged": True,
        "target_class_other_content_unchanged": True, "swf_reexport_verified": True,
        "zipalign": True, "v1_signature": True, "v2_signature": True,
        "manifest_only_uuid_changed": True,
        "non_swf_apk_members_unchanged": True, "pcode_cases": cases,
        "server_changes": [], "ios_changes": [],
    })
    (args.out.parent / "verification-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.out.parent / "SHA256.txt").write_text(f"{report['apk_sha256']}  {args.out.name}\n", encoding="utf-8")
    # Exact task-generated intermediate files only; preserve source evidence.
    unsigned.unlink()
    aligned.unlink()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
