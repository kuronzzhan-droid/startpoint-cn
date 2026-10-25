"""Pure equipment-transform regressions; never run the historical IPA builder.

Run with Python's standard library. Optional --replay-inputs reads a pinned
current full ABC and the historical donor SWF, then writes only to --output.
No common/signing module, client package writer, linker or AIR is invoked.
"""
from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys
import types
import unittest

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
CLIENT = HERE.parents[1]
sys.path[:0] = [str(CLIENT / "lens0907-0908"),
                str(CLIENT / "lens0907-0908/vendor/abcasm"),
                str(CLIENT.parent / "tools/lens-integration")]
import build_swf as builder
from swfabc import abcfmt, swftags


def load_transforms():
    source = HERE / "prepare_ios.py"
    parsed = ast.parse(source.read_text(encoding="utf-8"))
    names = {"clone_instruction", "local_instruction", "shift_instance_locals",
             "remap_targets", "encode_body", "method_id_for_label",
             "short_name", "ensure_qname", "transform_static_rule_body",
             "transform_preload_body", "transform_resolve_helper", "main_abc"}
    nodes = [node for node in parsed.body
             if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {"p": builder, "abcfmt": abcfmt, "swftags": swftags}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), namespace)
    constants = {node.targets[0].id: ast.literal_eval(node.value)
                 for node in parsed.body if isinstance(node, ast.Assign)
                 and isinstance(node.targets[0], ast.Name)
                 and node.targets[0].id in {"RULE_METHODS", "DONOR_SWF_SHA256"}}
    return types.SimpleNamespace(**namespace), constants


transforms, CONSTANTS = load_transforms()
I = builder.asm.Instruction


def token(ins):
    return ins.op, tuple(ins.args), ins.target, ins.default, tuple(ins.cases) if ins.cases is not None else None


def local(ins):
    if ins.name.startswith(("getlocal_", "setlocal_")):
        return int(ins.name[-1])
    return ins.args[0]


