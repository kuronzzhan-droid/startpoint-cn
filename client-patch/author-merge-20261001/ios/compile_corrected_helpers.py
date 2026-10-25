"""Compile three corrected AuthorState functions in a compiler-only ABC.

The fixed full ABC is read-only.  Only its real, unchanged helper MethodInfo,
owner and activation contexts are used; no native image or package is linked.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
import compile_resolver_thunk as base

METHODS = {101439: ("authorEquipmentCount", "int", ("Object", "Object", "Boolean")),
           101442: ("authorEquipmentPreloadTiers", "void", ("Object",) * 4),
           101443: ("authorEquipmentResolveAbilityPaths", "void", ("Object",) * 5)}
OWNER = "cn.mod::AuthorState"


def prepare(source, out):
    raw = source.read_bytes()
    abc = base.model.abcfmt.ABC(raw)
    metadata = {field: base.model.freeze(getattr(abc, field)) for field in base.POOL_FIELDS}
    ci, = [i for i, ins in enumerate(abc.instances) if abc.mn_name(ins[0]) == OWNER]
    owner = abc.instances[ci]
    records = []
    for mid, (name, result, params) in METHODS.items():
        trait, = [t for t in abc.classes[ci][1] if t.kind == 1 and t.data[2] == mid]
        if abc.mn_name(trait.name) != "cn.mod::" + name:
            raise ValueError(("Wrong static helper trait", mid, abc.mn_name(trait.name)))
        method = abc.methods[mid]
        if (abc.mn_name(method[0]), tuple(abc.mn_name(i) for i in method[1])) != (result, params):
            raise ValueError(("Helper MethodInfo signature changed", mid, method))
        bi, = [i for i, body in enumerate(abc.bodies) if body[0] == mid]
        body = abc.bodies[bi]
        records.append(dict(method_id=mid, name=name, owner=OWNER, static=True, body_index=bi,
                            method_info=method, method_flags=method[3], parameters=params, return_type=result,
                            body_header=body[:5], body_code_sha256=base.sha(body[5]), body_code_hex=body[5].hex(),
                            exceptions=body[6], activation_traits=base.model.freeze(body[7]),
                            environment_register=len(params) + 1,
                            receiver_representation="typed_AuthorState_ClassClosure_pointer",
                            parameter_representations=["Object Atom" if p == "Object" else "native Boolean" for p in params],
                            body_check=base.model.check_body(body, abc)))
    script_mid, script_traits = next((mid, ts) for mid, ts in abc.scripts if any(t.kind == 4 and t.data[2] == ci for t in ts))
    if sum(t.kind == 4 for t in script_traits) != 1:
        raise ValueError("AuthorState owner script contains multiple classes")
    script_bi, = [i for i, body in enumerate(abc.bodies) if body[0] == script_mid]
    script = copy.deepcopy(abc.bodies[script_bi])
    script_rows = [("getlocal_0",), ("pushscope",), ("getglobalscope",),
                   ("getlex", owner[1]), ("pushscope",), ("getlex", owner[1]),
                   ("newclass", ci), ("popscope",), ("initproperty", owner[0]), ("returnvoid",)]
    script[1] = max(script[1], 2)
    script[4] = max(script[4], script[3] + 2)
    script[5] = base.model.asm.encode(base.model.asm.assemble(script_rows))[0]
    script[6] = []
    script_check = base.model.check_body(script, abc)
    stubs = 0
    for i, body in enumerate(abc.bodies):
        if body[0] in METHODS or i == script_bi:
            continue
        stub = list(body)
        stub[1] = max(stub[1], 1)
        stub[5] = base.return_stub(abc.mn_name(abc.methods[body[0]][0]))
        stub[6] = []
        abc.bodies[i] = stub
        stubs += 1
    abc.bodies[script_bi] = script
    for field, frozen in metadata.items():
        if base.model.freeze(getattr(abc, field)) != frozen:
            raise ValueError(("Compiler preparation changed metadata", field))
    compiled = abc.serialize()
    compiler_input = out / "equipment-helpers-compiler-only.abc"
    compiler_input.write_bytes(compiled)
    report = dict(status="corrected_helpers_compiler_only_prepared", source=str(source),
                  source_sha256=base.sha(raw), source_sha1=hashlib.sha1(raw).hexdigest(),
                  compiler_input=str(compiler_input), compiler_input_sha256=base.sha(compiled),
                  compiler_input_sha1=hashlib.sha1(compiled).hexdigest(), owner=OWNER, owner_class_index=ci,
                  records=records, script_method_id=script_mid, script_rows=script_rows,
                  script_check=script_check, unrelated_type_correct_stubs=stubs,
                  helper_bodies_exactly_preserved_from_fixed_candidate=True,
                  pools_and_metadata_unchanged=True, runtime_source_written=False,
                  historical_main_executed=False, secret_or_common_module_imported=False)
    base.dump(out / "prepare.json", report)
    return report


def extract(prep, out):
    pure, reader_receipt = base.pure_object_tools()
    found = {mid: [] for mid in METHODS}
    inventory = []
    for path in sorted((out / "objects").glob("*.o")):
        inventory.append(dict(name=path.name, bytes=path.stat().st_size, sha256=base.sha(path.read_bytes())))
        obj = base.lief.parse(str(path))
        if not obj:
            raise ValueError(("Invalid compiler object", str(path)))
        wanted = []
        for sym in obj.symbols:
            match = re.search(r":(\d+):", pure["text"](sym.name))
            if sym.numberof_sections and match and int(match.group(1)) in METHODS:
                wanted.append(int(match.group(1)))
        if not wanted:
            continue
        section, symbols, functions = pure["parse_object_functions"](obj, wanted)
        for function in functions:
            found[function.method_id].append((path, obj, section, symbols, function))
    helper_map = json.loads(base.RUNTIME_MAP.read_text(encoding="utf-8"))["symbols"]
    reports = []
    md = base.capstone.Cs(base.capstone.CS_ARCH_ARM64, base.capstone.CS_MODE_LITTLE_ENDIAN)
    for source_record in prep["records"]:
        mid = source_record["method_id"]
        if len(found[mid]) != 1:
            raise ValueError(("Helper native symbol must be unique", mid, len(found[mid])))
        path, owning_object, section, symbols, function = found[mid][0]
        content = bytes(section.content)
        start = function.source_start - section.virtual_address
        if not 0 <= start < start + function.size <= len(content):
            raise ValueError(("Function extent exceeds retained section", mid))
        raw = content[start:start + function.size]
        if len(raw) != function.size or not raw or len(raw) % 4:
            raise ValueError(("Invalid full native function extent", mid))
        relocs = pure["parse_relocations"](path, section, symbols, function)
        for row in relocs:
            if not 0 <= row["offset"] <= len(raw) - 4 or not row["external"] or row["symbol"] is None:
                raise ValueError(("Local or incomplete relocation requires review", mid, row))
            row["runtime_target_candidate"] = helper_map.get(row["symbol"], {}).get("address")
        rows = [dict(offset=ins.address, bytes=bytes(ins.bytes).hex(), mnemonic=ins.mnemonic, operands=ins.op_str)
                for ins in md.disasm(raw, 0)]
        if sum(len(bytes.fromhex(row["bytes"])) for row in rows) != len(raw):
            raise ValueError(("Native function disassembly is incomplete", mid))
        raw_name = f"helper-{mid}-unrelocated.bin"
        (out / raw_name).write_bytes(raw)
        base.dump(out / f"helper-{mid}-instructions.json", rows)
        base.dump(out / f"helper-{mid}-relocations.json", relocs)
        (out / f"helper-{mid}-disassembly.txt").write_text("\n".join(
            f'{r["offset"]:04x}  {r["bytes"]}  {r["mnemonic"]} {r["operands"]}' +
            ("  ; " + ", ".join(x["symbol"] for x in relocs if x["offset"] == r["offset"]) if any(x["offset"] == r["offset"] for x in relocs) else "")
            for r in rows) + "\n", encoding="utf-8")
        report = dict(source_record, status="real_static_helper_compiled_not_executed",
                      raw_function_file=raw_name, raw_function_sha256=base.sha(raw), raw_function_bytes=len(raw),
                      raw_function_hex=raw.hex(), object_file=str(path), object_sha256=base.sha(path.read_bytes()),
                      object_symbol=function.symbol, section_content_bytes=len(content), function_section_start=start,
                      symbol=function.symbol, function_source_start=function.source_start,
                      function_source_end=function.source_end,
                      owning_object_retained_during_all_section_reads=True, objectRelocs=relocs,
                      method_info_activation_and_body_from_fixed_candidate=True,
                      environment_contract="own_real_static_helper_MethodEnv",
                      original_source_sha1=prep["source_sha1"], pool_abc_sha1=prep["source_sha1"],
                      native_linked=False, native_executed=False,
                      runtime_installation_required=[f"redirect AOT slot {mid} to relocated corrected helper",
                          "audit old native entry, aliases and direct calls before claiming full reachability coverage"],
                      gc_runtime_verified=False, exception_unwind_verified=False, device_tested=False)
        base.dump(out / f"helper-{mid}-contract.json", report)
        reports.append(report)
    report = dict(status="three_corrected_helpers_compiled_not_linked", source_sha256=prep["source_sha256"],
                  compiler_input_sha256=prep["compiler_input_sha256"], records=reports, contracts=reports, objects=inventory,
                  object_reader=reader_receipt, total_selected_function_bytes=sum(r["raw_function_bytes"] for r in reports),
                  native_linked=False, native_executed=False, device_tested=False)
    base.dump(out / "helpers-contract.json", report)
    return report


def native_binding_evidence(out, native, expected_sha256):
    """Read the explicitly pinned historical carrier; never use main for builtin."""
    from native_reader import Native
    raw = native.read_bytes()
    if base.sha(raw) != expected_sha256:
        raise ValueError("Native input identity changed")
    image = Native(native, data=raw)
    inputs = dict(native_path=str(native), native_sha256=expected_sha256)
    method = image.method(101443)
    entry = image.trace_entry(method["va"])[-1]["va"]
    instructions = image.disasm(entry + 0xac, 8)
    if [(x["mnemonic"], x["operands"]) for x in instructions] != [
            ("adrp", "x22, #0x1063b7000"), ("add", "x22, x22, #0xd00")]:
        raise ValueError("Existing helper's direct builtin AOTInfo materialization changed")
    builtin_address = 0x1063b7d00
    builtin = image.aot(image.offset(builtin_address))
    builtin_abc = base.model.abcfmt.ABC(image.read(builtin["runtime_abc_va"], builtin["runtime_abc_bytes"]))
    builtin_names = [builtin_abc.mn_name(ins[0]) for ins in builtin_abc.instances]
    if len(builtin_abc.methods) != builtin["method_count"] or not {"Object", "Array", "String"}.issubset(builtin_names):
        raise ValueError("Bound AOTInfo is not the actual builtin declarations")
    aot = image.aot()
    pointers = [image.u64(aot["method_table_offset"] + i * 8) for i in range(aot["method_count"])]
    unique = sorted(set(pointers) - {0})
    old = []
    for mid in METHODS:
        row = image.method(mid)
        start = image.trace_entry(row["va"])[-1]["va"]
        greater = [x for x in unique if x > start and image.segment(x)["name"] == image.segment(start)["name"]]
        end = min(greater) if greater else None
        old.append(dict(row, entry_va=start, prefix_hex=image.read(start, 64).hex(),
                        next_distinct_AOT_entry=end, conservative_entry_interval_bytes=end - start if end else None,
                        interval_is_exact_original_function_extent=False,
                        boundary_note="Next current AOT entry is an upper-bound interval, not proof of an original object function extent."))
    evidence = dict(status="current_native_builtin_binding_observed", current_native=inputs["native_path"],
                    current_native_sha256=inputs["native_sha256"], builtin_symbol="_builtin_aotInfo",
                    builtin_aot_info_va=builtin_address, builtin_aot_info_file_offset=image.offset(builtin_address),
                    builtin_aot_info_prefix_hex=image.read(builtin_address, 64).hex(), builtin_aot_info=builtin,
                    builtin_declaration_method_count=len(builtin_abc.methods),
                    builtin_declaration_class_samples=[x for x in builtin_names if x in ("Object", "Array", "String", "Number", "Boolean")],
                    existing_method_id=101443, existing_method_entry=entry,
                    existing_builtin_materialization=instructions,
                    old_helper_entries=old, native_image_written=False,
                    binding_rule="ARM64 type5 ADRP binds directly to builtin AOTInfo page; type6 LDR relaxes to ADD of its page offset, preserving Rd/Rn. No additional GOT slot is needed.",
                    existing_pure_tool_sources=[str(base.CLIENT / "pr43-ios/support/aot_helpers.py"),
                                               str(base.CLIENT / "pr43-ios/link_port.py")])
    base.dump(out / "native-binding-evidence.json", evidence)
    return evidence


def review_helpers(report, out, native, native_sha256):
    guards = {101439: {0x20: ("mov", "x27, x4"), 0x24: ("ldr", "x8, [x27, #0x10]"),
                        0x34: ("ldr", "x20, [x8, #0x30]"), 0x38: ("str", "x27, [sp, #0x30]")},
              101442: {0x20: ("mov", "x24, x5"), 0x24: ("ldr", "x8, [x24, #0x10]"),
                        0x34: ("ldr", "x22, [x8, #0x30]"), 0x38: ("str", "x24, [sp, #0x30]")},
              101443: {0x20: ("stp", "x5, x6, [sp, #0x40]"), 0x28: ("ldr", "x8, [x6, #0x10]"),
                        0x38: ("ldr", "x23, [x8, #0x30]"), 0x3c: ("str", "x6, [sp, #0x60]")}}
    frames = {101439: dict(bytes=160, methodframe="sp+0x28", env="x27 from x4", core="x19"),
              101442: dict(bytes=160, methodframe="sp+0x28", env="x24 from x5", core="x21"),
              101443: dict(bytes=208, methodframe="sp+0x58", env="x6 saved at sp+0x48", core="saved at sp+8")}
    reviews = []
    for contract in report["records"]:
        mid = contract["method_id"]
        rows = json.loads((out / f"helper-{mid}-instructions.json").read_text(encoding="utf-8"))
        ins = {r["offset"]: (r["mnemonic"], r["operands"]) for r in rows}
        for offset, expected in guards[mid].items():
            if ins.get(offset) != expected:
                raise ValueError(("Helper ABI guard differs", mid, offset, ins.get(offset), expected))
        if not any(r["mnemonic"] == "ret" for r in rows):
            raise ValueError(("Helper has no normal return", mid))
        if contract["method_flags"] != 0 or contract["activation_traits"]:
            raise ValueError(("Unexpected helper activation contract", mid))
        for reloc in contract["objectRelocs"]:
            mnemonic = ins[reloc["offset"]][0]
            if reloc["type"] == 2 and (mnemonic != "bl" or reloc["runtime_target_candidate"] is None):
                raise ValueError(("Unbound or unexpected branch relocation", mid, reloc))
            if reloc["type"] in (5, 6) and not (mid == 101443 and reloc["symbol"] == "_builtin_aotInfo" and mnemonic in ("adrp", "ldr")):
                raise ValueError(("Unreviewed data relocation", mid, reloc))
        review = dict(method_id=mid, owner=OWNER, status="complete_helper_static_abi_review_passed_not_executed",
                      raw_function_sha256=contract["raw_function_sha256"], parameters=contract["parameters"],
                      receiver="x0 typed AuthorState ClassClosure pointer", parameter_representations=contract["parameter_representations"],
                      environment_register=contract["environment_register"], frame=frames[mid],
                      environment_contract="Own unchanged static helper MethodInfo/MethodEnv. No resolver MethodEnv substitution.",
                      metadata_and_body_exact_from_fixed_full_abc=True, method_info_flags=0, activation_traits_empty=True,
                      all_instructions_decoded=True, normal_return_present=True,
                      all_external_branch_relocations_resolvable_in_retained_runtime_map=True,
                      builtin_data_relocations="two GOT_LOAD relocations bind to current native builtin AOTInfo" if mid == 101443 else "none",
                      input_atoms_not_reboxed=True, runtime_installation_required=contract["runtime_installation_required"],
                      gc_claim="Compiler-generated MethodFrame observed. GC roots, exceptional unwinding and device execution remain untested.")
        base.dump(out / f"helper-{mid}-abi-review.json", review)
        contract["static_abi_review_file"] = f"helper-{mid}-abi-review.json"
        contract["static_abi_review_passed"] = True
        base.dump(out / f"helper-{mid}-contract.json", contract)
        reviews.append(review)
    evidence = native_binding_evidence(out, native, native_sha256)
    report["contracts"] = report["records"]
    report["abi_reviews"] = reviews
    report["current_native_binding_evidence"] = "native-binding-evidence.json"
    report["builtin_aot_info_va"] = evidence["builtin_aot_info_va"]
    base.dump(out / "helpers-contract.json", report)
    return reviews


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--native-sha256", required=True)
    base.add_environment_arguments(parser)
    parser.add_argument("--extract-only", action="store_true")
    args = parser.parse_args()
    base.configure(args)
    OUT = args.out.resolve()
    if OUT.is_relative_to(base.CLIENT.parent):
        raise ValueError("Use an external output directory")
    OUT.mkdir(parents=True, exist_ok=True)
    if args.extract_only:
        prep = json.loads((OUT / "prepare.json").read_text(encoding="utf-8"))
        if base.sha(Path(prep["compiler_input"]).read_bytes()) != prep["compiler_input_sha256"]:
            raise ValueError("Compiler-only input changed")
    else:
        if (OUT / "prepare.json").exists() or (OUT / "objects").exists():
            raise ValueError("Refuse to replace retained helper compilation evidence")
        prep = prepare(args.source.resolve(), OUT)
        base.compile_source(prep, OUT, 600)
    report = extract(prep, OUT)
    review_helpers(report, OUT, args.native.resolve(), args.native_sha256)
    print(json.dumps({"status": report["status"], "selected_bytes": report["total_selected_function_bytes"],
                      "helpers": [dict(method_id=r["method_id"], bytes=r["raw_function_bytes"], relocations=len(r["objectRelocs"])) for r in report["records"]]}))


if __name__ == "__main__":
    main()
