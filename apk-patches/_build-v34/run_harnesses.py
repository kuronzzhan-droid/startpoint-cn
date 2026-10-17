"""Workspace-only adapters for the exported R4 regression harnesses.

The production SWF is only read. Fixture/controller bodies are imported by the
original R4 runners. The data adapter explicitly omits absent R2/R3 controls.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import traceback
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "r4-src/client-patch"
OUTPUT = ROOT / "tests-output"
SDK = Path(r"D:\WF\_archive\kept\AIRSDK_51.1.4.1")
JAVA = Path(r"D:\WF\runtimes\android-toolchain\jdk\jdk-17.0.19+10\bin\java.exe")


def load(name, path, transform=None):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    if transform is None:
        spec.loader.exec_module(module)
    else:
        exec(compile(transform(path.read_text("utf-8")), str(path), "exec"), module.__dict__)
    return module


def setup():
    OUTPUT.mkdir(exist_ok=True)
    temp = ROOT / "temp"
    temp.mkdir(exist_ok=True)
    for name in ("TEMP", "TMP", "APPDATA", "LOCALAPPDATA"):
        target = temp if name in ("TEMP", "TMP") else OUTPUT / name.lower()
        target.mkdir(exist_ok=True)
        os.environ[name] = str(target)
    os.environ.update(PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1",
                      STARPOINT_AIR_SDK=str(SDK), STARPOINT_JAVA=str(JAVA))
    quiet = load("v34_isolated_quiet", SRC / "quiet_process.py")
    original_run = quiet.run

    def safe_run(args, **kwargs):
        args = [str(item) for item in args]
        executable = Path(args[0]).name.lower()
        if executable in ("java", "java.exe"):
            args[1:1] = ["-Duser.home=" + str(temp), "-Djava.io.tmpdir=" + str(temp)]
        return original_run(args, **kwargs)

    subprocess.run = safe_run
    return safe_run


def route_quiet_modules(module, runner, visited=None):
    visited = set() if visited is None else visited
    if id(module) in visited:
        return
    visited.add(id(module))
    if Path(getattr(module, "__file__", "")).name == "quiet_process.py":
        module.run = runner
        return
    for value in tuple(vars(module).values()):
        if isinstance(value, types.ModuleType) and str(getattr(value, "__file__", "")).startswith(str(SRC)):
            route_quiet_modules(value, runner, visited)


def data_adapter(module):
    shadow = OUTPUT / "data-fixture-source"
    shutil.copytree(SRC / "client-data-optimization/tests", shadow, dirs_exist_ok=True)
    harness = shadow / "RuntimeHarness.as"
    code = harness.read_text("utf-8")
    changes = {
        "for(var mode:int=0;mode<3;mode++)": "for(var mode:int=0;mode<2;mode++)",
        "if(mode==0)c.partyChangedBaseline(1004,2004);else if(mode==1)c.partyChangedR3(1004,2004);else c.partyChangedFixed(1004,2004);":
        "if(mode==0)c.partyChangedBaseline(1004,2004);else c.partyChangedFixed(1004,2004);",
        "counts.join(',')=='1,2,1'": "counts.join(',')=='1,1'",
        "'baseline/R3/fixed cross SET getPartyAt counts'": "'baseline/fixed cross SET getPartyAt counts; R3 unavailable'",
        "outputs[0]==outputs[1]&&outputs[1]==outputs[2]": "outputs[0]==outputs[1]",
        "r3GetPartyAtCalls:counts[1],fixedGetPartyAtCalls:counts[2]": "r3GetPartyAtCalls:null,fixedGetPartyAtCalls:counts[1]",
    }
    for before, after in changes.items():
        assert code.count(before) == 1, before
        code = code.replace(before, after)
    marker = "   var ranks:Object=DataOptimization.ranks([0,2,2,-1]);"
    assert code.count(marker) == 1
    code = code.replace(marker, """   var fallbackBefore:TableProbe=new TableProbe(keys),fallbackAfter:TableProbe=new TableProbe(keys);
   var fallbackData:Array=[{key:2,state:2},{key:2,state:2},{key:1,state:1},{key:0,state:0}];
   fallbackBefore.before(fallbackData);fallbackAfter.after(fallbackData);
   check(fallbackBefore.snapshot()==fallbackAfter.snapshot(),'actual duplicate-order fallback retains complete table output');
   check(fallbackBefore.comparatorCalls>0 && fallbackAfter.comparatorCalls==0,'actual production fallback replaces Bind comparator with ranks comparator');cases++;
