"""A4只替换无效球行，且本地状态不覆盖A3、主队或副位许可。"""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_client_legality as legality
import wf_dsl
import wf_nephtim_fever_abilities as abilities
import wf_nephtim_multiball_direct as a3
import wf_nephtim_multiball_fever as a4
from test_bianca_dragon_abilities import official_sources


class NephtimMultiballFeverTests(unittest.TestCase):
    def original(self):
        # The pre-fix native row factory is retained for this independent fixture.
        source = official_sources()[0]
        rows = [abilities._during(source, 410, 50_000, target=target) for target in (5, 8)]
        for row in rows:
            row[0] = "ruin_girl_campus_4"
        return rows

    def test_long_term_builder_uses_same_rows_and_flat_string_as_revision(self):
        self.assertEqual(abilities.ability_rows(official_sources()[0])["1699894"],
                         a4.replace_ball_row(self.original()))
        self.assertEqual(abilities.flat_string_rows()[a4.STRING_ID], a4.flat_string_rows()[a4.STRING_ID])
        self.assertEqual(abilities.metadata()["fever_multiball_direct_bonus"], a4.metadata())

    def test_real_rows_preserve_party_and_gate_but_replace_only_ball_during_content(self):
        original = self.original()
        unchanged = deepcopy(original)
        revised = a4.replace_ball_row(original)
        self.assertEqual(original, unchanged)
        self.assertEqual(revised[0], original[0])
        self.assertEqual(revised[1][:5], original[1][:5])
        self.assertEqual(revised[1][6:27], original[1][6:27])
        self.assertEqual(revised[1][85:97], original[1][85:97])
        row = revised[1]
        self.assertEqual(("true", "0", "77", "100000", "100000", "0", "629"),
                         (row[1], row[5], row[27], row[30], row[31], row[35], row[47]))
        self.assertEqual(row[70:72], [a4.STRING_ID, a4.ACTION_PATH])
        self.assertEqual(row[97:], [""] * 29)
        self.assertEqual([], legality.client_legality_problems("ability", row))
        self.assertEqual([], legality.declared_block_field_problems("ability", row))
        self.assertEqual(a4.replace_ball_row(revised), revised)

    def test_existing_during_party_row_is_still_dark_and_fever_fifty_percent(self):
        row = a4.replace_ball_row(self.original())[0]
        self.assertEqual(("2", "Black", "12", "410", "5", "Black", "50000", "50000"),
            (row[6], row[11], row[13], row[109], row[110], row[111], row[113], row[114]))

    def test_actual_encoded_helper_has_no_damage_count_or_persistent_action(self):
        raw = a4.action_assets()["common", a4.LOGICAL_PATH]
        tree = wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"]
        self.assertEqual(tree, a4.action_tree())
        self.assertEqual([], legality.action_dsl_subject_binding_problems(tree))
        nodes = list(wf_dsl.iter_dsl_commands(tree))
        self.assertEqual(["FindMultiballSubjects", "CreateCondition"], [x[0] for x in nodes])
        find, condition = nodes
        self.assertEqual([80, 81, False, [], ["Block", []]], find[1:6])
        self.assertEqual(condition[1], 81)
        self.assertEqual(condition[2], [["ACSeparatedTermDirectDamage",
            [{"min": 2, "max": 2}], [{"min": .5, "max": .5}], [{"min": 1, "max": 1}]]])
        self.assertEqual(condition[3:], [[{"min": 1, "max": 1}], ["None"], False, False,
            a4.CONDITION_KEY, None, True, 3, [{"min": 1, "max": 1}], False])

    def test_a3_and_a4_are_independent_condition_origins(self):
        self.assertNotEqual(a3.CONDITION_KEY, a4.CONDITION_KEY)
        self.assertNotEqual(a3.LOGICAL_PATH, a4.LOGICAL_PATH)
        self.assertEqual(a4.flat_string_rows()[a4.STRING_ID], [["协力球对敌人造成的直接攻击伤害+50%（独立乘区）。"]])
        self.assertNotIn("desc_override_", a4.STRING_ID)

    def test_unknown_strength_or_unison_policy_is_rejected(self):
        for column, value in ((113, "30000"), (1, "false"), (13, "0")):
            rows = self.original()
            rows[1][column] = value
            with self.assertRaisesRegex(ValueError, "strength, resonance, Fever or unison"):
                a4.replace_ball_row(rows)


if __name__ == "__main__":
    unittest.main()
