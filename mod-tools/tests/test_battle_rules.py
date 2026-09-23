import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_battle_rules as rules
import wf_client_legality as legality
import wf_describe
from test_client_legality import _base_row


class BattleRulesTest(unittest.TestCase):
    def test_fluffy_and_orthogonal_source_selections(self):
        self.assertEqual(12, rules.gauge_mask(['skill', 'ability']))
        self.assertEqual(1064, rules.gauge_mask(['ability', 'skill_triggered_ability'], origins=['weapon']))
        self.assertNotEqual(rules.gauge_mask(['skill'], owners=['other']),
                            rules.gauge_mask(['skill_triggered_ability'], owners=['self'], triggers=['other']))

    def test_invalid_or_impossible_masks_rejected(self):
        for code in (0, -1, True, 1.5, 128, 1024, 2|1024, 2|16384, 2**30):
            with self.subTest(code=code), self.assertRaises(ValueError):
                rules.validate_code(423, code)
        with self.assertRaises(ValueError):
            rules.gauge_mask(['typo'])

    def test_all_damage_pairs_and_segment_encoding(self):
        for source in rules.SOURCES:
            for target in rules.DESTINATIONS:
                rules.validate_code(424, rules.damage_rule(source, target))
        self.assertEqual(104, rules.damage_rule('skill', 'direct'))
        self.assertEqual(401, rules.damage_rule('direct', 'skill'))
        self.assertEqual(133, rules.segment_override('pf3'))
        for code in (0, 103, 331, 501):
            if code == 331:  # PF -> PF1 is legal.
                continue
            with self.assertRaises(ValueError):
                rules.validate_code(424, code)

    def test_supported_targets_and_no_mutation(self):
        donor = _base_row('ability', '1')
        old = copy.deepcopy(donor)
        for target in rules.TARGETS:
            row = rules.make_row(donor, 'battle_rule', 423, 12, target=target, groups='Green')
            self.assertEqual('Green', row[111])
            self.assertEqual([], legality.client_legality_problems('ability', row))
            self.assertEqual([rules.GAUGE_CAP], legality.required_client_capabilities('ability', row))
        self.assertEqual(old, donor)

    def test_parser_scope_is_ability_only_and_residue_is_ignored(self):
        for table in ('ability', 'leader_ability', 'ability_soul', 'equipment_enhancement_ability', 'ex_ability'):
            for kind, code, capability in ((423, 12, rules.GAUGE_CAP), (424, 104, rules.DAMAGE_CAP)):
                row = _base_row(table, '1')
                col = wf_describe.layout(table)['blocks']['during_content']
                row[col], row[col+9] = str(kind), str(code)
                errors = legality.client_legality_problems(table, row)
                if table == 'ability':
                    self.assertEqual([], errors)
                    self.assertEqual([capability], legality.required_client_capabilities(table, row))
                else:
                    self.assertTrue(any('未被当前补丁扩展' in x for x in errors), errors)
                    self.assertEqual([], legality.required_client_capabilities(table, row))
                row[wf_describe.layout(table)['blocks']['precondition1']-1] = '0'
                self.assertEqual([], legality.required_client_capabilities(table, row))

    def test_table_invalid_code_is_not_only_an_enum_check(self):
        for content, code in ((423, '0'), (423, '12.0'), (423, '-1'), (424, '103')):
            row = _base_row('ability', '1')
            row[109], row[118] = str(content), code
            self.assertTrue(any('战斗规则编码' in x for x in legality.client_legality_problems('ability', row)))


if __name__ == '__main__':
    unittest.main()
