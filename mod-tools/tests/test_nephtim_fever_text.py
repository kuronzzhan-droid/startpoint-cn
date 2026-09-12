"""奈芙面板的实际能力条件、七组覆盖和平表编码合同。"""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import test_bianca_dragon_abilities as fixture
import wf_mod_tool as core
import wf_nephtim_fever_abilities as abilities
import wf_nephtim_fever_leader as leader
import wf_nephtim_fever_powerflip as powerflip
import wf_nephtim_fever_skill as skill
import wf_nephtim_fever_text as text


class NephtimFeverTextTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source, _ = fixture.official_sources()
        cls.abilities = abilities.ability_rows(source)
        cls.leader = leader.leader_rows(source)

    def panels(self, policy="dark_resonance"):
        return text.panel_descriptions(piercing_extension=policy)

    def test_active_and_eight_sections_have_only_player_facing_text(self):
        panels = self.panels()
        self.assertEqual({"active", "leader", "a1", "a2", "a3", "a4", "a5", "a6"}, set(panels))
        self.assertEqual(text.active_description(), panels["active"])
        self.assertNotRegex(panels["active"], r"[0-9%％]")
        for value in panels.values():
            self.assertTrue(value.strip())
            self.assertNotRegex(value, r"同条件|无上限|无次数上限|I629|I536|I722|DSL|APK|Unique|原生|实现|独立乘区")
        for phrase in ("参战者及协力球贯穿", "队伍内角色及协力球", "Fever 模式中", "技能强化后", "星夜茶会", "交替召唤光、暗属性协力球"):
            self.assertIn(phrase, panels["active"])

    def test_real_group_ids_create_seven_overrides_without_changing_combat_or_awake_rows(self):
        before = deepcopy((self.abilities, self.leader))
        rows = text.panel_rows(self.abilities, self.leader, piercing_extension="dark_resonance")
        self.assertEqual(before, (self.abilities, self.leader))
        self.assertEqual({"desc_override_ruin_girl_campus"} |
                         {f"desc_override_ruin_girl_campus_{i}" for i in range(1, 7)}, set(rows))
        panels = self.panels()
        self.assertEqual([[panels["leader"]]], rows["desc_override_" + self.leader[0][0]])
        self.assertEqual(["0", ""], self.leader[0][1:3])
        for number in range(1, 7):
            first = self.abilities[f"169989{number}"][0]
            self.assertEqual([[panels[f"a{number}"]]], rows["desc_override_" + first[0]])
            self.assertEqual(["0", ""], first[3:5])

    def test_missing_or_colliding_string_ids_are_rejected(self):
        rows = deepcopy(self.abilities)
        del rows["1699894"]
        with self.assertRaisesRegex(ValueError, "a4"):
            text.panel_rows(rows, self.leader, piercing_extension="dark_resonance")
        rows["1699894"] = deepcopy(rows["1699893"])
        with self.assertRaisesRegex(ValueError, "a4"):
            text.panel_rows(rows, self.leader, piercing_extension="dark_resonance")

    def test_native_keys_and_csv_roundtrip_preserve_single_cell_and_main_markup(self):
        native = text.native_flat_string_rows()
        originals = {**abilities.flat_string_rows(), **leader.flat_string_rows(), **powerflip.flat_string_rows()}
        self.assertTrue(set(native) <= set(originals))
        self.assertTrue(all("ruin_girl_campus" in key for key in native))
        rows = text.panel_rows(self.abilities, self.leader, piercing_extension="dark_resonance")
        rows.update(native)
        for key, group in rows.items():
            self.assertEqual((1, 1), (len(group), len(group[0])), key)
            self.assertNotIn("\\n", group[0][0])
            self.assertEqual(group, core.read_csv_lines(core.write_csv_lines(group)))

    def test_a1_is_maximum_gauge_and_summon_state_has_correct_gates_and_durations(self):
        rows = self.abilities["1699891"]
        self.assertEqual(("245", "50000"), (rows[0][47], rows[0][51]))
        panel = self.panels()["a1"]
        self.assertEqual("自身技能槽上限+50%。", panel.splitlines()[0])
        self.assertNotIn("战斗开始", panel)
        self.assertNotIn("技能槽+50%", panel)
        self.assertIn("暗属性共鸣时，强化技能", panel)
        self.assertIn("攻击力提升100%效果，持续20秒", panel)
        self.assertIn("暗属性共鸣时，Fever 模式中，发动技能时", panel)
        self.assertIn("每经过2秒交替召唤1个光、暗属性协力球，各持续20秒", panel)
        self.assertIn("Fever 结束或自身倒下时", panel)
        self.assertEqual("星夜茶会", skill.STATE_NAME)
        self.assertEqual(1200, skill.metadata()["each_ball_lifetime_frames"])
        self.assertEqual("true", skill.unique_rows()[str(skill.STATE_UID)][0][13])

    def test_all_a3_lines_have_native_main_badge_and_exact_conditional_numeric_effects(self):
        panels = self.panels()
        for number in range(1, 7):
            restricted = any(row[1] == "false" for row in self.abilities[f"169989{number}"])
            self.assertEqual(restricted, "<icon id='main'>" in panels[f"a{number}"])
        lines = panels["a3"].splitlines()
        self.assertTrue(all(line.startswith(text.MAIN_ICON + "暗属性共鸣时，") for line in lines))
        self.assertNotIn("Fever 模式中", lines[0])
        self.assertIn("Fever 槽上升量+500%", lines[0])
        self.assertNotIn("直接攻击", lines[0])
        self.assertEqual(text.MAIN_ICON + "暗属性共鸣时，Fever 时间+10%。", lines[1])
        self.assertIn("Fever 模式中，当前每有1连击", lines[2])
        self.assertIn("直接攻击造成的伤害+0.5%", lines[2])
        self.assertIn("Fever 模式中，处于贯穿效果的时间每累计2秒", lines[3])
        self.assertIn("攻击力+20%、直接攻击伤害+20%", lines[3])
        combo = self.abilities["1699893"][2]
        self.assertEqual(("2", "410", "500"), (combo[97], combo[109], combo[113]))

    def test_non_main_bonuses_keep_their_actual_targets_and_a5_has_no_resonance_gate(self):
        panels = self.panels()
        self.assertIn("暗属性共鸣时，全队贯穿效果时间+20%", panels["a2"])
        self.assertIn("暗属性角色直接攻击伤害+250%", panels["a2"])
        self.assertEqual("暗属性共鸣时，Fever 模式中，暗属性角色及协力球直接攻击造成的伤害+20%。", panels["a4"])
        self.assertEqual(["5", "8"], [row[110] for row in self.abilities["1699894"]])
        self.assertNotIn("共鸣", panels["a5"])
        self.assertEqual(["0", "0"], [row[6] for row in self.abilities["1699895"]])
        self.assertEqual(["非 Fever 模式中，每经过10秒，赋予全队贯穿效果，持续3秒。",
                          "Fever 模式中，每经过5秒，赋予全队贯穿效果，持续3秒。"], panels["a5"].splitlines())
        self.assertEqual("暗属性共鸣时，暗属性角色直接攻击伤害+100%。", panels["a6"])
        self.assertNotIn("Fever", panels["a6"])

    def test_leader_uses_only_the_confirmed_constant_dark_resonance_piercing(self):
        permanent = self.panels()["leader"].splitlines()
        self.assertEqual("暗属性共鸣时，全队贯穿效果时间+20%。", permanent[-1])
        self.assertNotIn("Fever", permanent[-1])
        self.assertTrue(all(line.startswith("暗属性共鸣时，") for line in permanent))
        self.assertNotIn("每直接攻击50次", "\n".join(permanent))
        self.assertIn("攻击力+200%、直接攻击伤害+400%", permanent[1])
        self.assertNotIn("Fever 模式中", permanent[1])
        self.assertIn("Fever 模式中，暗属性角色技能槽上限+10%", permanent[2])
        self.assertEqual(self.panels(), text.panel_descriptions())
        self.assertEqual(("dark_resonance",), text.PIERCING_POLICIES)
        for policy in ("self_source", "unbalanced_fever_edges"):
            with self.assertRaises(ValueError):
                self.panels(policy)

    def test_capability_and_return_values_are_isolated(self):
        meta = text.metadata()
        self.assertEqual(["panel-description-override-v2"], meta["required_client_capabilities"])
        self.assertEqual("dark_resonance", meta["leader_piercing_extension"])
        self.assertFalse(meta["combat_rows_modified"])
        copy = self.panels()
        copy["a1"] = "changed"
        self.assertNotEqual(copy, self.panels())


if __name__ == "__main__":
    unittest.main()
