"""Compile one resolver-owned AOT thunk; never write runtime ABC or an IPA.

All generated files stay in --out.  The input MethodInfo, owner declarations,
flags and activation traits are immutable.  Restored script/newclass code and
type-correct return stubs are compiler-only and cannot become runtime payloads.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
CLIENT = HERE.parents[1]
sys.path[:0] = [str(CLIENT / "lens0907-0908"),
                str(CLIENT / "lens0907-0908/vendor/abcasm"),
                str(CLIENT.parent / "tools/lens-integration"),
                str(CLIENT / "pr43-ios/support"), str(HERE / "support")]
import build_swf as model

METHOD = 18392
OWNER = "pinball.common.data.character::BattleCharacterLogic"
PARAMETERS = ("pinball.asset.logic::IAssetPathCollectionBuilder",
              "pinball.common.data.character::BattleCharacterOwner",
              "pinball.scene.battle.battle.feature::BattleFeaturePermitData",
              "Boolean", "Boolean")
SDK = DEPENDENCIES = RUNTIME_MAP = BACKGROUND = None
POOL_FIELDS = ("methods", "metadata", "instances", "classes", "scripts", "ints",
               "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")


def return_stub(name):
    if name == "void":
        return b"\x47"
    if name == "Boolean":
        return b"\x27\x48"
    if name in ("int", "uint"):
        return b"\x24\x00\x48"
    if name == "Number":
        return b"\x28\x48"
    if name == "*":
        return b"\x21\x48"
    return b"\x20\x48"


def prepare(source, out):
    raw = source.read_bytes()
    abc = model.abcfmt.ABC(raw)
    frozen = {field: model.freeze(getattr(abc, field)) for field in POOL_FIELDS}
    owners = [(ci, ins) for ci, ins in enumerate(abc.instances) if abc.mn_name(ins[0]) == OWNER]
    if len(owners) != 1:
        raise ValueError("Resolver owner must be unique")
    ci, owner = owners[0]
    traits = [t for t in owner[6] if t.kind == 1 and t.data[2] == METHOD]
    if len(traits) != 1 or abc.mn_name(traits[0].name) != "resolvePathCollection":
        raise ValueError("Method 18392 is not the expected real owner declaration")
    method = abc.methods[METHOD]
    signature = (abc.mn_name(method[0]), tuple(abc.mn_name(x) for x in method[1]))
    if signature != ("void", PARAMETERS) or method[3] != 2:
        raise ValueError(("Unexpected real resolver MethodInfo", signature, method))
    bi, = [i for i, body in enumerate(abc.bodies) if body[0] == METHOD]
    original_body = copy.deepcopy(abc.bodies[bi])
    if original_body[5] != b"\x47" or len(original_body[7]) != 4 or original_body[6]:
        raise ValueError("Expected the retained resolver return stub and four activation slots")

    def q(name):
        hits = [i for i in range(1, len(abc.multinames)) if abc.mn_name(i) == name]
        if len(hits) != 1:
            raise ValueError(("Expected one existing QName", name, hits))
        return hits[0]

    helper_class = q("cn.mod::AuthorState")
    helper_name = q("cn.mod::authorEquipmentPreloadTiers")
    helper_ci, = [i for i, ins in enumerate(abc.instances) if ins[0] == helper_class]
    helper_trait, = [t for t in abc.classes[helper_ci][1] if t.kind == 1 and t.name == helper_name]
    helper_mid = helper_trait.data[2]
    helper_info = abc.methods[helper_mid]
    if (abc.mn_name(helper_info[0]), tuple(abc.mn_name(x) for x in helper_info[1])) != ("void", ("Object",) * 4):
        raise ValueError("The preload helper must accept four Object atoms")
    rows = [("getlocal_0",), ("pushscope",), ("getlex", helper_class),
            ("getlocal_0",), ("getlocal_1",), ("getlocal_2",), ("getlocal_3",),
            ("callpropvoid", helper_name, 4), ("returnvoid",)]
    target = copy.deepcopy(original_body)
    target[1] = max(target[1], 5)
    target[4] = max(target[4], target[3] + 1)
    target[5] = model.asm.encode(model.asm.assemble(rows))[0]
    target_check = model.check_body(target, abc)

    scripts = [(mid, ts) for mid, ts in abc.scripts if any(t.kind == 4 and t.data[2] == ci for t in ts)]
    if len(scripts) != 1:
        raise ValueError("Owner class must have exactly one script declaration")
    script_mid, script_traits = scripts[0]
    if sum(t.kind == 4 for t in script_traits) != 1:
        raise ValueError("Multiple classes in the owner script require explicit context review")
    script_bi, = [i for i, body in enumerate(abc.bodies) if body[0] == script_mid]
    script = copy.deepcopy(abc.bodies[script_bi])
    script_rows = [("getlocal_0",), ("pushscope",), ("getglobalscope",),
                   ("getlex", owner[1]), ("pushscope",), ("getlex", owner[1]),
                   ("newclass", ci), ("popscope",), ("initproperty", owner[0]), ("returnvoid",)]
    script[1] = max(script[1], 2)
    script[4] = max(script[4], script[3] + 2)
    script[5] = model.asm.encode(model.asm.assemble(script_rows))[0]
    script[6] = []
    script_check = model.check_body(script, abc)
    changed = 0
    for i, body in enumerate(abc.bodies):
        if i in (bi, script_bi):
            continue
        stub = list(body)
        stub[1] = max(stub[1], 1)
        stub[5] = return_stub(abc.mn_name(abc.methods[body[0]][0]))
        stub[6] = []
        abc.bodies[i] = stub
        changed += 1
    abc.bodies[bi], abc.bodies[script_bi] = target, script
    for field in POOL_FIELDS:
        if model.freeze(getattr(abc, field)) != frozen[field]:
            raise ValueError(("Compiler-only preparation changed metadata", field))
    if model.freeze(target[7]) != model.freeze(original_body[7]):
        raise ValueError("Resolver activation traits changed")
    compiler_bytes = abc.serialize()
    path = out / "equipment-resolver-compiler-only.abc"
    path.write_bytes(compiler_bytes)
    report = dict(status="compiler_only_prepared", source=str(source), source_sha256=sha(raw),
                  source_sha1=hashlib.sha1(raw).hexdigest(), source_bytes=len(raw),
                  compiler_input=str(path), compiler_input_sha256=sha(compiler_bytes),
                  compiler_input_sha1=hashlib.sha1(compiler_bytes).hexdigest(),
                  compiler_input_bytes=len(compiler_bytes), method_id=METHOD, body_index=bi,
                  owner=OWNER, owner_class_index=ci, method_info=method,
                  parameters=PARAMETERS, return_type="void", method_flags=method[3],
                  activation_traits=model.freeze(original_body[7]), activation_slots=4,
                  original_body_header=original_body[:5], compiler_body_header=target[:5],
                  original_body_hex=original_body[5].hex(), compiler_body_hex=target[5].hex(),
                  compiler_body_instructions=rows, bytecode_check=target_check,
                  helper_method_id=helper_mid, helper_method_info=helper_info,
                  helper_parameters=["Object"] * 4, script_method_id=script_mid,
                  compiler_only_script_instructions=script_rows, script_check=script_check,
                  unrelated_type_correct_stubs=changed, pools_and_metadata_unchanged=True,
                  original_source_unchanged=True, runtime_input_written=False,
                  old_static_bridge_101444_selected=False, historical_main_executed=False,
                  secret_or_common_module_imported=False)
    dump(out / "prepare.json", report)
    return report


def compile_source(prep, out, timeout):
    expected = json.loads((CLIENT / "pr43-ios/support/dependency-hashes.json").read_text(encoding="utf-8"))
    deps = sorted(p for p in DEPENDENCIES.glob("*.abc") if not p.name.startswith("284-"))
    if len(deps) != 284 or {p.name for p in deps} != set(expected):
        raise ValueError("Expected exactly the fixed 284 dependencies")
    for path in deps:
        if sha(path.read_bytes()) != expected[path.name]:
            raise ValueError(("Dependency hash mismatch", path.name))
    compiler = SDK / "lib/aot/bin/compile-abc/compile-abc-64.exe"
    if sha(compiler.read_bytes()) != "4d37897f71d7cec73c5e9fc108fc130678dab33d711616fcfc35f42119112943":
        raise ValueError("Unexpected AOT compiler identity")
    objects = out / "objects"
    objects.mkdir()
    command = [sys.executable, "-B", str(BACKGROUND), "--timeout", str(timeout), "--cwd", str(objects), "--",
               str(compiler), "-mtriple=arm64-apple-ios", "-fields=" + str(SDK / "lib/aot/lib/air-fields.arm64-air.txt"),
               "-sdk=" + str(SDK / "lib/aot/lib/avmglue.abc"), "-O=1", "-verify-warnings",
               *map(str, deps), prep["compiler_input"]]
    started = time.monotonic()
    with (out / "compile.log").open("wb") as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=timeout + 30, check=False)
    receipt = dict(command=command, exit_code=result.returncode, elapsed_seconds=round(time.monotonic() - started, 3),
                   source_sha256=prep["compiler_input_sha256"], compiler_sha256=sha(compiler.read_bytes()),
                   dependency_count=len(deps), dependency_hash_contract=str(CLIENT / "pr43-ios/support/dependency-hashes.json"),
                   background_wrapper=str(BACKGROUND), linked=False, native_executed=False)
    dump(out / "compile.json", receipt)
    if result.returncode:
        raise RuntimeError(("AOT compilation failed", result.returncode, str(out / "compile.log")))
    return objects


def pure_object_tools():
    """Use only versioned, non-executing object readers."""
    import aot_helpers
    import object_reader
    names = ("text", "FunctionRecord", "parse_relocations")
    scope = {name: getattr(aot_helpers, name) for name in names}
    scope["parse_object_functions"] = object_reader.parse_object_functions
    paths = [Path(aot_helpers.__file__), Path(object_reader.__file__)]
    return scope, dict(sources=[dict(source=str(path), source_sha256=sha(path.read_bytes())) for path in paths],
                       extracted_definitions=sorted(scope))


def add_environment_arguments(parser):
    for name in ("sdk", "dependencies", "runtime-map", "libraries", "background"):
        parser.add_argument("--" + name, type=Path, required=True)


def configure(args):
    global SDK, DEPENDENCIES, RUNTIME_MAP, BACKGROUND, capstone, lief
    SDK, DEPENDENCIES = args.sdk.resolve(), args.dependencies.resolve()
    RUNTIME_MAP, BACKGROUND = args.runtime_map.resolve(), args.background.resolve()
    sys.path.insert(0, str(args.libraries.resolve()))
    import capstone
    import lief


def extract(prep, objects, out):
    pure, tool_receipt = pure_object_tools()
    candidates, inventory = [], []
    for path in sorted(objects.glob("*.o")):
        inventory.append(dict(name=path.name, bytes=path.stat().st_size, sha256=sha(path.read_bytes())))
        obj = lief.parse(str(path))
        if not obj:
            raise ValueError(("Cannot parse compiler object", str(path)))
        defined = [s for s in obj.symbols if s.numberof_sections and re.search(r":18392:", pure["text"](s.name))]
        if not defined:
            continue
        section, symbols, functions = pure["parse_object_functions"](obj, [METHOD])
        for function in functions:
            candidates.append((path, obj, section, symbols, function))
    if len(candidates) != 1:
        raise ValueError(("Expected exactly one defined resolver function", len(candidates)))
    path, owning_object, section, symbols, function = candidates[0]
    start = function.source_start - section.virtual_address
    section_bytes = bytes(section.content)
    if not (0 <= start < start + function.size <= len(section_bytes)):
        raise ValueError("Function extent exceeds its retained owning LIEF section")
    raw = section_bytes[start:start + function.size]
    if len(raw) != function.size or not len(raw) or len(raw) % 4:
        raise ValueError("Function bytes are incomplete or misaligned")
    relocs = pure["parse_relocations"](path, section, symbols, function)
    for row in relocs:
        if not 0 <= row["offset"] <= len(raw) - 4 or not row["external"] or row["symbol"] is None:
            raise ValueError(("Unsupported incomplete/local function relocation", row))
    md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_LITTLE_ENDIAN)
    md.detail = True
    instructions = []
    for ins in md.disasm(raw, 0):
        row = dict(offset=ins.address, bytes=bytes(ins.bytes).hex(), mnemonic=ins.mnemonic, operands=ins.op_str)
        row["relocations"] = [r for r in relocs if r["offset"] == ins.address]
        instructions.append(row)
    if sum(len(bytes.fromhex(row["bytes"])) for row in instructions) != len(raw):
        raise ValueError("Disassembly does not cover the complete native function")
    (out / "resolver-18392-unrelocated.bin").write_bytes(raw)
    dump(out / "instructions.json", instructions)
    dump(out / "object-relocations.json", relocs)
    (out / "resolver-18392-disassembly.txt").write_text("\n".join(
        f'{r["offset"]:04x}  {r["bytes"]}  {r["mnemonic"]} {r["operands"]}' +
        ("  ; " + ", ".join(x["symbol"] for x in r["relocations"]) if r["relocations"] else "")
        for r in instructions) + "\n", encoding="utf-8")
    contract = dict(status="resolver_owned_thunk_compiled_not_executed", method_id=METHOD, owner=OWNER,
                    parameters=PARAMETERS, return_type="void", method_flags=prep["method_flags"],
                    environment_register=6, receiver_representation="typed_resolver_receiver",
                    environment_contract="original_resolver_methodenv", pool_abc_sha1=prep["source_sha1"],
                    compiler_input_sha1=prep["compiler_input_sha1"], compiler_input_sha256=prep["compiler_input_sha256"],
                    input_method_metadata_unchanged=True, input_activation_traits_unchanged=True,
                    helper_method_id=prep["helper_method_id"], raw_function_file="resolver-18392-unrelocated.bin",
                    raw_function_bytes=len(raw), raw_function_sha256=sha(raw), raw_function_hex=raw.hex(),
                    symbol=function.symbol, object_file=str(path), object_sha256=sha(path.read_bytes()),
                    section_name=section.name, section_virtual_address=section.virtual_address,
                    section_content_bytes=len(section_bytes), function_section_start=start,
                    function_source_start=function.source_start, function_source_end=function.source_end,
                    owning_object_kept_alive_during_all_section_and_symbol_reads=True,
                    objectRelocs=relocs, instructions_file="instructions.json", objects=inventory,
                    object_reader=tool_receipt, native_linked=False, native_executed=False,
                    exception_unwind_verified=False, gc_runtime_verified=False, device_tested=False,
                    runtime_abc_body_replaced=False, old_static_bridge_101444_selected=False)
    dump(out / "thunk-contract.json", contract)
    return contract


def review_thunk(prep, contract, out):
    """Bind a static ABI review to the actual, complete emitted function."""
    rows = json.loads((out / "instructions.json").read_text(encoding="utf-8"))
    instructions = {row["offset"]: (row["mnemonic"], row["operands"]) for row in rows}
    guards = {0x00: ("stp", "x26, x25, [sp, #-0x50]!"),
              0x10: ("stp", "x29, x30, [sp, #0x40]"),
              0x14: ("add", "x29, sp, #0x40"), 0x18: ("sub", "sp, sp, #0x20"),
              0x1c: ("mov", "x22, x6"), 0x20: ("ldr", "x8, [x22, #0x10]"),
              0x30: ("ldr", "x8, [x8, #0x30]"), 0x34: ("str", "x22, [sp, #0x10]"),
              0x40: ("ldr", "x25, [x8, #8]"), 0x44: ("ldr", "x8, [x25, #0x60]"),
              0x48: ("str", "x8, [sp, #8]"), 0x4c: ("str", "x9, [x25, #0x60]"),
              0x50: ("ldr", "x8, [x22, #0x18]"), 0x5c: ("ldr", "x8, [x8, #0x10]"),
              0x60: ("ldr", "x8, [x8, #0x30]"), 0x6c: ("cbnz", "x9, #0x80"),
              0x80: ("ldr", "x24, [x9, #0x20]"), 0x84: ("cbz", "x24, #0xf4"),
              0x88: ("ldr", "x8, [x24, #0x10]"), 0x8c: ("add", "x1, x21, #1"),
              0x94: ("add", "x20, x20, #1"), 0x98: ("ldr", "x22, [x8, #0x260]"),
              0x9c: ("add", "x19, x19, #1"), 0xa0: ("add", "x21, x23, #1"),
              0xa8: ("ldr", "x8, [x22, #0x10]"), 0xb0: ("mov", "x0, x24"),
              0xb4: ("mov", "x1, x21"), 0xb8: ("ldr", "x8, [x8, #0x50]"),
              0xbc: ("mov", "x3, x19"), 0xc0: ("mov", "x4, x20"),
              0xc4: ("mov", "x5, x22"), 0xc8: ("blr", "x8"),
              0xcc: ("ldr", "x8, [sp, #8]"), 0xd4: ("str", "x8, [x25, #0x60]"),
              0xf0: ("ret", ""), 0xf4: ("mov", "x0, x22")}
    for offset, expected in guards.items():
        if instructions.get(offset) != expected:
            raise ValueError(("Emitted thunk differs from reviewed instruction contract", offset, instructions.get(offset), expected))
    expected_relocs = {0x78: "__ZN7avmplus12finddef_missEPPNS_12ScriptObjectEPNS_11MethodFrameE",
                       0xa4: "__ZN8halfmoon5Stubs13do_castobjectEPN7avmplus11MethodFrameEx", 0xf8: "_llNPE"}
    if {r["offset"]: r["symbol"] for r in contract["objectRelocs"]} != expected_relocs:
        raise ValueError("Unexpected thunk relocation set")
    field_path = SDK / "lib/aot/lib/air-fields.arm64-air.txt"
    helper_map = json.loads(RUNTIME_MAP.read_text(encoding="utf-8"))["symbols"]
    bindings = [dict(offset=offset, symbol=symbol, relocation_type="ARM64_RELOC_BRANCH26",
                     current_native_target_candidate=helper_map[symbol]["address"],
                     source="retained runtime-helper-map.json; native binder must verify current input")
                for offset, symbol in sorted(expected_relocs.items())]
    report = dict(status="complete_function_static_abi_review_passed_not_executed", method_id=METHOD,
                  native_function_sha256=contract["raw_function_sha256"], native_function_bytes=contract["raw_function_bytes"],
                  fields_source=str(field_path), fields_source_sha256=sha(field_path.read_bytes()),
                  full_function_decoded=True, normal_return_complete=True,
                  entry=dict(typed_receiver="x0 BattleCharacterLogic*", typed_arguments=dict(
                      x1=PARAMETERS[0] + "*", x2=PARAMETERS[1] + "*", x3=PARAMETERS[2] + "*",
                      x4="Boolean", x5="Boolean"), methodenv="x6 original method 18392 MethodEnv*",
                      stack_allocation_bytes=112, saved_registers="x19-x26, fp, lr"),
                  original_methodenv_accesses=[
                      dict(offset=0x20, path="x6->MethodEnv.method (+16)"),
                      dict(offset=0x30, path="MethodInfo.pool (+48)"),
                      dict(offset=0x40, path="PoolObject.core (+8)"),
                      dict(offset=0x34, path="MethodFrame.env = original x6; frame = sp+8"),
                      dict(offset=0x50, path="x6->MethodEnv._scope (+24)"),
                      dict(offset=0x5c, path="ScopeChain._abcEnv (+16)"),
                      dict(offset=0x60, path="AbcEnv.m_finddef_table (+48)"),
                      dict(offset=0x64, path="FinddefTableType.elements (+24) + QName[69157]*8 = +0x87140"),
                      dict(offset=0x80, path="resolved script global +32 = unchanged AuthorState class trait slot"),
                      dict(offset=0xf4, path="missing class branch passes original resolver MethodEnv to llNPE")],
                  original_methodenv_compatible_reason="All emitted original-env reads use unchanged MethodInfo, scope, pool indices and owner. No resolver MethodEnv is passed as an AuthorState static MethodEnv.",
                  object_atom_arguments=[
                      dict(parameter="BattleCharacterLogic receiver", from_register="x0->x23", conversion="+0xa0 add x21,x23,#1", helper_register="x1"),
                      dict(parameter="IAssetPathCollectionBuilder builder", from_register="x1->x21", conversion="+0x8c add x1,x21,#1; +0xa4 do_castobject(frame, atom); +0xac x2=result", helper_register="x2"),
                      dict(parameter="BattleCharacterOwner owner", from_register="x2->x19", conversion="+0x9c add x19,x19,#1", helper_register="x3"),
                      dict(parameter="BattleFeaturePermitData permit", from_register="x3->x20", conversion="+0x94 add x20,x20,#1", helper_register="x4")],
                  helper_dispatch=dict(method_id=101442, method_info=prep["helper_method_info"],
                      receiver="AuthorState ClassClosure* x24 -> x0", environment="class.vtable.methods[60] (+0x260) -> x22 -> x5",
                      handler="helper MethodEnv.method (+16)->MethodInfo.native.handler (+80) -> blr",
                      resolver_env_borrowed=False, required_runtime_replacement="corrected native method 101442 must be installed separately; corrected ABC alone does not replace an AOT handler"),
                  method_frame=dict(established="core.currentMethodFrame saved at sp+8 then set to sp+8; original env at sp+16",
                      restored="+0xcc/+0xd4 restore prior core.currentMethodFrame on normal return",
                      typed_references_across_calls="receiver x23, builder x21, owner x19, permit x20, class x24 and original MethodEnv x22 use callee-saved registers before helper dispatch",
                      gc_claim="Compiler-generated MethodFrame and callee-saved reference retention are observed. Collector root scanning, exceptional unwinding and device execution are not established by this static review."),
                  relocation_bindings=bindings, exception_paths=["finddef_miss may initialize the script or throw", "do_castobject may throw", "llNPE is reached before helper env replaces x22"],
                  not_verified=["native execution", "GC stress/root scanning", "exception unwinding across the external shim", "device startup or battles"])
    dump(out / "abi-review.json", report)
    contract["abi_review_file"] = "abi-review.json"
    contract["static_abi_review_passed"] = True
    contract["runtime_helper_bindings"] = bindings
    dump(out / "thunk-contract.json", contract)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    add_environment_arguments(parser)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--extract-only", action="store_true")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    configure(args)
    out = args.out.resolve()
    if out.is_relative_to(CLIENT.parent):
        raise ValueError("Use an external output directory")
    out.mkdir(parents=True, exist_ok=True)
    if args.extract_only:
        prep = json.loads((out / "prepare.json").read_text(encoding="utf-8"))
        if sha(Path(prep["compiler_input"]).read_bytes()) != prep["compiler_input_sha256"]:
            raise ValueError("Compiler input changed after preparation")
        result = extract(prep, out / "objects", out)
    else:
        if (out / "prepare.json").exists() or (out / "objects").exists():
            raise ValueError("Refuse to overwrite retained preparation or compiler objects")
        prep = prepare(args.source.resolve(), out)
        if args.prepare_only:
            print(json.dumps({"status": prep["status"], "method_id": METHOD, "out": str(out)}))
            return
        result = extract(prep, compile_source(prep, out, args.timeout), out)
    review_thunk(prep, result, out)
    print(json.dumps({"status": result["status"], "bytes": result["raw_function_bytes"],
                      "objectRelocs": len(result["objectRelocs"]), "out": str(out)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
