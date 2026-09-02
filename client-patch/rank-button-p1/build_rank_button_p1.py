#!/usr/bin/env python3
"""Build + verify the P1 "rank button" client patch (visible, greyed out, not clickable).

Pure method-level P-code surgery on two existing CN classes.  No class is added,
no AS3 is compiled, no constant-pool entry is created.

    surgery A  pinball.scene.event.rush.top:RushEventTopScene/run
               ButtonGroupLogic id list [0..4] -> [0..5]
               + buttonGroup.get(5).set_enabled(3)      (grey, input disabled)
    surgery B  pinball.scene.event.rush.top:RushEventTopView/run
               + addWithConfig(5, getButtonLayer(3,1), buttonSize, ButtonConfigs.ranking)

Usage (PowerShell):
    $env:WF_APK_KS_PASS = "<keystore password>"
    python -X utf8 client-patch\\rank-button-p1\\build_rank_button_p1.py `
        --base-apk "C:\\Users\\...\\device_base.apk" `
        --out-dir  D:\\WF\\startpoint-cn\\out\\rank-button-p1 `
        --abcinject <dir with abcfmt.py swftags.py opwalk.py>
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

BASELINE = {
    "apk_sha256": "9b539c210a80d76856ddbdf67e426746c020e9b389f78a63771a750327608772",
    "swf_size": 29070086,
    "swf_sha256": "ab13b84852915b4e49294e0efd01fbdcd16d9f0ec6cec105804c27e68a962399",
    "signer_cert_sha256": "729507c10a893879b14f46cf81d8e5052d4b66c2c081fa5b9f915a142a827a0b",
}

METHODS = [
    {
        "method_name": "pinball.scene.event.rush.top:RushEventTopScene/run",
        "class_name": "pinball.scene.event.rush.top.RushEventTopScene",
        "code_sha256": "0b0e2a50ec6a53b98e610d9502334f5886cbc830603ec1393e7a2e38112fcc6f",
        "code_len": 746,
    },
    {
        "method_name": "pinball.scene.event.rush.top:RushEventTopView/run",
        "class_name": "pinball.scene.event.rush.top.RushEventTopView",
        "code_sha256": "75f528109af3b9e6e298f2d7724d09212ec67d6631c1410c2bfadcfd522bf79f",
        "code_len": 621,
    },
]

EXPECTED_AS3_ADDITIONS = [
    "buttonGroup = new ButtonGroupLogic(buttonClicked,[0,1,2,3,4,5]);",
    "buttonGroup.get(5).set_enabled(3);",
    "_loc4_.addWithConfig(5,_loc2_.getButtonLayer(3,1),_loc2_.buttonSize,ButtonConfigs.ranking);",
]
EXPECTED_AS3_REMOVALS = [
    "buttonGroup = new ButtonGroupLogic(buttonClicked,[0,1,2,3,4]);",
]


class BuildError(RuntimeError):
    pass


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd, *, timeout: int = 900, env=None) -> str:
    proc = subprocess.run(
        [str(c) for c in cmd], capture_output=True, text=True, errors="replace",
        timeout=timeout, check=False, env=env,
    )
    if proc.returncode != 0:
        raise BuildError(
            "command failed (%d): %s ...\nstdout:\n%s\nstderr:\n%s"
            % (proc.returncode, cmd[0], proc.stdout[-4000:], proc.stderr[-4000:])
        )
    return proc.stdout + proc.stderr


# ------------------------------------------------------------------ verify --

def deep_abc_verify(base_swf: Path, patched_swf: Path, expected_bodies, abcinject_dir: Path):
    """Structural proof that only the two target method bodies changed."""
    abcfmt = _load(abcinject_dir / "abcfmt.py", "p1_abcfmt")
    swftags = _load(abcinject_dir / "swftags.py", "p1_swftags")
    opwalk = _load(abcinject_dir / "opwalk.py", "p1_opwalk")

    def tag_list(path: Path):
        sig, ver, fl, body = swftags.load_swf(str(path))
        out = []
        for code, off, hdr, length in swftags.iter_tags(body):
            out.append((code, body[off + hdr:off + hdr + length]))
        return sig, ver, out

    sig_a, ver_a, tags_a = tag_list(base_swf)
    sig_b, ver_b, tags_b = tag_list(patched_swf)
    if (sig_a, ver_a) != (sig_b, ver_b):
        raise BuildError("SWF signature/version drifted")
    if len(tags_a) != len(tags_b):
        raise BuildError("tag count %d -> %d" % (len(tags_a), len(tags_b)))
    differing = [i for i, (a, b) in enumerate(zip(tags_a, tags_b)) if a != b]
    if len(differing) != 1:
        raise BuildError("expected exactly 1 differing tag, got %r" % (differing,))

    def main_abc(tags):
        for code, data in tags:
            if code == 82 and len(data) > 1000000:
                nul = data.index(b"\x00", 4)
                return data[4:nul].decode(), data[nul + 1:]
        raise BuildError("main DoABC2 not found")

    name_a, abc_a = main_abc(tags_a)
    name_b, abc_b = main_abc(tags_b)
    if name_a != name_b:
        raise BuildError("DoABC2 name drifted %s -> %s" % (name_a, name_b))
    A = abcfmt.ABC(abc_a)
    B = abcfmt.ABC(abc_b)
    if A.serialize() != abc_a or B.serialize() != abc_b:
        raise BuildError("ABC round-trip is not byte-exact; parser cannot vouch for the file")

    for field in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames"):
        if getattr(A, field) != getattr(B, field):
            raise BuildError("constant pool '%s' changed" % field)
    if A.methods != B.methods:
        raise BuildError("method_info table changed")

    def traits_bytes(ts):
        w = abcfmt.W()
        for t in ts:
            abcfmt.write_trait(w, t)
        return w.out()

    def inst_key(x):
        name, sup, flags, pns, ifaces, iinit, traits = x
        return (name, sup, flags, pns, tuple(ifaces), iinit, traits_bytes(traits))

    if [inst_key(x) for x in A.instances] != [inst_key(x) for x in B.instances]:
        raise BuildError("instance_info table changed")
    if [(c, traits_bytes(t)) for c, t in A.classes] != [(c, traits_bytes(t)) for c, t in B.classes]:
        raise BuildError("class_info table changed")
    if [(c, traits_bytes(t)) for c, t in A.scripts] != [(c, traits_bytes(t)) for c, t in B.scripts]:
        raise BuildError("script_info table changed")
    if len(A.bodies) != len(B.bodies):
        raise BuildError("method_body count changed")

    changed = []
    for i, (ba, bb) in enumerate(zip(A.bodies, B.bodies)):
        ka = (ba[0], ba[1], ba[2], ba[3], ba[4], ba[5], tuple(ba[6]), traits_bytes(ba[7]))
        kb = (bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], tuple(bb[6]), traits_bytes(bb[7]))
        if ka != kb:
            changed.append(i)
    if changed != sorted(expected_bodies):
        raise BuildError("changed bodies %r, expected %r" % (changed, sorted(expected_bodies)))

    def scan(code):
        starts, branches = [], []
        p, n = 0, len(code)
        while p < n:
            op = code[p]
            s = p
            p += 1
            starts.append(s)
            for f in opwalk.OPS[op]:
                if f == "u30":
                    _, p = opwalk._u30(code, p)
                elif f == "u8":
                    p += 1
                elif f == "s24":
                    v, p = opwalk._s24(code, p)
                    branches.append((s, p + v))
                elif f == "switch":
                    d, p = opwalk._s24(code, p)
                    branches.append((s, s + d))
                    cnt, p = opwalk._u30(code, p)
                    for _ in range(cnt + 1):
                        v, p = opwalk._s24(code, p)
                        branches.append((s, s + v))
        return starts, branches, n

    body_report = []
    for bi in expected_bodies:
        row = {"body_index": bi}
        for tag, abc in (("baseline", A), ("patched", B)):
            body = abc.bodies[bi]
            starts, branches, n = scan(body[5])
            offs = set(starts)
            bad = [t for _, t in branches if t not in offs and t != n]
            if bad:
                raise BuildError("body %d (%s): branch target off instruction boundary: %r"
                                 % (bi, tag, bad))
            row[tag] = {
                "maxstack": body[1], "localcount": body[2],
                "code_len": n, "instructions": len(starts),
                "branches": len(branches), "exception_ranges": len(body[6]),
            }
        for field in ("maxstack", "localcount", "branches", "exception_ranges"):
            if row["baseline"][field] != row["patched"][field]:
                raise BuildError("body %d: %s drifted" % (bi, field))
        body_report.append(row)

    return {
        "tags_total": len(tags_a),
        "tags_differing": differing,
        "doabc2_name": name_a,
        "abc_len": [len(abc_a), len(abc_b)],
        "constant_pools_identical": True,
        "tables_identical": ["method_info", "instance_info", "class_info", "script_info"],
        "changed_bodies": changed,
        "bodies": body_report,
    }


# ------------------------------------------------------------------- build --

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-apk", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, default=REPO / "out" / "rank-button-p1")
    ap.add_argument("--work-dir", type=Path, default=None)
    ap.add_argument("--ffdec", type=Path, default=REPO / "ffdec_26.2.1" / "ffdec.jar")
    ap.add_argument("--java", type=Path,
                    default=Path(r"C:\Program Files\Java\jre1.8.0_491\bin\java.exe"))
    ap.add_argument("--zipalign", type=Path,
                    default=Path(r"C:\Program Files (x86)\Android\android-sdk\build-tools\35.0.0\zipalign.exe"))
    ap.add_argument("--apksigner", type=Path,
                    default=Path(r"C:\Program Files (x86)\Android\android-sdk\build-tools\35.0.0\apksigner.bat"))
    ap.add_argument("--signer-java-home", type=Path,
                    default=Path(r"C:\Program Files\Java\jre1.8.0_491"))
    ap.add_argument("--ks", type=Path, default=REPO / "\u5f39\u56fd\u670d" / "instrument" / "wf_new.keystore")
    ap.add_argument("--ks-pass-env", default="WF_APK_KS_PASS")
    ap.add_argument("--ks-type", default="PKCS12",
                    help="wf_new.keystore is PKCS#12; Java 8 defaults to JKS, so this is explicit")
    ap.add_argument("--abcinject", type=Path, required=True,
                    help="directory holding abcfmt.py / swftags.py / opwalk.py")
    ap.add_argument("--skip-sign", action="store_true")
    args = ap.parse_args()

    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    work = (args.work_dir or (out_dir / "work")).resolve()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    report = {"schema_version": 1, "patch_id": "rank-button-p1", "steps": {}}

    # 1 -- baseline locks
    apk_hash = sha256_file(args.base_apk)
    if apk_hash != BASELINE["apk_sha256"]:
        raise BuildError("base APK sha256 mismatch: %s" % apk_hash)
    with zipfile.ZipFile(args.base_apk) as z:
        members = z.infolist()
        hit = [m for m in members if m.filename == TARGET_SWF_MEMBER]
        if len(hit) != 1:
            raise BuildError("expected exactly one %s" % TARGET_SWF_MEMBER)
        swf_bytes = z.read(TARGET_SWF_MEMBER)
    base_swf = work / "base.swf"
    base_swf.write_bytes(swf_bytes)
    swf_hash = hashlib.sha256(swf_bytes).hexdigest()
    if len(swf_bytes) != BASELINE["swf_size"] or swf_hash != BASELINE["swf_sha256"]:
        raise BuildError("baseline SWF drift: size=%d sha256=%s" % (len(swf_bytes), swf_hash))
    report["steps"]["baseline"] = {
        "apk": str(args.base_apk), "apk_sha256": apk_hash,
        "swf_size": len(swf_bytes), "swf_sha256": swf_hash,
        "apk_entries": len(members),
    }

    # 2 -- resolve method bodies and lock their bytecode
    abc_methods = _load(DUAL / "abc_methods.py", "p1_abc_methods")
    index = abc_methods.index_swf_methods(base_swf)
    for entry in METHODS:
        ref = index.require_ref(entry["method_name"])
        digest = hashlib.sha256(ref.code).hexdigest()
        if digest != entry["code_sha256"] or len(ref.code) != entry["code_len"]:
            raise BuildError("method body drift for %s: len=%d sha256=%s"
                             % (entry["method_name"], len(ref.code), digest))
        entry["body_index"] = ref.body_index
    report["steps"]["method_resolution"] = [
        {k: e[k] for k in ("method_name", "body_index", "code_sha256", "code_len")}
        for e in METHODS
    ]

    classes = ",".join(e["class_name"] for e in METHODS)
    env = dict(os.environ, JAVA_HOME=str(args.java.parent.parent))

    def ffdec_export(fmt: str, dest: Path, swf: Path):
        run([args.java, "-Xmx6g", "-jar", args.ffdec, "-air",
             "-format", "script:" + fmt, "-selectclass", classes,
             "-export", "script", dest, swf], env=env)

    # 3 -- baseline exports
    ffdec_export("pcode", work / "base-pcode", base_swf)
    ffdec_export("as", work / "base-as", base_swf)

    # 4 -- patch the method blocks
    pcode_tools = _load(DUAL / "pcode_tools.py", "p1_pcode_tools")
    prb = _load(HERE / "patch_rank_button.py", "p1_patch")
    gen_dir = work / "generated"
    gen_dir.mkdir()
    for seq, entry in enumerate(METHODS):
        rel = Path(*entry["class_name"].split("."))
        src = work / "base-pcode" / "scripts" / rel.with_suffix(".pcode")
        block = pcode_tools.extract_method_block(
            src.read_text(encoding="utf-8"), trait_kind="method", trait_name="run")
        patched = prb.patch_block(entry["method_name"], block)
        dst = gen_dir / ("%02d-%s-run.pcode" % (seq, entry["class_name"].rsplit(".", 1)[-1]))
        dst.write_text(patched, encoding="utf-8", newline="\n")
        entry["generated_pcode"] = str(dst)
        entry["baseline_block_lines"] = len(block.splitlines())
        entry["patched_block_lines"] = len(patched.splitlines())

    # 5 -- P-code replacement (FFDec assembler; no AS3 compiler involved)
    patched_swf = work / "patched.swf"
    cmd = [args.java, "-Xmx6g", "-jar", args.ffdec, "-air",
           "-replace", base_swf, patched_swf]
    for entry in METHODS:
        cmd += [entry["class_name"], entry["generated_pcode"], str(entry["body_index"])]
    run(cmd, env=env)
    if not patched_swf.is_file():
        raise BuildError("FFDec produced no output SWF")

    # 6 -- deep structural verification
    report["steps"]["abc_verification"] = deep_abc_verify(
        base_swf, patched_swf, [e["body_index"] for e in METHODS], args.abcinject.resolve())
    report["steps"]["swf"] = {
        "baseline_size": base_swf.stat().st_size,
        "patched_size": patched_swf.stat().st_size,
        "delta_bytes": patched_swf.stat().st_size - base_swf.stat().st_size,
        "patched_sha256": sha256_file(patched_swf),
    }

    # 7 -- independent re-decompile of the patched SWF
    ffdec_export("pcode", work / "final-pcode", patched_swf)
    ffdec_export("as", work / "final-as", patched_swf)
    as_diff = []
    for entry in METHODS:
        rel = Path(*entry["class_name"].split("."))
        a = (work / "base-as" / "scripts" / rel.with_suffix(".as")).read_text(encoding="utf-8").splitlines()
        b = (work / "final-as" / "scripts" / rel.with_suffix(".as")).read_text(encoding="utf-8").splitlines()
        as_diff.append({
            "class": entry["class_name"],
            "added": [ln.strip() for ln in b if ln not in a],
            "removed": [ln.strip() for ln in a if ln not in b],
        })
    flat_added = [ln for d in as_diff for ln in d["added"]]
    flat_removed = [ln for d in as_diff for ln in d["removed"]]
    if sorted(flat_added) != sorted(EXPECTED_AS3_ADDITIONS):
        raise BuildError("unexpected AS3 additions: %r" % (flat_added,))
    if sorted(flat_removed) != sorted(EXPECTED_AS3_REMOVALS):
        raise BuildError("unexpected AS3 removals: %r" % (flat_removed,))
    report["steps"]["as3_readback"] = as_diff

    # 8 -- rebuild the APK around the patched SWF
    build_apk = _load(ABYSS / "build_apk.py", "p1_build_apk")
    unsigned = work / "unsigned.apk"
    build_apk.rewrite_apk(args.base_apk, unsigned, patched_swf)
    aligned = work / "aligned.apk"
    run([args.zipalign, "-p", "-f", "4", unsigned, aligned])
    run([args.zipalign, "-c", "-p", "4", aligned])

    final_apk = out_dir / "WorldFlipper-rank-button-p1.apk"
    if args.skip_sign:
        shutil.copy2(aligned, out_dir / "WorldFlipper-rank-button-p1-UNSIGNED.apk")
        report["steps"]["signing"] = {"status": "skipped"}
    else:
        password = os.environ.get(args.ks_pass_env)
        source = "environment"
        if not password:
            # Same local credential source the author's own build script uses.
            # Never printed, never written to disk; handed to apksigner via env only.
            src = REPO / "\u5f39\u56fd\u670d" / "instrument" / "build_instrumented_apk.py"
            m = re.search(r'--ks-pass"\s*,\s*default="([^"]+)"', src.read_text(encoding="utf-8"))
            if not m:
                raise BuildError("set %s before running; no local credential source found"
                                 % args.ks_pass_env)
            password = m.group(1)
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
            "apksigner_verify": [ln for ln in verify_out.splitlines()
                                 if ln.startswith(("Verifies", "Verified using",
                                                   "Number of signers", "Signer #1 certificate"))],
        }

    # 9 -- APK entry-level diff against the base
    if final_apk.is_file():
        with zipfile.ZipFile(args.base_apk) as za, zipfile.ZipFile(final_apk) as zb:
            a = {m.filename: (m.file_size, m.CRC) for m in za.infolist()}
            b = {m.filename: (m.file_size, m.CRC) for m in zb.infolist()}
        report["steps"]["apk_diff"] = {
            "base_entries": len(a), "patched_entries": len(b),
            "only_in_base": sorted(set(a) - set(b)),
            "only_in_patched": sorted(set(b) - set(a)),
            "content_changed": sorted(k for k in set(a) & set(b) if a[k] != b[k]),
            "base_size": args.base_apk.stat().st_size,
            "patched_size": final_apk.stat().st_size,
        }
        report["artifacts"] = {
            "apk": str(final_apk),
            "apk_sha256": sha256_file(final_apk),
            "patched_swf_sha256": report["steps"]["swf"]["patched_sha256"],
        }

    (out_dir / "build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8", newline="\n")
    shutil.copy2(patched_swf, out_dir / "worldflipper_android_release.p1.swf")
    for entry in METHODS:
        shutil.copy2(entry["generated_pcode"], out_dir / Path(entry["generated_pcode"]).name)
    print(json.dumps(report["steps"], ensure_ascii=False, indent=2)[:6000])
    print("[OK] build report ->", out_dir / "build-report.json")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildError as exc:
        print("[FAIL] %s" % exc, file=sys.stderr)
        raise SystemExit(1)
