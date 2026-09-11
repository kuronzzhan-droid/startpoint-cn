"""执行实际插入指令的隔离 VM；V14 fixture 仅内存改写并独立比较 ABC。"""
from __future__ import annotations

from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace as Obj
import unittest
from unittest.mock import patch as mock_patch

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("celtie_ability_actions_patch", HERE / "patch.py")
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
asm = patch.asm
FIXTURE = Path("D:/WF/out/newchars-v14-20260908/v14.swf")


def strict_equal(a, b):
    if type(a) in (int, float) and type(b) in (int, float):
        return a == b
    if type(a) in (bool, str, type(None)) and type(a) is type(b):
        return a == b
    return a is b


def execute(ins, strings, registers, stack):
    """只解释插入块所用 opcode；不另写补丁的白名单/伤害来源模型。"""
    names = {v: k for k, v in patch.QNAME_IDS.items()}
    pc = 0
    reference_class = Obj(AttackParameter=lambda n: ("AttackParameter", n))
    while pc < len(ins):
        instruction = ins[pc]
        name, args = instruction.name, instruction.args
        pc += 1
        if name == "getlocal_0": stack.append(registers[0])
        elif name == "dup": stack.append(stack[-1])
        elif name == "swap": stack[-2:] = stack[-2:][::-1]
        elif name == "pushstring": stack.append(strings[args[0]].decode())
        elif name == "pushbyte": stack.append(args[0])
        elif name == "pushtrue": stack.append(True)
        elif name == "pushfalse": stack.append(False)
        elif name == "getproperty":
            obj = stack.pop()
            stack.append(obj[names[args[0]]] if isinstance(obj, dict) else getattr(obj, names[args[0]]))
        elif name == "setproperty":
            value, obj = stack.pop(), stack.pop()
            obj[names[args[0]]] = value
        elif name == "getlex":
            assert names[args[0]] == "NormalAttackReferenceParameter"
            stack.append(reference_class)
        elif name == "callproperty":
            vals = [stack.pop() for _ in range(args[1])][::-1]
            obj = stack.pop()
            stack.append(getattr(obj, names[args[0]])(*vals))
        elif name == "strictequals":
            b, a = stack.pop(), stack.pop()
            stack.append(strict_equal(a, b))
        elif name == "ifstricteq":
            b, a = stack.pop(), stack.pop()
            if strict_equal(a, b): pc = instruction.target
        elif name == "iffalse":
            if not stack.pop(): pc = instruction.target
        elif name == "jump": pc = instruction.target
        else: raise AssertionError("unhandled opcode: " + name)
    return stack


def attack(origin, channel):
    values = {f"unrelated{i}": object() for i in range(36)}
    values.update(originMemberKind=origin, multiplierOfAttackPoint=2_500_000,
                  createdByAbility=False, createdByUnisonAbility=False,
                  createdByMainSkillAction=channel == "main",
                  createdByUnisonSkillAction=channel == "unison",
                  createdByPowerFlipAction=channel == "pf", createdBySkillInvoker=True,
                  buffTargetAs=1, powerFlipChargeLv=3,
                  reference=("SkillParameter", 4_000_000),
                  createdByDirectAttack=False, element=3)
    return values


class InstructionContractTest(unittest.TestCase):
    def setUp(self):
        self.abc = Obj(strings=[b""], multinames=[None], ints=[0])
        self.pool = patch.PoolEditor(self.abc)
        self.ins = patch.block(self.pool, patch.QNAME_IDS)

    def run_block(self, action, cache, value):
        calls = []
        def lookup(path):
            calls.append(path)
            return cache.get(path)
        evaluator = Obj(get_action=lambda: action,
                        get_zone=lambda: Obj(asset=Obj(_getActionDsl=lookup)))
        under_stack = object()
        result = execute(self.ins, self.abc.strings, {0: evaluator}, [under_stack, value])
        self.assertEqual(2, len(result))
        self.assertIs(under_stack, result[0])
        self.assertIs(value, result[1])
        self.assertTrue(all(path in patch.ACTION_PATHS for path in calls))
        return calls

    def test_exact_five_paths_main_unison_pf_use_ability_attack_parameter(self):
        self.assertEqual(5, len(set(patch.ACTION_PATHS)))
        fields = {"createdByAbility", "createdByUnisonAbility", "createdByMainSkillAction",
                  "createdByUnisonSkillAction", "createdByPowerFlipAction",
                  "createdBySkillInvoker", "buffTargetAs", "powerFlipChargeLv", "reference"}
        for path in patch.ACTION_PATHS:
            for origin in (0, 1, 2):
                for channel in ("main", "unison", "pf"):
                    with self.subTest(path=path, origin=origin, channel=channel):
                        action_object = object()
                        value = attack(origin, channel)
                        original = value.copy()
                        self.run_block(action_object, {path: action_object}, value)
                        self.assertTrue(value["createdByAbility"])
                        self.assertEqual(origin == 1, value["createdByUnisonAbility"])
                        for flag in ("createdByMainSkillAction", "createdByUnisonSkillAction",
                                     "createdByPowerFlipAction", "createdBySkillInvoker"):
                            self.assertFalse(value[flag])
                        self.assertEqual((0, 0), (value["buffTargetAs"], value["powerFlipChargeLv"]))
                        self.assertEqual(("AttackParameter", 2_500_000), value["reference"])
                        self.assertEqual({k: v for k, v in original.items() if k not in fields},
                                         {k: v for k, v in value.items() if k not in fields})

    def test_similar_paths_stock_action_and_equal_objects_do_not_match(self):
        for path in patch.ACTION_PATHS:
            for near in (path + ".action.dsl.amf3.deflate", path + "_other", path[:-1], path.upper()):
                obj, value = object(), attack(1, "unison")
                original = value.copy()
                self.run_block(obj, {near: obj}, value)
                self.assertEqual(original, value)
        stock = "battle/action/skill/action/ability_skill/wind_spgirl_campus$wind_spgirl_campus_flip_stock"
        obj, value = object(), attack(0, "pf")
        original = value.copy()
        self.run_block(obj, {stock: obj}, value)
        self.assertEqual(original, value)
        # Structurally equal ActionDsl objects are not identical cache objects.
        self.run_block({"path": "same"}, {patch.ACTION_PATHS[0]: {"path": "same"}}, value)
        self.assertEqual(original, value)

    def test_missing_cached_actions_and_null_current_action_are_harmless(self):
        for current in (None, object()):
            value = attack(0, "main")
            original = value.copy()
            calls = self.run_block(current, {}, value)
            self.assertEqual(original, value)
            self.assertEqual(0 if current is None else 5, len(calls))

    def test_no_local_or_action_kind_write_and_only_five_cache_strings(self):
        self.assertEqual(list(patch.ACTION_PATHS), self.pool.report()["added_strings"])
        self.assertEqual([], self.pool.report()["added_multinames"])
        self.assertEqual([], self.pool.report()["added_ints"])
        self.assertEqual(1, asm.block_locals(self.ins))
        self.assertFalse(any(x.name.startswith("setlocal") for x in self.ins))
        calls = {x.args[0] for x in self.ins if x.name == "callproperty"}
        self.assertEqual({patch.QNAME_IDS[k] for k in
                          ("get_action", "get_zone", "_getActionDsl", "AttackParameter")}, calls)


