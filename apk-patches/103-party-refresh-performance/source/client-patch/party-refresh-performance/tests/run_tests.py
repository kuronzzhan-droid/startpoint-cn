"""Run the actual current AVM2 affected segment in desktop AIR, with source spies."""
import argparse
import os
import copy
import importlib.util
import json
import struct
import subprocess
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("party_perf_patch", HERE.parent / "patch_swf.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def command(args, log):
    completed = subprocess.run([str(x) for x in args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    log.write_text(completed.stdout + completed.stderr, encoding="utf-8")
    assert completed.returncode == 0, str(log)


def segment(abc, optimized):
    v = p.view(abc)
    bi, = v.by_label[p.LABEL]
    source = copy.deepcopy(abc)
    if optimized:
        p.patch_body(source)
    body = source.bodies[bi]
    rows = p.s.m.asm.decode(body[5])
    extra = len(p.guard(v)) if optimized else 0
    start, end = 90, p.AFTER + extra
    code = copy.deepcopy(rows[start:end])
    for row in code:
        if row.target is not None:
            assert start <= row.target <= end
            row.target -= start
        if row.cases is not None:
            assert all(start <= target <= end for target in [row.default, *row.cases])
            row.default -= start
            row.cases = [target-start for target in row.cases]
    setup = p.s.m.asm.assemble([("getlocal_0",), ("pushscope",), ("getlocal_1",), ("setlocal",7),
                                 ("getlocal_2",), ("setlocal",8)])
    for row in code:
        if row.target is not None: row.target += len(setup)
        if row.cases is not None:
            row.default += len(setup)
            row.cases = [target+len(setup) for target in row.cases]
    tail = p.s.m.asm.assemble([("getlocal",16),("getlocal",18),("newarray",2),("returnvalue",)])
    body[5] = p.s.m.asm.encode(setup+code+tail)[0]
    body[6] = []
    p.s.m.check_body(body,source)
    return source, bi, end-start


def run(source, work, sdk, java):
    work.mkdir(parents=True, exist_ok=True)
    compiler = [java, "-Dflexlib="+str(sdk/"frameworks"), "-Xmx512m", "-jar", sdk/"lib/mxmlc-cli.jar"]
    # Request the compiler's older Number-only ABC format explicitly.
    command([*compiler, "+configname=air", "-swf-version=32", "-target-player=21.0", "-debug=false", "-compress=false",
             "-compiler.float=false",
             "-compiler.source-path="+str(HERE), "-compiler.source-path+="+str(HERE/"fixtures"),
             "-output="+str(work/"compiled.swf"), HERE/"RuntimeHarness.as"],work/"compile.log")
    version, header, tags = p.s.parts(work/"compiled.swf")
    assert all(t[3].major==46 for t in tags if t[0]==82), "compiler did not emit requested ABC format"
    original = next(t[3] for t in p.s.parts(source)[2] if t[0]==82 and t[2][4:-1]==b"boot_ffc6")
    changes = []
    for name, optimized in (("before",False),("after",True)):
        donor, di, segment_size = segment(original,optimized)
        target, = [t for t in tags if t[0]==82 and "SegmentProbe/"+name+"|1" in p.view(t[3]).by_label]
        target_view = p.view(target[3]); ti, = target_view.by_label["SegmentProbe/"+name+"|1"]
        method_index=target[3].bodies[ti][0]
        importer=p.s.m.Importer(target_view,p.view(donor))
        target[3].bodies[ti]=importer.body(di,method_index)
        check=p.s.m.check_body(target[3].bodies[ti],target[3])
        changes.append({"method":name,"real_instructions":segment_size,"check":check})
    modified = set()
    for target in tags:
        if target[0]==82 and any(label.startswith("SegmentProbe/") for label in p.view(target[3]).by_label):
            payload=target[2]+p.s.serialize(target[3],target[4])
            target[1]=struct.pack("<HI",(82<<6)|63,len(payload))+payload
    raw=header+b"".join(t[1] for t in tags)
    (work/"RuntimeHarness.swf").write_bytes(b"CWS"+bytes([version])+struct.pack("<I",len(raw)+8)+zlib.compress(raw))
    command([sdk/"bin/adl.exe",HERE/"harness-app.xml",work],work/"runtime.log")
    report=json.loads((work/"runtime-tests.json").read_text(encoding="utf-8"))
    assert report["passed"],report
    report["actual_method_code_sha256"]=p.CODE_SHA
    report["grafted_methods"]=changes
    report["input_swf_sha256"]=p.s.sha(source.read_bytes())
    report["compiler_float"]=False
    report["compiled_abc_major"]=46
    report["compiled_abc_manually_downgraded"]=False
    (work/"verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("source",type=Path)
    parser.add_argument("work",type=Path)
    parser.add_argument("--sdk",type=Path,default=Path(os.environ.get("STARPOINT_AIR_SDK","AIRSDK_51.2.1.5")))
    parser.add_argument("--java",type=Path,default=Path(os.environ.get("STARPOINT_JAVA","java")))
    a=parser.parse_args();run(a.source,a.work,a.sdk,a.java)
