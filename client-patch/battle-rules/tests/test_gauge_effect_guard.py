"""执行补丁实际指令：在目标特效创建前短路，不改触发计数及允许来源。"""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import Editor, SwfAbc, asm, MEMBER
import gauge
from gauge_effect_guard import guard, DECIMAL
from vm import run
from test_rules import BASE, entry


@unittest.skipUnless(BASE.is_file(), 'local baseline fixture unavailable')
class GaugeEffectsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e = Editor(SwfAbc(BASE))
        cls.abc = cls.e.abc
        cls.filter = asm.assemble(gauge.filter_body(cls.e))
        cls.allows = asm.assemble(gauge.allows_body(cls.e))
        # Native code would create the target visual and enqueue the gain here.
        cls.code = asm.assemble(guard(cls.e)+[('pushtrue',), ('returnvalue',)])

    def invoke(self, content=8, value=100000, multiplier=1, kind=24,
               category=1024, owner=1, trigger=1, mask=12):
        outer = object()
        holder = {gauge.CONTEXT: outer}
        lex = {MEMBER: holder, DECIMAL: {'toFloat': lambda n: n/100000}}
        address = dict(wfGainKind=kind, wfGainCategory=category,
                       wfGainOwner=owner, wfGainTrigger=trigger)
        member = dict(originMemberIndex=0, abilityTotalizer={'wfBlocksGauge':
                      lambda event: run(self.filter, self.abc, [{'wfGaugeRules': [entry(mask)]}, event])})
        member['wfAllowsGauge'] = lambda k: run(self.allows, self.abc, [member, k], lex)
        result = run(self.code, self.abc, [member, None, address,
                     dict(index=content, params=[value]), True, False, False, multiplier], lex)
        self.assertIs(holder[gauge.CONTEXT], outer)
        return result

    def test_continuous_blocked_requests_never_reach_effect_or_reserve(self):
        results = [self.invoke(content=8+i%2) for i in range(3000)]
        self.assertEqual(0, sum(bool(x) for x in results))
        self.assertNotIn('newobject', [x.name for x in self.code])

    def test_opening_allowed_and_rule_relations_still_precise(self):
        self.assertTrue(self.invoke(kind=1))
        self.assertIsNone(self.invoke(kind=40, mask=32|131072))
        self.assertTrue(self.invoke(kind=40, trigger=0, mask=32|131072))
        self.assertIsNone(self.invoke(mask=8|1024|32768))
        self.assertTrue(self.invoke(owner=0, mask=8|1024|32768))
        self.assertTrue(self.invoke(category=256, mask=8|1024))

    def test_zero_debits_non_gauge_and_fixed_rounding_keep_native_path(self):
        for kwargs in ({'value': 0}, {'value': -10000}, {'multiplier': 0},
                       {'multiplier': -1}, {'content': 7}, {'content': 10},
                       {'content': 9, 'value': .5},
                       {'content': 9, 'value': 2**30, 'multiplier': 2}):
            with self.subTest(kwargs=kwargs):
                self.assertTrue(self.invoke(**kwargs))
        self.assertIsNone(self.invoke(value=-100000, multiplier=-1))

    def test_movement_and_unmatched_sources_never_evaluate_active_checker(self):
        calls = []
        rule = dict(value=12, getActiveCount=lambda _: calls.append(1) or 1)
        for kind in [1, 2]*1500:
            self.assertFalse(run(self.filter, self.abc, [{'wfGaugeRules': [rule]}, kind]))
        self.assertEqual([], calls)
        self.assertTrue(run(self.filter, self.abc, [{'wfGaugeRules': [rule]}, 24]))
        self.assertEqual([1], calls)


if __name__ == '__main__':
    unittest.main()
