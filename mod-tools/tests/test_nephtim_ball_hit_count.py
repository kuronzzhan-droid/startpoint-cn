"""Native count changes and ordinary split-buff damage stay independent."""
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).parents[1]))
import wf_nephtim_ball_hit_count as H
from wf_nephtim_fever import validate_program
from test_nephtim_fever_skill import nodes
import wf_client_legality as L


class BallHitCountTest(unittest.TestCase):
    def test_single_self_record_dynamic_count_and_expiring_skill_multiplier(self):
        tree = H.action_tree()
        validate_program(tree)
        self.assertFalse(L.action_dsl_lookup_scope_problems(tree))
        self.assertFalse(nodes(tree, 'Event'))
        count = nodes(tree, 'MultiballNumberVariable')[0]
        self.assertIsNone(count[3])  # count every surviving multiball id
        branch = nodes(tree, 'ConditionalsConditionExist')[0]
        self.assertEqual(branch[1:3], [-17, ['DCAdditionalDirectAttack']])
        for ordinary_split in (False, True):
            condition = nodes(branch[3 if ordinary_split else 4], 'CreateCondition')[0]
            self.assertEqual(condition[1], -17)
            self.assertTrue(condition[9])  # invisible, excluded by the visible buff query
            self.assertEqual(condition[7], H.STRING_ID)
            content = condition[2][0]
            for n in (0, 1, 3, 9, 3, 1, 0):
                times = sum(v['min'] * (n if v.get('mul') else 1) for v in content[2])
                total = 1 + content[3][0]['min']
                self.assertEqual(times, n + (2 if ordinary_split else 1))
                self.assertEqual(total, 2 if ordinary_split else 1)
            self.assertEqual(content[1][0]['min'], 2)


if __name__ == '__main__':
    unittest.main()
