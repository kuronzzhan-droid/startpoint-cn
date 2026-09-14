"""技能目标、原生DSL、限时轮转与普通协力球的回归检查。"""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_client_legality as legality
import wf_dsl
import wf_dsl_sig
import wf_nephtim_fever_skill as skill
from wf_character_revision import encode_tree


def nodes(tree, name):
    if not isinstance(tree, list):
        return []
    return ([tree] if tree and tree[0] == name else []) + [
        found for child in tree for found in nodes(child, name)]


class NativePhaseModel:
    """Transcribe only native control flow/ConditionSlot signed consumption.

    The expiry is external; native consume changes accumulation only, unlike
    adding an ACUnique which may refresh the existing time limit.
    """
    def __init__(self, count=1, fever=True):
        self.count, self.fever = count, fever
        self.now = 0
        self.expiry = 1200
        self.summons = []

    def run(self, node):
        if node[0] == "ActionDsl":
            return self.run(node[11])
        if node[0] == "Block":
            for child in node[1]:
                self.run(child)
        elif node[0] == "Command":
            self.run(node[1])
        elif node[0] == "ConditionalsFeverMode":
            self.run(node[1 if self.fever else 2])
        elif node[0] == "ConditionalsChangeSkillFlag":
            self.run(node[2])
        elif node[0] == "ConditionalsConditionExist":
            self.run(node[3 if self.count else 4])
        elif node[0] == "ConditionalsConditionAccumulationNumber":
            self.run(node[3 if self.count >= node[2] else 4])
        elif node[0] == "ConsumeUniqueCondition":
            if self.count:
                self.count -= min(self.count, node[3][1])
        elif node[0] == "CreateSummonsMultiball":
            self.summons.append(node[2])
            self.run(node[12])
        elif node[0] == "CreateCondition":
            for content in node[2]:
                if content[0] == "ACUnique":
                    added = content[2][0]["max"] * node[11][0]["max"]
                    if self.count or added > 0:
                        self.count = min(2, self.count + added)
                        self.expiry = max(self.expiry, self.now + 1200)


