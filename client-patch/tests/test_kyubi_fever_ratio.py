"""instant_content 724 `AddFeverPointRatio`(V12)客户端补丁的回归测试。

契约用例不碰二进制,始终跑;端到端用例需要本机的 V11 基线 SWF,缺了就 skip。

这里的核心断言:
  * 补丁只碰**瞬发说明 + Fever 槽**这一条链,战斗数值/PF/技能等一律不动;
  * `patch.py` 里那七个方法体下标不是抄来的常量 —— 用例按类名+方法名从
    真实 ABC 里重新解析一遍再比;
  * 补丁可逆、幂等、对漂移的输入当场拒绝;
  * `verify.py` 的独立复核在真实产物上通过,且改坏产物必然复核失败。
"""
from __future__ import annotations

import hashlib
import importlib.util
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_DIR = ROOT / "client-patch" / "kyubi-fever-ratio"
ASM_DIR = ROOT / "client-patch" / "abcasm"
BUILD = Path("D:/WF/out/newchars-v12-20260907")
BASE_SWF = BUILD / "base-v11.swf"


def _load_modules():
    names = ("asm", "swfabc", "patch", "abcpatch", "verify")
    saved = {name: sys.modules.get(name) for name in names}
    added = [d for d in (str(MODULE_DIR), str(ASM_DIR),
                         str(ROOT / "client-patch" / "rank-scene-p2")) if d not in sys.path]
    for d in added:
        sys.path.insert(0, d)
    try:
        loaded = {}
        for name in names:
            directory = ASM_DIR if name in ("asm", "swfabc") else MODULE_DIR
            spec = importlib.util.spec_from_file_location(name, directory / (name + ".py"))
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
        for d in added:
            sys.path.remove(d)


MODULES = _load_modules()
asm = MODULES["asm"]
swfabc = MODULES["swfabc"]
patch = MODULES["patch"]
abcpatch = MODULES["abcpatch"]
verify = MODULES["verify"]


class ContractTests(unittest.TestCase):
    def test_kind_is_the_next_free_enum_index(self):
        # 官方 InstantAbilityContentMasterValue.__constructs__ 有 724 条(0..723)。
        self.assertEqual(724, patch.CONTENT_KIND)
        self.assertEqual("AddFeverPointRatio", patch.CONTENT_CTOR)
        # 官方 InstantAbilityInstantBattleContent 有 5 条(0..4)。
        self.assertEqual(5, patch.BATTLE_CONTENT_INDEX)

    def test_stats_sentinel_stays_out_of_the_official_range(self):
        # 官方 statsKind 只有 0..4;哨兵必须离得足够远,并且携带官方 kind 1。
        self.assertEqual(100, patch.RATIO_STATS_SENTINEL)
        self.assertEqual(1, patch.RATIO_STATS_KIND)
        self.assertGreater(patch.RATIO_STATS_SENTINEL, 4)

    def test_seven_targets_and_no_unrelated_subsystem(self):
        self.assertEqual(7, len(patch.TARGETS))
        self.assertEqual(sorted(patch.TARGETS), sorted(patch.INSERT_AT))
        self.assertEqual(sorted(patch.TARGETS), sorted(patch.EQUIVALENT_SOURCE))
        allowed = ("AbilityValues", "InstantAbilitySource", "InstantAbilityContentTools",
                   "InstantAbilityDescriptionGenerator", "AbilitySlotImpl",
                   "FeverPointGaugeImpl")
        for name in patch.TARGETS:
            self.assertTrue(name.split("/")[0].rstrip("$") in allowed, name)

    def test_only_the_description_body_needs_more_stack(self):
        for name, (_body, _sha, before, after) in patch.TARGETS.items():
            if name.endswith("stringfyInstantBattleContent"):
                self.assertEqual((2, 3), before)
                self.assertEqual((4, 3), after)
            else:
                self.assertEqual(before, after, name)

    def test_every_block_falls_through_to_the_original_body(self):
        blocks = abcpatch._blocks(_FakePool())
        for name, block in blocks.items():
            mnemonics = [entry[0] for entry in block]
            self.assertIn("ifne", mnemonics + ["ifne"], name)
            # 每一块要么在末尾直接落回原体(END 标签),要么以 returnvoid/returnvalue 收尾。
            targets = [entry[1] for entry in block
                       if entry[0] in ("ifne", "ifeq", "iflt", "ifge", "jump")]
            self.assertTrue(any(t == "END" for t in targets)
                            or name == "FeverPointGaugeImpl/addFeverPoint", name)

    def test_no_block_touches_an_unrelated_subsystem(self):
        blocks = abcpatch._blocks(_FakePool())
        used = {entry[1] for block in blocks.values() for entry in block
                if entry[0] in ("getlex", "coerce", "astype")}
        # 只允许出现在 MN 表里登记过的类
        self.assertTrue(used.issubset(set(abcpatch.MN.values())))


