"""方法体按名字定位（`client-patch/abcasm/bodies.py`）与 V13 链首改到 V8 的前提。

背景：V9 用 FFDec 整类回编替换了 `ActionEvaluator` / `MemberImpl` /
`AbilityDamageShot`，FFDec 把这三个类的方法体从原位摘走再追加到表尾，
从体 51410 起下标整体漂移。V13 从 V8 重建链，V12 两个模块里锁死的 V11 下标
因此全部作废——但方法名和基线 code 的 sha256 都没变。

这里把那个前提写成断言：

  * 在 V11 基线上，按名字解析出来的下标必须与 `TARGETS` 里锁的一模一样
    （名字解析器不会把已验证的 V12 链带偏）；
  * 在 V8 基线上，同样的名字都能唯一解析，且解析到的体的 code sha256
    与 `TARGETS` 锁的基线哈希逐字节相同（= V9 确实没碰过这些方法）；
  * 名字不存在 / 不唯一时解析器必须报错，不许猜。

外加 `kyubi-pf-combo/slot.py` 的基线白名单，和 `kyubi-fever-ratio/verify.py`
新加的单变量常量传播（statsKind 哨兵证明）。
"""
import hashlib
import importlib.util
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ASM_DIR = REPO / "client-patch/abcasm"
V8_SWF = Path("D:/WF/out/newchars-pf-v9-20260906/base-v8.swf")
V11_SWF = Path("D:/WF/out/newchars-v12-20260907/base-v11.swf")
V8_SWF_SHA256 = "c1c0782bed5bbcaaf097855c041e3b05100a46387d7cccc2ef9372d7b57744ed"


