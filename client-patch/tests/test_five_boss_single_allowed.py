"""五重决战「恢复单人按钮」客户端补丁的源码补丁回归测试。

该补丁是 ``five-boss-multi-only`` 的逆操作:把
``BossBattleQuestLogic.get_availablePlayKind()`` 还原成官方的 ``return 1;``。
"""
from __future__ import annotations

import importlib.util
import re
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCH_MODULE = ROOT / "client-patch" / "five-boss-single-allowed" / "patch.py"
MULTI_ONLY_MODULE = ROOT / "client-patch" / "five-boss-multi-only" / "patch.py"

# 权威 FFDec 反编译源码有两个等价副本(实测逐字节相同),取先找到的那个。
DECOMPILE_ROOTS = (
    ROOT / "弹国服" / "scripts" / "pinball",
    Path("D:/WF/outputs/re-workspace/decompile/scripts/pinball"),
)
RELATIVE = Path("common/data/quest/normal/bossBattle/BossBattleQuestLogic.as")


def find_quest_logic() -> Path | None:
    for root in DECOMPILE_ROOTS:
        candidate = root / RELATIVE
        if candidate.is_file():
            return candidate
    return None


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def strip_comments(text: str) -> str:
    """模拟 FFDec 回编译后再导出:注释一定丢失。"""
    return re.sub(r"[ \t]*//[^\r\n]*(\r\n|\r|\n)", "", text)


class TestPlayKindPolicy(unittest.TestCase):
    """纯策略镜像:注入 AS3 的判据与 Python 侧必须一致。"""

    def setUp(self) -> None:
        self.module = load_module(PATCH_MODULE, "five_boss_single_allowed")

    def test_gauntlet_quests_allow_single_and_multi(self) -> None:
        for quest_id in (1_099_001, 1_099_002, 1_099_003):
            with self.subTest(quest_id=quest_id):
                self.assertEqual(1, self.module.available_play_kind(quest_id))
                self.assertTrue(self.module.is_single_allowed(quest_id))

    def test_every_other_boss_battle_quest_is_unchanged(self) -> None:
        others = (
            1_099_000, 1_099_004, 1_099_023, 1_099_999,
            1_001_001, 1_001_002, 1_070_001,
            1, 97, 99, 1_099, 0, -1,
        )
        for quest_id in others:
            with self.subTest(quest_id=quest_id):
                self.assertEqual(1, self.module.available_play_kind(quest_id))
                self.assertTrue(self.module.is_single_allowed(quest_id))


class TestRestoreFromMultiOnly(unittest.TestCase):
    """从 five-boss-multi-only 的产物还原回官方体。"""

    def setUp(self) -> None:
        self.module = load_module(PATCH_MODULE, "five_boss_single_allowed")
        self.multi_only = load_module(MULTI_ONLY_MODULE, "five_boss_multi_only")
        source = find_quest_logic()
        if source is None:
            self.skipTest("找不到 BossBattleQuestLogic.as 反编译权威源")
        self.official = source.read_bytes().decode("utf-8-sig")
        self.multi_only_text = self.multi_only.patch_quest_logic(self.official)

    def test_round_trip_multi_only_then_single_allowed(self) -> None:
        restored = self.module.patch_quest_logic(self.multi_only_text)
        self.assertEqual(self.official, restored)

    def test_round_trip_survives_comment_stripping(self) -> None:
        """FFDec 回编译会丢掉注释;还原器不能依赖补丁标记。"""
        recompiled = strip_comments(self.multi_only_text)
        self.assertNotIn("WF_FIVE_BOSS_MULTI_ONLY_BEGIN", recompiled)
        restored = self.module.patch_quest_logic(recompiled)
        self.assertEqual(self.official, restored)

    def test_official_input_is_a_no_op(self) -> None:
        self.assertEqual(self.official, self.module.patch_quest_logic(self.official))

    def test_idempotent(self) -> None:
        once = self.module.patch_quest_logic(self.multi_only_text)
        twice = self.module.patch_quest_logic(once)
        self.assertEqual(once, twice)

    def test_crlf_and_bom_are_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "BossBattleQuestLogic.as"
            crlf = self.multi_only_text.replace("\r\n", "\n").replace("\n", "\r\n")
            source.write_bytes("\ufeff".encode("utf-8") + crlf.encode("utf-8"))
            output = self.module.write_outputs(source, tmp_path / "out")
            raw = output.read_bytes()
            self.assertTrue(raw.startswith(b"\xef\xbb\xbf"))
            body = raw.decode("utf-8-sig")
            self.assertNotIn("\n", body.replace("\r\n", ""))

    def test_nothing_outside_the_target_method_changed(self) -> None:
        restored = self.module.patch_quest_logic(self.multi_only_text)
        # 逐方法比较:除 get_availablePlayKind 外整类逐字节相同。
        start_a, end_a = self.module._method_span(self.multi_only_text)
        start_b, end_b = self.module._method_span(restored)
        self.assertEqual(self.multi_only_text[:start_a], restored[:start_b])
        self.assertEqual(self.multi_only_text[end_a:], restored[end_b:])