class _FakePool:
    """契约用例用的常量池桩:字符串索引随便给,只要稳定。"""

    def __init__(self):
        self._seen = {}

    def string(self, text):
        return self._seen.setdefault(text, 900000 + len(self._seen))


@unittest.skipUnless(BASE_SWF.is_file(), "V11 base SWF is unavailable")
class BinaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base_sha256 = hashlib.sha256(BASE_SWF.read_bytes()).hexdigest()
        cls.directory = Path(tempfile.mkdtemp(prefix="fever-ratio-"))
        cls.output = cls.directory / "patched.swf"
        cls.report = abcpatch.apply(BASE_SWF, cls.output)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.directory, ignore_errors=True)

    def test_base_swf_is_the_locked_v11_build(self):
        self.assertEqual(patch.V11_SWF_SHA256, self.base_sha256)

    def test_body_indexes_are_re_derived_from_the_abc_not_copied(self):
        swf = swfabc.SwfAbc(BASE_SWF)
        abc = swf.abc
        names = {}
        for instance, klass in zip(abc.instances, abc.classes):
            cls = abc.mn_name(instance[0])
            for trait in instance[6]:
                if trait.kind in (1, 2, 3):
                    names[trait.data[2]] = cls + "/" + abc.mn_name(trait.name)
            for trait in klass[1]:
                if trait.kind in (1, 2, 3):
                    names[trait.data[2]] = cls + "$/" + abc.mn_name(trait.name)
        body_of = {}
        for index, item in enumerate(abc.bodies):
            body_of.setdefault(item[0], index)
        for name, (body_index, code_sha256, header, _after) in patch.TARGETS.items():
            short = name.replace("$/", "$/").split("::")[-1]
            matches = [method for method, label in names.items()
                       if label.split("::")[-1] == short]
            self.assertEqual(1, len(matches), short)
            self.assertEqual(body_index, body_of[matches[0]], short)
            item = abc.bodies[body_index]
            self.assertEqual(code_sha256, hashlib.sha256(item[5]).hexdigest(), short)
            self.assertEqual(header, (item[1], item[2]), short)

    def test_exactly_seven_bodies_change_and_nothing_else(self):
        report = verify.verify(BASE_SWF, self.output)
        self.assertEqual("verified", report["status"])
        self.assertEqual(sorted(entry[0] for entry in patch.TARGETS.values()),
                         report["changed_method_bodies"])
        self.assertEqual(0, report["added_multinames"])
        self.assertEqual(0, report["added_methods"])
        self.assertEqual(0, report["added_instance_traits"])
        self.assertEqual(4, len(report["added_pool_strings"]))
        self.assertIn(patch.CONTENT_CTOR, report["added_pool_strings"])

    def test_the_stats_sentinel_is_unique_in_the_whole_build(self):
        report = verify.verify(BASE_SWF, self.output)
        high = [site for site in report["add_fever_point_call_sites"]
                if site["stats_kind"] is not None
                and site["stats_kind"] >= patch.RATIO_STATS_SENTINEL]
        self.assertEqual(1, len(high))
        self.assertEqual(101, high[0]["stats_kind"])

    def test_patch_is_idempotent_by_refusing_a_second_pass(self):
        with self.assertRaises(patch.PatchError):
            abcpatch.apply(self.output, self.directory / "again.swf")

    def test_each_splice_is_exactly_reversible(self):
        swf = swfabc.SwfAbc(BASE_SWF)
        pool = swfabc.PoolEditor(swf.abc)
        blocks = abcpatch._blocks(pool)
        for name, block in blocks.items():
            body_index = patch.TARGETS[name][0]
            item = swf.abc.bodies[body_index]
            original = item[5]
            code, _merged, count = abcpatch.patch_body(item, name, block)
            self.assertEqual(original, asm.unsplice(code, patch.INSERT_AT[name], count), name)

    def test_drifted_input_is_refused(self):
        swf = swfabc.SwfAbc(BASE_SWF)
        pool = swfabc.PoolEditor(swf.abc)
        blocks = abcpatch._blocks(pool)
        name = "FeverPointGaugeImpl/addFeverPoint"
        item = list(swf.abc.bodies[patch.TARGETS[name][0]])
        item[5] = item[5] + b"\x47"          # 尾巴多一条 returnvoid
        with self.assertRaises(patch.PatchError):
            abcpatch.patch_body(item, name, blocks[name])

    def test_verify_rejects_a_tampered_product(self):
        broken = self.directory / "tampered.swf"
        swf = swfabc.SwfAbc(self.output)
        # 把 FeverPointGaugeImpl.addFeverPoint 的哨兵阈值从 100 改成 0
        item = swf.abc.bodies[patch.TARGETS["FeverPointGaugeImpl/addFeverPoint"][0]]
        instructions = asm.decode(item[5])
        self.assertEqual("pushbyte", instructions[3].name)
        instructions[3].args = [0]
        item[5] = asm.encode(instructions)[0]
        swf.save(broken)
        with self.assertRaises(patch.PatchError):
            verify.verify(BASE_SWF, broken)


if __name__ == "__main__":
    unittest.main()
