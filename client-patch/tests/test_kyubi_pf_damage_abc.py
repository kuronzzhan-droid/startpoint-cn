"""`kyubi-pf-damage-v1` 的指令级重做版（`abcpatch.py`）门禁。

旧实现（`patch.py` + FFDec 整类 AS3 回编）产出的 V9 在真机战斗里抛
`ReferenceError #1069`，已废弃。这里把新实现的关键前提写成断言：

  * 意图常量与旧实现逐字相同（程序路径、词条 id、来源号、档位区间）；
  * 五个插入点的**锚点形状**就是设计里说的那条语句
    （尤其 `_loc63_ = _loc62_.index == 5;` 这一处）；
  * `evalCommand` 里 `_loc63_/_loc4_/_loc5_/_loc24_` 确实是 63/4/5/24 号寄存器
    —— 用 CreateNormalAttack 对象字面量的消费点反证，不靠 FFDec 的命名习惯；
  * 每个插入块都能汇编、栈平衡、局部变量号不超出方法体声明；
  * 基线漂移、重复施工一律拒绝。
"""
import copy
import hashlib
import importlib.util
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ASM_DIR = REPO / "client-patch/abcasm"
MODULE_DIR = REPO / "client-patch/kyubi-pf-damage"
V13A_SWF = Path("D:/WF/out/newchars-v13-20260907/v13a.swf")


