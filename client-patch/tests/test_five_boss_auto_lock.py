"""五重决战 Auto 开战快照锁的源码补丁回归测试。"""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCH_MODULE = ROOT / "client-patch" / "five-boss-auto-lock" / "patch.py"
DECOMPILE_ROOT = Path(
    "D:/WF/outputs/re-workspace/decompile/scripts/pinball"
)
BATTLE_SCENE = DECOMPILE_ROOT / "scene" / "battle" / "BattleScene.as"
PAUSE_MENU = DECOMPILE_ROOT / "dialog" / "battlePauseMenu" / "BattlePauseMenu.as"


def load_module():
    spec = importlib.util.spec_from_file_location("five_boss_auto_lock", PATCH_MODULE)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {PATCH_MODULE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestFiveBossAutoLockPolicy(unittest.TestCase):
    def test_only_manual_start_in_the_three_five_boss_quests_is_locked(self) -> None:
        module = load_module()
        for quest_id in (1_099_001, 1_099_002, 1_099_003):
            with self.subTest(quest_id=quest_id):
                self.assertTrue(module.should_lock_auto(quest_id, False))
                self.assertFalse(module.should_lock_auto(quest_id, True))

        for quest_id in (1_099_000, 1_099_004, 7_000_990_01, 1, 97):
            with self.subTest(quest_id=quest_id):
                self.assertFalse(module.should_lock_auto(quest_id, False))


class TestFiveBossAutoLockSourcePatch(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not BATTLE_SCENE.is_file() or not PAUSE_MENU.is_file():
            raise unittest.SkipTest("权威 FFDec 反编译源码不在本机")
        cls.module = load_module()
        cls.battle_source = BATTLE_SCENE.read_text(encoding="utf-8")
        cls.pause_source = PAUSE_MENU.read_text(encoding="utf-8")

    def test_real_sources_patch_and_verify_with_exact_start_snapshot_semantics(self) -> None:
        battle = self.module.patch_battle_scene(self.battle_source)
        pause = self.module.patch_pause_menu(self.pause_source)

        self.module.verify_battle_scene(battle)
        self.module.verify_pause_menu(pause)
        self.assertEqual(1, battle.count(self.module.BATTLE_FIELD_BEGIN))
        self.assertEqual(1, battle.count(self.module.BATTLE_INIT_BEGIN))
        self.assertEqual(1, battle.count(self.module.BATTLE_GUARD_BEGIN))
        self.assertEqual(1, pause.count(self.module.PAUSE_LOCK_BEGIN))

        # 初始状态只在 preparation 时冻结一次；后续开关不能改写该字段。
        init_pos = battle.index(self.module.BATTLE_INIT_BEGIN)
        change_pos = battle.index("public function changeAutoplayMode")
        self.assertLess(init_pos, change_pos)
        self.assertEqual(
            1,
            battle.count("fiveBossManualAutoLock ="),
            "战斗中切换 Auto 不能重新计算开战快照",
        )

    def test_patch_is_idempotent(self) -> None:
        battle = self.module.patch_battle_scene(self.battle_source)
        pause = self.module.patch_pause_menu(self.pause_source)
        self.assertEqual(battle, self.module.patch_battle_scene(battle))
        self.assertEqual(pause, self.module.patch_pause_menu(pause))

    def test_verifier_rejects_reward_quest_range_or_initial_mode_mutation(self) -> None:
        battle = self.module.patch_battle_scene(self.battle_source)
        for before, after in (
            ("<= 1099003", "<= 1099004"),
            ("!myBattle.autoplayData.autoButtonMode", "myBattle.autoplayData.autoButtonMode"),
            ("param1 && fiveBossManualAutoLock", "param1 || fiveBossManualAutoLock"),
        ):
            with self.subTest(mutation=after):
                mutated = battle.replace(before, after, 1)
                with self.assertRaises(self.module.PatchError):
                    self.module.verify_battle_scene(mutated)

    def test_verifier_rejects_pause_menu_that_is_not_visibly_locked(self) -> None:
        pause = self.module.patch_pause_menu(self.pause_source)
        mutated = pause.replace(" || battleScene.fiveBossManualAutoLock", "", 1)
        with self.assertRaises(self.module.PatchError):
            self.module.verify_pause_menu(mutated)

    def test_write_outputs_is_atomic_and_does_not_touch_authority_sources(self) -> None:
        original_battle = BATTLE_SCENE.read_bytes()
        original_pause = PAUSE_MENU.read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            paths = self.module.write_outputs(BATTLE_SCENE, PAUSE_MENU, output)
            self.assertEqual(
                {"BattleScene.as", "BattlePauseMenu.as"},
                {path.name for path in paths},
            )
            self.module.verify_battle_scene((output / "BattleScene.as").read_text(encoding="utf-8"))
            self.module.verify_pause_menu((output / "BattlePauseMenu.as").read_text(encoding="utf-8"))

        self.assertEqual(original_battle, BATTLE_SCENE.read_bytes())
        self.assertEqual(original_pause, PAUSE_MENU.read_bytes())


if __name__ == "__main__":
    unittest.main()
