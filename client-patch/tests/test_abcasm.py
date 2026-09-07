"""`client-patch/abcasm/asm.py` —— AVM2 汇编器 / 拼接器的回归测试。

V12 的两个补丁全靠它在字节码层面插指令,所以这里把它的三条命根子写成断言:
  1. `decode` / `encode` 对**真实**方法体逐字节往返(不是只对造出来的样例);
  2. `splice` 之后所有分支仍然指向原来那条指令,`unsplice` 能逐字节还原;
  3. `assemble` 对未知助记符、操作数个数不对、跳到不存在的标签一律当场拒绝。

没有本机 SWF 时,依赖二进制的用例 skip;纯逻辑用例始终运行。
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASM_DIR = ROOT / "client-patch" / "abcasm"
BASE_SWF = Path("D:/WF/out/newchars-v12-20260907/base-v11.swf")


def _load(name: str, directory: Path = ASM_DIR):
    saved = sys.modules.get(name)
    added = str(directory) not in sys.path
    if added:
        sys.path.insert(0, str(directory))
    try:
        spec = importlib.util.spec_from_file_location(name, directory / (name + ".py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if saved is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = saved
        if added:
            sys.path.remove(str(directory))


asm = _load("asm")


def body(code: bytes, maxstack=8, localcount=4, initscope=1, maxscope=2, exceptions=()):
    return [0, maxstack, localcount, initscope, maxscope, code, list(exceptions), []]


class AssemblerTests(unittest.TestCase):
    def test_labels_and_end_resolve_to_instruction_indexes(self):
        block = asm.assemble([
            ("getlocal_1",),
            ("pushbyte", 5),
            ("ifne", "END"),
            ("jump", "TAIL"),
            ("label", "TAIL"),
            ("returnvoid",),
        ])
        self.assertEqual([x.name for x in block],
                         ["getlocal_1", "pushbyte", "ifne", "jump", "returnvoid"])
        self.assertEqual(block[2].target, 5)      # END = 块尾(= 被顶开的原指令)
        self.assertEqual(block[3].target, 4)      # TAIL = returnvoid

    def test_unknown_mnemonic_is_refused(self):
        with self.assertRaises(asm.AsmError):
            asm.assemble([("getlocal9",)])

    def test_operand_count_is_checked(self):
        with self.assertRaises(asm.AsmError):
            asm.assemble([("callproperty", 12)])
        with self.assertRaises(asm.AsmError):
            asm.assemble([("pushbyte",)])

    def test_undefined_label_is_refused(self):
        with self.assertRaises(asm.AsmError):
            asm.assemble([("jump", "NOWHERE")])

    def test_duplicate_label_is_refused(self):
        with self.assertRaises(asm.AsmError):
            asm.assemble([("label", "X"), ("label", "X")])

    def test_negative_operands_are_refused(self):
        with self.assertRaises(asm.AsmError):
            asm.assemble([("pushbyte", -1)])

    def test_block_locals_counts_every_local_form(self):
        block = asm.assemble([
            ("getlocal_3",), ("setlocal", 9), ("inclocal_i", 12), ("getlocal_0",),
        ])
        self.assertEqual(13, asm.block_locals(block))


class RoundTripTests(unittest.TestCase):
    def test_encode_decode_is_byte_exact_for_branches_and_switches(self):
        # jump 前跳、条件分支后跳、lookupswitch 三种目标各来一份
        original = asm.encode(asm.assemble([
            ("pushbyte", 1),
            ("iffalse", "BACK"),
            ("jump", "FORWARD"),
            ("label", "BACK"),
            ("pushbyte", 2),
            ("pop",),
            ("label", "FORWARD"),
            ("returnvoid",),
        ]))[0]
        self.assertEqual(original, asm.encode(asm.decode(original))[0])

    def test_branch_to_end_of_code_survives(self):
        code = asm.encode(asm.assemble([("pushbyte", 0), ("iffalse", "END"), ("returnvoid",)]))[0]
        instructions = asm.decode(code)
        self.assertEqual(instructions[1].target, len(instructions))
        self.assertEqual(code, asm.encode(instructions)[0])

    def test_off_boundary_branch_is_refused(self):
        # jump 落在 pushshort 的操作数中间
        with self.assertRaises(asm.AsmError):
            asm.decode(bytes([0x10, 0x01, 0x00, 0x00, 0x25, 0x80, 0x02, 0x47]))


class SpliceTests(unittest.TestCase):
    def setUp(self):
        self.code = asm.encode(asm.assemble([
            ("getlocal_0",),                 # 0
            ("pushscope",),                  # 1
            ("pushbyte", 7),                 # 2
            ("iffalse", "SKIP"),             # 3  -> #6
            ("pushbyte", 1),                 # 4
            ("pop",),                        # 5
            ("label", "SKIP"),
            ("returnvoid",),                 # 6
        ]))[0]

    def test_insert_shifts_only_the_branches_that_cross_it(self):
        block = asm.assemble([("pushbyte", 3), ("pop",)])
        new_code, exceptions, merged = asm.splice(body(self.code), 2, block)
        self.assertEqual(exceptions, [])
        instructions = asm.decode(new_code)
        self.assertEqual(len(instructions), 9)
        self.assertEqual([x.name for x in instructions][2:4], ["pushbyte", "pop"])
        # 原来 #3 的 iffalse 现在在 #5,目标从 #6 平移到 #8
        self.assertEqual(instructions[5].name, "iffalse")
        self.assertEqual(instructions[5].target, 8)
        self.assertEqual(instructions[8].name, "returnvoid")

    def test_unsplice_is_byte_exact(self):
        block = asm.assemble([("pushbyte", 3), ("pop",)])
        new_code, _exceptions, _merged = asm.splice(body(self.code), 2, block)
        self.assertEqual(asm.unsplice(new_code, 2, 2), self.code)

    def test_unsplice_refuses_to_cut_a_branch_target(self):
        # 插一块,然后谎报它从下标 3 开始:此时 #5 的 iffalse 目标仍在块外,
        # 但被摘掉的区间里含有原指令 -> 还原结果必然不等于原体。
        block = asm.assemble([("pushbyte", 3), ("pop",)])
        new_code, _e, _m = asm.splice(body(self.code), 2, block)
        self.assertNotEqual(asm.unsplice(new_code, 3, 2), self.code)

    def test_splice_many_applies_ascending_and_reverses(self):
        first = asm.assemble([("pushbyte", 3), ("pop",)])
        second = asm.assemble([("pushbyte", 4), ("pop",)])
        new_code, _exceptions, _merged, placed = asm.splice_many(
            body(self.code), [(2, first), (4, second)])
        self.assertEqual(placed, [(2, 2, asm.FORBID), (6, 2, asm.FORBID)])
        self.assertEqual(asm.unsplice_many(new_code, placed), self.code)
        instructions = asm.decode(new_code)
        # 第一块把 iffalse 从 #3 顶到 #5;第二块插在它后面,只挪它的目标。
        self.assertEqual(instructions[5].name, "iffalse")
        self.assertEqual(instructions[5].target, 10)
        self.assertEqual(instructions[10].name, "returnvoid")

    def test_insertion_on_a_branch_target_is_refused_by_default(self):
        """V12 真踩过的坑:插入点同时是某条分支的落点,默认必须报错。

        `BallImpl.update` 的冷却帧插入点就是 `isSwifting()` 假分支的落点;
        按「分支落到块后」拼进去,插入的代码只在一条路径上跑。
        """
        block = asm.assemble([("pushbyte", 3), ("pop",)])
        with self.assertRaises(asm.AsmError):
            asm.splice(body(self.code), 6, block)          # #3 的 iffalse 指向 #6

    def test_enter_makes_every_path_run_the_block(self):
        block = asm.assemble([("pushbyte", 3), ("pop",)])
        new_code, _e, _m = asm.splice(body(self.code), 6, block, incoming=asm.ENTER)
        instructions = asm.decode(new_code)
        self.assertEqual(instructions[3].name, "iffalse")
        self.assertEqual(instructions[3].target, 6)        # 落在块开头
        self.assertEqual(instructions[6].name, "pushbyte")
        self.assertEqual(asm.unsplice(new_code, 6, 2), self.code)

    def test_skip_makes_the_branch_land_after_the_block(self):
        block = asm.assemble([("pushbyte", 3), ("pop",)])
        new_code, _e, _m = asm.splice(body(self.code), 6, block, incoming=asm.SKIP)
        instructions = asm.decode(new_code)
        self.assertEqual(instructions[3].target, 8)        # 落在块之后
        self.assertEqual(instructions[8].name, "returnvoid")
        self.assertEqual(asm.unsplice(new_code, 6, 2), self.code)

    def test_unknown_policy_is_refused(self):
        with self.assertRaises(asm.AsmError):
            asm.splice(body(self.code), 2, asm.assemble([("pop",)]), incoming="whatever")

    def test_splice_many_refuses_unordered_points(self):
        block = asm.assemble([("pop",)])
        with self.assertRaises(asm.AsmError):
            asm.splice_many(body(self.code), [(4, block), (2, block)])

    def test_exception_ranges_move_with_the_code(self):
        instructions = asm.decode(self.code)
        offsets = asm.encode(instructions)[1]
        source = body(self.code, exceptions=[(offsets[2], offsets[5], offsets[6], 0, 0)])
        block = asm.assemble([("pushbyte", 3), ("pop",)])
        _code, exceptions, _merged = asm.splice(source, 2, block)
        # 插入点正好是 try 的起点:整段 [from, to) 与 target 一起后移
        self.assertEqual(len(exceptions), 1)
        start, stop, target, _type, _var = exceptions[0]
        self.assertGreater(start, offsets[2])
        self.assertEqual(stop - start, offsets[5] - offsets[2])
        self.assertGreater(target, offsets[6])


class SimulateTests(unittest.TestCase):
    def test_merge_conflict_is_reported(self):
        instructions = asm.assemble([
            ("pushbyte", 1),
            ("iffalse", "JOIN"),
            ("pushbyte", 2),
            ("label", "JOIN"),
            ("returnvoid",),
        ])
        with self.assertRaises(asm.AsmError):
            asm.simulate(instructions, 1)

    def test_underflow_is_reported(self):
        with self.assertRaises(asm.AsmError):
            asm.simulate(asm.assemble([("pop",), ("returnvoid",)]), 1)

    def test_max_stack_and_unreachable_are_counted(self):
        instructions = asm.assemble([
            ("pushbyte", 1),
            ("pushbyte", 2),
            ("add",),
            ("pop",),
            ("returnvoid",),
            ("pushbyte", 9),      # 终止指令之后:不可达
            ("pop",),
        ])
        maximum_stack, maximum_scope, unreachable = asm.simulate(instructions, 1)
        self.assertEqual((maximum_stack, maximum_scope, unreachable), (2, 1, 2))


class RealBodyTests(unittest.TestCase):
    """对真实主 ABC 的全量往返 —— 这是「插入不会错位」最硬的证据。"""

    @classmethod
    def setUpClass(cls):
        if not BASE_SWF.is_file():
            raise unittest.SkipTest("V11 base SWF is unavailable")
        swfabc = _load("swfabc")
        cls.swf = swfabc.SwfAbc(BASE_SWF)

    def test_every_method_body_round_trips_byte_exactly(self):
        broken = []
        for index, item in enumerate(self.swf.abc.bodies):
            instructions = asm.decode(item[5])
            if asm.encode(instructions)[0] != item[5]:
                broken.append(index)
        self.assertEqual([], broken[:20])
        self.assertGreater(len(self.swf.abc.bodies), 90000)

    def test_splice_into_a_huge_switch_body_is_reversible(self):
        # AbilityValues.parseAt47:18045 条指令、724 处死 jump、一条 51KB 的 if 链
        item = self.swf.abc.bodies[39128]
        block = asm.assemble([("getlocal_2",), ("pushbyte", 0), ("ifne", "END"),
                              ("returnvoid",)])
        code, exceptions, merged = asm.splice(item, 6, block)
        self.assertEqual(exceptions, item[6])
        self.assertEqual(len(merged), len(asm.decode(item[5])) + 4)
        self.assertEqual(asm.unsplice(code, 6, 4), item[5])


if __name__ == "__main__":
    unittest.main()
