from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path


MOD_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MOD_DIR))

import wf_mode15_build as mode15  # noqa: E402


class TestMode15AbyssPlan(unittest.TestCase):
    def test_schedule_stays_twelve_solo_and_three_multiplayer(self) -> None:
        plan = mode15.MODE15_ABYSS_PLAN
        self.assertEqual(15, plan["rounds"])
        self.assertEqual(list(mode15.SOLO_STAGES), plan["rules"]["solo_stages"])
        self.assertEqual(
            [5, 10, 15],
            plan["rules"]["multiplayer_stages"],
        )
        self.assertEqual(
            ["multiplayer", "multiplayer", "multiplayer"],
            [
                mode15.STAGE_BY_NUMBER[stage]["mode"]
                for stage in mode15.MULTI_STAGES
            ],
        )

    def test_character_reuse_is_enabled_for_testing(self) -> None:
        self.assertIs(
            True,
            mode15.MODE15_ABYSS_PLAN["rules"]["allow_character_reuse"],
        )
        self.assertEqual(
            3,
            mode15.MODE15_ABYSS_PLAN["rules"]["visible_party_sets"],
        )

    def test_gradient_endpoints_match_upstream_experience(self) -> None:
        difficulty = mode15.MODE15_ABYSS_PLAN["difficulty"]
        self.assertEqual("gradient", difficulty["preset"])
        self.assertTrue(math.isclose(0.5, mode15.STAGE_BY_NUMBER[1]["hp"]))
        self.assertTrue(
            math.isclose(
                2.6,
                mode15.STAGE_BY_NUMBER[15]["curve_hp"],
            )
        )
        self.assertTrue(math.isclose(0.6, mode15.STAGE_BY_NUMBER[1]["atk"]))
        self.assertTrue(math.isclose(2.0, mode15.STAGE_BY_NUMBER[15]["atk"]))
        self.assertLessEqual(difficulty["atk_hard_ceiling"], 8.0)

    def test_multiplayer_hp_scaling_only_hits_milestones(self) -> None:
        for stage, scale in ((5, 1.75), (10, 2.0), (15, 2.25)):
            config = mode15.STAGE_BY_NUMBER[stage]
            self.assertAlmostEqual(
                config["curve_hp"] * scale,
                config["hp"],
                places=3,
            )
        self.assertNotIn("curve_hp", mode15.STAGE_BY_NUMBER[14])

    def test_curse_density_never_exceeds_native_five_slots(self) -> None:
        for config in mode15.STAGE_CONFIGS:
            self.assertLessEqual(len(config["conditions"]), 5)
        self.assertEqual("off", mode15.STAGE_BY_NUMBER[1]["curse_tier"])
        self.assertEqual("hell", mode15.STAGE_BY_NUMBER[15]["curse_tier"])


if __name__ == "__main__":
    unittest.main()
