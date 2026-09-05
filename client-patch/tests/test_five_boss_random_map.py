"""五重决战 BothBoss 选图随机化(five-boss-random-map)的源码补丁回归测试。

全部为静态测试:不连真机、不跑 FFDec、不碰 APK。
分三层:

1. 策略镜像层 —— patch.py 里的 Python 模型与注入 AS3 是同一套算术和同一条选择规则;
2. 文本注入层 —— 锚点唯一、注入幂等、只动三处锚点、非五重路径逐字保留;
3. 篡改回归层 —— 逐条破坏验证器该抓的性质,断言 verify 一定报错
   (删掉断言就必须变红,否则这些用例没有价值)。
"""
from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCH_MODULE = ROOT / "client-patch" / "five-boss-random-map" / "patch.py"

# 真机在用的 V6 APK 里那份官方 BothBossTool(由 V7 构建落盘)。存在就跑,不存在就跳过。
# 注意:`弹国服/scripts` 下那份是更老的 FFDec 版本导出的,bothBossMapSingle 里带
# `§§goto`,与本补丁的锚点不同源,故意不作为输入。
OFFICIAL_EXPORT_CANDIDATES = (
    Path("D:/WF/out/abyss-v7-20260905/BothBossTool.official.as"),
)


def load_module():
    spec = importlib.util.spec_from_file_location("five_boss_random_map", PATCH_MODULE)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {PATCH_MODULE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULE = load_module()


def strip_comments(text: str) -> str:
    """模拟 FFDec 回编译后再导出:注释一定丢失。"""
    return re.sub(r"[ \t]*//[^\r\n]*(\r\n|\r|\n)", "", text)


def synthetic_official(newline: str = "\r\n") -> str:
    """用 patch.py 自己的官方常量拼一份最小 BothBossTool。

    只保留三个锚点及其上下文,不把整份反编译的游戏代码搬进仓库;锚点在真实类里唯一
    这件事由 `TestAgainstOfficialExport` 在本机有 V6 导出件时另行证明。
    """
    body = "\n".join(
        (
            "package pinball.scene.battle.battle",
            "{",
            "   public class BothBossTool",
            "   {",
            "      public static function mapBoss(param1:BattleSceneKind, param2:GlobalLogic,"
            " param3:Array = undefined) : BattleSceneKind",
            "      {",
            "         var _loc10_:* = null as BattleConnectionConfig;",
            "         var _loc11_:* = null as MultiQuestIdKind;",
            "         if(_loc11_.index == 4)",
            "         {",
            "            _loc10_.changeQuestId(MultiQuestIdKind.BothBoss(int(_loc11_.params[0]),"
            + MODULE.ORIGINAL_CALLSITE
            + ",int(_loc11_.params[2])));",
            "         }",
            "         return param1;",
            "      }",
            "      ",
            MODULE.ORIGINAL_BOTH_BOSS_MAP,
            "      ",
            MODULE.ORIGINAL_BOTH_BOSS_MAP_SINGLE,
            "   }",
            "}",
            "",
        )
    )
    return newline.join(body.split("\n"))


class TestSelectionPolicy(unittest.TestCase):
    """策略镜像:注入 AS3 的判据与 Python 侧必须一致。"""

    def test_only_the_gauntlet_id_window_is_randomised(self) -> None:
        for quest_id in (1_099_001, 1_099_002, 1_099_050, 1_099_099):
            with self.subTest(quest_id=quest_id):
                self.assertTrue(MODULE.is_random_map_quest(quest_id))

    def test_every_other_both_boss_quest_keeps_official_behaviour(self) -> None:
        # 1099000 / 1099100 是窗口两端的紧邻值;其余是官方 BothBoss 及退化值。
        for quest_id in (
            1_099_000,
            1_099_100,
            1_099_999,
            1_001_001,
            1_070_001,
            1_099,
            99,
            0,
            -1,
        ):
            with self.subTest(quest_id=quest_id):
                self.assertFalse(MODULE.is_random_map_quest(quest_id))

    def test_seed_is_a_pure_function_of_room_round_and_quest(self) -> None:
        seed = MODULE.map_seed("123456", 0, 1_099_001)
        self.assertEqual(seed, MODULE.map_seed("123456", 0, 1_099_001))
        self.assertNotEqual(seed, MODULE.map_seed("123457", 0, 1_099_001))
        self.assertNotEqual(seed, MODULE.map_seed("123456", 1, 1_099_001))
        self.assertNotEqual(seed, MODULE.map_seed("123456", 0, 1_099_002))

    def test_seed_stays_inside_the_31_bit_window(self) -> None:
        # AS3 侧靠这一点保证 `seed % length` 非负,是索引合法性的全部依据。
        for room in ("", "0", "999999", "null", "x" * 64):
            for round_index in (-1, 0, 1):
                seed = MODULE.map_seed(room, round_index, 1_099_001)
                with self.subTest(room=room, round_index=round_index):
                    self.assertGreaterEqual(seed, 0)
                    self.assertLessEqual(seed, MODULE.INT31_MASK)

    def test_random_index_is_in_range_and_degenerate_cases_are_zero(self) -> None:
        for length in range(1, 12):
            for seed in (0, 1, 7, 1_234_567, MODULE.INT31_MASK):
                with self.subTest(length=length, seed=seed):
                    index = MODULE.random_index(seed, length)
                    self.assertGreaterEqual(index, 0)
                    self.assertLess(index, length)
        self.assertEqual(0, MODULE.random_index(999, 1))
        self.assertEqual(0, MODULE.random_index(999, 0))

    def test_random_index_actually_spreads(self) -> None:
        # 不是"随机质量"检验,只是防止退化成常量:换房间号必须能命中不同下标。
        picked = {
            MODULE.random_index(MODULE.map_seed(str(room), 0, 1_099_001), 2)
            for room in range(100)
        }
        self.assertEqual({0, 1}, picked)

    def test_conditional_hits_outrank_unconditional_ones(self) -> None:
        self.assertEqual("c", MODULE.pick_candidate(["c"], ["u1", "u2"], 12345))
        self.assertIn(MODULE.pick_candidate([], ["u1", "u2"], 12345), ("u1", "u2"))
        self.assertIsNone(MODULE.pick_candidate([], [], 12345))

    def test_gauntlet_pick_comes_from_the_conditional_pool(self) -> None:
        rows = [
            ("condA", True, True),
            ("condB", True, True),
            ("fallback", True, False),
        ]
        seeds = {MODULE.select_row(rows, 1_099_001, seed) for seed in range(50)}
        self.assertEqual({"condA", "condB"}, seeds)

    def test_gauntlet_falls_back_when_no_conditional_row_passes(self) -> None:
        rows = [
            ("condA", False, False),
            ("fallback", True, False),
        ]
        self.assertEqual("fallback", MODULE.select_row(rows, 1_099_001, 0))

    def test_gauntlet_with_no_hit_at_all_yields_nothing(self) -> None:
        rows = [("condA", False, False), ("condB", False, False)]
        self.assertIsNone(MODULE.select_row(rows, 1_099_001, 0))

    def test_non_gauntlet_keeps_first_hit_wins(self) -> None:
        rows = [
            ("first", True, True),
            ("second", True, True),
            ("fallback", True, False),
        ]
        for seed in (0, 1, 7, 999_983):
            with self.subTest(seed=seed):
                self.assertEqual("first", MODULE.select_row(rows, 1_001_001, seed))
        skipped = [("miss", False, False), ("hit", True, False)]
        self.assertEqual("hit", MODULE.select_row(skipped, 1_001_001, 0))


class TestInjection(unittest.TestCase):
    """文本注入层。"""

    def setUp(self) -> None:
        self.original = synthetic_official()
        self.patched = MODULE.patch_both_boss_tool(self.original)

    def test_each_official_anchor_is_unique(self) -> None:
        for label, anchor in (
            ("bothBossMap", MODULE.ORIGINAL_BOTH_BOSS_MAP),
            ("bothBossMapSingle", MODULE.ORIGINAL_BOTH_BOSS_MAP_SINGLE),
            ("call site", MODULE.ORIGINAL_CALLSITE),
        ):
            with self.subTest(anchor=label):
                needle = MODULE._with_newline(anchor, "\r\n")
                self.assertEqual(1, self.original.count(needle))

    def test_patched_source_verifies(self) -> None:
        MODULE.verify_both_boss_tool(self.patched)

    def test_patch_is_idempotent(self) -> None:
        self.assertEqual(self.patched, MODULE.patch_both_boss_tool(self.patched))

    def test_only_the_three_anchors_changed(self) -> None:
        MODULE.assert_only_target_sites_changed(self.original, self.patched)

    def test_line_endings_are_preserved(self) -> None:
        self.assertNotIn("\n", self.patched.replace("\r\n", ""))
        unix = synthetic_official(newline="\n")
        patched_unix = MODULE.patch_both_boss_tool(unix)
        self.assertNotIn("\r", patched_unix)

    def test_call_site_now_passes_the_room_number(self) -> None:
        self.assertEqual(0, self.patched.count(MODULE.ORIGINAL_CALLSITE))
        self.assertEqual(1, self.patched.count(MODULE.PATCHED_CALLSITE))
        self.assertIn("_loc10_.roomNumber", self.patched)

    def test_official_first_hit_path_survives_for_non_gauntlet_quests(self) -> None:
        # 这两条是"其它 BothBoss 关一字节不改语义"的全部依据:范围判定为假时
        # 必须回到官方的"首条命中即 push 并 break"。
        for pin in (MODULE.PIN_MULTI_OFFICIAL_PATH, MODULE.PIN_SINGLE_OFFICIAL_PATH):
            with self.subTest(pin=pin):
                self.assertEqual(1, MODULE._token_sequence_count(self.patched, pin))

    def test_readback_shape_still_verifies_without_markers(self) -> None:
        # FFDec 回编译会丢注释(即丢标记),并可能把十进制常量渲染成十六进制、
        # 给恒等强转补上 Boolean()/int() 外壳。这些都不能让验证器失灵。
        readback = strip_comments(self.patched)
        readback = readback.replace("& 2147483647", "& 0x7FFFFFFF")
        readback = readback.replace(
            "_loc17_ = BothBossTool.isRandomMapQuest(_loc15_);",
            "_loc17_ = Boolean(BothBossTool.isRandomMapQuest(_loc15_));",
        )
        readback = readback.replace(
            "_loc18_ = BothBossTool.mapSeed(param4,_loc16_,_loc15_);",
            "_loc18_ = int(BothBossTool.mapSeed(param4,_loc16_,_loc15_));",
        )
        for marker in MODULE.MARKERS:
            self.assertNotIn(marker, readback)
        MODULE.verify_both_boss_tool(readback, require_markers=False)

    def test_readback_survives_register_renumbering(self) -> None:
        readback = strip_comments(self.patched)
        renamed = re.sub(r"_loc(\d+)_", lambda m: f"_loc{int(m.group(1)) + 40}_", readback)
        MODULE.verify_both_boss_tool(renamed, require_markers=False)

    def test_markers_are_required_on_the_generated_file(self) -> None:
        with self.assertRaises(MODULE.PatchError):
            MODULE.verify_both_boss_tool(strip_comments(self.patched))


class TestTamperRegression(unittest.TestCase):
    """篡改回归:每一条都对应验证器的一项承诺。"""

    def setUp(self) -> None:
        self.patched = MODULE.patch_both_boss_tool(synthetic_official())

    def assertRejected(self, mutated: str, *, markers: bool = True) -> None:
        self.assertNotEqual(self.patched, mutated, "变异体与原件相同,用例无效")
        with self.assertRaises(MODULE.PatchError):
            MODULE.verify_both_boss_tool(mutated, require_markers=markers)

    def test_widening_the_id_window_is_rejected(self) -> None:
        self.assertRejected(self.patched.replace("1099099", "1099999"))

    def test_narrowing_the_id_window_is_rejected(self) -> None:
        self.assertRejected(self.patched.replace("1099001", "1099003"))

    def test_dropping_the_official_first_hit_path_is_rejected(self) -> None:
        self.assertRejected(
            self.patched.replace(
                "                     if(!_loc17_)\r\n"
                "                     {\r\n"
                "                        _loc7_.push(_loc14_);\r\n"
                "                        break;\r\n"
                "                     }\r\n",
                "",
            )
        )

    def test_dropping_the_candidate_split_is_rejected(self) -> None:
        self.assertRejected(
            self.patched.replace(
                "BothBossTool.isConditionalRow(_loc12_) && _loc12_.test(_loc10_)",
                "true",
            )
        )

    def test_removing_the_modulo_is_rejected(self) -> None:
        self.assertRejected(self.patched.replace("return param1 % param2;", "return 0;"))

    def test_indexing_without_the_pool_length_is_rejected(self) -> None:
        self.assertRejected(
            self.patched.replace(
                "BothBossTool.randomIndex(param3,int(_loc4_.length))",
                "BothBossTool.randomIndex(param3,3)",
            )
        )

    def test_reverting_the_call_site_is_rejected(self) -> None:
        self.assertRejected(
            self.patched.replace(MODULE.PATCHED_CALLSITE, MODULE.ORIGINAL_CALLSITE)
        )

    def test_breaking_the_seed_hash_is_rejected(self) -> None:
        self.assertRejected(
            self.patched.replace(
                "_loc5_ = _loc5_ * 33 + int(_loc4_.charCodeAt(_loc6_)) & 2147483647;",
                "_loc5_ = 0;",
            )
        )

    def test_ungating_one_of_the_two_paths_is_rejected(self) -> None:
        self.assertRejected(
            self.patched.replace(
                "_loc13_ = BothBossTool.isRandomMapQuest(_loc12_);",
                "_loc13_ = true;",
            )
        )

    def test_partial_markers_are_rejected(self) -> None:
        with self.assertRaises(MODULE.PatchError):
            MODULE.verify_both_boss_tool(
                self.patched.replace(MODULE.MARKER_SINGLE_END, "")
            )

    def test_smuggling_a_second_gauntlet_literal_is_rejected(self) -> None:
        self.assertRejected(
            self.patched.replace(
                "         if(param1 >= 1099001 && param1 <= 1099099)",
                "         if(param1 == 1099002)\r\n         {\r\n            return true;\r\n"
                "         }\r\n         if(param1 >= 1099001 && param1 <= 1099099)",
            )
        )

    def test_patching_a_source_without_the_anchors_fails_loudly(self) -> None:
        with self.assertRaises(MODULE.PatchError):
            MODULE.patch_both_boss_tool("package {}\r\n")


class TestAgainstOfficialExport(unittest.TestCase):
    """本机若有 V6 导出的官方类,证明锚点在真实类里唯一且注入可复现。"""

    @classmethod
    def setUpClass(cls) -> None:
        for candidate in OFFICIAL_EXPORT_CANDIDATES:
            if candidate.is_file():
                cls.source = candidate
                break
        else:
            raise unittest.SkipTest("本机没有 V6 导出的官方 BothBossTool.as")
        cls.original = cls.source.read_text(encoding="utf-8", newline="")

    def test_anchors_are_unique_in_the_real_class(self) -> None:
        newline = MODULE._newline(self.original)
        for label, anchor in (
            ("bothBossMap", MODULE.ORIGINAL_BOTH_BOSS_MAP),
            ("bothBossMapSingle", MODULE.ORIGINAL_BOTH_BOSS_MAP_SINGLE),
            ("call site", MODULE.ORIGINAL_CALLSITE),
        ):
            with self.subTest(anchor=label):
                self.assertEqual(
                    1, self.original.count(MODULE._with_newline(anchor, newline))
                )

    def test_real_class_patches_verifies_and_is_reversible(self) -> None:
        patched = MODULE.patch_both_boss_tool(self.original)
        MODULE.verify_both_boss_tool(patched)
        MODULE.assert_only_target_sites_changed(self.original, patched)
        self.assertEqual(patched, MODULE.patch_both_boss_tool(patched))


if __name__ == "__main__":
    unittest.main()
