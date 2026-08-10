from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import wf_boss_trial as boss_trial  # noqa: E402
import wf_field_catalog as field_catalog  # noqa: E402


CONFIG = TOOLS_DIR / "boss_trial_templates.json"
NAME = "fantasy-stage3-generic-trials"


def walk(node):
    yield node
    if isinstance(node, list):
        for child in node:
            yield from walk(child)


class BossTrialTemplateTests(unittest.TestCase):
    def setUp(self):
        self.template = boss_trial.load_template(CONFIG, NAME)

    def test_template_has_three_native_phases(self):
        self.assertEqual(len(self.template["phases"]), 3)
        self.assertEqual(self.template["phases"][0]["trial"]["kind"], "direct_attack")
        self.assertEqual(self.template["phases"][1]["trial"]["kind"], "power_flip")
        self.assertIsNone(self.template["phases"][2]["trial"])

    def test_action_assets_roundtrip_and_retry_contract(self):
        assets = boss_trial.build_action_assets(self.template)
        self.assertEqual(set(assets), set(boss_trial.action_logicals(self.template)))
        trees = {name: field_catalog.parse_dsl(blob) for name, blob in assets.items()}
        guard = trees[boss_trial.action_logicals(self.template)[0]]
        repeats = [
            node[1]
            for node in walk(guard)
            if isinstance(node, list)
            and len(node) == 2
            and node[0] == "Event"
            and isinstance(node[1], list)
            and node[1][0] == "Repeat"
        ]
        self.assertEqual(len(repeats), 1)
        self.assertEqual(repeats[0][1:4], [30, 3600, "*"])
        retry_conditions = [
            node
            for node in walk(repeats[0][4])
            if isinstance(node, list)
            and len(node) == 2
            and node[0] == "Command"
            and node[1][0] == "CreateCondition"
        ]
        self.assertEqual(len(retry_conditions), 8)
        self.assertTrue(all(node[1][6] is True for node in retry_conditions))
        self.assertEqual(
            {node[1][8][0] for node in retry_conditions},
            {"DirectAttack", "PowerFlip"},
        )
        retry_kinds = [node[1][2][0][0] for node in retry_conditions]
        self.assertIn("ACToleranceOfDebuff", retry_kinds)
        self.assertNotIn("ACAttackPoint", retry_kinds)

    def test_common_trial_buffs_are_linked_and_non_cancelable(self):
        assets = boss_trial.build_action_assets(self.template)
        guard = field_catalog.parse_dsl(
            assets[boss_trial.action_logicals(self.template)[0]]
        )
        conditions = [
            node[1]
            for node in walk(guard)
            if isinstance(node, list)
            and len(node) == 2
            and node[0] == "Command"
            and node[1][0] == "CreateCondition"
            and node[1][2][0][0] == "ACToleranceOfDebuff"
        ]
        self.assertGreaterEqual(len(conditions), 2)
        self.assertTrue(all(condition[5] is False for condition in conditions))
        self.assertEqual(
            {condition[8][0] for condition in conditions},
            {"DirectAttack", "PowerFlip"},
        )
        self.assertTrue(
            all(condition[2][0][2][0]["min"] == 1.0 for condition in conditions)
        )

    def test_duplicate_guarded_trial_kind_is_rejected(self):
        invalid = copy.deepcopy(self.template)
        invalid["phases"][1]["trial"]["kind"] = "direct_attack"
        with self.assertRaisesRegex(ValueError, "distinct native trial kinds"):
            boss_trial.validate_template(invalid)

    def test_post_trial_suffix_preserves_published_state_names(self):
        self.assertEqual(
            self.template.get("post_trial_suffix", "__mod_after_trial"),
            "__mod_after_trial",
        )


if __name__ == "__main__":
    unittest.main()
