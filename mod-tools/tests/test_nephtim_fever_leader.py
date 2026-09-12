"""奈芙提姆队长的PF门、直击计数与暗共鸣常驻贯穿延时。"""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))

from test_bianca_dragon_abilities import official_sources
import wf_client_legality as legality
import wf_nephtim_fever_abilities as abilities
import wf_nephtim_fever_leader as kit


class NephtimFeverLeaderTest(unittest.TestCase):
    def setUp(self):
        self.source, _ = official_sources()
        self.rows = kit.leader_rows(self.source)

    def test_all_rows_are_native_dark_only_and_leave_sources_untouched(self):
        before = deepcopy(self.source)
        kit.leader_rows(self.source)
        self.assertEqual(before, self.source)
        for row in self.rows:
            self.assertEqual(124, len(row))
            self.assertEqual([], legality.client_legality_problems("leader_ability", row))
            self.assertEqual([], legality.declared_block_field_problems("leader_ability", row))
            self.assertEqual([], legality.ability_element_column_problems("leader_ability", row, 6))
            self.assertEqual(["2", "", "", "600000", "600000", "Black", ""], row[4:11])

    def test_native_special_pf_references_the_combined_three_level_program(self):
        pf = self.rows[0]
        self.assertEqual("722", pf[45])
        self.assertEqual([kit.PF_ID, "1,2,3", kit.PF_STRING_ID], pf[80:83])
        custom = kit.leader_rows(self.source, power_flip_id="custom_pf", power_flip_string_id="custom_text")
        self.assertEqual(["custom_pf", "1,2,3", "custom_text"], custom[0][80:83])

    def test_dark_base_direct_attack_and_fever_only_skill_gauge_maximum(self):
        direct, attack, maximum = self.rows[1:4]
        self.assertEqual(("33", "400000", "5", "Black", "0"),
                         (direct[45], direct[49], direct[46], direct[47], direct[11]))
        self.assertEqual(("32", "200000", "5", "Black", "0"),
                         (attack[45], attack[49], attack[46], attack[47], attack[11]))
        self.assertEqual(("1", "12", "4", "124", "5", "Black", "10000", "10000"),
                         (maximum[3], maximum[11], maximum[95], maximum[107], maximum[108],
                          maximum[109], maximum[111], maximum[112]))

    def test_dark_resonance_grants_one_constant_party_extension(self):
        self.assertEqual(8, len(self.rows))
        row = self.rows[4]
        self.assertEqual(("0", "0", "0", "190", "", "20000", "20000"),
                         (row[3], row[11], row[25], row[45], row[46], row[49], row[50]))
        extension = kit.metadata()["piercing_extension"]
        self.assertFalse(extension["requires_fever"])
        self.assertEqual("dark_resonance", extension["strategy"])

    def test_piercing_stacks_with_ability2_without_transition_increments(self):
        extension_rows = [row for row in self.rows if row[45] == "190"]
        self.assertEqual(1, len(extension_rows))
        self.assertEqual({"0"}, {row[25] for row in extension_rows})
        self.assertFalse({"8", "184", "139", "18"} & {row[25] for row in self.rows})
        a2 = abilities.ability_rows(self.source)["1699892"][0]
        self.assertEqual(("0", "190", "20000"), (a2[27], a2[47], a2[51]))
        self.assertEqual(40000, int(extension_rows[0][49]) + int(a2[51]))
        self.assertEqual(40, kit.metadata()["piercing_extension"]["with_ability2_percent"])

    def test_only_the_approved_piercing_strategy_is_accepted(self):
        self.assertEqual(self.rows, kit.leader_rows(self.source, piercing_extension="dark_resonance"))
        for policy in ("fever", "own_fever_sources", "", None):
            with self.subTest(policy=policy), self.assertRaisesRegex(ValueError, "approved dark_resonance"):
                kit.leader_rows(self.source, piercing_extension=policy)


if __name__ == "__main__":
    unittest.main()
