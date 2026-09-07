"""九尾狐「详情面板文案覆盖」客户端补丁(V11)的回归测试。

补丁只改 ``pinball.common.data.ability`` 的四个描述方法:
``AbilityLogic`` / ``LeaderAbilityLogic`` 的 ``getDescriptions`` 与
``getDescriptionWithSimplify``。命中条件是词条/队长技第 0 行的 ``string_id``
以 ``fox_oracle_autumn`` 开头,且 CDN 表 ``custom_ability_string`` 里存在
``desc_override_<string_id>`` 这一行;否则原样走官方生成器。

战斗逻辑(``pinball.scene.battle.*``)一个字节都不动——本文件把这条约束
写成断言,而不是写成注释。

本机没有 V10/V11 二进制证据时,依赖二进制的用例明确 skip;纯逻辑用例始终运行。
"""
from __future__ import annotations

import hashlib
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_DIR = ROOT / "client-patch" / "kyubi-panel-override"
BUILD = Path("D:/WF/out/newchars-panel-v11-20260906")
V10_EXPORT = BUILD / "v10-export/scripts"
V10_PCODE = BUILD / "v10-pcode/scripts/pinball/common/data/ability"
BASE_SWF = BUILD / "base-v10.swf"
FINAL_SWF = BUILD / "v11-minimal.swf"


def _load_module_set():
    """Load patch/pcode/verify under their own names without leaking them.

    ``pcode`` does ``from patch import ...`` and ``verify`` does ``import pcode``,
    so the plain names have to resolve to this module directory while the three
    files are being executed. ``sys.modules`` is restored afterwards so the rest
    of the discovery run is unaffected.
    """
    names = ("patch", "pcode", "verify")
    saved = {name: sys.modules.get(name) for name in names}
    path_added = str(MODULE_DIR) not in sys.path
    if path_added:
        sys.path.insert(0, str(MODULE_DIR))
    try:
        loaded = {}
        for name in names:
            spec = importlib.util.spec_from_file_location(name, MODULE_DIR / (name + ".py"))
            if spec is None or spec.loader is None:
                raise AssertionError(f"cannot load {name}.py")
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            spec.loader.exec_module(module)
            loaded[name] = module
        return loaded
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous
        if path_added:
            sys.path.remove(str(MODULE_DIR))


MODULES = _load_module_set()
patch = MODULES["patch"]
pcode = MODULES["pcode"]
verify = MODULES["verify"]