@unittest.skipUnless(FIXTURE.is_file(), "V14 SWF fixture is not present")
class FixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_sha = patch.sha(FIXTURE.read_bytes())
        cls.base = patch.SwfAbc(FIXTURE)
        cls.after = patch.SwfAbc(FIXTURE)
        cls.report = patch.patch_swf(cls.after)

    def test_fixture_method_only_change_is_reversible_and_stack_valid(self):
        report = self.report
        index = report["body_index"]
        self.assertEqual(patch.METHOD, patch.bodies.label_map(self.base.abc)[index])
        self.assertEqual(patch.HEADER, self.after.abc.bodies[index][1:5])
        self.assertEqual((109, 2), tuple(report["metrics"][:2]))
        self.assertTrue(report["independent_abc_verified"])
        self.assertEqual(self.base.abc.bodies[index][5], asm.unsplice(
            self.after.abc.bodies[index][5], patch.INSERT_AT, report["insert_count"]))
        self.assertEqual(self.original_sha, patch.sha(FIXTURE.read_bytes()))

    def test_repeated_patch_and_changed_method_hash_are_rejected(self):
        with self.assertRaises(asm.AsmError): patch.validate_baseline(self.after.abc)
        body = self.base.abc.bodies[self.report["body_index"]]
        old = body[5]
        try:
            body[5] = old + b"\x02"
            with self.assertRaisesRegex(asm.AsmError, "baseline"):
                patch.validate_baseline(self.base.abc)
        finally: body[5] = old

    def test_header_object_shape_and_qname_drift_are_rejected(self):
        body = self.base.abc.bodies[self.report["body_index"]]
        old_header, old_code = body[1:5], body[5]
        try:
            body[2] += 1
            with self.assertRaises(asm.AsmError): patch.validate_baseline(self.base.abc)
            body[1:5] = old_header
            ins = asm.decode(old_code)
            ins[patch.INSERT_AT - 1].args = [48]
            body[5] = asm.encode(ins)[0]
            with mock_patch.object(patch, "CODE_SHA", patch.sha(body[5])):
                with self.assertRaisesRegex(asm.AsmError, "boundary"):
                    patch.validate_baseline(self.base.abc)
        finally: body[1:5], body[5] = old_header, old_code
        abc = self.base.abc
        entry = abc.multinames[patch.QNAME_IDS["asset"]]
        try:
            abc.multinames.append(entry)
            with self.assertRaisesRegex(asm.AsmError, "ambiguous"): patch.qnames(abc)
        finally: abc.multinames.pop()
        try:
            abc.multinames[patch.QNAME_IDS["asset"]] = (7, 194, entry[2])
            with self.assertRaises(asm.AsmError): patch.qnames(abc)
        finally: abc.multinames[patch.QNAME_IDS["asset"]] = entry

    def test_independent_reader_detects_unrelated_method_change(self):
        abc = self.after.abc
        index = next(i for i in range(len(abc.bodies)) if i != self.report["body_index"])
        old = abc.bodies[index][5]
        try:
            abc.bodies[index][5] = old + b"\x02"
            with self.assertRaisesRegex(asm.AsmError, "changed methods"):
                patch.verify_structure(self.base._raw, abc.serialize(),
                                       self.report["body_index"], self.report["insert_count"])
        finally: abc.bodies[index][5] = old


if __name__ == "__main__":
    unittest.main()
