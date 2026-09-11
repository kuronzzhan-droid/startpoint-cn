"""校园希尔媞用户能力契约；fixture 来自官方最新希尔媞的完整 CSV。"""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wf_celtie_fever_abilities as kit
import wf_client_legality as legality


def official_sources():
    row = "wind_spgirl_4anv_1,false,action_skill,0,,0,0,,,,,,,0,,,,,,,0,,,,,,,0,,,,,,,,,,,,(None),,,,,,,0,211,0,,,50000,100000,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,"
    return {"1412011": [row.split(",")]}


class CeltieFeverAbilitiesTest(unittest.TestCase):
    def setUp(self):
        self.source = official_sources()
        self.rows = kit.ability_rows(self.source)

    def test_all_rows_pass_native_shape_fields_and_wind_element_validation(self):
        original = copy.deepcopy(self.source)
        kit.ability_rows(self.source)
        self.assertEqual(original, self.source)
        self.assertEqual({f"149989{i}" for i in range(1, 7)}, set(self.rows))
        for rows in self.rows.values():
            for row in rows:
                self.assertEqual(126, len(row))
                self.assertEqual([], legality.client_legality_problems("ability", row))
                self.assertEqual([], legality.declared_block_field_problems("ability", row))
                self.assertEqual([], legality.ability_element_column_problems("ability", row, 3))

    def test_only_third_ability_is_main_restricted(self):
        for sid, rows in self.rows.items():
            self.assertEqual({"false" if sid.endswith("3") else "true"},
                             {r[1] for r in rows})

    def test_opening_charge_and_learned_wind_resonance_flag_are_separate(self):
        charge, flag = self.rows["1499891"]
        self.assertEqual(("0", "0", "211", "0", "50000", "50000"),
                         (charge[6], charge[27], charge[47], charge[48], charge[51], charge[52]))
        self.assertEqual(("2", "600000", "600000", "Green", "0", "536"),
                         (flag[6], flag[9], flag[10], flag[11], flag[27], flag[47]))
        self.assertEqual(kit.CHANGE_SKILL_STRING_ID, flag[70])

    def test_change_skill_flag_has_a_flat_text_entry_required_by_native_client(self):
        flag = self.rows["1499891"][1]
        strings = kit.flat_string_rows()
        self.assertEqual({flag[70]}, set(strings))
        self.assertEqual(1, len(strings[flag[70]]))
        text = strings[flag[70]][0][0]
        for term in ("贯穿", "15秒", "风属性角色能力伤害提升100%", "风属性抗性降低25%"):
            self.assertIn(term, text)
        self.assertIn("命中敌人", text)
        self.assertNotIn("全场敌人", text)
        self.assertTrue(kit.metadata()["a1_enhancement"]["requires_skill_dsl_change_skill_flag_branch"])

    def test_a2_uses_native_three_split_hits_and_requires_six_wind_members(self):
        triple, damage = self.rows["1499892"]
        for row in (triple, damage):
            self.assertEqual(("2", "600000", "600000", "Green", "5", "Green"),
                             (row[6], row[9], row[10], row[11], row[48], row[49]))
        self.assertEqual(("202", "0", "0"), (triple[47], triple[51], triple[52]))
        self.assertEqual(("388", "200000", "200000"),
                         (damage[47], damage[51], damage[52]))

    def test_direct_attack_counter_gates_and_all_enemy_damage_are_exact(self):
        damage, gauge = self.rows["1499893"][:2]
        for row in (damage, gauge):
            self.assertEqual(("2", "Green", "600000", "20", "7", "Green", "3500000"),
                             (row[6], row[11], row[9], row[27], row[28], row[29], row[30]))
            self.assertEqual(("(None)", "0"), (row[34], row[35]))
        self.assertEqual(("12", "254", "0", "2500000", "(None)"),
                         (damage[13], damage[47], damage[48], damage[51], damage[69]))
        self.assertEqual(("186", "724", "5000", "", ""),
                         (gauge[13], gauge[47], gauge[51], gauge[48], gauge[69]))
        self.assertEqual(["kyubi-fever-ratio-v1"],
                         legality.required_client_capabilities("ability", gauge))

    def test_combo_attack_caps_independently_while_team_gauge_remains_unlimited(self):
        attack, charge = self.rows["1499893"][2:]
        for row in (attack, charge):
            self.assertEqual(("2", "Green", "12", "12", "7000000", "5", "Green"),
                             (row[6], row[11], row[13], row[27], row[30], row[48], row[49]))
            self.assertEqual("", row[57])  # Permanent native stat gain, no timed buff.
        self.assertEqual(("32", "70000", "10"), (attack[47], attack[51], attack[34]))
        self.assertEqual(700_000, int(attack[51]) * int(attack[34]))
        self.assertEqual(("211", "7000", "(None)"), (charge[47], charge[51], charge[34]))

    def test_periodic_party_states_use_180_fever_frames_and_90_frame_duration(self):
        for slot, content in ((4, "26"), (5, "27"), (6, "688")):
            row = self.rows[f"149989{slot}"][0]
            self.assertEqual(("2", "Green", "12", "248", "18000000", content),
                             (row[6], row[11], row[13], row[27], row[30], row[47]))
            self.assertEqual(("9000000", "9000000", "100000", "100000"), tuple(row[57:61]))
            self.assertEqual(("", "", "(None)", "0", "false"),
                             (row[48], row[49], row[34], row[35], row[72]))
        speed = self.rows["1499896"][0]
        self.assertEqual(("100000", "100000", "", "", "(None)"),
                         (speed[51], speed[52], speed[53], speed[54], speed[61]))
        self.assertEqual(0, kit.metadata()["periodic_status"]["fixed_speed_skill_charging_strength"])

    def test_metadata_declares_native_counter_carry_and_per_battle_attack(self):
        info = kit.metadata()
        self.assertIn("fractional period carries", info["direct_attack"]["fever_counters"])
        self.assertIn("fractional period carries", info["periodic_status"]["timer"])
        self.assertTrue(info["combo"]["attack_persists_after_fever"])
        self.assertIsNone(info["combo"]["skill_gauge_trigger_limit"])
        self.assertEqual(["kyubi-fever-ratio-v1"], info["required_client_capabilities"])

    def test_wrong_native_shape_is_rejected_without_mutating_source(self):
        bad = {"1412011": [["0"] * 125]}
        original = copy.deepcopy(bad)
        with self.assertRaisesRegex(ValueError, "126"):
            kit.ability_rows(bad)
        self.assertEqual(original, bad)


if __name__ == "__main__":
    unittest.main()