class TestVerification(unittest.TestCase):
    """验证器必须真的会红:删掉断言就失效的检查不算检查。"""

    def setUp(self) -> None:
        self.module = load_module(PATCH_MODULE, "five_boss_single_allowed")
        self.multi_only = load_module(MULTI_ONLY_MODULE, "five_boss_multi_only")
        source = find_quest_logic()
        if source is None:
            self.skipTest("找不到 BossBattleQuestLogic.as 反编译权威源")
        self.official = source.read_bytes().decode("utf-8-sig")
        self.restored = self.module.patch_quest_logic(
            self.multi_only.patch_quest_logic(self.official)
        )

    def test_restored_class_verifies(self) -> None:
        self.module.verify_quest_logic(self.restored)

    def test_multi_only_class_is_rejected(self) -> None:
        multi_only_text = self.multi_only.patch_quest_logic(self.official)
        with self.assertRaises(self.module.PatchError):
            self.module.verify_quest_logic(multi_only_text)

    def test_leftover_return_two_is_rejected(self) -> None:
        poisoned = self.restored.replace(
            "public function getQuestNumber() : int\r\n      {\r\n         return int(id % 1000);",
            "public function getQuestNumber() : int\r\n      {\r\n         return 2;",
        )
        self.assertNotEqual(poisoned, self.restored)
        with self.assertRaises(self.module.PatchError):
            self.module.verify_quest_logic(poisoned)

    def test_wrong_return_value_is_rejected(self) -> None:
        poisoned = self.restored.replace(
            "public function get_availablePlayKind() : int\r\n      {\r\n         return 1;",
            "public function get_availablePlayKind() : int\r\n      {\r\n         return 0;",
        )
        self.assertNotEqual(poisoned, self.restored)
        with self.assertRaises(self.module.PatchError):
            self.module.verify_quest_logic(poisoned)

    def test_unknown_body_shape_is_rejected(self) -> None:
        mutated = self.official.replace(
            "public function get_availablePlayKind() : int\r\n      {\r\n         return 1;\r\n      }",
            "public function get_availablePlayKind() : int\r\n      {\r\n         "
            "if(id == 4242)\r\n         {\r\n            return 2;\r\n         }\r\n"
            "         return 1;\r\n      }",
        )
        self.assertNotEqual(mutated, self.official)
        with self.assertRaises(self.module.PatchError):
            self.module.patch_quest_logic(mutated)

    def test_readback_token_mismatch_is_rejected(self) -> None:
        drifted = self.restored.replace("getQuestNumber", "getQuestNumber2")
        with self.assertRaises(self.module.PatchError):
            self.module.verify_readback(drifted, self.restored)
        # --allow-reformat 只降级 token 比较,语义验证仍然是硬门禁。
        self.module.verify_readback(drifted, self.restored, allow_reformat=True)


class TestMutualExclusionWithMultiOnly(unittest.TestCase):
    """两个补丁互斥:同一份源码不能同时满足两边的验证器。"""

    def setUp(self) -> None:
        self.module = load_module(PATCH_MODULE, "five_boss_single_allowed")
        self.multi_only = load_module(MULTI_ONLY_MODULE, "five_boss_multi_only")
        source = find_quest_logic()
        if source is None:
            self.skipTest("找不到 BossBattleQuestLogic.as 反编译权威源")
        self.official = source.read_bytes().decode("utf-8-sig")

    def test_policies_disagree_only_on_the_gauntlet(self) -> None:
        for quest_id in (1_099_001, 1_099_002, 1_099_003):
            self.assertEqual(2, self.multi_only.available_play_kind(quest_id))
            self.assertEqual(1, self.module.available_play_kind(quest_id))
        for quest_id in (1_001_001, 1_001_002, 1_099_004):
            self.assertEqual(
                self.multi_only.available_play_kind(quest_id),
                self.module.available_play_kind(quest_id),
            )

    def test_restored_class_fails_multi_only_verification(self) -> None:
        restored = self.module.patch_quest_logic(
            self.multi_only.patch_quest_logic(self.official)
        )
        with self.assertRaises(self.multi_only.PatchError):
            self.multi_only.verify_quest_logic(restored, require_markers=False)


if __name__ == "__main__":
    unittest.main()
