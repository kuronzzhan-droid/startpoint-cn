from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


WORK_DIR = Path(__file__).resolve().parent
TOOLS_DIR = Path(r"F:\startpoint-cn-mode15\mod-tools")
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
# Validate the staged module, while resolving its shared dependencies from the
# installed tool directory.
sys.path.insert(0, str(WORK_DIR))

import wf_boss_trial as boss_trial  # noqa: E402
import wf_field_catalog as field_catalog  # noqa: E402


CONFIG = WORK_DIR / "boss_trial_templates.json"
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
        self.assertEqual(
            len(retry_conditions),
            sum(
                len(phase.get("resistances", []))
                + len(self.template.get("common_trial_buffs", {}))
                + len(phase.get("trial_buffs", {}))
                for phase in self.template["phases"]
                if phase.get("trial") is not None
            ),
        )
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
        self.assertGreaterEqual(len(conditions), 1)
        self.assertTrue(all(condition[5] is False for condition in conditions))
        self.assertEqual(conditions[0][8], ["DirectAttack"])
        values = {
            condition[2][0][0]: condition[2][0][2][0]["min"]
            for condition in conditions[:1]
        }
        self.assertEqual(values["ACToleranceOfDebuff"], 1.0)

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


class Stage5FireTrialTemplateTests(unittest.TestCase):
    def setUp(self):
        self.template = boss_trial.load_template(
            CONFIG, "fantasy-stage5-fire-three-trials"
        )

    def test_three_trial_order_and_targets(self):
        self.assertEqual(self.template["source_boss"], "spirit_beast_fire")
        self.assertEqual(
            [phase["trial"]["kind"] for phase in self.template["phases"]],
            ["direct_attack", "skill", "skill_chain"],
        )
        self.assertEqual(
            [phase["trial"]["target"] for phase in self.template["phases"]],
            [200, 40, 6],
        )
        self.assertEqual(
            [phase.get("hp_threshold") for phase in self.template["phases"]],
            [0.7, 0.4, None],
        )

    def test_all_three_trial_buffs_are_linked(self):
        assets = boss_trial.build_action_assets(self.template)
        guard = field_catalog.parse_dsl(next(iter(assets.values())))
        linked = [
            node[1][8][0]
            for node in walk(guard)
            if isinstance(node, list)
            and len(node) == 2
            and node[0] == "Command"
            and node[1][0] == "CreateCondition"
        ]
        self.assertEqual(linked.count("DirectAttack"), 10)
        self.assertEqual(linked.count("Skill"), 5)
        self.assertEqual(linked.count("SkillChain"), 5)

    def test_transition_handoffs_hold_for_three_seconds(self):
        self.assertEqual(
            [
                phase["transition_handoff"]["frames"]
                for phase in self.template["phases"][:2]
            ],
            [180, 180],
        )
        self.assertEqual(
            [
                phase["transition_handoff"]["segment_frames"]
                for phase in self.template["phases"][:2]
            ],
            [60, 60],
        )
        for phase in self.template["phases"][:2]:
            self.assertEqual(
                [duration for _, duration in boss_trial.transition_handoff_states(
                    phase["transition_handoff"]
                )],
                [60, 60, 60],
            )

    def test_transition_handoffs_release_when_the_timed_handoff_exits(self):
        self.assertEqual(
            [
                phase["transition_invincible_end_state"]
                for phase in self.template["phases"][:2]
            ],
            [
                "mod_stage5_phase2_handoff__wait3",
                "mod_stage5_phase3_handoff__wait3",
            ],
        )
        for phase in self.template["phases"][:2]:
            self.assertEqual(
                boss_trial.transition_handoff_states(
                    phase["transition_handoff"]
                )[-1][0],
                phase["transition_invincible_end_state"],
            )

    def test_transition_handoff_is_required_as_withstand_end_state(self):
        invalid = copy.deepcopy(self.template)
        invalid["phases"][0]["transition_invincible_end_state"] = "wrong_state"
        with self.assertRaisesRegex(ValueError, "final timed transition handoff"):
            boss_trial.validate_template(invalid)

    def test_skill_chain_trial_has_all_four_full_resistances(self):
        skill_chain = self.template["phases"][2]
        self.assertEqual(skill_chain["trial"]["kind"], "skill_chain")
        self.assertEqual(
            skill_chain["resistances"],
            ["ability", "direct_attack", "power_flip", "skill"],
        )
        self.assertEqual(self.template["resistance_strength"], 100.0)
        self.assertEqual(self.template["resistance_layers"], 99)

    def test_every_trial_is_declared_one_shot(self):
        for phase in self.template["phases"]:
            self.assertIsNotNone(phase["trial"])
        self.assertNotIn("attack_up", self.template["common_trial_buffs"])

    def test_every_phase_has_a_dedicated_one_shot_entry_carrier(self):
        entries = []
        for phase in self.template["phases"]:
            carrier = phase.get("entry_carrier")
            self.assertIsNotNone(carrier)
            self.assertGreaterEqual(len(carrier["names"]), 1)
            entries.append(carrier["names"][0])
        self.assertEqual(len(entries), len(set(entries)))

    def test_phase_reentry_guard_restarts_the_phase_discovery_loop(self):
        # Stage 5 phase 2 enters through Fire Beast skill2 (slot 124), while
        # phase 3 enters through skill3 (slot 123).  The former 121/122 pair is
        # skill1 and never executes on either generated transition carrier.
        self.assertEqual(self.template["phase_reentry_action_slots"], [124, 123])
        logical = (
            self.template["actions"]["phase_reentry"]
            + ".action.dsl.amf3.deflate"
        )
        assets = boss_trial.build_action_assets(self.template)
        self.assertIn(logical, assets)
        tree = field_catalog.parse_dsl(assets[logical])
        repeats = [
            node
            for node in walk(tree)
            if isinstance(node, list) and node and node[0] == "Repeat"
        ]
        self.assertEqual(len(repeats), 1)
        linked = [
            node[1][8][0]
            for node in walk(tree)
            if isinstance(node, list)
            and len(node) == 2
            and node[0] == "Command"
            and node[1][0] == "CreateCondition"
        ]
        # Immediate application plus the repeated phase-discovery block.
        self.assertEqual(linked.count("DirectAttack"), 10)
        self.assertEqual(linked.count("Skill"), 10)
        self.assertEqual(linked.count("SkillChain"), 10)

    def test_trial_descriptor_stays_in_pre_clear_phase_and_entry_carrier(self):
        trial = self.template["phases"][0]["trial"]
        states = {
            "phase_entry": "phase_entry,(None),,,,,,,,,,,,,loop,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
            "phase_entry_charge": "phase_entry_charge,(None),,,,,,,,,,,,,loop,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
            "loop": "loop,(None),,,,,,,,,,,,,loop,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
            "phase_entry__mod_after_trial": "phase_entry__mod_after_trial,(None),,,,,,,,,,,,,loop__mod_after_trial,,,,,,,,(None),,false,false,(None),,,,,,,,,,,,,,,,,,,,,,,,,,",
            "loop__mod_after_trial": "loop__mod_after_trial,(None),,,,,,,,,,,,,loop__mod_after_trial,,,,,,,,(None),,false,false,(None),,,,,,,,,,,,,,,,,,,,,,,,,,",
        }
        active = {"phase_entry", "phase_entry_charge", "loop"}
        boss_trial._attach_trial(states, trial, state_names=active)
        boss_trial._audit_one_shot_phase(
            states,
            trial=trial,
            expected_trial_states=active,
            post_trial_suffix="__mod_after_trial",
        )
        descriptors = []
        for name, leaf in states.items():
            row = boss_trial.cells(leaf)
            if len(row) > 26 and row[22] not in {"", "(None)"}:
                descriptors.append(name)
        self.assertEqual(set(descriptors), active)
        self.assertFalse(any(name.endswith("__mod_after_trial") for name in descriptors))


