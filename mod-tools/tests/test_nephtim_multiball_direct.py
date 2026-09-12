"""当前球数、真实本地状态槽与短脚本生命周期的独立边界检查。"""
from fractions import Fraction
from pathlib import Path
import sys
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).parents[1]))
from test_bianca_dragon_abilities import official_sources
import wf_client_legality as legality
import wf_dsl
import wf_nephtim_fever_abilities as abilities
import wf_nephtim_fever_text as text
import wf_nephtim_multiball_direct as bonus

AS3 = Path("D:/WF/outputs/re-workspace/decompile/scripts/pinball")


def commands(tree):
    return list(wf_dsl.iter_dsl_commands(tree))


class NephtimMultiballDirectTest(unittest.TestCase):
    def test_real_row_party_and_balls_share_one_refresh_without_a_different_count_gate(self):
        rows = abilities.ability_rows(official_sources()[0])["1699893"]
        self.assertEqual(5, len(rows))
        pulse = rows[-1]
        for row in (pulse,):
            self.assertEqual(("false", "2", "600000", "600000", "Black", "0"),
                             (row[1], row[6], row[9], row[10], row[11], row[20]))
            self.assertEqual([], legality.client_legality_problems("ability", row))
            self.assertEqual([], legality.declared_block_field_problems("ability", row))
        self.assertEqual(("0", "", "", "77", "100000", "(None)", "0", "629"),
                         (pulse[13], pulse[16], pulse[17], pulse[27], pulse[30], pulse[34], pulse[35], pulse[47]))
        self.assertEqual([bonus.STRING_ID, bonus.ACTION_PATH], pulse[70:72])
        self.assertFalse(any(row[97] == "208" for row in rows))
        line = text.panel_descriptions()["a3"].splitlines()[-1]
        self.assertTrue(line.startswith(text.MAIN_ICON))
        self.assertIn("全队及协力球", line)
        self.assertIn("10%", line)
        self.assertNotIn("Fever", line)

    def test_dsl_roundtrip_all_balls_null_filter_and_no_lingering_objects(self):
        raw = bonus.action_assets()["common", bonus.LOGICAL_PATH]
        tree = wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"]
        self.assertEqual(bonus.action_tree(), tree)
        for check in (legality.action_dsl_subject_binding_problems,
                      legality.action_dsl_hit_area_target_problems):
            self.assertEqual([], check(tree))
        nodes = commands(tree)
        self.assertEqual(["MultiballNumberVariable", "FindAllSubjects", "CreateCondition",
                          "FindMultiballSubjects", "CreateCondition"],
                         [node[0] for node in nodes])
        count, party, party_condition, find, condition = nodes
        self.assertEqual([1, False, None, [], 1, 2147483647], count[1:])
        self.assertEqual([70, 71, False, []], find[1:5])
        self.assertEqual([72, 82, [], [], [], [], []], party[1:8])
        self.assertEqual(72, party_condition[1])
        self.assertEqual(party_condition[2:], condition[2:])
        self.assertEqual("Block", tree[-1][0])
        self.assertEqual(71, condition[1])
        self.assertEqual(["None"], condition[4])
        self.assertEqual([False, False, bonus.CONDITION_KEY, None, True, 3], condition[5:11])
        self.assertEqual([{"min": 1, "max": 1}], condition[11])
        self.assertIs(condition[12], True)
        ac = condition[2][0]
        self.assertEqual("ACSeparatedTermDirectDamage", ac[0])
        self.assertEqual([{"min": 2, "max": 2}], ac[1])
        self.assertEqual([{"min": 0.1, "max": 0.1, "mul": 1}], ac[2])
        self.assertEqual([{"min": 1, "max": 1}], ac[3])

    def test_count_reduction_new_ball_and_repeated_refresh_never_accumulate(self):
        # Model the native impact result: stable origin/type/key; N is content,
        # while maxAccum and magnification remain 1, so lower N replaces too.
        slots = {}
        unrelated = ("other-origin", "SeparatedTermDirectDamage", "other-key")
        key = ("same-a3-source", "SeparatedTermDirectDamage", bonus.CONDITION_KEY)
        for ids in ([], [1], list(range(1, 21)), [1, 2], [2, 21], []):
            targets = [-1, -2, -3, *ids]
            slots = {i: slots.get(i, {unrelated: Fraction(3, 20)}) for i in targets}
            for _ in range(60):
                for slot in slots.values():
                    slot[key] = Fraction(len(ids), 10)
                self.assertTrue(all(len(slot) == 2 for slot in slots.values()))
                self.assertTrue(all(slot[key] == Fraction(len(ids), 10) for slot in slots.values()))
                self.assertTrue(all(slot[unrelated] == Fraction(3, 20) for slot in slots.values()))
        self.assertEqual({-1, -2, -3}, set(slots))
        self.assertTrue(all(slot[key] == 0 for slot in slots.values()))

    def test_surviving_scope_uses_identical_n_for_primary_and_ball_targets(self):
        # Author accepted WithDetail, which includes inactive/ectoplasmic live
        # objects regardless of their parameter-check participation flag.
        surviving = [("active", True), ("inactive", False), ("ectoplasmic", False)]
        count = len(surviving)
        native_parameter_count = sum(state == "active" or flag for state, flag in surviving)
        self.assertEqual((3, 1), (count, native_parameter_count))
        effects = [Fraction(count, 10)] * (3 + len(surviving))
        self.assertEqual({Fraction(3, 10)}, set(effects))
        self.assertNotIn(Fraction(native_parameter_count, 10), effects)

    def test_gates_stop_new_pulses_and_last_in_flight_write_has_bounded_tail(self):
        for main, unlocked, resonance, alive in ((False, True, True, True),
                (True, False, True, True), (True, True, False, True), (True, True, True, False)):
            gate = main and unlocked and resonance and alive
            for in_flight in (False, True):
                remaining = 1
                history = []
                for frame in range(4):
                    remaining = max(0, remaining - 1)
                    if gate or (frame == 0 and in_flight):
                        remaining = bonus.TTL_FRAMES
                    history.append(remaining)
                self.assertEqual([2, 1, 0, 0] if in_flight else [0, 0, 0, 0], history)

    def test_five_minute_twenty_ball_cost_is_bounded_not_an_accumulated_action_list(self):
        active_evaluators, max_evaluators, overwrites = 0, 0, 0
        current_conditions = {}
        for _ in range(5 * 60 * 60):
            active_evaluators += 1
            max_evaluators = max(max_evaluators, active_evaluators)
            for ball in range(23):  # 20 multiballs and three primary members.
                current_conditions[ball] = (bonus.CONDITION_KEY, Fraction(2), 2)
                overwrites += 1
            # The helper registers no events, effects, hit areas or subprocedures.
            active_evaluators -= 1
        self.assertEqual((0, 1, 23, 414000),
                         (active_evaluators, max_evaluators, len(current_conditions), overwrites))

    @unittest.skipUnless(AS3.is_dir(), "native sources unavailable")
    def test_native_chain_reads_local_hidden_slot_and_removes_finished_evaluator(self):
        member = (AS3 / "scene/battle/battle/squad/member/MemberImpl.as").read_text()
        getter = member[member.index("public function getStatModifierSeparatedTermDirectAttackDamage()"):
                        member.index("public function getStatModifierSeparatedTermDirectAttackDamage()") + 350]
        self.assertIn("abilityTotalizer.getTotalSeparatedTermDirectDamage() + conditionSlot", getter)
        self.assertNotIn("commonMultiball", getter)
        condition = (AS3 / "scene/battle/battle/condition/ConditionSlot.as").read_text()
        getter = condition[condition.index("public function getTotalSeparatedTermDirectDamage()"):
                           condition.index("public function getTotalRegeneration()")]
        self.assertIn("invisibleSlot", getter)
        self.assertIn("_loc8_.index == 39", getter)
        evaluator = (AS3 / "scene/battle/battle/action/ActionEvaluator.as").read_text()
        self.assertIn("getMultiballNumberWithDetail(_loc69_,_loc12_,_loc13_)", evaluator)
        self.assertIn("listeningEvents.isEmpty() && dispatchedEvents.isEmpty()", evaluator)
        manager = (AS3 / "scene/battle/battle/action/ActionEvaluatorManager.as").read_text()
        self.assertIn("if(_loc2_.willRemove())", manager)
        self.assertIn("removeChild(_loc2_)", manager)


if __name__ == "__main__":
    unittest.main()