class ContractTests(unittest.TestCase):
    """覆盖键的契约与作用域,不需要任何本地二进制。"""

    def test_override_key_is_the_prefixed_string_id(self):
        self.assertEqual("desc_override_", patch.KEY_PREFIX)
        self.assertEqual("fox_oracle_autumn", patch.STRING_ID_PREFIX)
        self.assertEqual(patch.KEY_PREFIX + patch.STRING_ID_PREFIX, patch.GUARD_PREFIX)
        for string_id in ("fox_oracle_autumn", "fox_oracle_autumn_1", "fox_oracle_autumn_6"):
            self.assertTrue((patch.KEY_PREFIX + string_id).startswith(patch.GUARD_PREFIX))
        for foreign in ("seris_dragon_king_1", "gerald_1", "", "fox_oracle"):
            self.assertFalse((patch.KEY_PREFIX + foreign).startswith(patch.GUARD_PREFIX))

    def test_exactly_four_targets_and_no_battle_code(self):
        self.assertEqual(4, len(pcode.TARGETS))
        self.assertEqual({"AbilityLogic", "LeaderAbilityLogic"},
                         {target.cls for target in pcode.TARGETS})
        self.assertEqual({"getDescriptions", "getDescriptionWithSimplify"},
                         {target.method for target in pcode.TARGETS})
        self.assertEqual(4, len({target.body_index for target in pcode.TARGETS}))
        self.assertEqual([7435, 7436, 7772, 7773],
                         sorted(target.body_index for target in pcode.TARGETS))
        for target in pcode.TARGETS:
            for statement in target.code:
                self.assertNotIn("pinball.scene.battle", statement)
                self.assertNotIn("pinball.common.data.skill", statement)

    def test_probe_never_uses_the_throwing_accessor(self):
        """MasterMapBase.get() 在缺行时会空引用;只能用 getMaybe。"""
        for target in pcode.TARGETS:
            joined = "\n".join(target.code)
            self.assertIn('callproperty QName(PackageNamespace(""),"getMaybe"), 1', joined)
            self.assertNotIn('callproperty QName(PackageNamespace(""),"get"), 1', joined)
            self.assertNotIn('"getUiStringWithContext"', joined)

    def test_every_guard_falls_through_to_the_original_body(self):
        """任何一步不满足都必须跳到 SKIP,并且插入段只有一个 returnvalue 出口。"""
        for target in pcode.TARGETS:
            branches = [s for s in target.code
                        if s.split(" ")[0] in ("ifeq", "ifne", "ifle", "iflt", "iffalse", "jump")]
            to_skip = [s for s in branches if s.endswith(" " + pcode.SKIP)]
            self.assertEqual(6, len(to_skip), target.method)
            self.assertEqual(1, target.code.count("returnvalue"), target.method)
            self.assertEqual(target.code[-1], pcode.SKIP + ":")

    def test_simple_mode_flag_comes_from_the_same_place_as_the_native_body(self):
        """两个方法都跑 SkillReplaceStringTable,但 simple 开关来源必须各自对齐官方:

        ``getDescriptions`` 里官方是生成器构造函数从容器取
        (AbilityGroupingDescriptionGenerator.as:54),``getDescriptionWithSimplify``
        里官方用 param2 覆盖它。
        """
        array_method = pcode.BY_NAME[("AbilityLogic", "getDescriptions")]
        string_method = pcode.BY_NAME[("AbilityLogic", "getDescriptionWithSimplify")]
        for target in (array_method, string_method):
            self.assertIn("SkillReplaceStringTable", "\n".join(target.code))
        array_text = "\n".join(array_method.code)
        string_text = "\n".join(string_method.code)

        def gate(target):
            return target.code[target.code.index("iffalse " + pcode.JOIN) - 1]

        self.assertIn("getSimpleAbilityDescriptionEnabled", gate(array_method))
        self.assertEqual("getlocal2", gate(string_method))
        self.assertNotIn("getSimpleAbilityDescriptionEnabled", string_text)
        # 只有返回字符串的那个方法拼分隔符。
        self.assertNotIn("ability_description_delimiter", array_text)
        self.assertIn('pushstring "ability_description_delimiter_newline"', string_text)
        self.assertIn('pushstring "ability_description_delimiter"', string_text)

    def test_only_localcount_grows(self):
        for target in pcode.TARGETS:
            old_stack, old_locals = target.old_header
            new_stack, new_locals = target.new_header
            self.assertEqual(old_stack, new_stack, target.method)
            self.assertGreater(new_locals, old_locals, target.method)

    def test_expected_listing_resolves_labels_and_multinames(self):
        listing = verify.expected_listing([
            'getproperty QName(PackageNamespace(""),"values")',
            "ifeq Later",
            'pushstring "\\n"',
            "Later:",
            "returnvalue",
        ])
        # 插入点是第 2 条指令(getlocal0 / pushscope 之后),标签前有 3 条指令。
        self.assertEqual(verify.INSERT_AT, 2)
        self.assertEqual(["getproperty ::values", "ifeq #5", 'pushstring "\n"', "returnvalue"],
                         listing)


class SourceIntentTests(unittest.TestCase):
    """patch.py 生成的 AS3 只用于核对意图,但必须精确、可逆、幂等。"""

    def setUp(self):
        if not V10_EXPORT.is_dir():
            self.skipTest("V10 FFDec source export fixture is unavailable")

    def source(self, name):
        return (V10_EXPORT / patch.CLASS_PATHS[name]).read_text(encoding="utf-8")

    def test_locked_v10_sources(self):
        for name in patch.CLASS_PATHS:
            text = self.source(name).replace("\r\n", "\n")
            self.assertEqual(patch.V10_SOURCE_SHA256[name], patch.digest(text))

    def test_source_patch_is_reversible_and_idempotent(self):
        for name in patch.CLASS_PATHS:
            old = self.source(name)
            new = patch.patch_source(name, old)
            self.assertNotEqual(old, new)
            self.assertEqual(patch.unpatch_source(name, new), old.replace("\r\n", "\n"))
            self.assertEqual(patch.patch_source(name, new), new)

    def test_source_patch_fails_closed(self):
        for name in patch.CLASS_PATHS:
            old = self.source(name)
            with self.assertRaises(patch.PatchError):
                patch.patch_source(name, old + "// drift\n")
            new = patch.patch_source(name, old)
            with self.assertRaises(patch.PatchError):
                patch.patch_source(name, new.replace(patch.GUARD_PREFIX, "broken_prefix", 1))

    def test_native_generator_call_survives_in_both_methods(self):
        for name in patch.CLASS_PATHS:
            new = patch.patch_source(name, self.source(name))
            self.assertEqual(2, new.count("new AbilityGroupingDescriptionGenerator(logicAssets)"))
            self.assertEqual(1, new.count("_loc3_.stringfy(getDescriptionSources(),param1)"))
            self.assertEqual(1, new.count(
                "new AbilityGroupingDescriptionGenerator(logicAssets)"
                ".stringfyWithoutJoin(getDescriptionSources())"))


