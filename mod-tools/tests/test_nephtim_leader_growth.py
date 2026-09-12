"""奈芙队长连击成长及能力3移交；主动说明不重复强化能力。"""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))

from test_bianca_dragon_abilities import official_sources
import wf_client_legality as legality
import wf_nephtim_fever_abilities as abilities
import wf_nephtim_fever_leader as leader
import wf_nephtim_fever_text as text


class NephtimLeaderGrowthTest(unittest.TestCase):
    def setUp(self):
        source, _ = official_sources()
        self.abilities = abilities.ability_rows(source)
        self.leader = leader.leader_rows(source)

    def test_growth_and_duration_are_native_leader_effects_with_no_fever_gate(self):
        rate, = [r for r in self.leader if r[3] == "0" and r[45] == "50"]
        duration, = [r for r in self.leader if r[3] == "0" and r[45] == "56"]
        self.assertEqual(["12", "", "", "3500000", "3500000"], rate[25:30])
        self.assertEqual(["(None)", "0"], rate[32:34])
        self.assertEqual(["5", "Black"], rate[46:48])
        self.assertEqual(["20000", "20000"], rate[49:51])
        self.assertEqual("0", duration[25])
        self.assertEqual(["10000", "10000"], duration[49:51])
        for row in (rate, duration):
            self.assertEqual(["2", "", "", "600000", "600000", "Black", ""], row[4:11])
            self.assertEqual(("0", "0"), (row[11], row[18]))
            self.assertEqual([], legality.client_legality_problems("leader_ability", row))
            self.assertEqual([], legality.required_client_capabilities("leader_ability", row))

    def test_a3_keeps_the_direct_ratio_and_no_longer_grants_rate_or_duration(self):
        rows = self.abilities["1699893"]
        contents = [r[47] for r in rows if r[5] == "0"]
        self.assertNotIn("50", contents)
        self.assertNotIn("56", contents)
        self.assertEqual(1, contents.count("724"))
        self.assertEqual({"false"}, {r[1] for r in rows})

    def test_panels_describe_the_new_location_and_hide_active_enhancement(self):
        panels = text.panel_descriptions()
        for value in ("技能强化", "星夜茶会", "攻击力"):
            self.assertNotIn(value, panels["active"])
        self.assertIn("强化技能", panels["a1"])
        self.assertIn("星夜茶会", panels["a1"])
        self.assertIn("35", panels["leader"])
        self.assertIn("Fever 槽上升量+20%", panels["leader"])
        self.assertIn("暗属性共鸣时，Fever 时间+10%", panels["leader"])
        self.assertNotIn("Fever 槽上升量", panels["a3"])
        self.assertNotIn("Fever 时间", panels["a3"])
        self.assertTrue(all(line.startswith(text.MAIN_ICON) for line in panels["a3"].splitlines()))


if __name__ == "__main__":
    unittest.main()
