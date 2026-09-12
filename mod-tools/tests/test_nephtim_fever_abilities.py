"""奈芙提姆六能力原生数据合同与条件边界。"""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))

from test_bianca_dragon_abilities import official_sources
import wf_client_legality as legality
import wf_nephtim_fever_abilities as kit

AS3 = Path("D:/WF/outputs/re-workspace/decompile/scripts/pinball")


class NephtimFeverAbilitiesTest(unittest.TestCase):
    def setUp(self):
        self.source, _ = official_sources()
        self.rows = kit.ability_rows(self.source)

    def test_native_columns_sentinels_dark_targets_and_source_immutability(self):
        before = deepcopy(self.source)
        kit.ability_rows(self.source)
        self.assertEqual(before, self.source)
        self.assertEqual({f"169989{i}" for i in range(1, 7)}, set(self.rows))
        for rows in self.rows.values():
            for row in rows:
                self.assertEqual(126, len(row))
                self.assertEqual([], legality.client_legality_problems("ability", row))
                self.assertEqual([], legality.declared_block_field_problems("ability", row))
                self.assertEqual([], legality.ability_element_column_problems("ability", row, 6))
                self.assertNotIn("White", row)
                self.assertNotIn("Green", row)
                self.assertNotIn("Red", row)

    def test_a1_and_a3_are_main_only(self):
        for sid, rows in self.rows.items():
            self.assertEqual({"false" if sid in ("1699891", "1699893") else "true"}, {r[1] for r in rows})

    def test_a1_increases_self_maximum_without_initial_charge(self):
        maximum, flag = self.rows["1699891"][:2]
        self.assertEqual(("0", "0", "245", "0", "50000", "50000"),
                         (maximum[6], maximum[27], maximum[47], maximum[48], maximum[51], maximum[52]))
        self.assertFalse(any(r[47] == "211" for rows in self.rows.values() for r in rows))
        self.assertEqual(("2", "600000", "600000", "Black", "0", "536"),
                         (flag[6], flag[9], flag[10], flag[11], flag[13], flag[47]))
        self.assertEqual(kit.CHANGE_SKILL_STRING_ID, flag[70])
        self.assertIn("攻击力提升100%", kit.flat_string_rows()[flag[70]][0][0])
        self.assertIn("20秒", kit.flat_string_rows()[flag[70]][0][0])

    def test_summoning_counts_only_state_frames_and_fever_end_clears_only_that_state(self):
        summon, clear = self.rows["1699891"][2:4]
        self.assertEqual(("2", "Black", "12", "232", "0", "100000", "100000"),
                         (summon[6], summon[11], summon[13], summon[27], summon[28], summon[30], summon[31]))
        self.assertEqual(("12000000", "12000000", "(None)", "0", "16998901", "629"),
                         (summon[32], summon[33], summon[34], summon[35], summon[37], summon[47]))
        self.assertEqual([kit.SPAWN_STRING_ID, kit.SPAWN_ACTION_PATH], summon[70:72])
        self.assertEqual(("0", "0", "184", "528", "0", "16998901"),
                         (clear[6], clear[13], clear[27], clear[47], clear[48], clear[68]))
        self.assertEqual(1200, kit.metadata()["skill_enhancement"]["per_ball_duration_frames"])
        custom = kit.ability_rows(self.source, summon_unique_id=12345, spawn_action_path="custom/action")
        self.assertEqual("12345", custom["1699891"][2][37])
        self.assertEqual("12345", custom["1699891"][3][68])
        self.assertEqual("custom/action", custom["1699891"][2][71])

    def test_silent_zone_exit_cleanup_requires_existing_self_state_and_non_fever(self):
        row = self.rows["1699891"][4]
        self.assertEqual(["187", "0", "", "", "", "", "16998901"], row[6:13])
        self.assertEqual(("186", "77", "100000", "100000", "528", "0", "16998901"),
                         (row[13], row[27], row[30], row[31], row[47], row[48], row[68]))
        custom = kit.ability_rows(self.source, summon_unique_id=12345)["1699891"][4]
        self.assertEqual(("12345", "12345"), (custom[12], custom[68]))
        for fever in (False, True):
            for own_state in (False, True):
                # Native P187 checks only self; an unrelated UID remains intact.
                states = {99999} | ({16998901} if own_state else set())
                deletions = 0
                if not fever and int(row[12]) in states:
                    states.remove(int(row[68]))
                    deletions += 1
                self.assertIn(99999, states)
                self.assertEqual(int(own_state and not fever), deletions)
                self.assertEqual(own_state and fever, 16998901 in states)

    @unittest.skipUnless(AS3.is_dir(), "native decompile unavailable")
    def test_summon_state_native_encoffin_cleanup_and_existing_unique_precondition(self):
        import wf_nephtim_fever_skill as skill
        self.assertEqual("true", skill.unique_rows()[str(kit.SUMMON_UNIQUE_ID)][0][13])
        member = (AS3 / "scene/battle/battle/squad/member/MemberImpl.as").read_text()
        encoffin = member[member.index("public function enterEncoffinmentState("):]
        self.assertIn("conditionSlot.purge(coffinNotRemoveConditionUnique)", encoffin[:500])
        conditions = (AS3 / "scene/battle/battle/condition/ConditionSlot.as").read_text()
        purge = conditions[conditions.index("public function purge("):conditions.index("public function matchDirectionForStatistics")]
        self.assertIn("Boolean(_loc7_.params[3])", purge)
        self.assertIn("if(!(param1 || !_loc8_))", purge)
        pre = (AS3 / "common/data/ability/pre/AbilityPreconditionMasterValueTools.as").read_text()
        unique = pre[pre.index("case 187:"):pre.index("case 188:")]
        self.assertIn("ConditionTargetKind.Unique(int(_loc4_.unique_condition_id)),1,Option.Some(1)", unique)

    def test_a2_and_a6_dark_gates_and_native_party_piercing_extension(self):
        extension, direct = self.rows["1699892"]
        final = self.rows["1699896"][0]
        for row in (extension, direct, final):
            self.assertEqual(("2", "600000", "600000", "Black", "0"),
                             (row[6], row[9], row[10], row[11], row[13]))
        self.assertEqual(("190", "20000", ""), (extension[47], extension[51], extension[48]))
        self.assertEqual(("33", "250000", "5", "Black"),
                         (direct[47], direct[51], direct[48], direct[49]))
        self.assertEqual(("33", "100000", "5", "Black"),
                         (final[47], final[51], final[48], final[49]))

    def test_a3_current_combo_independent_term(self):
        combo = self.rows["1699893"][0]
        self.assertEqual(("1", "2", "Black", "12", "2", "100000", "100000", "(None)"),
                         (combo[5], combo[6], combo[11], combo[13], combo[97], combo[100], combo[101], combo[102]))
        self.assertEqual(("410", "5", "Black", "500", "500"),
                         (combo[109], combo[110], combo[111], combo[113], combo[114]))
        bonuses = [count * int(combo[113]) / 1000 for count in (0, 1, 70, 1000, 2)]
        self.assertEqual([0, 0.5, 35, 500, 1], bonuses)
        self.assertIsNone(kit.metadata()["combo_bonus"]["trigger_limit"])
        self.assertTrue(kit.metadata()["combo_bonus"]["falls_when_combo_falls"])

    def test_a3_piercing_growth_is_gated_per_frame_and_keeps_permanent_uncapped_gains(self):
        for row, content in zip(self.rows["1699893"][1:3], ("32", "33")):
            self.assertEqual(("2", "Black", "12", "235", "100000", "12000000", "(None)"),
                             (row[6], row[11], row[13], row[27], row[30], row[32], row[34]))
            self.assertEqual((content, "5", "Black", "20000", "20000", "", ""),
                             (row[47], row[48], row[49], row[51], row[52], row[57], row[58]))
        self.assertTrue(kit.metadata()["piercing_growth"]["persists_after_fever"])

    def test_a4_covers_dark_members_and_all_cooperative_balls_with_distinct_targets(self):
        members, balls = self.rows["1699894"]
        for row in (members, balls):
            self.assertEqual(("2", "Black", "12", "4", "410", "20000", "20000"),
                             (row[6], row[11], row[13], row[97], row[109], row[113], row[114]))
        self.assertEqual(("5", "Black"), (members[110], members[111]))
        self.assertEqual(("8", ""), (balls[110], balls[111]))

    def test_a5_has_no_resonance_gate_and_uses_native_timers_and_three_second_status(self):
        for row, gate, trigger, threshold in zip(self.rows["1699895"],
                ("186", "12"), ("77", "248"), ("60000000", "30000000")):
            self.assertEqual(("0", gate, trigger, threshold, "26"),
                             (row[6], row[13], row[27], row[30], row[47]))
            self.assertEqual(("18000000", "18000000", "100000", "100000"), tuple(row[57:61]))
            self.assertEqual("(None)", row[34])

    @unittest.skipUnless(AS3.is_dir(), "native decompile unavailable")
    def test_native_condition_frame_counter_and_precondition_filter_are_not_elapsed_time(self):
        source = (AS3 / "scene/battle/battle/ability/ThresholdConditionKeepFrameCountHandler.as").read_text()
        update = source[source.index("public function update()"):source.index("public function setContinuationDataIfMatch")]
        self.assertIn("conditionCountGetter(targetKind)", update)
        self.assertIn("if(_loc1_ >= triggerCount)", update)
        self.assertIn("countHandler(_loc2_,1)", update)
        handler = (AS3 / "scene/battle/battle/ability/_InstantAbility/AbilityTriggerHandler.as").read_text()
        count = handler[handler.index("public function countHandler("):]
        self.assertLess(count.index("AbilityPrecondition_Impl_.isActive"), count.index("calledCount += param2"))


if __name__ == "__main__":
    unittest.main()
