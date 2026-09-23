import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import Editor, SwfAbc, asm, MEMBER, TOTALIZER
import content, damage, gauge, provenance
from vm import run

BASE = Path('D:/WF/out/七角色双版本语音合并-20260917/device-base.swf')


def entry(value, active=1):
    return {'value': value, 'getActiveCount': lambda _: active}


@unittest.skipUnless(BASE.is_file(), 'local baseline fixture unavailable')
class RulesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e = Editor(SwfAbc(BASE))
        cls.abc = cls.e.abc
        cls.convert = asm.assemble(damage.conversion_body(cls.e))
        cls.resolve = asm.assemble(damage.resolver_body(cls.e))
        cls.filter = asm.assemble(gauge.filter_body(cls.e))
        cls.allows = asm.assemble(gauge.allows_body(cls.e))
        cls.address = asm.assemble(provenance.from_address(cls.e))

    def test_all_six_damage_destinations_overwrite_every_source_flag(self):
        for destination in damage.KINDS:
            for origin in (None, 0, 1):
                with self.subTest(destination=destination, origin=origin):
                    attack = {flag: True for flag in damage.FLAGS}
                    attack.update(buffTargetAs=100+destination, powerFlipChargeLv=3,
                                  originMemberKind=origin, element=6, damage=100,
                                  multiplierOfAttackPoint=800000, incrementCombo=True, sentinel=object())
                    before = attack.copy()
                    result = run(self.convert, self.abc, [None, attack])
                    self.assertIs(result, attack)
                    self.assertEqual(0, attack['buffTargetAs'])
                    self.assertEqual(max(0, destination-30), attack['powerFlipChargeLv'])
                    wanted = {'createdByDirectAttack'} if destination == 4 else (
                        {'createdByPowerFlipAction'} if destination >= 31 else (
                        {'createdByAbility', 'createdByUnisonAbility'} if destination == 2 and origin == 1 else (
                        {'createdByAbility'} if destination == 2 else (
                        {'createdByUnisonSkillAction'} if origin == 1 else {'createdByMainSkillAction'}))))
                    self.assertEqual(wanted, {f for f in damage.FLAGS if attack[f]})
                    for k in ('element', 'damage', 'multiplierOfAttackPoint', 'incrementCombo', 'sentinel'):
                        self.assertEqual(before[k], attack[k])

    def test_character_mapping_is_single_pass_and_segment_override_wins(self):
        totalizer = {'wfDamageRules': [entry(104), entry(401)]}
        calls = []
        def resolve(source):
            calls.append(source)
            return run(self.resolve, self.abc, [totalizer, source])
        attacker = {'_type': MEMBER, 'abilityTotalizer': {'wfResolveDamageType': resolve}}
        attack = dict.fromkeys(damage.FLAGS, False)
        attack.update(attacker=attacker, buffTargetAs=0, originMemberKind=0,
                      createdByMainSkillAction=True, powerFlipChargeLv=0)
        run(self.convert, self.abc, [None, attack])
        self.assertEqual([1], calls)
        self.assertTrue(attack['createdByDirectAttack'])
        attack['buffTargetAs'] = 133
        run(self.convert, self.abc, [None, attack])
        self.assertEqual([1], calls)
        self.assertTrue(attack['createdByPowerFlipAction'])
        self.assertEqual(3, attack['powerFlipChargeLv'])

    def test_native_and_unknown_values_and_nonmember_attackers_are_untouched(self):
        for bta in (0, 1, 2, 3, 4, 100, 103, 134, 999):
            attack = {'attacker': None, 'buffTargetAs': bta}
            old = attack.copy()
            run(self.convert, self.abc, [None, attack])
            self.assertEqual(old, attack)

    def test_damage_rules_conditions_and_wildcard_and_order(self):
        rules = {'wfDamageRules': [entry(101, 0), entry(233), entry(104), entry(131)]}
        self.assertEqual(4, run(self.resolve, self.abc, [rules, 1]))
        self.assertEqual(33, run(self.resolve, self.abc, [rules, 2]))
        self.assertEqual(0, run(self.resolve, self.abc, [rules, 3]))
        self.assertEqual(31, run(self.resolve, self.abc, [{'wfDamageRules': [entry(31)]}, 4]))

    def test_fluffy_blocks_every_battle_skill_ability_but_keeps_opening_and_movement(self):
        rules = {'wfGaugeRules': [entry(12)]}
        for kind in (1, 2, 4, 8, 24, 40):
            for category in (0, 256, 512, 1024, 2048, 4096):
                for relation in (0, 16384, 32768):
                    with self.subTest(kind=kind, category=category, relation=relation):
                        self.assertEqual(kind not in (1, 2), run(self.filter, self.abc, [rules, kind|category|relation]))

    def test_filter_group_intersection_and_unknown_never_assumes_self(self):
        cases = [(8|1024, 8|1024, True), (8|1024, 8|256, False),
                 (16, 8|16|1024, True), (16, 8|1024, False),
                 (4|32768, 4|256|32768, True), (4|32768, 4|256|16384, False),
                 (32|131072, 8|32|256|16384|131072, True),
                 (8|16384, 8|256, False), (0, 8, False)]
        for mask, event, expected in cases:
            self.assertEqual(expected, run(self.filter, self.abc, [{'wfGaugeRules': [entry(mask)]}, event]))
        self.assertFalse(run(self.filter, self.abc, [{'wfGaugeRules': [entry(12, 0)]}, 4]))

    def test_received_skill_and_own_ability_triggered_by_teammate_remain_distinct(self):
        events = []
        member = {'originMemberIndex': 0, 'abilityTotalizer': {'wfBlocksGauge': lambda x: events.append(x) or False}}
        for context in ({'wfGainKind': 4, 'wfGainCategory': 256, 'wfGainOwner': 1, 'wfGainTrigger': 1},
                        {'wfGainKind': 40, 'wfGainCategory': 256, 'wfGainOwner': 0, 'wfGainTrigger': 1}):
            self.assertTrue(run(self.allows, self.abc, [member, 4], {MEMBER: {gauge.CONTEXT: context}}))
        self.assertEqual([4|256|32768|131072, 40|256|16384|131072], events)

    def test_snapshot_is_not_aliased_to_reused_ability_address(self):
        address = dict(zip(provenance.FIELDS, (24, 1024, 1, 2)))
        snapshot = run(self.address, self.abc, [None, address])
        address['wfGainTrigger'] = 0
        self.assertEqual(2, snapshot['wfGainTrigger'])

    def test_signed_minus_one_is_encoded_without_negative_pool_value(self):
        self.assertEqual(('pushbyte', 255), self.e.number(-1))
        self.assertGreaterEqual(min(self.e.pool.added_ints, default=0), 0)

    def test_empty_description_uses_real_string_constant_not_reserved_zero(self):
        op, index = self.e.string('')
        self.assertEqual('pushstring', op)
        self.assertGreater(index, 0)
        self.assertEqual(b'', self.abc.strings[index])

    def test_generated_methods_have_no_off_end_branch(self):
        for method in (self.convert, self.resolve, self.filter, self.allows, self.address):
            self.assertTrue(all(x.target is None or x.target < len(method) for x in method))

    def test_serialized_rule_loops_have_real_avm2_labels(self):
        for method in (self.filter, self.resolve):
            decoded = asm.decode(asm.encode(method)[0])
            backward = [(i, x) for i, x in enumerate(decoded)
                        if x.target is not None and x.target <= i]
            self.assertTrue(backward)
            for _, branch in backward:
                self.assertEqual(0x09, decoded[branch.target].op)

    def test_builder_rejects_symbolic_only_loop_before_serialization(self):
        # The v2 bug passes stack simulation and decompiles normally, but AIR
        # rejects it at first invocation even when no character has a rule.
        broken = [row for row in gauge.filter_body(self.e) if row != ('avm_label',)]
        with self.assertRaisesRegex(asm.AsmError, 'backward branch lacks AVM2 label'):
            self.e.add_method(TOTALIZER, 'wfInvalidLoopTest', 'Boolean', ['int'], broken, 7)


if __name__ == '__main__':
    unittest.main()
