#!/usr/bin/env python3
"""Build + verify the P2 "rank scene" client patch.

P2 turns the P1 crown button from *visible but dead* into *a button that opens a
full-screen scrollable leaderboard*.  It is built **on top of the P1 APK**, not
on device_base.apk, so the five-in-one patch stack the author actually runs
(re-point / sdkDummy / render-scale / ... / P1 rank button) stays intact.

    baseline   out/rank-button-p1/WorldFlipper-rank-button-p1.apk
               (itself built on device_base.apk, which is the five-in-one build)

    surgery A2'  RushEventTopScene/run              set_enabled(3) -> set_enabled(1)
    surgery C    RushEventTopScene/buttonClicked    lookupswitch 5 -> 6 cases,
                                                    new block calls
                                                    changeSceneWithLoading(
                                                        LoadingTaskKind.TermsOfService,
                                                        ChangeSceneBackKind.AddCurrent)
    surgery D    TermsOfServiceLoadingTask/toolAgreementRemoteInput
                                                    title key 服务条款 -> 综合排名

Server side: `POST /api/index.php/tool/agreement` (src/routes/cn/tool.ts) answers
with `data.terms_text` = the leaderboard rich text.

Usage (PowerShell):
    $env:WF_APK_KS_PASS = "<keystore password>"
    python -X utf8 client-patch\\rank-scene-p2\\build_rank_scene_p2.py `
        --base-apk D:\\WF\\startpoint-cn\\out\\rank-button-p1\\WorldFlipper-rank-button-p1.apk `
        --device-base "C:\\Users\\...\\device_base.apk" `
        --out-dir  D:\\WF\\startpoint-cn\\out\\rank-scene-p2
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
DUAL = REPO / "client-patch" / "dual-form-v1"
ABYSS = REPO / "client-patch" / "abyss-mode-equipment"

TARGET_SWF_MEMBER = "assets/worldflipper_android_release.swf"

# The P1 artifact this patch continues from.  Locked so a stale or foreign base
# fails the build instead of producing a package that silently reverts P1.
BASELINE = {
    "apk_sha256": "f58379a1289213b9973734e14f79567226ab97754eda4bdfb41d3bad7f74e233",
    "swf_size": 29070146,
    "swf_sha256": "78db404c4e4a56cdd1274d2232038aa1a176a4d85b2cda298fd9852988b72fc4",
    "signer_cert_sha256": "729507c10a893879b14f46cf81d8e5052d4b66c2c081fa5b9f915a142a827a0b",
}

# device_base.apk — the five-in-one build the author runs.  Only used to prove
# the chain device_base -> P1 -> P2 by entry-level diff; never patched directly.
DEVICE_BASE = {
    "apk_sha256": "9b539c210a80d76856ddbdf67e426746c020e9b389f78a63771a750327608772",
    "swf_sha256": "ab13b84852915b4e49294e0efd01fbdcd16d9f0ec6cec105804c27e68a962399",
}

METHODS = [
    {
        "method_name": "pinball.scene.event.rush.top:RushEventTopScene/run",
        "class_name": "pinball.scene.event.rush.top.RushEventTopScene",
        "trait_name": "run",
        "code_sha256": "90d201d52a3388ed162ada9413e130291bd542890fbaf2306559b0fa89615d94",
        "code_len": 773,
    },
    {
        "method_name": "pinball.scene.event.rush.top:RushEventTopScene/buttonClicked",
        "class_name": "pinball.scene.event.rush.top.RushEventTopScene",
        "trait_name": "buttonClicked",
        "code_sha256": "acf6e48d6224486feeb90f78f7744c4add884b56b693a20558e83b44c2e7df2f",
        "code_len": 395,
    },
    {
        "method_name": "pinball.loading.termsOfService:TermsOfServiceLoadingTask/toolAgreementRemoteInput",
        "class_name": "pinball.loading.termsOfService.TermsOfServiceLoadingTask",
        "trait_name": "toolAgreementRemoteInput",
        "code_sha256": "f76196523f500faef9b0f045159e925c8a3e463dedc09a1c76e9683bf833fab9",
        "code_len": 66,
    },
]

# Surgery D is the only edit that touches the constant pool.
EXPECTED_NEW_STRINGS = ["ranking_ranking_tab_total_ranking"]

# The seven instructions of the new basic block, in order.
NEW_BLOCK_MNEMONICS = ["findproperty", "getlex", "getproperty", "getlex",
                       "getproperty", "callpropvoid", "returnvoid"]

# What the AS3 read-back must / must not say once FFDec re-decompiles the result.
AS3_MUST_APPEAR = {
    "pinball.scene.event.rush.top.RushEventTopScene": [
        "buttonGroup.get(5).set_enabled(1);",
        "changeSceneWithLoading(LoadingTaskKind.TermsOfService,ChangeSceneBackKind.AddCurrent);",
        "case 5:",
    ],
    "pinball.loading.termsOfService.TermsOfServiceLoadingTask": [
        '"ranking_ranking_tab_total_ranking"',
    ],
}
AS3_MUST_VANISH = {
    "pinball.scene.event.rush.top.RushEventTopScene": [
        "buttonGroup.get(5).set_enabled(3);",
    ],
    "pinball.loading.termsOfService.TermsOfServiceLoadingTask": [
        '"title_name_terms"',
    ],
}


class BuildError(RuntimeError):
    pass


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(cmd, *, timeout: int = 900, env=None) -> str:
    proc = subprocess.run(
        [str(part) for part in cmd], capture_output=True, text=True, errors="replace",
        timeout=timeout, check=False, env=env,
    )
    if proc.returncode != 0:
        raise BuildError(
            "command failed (%d): %s ...\nstdout:\n%s\nstderr:\n%s"
            % (proc.returncode, cmd[0], proc.stdout[-4000:], proc.stderr[-4000:])
        )
    return proc.stdout + proc.stderr


def expected_edit_scripts(bodies: dict[str, int]) -> dict[int, list]:
    """The exact difflib edit script each changed body must produce.

    Written out longhand rather than derived, so that a surgery that quietly does
    something extra (an operand nudged, a branch re-routed) fails the build.
    """
    run_body = bodies["run"]
    click_body = bodies["buttonClicked"]
    terms_body = bodies["toolAgreementRemoteInput"]
    return {
        # A2': one operand, nothing else.
        run_body: [("replace", ["pushbyte 3"], ["pushbyte 1"])],
        # C: the switch line gains a seventh arm, and seven instructions are
        # appended at the very end.  Both hunks are spelled out; any third hunk
        # (which is what a hijacked jump would look like) fails.
        click_body: [
            ("replace",
             ["lookupswitch default=#7 cases=[#8,#41,#54,#74,#75]"],
             ["lookupswitch default=#7 cases=[#8,#41,#54,#74,#75,#110]"]),
            ("insert", [], [
                "findproperty ::changeSceneWithLoading",
                "getlex pinball.common.data.scene::LoadingTaskKind",
                "getproperty ::TermsOfService",
                "getlex pinball.common.data.scene::ChangeSceneBackKind",
                "getproperty ::AddCurrent",
                "callpropvoid ::changeSceneWithLoading, 2",
                "returnvoid",
            ]),
        ],
        # D: one string literal.
        terms_body: [("replace",
                      ['pushstring "title_name_terms"'],
                      ['pushstring "ranking_ranking_tab_total_ranking"'])],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-apk", type=Path,
                        default=REPO / "out" / "rank-button-p1" / "WorldFlipper-rank-button-p1.apk")
    parser.add_argument("--device-base", type=Path,
                        default=Path(r"C:\Users\12101\Documents\MuMu共享文件夹\device_base.apk"))
    parser.add_argument("--out-dir", type=Path, default=REPO / "out" / "rank-scene-p2")
    parser.add_argument("--work-dir", type=Path, default=None)
    parser.add_argument("--ffdec", type=Path, default=REPO / "ffdec_26.2.1" / "ffdec.jar")
    parser.add_argument("--java", type=Path,
                        default=Path(r"C:\Program Files\Java\jre1.8.0_491\bin\java.exe"))
    parser.add_argument("--zipalign", type=Path,
                        default=Path(r"C:\Program Files (x86)\Android\android-sdk\build-tools\35.0.0\zipalign.exe"))
    parser.add_argument("--apksigner", type=Path,
                        default=Path(r"C:\Program Files (x86)\Android\android-sdk\build-tools\35.0.0\apksigner.bat"))
    parser.add_argument("--signer-java-home", type=Path,
                        default=Path(r"C:\Program Files\Java\jre1.8.0_491"))
    parser.add_argument("--ks", type=Path,
                        default=REPO / "\u5f39\u56fd\u670d" / "instrument" / "wf_new.keystore")
    parser.add_argument("--ks-pass-env", default="WF_APK_KS_PASS")
    parser.add_argument("--ks-type", default="PKCS12")
    parser.add_argument("--skip-sign", action="store_true")
    args = parser.parse_args()

    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    work = (args.work_dir or (out_dir / "work")).resolve()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    report: dict = {"schema_version": 1, "patch_id": "rank-scene-p2",
                    "continues": "rank-button-p1", "steps": {}}

    # 0 -- title-key invariant, checked before any work ----------------------
    # Surgery D swaps the page-title ui_string key.  A key that is missing from
    # the CN master table does not degrade gracefully: MasterBinaryMap.getIndex
    # calls FileUtilCommon.deleteFile on the master file and then throws
    # ClientError 8601.  Prove the key resolves before building anything.
    title_guard = _load(HERE / "check_title_ui_string_key.py", "p2_title_key")
    try:
        report["steps"]["title_ui_string_key"] = (
            title_guard.assert_title_keys_shippable(verbose=False))
    except title_guard.TitleKeyError as exc:
        raise BuildError("surgery D title key is not shippable: %s" % exc)

    # 1 -- baseline locks (P1 artifact) -------------------------------------
    apk_hash = sha256_file(args.base_apk)
    if apk_hash != BASELINE["apk_sha256"]:
        raise BuildError("base APK is not the P1 artifact: sha256 %s" % apk_hash)
    with zipfile.ZipFile(args.base_apk) as archive:
        members = archive.infolist()
        hit = [m for m in members if m.filename == TARGET_SWF_MEMBER]
        if len(hit) != 1:
            raise BuildError("expected exactly one %s" % TARGET_SWF_MEMBER)
        swf_bytes = archive.read(TARGET_SWF_MEMBER)
    base_swf = work / "base.swf"
    base_swf.write_bytes(swf_bytes)
    swf_hash = hashlib.sha256(swf_bytes).hexdigest()
    if len(swf_bytes) != BASELINE["swf_size"] or swf_hash != BASELINE["swf_sha256"]:
        raise BuildError("P1 SWF drift: size=%d sha256=%s" % (len(swf_bytes), swf_hash))
    report["steps"]["baseline"] = {
        "apk": str(args.base_apk), "apk_sha256": apk_hash,
        "swf_size": len(swf_bytes), "swf_sha256": swf_hash,
        "apk_entries": len(members),
    }

    # 1b -- prove the P1 base really descends from the author's device build --
    if args.device_base.is_file():
        device_hash = sha256_file(args.device_base)
        with zipfile.ZipFile(args.device_base) as archive:
            device_swf = archive.read(TARGET_SWF_MEMBER)
        report["steps"]["device_base"] = {
            "apk": str(args.device_base),
            "apk_sha256": device_hash,
            "apk_sha256_matches": device_hash == DEVICE_BASE["apk_sha256"],
            "swf_sha256": hashlib.sha256(device_swf).hexdigest(),
            "swf_sha256_matches":
                hashlib.sha256(device_swf).hexdigest() == DEVICE_BASE["swf_sha256"],
        }
        if not report["steps"]["device_base"]["apk_sha256_matches"]:
            raise BuildError("device_base.apk drifted; refusing to build on an unknown chain")
        # the three pre-existing patches must still be in the SWF we inherit
        markers = {
            "repoint_192.168.0.130:8001": b"192.168.0.130:8001",
            "sdkDummy": b"sdkDummy",
            "render_scale_div6": b"scale",
        }
        report["steps"]["device_base"]["inherited_markers"] = {
            name: swf_bytes.count(needle) for name, needle in markers.items()
        }
        if swf_bytes.count(b"192.168.0.130:8001") < 1 or swf_bytes.count(b"sdkDummy") < 1:
            raise BuildError("the P1 SWF has lost the re-point / sdkDummy patches")
    else:
        report["steps"]["device_base"] = {"status": "not available on this machine"}

    # 2 -- resolve method bodies and lock their bytecode ---------------------
    abc_methods = _load(DUAL / "abc_methods.py", "p2_abc_methods")
    index = abc_methods.index_swf_methods(base_swf)
    for entry in METHODS:
        ref = index.require_ref(entry["method_name"])
        digest = hashlib.sha256(ref.code).hexdigest()
        if digest != entry["code_sha256"] or len(ref.code) != entry["code_len"]:
            raise BuildError("method body drift for %s: len=%d sha256=%s"
                             % (entry["method_name"], len(ref.code), digest))
        entry["body_index"] = ref.body_index
    report["steps"]["method_resolution"] = [
        {key: entry[key] for key in ("method_name", "body_index", "code_sha256", "code_len")}
        for entry in METHODS
    ]

    classes = ",".join(sorted({entry["class_name"] for entry in METHODS}))
    env = dict(os.environ, JAVA_HOME=str(args.java.parent.parent))

    def ffdec_export(fmt: str, dest: Path, swf: Path):
        run([args.java, "-Xmx6g", "-jar", args.ffdec, "-air",
             "-format", "script:" + fmt, "-selectclass", classes,
             "-export", "script", dest, swf], env=env)

    # 3 -- baseline exports (evidence) --------------------------------------
    ffdec_export("pcode", work / "base-pcode", base_swf)
    ffdec_export("as", work / "base-as", base_swf)

    # 4 -- patch the method blocks ------------------------------------------
    pcode_tools = _load(DUAL / "pcode_tools.py", "p2_pcode_tools")
    patcher = _load(HERE / "patch_rank_scene.py", "p2_patch")
    generated = work / "generated"
    generated.mkdir()
    for seq, entry in enumerate(METHODS):
        relative = Path(*entry["class_name"].split("."))
        source = work / "base-pcode" / "scripts" / relative.with_suffix(".pcode")
        block = pcode_tools.extract_method_block(
            source.read_text(encoding="utf-8"),
            trait_kind="method", trait_name=entry["trait_name"])
        patched = patcher.patch_block(entry["method_name"], block)
        destination = generated / ("%02d-%s-%s.pcode" % (
            seq, entry["class_name"].rsplit(".", 1)[-1], entry["trait_name"]))
        destination.write_text(patched, encoding="utf-8", newline="\n")
        entry["generated_pcode"] = str(destination)
        entry["baseline_block_lines"] = len(block.splitlines())
        entry["patched_block_lines"] = len(patched.splitlines())

    # 5 -- P-code replacement (FFDec assembler; no AS3 compiler involved) -----
    patched_swf = work / "patched.swf"
    command = [args.java, "-Xmx6g", "-jar", args.ffdec, "-air",
               "-replace", base_swf, patched_swf]
    for entry in METHODS:
        command += [entry["class_name"], entry["generated_pcode"], str(entry["body_index"])]
    run(command, env=env)
    if not patched_swf.is_file():
        raise BuildError("FFDec produced no output SWF")

    # 6 -- independent structural verification -------------------------------
    verifier = _load(HERE / "verify_rank_scene_p2.py", "p2_verify")
    body_of = {entry["trait_name"]: entry["body_index"] for entry in METHODS}
    click_body = body_of["buttonClicked"]
    report["steps"]["independent_verification"] = verifier.verify(
        base_swf, patched_swf,
        expected_bodies=expected_edit_scripts(body_of),
        expected_new_strings=EXPECTED_NEW_STRINGS,
        switch_body=click_body,
        switch_case_count=6,
        new_block_mnemonics=NEW_BLOCK_MNEMONICS,
    )
    report["steps"]["swf"] = {
        "baseline_size": base_swf.stat().st_size,
        "patched_size": patched_swf.stat().st_size,
        "delta_bytes": patched_swf.stat().st_size - base_swf.stat().st_size,
        "patched_sha256": sha256_file(patched_swf),
    }

    # 7 -- independent re-decompile of the patched SWF ------------------------
    ffdec_export("pcode", work / "final-pcode", patched_swf)
    ffdec_export("as", work / "final-as", patched_swf)
    as_diff = []
    for class_name in sorted({entry["class_name"] for entry in METHODS}):
        relative = Path(*class_name.split("."))
        before = (work / "base-as" / "scripts" / relative.with_suffix(".as")
                  ).read_text(encoding="utf-8")
        after = (work / "final-as" / "scripts" / relative.with_suffix(".as")
                 ).read_text(encoding="utf-8")
        before_lines, after_lines = before.splitlines(), after.splitlines()
        for needle in AS3_MUST_APPEAR.get(class_name, []):
            if needle.replace(" ", "") not in after.replace(" ", ""):
                raise BuildError("%s: patched AS3 is missing %r" % (class_name, needle))
        for needle in AS3_MUST_VANISH.get(class_name, []):
            if needle.replace(" ", "") in after.replace(" ", ""):
                raise BuildError("%s: patched AS3 still contains %r" % (class_name, needle))
        as_diff.append({
            "class": class_name,
            "added": [line.strip() for line in after_lines if line not in before_lines],
            "removed": [line.strip() for line in before_lines if line not in after_lines],
        })
    report["steps"]["as3_readback"] = as_diff

    # 8 -- rebuild the APK around the patched SWF -----------------------------
    build_apk = _load(ABYSS / "build_apk.py", "p2_build_apk")
    unsigned = work / "unsigned.apk"
    build_apk.rewrite_apk(args.base_apk, unsigned, patched_swf)
    aligned = work / "aligned.apk"
    run([args.zipalign, "-p", "-f", "4", unsigned, aligned])
    run([args.zipalign, "-c", "-p", "4", aligned])

    final_apk = out_dir / "WorldFlipper-rank-scene-p2.apk"
    if args.skip_sign:
        shutil.copy2(aligned, out_dir / "WorldFlipper-rank-scene-p2-UNSIGNED.apk")
        report["steps"]["signing"] = {"status": "skipped"}
    else:
        password = os.environ.get(args.ks_pass_env)
        source = "environment"
        if not password:
            # Same local credential source the author's own build script uses.
            # Never printed, never written to disk; handed to apksigner via env only.
            script = REPO / "\u5f39\u56fd\u670d" / "instrument" / "build_instrumented_apk.py"
            match = re.search(r'--ks-pass"\s*,\s*default="([^"]+)"',
                              script.read_text(encoding="utf-8"))
            if not match:
                raise BuildError("set %s before running; no local credential source found"
                                 % args.ks_pass_env)
            password = match.group(1)
            source = "project-local build_instrumented_apk.py default"
        sign_env = dict(os.environ)
        sign_env[args.ks_pass_env] = password
        sign_env["JAVA_HOME"] = str(args.signer_java_home)
        sign_env["PATH"] = str(args.signer_java_home / "bin") + os.pathsep + sign_env.get("PATH", "")
        signed = work / "signed.apk"
        run([args.apksigner, "sign",
             "--ks", args.ks, "--ks-type", args.ks_type,
             "--ks-pass", "env:" + args.ks_pass_env,
             "--out", signed, aligned], env=sign_env)
        verify_out = run([args.apksigner, "verify", "--verbose", "--print-certs", signed],
                         env=sign_env)
        cert = re.search(r"Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})", verify_out)
        if not cert:
            raise BuildError("could not read signer certificate from apksigner output")
        if cert.group(1) != BASELINE["signer_cert_sha256"]:
            raise BuildError("signer certificate mismatch: %s != %s"
                             % (cert.group(1), BASELINE["signer_cert_sha256"]))
        shutil.copy2(signed, final_apk)
        report["steps"]["signing"] = {
            "status": "verified",
            "keystore": str(args.ks),
            "password_source": source,
            "signer_cert_sha256": cert.group(1),
            "device_base_cert_sha256": BASELINE["signer_cert_sha256"],
            "matches_device_base": True,
            "apksigner_verify": [line for line in verify_out.splitlines()
                                 if line.startswith(("Verifies", "Verified using",
                                                     "Number of signers", "Signer #1 certificate"))],
        }

    # 9 -- APK entry-level diffs ---------------------------------------------
    if final_apk.is_file():
        def entries(path: Path):
            with zipfile.ZipFile(path) as archive:
                return {m.filename: (m.file_size, m.CRC) for m in archive.infolist()}

        patched_entries = entries(final_apk)
        diffs = {}
        for label, other in (("vs_p1", args.base_apk),
                             ("vs_device_base", args.device_base)):
            if not Path(other).is_file():
                diffs[label] = {"status": "not available"}
                continue
            base_entries = entries(Path(other))
            diffs[label] = {
                "base_entries": len(base_entries),
                "patched_entries": len(patched_entries),
                "only_in_base": sorted(set(base_entries) - set(patched_entries)),
                "only_in_patched": sorted(set(patched_entries) - set(base_entries)),
                "content_changed": sorted(k for k in set(base_entries) & set(patched_entries)
                                          if base_entries[k] != patched_entries[k]),
            }
        report["steps"]["apk_diff"] = diffs
        report["steps"]["apk_diff"]["patched_size"] = final_apk.stat().st_size
        report["artifacts"] = {
            "apk": str(final_apk),
            "apk_sha256": sha256_file(final_apk),
            "patched_swf_sha256": report["steps"]["swf"]["patched_sha256"],
        }

    (out_dir / "build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8", newline="\n")
    shutil.copy2(patched_swf, out_dir / "worldflipper_android_release.p2.swf")
    for entry in METHODS:
        shutil.copy2(entry["generated_pcode"], out_dir / Path(entry["generated_pcode"]).name)
    print(json.dumps(report["steps"], ensure_ascii=False, indent=2)[:9000])
    print("[OK] build report ->", out_dir / "build-report.json")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildError as exc:
        print("[FAIL] %s" % exc, file=sys.stderr)
        raise SystemExit(1)
