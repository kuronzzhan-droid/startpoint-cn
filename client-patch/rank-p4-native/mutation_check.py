#!/usr/bin/env python3
"""Negative control for the P4 verifier: deliberately break the patch, assert red.

A self-check that never fails is not a self-check.  This takes the P-code the
real build generated, mutates it four ways that each model a *real* accident,
re-assembles, and requires `verify_rank_p4.verify` to reject every one:

    drop-original    an instruction of the ORIGINAL body disappears
                     (models "the prologue ate code it was supposed to keep")
    reroute-branch   an ORIGINAL jump is pointed at a different existing label
                     (models the classic hand-written-prologue hijack; the plain
                      instruction diff still looks clean, only the target check
                      catches it)
    extra-string     one more string reaches the constant pool than declared
                     (models a typo'd slot name silently shipping)
    break-sentinel   s3+ only: the sentinel's `ifne` becomes `ifeq`, i.e. the
                     ranking renderer takes over the *party* path and the host
                     page dies.  This is the S3 regression in bytecode form -
                     if the checks cannot see it, they cannot protect the
                     "battle history & reset" page either.
    break-s5-sentinel  s5 only: same inversion, but on the guard that decides
                     whether View/run builds the top bar and the pinned card.
                     Ungated, those two widgets would be drawn on the *party*
                     page as well and the list would be pushed down there too.
    s5-drop-resize   s5 only: the `resizeHeight` call disappears, i.e. the list
                     is moved down to y=438 but never shrunk, so its bottom
                     438 px fall outside its own mask.  Models "half of a
                     two-step geometry change got lost".

⚠ These are **structural** controls.  They catch a dropped / re-ordered / wrongly
   named instruction; they do NOT catch a wrong *operand* inside an inserted
   block (`verify_rank_p4` compares inserted blocks by opcode name only - its own
   docstring says so).  Operand-level mistakes in the new code are covered by the
   builder's AS3 read-back assertions instead (`AS3_S5_MUST_APPEAR` spells out
   `Option.Some(438)`, `listLayer.y = safeArea.y + 438`,
   `LoadingTaskKind.ProfileGetProfile(`,
   `partyListView.resizeHeight(partyListView.listSize.height - 438)` and friends).

Usage:
    python -X utf8 client-patch/rank-p4-native/mutation_check.py --variant s4
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


builder = _load(HERE / "build_rank_p4.py", "mc_builder")
patcher = _load(HERE / "patch_rank_native.py", "mc_patch")
verifier = _load(HERE / "verify_rank_p4.py", "mc_verify")

JAVA = Path(r"C:\Program Files\Java\jre1.8.0_491\bin\java.exe")
FFDEC = REPO / "ffdec_26.2.1" / "ffdec.jar"

CLASSES = (builder.CONTENT_CLASS, builder.LISTVIEW_CLASS, builder.SCENE_CLASS,
           builder.REMOTE_CLASS, builder.VIEW_CLASS, builder.TOPSCENE_CLASS)


def resolve_bodies(variant: str, base_swf: Path) -> dict:
    """(class, trait) -> body index, straight out of the SWF that was patched."""
    abc_methods = _load(REPO / "client-patch" / "dual-form-v1" / "abc_methods.py",
                        "mc_abc_methods")
    index = abc_methods.index_swf_methods(base_swf)
    out = {}
    for class_name, trait in patcher.methods_for(variant):
        lock = builder.METHOD_LOCKS[(class_name, trait)]
        out[(class_name, trait)] = index.require_ref("%s/%s" % (lock["ns"], trait)).body_index
    return out


def assemble(pcode_dir: Path, destination: Path, base_swf: Path, bodies: dict) -> None:
    command = [JAVA, "-Xmx6g", "-jar", FFDEC, "-air", "-replace", base_swf, destination]
    for path in sorted(pcode_dir.glob("*.pcode")):
        # 00-Class-trait.pcode
        stem = path.stem.split("-", 1)[1]
        class_name, trait = stem.rsplit("-", 1)
        full = next(name for name in CLASSES if name.rsplit(".", 1)[-1] == class_name)
        command += [full, str(path), str(bodies[(full, trait)])]
    env = dict(os.environ, JAVA_HOME=str(JAVA.parent.parent))
    proc = subprocess.run([str(part) for part in command], capture_output=True,
                          text=True, errors="replace", timeout=1800)
    if proc.returncode != 0 or not destination.is_file():
        raise SystemExit("FFDec failed: %s" % proc.stderr[-2000:])


def _write(target: Path, lines: list[str]) -> None:
    target.write_text(chr(10).join(lines) + chr(10), encoding="utf-8", newline=chr(10))


def mutate(name: str, work: Path, generated: Path, variant: str) -> None:
    """Copy the generated P-code into *work* with mutation *name* applied."""
    shutil.copytree(generated, work)

    if name == "drop-original":
        # ContentView/apply: remove one instruction from the ORIGINAL tail (the
        # receiver of the round-number getUiStringWithContext call).
        target = next(work.glob("*-apply.pcode"))
        lines = target.read_text(encoding="utf-8").splitlines()
        at = [i for i, line in enumerate(lines)
              if line.strip() == 'pushstring "rush_event_ranking_party_list_round_number"']
        assert len(at) == 1, at
        del lines[at[0]]
        # the call's argument count has to follow, or FFDec refuses to assemble
        for index in range(at[0], len(lines)):
            if "getUiStringWithContext" in lines[index]:
                lines[index] = lines[index].replace(", 2", ", 1")
                break
        target.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    elif name == "reroute-branch":
        # Scene/copyPlayedParty: send the ORIGINAL lookupswitch's first case at
        # the second one instead.
        target = next(work.glob("*-copyPlayedParty.pcode"))
        text = target.read_text(encoding="utf-8")
        match = re.search(r"lookupswitch (ofs[0-9a-f]+), \[(ofs[0-9a-f]+), (ofs[0-9a-f]+)\]", text)
        assert match is not None, "no original lookupswitch to re-route"
        old = match.group(0)
        new = "lookupswitch %s, [%s, %s]" % (match.group(1), match.group(3), match.group(3))
        assert text.count(old) == 1
        target.write_text(text.replace(old, new), encoding="utf-8", newline="\n")

    elif name == "extra-string":
        # A typo'd slot name: the layout has no such text, so the row would be
        # blank on the device with no error anywhere.
        target = next(work.glob("*-apply.pcode"))
        text = target.read_text(encoding="utf-8")
        old = 'pushstring "kill_count"'
        assert text.count(old) == 1
        target.write_text(text.replace(old, 'pushstring "kill_kount"'),
                          encoding="utf-8", newline="\n")

    elif name == "break-sentinel":
        # Invert the first half of the sentinel in resizeWidth: the ranking
        # short-circuit would then fire on the PARTY path, i.e. exactly the S3
        # regression (`right_align` never gets its x, the host page breaks).
        target = next(work.glob("*-resizeWidth.pcode"))
        lines = target.read_text(encoding="utf-8").splitlines()
        at = [i for i, line in enumerate(lines) if line.strip().startswith("ifne ofsRankOldResize")]
        assert len(at) == 1, at
        lines[at[0]] = lines[at[0]].replace("ifne ", "ifeq ")
        target.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    elif name == "break-s5-sentinel":
        # View/run: ungate the top bar + pinned card + list rect, so the party
        # page gets them too and its list is pushed down 438 px.
        target = next(work.glob("*RushEventRankingPartyView-run.pcode"))
        lines = target.read_text(encoding="utf-8").splitlines()
        at = [i for i, line in enumerate(lines) if line.strip().startswith("ifne ofsRankS5Done")]
        assert len(at) == 1, at
        lines[at[0]] = lines[at[0]].replace("ifne ", "ifeq ")
        _write(target, lines)

    elif name == "break-s5b-sentinel":
        # View/run: ungate the top bar, so the party page ("battle history &
        # reset") would get a black date bar and 204 px of top padding too.
        target = next(work.glob("*RushEventRankingPartyView-run.pcode"))
        lines = target.read_text(encoding="utf-8").splitlines()
        at = [i for i, line in enumerate(lines) if line.strip().startswith("ifne ofsRankS5bDone")]
        assert len(at) == 1, at
        lines[at[0]] = lines[at[0]].replace("ifne ", "ifeq ")
        _write(target, lines)

    elif name == "s5b-drop-padding":
        # View/run: keep the bar, lose the room it needs - the bar would then
        # sit on top of row 1.
        target = next(work.glob("*RushEventRankingPartyView-run.pcode"))
        lines = target.read_text(encoding="utf-8").splitlines()
        at = [i for i, line in enumerate(lines)
              if line.strip() == 'getproperty QName(PackageNamespace(""),"listPadding")']
        assert len(at) == 1, at
        # drop getproperty listPadding + pushint 204 + setproperty top, and the
        # two receiver loads in front of them
        del lines[at[0] - 3: at[0] + 3]
        _write(target, lines)

    elif name == "s5-drop-resize":
        # View/run: keep the move, lose the shrink.
        target = next(work.glob("*RushEventRankingPartyView-run.pcode"))
        lines = target.read_text(encoding="utf-8").splitlines()
        at = [i for i, line in enumerate(lines) if "resizeHeight" in line]
        assert len(at) == 1, at
        del lines[at[0]]
        _write(target, lines)

    else:
        raise SystemExit("unknown mutation %r" % name)


def reconstruct_work(out: Path, work_root: Path) -> None:
    """从交付物重建 `work/base.swf` 和 `work/generated/`。

    只用交付目录里已经有的东西 + 构建脚本锁定的那个 P2 基座 APK,
    不重跑构建、不改交付物。重建出来的东西必须和构建当时那一份逐字节相同 ——
    `base.swf` 有 `build_rank_p4.BASELINE` 的 sha256 兜底,
    `generated/` 就是构建脚本自己拷进 out_dir 的那 12 个文件。
    """
    pcodes = sorted(out.glob("*.pcode"))
    if len(pcodes) != 12:
        raise SystemExit("[FAIL] expected 12 delivered .pcode files in %s, found %d"
                         % (out, len(pcodes)))

    work_root.mkdir(parents=True, exist_ok=True)

    base_swf = work_root / "base.swf"
    if not base_swf.is_file():
        base_apk = REPO / "out" / "rank-scene-p2" / "WorldFlipper-rank-scene-p2.apk"
        if not base_apk.is_file():
            raise SystemExit("[FAIL] base APK missing: %s" % base_apk)
        with zipfile.ZipFile(base_apk) as archive:
            swf_bytes = archive.read(builder.TARGET_SWF_MEMBER)
        digest = hashlib.sha256(swf_bytes).hexdigest()
        if digest != builder.BASELINE["swf_sha256"]:
            raise SystemExit("[FAIL] base SWF drift: sha256=%s" % digest)
        base_swf.write_bytes(swf_bytes)

    generated = work_root / "generated"
    if not generated.is_dir():
        generated.mkdir()
        for path in pcodes:
            shutil.copy2(path, generated / path.name)
    print("[info] rebuilt %s from the delivered artifacts" % work_root, file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variant",
                        choices=("s2", "s3", "s4", "s5", "s5b"), default="s4")
    args = parser.parse_args()
    variant = args.variant

    out = REPO / "out" / {"s5": "rank-p5", "s5b": "rank-p5b"}.get(
        variant, "rank-p4-%s" % variant)
    work_root = out / "work"
    base_swf = work_root / "base.swf"
    generated = work_root / "generated"
    if not base_swf.is_file() or not generated.is_dir():
        # 20260828:交付目录里 `work/` 可能已经被清掉(它是构建中间物,不是交付物),
        # 而这个自检**必须能从交付物本身跑起来** —— 跑不动的自检等于没有自检。
        # 两样输入都能从交付物重建,所以就地重建,而不是让人重跑一次半小时的构建:
        #   base.swf   = P2 基座 APK 里的那一份(构建脚本第 1 步就是这么取的)
        #   generated/ = out_dir 根目录下那 12 个 .pcode(构建脚本第 12 步拷过去的)
        try:
            reconstruct_work(out, work_root)
        except SystemExit:
            raise
        except Exception as exc:                        # pragma: no cover - 只在环境坏掉时走到
            raise SystemExit("[FAIL] cannot reconstruct %s: %s" % (work_root, exc))
    if not base_swf.is_file() or not generated.is_dir():
        raise SystemExit(
            "[FAIL] no work/ dir and it could not be reconstructed from %s; "
            "run build_rank_p4.py --variant %s first" % (out, variant))

    scratch = out / "mutation-check"
    if scratch.exists():
        shutil.rmtree(scratch)
    scratch.mkdir(parents=True)

    bodies = resolve_bodies(variant, base_swf)
    alias = {
        (builder.CONTENT_CLASS, "run"): "run",
        (builder.CONTENT_CLASS, "apply"): "apply",
        (builder.CONTENT_CLASS, "resizeWidth"): "resizeWidth",
        (builder.LISTVIEW_CLASS, "createListCell"): "createListCell",
        (builder.SCENE_CLASS, "preparation"): "preparation",
        (builder.SCENE_CLASS, "afterTransition"): "afterTransition",
        (builder.SCENE_CLASS, "copyPlayedParty"): "copyPlayedParty",
        (builder.SCENE_CLASS, "run"): "sceneRun",
        (builder.SCENE_CLASS, "buttonClicked"): "sceneButtonClicked",
        (builder.VIEW_CLASS, "run"): "viewRun",
        (builder.REMOTE_CLASS, "successHandler"): "successHandler",
        (builder.TOPSCENE_CLASS, "buttonClicked"): "crownClicked",
    }
    body_of = {alias[key]: value for key, value in bodies.items()}
    expected = builder.expected_bodies(patcher, variant, body_of)
    strings = patcher.new_strings_for(variant)

    names = ["drop-original", "reroute-branch", "extra-string"]
    if variant in ("s3", "s4", "s5", "s5b"):
        names.append("break-sentinel")
    if variant == "s5":
        names += ["break-s5-sentinel", "s5-drop-resize"]
    if variant == "s5b":
        names += ["break-s5b-sentinel", "s5b-drop-padding"]

    # ── 基线对照 ──────────────────────────────────────────────────────
    # 「变异全判红」只有在**没变异时判绿**的前提下才有意义;更进一步,把没变异的
    # P-code 装回去得到的 SWF 必须和交付的那份**逐字节相同** —— 否则这一轮自检
    # 检的就不是发出去的那些字节。这一条 20260828 复核时才补上。
    baseline_swf = scratch / "baseline.swf"
    assemble(generated, baseline_swf, base_swf, bodies)
    baseline: dict = {"verdict": "GREEN (good)"}
    try:
        verifier.verify(base_swf, baseline_swf, expected_bodies=expected,
                        expected_new_strings=strings)
    except verifier.VerifyError as exc:
        baseline = {"verdict": "RED (BAD - the unmutated build does not verify)",
                    "error": str(exc)[:400]}
    shipped = out / ("worldflipper_android_release.%s.swf"
                     % {"s5": "p5", "s5b": "p5b"}.get(variant, "p4-%s" % variant))
    baseline["assembled_sha256"] = hashlib.sha256(baseline_swf.read_bytes()).hexdigest()
    if shipped.is_file():
        baseline["shipped_sha256"] = hashlib.sha256(shipped.read_bytes()).hexdigest()
        baseline["matches_shipped_swf"] = (
            baseline["assembled_sha256"] == baseline["shipped_sha256"])
    else:
        baseline["shipped_sha256"] = None
        baseline["matches_shipped_swf"] = None

    results = []
    for name in names:
        mutation_work = scratch / name
        mutate(name, mutation_work, generated, variant)
        swf = scratch / ("%s.swf" % name)
        assemble(mutation_work, swf, base_swf, bodies)
        try:
            verifier.verify(base_swf, swf, expected_bodies=expected,
                            expected_new_strings=strings)
        except verifier.VerifyError as exc:
            results.append({"mutation": name, "verdict": "RED (good)",
                            "error": str(exc)[:400]})
            continue
        results.append({"mutation": name, "verdict": "GREEN (BAD - the check is asleep)"})

    print(json.dumps({"variant": variant, "baseline": baseline, "results": results},
                     ensure_ascii=False, indent=1))
    failures = []
    alive = [r for r in results if r["verdict"].startswith("GREEN")]
    if alive:
        failures.append("%d mutation(s) survived" % len(alive))
    if not baseline["verdict"].startswith("GREEN"):
        failures.append("the unmutated build does not verify")
    if baseline["matches_shipped_swf"] is False:
        failures.append("assembled SWF != shipped SWF (this run checked other bytes)")
    if failures:
        for line in failures:
            print("[FAIL] %s" % line, file=sys.stderr)
        return 1
    print("[OK] baseline verifies, every mutation was rejected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