class Stage15EyeDragonTrialTemplateTests(unittest.TestCase):
    def setUp(self):
        self.template = boss_trial.load_template(
            CONFIG, "fantasy-stage15-eye-native-four-phase-trials"
        )

    def test_preserves_native_phase_contract(self):
        self.assertTrue(self.template["preserve_native_phases"])
        self.assertEqual(self.template["source_boss"], "eye_dragon_multibattle_boss")
        self.assertEqual(
            [phase["native_phase"] for phase in self.template["phases"]],
            ["1", "2", "3"],
        )
        self.assertEqual(
            [phase["trial"]["kind"] for phase in self.template["phases"]],
            ["power_flip", "direct_attack", "skill_chain"],
        )
        self.assertEqual(
            [phase["trial"]["target"] for phase in self.template["phases"]],
            [50, 200, 7],
        )

    def test_native_trials_partition_into_official_clear_states(self):
        self.assertNotIn("native_no_jump_completion", self.template)
        self.assertEqual(
            [phase["trial"]["success_state"] for phase in self.template["phases"]],
            ["neutral3", "neutral51", "BUFF32"],
        )
        for phase in self.template["phases"]:
            partition = phase["native_state_partition"]
            self.assertEqual(
                phase["trial"]["success_state"],
                partition["post_entry_state"],
            )
            self.assertIn(partition["pre_loop_state"], partition["pre_states"])
            self.assertNotIn(partition["post_entry_state"], partition["pre_states"])

    def test_skill_chain_trial_has_all_four_full_resistances(self):
        skill_chain = self.template["phases"][2]
        self.assertEqual(skill_chain["trial"]["kind"], "skill_chain")
        self.assertEqual(
            skill_chain["resistances"],
            ["ability", "direct_attack", "power_flip", "skill"],
        )
        self.assertEqual(self.template["resistance_strength"], 100.0)
        self.assertEqual(self.template["resistance_layers"], 99)

    def test_all_native_phase_transitions_use_three_second_handoffs(self):
        self.assertEqual(
            [phase["transition_handoff"]["frames"] for phase in self.template["phases"]],
            [180, 180, 180],
        )
        self.assertEqual(
            [
                phase["transition_handoff"]["segment_frames"]
                for phase in self.template["phases"]
            ],
            [60, 60, 60],
        )
        for phase in self.template["phases"]:
            states = boss_trial.transition_handoff_states(
                phase["transition_handoff"]
            )
            self.assertEqual([duration for _, duration in states], [60] * 3)
            self.assertEqual(
                phase["transition_invincible_end_state"], states[-1][0]
            )

    def test_native_partition_destroys_the_completed_gauge(self):
        def leaf(name, next_state):
            row = [""] * 53
            row[0] = name
            row[14] = "next_native_phase"
            row[22:27] = ["2", "20", "false", "false", "(None)"]
            row[31] = next_state
            return boss_trial.join(row, "")

        states = {
            "pre_start": leaf("pre_start", "post_entry"),
            "pre_loop": leaf("pre_loop", "post_entry"),
            "post_entry": leaf("post_entry", "pre_start"),
            "post_loop": leaf("post_loop", "pre_loop"),
        }
        trial = {
            "kind": "power_flip",
            "target": 50,
            "countdown": False,
            "success_state": "post_entry",
        }
        boss_trial._partition_native_trial_phase(
            states,
            trial,
            {
                "pre_states": ["pre_start", "pre_loop"],
                "pre_loop_state": "pre_loop",
                "post_entry_state": "post_entry",
            },
        )
        for name in ("pre_start", "pre_loop"):
            row = boss_trial.cells(states[name])
            self.assertEqual(row[22:27], ["2", "50", "false", "true", "post_entry"])
            self.assertEqual(row[31], "pre_loop")
            self.assertEqual(row[14], "next_native_phase")
        for name in ("post_entry", "post_loop"):
            row = boss_trial.cells(states[name])
            self.assertEqual(row[22:27], ["(None)", "", "false", "false", "(None)"])
            self.assertEqual(row[31], "post_entry")
        self.assertEqual(boss_trial.cells(states["post_entry"])[0], "post_entry")

    def test_native_post_trial_clone_keeps_official_timeline_sequence(self):
        states = {
            "start": (
                "start,1,start,start,(None),(None),(None),(None),(None),"
                "(None),(None),(None),(None),(None),next,false,(None),"
                ",,,,,(None),,false,false,(None),,,,,loop"
            ),
            "loop": (
                "native_loop_sequence,1,neutral,neutral,(None),(None),"
                "(None),(None),(None),(None),(None),(None),(None),(None),"
                "next,false,(None),,,,,,(None),,false,false,(None),,,,,loop"
            ),
        }
        post, mapping = boss_trial._build_post_trial_chain(
            states,
            self.template["post_trial_suffix"],
            preserve_timeline_sequence=True,
        )
        self.assertEqual(boss_trial.cells(post[mapping["start"]])[0], "start")
        self.assertEqual(
            boss_trial.cells(post[mapping["loop"]])[0],
            "native_loop_sequence",
        )
        self.assertEqual(
            boss_trial.cells(post[mapping["loop"]])[31],
            mapping["loop"],
        )

    def test_all_three_native_guards_are_linked(self):
        assets = boss_trial.build_action_assets(self.template)
        guard = field_catalog.parse_dsl(next(iter(assets.values())))
        linked = [
            node[1][8][0]
            for node in walk(guard)
            if isinstance(node, list)
            and len(node) == 2
            and node[0] == "Command"
            and node[1][0] == "CreateCondition"
        ]
        self.assertEqual(linked.count("PowerFlip"), 10)
        self.assertEqual(linked.count("DirectAttack"), 5)
        self.assertEqual(linked.count("SkillChain"), 5)


if __name__ == "__main__":
    unittest.main()