class LocalMappingTests(unittest.TestCase):
    def test_generic_and_short_reads_and_writes(self):
        for family in ("getlocal", "setlocal"):
            for old in range(4):
                for new in (0, 1, 3, 4, 128):
                    for short in (False, True):
                        name = f"{family}_{old}" if short else family
                        ins = I(builder.asm.MNEMONICS[name], () if short else [old])
                        with self.subTest(name=name, old=old, new=new):
                            result = transforms.shift_instance_locals([ins], {old: new}, False)[0]
                            self.assertEqual(local(result), new)
                            self.assertTrue(result.name.startswith(family))
                            self.assertEqual(builder.asm.decode(builder.asm.encode([result])[0])[0].op, result.op)

    def test_other_local_operations_and_default_mapping(self):
        for name in ("kill", "inclocal", "inclocal_i", "declocal", "declocal_i"):
            opcode = 8 if name == "kill" else builder.asm.MNEMONICS[name]
            result = transforms.shift_instance_locals([I(opcode, [2])], {2: 130}, False)[0]
            self.assertEqual((result.op, result.args), (opcode, [130]))
        result = transforms.shift_instance_locals([I(0x32, [1, 4]), I(0x63, [6]), I(0xd7)], {1: 8}, False)
        self.assertEqual(result[0].args, [8, 5])
        self.assertEqual(result[1].args, [7])
        self.assertEqual(local(result[2]), 4)

    def test_original_scope_prologue_and_source_are_preserved(self):
        source = [I(0xd0), I(0x30), I(0xd0), I(0xd4)]
        before = list(map(token, source))
        result = transforms.shift_instance_locals(source, {0: 9})
        self.assertEqual(list(map(token, result[:2])), before[:2])
        self.assertEqual([local(ins) for ins in result[2:]], [9, 9])
        self.assertEqual(list(map(token, source)), before)
        self.assertIsNot(result[0], source[0])

    def test_branch_switch_and_exception_boundaries(self):
        source = [I(0xd0), I(0x30), I(0xd6), I(0x10, target=5),
                  I(0x1b, cases=[2, 6], default=6), I(0xd7), I(0x47)]
        code, offsets = builder.asm.encode(source)
        body = [99, 2, 4, 0, 1, code, [(offsets[2], offsets[6], offsets[5], 7, 8)], []]
        before = copy.deepcopy(body)
        shifted = transforms.shift_instance_locals(source, {2: 128, 3: 129})
        transforms.encode_body(body, shifted)
        decoded = builder.asm.decode(body[5])
        self.assertEqual(decoded[3].target, 5)
        self.assertEqual((decoded[4].cases, decoded[4].default), ([2, 6], 6))
        new_offsets = builder.asm.encode(decoded)[1]
        self.assertEqual(body[6], [(new_offsets[2], new_offsets[6], new_offsets[5], 7, 8)])
        self.assertEqual(before[5], code)

    def test_exception_boundaries_follow_insertions_and_code_end(self):
        source = [I(0xd0), I(0x30), I(0xd6), I(0x47)]
        code, offsets = builder.asm.encode(source)
        body = [99, 2, 4, 0, 1, code, [(offsets[2], len(code), offsets[3], 7, 8)], []]
        result = [I(0xd0), I(0x30), I(0x02), I(0x63, [128]), I(0x47)]
        transforms.encode_body(body, result, index_map={0: 0, 1: 1, 2: 2, 3: 4, 4: 5})
        new_offsets = builder.asm.encode(result)[1]
        self.assertEqual(body[6], [(new_offsets[2], len(body[5]), new_offsets[4], 7, 8)])

    def test_missing_exception_insertion_map_is_rejected_without_body_mutation(self):
        code = builder.asm.encode([I(0xd0), I(0x30), I(0x47)])[0]
        body = [99, 2, 4, 0, 1, code, [(0, len(code), 2, 7, 8)], []]
        before = copy.deepcopy(body)
        with self.assertRaisesRegex(AssertionError, "instruction index map"):
            transforms.encode_body(body, [I(0xd0), I(0x30), I(0x02), I(0x47)])
        self.assertEqual(body, before)

    def test_actual_static_transform_relocates_exception_bytes(self):
        instructions = [I(0xd0), I(0x30), I(0x24, [0]), I(0xd7), I(0xd3), I(0x29), I(0x47)]
        code, offsets = builder.asm.encode(instructions)
        body = [99, 2, 4, 1, 2, code, [(offsets[2], len(code), offsets[5], 7, 8)], []]
        transforms.transform_static_rule_body(body, None, {})
        result = builder.asm.decode(body[5])
        new_offsets = builder.asm.encode(result)[1]
        self.assertEqual(local(result[3]), 4)
        self.assertEqual(body[6], [(new_offsets[2], len(body[5]), new_offsets[5], 7, 8)])


class MethodIdentityTests(unittest.TestCase):
    def test_body_index_is_not_method_id(self):
        view = types.SimpleNamespace(by_label={"resolver": [1]},
                                     a=types.SimpleNamespace(bodies=[[1], [5]], methods=[None] * 6),
                                     labels={1: "other", 5: "resolver"})
        self.assertEqual(transforms.method_id_for_label(view, "resolver"), 5)
        view.a.bodies[1][0] = 1
        with self.assertRaises(AssertionError):
            transforms.method_id_for_label(view, "resolver")

    def test_main_report_uses_method_identity_resolution(self):
        parsed = ast.parse((HERE / "prepare_ios.py").read_text(encoding="utf-8"))
        fields = [value for node in ast.walk(parsed) if isinstance(node, ast.Dict)
                  for key, value in zip(node.keys, node.values)
                  if isinstance(key, ast.Constant) and key.value == "resolve_method"]
        self.assertEqual(len(fields), 1)
        label = "pinball.common.data.character::BattleCharacterLogic/resolvePathCollection|1"
        view = types.SimpleNamespace(by_label={label: [1]},
                                     a=types.SimpleNamespace(bodies=[[1], [5]], methods=[None] * 6),
                                     labels={1: "other", 5: label})
        expression = compile(ast.Expression(fields[0]), str(HERE / "prepare_ios.py"), "eval")
        actual = eval(expression, {"target": view, "method_id_for_label": transforms.method_id_for_label})
        self.assertEqual(actual, 5)

    def test_missing_ambiguous_and_invalid_method_are_rejected(self):
        view = types.SimpleNamespace(by_label={}, a=types.SimpleNamespace(bodies=[[8]], methods=[None]), labels={8: "resolver"})
        with self.assertRaises(AssertionError):
            transforms.method_id_for_label(view, "resolver")
        view.by_label["resolver"] = [0, 0]
        with self.assertRaises(AssertionError):
            transforms.method_id_for_label(view, "resolver")
        view.by_label["resolver"] = [0]
        with self.assertRaises(AssertionError):
            transforms.method_id_for_label(view, "resolver")


