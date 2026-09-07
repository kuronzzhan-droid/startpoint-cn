"""during_content 422 `DashParameter`(V12)客户端补丁的回归测试。

契约用例不碰二进制,始终跑;端到端用例需要本机的 V11 基线 SWF,缺了就 skip。

核心断言:
  * 7 个 param_id 各有名字、各只落在声明的那个 BallImpl 生效点;
  * 13 个方法体下标按类名+方法名从真实 ABC 重新解析后与 `patch.py` 一致;
  * 新增的只有 1 个实例槽 + 1 个实例方法 + 1 个 method_info/body,
    而且槽是追加在末尾的(不挪动任何已有槽序号);
  * 与 `kyubi-fever-ratio` 改的方法体**完全不相交**(两个补丁可以任意先后叠);
  * 补丁可逆、幂等、对漂移输入当场拒绝;独立复核在真实产物上通过。
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
MODULE_DIR = ROOT / "client-patch" / "dash-parameter"
FEVER_DIR = ROOT / "client-patch" / "kyubi-fever-ratio"
ASM_DIR = ROOT / "client-patch" / "abcasm"
BUILD = Path("D:/WF/out/newchars-v12-20260907")
BASE_SWF = BUILD / "base-v11.swf"


def _load_modules(module_dir: Path, names=("asm", "swfabc", "patch", "abcpatch", "verify")):
    saved = {name: sys.modules.get(name) for name in names}
    added = [d for d in (str(module_dir), str(ASM_DIR),
                         str(ROOT / "client-patch" / "rank-scene-p2")) if d not in sys.path]
    for d in added:
        sys.path.insert(0, d)
    try:
        loaded = {}
        for name in names:
            directory = ASM_DIR if name in ("asm", "swfabc") else module_dir
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


MODULES = _load_modules(MODULE_DIR)
asm = MODULES["asm"]
swfabc = MODULES["swfabc"]
patch = MODULES["patch"]
abcpatch = MODULES["abcpatch"]
verify = MODULES["verify"]
FEVER = _load_modules(FEVER_DIR, names=("patch",))["patch"]


class _FakePool:
    def __init__(self):
        self._seen = {}

    def string(self, text):
        return self._seen.setdefault(text, 900000 + len(self._seen))


class ContractTests(unittest.TestCase):
    def test_kind_is_the_next_free_enum_index(self):
        # 官方 CommonAbilityContentMasterValue.__constructs__ 有 422 条(0..421)。
        self.assertEqual(422, patch.CONTENT_KIND)
        # 官方 CommonAbilityBattleContent 有 21 条(0..20)。
        self.assertEqual(21, patch.BATTLE_CONTENT_INDEX)
        self.assertEqual("DashParameter", patch.CONTENT_CTOR)

    def test_seven_params_each_have_a_name_and_a_unit(self):
        self.assertEqual(7, patch.PARAM_COUNT)
        self.assertEqual(list(range(7)), sorted(patch.PARAM_NAMES))
        self.assertEqual(sorted(patch.PARAM_NAMES), sorted(patch.PARAM_UNITS))
        self.assertEqual(7, len(set(patch.PARAM_NAMES.values())))
        # 只有 2 号是绝对像素上限,其余六个都是官方常量的倍率。
        self.assertEqual("像素上限", patch.PARAM_UNITS[2])
        for key in (0, 1, 3, 4, 5, 6):
            self.assertEqual("倍率", patch.PARAM_UNITS[key])

    def test_every_insertion_names_a_real_block(self):
        blocks = abcpatch._blocks(_FakePool(), 111, 222)
        self.assertEqual(sorted(patch.TARGETS), sorted(patch.INSERTIONS))
        used = set()
        for name, entries in patch.INSERTIONS.items():
            positions = [index for index, _key, _policy in entries]
            self.assertEqual(positions, sorted(set(positions)), name)
            for _index, key, policy in entries:
                self.assertIn(key, blocks, name)
                self.assertIn(policy, (patch.FORBID, patch.SKIP, patch.ENTER), name)
                used.add(key)
        self.assertEqual(used, set(blocks), "every block must be used exactly once somewhere")

    def test_ball_sites_cover_every_param_id_exactly_once(self):
        blocks = abcpatch._blocks(_FakePool(), 111, 222)
        seen = []
        for name, entries in patch.INSERTIONS.items():
            if not name.startswith("BallImpl/"):
                continue
            for _index, key, _policy in entries:
                ids = [entry[1] for n, entry in enumerate(blocks[key])
                       if entry[0] == "pushbyte" and n + 1 < len(blocks[key])
                       and blocks[key][n + 1][0] == "callproperty"
                       and blocks[key][n + 1][1] == 111]
                self.assertEqual(1, len(ids), key)
                seen.append(ids[0])
        self.assertEqual(list(range(7)), sorted(set(seen)))

    def test_only_the_two_documented_points_deviate_from_forbid(self):
        """插入点撞上原有分支目标必须是**显式声明**的,不许再多一处。

        `BallImpl/update@79` = ENTER(三条路径都要跑倍率换算,V12 施工时踩过);
        `BallImpl/findEscapeTarget@227/@249` = SKIP(飞行形态那条路常量是 0,
        跳过倍率与乘完等价)。
        """
        deviations = sorted((name, index, policy)
                            for name, entries in patch.INSERTIONS.items()
                            for index, _key, policy in entries
                            if policy != patch.FORBID)
        self.assertEqual([("BallImpl/findEscapeTarget", 227, patch.SKIP),
                          ("BallImpl/findEscapeTarget", 249, patch.SKIP),
                          ("BallImpl/update", 79, patch.ENTER)], deviations)

    def test_param_name_chain_needs_two_distinct_locals(self):
        with self.assertRaises(patch.PatchError):
            abcpatch._param_name_chain(_FakePool(), 5, 5)
        chain = abcpatch._param_name_chain(_FakePool(), 5, 6)
        self.assertEqual(7, sum(1 for entry in chain if entry[0] == "jump"))

    def test_targets_do_not_overlap_the_fever_ratio_patch(self):
        mine = {entry[0] for entry in patch.TARGETS.values()}
        theirs = {entry[0] for entry in FEVER.TARGETS.values()}
        self.assertEqual(set(), mine & theirs)
        self.assertEqual(13, len(mine))
        self.assertEqual(7, len(theirs))


@unittest.skipUnless(BASE_SWF.is_file(), "V11 base SWF is unavailable")
class BinaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = Path(tempfile.mkdtemp(prefix="dash-parameter-"))
        cls.output = cls.directory / "patched.swf"
        cls.report = abcpatch.apply(BASE_SWF, cls.output)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.directory, ignore_errors=True)

    def test_body_indexes_are_re_derived_from_the_abc_not_copied(self):
        abc = swfabc.SwfAbc(BASE_SWF).abc
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
            short = name.split("::")[-1]
            matches = [method for method, label in names.items()
                       if label.split("::")[-1] == short]
            self.assertEqual(1, len(matches), short)
            self.assertEqual(body_index, body_of[matches[0]], short)
            item = abc.bodies[body_index]
            self.assertEqual(code_sha256, hashlib.sha256(item[5]).hexdigest(), short)
            self.assertEqual(header, (item[1], item[2]), short)

    def test_independent_verifier_passes_on_the_real_product(self):
        report = verify.verify(BASE_SWF, self.output)
        self.assertEqual("verified", report["status"])
        self.assertEqual(sorted(entry[0] for entry in patch.TARGETS.values()),
                         report["changed_method_bodies"])
        self.assertEqual(1, report["added_methods"])
        self.assertEqual(["duringDashParameters", "getTotalDashParameter"],
                         report["added_instance_traits"])
        self.assertEqual({"BallImpl/update": [0, 3],
                          "BallImpl/findEscapeTarget": [1, 2, 5],
                          "BallImpl/tryEscape": [4],
                          "BallImpl/canEscapeNow": [6]},
                         report["ball_param_coverage"])

    def test_the_new_slot_is_appended_and_moves_no_existing_slot(self):
        before = swfabc.SwfAbc(BASE_SWF).abc
        after = swfabc.SwfAbc(self.output).abc
        name = "pinball.scene.battle.battle.ability::BattleAbilityTotalizerImpl"
        old = next(row for row in before.instances if before.mn_name(row[0]) == name)
        new = next(row for row in after.instances if after.mn_name(row[0]) == name)
        self.assertEqual(len(old[6]) + 2, len(new[6]))
        for index, trait in enumerate(old[6]):
            self.assertEqual(before.mn_name(trait.name), after.mn_name(new[6][index].name))
            self.assertEqual(trait.kind, new[6][index].kind)
            self.assertEqual(trait.data, new[6][index].data)
        self.assertEqual("duringDashParameters", after.mn_name(new[6][-2].name))
        self.assertEqual("getTotalDashParameter", after.mn_name(new[6][-1].name))
        self.assertEqual(0, new[6][-2].data[1])          # slot id 0 = 自动分配

    def test_the_new_getter_is_the_last_body_and_verifies(self):
        before = swfabc.SwfAbc(BASE_SWF).abc
        after = swfabc.SwfAbc(self.output).abc
        self.assertEqual(len(before.bodies) + 1, len(after.bodies))
        self.assertEqual(len(before.methods) + 1, len(after.methods))
        getter = after.bodies[-1]
        instructions = asm.decode(getter[5])
        maximum_stack, maximum_scope, unreachable = asm.simulate(
            instructions, getter[3], after.multinames)
        self.assertEqual(0, unreachable)
        self.assertLessEqual(maximum_stack, getter[1])
        self.assertLessEqual(maximum_scope, getter[4])

    def test_patch_is_idempotent_by_refusing_a_second_pass(self):
        with self.assertRaises(patch.PatchError):
            abcpatch.apply(self.output, self.directory / "again.swf")

    def test_drifted_input_is_refused(self):
        swf = swfabc.SwfAbc(BASE_SWF)
        item = swf.abc.bodies[patch.TARGETS["BallImpl/canEscapeNow"][0]]
        item[5] = item[5] + b"\x47"
        drifted = self.directory / "drifted.swf"
        swf.save(drifted)
        with self.assertRaises(patch.PatchError):
            abcpatch.apply(drifted, self.directory / "drifted-out.swf")

    def test_verify_rejects_a_tampered_product(self):
        broken = self.directory / "tampered.swf"
        swf = swfabc.SwfAbc(self.output)
        item = swf.abc.bodies[patch.TARGETS["BallImpl/canEscapeNow"][0]]
        instructions = asm.decode(item[5])
        # 把 canEscapeNow 的 param_id 从 6 改成 5
        site = next(n for n, x in enumerate(instructions)
                    if x.name == "pushbyte" and x.args == [6])
        instructions[site].args = [5]
        item[5] = asm.encode(instructions)[0]
        swf.save(broken)
        with self.assertRaises(patch.PatchError):
            verify.verify(BASE_SWF, broken)


if __name__ == "__main__":
    unittest.main()