""" + marker)
    harness.write_text(code, "utf-8")
    probe = shadow / "fixtures/cn/optimize/tests/TableProbe.as"
    code = probe.read_text("utf-8")
    code = code.replace("public var characterCells:", "public var comparatorCalls:int=0;public var characterCells:")
    code = code.replace("return order.indexOf(a)-order.indexOf(b);",
                        "comparatorCalls++;return order.indexOf(a)-order.indexOf(b);")
    probe.write_text(code, "utf-8")
    module.HERE = shadow


def production_ui_adapter(module, after):
    shadow = OUTPUT / "ui-fixture-source"
    for folder in ("tests", "src"):
        shutil.copytree(SRC / "client-ui-optimization" / folder,
                        shadow / folder, dirs_exist_ok=True)
    harness = shadow / "tests/RuntimeHarness.as"
    code = harness.read_text("utf-8")
    marker = " public function isFalling():Boolean{return fall>0;}"
    assert code.count(marker) == 1
    code = code.replace(marker, " public function isInLeftSideOutOfScreen(scroll:Number):Boolean{return false;}"
                        "public function isInRightSideOutOfScreen(scroll:Number):Boolean{return false;}\n" + marker)
    for variable in ("falling", "victory", "hover", "delayed", "dark", "balloon", "joinFlag"):
        declaration = "var " + variable + ":TestCell=fixed.characterCells.map.h["
        begin = code.index(declaration)
        end = code.index(";", begin)
        code = code[:end+1] + variable + ".x=1000;" + code[end+1:]
    marker = '   var visible:TestCell=fixed.characterCells.map.h[1];'
    assert code.count(marker) == 1
    code = code.replace(marker, """   var oldPending:TestTable=new TestTable(),oldVictory:TestCell=new TestCell();
   oldVictory.x=1000;oldVictory.victory=3;oldPending.add(1,oldVictory);oldPending.updateOld();
   check(oldVictory.updates==0 && oldVictory.victory==3,"actual v33 distant guard stalls non-falling victory control");
