"""Run the original calculator's PF block after actual conversion bytecode."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import Editor, SwfAbc, asm, bodies
import damage
from vm import run

BASE = Path('D:/WF/out/七角色双版本语音合并-20260917/device-base.swf')
ATTACKER = 'pinball.online.battle.impact.attack:Attacker::'
TARGET = 'pinball.online.battle.impact:ImpactTarget::'
FIELD = 'pinball.scene.battle.battle.zone.field:ModifierFieldManagerForImpactCalculator::'


@unittest.skipUnless(BASE.is_file(), 'local baseline fixture unavailable')
class PowerFlipCalculatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e = Editor(SwfAbc(BASE))
        cls.abc = cls.e.abc
        cls.convert = asm.assemble(damage.conversion_body(cls.e))
        code = asm.decode(cls.abc.bodies[bodies.resolve(cls.abc, 'NormalAttackCalculator/_calculate')][5])
        # Original bytecode, PF normal + level/independent + field multiplier.
        start, end = 1124, 1334
        assert code[start].name == 'getlocal' and code[start].args == [54]
        assert code[end].name == 'getlocal' and code[end].args == [61]
        cls.calc = deepcopy(code[start:end])
        for ins in cls.calc:
            if ins.target is not None:
                assert start <= ins.target <= end
                ins.target -= start
            if ins.name == 'lookupswitch':
                assert all(start <= x < end for x in [ins.default, *ins.cases])
                ins.default -= start
                ins.cases = [x-start for x in ins.cases]
        cls.calc += asm.assemble([('getlocal', 61), ('returnvalue',)])

    def calculate(self, *, converted=True, normal=0, level_add=0, level=0, separate=0, field=0):
        calls = []
        def getter(name, value):
            def call(*args):
                calls.append((name, args))
                return value * 100000
            return call
        attacker = {
            ATTACKER + 'getStatModifierPowerFlipDamage': getter('normal', normal),
            ATTACKER + 'getStatModifierPowerFlipLvDamageAdd': getter('level_add', level_add),
            ATTACKER + 'getStatModifierPowerFlipLvDamage': getter('level', level),
            ATTACKER + 'getStatModifierSeparatedTermPowerFlipDamage': getter('separate', separate),
            ATTACKER + 'getStatModifierBattleTriggerEnemySlayer': getter('slayer', 0),
            ATTACKER + 'notifiyAttackModifierBattleValue': lambda *args: None,
            ATTACKER + 'notifySpecialExtraRate': lambda *args: None,
        }
        attack = dict.fromkeys(damage.FLAGS, False)
        attack.update(buffTargetAs=133 if converted else 0, powerFlipChargeLv=0 if converted else 3,
                      createdByMainSkillAction=converted, createdByPowerFlipAction=not converted,
                      originMemberKind=0, attacker=attacker)
        if converted:
            run(self.convert, self.abc, [None, attack])
        args = [None]*63
        args[0] = {'modifierFieldManager': {FIELD+'getModifierSeparatedTerm2ndPowerFlipDamage': getter('field', field)}}
        args[1] = {TARGET+'getTargetEnemy': lambda: None}
        args[2], args[7], args[12], args[54] = attack, attacker, [], 1.0
        lex = {'pinball.common.math._Decimal::Decimal_Impl_': {
            'fromInt': lambda value: value*100000,
            'multiplyFloat': lambda value, rate: value*rate/100000},
            'pinball.common.data.character.condition::BattleConditionSlayerAttackKind': {'PowerFlip': 0}}
        value = run(self.calc, self.abc, args, lex)
        self.assertIn(('level', (3,)), calls)
        self.assertIn(('level_add', (3,)), calls)
        return value

    def test_each_pool_scales_additional_pf(self):
        for field, expected in [('normal', 3), ('level_add', 3), ('level', 3), ('separate', 3), ('field', 3)]:
            with self.subTest(pool=field):
                self.assertAlmostEqual(expected, self.calculate(**{field: 2}))

    def test_converted_and_native_pf3_use_identical_bonuses(self):
        values = dict(normal=2, level_add=.5, level=.4, separate=.55, field=.2)
        expected = 3.5*1.95*1.2
        self.assertAlmostEqual(expected, self.calculate(**values))
        self.assertAlmostEqual(expected, self.calculate(converted=False, **values))

    def test_zero_bonuses_preserve_the_base_multiplier(self):
        self.assertEqual(1, self.calculate())
