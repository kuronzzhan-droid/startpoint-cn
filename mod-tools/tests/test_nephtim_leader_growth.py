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
        self.assertEqual(["100000", "100000"], duration[49:51])
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

    def test_each_removed_multiball_charges_only_dark_party_without_fever_or_cooldown(self):
        row, = [r for r in self.leader if r[25] == "194"]
        self.assertEqual(["2", "", "", "600000", "600000", "Black", ""], row[4:11])
        self.assertEqual(("0", "0"), (row[11], row[18]))
        self.assertEqual(["194", "", "", "100000", "100000"], row[25:30])
        self.assertEqual(["(None)", "0"], row[32:34])
        self.assertEqual(["211", "5", "Black", "", "5000", "5000"], row[45:51])
        self.assertEqual([], legality.client_legality_problems("leader_ability", row))
        self.assertEqual([], legality.required_client_capabilities("leader_ability", row))
        self.assertIn("每有1个协力球消失时，暗属性角色技能槽+5%", text.panel_descriptions()["leader"])

    def test_native_multiball_removal_distinguishes_temporary_inactive_transition(self):
        native = Path("D:/WF/outputs/re-workspace/decompile/scripts/pinball")
        if not native.is_dir():
            self.skipTest("native decompile unavailable")
        parser = (native/"master/generated/LeaderAbilityValues.as").read_text()
        self.assertIn('if(_loc2_ == "194")', parser)
        self.assertIn('InstantAbilityTriggerMasterValue.MultiballRemove', parser)
        manager = (native/"scene/battle/battle/squad/SquadManagerImpl.as").read_text()
        disposed = manager[manager.index("public function disposeActiveSquad("):]
        self.assertIn("activeSquadManager.remove(param1,true);", disposed[:1500])
        self.assertIn("activeSquadManager.remove(param1,false);\n         inactiveSquadManager.add", manager)
        active = (native/"scene/battle/battle/squad/ActiveSquadManager.as").read_text()
        removed = active[active.index("public function remove(param1:SquadImpl"):]
        self.assertIn("if(param2 && param1.kind.index == 1 && battle.state.index != 5)", removed[:1000])
        self.assertIn("battleAbilityTrigger.multiballCountUp(1,_loc4_,1,true);", removed[:1000])

    def test_panels_describe_the_new_location_and_hide_active_enhancement(self):
        panels = text.panel_descriptions()
        for value in ("技能强化", "星夜茶会", "攻击力"):
            self.assertNotIn(value, panels["active"])
        # 文案规则2 改写后，技能强化条目的句式是「强化『技能名』…」，不再是「强化技能，」。
        # 作者 2026-09-27（方案B）：强化条目随 I536 移入队长；召唤/清理（星夜茶会）仍在能力1。
        self.assertIn("强化『", panels["leader"])
        self.assertNotIn("强化『", panels["a1"])
        self.assertIn("星夜茶会", panels["a1"])
        self.assertIn("35", panels["leader"])
        self.assertIn("Fever 槽上升量+20%", panels["leader"])
        self.assertIn("暗属性共鸣时，Fever 时间+100%", panels["leader"])
        self.assertNotIn("Fever 槽上升量", panels["a3"])
        self.assertNotIn("Fever 时间", panels["a3"])
        self.assertTrue(all(line.startswith(text.MAIN_ICON) for line in panels["a3"].splitlines()))


if __name__ == "__main__":
    unittest.main()