def _load(name, directory):
    spec = importlib.util.spec_from_file_location(name, Path(directory) / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class PfDamageAbcTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        saved = {name: sys.modules.get(name)
                 for name in ("asm", "bodies", "swfabc", "patch", "abcpatch")}
        added = [str(MODULE_DIR), str(ASM_DIR)]
        added = [d for d in added if d not in sys.path]
        for d in added:
            sys.path.insert(0, d)
        try:
            cls.asm = _load("asm", ASM_DIR)
            cls.bodies = _load("bodies", ASM_DIR)
            cls.swfabc = _load("swfabc", ASM_DIR)
            cls.intent = _load("patch", MODULE_DIR)
            cls.patch = _load("abcpatch", MODULE_DIR)
        finally:
            for name, previous in saved.items():
                if previous is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = previous
            for d in added:
                sys.path.remove(d)

    def swf(self):
        if not V13A_SWF.is_file():
            self.skipTest("local V13a fixture is unavailable: %s" % V13A_SWF)
        return self.swfabc.SwfAbc(V13A_SWF)

    # -- 意图与旧实现一致 ----------------------------------------------------
    def test_intent_constants_match_the_deprecated_source_patch(self):
        self.assertEqual(self.patch.MAIN_1, self.intent.MAIN_1)
        self.assertEqual(self.patch.MAIN_2, self.intent.MAIN_2)
        self.assertEqual(self.patch.SPECIAL, self.intent.SPECIAL)
        # 旧实现把这些数字写在 rules() 生成的 AS3 文本里，逐个对回来。
        text = "\n".join(new for _old, new in self.intent._rules("MemberImpl")) \
            + "\n".join(new for _old, new in self.intent._rules("AbilityDamageShot"))
        self.assertIn(str(self.patch.ABILITY2_CHARACTER_ID), text)
        self.assertIn(str(self.patch.ORIGIN_MAIN), text)
        self.assertIn(str(self.patch.ORIGIN_UNISON), text)
        self.assertIn("Math.max(1,Math.min(3,", text)
        self.assertEqual((self.patch.CHARGE_LV_MIN, self.patch.CHARGE_LV_MAX), (1, 3))

    # -- 基线与锚点 ----------------------------------------------------------
    def test_targets_match_the_v13a_baseline(self):
        abc = self.swf().abc
        for name, (sha256, header, _after) in self.patch.TARGETS.items():
            index = self.bodies.resolve(abc, name)
            body = abc.bodies[index]
            self.assertEqual(hashlib.sha256(body[5]).hexdigest(), sha256,
                             "%s: baseline code drifted" % name)
            self.assertEqual((body[1], body[2]), header, "%s: baseline header drifted" % name)
            self.assertEqual(body[6], [], "%s: baseline has an exception table" % name)

    def test_eval_command_anchor_is_the_power_flip_kind_test(self):
        """插入点必须紧跟 `_loc63_ = _loc62_.index == 5;`，不是随便一个 setlocal 63。"""
        abc = self.swf().abc
        body = abc.bodies[self.bodies.resolve(abc, "ActionEvaluator/evalCommand")]
        instructions = self.asm.decode(body[5])
        at = self.patch.INSERTIONS["ActionEvaluator/evalCommand"][0][0]
        window = instructions[at - 6:at]
        self.assertEqual([x.name for x in window],
                         ["getlocal", "getproperty", "pushbyte", "equals",
                          "convert_b", "setlocal"])
        self.assertEqual(window[0].args[0], 62)
        self.assertEqual(abc.mn_name(window[1].args[0]).split("::")[-1], "index")
        self.assertEqual(window[2].args[0], self.patch.POWER_FLIP_ACTION_KIND)
        self.assertEqual(window[5].args[0], self.patch.EVAL_REG_IS_PF)

    def test_eval_command_registers_are_proved_by_their_consumers(self):
        """`_locN_` 就是 N 号寄存器 —— 由 CreateNormalAttack 字面量的消费点反证。"""
        abc = self.swf().abc
        body = abc.bodies[self.bodies.resolve(abc, "ActionEvaluator/evalCommand")]
        instructions = self.asm.decode(body[5])
        want = {"createdByPowerFlipAction": self.patch.EVAL_REG_IS_PF,
                "createdByMainSkillAction": self.patch.EVAL_REG_MAIN_SKILL,
                "createdByUnisonSkillAction": self.patch.EVAL_REG_UNISON_SKILL,
                "powerFlipChargeLv": self.patch.EVAL_REG_CHARGE_LV}
        seen = {}
        for n, instruction in enumerate(instructions[:-1]):
            if instruction.name != "pushstring":
                continue
            key = abc.s(instruction.args[0])
            consumer = instructions[n + 1]
            if key in want and consumer.name == "getlocal":
                seen.setdefault(key, set()).add(consumer.args[0])
        for key, register in want.items():
            self.assertIn(register, seen.get(key, set()),
                          "no object literal feeds %r from register %d" % (key, register))

    def test_shot_finish_anchors_are_the_five_declared_values(self):
        abc = self.swf().abc
        body = abc.bodies[self.bodies.resolve(abc, "AbilityDamageShot/finish")]
        instructions = self.asm.decode(body[5])
        expected = {361: ("createdByPowerFlipAction", "pushfalse"),
                    369: ("createdByAbility", "pushtrue"),
                    371: ("createdByUnisonAbility", "getlocal"),
                    422: ("powerFlipChargeLv", "pushbyte"),
                    426: ("incrementCombo", "getlocal")}
        declared = [index for index, _key, _policy
                    in self.patch.INSERTIONS["AbilityDamageShot/finish"]]
        self.assertEqual(declared, sorted(expected))
        for at, (key, opcode) in expected.items():
            self.assertEqual(instructions[at - 1].name, opcode,
                             "the value instruction before %d is not %s" % (at, opcode))
            self.assertEqual(instructions[at - 2].name, "pushstring")
            self.assertEqual(abc.s(instructions[at - 2].args[0]), key)

    def test_member_context_anchor_is_the_ability_skill_object_literal(self):
        abc = self.swf().abc
        body = abc.bodies[self.bodies.resolve(abc, "MemberImpl/applyInstantAbility")]
        instructions = self.asm.decode(body[5])
        at = self.patch.INSERTIONS["MemberImpl/applyInstantAbility"][0][0]
        self.assertEqual(instructions[at - 1].name, "newobject")
        self.assertEqual(instructions[at - 1].args[0], 12)

    def test_start_power_flip_anchor_is_before_the_leader_check(self):
        abc = self.swf().abc
        body = abc.bodies[self.bodies.resolve(abc, "MemberImpl/startPowerFlip")]
        instructions = self.asm.decode(body[5])
        at = self.patch.INSERTIONS["MemberImpl/startPowerFlip"][0][0]
        self.assertEqual(instructions[at].name, "findproperty")
        self.assertEqual(abc.mn_name(instructions[at].args[0]).split("::")[-1], "isLeader")

    # -- 施工本身 ------------------------------------------------------------
    def test_patch_is_reversible_idempotent_and_minimal(self):
        swf = self.swf()
        before = {name: bytes(swf.abc.bodies[self.bodies.resolve(swf.abc, name)][5])
                  for name in self.patch.TARGETS}
        base_body_count = len(swf.abc.bodies)
        report = self.patch.apply_to_abc(swf)
        for name in self.patch.TARGETS:
            index = self.bodies.resolve(swf.abc, name)
            entries = report[name]["insertions"]
            code = swf.abc.bodies[index][5]
            placed = [(e["at_instruction"], e["instructions"]) for e in entries]
            for at, count in reversed(placed):
                code = self.asm.unsplice(code, at, count)
            self.assertEqual(code, before[name], "%s: the splice is not reversible" % name)
        self.assertEqual(len(swf.abc.bodies), base_body_count + self.patch.ADDED_METHODS)
        self.assertEqual(report["_pool"]["added_ints"],
                         [self.patch.ORIGIN_UNISON, self.patch.ABILITY2_CHARACTER_ID])
        with self.assertRaises(self.patch.PatchError):
            self.patch.apply_to_abc(swf)          # 幂等守卫：不许打第二次

    def test_a_drifted_baseline_is_refused(self):
        swf = self.swf()
        index = self.bodies.resolve(swf.abc, "AbilityDamageShot/finish")
        swf.abc.bodies[index] = copy.deepcopy(swf.abc.bodies[index])
        swf.abc.bodies[index][5] = swf.abc.bodies[index][5] + b"\x02"      # nop
        with self.assertRaises(self.patch.PatchError):
            self.patch.apply_to_abc(swf)

    def test_every_block_assembles_and_balances(self):
        swf = self.swf()
        pool = self.swfabc.PoolEditor(swf.abc)
        self.patch.MN = self.patch._resolve(swf.abc)
        new = {name: pool.public_qname(name, self.patch.MN["index"])
               for name in ("kyubiLastPowerFlipChargeLv", "kyubiIsPfAbilityDamage",
                            "kyubiGetPowerFlipChargeLv", "kyubiPfDamage", "kyubiPfChargeLv")}
        blocks = self.patch._blocks(pool, new)
        for key, block in blocks.items():
            instructions = self.asm.assemble(block)
            self.assertTrue(instructions, "%s assembled to nothing" % key)
            if key.startswith("_method_"):
                stack, scope, unreachable = self.asm.simulate(instructions, 1, swf.abc.multinames)
                self.assertEqual(unreachable, 0, "%s has unreachable instructions" % key)
                self.assertGreater(stack, 0)
                self.assertGreaterEqual(scope, 2)

    def test_declared_locals_fit_the_target_headers(self):
        swf = self.swf()
        pool = self.swfabc.PoolEditor(swf.abc)
        self.patch.MN = self.patch._resolve(swf.abc)
        new = {name: pool.public_qname(name, self.patch.MN["index"])
               for name in ("kyubiLastPowerFlipChargeLv", "kyubiIsPfAbilityDamage",
                            "kyubiGetPowerFlipChargeLv", "kyubiPfDamage", "kyubiPfChargeLv")}
        blocks = self.patch._blocks(pool, new)
        for name, entries in self.patch.INSERTIONS.items():
            declared_locals = self.patch.TARGETS[name][2][1]
            for _at, key, _policy in entries:
                needed = self.asm.block_locals(self.asm.assemble(blocks[key]))
                self.assertLessEqual(needed, declared_locals,
                                     "%s/%s needs %d locals" % (name, key, needed))


if __name__ == "__main__":
    unittest.main()