""" + marker)
    harness.write_text(code, "utf-8")
    module.HERE = shadow / "tests"
    p = module.p
    donor, = [tag[3] for tag in p.s.parts(after)[2]
              if tag[0] == 82 and p.POOL in p.view(tag[3]).by_label]
    donor_view = p.view(donor)

    def import_final(abc, label):
        target_view = p.view(abc)
        source_index, = donor_view.by_label[label]
        target_index, = target_view.by_label[label]
        old = abc.bodies[target_index]
        importer = p.s.m.Importer(target_view, donor_view)
        abc.bodies[target_index] = importer.body(source_index, old[0], scope=old[3])
        p.s.m.check_body(abc.bodies[target_index], abc)
    p.patch_body = import_final


def resource_adapter(module):
    shadow = OUTPUT / "resource-fixture-source"
    for folder in ("tests", "donor"):
        shutil.copytree(SRC / "client-resource-optimization" / folder,
                        shadow / folder, dirs_exist_ok=True)
    fixture = shadow / "tests/RuntimeHarness.as"
    code = fixture.read_text("utf-8")
    assert code.count("File.applicationStorageDirectory") == 1
    fixture.write_text(code.replace("File.applicationStorageDirectory",
                                   "new File(File.applicationDirectory.nativePath)"), "utf-8")
    module.HERE = shadow


def run_case(case, before, after, assets, destination, runner):
    entries = {
        "liveness": "party-animation-liveness/run_air_harness.py",
        "refresh": "party-refresh-performance/tests/run_tests.py",
        "refresh-static": "party-refresh-performance/tests/test_patch.py",
        "network": "client-network-optimization/run_air_tests.py",
        "ui": "client-ui-optimization/tests/run_tests.py",
        "data": "client-data-optimization/tests/run_tests.py",
        "badge": "client-data-optimization/tests/run_badge_tests.py",
        "data-refusal": "client-data-optimization/tests/test_refusal.py",
        "resource": "client-resource-optimization/run_air_harness.py",
    }
    path = SRC / entries[case]
    sys.path.insert(0, str(path.parent))
    transform = None
    if case == "data":
        def transform(code):
            line = "    assert old_optimized is not None and r3 is not None,'R2 G1002 and R3 duplicate-translation controls are required'"
            assert code.count(line) == 1
            return code.replace(line, "    # Historical binaries unavailable; final semantic checks retained.")
    elif case == "ui":
        def transform(code):
            marker = "  ('pinball.scene.character.cell::CharacterCell/isFalling|1','TestCell/isFalling|1',False),"
            assert code.count(marker) == 1
            return code.replace(marker, marker + "\n" + "\n".join(
                "  ('pinball.scene.character.cell::CharacterCell/" + name + "|1','TestCell/" + name + "|1',False),"
                for name in ("isInLeftSideOutOfScreen", "isInRightSideOutOfScreen")))
    module = load("v34_harness_" + case.replace("-", "_"), path, transform)
    route_quiet_modules(module, runner)
    if case in ("liveness", "network"):
        return module.run(destination, after)
    if case == "refresh":
        return module.run(before, destination, SDK, JAVA)
    if case == "refresh-static":
        destination.mkdir(exist_ok=False)
        module.SOURCE, module.WORK = before, destination
        result = unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(module.PatchChecks))
        assert result.wasSuccessful()
        return {"passed": True, "tests": result.testsRun}
    if case == "data-refusal":
        return module.run(before, after)
    if case == "data":
        data_adapter(module)
        return module.run(before, after, destination, None, None)
    if case == "ui":
        production_ui_adapter(module, after)
        return module.run(before, destination)
    if case == "badge":
        return module.run(before, after, destination)
    if case == "resource":
        resource_adapter(module)
        return module.run(destination, after, assets)
    raise AssertionError(case)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("case")
    parser.add_argument("--before", type=Path, default=ROOT / "inputs/v33.swf")
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--assets", type=Path, default=ROOT / "work/resource-assets")
    parser.add_argument("--name")
    args = parser.parse_args()
    runner = setup()
    name = args.name or args.case
    destination = OUTPUT / name
    log = io.StringIO()
    report = {"case": args.case, "sdk": str(SDK), "sdk_version": "51.1.4.1",
              "r4_documented_sdk_version": "51.2.1.5", "desktop_air_only": True,
              "before": str(args.before), "after": str(args.after)}
    try:
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            result = run_case(args.case, args.before, args.after, args.assets, destination, runner)
        report.update(passed=True, result=result)
    except Exception as error:
        traceback.print_exc(file=log)
        report.update(passed=False, error=type(error).__name__ + ": " + str(error))
    report["log"] = str(OUTPUT / (name + ".log"))
    if args.case == "data":
        report["historical_controls"] = {"R2": "not run: local binary unavailable",
                                         "R3": "not run: local binary unavailable"}
        report["fixture_adaptation"] = "baseline/final translation comparison; all final semantic assertions retained"
    if args.case == "ui":
        report["fixture_adaptation"] = "optimized controllers imported directly from final production SWF"
    if args.case == "resource":
        report["fixture_adaptation"] = "only fixture file path changed from applicationStorageDirectory to applicationDirectory"
    Path(report["log"]).write_text(log.getvalue(), "utf-8")
    (OUTPUT / (name + ".json")).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "result"}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