class NephtimSkillTests(unittest.TestCase):
    def test_only_existing_ball_plain_buffs_stop_forcing_dead_targets(self):
        for level in (1, 2):
            conditions = nodes(skill.build_skill(level), "CreateCondition")
            ball = [node for node in conditions if node[1] == 71]
            self.assertEqual(len(ball), 2)
            self.assertEqual({node[2][0][0] for node in ball},
                             {"ACAdditionalDirectAttack", "ACAttackPoint"})
            self.assertTrue(all(node[12] is False for node in ball))
            self.assertTrue(all(node[12] is True for node in conditions if node[1] != 71))
        for kind in ("light", "dark"):
            born = nodes(skill.summon(kind), "CreateCondition")
            self.assertEqual(len(born), 1)
            self.assertIs(born[0][12], True)
            self.assertTrue(nodes(born[0], "ACHealRejection"))

    def test_three_programs_roundtrip_and_native_instruction_bindings(self):
        for tree in (skill.build_skill(1), skill.build_skill(2), skill.build_spawn()):
            self.assertEqual(wf_dsl.parse_dsl(zlib.decompress(encode_tree(tree), -15))["tree"], tree)
            problems = (legality.action_dsl_element_problems(tree, character_element=5)
                        + legality.action_dsl_subject_binding_problems(tree)
                        + legality.action_dsl_hit_area_target_problems(tree))
            self.assertFalse(problems, problems)
            for kind, registry in (("Command", wf_dsl_sig.COMMANDS), ("Event", wf_dsl_sig.EVENTS)):
                for wrapped in nodes(tree, kind):
                    command = wrapped[1]
                    self.assertIn(command[0], registry)
                    self.assertEqual(len(command)-1, len(registry[command[0]]), command[0])
        with self.assertRaises(ValueError):
            skill.build_skill(3)

    def test_base_covers_local_party_balls_and_remote_piercing(self):
        tree = skill.build_skill(2)
        finds = nodes(tree, "FindAllSubjects")
        base = next(node for node in finds if node[2] == 33)
        self.assertEqual(base[3], [])
        self.assertTrue(nodes(base, "ACDirectDamage"))
        self.assertTrue(nodes(base, "ACPiercing"))
        self.assertEqual(nodes(tree, "TargetMate"), [["TargetMate", 73, [], [], [], [], []]])
        remote = next(node for node in nodes(tree, "CreateCondition") if node[1] == 73)
        self.assertEqual(remote[2], [["ACPiercing", skill.value(1200)]])
        for source in (82, 86):
            for find in (node for node in finds if node[2] == source):
                self.assertEqual(find[3], [6] if source == 82 else [])

    def test_double_hits_and_newborn_buffs_are_not_inherited_implicitly(self):
        for kind in ("light", "dark"):
            summon = skill.summon(kind)[1]
            self.assertEqual(summon[0], "CreateSummonsMultiball")
            self.assertEqual(summon[3], skill.value(1500))
            callback = summon[12]
            self.assertEqual(nodes(callback, "ACAttackPoint"),
                             [["ACAttackPoint", skill.value(1200), skill.value(2.5), skill.value(1)]])
            self.assertTrue(nodes(callback, "ACDirectDamage"))
            self.assertTrue(nodes(callback, "ACPiercing"))
            extra = nodes(callback, "ACAdditionalDirectAttack")[0]
            hits, bonus = extra[2][0]["max"], extra[3][0]["max"]
            self.assertEqual((hits, hits * ((1 + bonus) / hits)), (2, 2))
            self.assertFalse(nodes(callback, "ACUnique"), "callbacks must not extend tea expiry")
            self.assertEqual(nodes(callback, "ACHealRejection"),
                             [["ACHealRejection", skill.value(1500)]])
            for name in ("ACAttackPoint", "ACDirectDamage", "ACPiercing", "ACAdditionalDirectAttack"):
                self.assertEqual(nodes(callback, name)[0][1], skill.value(1200),
                                 "25s ball lifetime must not extend the 20s newborn buffs")
        self.assertEqual(skill.metadata()["each_ball_lifetime_frames"], 1500)
        self.assertEqual(skill.metadata()["duration_frames"], 1200)

    def test_phase_alternates_ninety_nine_times_without_refreshing_expiry(self):
        model = NativePhaseModel()
        program = skill.build_spawn()
        for _ in range(99):
            model.run(program)
            self.assertIn(model.count, (1, 2))
        self.assertEqual(model.summons, [skill.LIGHT_ID, skill.DARK_ID] * 49 + [skill.LIGHT_ID])
        self.assertEqual(model.expiry, 1200)

    def test_repeated_callback_and_late_callback_do_not_grow_or_recreate_state(self):
        for count, kind, expected in ((1, "light", 2), (2, "dark", 1)):
            model = NativePhaseModel(count)
            callback = skill.summon(kind)[1][12]
            model.run(callback)
            model.run(callback)
            self.assertEqual(model.count, expected)
            model.count = 0
            model.run(callback)
            self.assertEqual(model.count, 0)
        for count, fever in ((0, True), (1, False), (2, False)):
            model = NativePhaseModel(count, fever)
            model.run(skill.build_spawn())
            self.assertEqual(model.summons, [])
            model.run(skill.summon("light")[1][12])
            self.assertEqual(model.count, count)

    def test_recasting_refreshes_duration_without_breaking_light_dark_alternation(self):
        model = NativePhaseModel()
        for index in range(99):
            model.run(skill.build_spawn())
            old_phase = model.count
            model.now = (index+1) * 120
            model.run(skill.build_skill(2))
            self.assertEqual(model.count, old_phase)
            self.assertEqual(model.expiry, model.now+1200)
        self.assertEqual(model.summons, [skill.LIGHT_ID, skill.DARK_ID]*49 + [skill.LIGHT_ID])
        zero_refresh = next(node for node in nodes(skill.build_skill(2), "CreateCondition")
                            if node[11] == skill.value(0))
        model.count = 0
        model.run(zero_refresh)
        self.assertEqual(model.count, 0, "late zero refresh must not recreate an expired state")

    def test_active_buff_refresh_does_not_recreate_or_renew_existing_ball_lifetime(self):
        for level in (1, 2):
            active = skill.build_skill(level)
            self.assertFalse(nodes(active, "CreateSummonsMultiball"))
            self.assertFalse(nodes(active, "RemoveMultiball"))
            for name in ("ACAttackPoint", "ACDirectDamage", "ACPiercing", "ACAdditionalDirectAttack"):
                for content in nodes(active, name):
                    self.assertEqual(content[1], skill.value(1200))
        self.assertEqual([node[3] for node in nodes(skill.build_spawn(), "CreateSummonsMultiball")],
                         [skill.value(1500), skill.value(1500)])
        self.assertEqual(skill.unique_rows()[str(skill.STATE_UID)][0][3], "1200")

    def test_one_timed_hud_state_and_multiball_curves_supports_preserved(self):
        rows = skill.unique_rows()
        self.assertEqual(set(rows), {str(skill.STATE_UID)})
        self.assertEqual(rows[str(skill.STATE_UID)][0][3:5], ["1200", "2"])
        self.assertEqual(rows[str(skill.STATE_UID)][0][13], "true")
        donor = ["native_1", "native", "5", "5"] + [str(i) for i in range(4, 30)]
        multiballs, levels = {"1611772": [donor]}, {
            "1611772": [["native_hp_curve", "465", "1", "native_atk_curve", "680", "1"]]}
        before = deepcopy((multiballs, levels))
        result = skill.multiball_rows(multiballs, levels)
        for uid, element in ((skill.LIGHT_ID, "4"), (skill.DARK_ID, "5")):
            row = result["master/battle/multiball/multiball.orderedmap"][str(uid)][0]
            self.assertEqual(row[2], donor[2])
            self.assertEqual(row[3], element)
            self.assertEqual(row[4:], donor[4:])
            self.assertEqual(result["master/battle/multiball/multiball_level.orderedmap"][str(uid)],
                             [["native_hp_curve", "465", "1", "native_atk_curve", "680", "1"]])
        self.assertEqual((multiballs, levels), before)


if __name__ == "__main__":
    unittest.main()
