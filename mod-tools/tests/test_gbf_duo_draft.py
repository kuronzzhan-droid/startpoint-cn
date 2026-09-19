"""Offline contracts for imported GBF drafts; these are not gameplay tests."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_gbf_duo_dsl as D
import wf_gbf_duo_rows as R
from wf_gbf_duo_kit import BLOCKERS, check_draft
from wf_gbf_soriz import transfer
import wf_seasonal7_common as C


class DraftTests(unittest.TestCase):
    def test_opening_keeps_hurt_before_barrier_and_guts(self):
        tree = D.ghandagoza_opening()
        find = C.commands(tree, 'FindAllSubjects')[0]
        nodes = find[-1][1]
        self.assertEqual(nodes[0][1], ['CreateRatioAttack', 0, 1, D.v(1)])
        self.assertEqual(nodes[1][1][0:3], ['Wait', 1, '*'])
        self.assertEqual(C.commands(nodes[1], 'CreateBarrier')[0][2], D.v(1))
        self.assertIn(['ACGuts', D.v(1)], list(C.walk(nodes[1])))
        self.assertEqual(check_draft([], {}, {'opening': tree}), [])

    def test_empty_branch_and_arity_fail_before_export(self):
        invalid = D.tree(D.cmd('CreateBarrier', 0, D.v(.5)))
        self.assertTrue(any('arity' in x for x in check_draft([], {}, {'bad': invalid})))

    def test_missing_subject_fails_before_export(self):
        invalid = D.tree(D.cmd('CreateBarrier', 777, D.v(.5), ['GenericBarrierHitEffect']))
        self.assertTrue(check_draft([], {}, {'bad': invalid}))

    def test_heat_transfer_consumes_only_after_snapshot(self):
        tree = D.tree(transfer(12998604, 12998605, clear_source=True))
        self.assertEqual(len(C.commands(tree, 'ConditionalsConditionAccumulationNumber')), 10)
        deletes = C.commands(tree, 'DeleteCondition')
        self.assertEqual(deletes[0][2], ['DCUnique', 12998605])
        self.assertEqual(deletes[-1][2], ['DCUnique', 12998604])
        self.assertEqual(check_draft([], {}, {'transfer': tree}), [])

    def test_hp_percent_and_party_threshold_units(self):
        own = R.row(129987, 1, 'AttackPoint', 2, during=True,
                    trigger='HpDecrease', threshold=.01, start=100000)
        party = R.row(129987, 3, 'AttackPoint', 3, during=True,
                      trigger='SumOfPartyHpLow', threshold=.99, limit=1)
        self.assertEqual(own[100:103], ['1000', '1000', '(None)'])
        self.assertEqual(own[105:107], ['100000', '100000'])
        self.assertEqual(party[100:103], ['99000', '99000', '1'])
        self.assertEqual(check_draft([], {1:[own], 3:[party]}, {}), [])

    def test_draft_does_not_call_structural_checks_completion(self):
        for code in ('ghandagoza', 'soriz'):
            self.assertGreater(len(BLOCKERS[code]), 0)
        self.assertTrue(any('150%' in item for item in BLOCKERS['ghandagoza']))
        self.assertTrue(any('尚未接入' in item for item in BLOCKERS['soriz']))


if __name__ == '__main__':
    unittest.main()