class PcodeSpliceTests(unittest.TestCase):
    """P-code 层:锁哈希、可逆、幂等,并拒绝任何漂移。"""

    def setUp(self):
        if not V10_PCODE.is_dir():
            self.skipTest("V10 FFDec P-code export fixture is unavailable")

    def block(self, target):
        text = (V10_PCODE / (target.cls + ".pcode")).read_text(encoding="utf-8")
        return pcode.extract(text, target)

    def test_locked_v10_blocks(self):
        for target in pcode.TARGETS:
            self.assertEqual(target.block_sha256,
                             hashlib.sha256(self.block(target).encode()).hexdigest())

    def test_splice_is_reversible_and_idempotent(self):
        for target in pcode.TARGETS:
            original = self.block(target)
            patched = pcode.patch_block(original, target)
            self.assertNotEqual(original, patched)
            self.assertEqual(original, pcode.unpatch_block(patched, target))
            self.assertEqual(patched, pcode.patch_block(patched, target))
            self.assertIn("localcount %d" % target.new_header[1], patched)

    def test_splice_lands_after_the_scope_setup(self):
        for target in pcode.TARGETS:
            patched = pcode.patch_block(self.block(target), target)
            body = patched[patched.index("\n", patched.index("            code")):]
            statements = [line.strip() for line in body.split("\n") if line.strip()]
            self.assertEqual(["getlocal0", "pushscope", "getlocal0"], statements[:3])
            self.assertEqual(target.code, statements[2:2 + len(target.code)])

    def test_splice_rejects_drift_and_partial_patches(self):
        for target in pcode.TARGETS:
            original = self.block(target)
            with self.assertRaises(pcode.PatchError):
                pcode.patch_block(original.replace("maxstack", "maxstck", 1), target)
            with self.assertRaises(pcode.PatchError):
                pcode.patch_block(original.replace("initscopedepth 1", "initscopedepth 2", 1), target)
            patched = pcode.patch_block(original, target)
            with self.assertRaises(pcode.PatchError):
                pcode.unpatch_block(patched.replace(patch.GUARD_PREFIX, "wrong", 1), target)

    def test_a_changed_guard_prefix_is_a_different_patch(self):
        """红线用例:改了守卫常量,锁住的块哈希就必须对不上。"""
        target = pcode.TARGETS[0]
        original = self.block(target)
        patched = pcode.patch_block(original, target)
        tampered = patched.replace('pushstring "%s"' % patch.GUARD_PREFIX,
                                   'pushstring "desc_override_"', 1)
        with self.assertRaises(pcode.PatchError):
            pcode.unpatch_block(tampered, target)


class BinaryTests(unittest.TestCase):
    """独立解析器对成品 SWF 的静态证明。"""

    def setUp(self):
        if not (BASE_SWF.is_file() and FINAL_SWF.is_file()):
            self.skipTest("V10/V11 SWF fixtures are unavailable")

    def test_base_swf_is_the_locked_v10_input(self):
        self.assertEqual(patch.V10_SWF_SHA256,
                         hashlib.sha256(BASE_SWF.read_bytes()).hexdigest())

    def test_only_four_method_bodies_change(self):
        report = verify.verify(BASE_SWF, FINAL_SWF)
        self.assertEqual("verified", report["status"])
        self.assertEqual([347], report["changed_tags"])
        self.assertEqual([7435, 7436, 7772, 7773], report["changed_method_bodies"])
        self.assertEqual(0, report["added_multinames"])
        self.assertEqual(0, report["added_instance_traits"])
        self.assertEqual([patch.KEY_PREFIX, patch.GUARD_PREFIX], report["added_pool_strings"])
        for entry in report["proof"].values():
            self.assertEqual([], entry["stack"]["errors"])
            self.assertEqual(0, entry["stack"]["unreachable"])
            self.assertLessEqual(entry["stack"]["max_stack_computed"],
                                 entry["stack"]["max_stack_declared"])

    def test_new_classes_already_had_a_getlex_precedent(self):
        """getlex 一个构建里没有的类会硬崩;这两个类必须早就被 getlex 过。"""
        report = verify.verify(BASE_SWF, FINAL_SWF)
        for name in verify.REQUIRED_CLASSES:
            precedent = report["getlex_precedent"][name]
            self.assertGreaterEqual(len(precedent["existing_getlex_bodies"]), 2, name)

    def test_verifier_rejects_an_unpatched_and_a_wrong_base(self):
        with self.assertRaises(verify.PatchError):
            verify.verify(BASE_SWF, BASE_SWF)
        with self.assertRaises(verify.PatchError):
            verify.verify(FINAL_SWF, FINAL_SWF)


if __name__ == "__main__":
    unittest.main()
