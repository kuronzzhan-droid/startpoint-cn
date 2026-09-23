"""直接执行注入片段，验证来源、队友触发、延迟快照和原生增减槽边界。"""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import Editor, SwfAbc, asm, bodies, MEMBER
import gauge, provenance
from vm import run
from test_rules import BASE


@unittest.skipUnless(BASE.is_file(), 'local baseline fixture unavailable')
class ProvenanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e = Editor(SwfAbc(BASE))
        provenance.init_address(cls.e)
        provenance.stamp_source(cls.e)
        cls.action = asm.assemble(provenance.action_context_body(cls.e))

    def fragment(self, method, *args):
        ins = self.e.insertions[method][0][1]
        # END is the continuation into the original method; supply that continuation.
        ins = ins + asm.assemble([('returnvoid',)])
        run(ins, self.e.abc, args)

    def test_origin_category_main_unison_and_row_number(self):
        for number, category in ((1, 256), (6, 256), (21, 512), (31, 2048), (41, 1024), (51, 4096)):
            for unison in (0, 1000):
                for row in (0, 1, 99):
                    with self.subTest(number=number, unison=unison, row=row):
                        address = {'wfGainKind': 40}
                        owner = {'_type': MEMBER, 'originMemberIndex': 0}
                        trigger = {'_type': MEMBER, 'originMemberIndex': 2}
                        self.fragment('AbilitySlotImpl/applyInstant', {'member': owner}, None, False,
                                      address, (number+unison)*1000+row, None, trigger)
                        self.assertEqual({'wfGainKind': 40, 'wfGainCategory': category,
                                          'wfGainOwner': 0, 'wfGainTrigger': 2}, address)

    def test_unknown_trigger_does_not_reuse_previous_actor(self):
        address = dict(zip(provenance.FIELDS, (24, 1024, 2, 2)))
        self.fragment('AbilitySlotImpl/applyInstant', {'member': None}, None, False,
                      address, 1000, None, None)
        self.assertEqual(-1, address['wfGainOwner'])
        self.assertEqual(-1, address['wfGainTrigger'])

    def test_initial_and_multiplied_addresses_preserve_kind(self):
        initial = {}
        self.fragment('InstantAbilityAddress/<ctor>', initial, 'Initial', 0, [])
        self.assertEqual(1, initial['wfGainKind'])
        initial['wfGainOwner'] = 2
        multiplied = {}
        self.fragment('InstantAbilityAddress/<ctor>', multiplied, 'MultiplyTrigger', 3, [initial])
        self.assertEqual(initial, multiplied)

    def test_combo_skill_and_unrelated_trigger_classification(self):
        for trigger, kind in (({'index': 4}, 24), ({'index': 6}, 24),
                              ({'index': 2, 'params': [None, 4]}, 40),
                              ({'index': 2, 'params': [None, 107]}, 8), ({'index': 0}, 8)):
            address = {'wfGainKind': 8}
            self.fragment('InstantAbility/<ctor>', {}, address, None, {'trigger': trigger})
            self.assertEqual(kind, address['wfGainKind'])

    def test_action_snapshot_priority_and_unknown_action_not_skill(self):
        executor = {'_type': MEMBER, 'originMemberIndex': 1}
        for action, gain in ((1, 4), (7, 4), (4, 8), (5, 64), (6, 64), (0, 64)):
            context = {'kind': {'index': action}}
            evaluator = {'get_context': lambda: context, 'get_executor': lambda: executor}
            result = run(self.action, self.e.abc, [None, evaluator])
            self.assertEqual(gain, result['wfGainKind'])
            self.assertEqual(1, result['wfGainOwner'])
            snapshot = dict(zip(provenance.FIELDS, (24, 1024, 0, 2)))
            context['wfGainSnapshot'] = snapshot
            self.assertIs(snapshot, run(self.action, self.e.abc, [None, evaluator]))

    def test_guard_keeps_debits_and_zero_and_only_rejects_positive_gain(self):
        for value in (-50, 0, 50):
            seen = []
            member = {'wfAllowsGauge': lambda kind: seen.append(kind) or False}
            block = asm.assemble(gauge.guard(self.e, 8)) + asm.assemble([('pushtrue',), ('returnvalue',)])
            result = run(block, self.e.abc, [member, value])
            self.assertEqual(True if value <= 0 else None, result)
            self.assertEqual([] if value <= 0 else [8], seen)

    def test_opening_overflow_carries_opening_context_and_restores_outer_context(self):
        original = {'sentinel': True}
        static = {gauge.CONTEXT: original}
        member = {'originMemberIndex': 0}
        save = provenance.push_context(self.e, 2, provenance.opening_context(self.e))
        capture = [('getlex', self.e.q(MEMBER)), ('getproperty', self.e.newq(gauge.CONTEXT)),
                   ('setlocal_3',)]
        restore = provenance.pop_context(self.e, 2)
        block = asm.assemble(save+capture+restore+[('getlocal_3',), ('returnvalue',)])
        context = run(block, self.e.abc, [member], {MEMBER: static})
        self.assertEqual(1, context['wfGainKind'])
        self.assertIs(original, static[gauge.CONTEXT])

    def test_original_opening_method_both_branches_keep_context_balanced(self):
        body = self.e.abc.bodies[bodies.resolve(self.e.abc, 'MemberImpl/applyInitialSkillPointRatio')]
        additions = [(2, asm.assemble(gauge.guard(self.e, 1)), asm.ENTER),
                     (21, asm.assemble(provenance.push_context(self.e, 2, provenance.opening_context(self.e))), asm.ENTER),
                     (22, asm.assemble(provenance.pop_context(self.e, 2)), asm.SKIP)]
        _code, _exceptions, ins, _recovery = asm.splice_many(body, additions)
        for ratio in (0.5, 1, 2):
            original = {'wfGainKind': 24}
            static = {gauge.CONTEXT: original}
            reservations, values = [], []
            member = {'originMemberIndex': 0, 'additionalSecondSkillGauge': 0,
                      'wfAllowsGauge': lambda kind: True,
                      'reserveSkillPoint': lambda amount: reservations.append((amount, static[gauge.CONTEXT].copy())),
                      'skillPoint': {'setRatio': lambda value: values.append(value)}}
            run(ins, self.e.abc, [member, ratio], {MEMBER: static,
                'pinball.common.math._Decimal::Decimal_Impl_': {'fromFloat': lambda x: x*100000}})
            self.assertEqual([ratio], values)
            self.assertIs(original, static[gauge.CONTEXT])
            if ratio <= 1:
                self.assertEqual([], reservations)
            else:
                self.assertEqual(1, reservations[0][1]['wfGainKind'])
                self.assertEqual(ratio-1, reservations[0][0])


if __name__ == '__main__':
    unittest.main()
