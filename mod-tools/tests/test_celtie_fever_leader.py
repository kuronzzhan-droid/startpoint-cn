"""队长库存消费、描述依赖与官方特殊PF保真回归。"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
from test_bianca_dragon_abilities import official_sources
import wf_celtie_fever_leader as leader
import wf_client_legality as legality

AS3 = Path("D:/WF/outputs/re-workspace/decompile/scripts/pinball")


def commands(node):
    if isinstance(node, list):
        if len(node) == 2 and node[0] == "Command":
            yield node[1]
        for child in node:
            yield from commands(child)


class CeltieFeverLeaderTest(unittest.TestCase):
    def setUp(self):
        self.abilities, source = official_sources()
        native = deepcopy(source["151001"][0])
        native[0] = "wind_spgirl_4anv"
        native[4:11] = ["2", "", "", "600000", "600000", "Green", ""]
        native[45] = "722"
        native[46:80] = [""] * 34
        native[80:83] = ["override_wind_spgirl_4anv", "1,2,3", "override_string_wind_spgirl_4anv"]
        self.sources = {"141201": [native]}
        self.rows = leader.leader_rows(self.abilities, self.sources)

    def test_native_legality_and_donors_are_preserved(self):
        before = deepcopy((self.abilities, self.sources))
        leader.leader_rows(self.abilities, self.sources)
        self.assertEqual(before, (self.abilities, self.sources))
        for row in self.rows:
            self.assertEqual(124, len(row))
            self.assertEqual([], legality.client_legality_problems("leader_ability", row))
            self.assertEqual([], legality.declared_block_field_problems("leader_ability", row))
            self.assertEqual([], legality.ability_element_column_problems("leader_ability", row, 3))

    def test_wind_base_stats_are_unconditional_and_special_rows_use_generic_resonance(self):
        attack, damage, special, hit, acquire, consume = self.rows
        self.assertEqual(("32", "200000", "5", "Green", "0"),
                         (attack[45], attack[49], attack[46], attack[47], attack[4]))
        self.assertEqual(("388", "400000", "5", "Green", "0"),
                         (damage[45], damage[49], damage[46], damage[47], damage[4]))
        for row in (special, hit, acquire, consume):
            self.assertEqual(["208", "", "", "600000", "600000", "", ""], row[4:11])
        self.assertEqual("0", special[11])
        self.assertEqual(["12"] * 3, [r[11] for r in (hit, acquire, consume)])

    def test_all_enemy_ability_damage_follows_powerflip_execution_not_hits_or_normal_flips(self):
        row = self.rows[3]
        self.assertEqual(("2", "254", "0", "1000000", "(None)"),
                         (row[25], row[45], row[46], row[49], row[67]))

    def test_stock_consumption_is_one_layer_and_fixed_six_combo(self):
        acquire, consume = self.rows[4:]
        self.assertEqual(("23", "7", "Green", "629", leader.STOCK_STRING_ID,
                          leader.STOCK_ACTION_PATH),
                         (acquire[25], acquire[26], acquire[27], acquire[45], acquire[68], acquire[69]))
        self.assertEqual(("26", "2", "0", "100000", "100000", str(leader.STOCK_UID),
                          "226", "600000", "(None)"),
                         (consume[25], consume[37], consume[38], consume[40], consume[41],
                          consume[43], consume[45], consume[49], consume[32]))
        stock = leader.unique_rows()[str(leader.STOCK_UID)][0]
        self.assertEqual(["(None)"] * 4, stock[5:9])
        self.assertEqual(["false", "true", "0", "0", "false"], stock[9:14])
        self.assertNotIn("184", [r[25] for r in self.rows], "Fever end must retain pending flips")

    def test_stock_micro_action_grants_two_and_cannot_attack_or_trigger_a_skill_event(self):
        tree = leader.stock_action_tree()
        self.assertEqual(tree, leader._decoded(leader._encoded(tree)))
        action, = list(commands(tree))
        self.assertEqual("CreateCondition", action[0])
        self.assertEqual(-17, action[1])
        self.assertEqual([["ACUnique", leader.STOCK_UID, [{"min": 1, "max": 1}]]], action[2])
        self.assertEqual([{"min": 2, "max": 2}], action[11])
        self.assertTrue(action[12])
        self.assertNotIn(leader.STOCK_ACTION_PATH, leader.PF_PROGRAM_PATHS)

    def test_every_custom_description_reference_has_nonempty_flat_text(self):
        flat = leader.flat_string_rows()
        references = [r[68] for r in self.rows if r[45] == "629"]
        references += [r[82] for r in self.rows if r[45] == "722"]
        for key in references:
            self.assertIn(key, flat)
            self.assertTrue(flat[key][0][0].strip())
        self.assertNotIn("2147483647", str(flat))
        self.assertEqual([list(leader.PF_PROGRAM_PATHS)], leader.power_flip_rows()[leader.PF_ID])
        self.assertEqual([], leader.metadata()["required_client_capabilities"])
        self.assertFalse(leader.metadata()["requires_new_apk"])
        self.assertIn("伤害量以能力伤害加成判定", flat[leader.PF_STRING_ID][0][0])
        self.assertNotRegex(flat[leader.PF_STRING_ID][0][0], r"[0-9%％]")

    @unittest.skipUnless(AS3.is_dir(), "native decompile fixture unavailable")
    def test_native_consume_precontent_and_main_member_flip_contract(self):
        source = (AS3 / "common/data/ability/instant/InstantAbilitySource.as").read_text()
        self.assertIn("param2.resolveInt(_loc6_.threshold),1,1)", source)
        slot = (AS3 / "scene/battle/battle/condition/ConditionSlot.as").read_text()
        consume = slot[slot.index("public function consumeUniqueCondition"):]
        consume = consume[:consume.index("public function consumeGuts")]
        self.assertIn("_loc10_.consumeNumAccumulation(_loc16_ * param2);", consume)
        self.assertIn("_loc6_ -= _loc16_;", consume)
        trigger = (AS3 / "common/data/ability/instant/InstantAbilityTriggerMasterValueTools.as").read_text()
        start = trigger.index("case 26:")
        self.assertIn("InstantAbilityTriggerPullerKind.Myself,16", trigger[start:start + 450])

    def test_real_official_pf_assets_keep_geometry_timing_and_all_private_references(self):
        import wf_campus_bianca as campus
        if not (campus.ROOT / "mod-tools/profiles.json").is_file():
            self.skipTest("official CDN fixture unavailable")
        builder = campus.Builder()
        assets = leader.action_assets(builder.official)
        self.assertEqual(37, len(assets))
        for original, target in zip(leader.PF_SOURCE_PATHS, leader.PF_PROGRAM_PATHS):
            native = leader._decoded(builder.official(original + ".action.dsl.amf3.deflate"))
            actual = leader._decoded(assets["common", target + ".action.dsl.amf3.deflate"])
            normalized = _restore_effect_names(actual)
            self.assertEqual(2, normalized[10])
            normalized[10] = native[10]
            expected_areas = [c for c in commands(native) if c[0] == "CreateHitArea"]
            actual_areas = [c for c in commands(normalized) if c[0] == "CreateHitArea"]
            self.assertEqual(len(expected_areas), len(actual_areas))
            for before, after in zip(expected_areas, actual_areas):
                if any(c[0] == "CreateNormalAttack" for c in commands(before[23])):
                    self.assertEqual(2, after[24])
                    after[24] = before[24]
            self.assertEqual(native, normalized, "only native bonus selectors may differ")
            self.assertEqual([], legality.action_dsl_subject_binding_problems(actual))
            self.assertEqual([], legality.action_dsl_hit_area_target_problems(actual))
        for (tier, path), raw in assets.items():
            self.assertNotIn(leader.PF_SOURCE_EFFECT, path)
            if path.endswith(".amf3.deflate"):
                self.assertNotIn(leader.PF_SOURCE_EFFECT, str(leader._decoded(raw)))
        old_png = "battle/effect/powerflip/wind_spgirl_4anv/wind_spgirl_4anv.png"
        self.assertEqual(builder.official(old_png), assets["common", leader._remap(old_png)])


def _restore_effect_names(value):
    if isinstance(value, str):
        return value.replace(leader.PF_EFFECT, leader.PF_SOURCE_EFFECT)
    if isinstance(value, list):
        return [_restore_effect_names(item) for item in value]
    if isinstance(value, dict):
        return {key: _restore_effect_names(item) for key, item in value.items()}
    return value


if __name__ == "__main__":
    unittest.main()
