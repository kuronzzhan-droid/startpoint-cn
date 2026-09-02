"""五重决战「只允许组队」客户端补丁 A 的源码补丁回归测试。"""
from __future__ import annotations

import importlib.util
import re
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCH_MODULE = ROOT / "client-patch" / "five-boss-multi-only" / "patch.py"

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


def load_module():
    spec = importlib.util.spec_from_file_location("five_boss_multi_only", PATCH_MODULE)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {PATCH_MODULE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def strip_comments(text: str) -> str:
    """模拟 FFDec 回编译后再导出:注释一定丢失。"""
    return re.sub(r"[ \t]*//[^\r\n]*(\r\n|\r|\n)", "", text)


class TestPlayKindPolicy(unittest.TestCase):
    """纯策略镜像:注入 AS3 的判据与 Python 侧必须一致。"""

    def setUp(self) -> None:
        self.module = load_module()

    def test_only_the_three_gauntlet_quests_are_multi_only(self) -> None:
        for quest_id in (1_099_001, 1_099_002, 1_099_003):
            with self.subTest(quest_id=quest_id):
                self.assertEqual(2, self.module.available_play_kind(quest_id))
                self.assertTrue(self.module.is_multi_only(quest_id))

    def test_every_other_boss_battle_quest_still_allows_single(self) -> None:
        # 回归断言:id 不在 1099001..1099003 的关卡必须仍然返回 1。
        others = (
            1_099_000, 1_099_004, 1_099_999,   # 同节点 99 的相邻 id
            1_001_001, 1_001_002, 1_070_001,   # 其它 boss 战节点
            1, 97, 99, 1_099, 0, -1,           # 节点号/退化值不能被误判
        )
        for quest_id in others:
            with self.subTest(quest_id=quest_id):
                self.assertEqual(1, self.module.available_play_kind(quest_id))
                self.assertFalse(self.module.is_multi_only(quest_id))


class TestGeneratedSourceText(unittest.TestCase):
    """对生成的 AS 文本做静态断言(不依赖真机、不依赖 FFDec)。"""

    @classmethod
    def setUpClass(cls) -> None:
        source = find_quest_logic()
        if source is None:
            raise unittest.SkipTest("权威 FFDec 反编译源码不在本机")
        cls.source_path = source
        cls.module = load_module()
        # newline="" 保留 CRLF,避免 universal newline 掩盖行尾问题。
        cls.original = source.read_text(encoding="utf-8", newline="")
        cls.patched = cls.module.patch_quest_logic(cls.original)

    def test_official_body_is_a_unique_anchor(self) -> None:
        self.assertEqual(
            1,
            self.original.count(
                self.module._with_newline(self.module.ORIGINAL_METHOD, "\r\n")
            ),
            "官方 get_availablePlayKind 方法体必须唯一,否则锚点不成立",
        )

    def test_method_body_appears_exactly_once(self) -> None:
        self.assertEqual(1, self.patched.count(self.module.METHOD_SIGNATURE))
        self.assertEqual(
            1, self.module._token_sequence_count(self.patched, self.module.PATCHED_METHOD)
        )

    def test_predicate_is_the_exact_quest_id_range(self) -> None:
        self.assertIn("if(id >= 1099001 && id <= 1099003)", self.patched)
        self.assertEqual(
            1, self.module._token_sequence_count(self.patched, self.module.GUARD_CODE)
        )
        tokens = self.module._tokens(self.patched)
        self.assertEqual(1, tokens.count("1099001"))
        self.assertEqual(1, tokens.count("1099003"))
        # 判据不得改用 get_stageNodeId():它返回 1099 而不是 99。注释里提到它是解释,
        # 所以先剥注释再看代码本体。
        body = strip_comments(self.patched)
        body = body.split(self.module.METHOD_SIGNATURE)[1].split("\r\n      }")[0]
        self.assertNotIn("get_stageNodeId", body)
        self.assertNotIn("getStageNode", body)
        self.assertIn("id >= 1099001 && id <= 1099003", body)

    def test_multi_only_return_exists_once_and_fallback_survives(self) -> None:
        self.assertEqual(1, self.module._token_sequence_count(self.patched, "return 2;"))
        self.assertEqual(1, self.module._token_sequence_count(self.patched, "return 1;"))
        self.assertLess(
            self.module._token_index(self.patched, self.module.GUARD_CODE),
            self.module._token_index(self.patched, self.module.FALLBACK_CODE),
        )

    def test_no_other_method_changed(self) -> None:
        self.module.assert_only_target_method_changed(self.original, self.patched)
        # 逐方法核对:除目标方法外,每个方法签名及其相邻文本原样保留。
        signatures = re.findall(
            r"^\s*(?:override )?public function [A-Za-z_$][A-Za-z0-9_$]*",
            self.original,
            re.MULTILINE,
        )
        self.assertGreater(len(signatures), 15)
        for signature in signatures:
            with self.subTest(signature=signature.strip()):
                self.assertEqual(
                    self.original.count(signature), self.patched.count(signature)
                )

    def test_class_shape_and_line_endings_are_preserved(self) -> None:
        self.assertNotIn("\ufeff", self.patched)
        self.assertEqual(0, self.patched.replace("\r\n", "").count("\n"))
        # 只增不删:补丁只在目标方法内插入行,增量恰好等于两段方法文本的行数差。
        inserted = (
            self.module.PATCHED_METHOD.count("\n")
            - self.module.ORIGINAL_METHOD.count("\n")
        )
        self.assertEqual(11, inserted)
        self.assertEqual(
            self.original.count("\r\n") + inserted, self.patched.count("\r\n")
        )
        self.assertTrue(self.patched.startswith("package pinball.common.data.quest"))
        self.assertTrue(self.patched.rstrip().endswith("}"))

    def test_injected_text_is_ascii_only(self) -> None:
        # FFDec 的 AS3 直编辑器要重新编译这段文本,不给它非 ASCII 字节。
        injected = self.module.PATCHED_METHOD
        injected.encode("ascii")

    def test_patch_is_idempotent(self) -> None:
        self.assertEqual(self.patched, self.module.patch_quest_logic(self.patched))

    def test_verify_accepts_a_comment_free_readback(self) -> None:
        readback = strip_comments(self.patched)
        self.assertNotIn(self.module.MARKER_BEGIN, readback)
        self.module.verify_quest_logic(readback, require_markers=False)
        self.module.verify_readback(readback, self.patched)

    def test_verifier_rejects_semantic_mutations(self) -> None:
        mutations = (
            ("id <= 1099003", "id <= 1099004"),      # 上界放宽,吃掉别的关卡
            ("id >= 1099001", "id >= 1099000"),      # 下界放宽
            ("id >= 1099001", "id > 1099001"),       # 漏掉第一关
            ("return 2;", "return 0;"),              # 变成「只能单人」
            ("1099001 && id", "1099001 || id"),      # 条件变成永真
            ("if(id >=", "if(getQuestNumber() >="),  # 换成错误的判据来源
            ("            return 2;", "            return 1;"),  # 守卫失效
        )
        for before, after in mutations:
            with self.subTest(mutation=f"{before} -> {after}"):
                mutated = self.patched.replace(before, after, 1)
                self.assertNotEqual(mutated, self.patched)
                with self.assertRaises(self.module.PatchError):
                    self.module.verify_quest_logic(mutated)

    def test_verifier_rejects_a_dropped_or_duplicated_fallback(self) -> None:
        without_fallback = self.patched.replace("         return 1;\r\n", "", 1)
        with self.assertRaises(self.module.PatchError):
            self.module.verify_quest_logic(without_fallback)

        doubled = self.patched.replace(
            "            return 2;", "            return 2;\r\n            return 2;", 1
        )
        with self.assertRaises(self.module.PatchError):
            self.module.verify_quest_logic(doubled)

    def test_verifier_rejects_partial_markers(self) -> None:
        half = self.patched.replace(self.module.MARKER_END, "", 1)
        with self.assertRaises(self.module.PatchError):
            self.module.verify_quest_logic(half)

    def test_verifier_requires_markers_on_generated_output(self) -> None:
        readback = strip_comments(self.patched)
        with self.assertRaises(self.module.PatchError):
            self.module.verify_quest_logic(readback, require_markers=True)

    def test_readback_detects_a_foreign_class(self) -> None:
        foreign = self.patched.replace(
            "public function getQuestNumber() : int",
            "public function getQuestNumberRenamed() : int",
            1,
        )
        with self.assertRaises(self.module.PatchError):
            self.module.verify_readback(foreign, self.patched)

    def test_write_outputs_is_atomic_and_leaves_the_authority_source_intact(self) -> None:
        original_bytes = self.source_path.read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            output_dir = Path(temporary)
            output = self.module.write_outputs(self.source_path, output_dir)
            self.assertEqual("BossBattleQuestLogic.as", output.name)
            written = output.read_text(encoding="utf-8", newline="")
            self.assertEqual(self.patched, written)
            self.module.verify_quest_logic(written)
            # 重复运行字节不变
            again = self.module.write_outputs(self.source_path, output_dir)
            self.assertEqual(written, again.read_text(encoding="utf-8", newline=""))
        self.assertEqual(original_bytes, self.source_path.read_bytes())


class TestOfficialPrecedent(unittest.TestCase):
    """对照官方「高难多人」:同一枚举值 2 必须确有先例。"""

    def test_hard_multi_event_quest_logic_returns_two(self) -> None:
        for root in DECOMPILE_ROOTS:
            precedent = root / "common/data/quest/event/hardMulti/HardMultiEventQuestLogic.as"
            if precedent.is_file():
                text = precedent.read_text(encoding="utf-8", newline="")
                self.assertIn(
                    "public function get_availablePlayKind() : int\r\n"
                    "      {\r\n"
                    "         return 2;\r\n"
                    "      }",
                    text,
                )
                return
        raise unittest.SkipTest("权威 FFDec 反编译源码不在本机")


if __name__ == "__main__":
    unittest.main()