def _load(name, directory):
    spec = importlib.util.spec_from_file_location(name, Path(directory) / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _asm_modules():
    if str(ASM_DIR) not in sys.path:
        sys.path.insert(0, str(ASM_DIR))
    return _load("asm", ASM_DIR), _load("bodies", ASM_DIR), _load("swfabc", ASM_DIR)


def _module_targets(module_dir):
    """隔离加载某个模块的 patch.py（两个 V12 模块的 patch.py 同名）。"""
    saved = {name: sys.modules.get(name) for name in ("asm", "swfabc", "patch")}
    added = [str(module_dir), str(ASM_DIR)]
    added = [d for d in added if d not in sys.path]
    for d in added:
        sys.path.insert(0, d)
    try:
        _load("asm", ASM_DIR)
        _load("swfabc", ASM_DIR)
        return dict(_load("patch", module_dir).TARGETS)
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous
        for d in added:
            sys.path.remove(d)


class BodyResolverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.asm, cls.bodies, cls.swfabc = _asm_modules()
        cls.targets = {}
        for module in ("kyubi-fever-ratio", "dash-parameter"):
            cls.targets.update(_module_targets(REPO / "client-patch" / module))

    def _abc(self, path):
        if not path.is_file():
            self.skipTest("local binary fixture is unavailable: %s" % path)
        return self.swfabc.SwfAbc(path).abc

    def test_v11_names_resolve_to_the_locked_indices(self):
        abc = self._abc(V11_SWF)
        for name, entry in self.targets.items():
            self.assertEqual(self.bodies.resolve(abc, name), entry[0],
                             "%s no longer resolves to its locked V11 body index" % name)

    def test_v8_carries_the_same_bodies_under_different_indices(self):
        abc = self._abc(V8_SWF)
        self.assertEqual(hashlib.sha256(V8_SWF.read_bytes()).hexdigest(), V8_SWF_SHA256)
        moved = 0
        for name, entry in self.targets.items():
            index = self.bodies.resolve(abc, name)
            self.assertEqual(hashlib.sha256(abc.bodies[index][5]).hexdigest(), entry[1],
                             "%s: the V8 baseline code differs from the locked hash" % name)
            self.assertEqual((abc.bodies[index][1], abc.bodies[index][2]), entry[2],
                             "%s: the V8 baseline header differs" % name)
            if index != entry[0]:
                moved += 1
        self.assertGreater(moved, 0, "V9 is supposed to have shifted at least some indices")

    def test_v10_targets_resolve_on_both_baselines(self):
        for path, expected in ((V11_SWF, {"ActionEvaluationResolver/<ctor>": 52311,
                                          "BallImpl/resolveCollisionForPrimaryOrSummons": 59953}),
                               (V8_SWF, {"ActionEvaluationResolver/<ctor>": 52322,
                                         "BallImpl/resolveCollisionForPrimaryOrSummons": 60035})):
            abc = self._abc(path)
            for name, index in expected.items():
                self.assertEqual(self.bodies.resolve(abc, name), index)

    def test_unknown_and_ambiguous_names_are_refused(self):
        abc = self._abc(V8_SWF)
        with self.assertRaises(self.asm.AsmError):
            self.bodies.resolve(abc, "NoSuchClass/noSuchMethod")
        labels = list(self.bodies.label_map(abc).values())
        duplicated = next((x for x in labels if labels.count(x) > 1), None)
        if duplicated is None:
            self.skipTest("this ABC has no duplicated class/method label to test with")
        with self.assertRaises(self.asm.AsmError):
            self.bodies.resolve(abc, duplicated)


class SlotBaselineTests(unittest.TestCase):
    def test_slot_accepts_exactly_the_two_approved_baselines(self):
        module_dir = REPO / "client-patch/kyubi-pf-combo"
        saved = {name: sys.modules.get(name) for name in ("patch", "slot")}
        sys.path.insert(0, str(module_dir))
        try:
            patch = _load("patch", module_dir)
            slot = _load("slot", module_dir)
            self.assertEqual(set(slot.ACCEPTED_BASE_SWF_SHA256),
                             {patch.V9_SWF_SHA256, V8_SWF_SHA256})
            self.assertEqual(slot.V8_SWF_SHA256, V8_SWF_SHA256)
        finally:
            for name, previous in saved.items():
                if previous is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = previous
            sys.path.remove(str(module_dir))


class StatsKindPropagationTests(unittest.TestCase):
    """`kyubi-fever-ratio/verify.py` 的单变量常量传播。

    老判据「整个方法体里没有 >= 100 的字面量」在原版 V8 的
    `ActionEvaluator.evalCommand` 上根本不成立（V9 的 FFDec 回编把大常量改写成
    `pushint`，老判据在 V9 链上是空过的）。新判据必须真的看数据流。
    """

    @classmethod
    def setUpClass(cls):
        cls.asm, _bodies, _swfabc = _asm_modules()
        module_dir = REPO / "client-patch/kyubi-fever-ratio"
        saved = {name: sys.modules.get(name) for name in ("asm", "swfabc", "patch",
                                                          "abcpatch", "verify")}
        added = [str(module_dir), str(ASM_DIR), str(REPO / "client-patch/rank-scene-p2")]
        added = [d for d in added if d not in sys.path]
        for d in added:
            sys.path.insert(0, d)
        try:
            _load("asm", ASM_DIR)
            _load("swfabc", ASM_DIR)
            _load("patch", module_dir)
            _load("abcpatch", module_dir)
            cls.verify = _load("verify", module_dir)
        finally:
            for name, previous in saved.items():
                if previous is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = previous
            for d in added:
                sys.path.remove(d)

    POOLS = {"ints": [0, 500]}

    def _body(self, source):
        code, _offsets = self.asm.encode(self.asm.assemble(source))
        return {"code": code, "ex": []}

    def test_two_literal_branches_merge_into_a_constant_set(self):
        # `pushbyte 3` 本身是 iffalse 的落点 —— 官方 switch 的 case 入口就是这个形状,
        # 字面量当分支目标不影响「它一定被执行」,必须照样算成常量。
        body = self._body([
            ("pushtrue",), ("iffalse", "ALT"),
            ("pushbyte", 4), ("convert_i",), ("setlocal", 16), ("jump", "JOIN"),
            ("label", "ALT"), ("pushbyte", 3), ("convert_i",), ("setlocal", 16),
            ("label", "JOIN"), ("getlocal", 16), ("returnvoid",),
        ])
        self.assertEqual(self.verify.local_constants_at(body, self.POOLS, 16, 9), [3, 4])

    def test_a_parameter_passthrough_is_not_provably_constant(self):
        body = self._body([("getlocal", 2), ("returnvoid",)])
        self.assertIsNone(self.verify.local_constants_at(body, self.POOLS, 2, 0))

    def test_a_branch_landing_between_the_literal_and_the_store_poisons_it(self):
        # jump 落在 convert_i 上，另一条路径把 200 留在栈顶 —— 不能当成常量 3。
        body = self._body([
            ("pushbyte", 3), ("jump", "MID"), ("pushshort", 200),
            ("label", "MID"), ("convert_i",), ("setlocal", 16),
            ("getlocal", 16), ("returnvoid",),
        ])
        self.assertIsNone(self.verify.local_constants_at(body, self.POOLS, 16, 6))

    def test_a_sentinel_range_literal_is_reported_not_hidden(self):
        body = self._body([
            ("pushshort", 150), ("convert_i",), ("setlocal", 16),
            ("getlocal", 16), ("returnvoid",),
        ])
        values = self.verify.local_constants_at(body, self.POOLS, 16, 3)
        self.assertEqual(values, [150])
        self.assertFalse(all(v < self.verify.RATIO_STATS_SENTINEL for v in values))

    def test_pushint_pool_constants_are_read_from_the_pool(self):
        body = self._body([
            ("pushint", 1), ("convert_i",), ("setlocal", 16),
            ("getlocal", 16), ("returnvoid",),
        ])
        self.assertEqual(self.verify.local_constants_at(body, self.POOLS, 16, 3), [500])

    def test_an_incrementing_loop_widens_to_unknown_instead_of_hanging(self):
        body = self._body([
            ("pushbyte", 0), ("convert_i",), ("setlocal", 16),
            ("label", "LOOP"), ("inclocal_i", 16), ("jump", "LOOP"),
        ])
        # 循环里 inclocal_i 会让集合无限增长；widening 必须收敛到「未知」。
        self.assertIsNone(self.verify.local_constants_at(body, self.POOLS, 16, 4))

    def test_a_non_literal_store_poisons_the_local(self):
        body = self._body([
            ("getlocal", 1), ("setlocal", 16),
            ("getlocal", 16), ("returnvoid",),
        ])
        self.assertIsNone(self.verify.local_constants_at(body, self.POOLS, 16, 2))


if __name__ == "__main__":
    unittest.main()
