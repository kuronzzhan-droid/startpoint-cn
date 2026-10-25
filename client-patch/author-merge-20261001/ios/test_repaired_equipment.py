"""Execute generator-candidate helpers in bounded Windows AIR fixtures.

Always wrap this entire command in client-background/run_background.py.
Reference sources and stage-09 artifacts are read only. Imported helper code
is never edited here; only the established fixture namespace/scope adapters
and exact-signature recording dependencies are reused.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import types

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
CLIENT = HERE.parents[1]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def json_form(value):
    return json.loads(json.dumps(value))


def run(command, cwd, log):
    command = [str(value) for value in command]
    result = subprocess.run(command, cwd=cwd, capture_output=True, timeout=90)
    log.write_bytes(result.stdout + b"\n" + result.stderr)
    if result.returncode:
        raise RuntimeError(("command failed", result.returncode, str(log)))
    return {"command": command, "cwd": str(cwd), "exit_code": result.returncode,
            "log": str(log), "log_sha256": sha(log.read_bytes())}


def verify_prior(root, core, preload, original, original_sha):
    """Recheck saved source/artifact bindings without rerunning old AIR cases."""
    receipts, reports = {}, {}
    for label, module, variants in (("core", core, ("current-exact", "single-store-control")),
                                    ("preload", preload, ("current-exact", "preload-stores-only-control", "all-seven-stores-control"))):
        folder = root / "batches/09-equipment-behavior" / label
        report_path = folder / "report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        assert report["source_full_abc_sha256"] == original_sha
        current_source = Path(module.__file__).read_bytes()
        # Old scripts are evidence only: never import or execute a private source.
        snapshot = folder / "executed-script.py"
        if not snapshot.exists():
            snapshot = root / "tools" / ("test_equipment_" + label + ".py")
        snapshot_bytes = snapshot.read_bytes()
        assert report["test_script_sha256"] == sha(snapshot_bytes), "executed source identity changed"
        def definitions(data):
            result = {}
            for node in ast.parse(data.decode("utf-8")).body:
                if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                    result[node.name] = ast.dump(node, include_attributes=False)
                elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                    if node.targets[0].id not in {"SDK", "JAVA", "OUT"}:
                        result[node.targets[0].id] = ast.dump(node, include_attributes=False)
            return result
        retained = definitions(current_source)
        historical = definitions(snapshot_bytes)
        assert retained and all(historical.get(name) == value for name, value in retained.items()), "retained fixture definitions changed"
        source_receipt = {"current_tool_sha256": sha(current_source), "executed_snapshot": str(snapshot),
                          "executed_snapshot_sha256": sha(snapshot_bytes),
                          "retained_definitions_AST_identical": sorted(retained),
                          "historical_source_executed": False}
        compiler = json.loads((folder / "compile-receipt.json").read_text(encoding="utf-8"))
        assert compiler == report["compiler"]
        assert sha((folder / "fixture-template.swf").read_bytes()) == compiler["artifact_sha256"]
        for name, digest in compiler["sources"].items():
            assert sha((folder / "fixture-src" / name).read_bytes()) == digest
        variants_receipt = {}
        for variant in variants:
            swf = folder / (variant + ".swf")
            observed = folder / (variant + "-observations.json")
            expected = report["observations"][variant]
            assert sha(swf.read_bytes()) == expected["swf_sha256"]
            assert sha(observed.read_bytes()) == expected["observations_sha256"]
            assert json.loads(observed.read_text(encoding="utf-8"))["cases"] == expected["cases"]
            parsed = core.parse_swf(swf)[-1]
            if label == "core":
                binding = core.bind_methods(parsed, original, variant)
                assert json_form(core.dependency_signatures(parsed, original)) == report["dependency_signatures"][variant]
            else:
                edits = {row["source_method"]: row["differences"] for row in report["imports"][variant]}
                binding = preload.bind(parsed, original, edits)
            assert json_form(binding) == report["imports"][variant]
            variants_receipt[variant] = {"swf": str(swf), "swf_sha256": expected["swf_sha256"],
                                         "observations": str(observed), "observations_sha256": expected["observations_sha256"],
                                         "saved_method_bindings_rechecked": len(binding)}
        receipts[label] = {"report": str(report_path), "report_sha256": sha(report_path.read_bytes()),
                           "test_script": str(Path(module.__file__)), "test_script_sha256": report["test_script_sha256"],
                           "source_fingerprints_checked": len(compiler["sources"]), "source_identity": source_receipt,
                           "variants": variants_receipt}
        reports[label] = report
        print("Prior " + label + " source, saved SWF, signatures and observations verified", flush=True)
    return receipts, reports


def compile_fixture(folder, sources, core):
    folder.mkdir(parents=True, exist_ok=True)
    fingerprints = {}
    for name, source in sources.items():
        path = folder / "fixture-src" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
        fingerprints[name] = sha(path.read_bytes())
    template = folder / "fixture-template.swf"
    command = [core.JAVA, "-Xmx1g", "-Dflexlib=" + str(core.SDK / "frameworks"),
               "-jar", core.SDK / "lib/mxmlc-cli.jar", "+configname=air", "-swf-version=44",
               "-target-player=32.0", "-compiler.float=false", "-compress=false", "-debug=false",
               "-compiler.source-path=" + str(folder / "fixture-src"), "-output=" + str(template),
               folder / "fixture-src/Probe.as"]
    receipt_path = folder / "compile-receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else None
    if not (receipt and receipt["sources"] == fingerprints and receipt["command"] == [str(x) for x in command]
            and template.exists() and sha(template.read_bytes()) == receipt["artifact_sha256"]):
        receipt = {**run(command, folder, folder / "compile.log"), "sources": fingerprints,
                   "artifact_sha256": sha(template.read_bytes())}
        save(receipt_path, receipt)
    return template, receipt


def execute_fixture(label, folder, candidate, core, preload):
    output = folder / "observations.json"
    if output.exists() or (folder / "generator-candidate-observations.json").exists():
        raise RuntimeError(("preserve existing candidate observations", str(folder)))
    specs = core.make_cases() if label == "core" else preload.cases()
    text = core.sources(output, specs) if label == "core" else preload.sources(output, specs)
    template_path, compiler = compile_fixture(folder, text, core)
    version, body, (_, at, header, size), payload, end, template = core.parse_swf(template_path)
    if label == "core":
        target = core.patch_template(template, candidate, "current-exact")
        edits = None
    else:
        target, edits = preload.patch(template, candidate, "current-exact")
        assert all(not differences for differences in edits.values()), "candidate helper code was edited"
    new_payload = payload[:end + 1] + target.serialize()
    tag = struct.pack("<HI", (82 << 6) | 63, len(new_payload)) + new_payload
    rebuilt = body[:at] + tag + body[at + header + size:]
    swf = folder / "generator-candidate.swf"
    swf.write_bytes(b"FWS" + bytes([version]) + struct.pack("<I", len(rebuilt) + 8) + rebuilt)
    parsed = core.parse_swf(swf)[-1]
    if label == "core":
        bindings = core.bind_methods(parsed, candidate, "current-exact")
    else:
        bindings = preload.bind(parsed, candidate, edits)
    assert all(not row["differences"] for row in bindings), "saved SWF differs from candidate instructions"
    dependencies = core.dependency_signatures(parsed, candidate)
    save(folder / "saved-swf-bindings.json", {"variant": "generator-candidate", "methods": bindings,
                                             "dependencies": dependencies, "store_edits_in_fixture": 0})
    xml = folder / "generator-candidate.xml"
    xml.write_text('<application xmlns="http://ns.adobe.com/air/application/51.2"><id>cn.equipment.generator.'
                   + label + '</id><versionNumber>1.0.0</versionNumber><filename>equipmentcandidate</filename>'
                   '<initialWindow><content>' + swf.name + '</content><visible>false</visible></initialWindow></application>', encoding="utf-8")
    execution = run([core.SDK / "bin/adl64.exe", xml], folder, folder / "generator-candidate-adl.log")
    if not output.exists():
        raise RuntimeError(("AIR exited without observations", str(folder)))
    raw = output.read_bytes()
    observed = json.loads(raw)
    assert len(observed["cases"]) == len(specs)
    assert [row["input"] for row in observed["cases"]] == specs
    destination = folder / "generator-candidate-observations.json"
    output.rename(destination)
    return {"variant": "generator-candidate", "compiler": compiler, "execution": execution,
            "swf": str(swf), "swf_sha256": sha(swf.read_bytes()), "observations_file": str(destination),
            "observations_sha256": sha(raw), "imports": bindings, "dependency_signatures": dependencies,
            "store_edits_in_fixture": 0, **observed}


def validate_core(observed, reference, core):
    captured = {}
    def capture(_path, value):
        captured.update(value)
    # Reuse the previous corrected-count design oracle without calling its
    # stage-09 save function or presenting this candidate as a fixture edit.
    oracle = types.FunctionType(core.validate.__code__, {**core.__dict__, "save": capture}, "candidate_core_oracle")
    summary = oracle({"single-store-control": observed})
    checks = [{**row, "variant": "generator-candidate"} for row in captured["checks"]]
    previous = {row["name"]: row for row in reference["observations"]["single-store-control"]["cases"]}
    original = {row["name"]: row for row in reference["observations"]["current-exact"]["cases"]}
    assert all(row == previous[row["name"]] for row in observed["cases"]), "candidate differs from previously validated corrected design observations"
    normal = [row for row in observed["cases"] if row["input"]["category"] != "failure"]
    failures = [row for row in observed["cases"] if row["input"]["category"] == "failure"]
    assert len(normal) == 92 and len(failures) == 4
    return {**summary, "variant": "generator-candidate", "normal_cases": len(normal), "normal_design_matches": len(normal),
            "expected_error_cases": len(failures), "expected_errors_matched": len(failures),
            "all_observations_equal_saved_corrected_oracle": True,
            "prior_current_normal_design_matches": reference["design_conformance"]["current_design_matches"],
            "changed_cases_vs_prior_current": [row["name"] for row in observed["cases"] if row != original[row["name"]]],
            "checks": checks}


def validate_preload(observed, reference, preload):
    checks = []
    for row in observed["cases"]:
        spec = row["input"]
        wanted = preload.expected_registrations(spec)
        if spec["throwTable"]:
            ok = not row["returned"] and "fixture table failure" in row.get("error", "") and not row["registrations"]
        else:
            ok = row["returned"] and [(call["tierId"], call["part"]) for call in row["registrations"]] == wanted
            ok = ok and all(call["paths"] == "paths" and call["owner"] == "owner" and call["permit"] == "permit"
                            and call["element"] == 7 and call["assets"] == "assets-original" for call in row["registrations"])
        checks.append({"variant": "generator-candidate", "case": row["name"], "pass": bool(ok),
                       "expected_error": spec["throwTable"], "expected_registrations": wanted})
    assert all(row["pass"] for row in checks), [row for row in checks if not row["pass"]]
    previous = {row["name"]: row for row in reference["observations"]["all-seven-stores-control"]["cases"]}
    assert all(row == previous[row["name"]] for row in observed["cases"]), "candidate preload differs from corrected design observations"
    return {"variant": "generator-candidate", "checks": checks, "passed": len(checks), "failed": 0,
            "normal_cases": sum(not row["expected_error"] for row in checks),
            "expected_error_cases": sum(row["expected_error"] for row in checks),
            "all_observations_equal_saved_corrected_oracle": True,
            "empty_triggers_no_calls": True, "trigger_arguments_and_order_exact": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-root", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--candidate-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--java", type=Path, required=True)
    args = parser.parse_args()
    root, out = args.reference_root.resolve(), args.output.resolve()
    sys.path[:0] = [str(CLIENT / "lens0907-0908"), str(CLIENT / "lens0907-0908/vendor/abcasm"),
                    str(CLIENT.parent / "tools/lens-integration"), str(HERE / "support")]
    import build_swf
    core = importlib.import_module("equipment_core")
    preload = importlib.import_module("equipment_preload")
    core.SDK, core.JAVA, core.OUT = args.sdk.resolve(), args.java.resolve(), out / "core"
    assert core.builder is build_swf and preload.builder is build_swf
    assert not out.is_relative_to(CLIENT.parent), "use an external behavior output directory"
    out.mkdir(parents=True, exist_ok=True)
    candidate_bytes = args.candidate.read_bytes()
    assert sha(candidate_bytes) == args.candidate_sha256, "candidate identity changed"
    candidate = build_swf.abcfmt.ABC(candidate_bytes)
    generated_path = root / "batches/10-equipment-generator-fix/transform/generated-bodies.json"
    generated = json.loads(generated_path.read_text(encoding="utf-8"))
    for row in generated:
        body = candidate.bodies[core.body_index(candidate, row["method_id"])]
        assert body[:5] == row["body_header"] and body[5].hex() == row["code_hex"]
        assert json_form(body[6]) == row["exceptions"] and not body[7]
    inputs_path = root / "batches/05-native-recovery/inputs.json"
    inputs = json.loads(inputs_path.read_text(encoding="utf-8"))
    original_bytes = Path(inputs["full_abc"]).read_bytes()
    assert sha(original_bytes) == inputs["full_abc_sha256"]
    original = build_swf.abcfmt.ABC(original_bytes)
    prior_receipts, reference = verify_prior(root, core, preload, original, inputs["full_abc_sha256"])
    save(out / "prior-evidence.json", prior_receipts)
    core_observed = execute_fixture("core", out / "core", candidate, core, preload)
    core_validation = validate_core(core_observed, reference["core"], core)
    save(out / "core/checks.json", core_validation)
    print("Candidate core: 92 normal designs and 4 expected errors passed", flush=True)
    preload_observed = execute_fixture("preload", out / "preload", candidate, core, preload)
    preload_validation = validate_preload(preload_observed, reference["preload"], preload)
    save(out / "preload/checks.json", preload_validation)
    report = {"status": "generator_candidate_actual_helpers_executed_in_isolated_windows_AIR", "variant": "generator-candidate",
              "candidate": str(args.candidate), "candidate_sha256": sha(candidate_bytes),
              "generated_bodies_sha256": sha(generated_path.read_bytes()), "test_script": str(Path(__file__)),
              "test_script_sha256": sha(Path(__file__).read_bytes()), "reference_input_manifest_sha256": sha(inputs_path.read_bytes()),
              "prior_evidence": prior_receipts, "core": {"validation": core_validation, "observations": core_observed},
              "preload": {"validation": preload_validation, "observations": preload_observed},
              "helper_code_edits_in_fixtures": 0, "candidate_helpers_bound_to_generator_outputs": len(generated),
              "limits": ["Windows AIR executes selected candidate ABC helpers with controlled recording dependencies, not ARM64/native/iOS/device/game code.",
                         "Core imports five helper bodies; preload imports seven and exercises the four-member preload chain.",
                         "Original scope depth and fixture call namespaces are adapted; saved SWF instructions, CFG, exceptions and MethodInfo are checked against the candidate.",
                         "Constructor/table/trigger/path registration dependencies are substitutes. Production resource loading, native resolver thunk, GPU and real battle consumers are not exercised.",
                         "No IPA, signing, installation, registry/config/save/server modification or stage-09 evidence overwrite occurs."]}
    save(out / "report.json", report)
    print(json.dumps({"status": report["status"], "candidate_sha256": args.candidate_sha256,
                      "core_passed": core_validation["passed"], "normal_design_matches": core_validation["normal_design_matches"],
                      "preload_passed": preload_validation["passed"], "report": str(out / "report.json")}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