def forward_replay(inputs_path, donor_path, output):
    """Generate the real helpers again from the pinned, unmodified donor."""
    inputs = json.loads(inputs_path.read_text(encoding="utf-8"))
    full_path = Path(inputs["full_abc"])
    full_bytes, donor_bytes = full_path.read_bytes(), donor_path.read_bytes()
    digest = lambda value: hashlib.sha256(value).hexdigest()
    assert digest(full_bytes) == inputs["full_abc_sha256"], "current full ABC identity changed"
    assert digest(donor_bytes) == CONSTANTS["DONOR_SWF_SHA256"], "historical donor identity changed"
    current = abcfmt.ABC(full_bytes)
    _, donor = transforms.main_abc(donor_path)
    target = copy.deepcopy(current)
    view = lambda abc: builder.View(types.SimpleNamespace(abc=abc), builder.asm)
    current_view, target_view, donor_view = view(current), view(target), view(donor)
    owner = next(i for i, row in enumerate(target.instances) if target.mn_name(row[0]) == "cn.mod::AuthorState")
    helpers = {target.mn_name(t.name).rsplit("::", 1)[-1]: t.data[2]
               for t in target.classes[owner][1] if t.data[0] == "method"}
    entries = [(label, name, transforms.transform_static_rule_body)
               for label, name, _params, _ret in CONSTANTS["RULE_METHODS"]]
    entries += [("pinball.common.data.character::BattleCharacterLogic/wfPreloadEquipmentTiers|1",
                 "authorEquipmentPreloadTiers", transforms.transform_preload_body),
                ("pinball.common.data.character::BattleCharacterLogic/resolvePathCollection|1/closure:0",
                 "authorEquipmentResolveAbilityPaths", transforms.transform_resolve_helper)]
    importer = builder.Importer(target_view, donor_view)
    for source_label, name, _transform in entries:
        source_mid = transforms.method_id_for_label(donor_view, source_label)
        importer.methods[source_mid] = helpers[name]
    records, generated = [], []
    expected = {"authorEquipmentCount": (1, {3: 4}),
                "authorEquipmentPreloadTiers": (5, {2: 5, 3: 6}),
                "authorEquipmentResolveAbilityPaths": (2, {2: 7, 3: 8})}
    for source_label, name, transform in entries:
        mid = helpers[name]
        source_bi = donor_view.by_label[source_label][0]
        target_bi = next(i for i, body in enumerate(target.bodies) if body[0] == mid)
        source_body = importer.body(source_bi, mid)
        source_prologue = list(map(token, builder.asm.decode(source_body[5])[:2]))
        body = copy.deepcopy(source_body)
        if transform is transforms.transform_resolve_helper:
            transform(body, target_view)
        else:
            transform(body, target_view, helpers)
            self_prologue = list(map(token, builder.asm.decode(body[5])[:2]))
            assert self_prologue == source_prologue, (name, "original prologue changed")
        checked = builder.check_body(body, target)
        assert not body[7], (name, "body traits need explicit serialization")
        assert builder.freeze(body[:5] + body[6:]) == builder.freeze(current.bodies[target_bi][:5] + current.bodies[target_bi][6:]), (name, "body metadata changed")
        assert builder.freeze(target.methods[mid]) == builder.freeze(current.methods[mid]), (name, "MethodInfo changed")
        target.bodies[target_bi] = body
        new_view = view(target)
        left, left_ex = current_view.normalized(target_bi)
        right, right_ex = new_view.normalized(target_bi)
        assert len(left) == len(right), (name, "instruction count changed")
        assert left_ex == right_ex, (name, "exception boundary changed")
        differences = [i for i, pair in enumerate(zip(left, right)) if pair[0] != pair[1]]
        count, slot_mapping = expected.get(name, (0, {}))
        assert len(differences) == count, (name, differences, count)
        old_ins, new_ins = builder.asm.decode(current.bodies[target_bi][5]), builder.asm.decode(body[5])
        edits = []
        for i in differences:
            before, after = old_ins[i], new_ins[i]
            assert before.name.startswith("setlocal_"), (name, i, before)
            assert after.name.startswith("setlocal"), (name, i, after)
            assert local(after) == slot_mapping[local(before)], (name, i, before, after)
            edits.append({"instruction": i, "before": before.name, "old_local": local(before),
                          "after": after.name, "new_local": local(after)})
        assert [token(ins)[2:] for ins in old_ins] == [token(ins)[2:] for ins in new_ins], (name, "control flow changed")
        records.append({"helper": name, "method_id": mid, "source_label": source_label,
                        "source_method_id": donor.bodies[source_bi][0], "current_body_sha256": digest(current.bodies[target_bi][5]),
                        "generated_body_sha256": digest(body[5]), "instruction_count": len(right),
                        "differences": edits, "check_body": checked,
                        "branch_switch_exception_semantics_preserved": True, "method_and_body_metadata_preserved": True})
        generated.append({"helper": name, "method_id": mid, "body_header": body[:5],
                          "code_hex": body[5].hex(), "exceptions": body[6], "traits": []})
    # Importing again against the current pools must not introduce references
    # unavailable to the original ABC used by the downstream AIR fixture.
    for pool in ("ints", "uints", "doubles", "strings", "namespaces", "ns_sets", "multinames"):
        assert builder.freeze(getattr(current, pool)) == builder.freeze(getattr(target, pool)), ("pool changed", pool)
    label = "pinball.common.data.character::BattleCharacterLogic/resolvePathCollection|1"
    resolved_mid = transforms.method_id_for_label(current_view, label)
    resolver = {"label": label, "body_index": current_view.by_label[label][0], "method_id": resolved_mid}
    assert resolver["body_index"] == 17701 and resolved_mid == 18392, resolver
    assert current_view.labels[17701] != label
    report = {"status": "seven_helpers_forward_generated_from_original_donor_and_eight_stores_corrected",
              "preparer": str(HERE / "prepare_ios.py"), "preparer_sha256": digest((HERE / "prepare_ios.py").read_bytes()),
              "full_abc": str(full_path), "full_abc_sha256": digest(full_bytes),
              "donor_swf": str(donor_path), "donor_swf_sha256": digest(donor_bytes),
              "method_count": len(current.methods), "resolver_identity": resolver,
              "records": records, "changed_store_count": sum(len(row["differences"]) for row in records),
              "pools_unchanged": True, "generation": "donor Importer.body followed by actual corrected transform functions",
              "historical_main_executed": False, "common_or_secret_module_imported": False,
              "ipa_built": False, "native_linked": False, "air_executed": False, "device_tested": False,
              "limits": ["The historical builder main is not replayed: its original base IPA/full ABC are not inputs to this test.",
                         "Current method metadata, native ABI, full IPA assembly and device behavior are outside this pure-transform replay."]}
    output.mkdir(parents=True, exist_ok=True)
    for name, value in (("forward-replay.json", report), ("generated-bodies.json", generated)):
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "methods": len(records), "changed_store_count": report["changed_store_count"],
                      "resolver_identity": resolver, "output": str(output)}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replay-inputs", type=Path)
    parser.add_argument("--donor-swf", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.replay_inputs and (not args.donor_swf or not args.output):
        parser.error("--replay-inputs requires --donor-swf and --output")
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
        summary = {"tests_run": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
                   "successful": result.wasSuccessful(), "read_write_mapping_subcases": 80,
                   "preparer_sha256": hashlib.sha256((HERE / "prepare_ios.py").read_bytes()).hexdigest(),
                   "test_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   "python": sys.executable}
        (args.output / "unit-tests.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    if not result.wasSuccessful():
        raise SystemExit(1)
    if args.replay_inputs:
        forward_replay(args.replay_inputs, args.donor_swf, args.output)


if __name__ == "__main__":
    main()
