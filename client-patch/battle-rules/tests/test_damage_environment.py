"""执行原版 Environment getter：从嵌套 DSL 到攻击分类的回归。"""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import Editor, SwfAbc, asm, bodies
import damage
from vm import run

BASE = Path('D:/WF/out/七角色双版本语音合并-20260917/device-base.swf')


@unittest.skipUnless(BASE.is_file(), 'local baseline fixture unavailable')
class DamageEnvironmentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e = Editor(SwfAbc(BASE))
        cls.abc = cls.e.abc
        cls.native = asm.decode(cls.abc.bodies[bodies.resolve(
            cls.abc, 'Environment/getBuffTargetAs')][5])
        damage.install(cls.e)
        cls.e.apply()
        cls.getter = asm.decode(cls.abc.bodies[bodies.resolve(
            cls.abc, 'Environment/getBuffTargetAs')][5])
        cls.convert = asm.assemble(damage.conversion_body(cls.e))

    def environment(self, value, outer=None, getter=None):
        env = {'buffTargetAs': value, 'outerEnvironment': outer}
        env['getBuffTargetAs'] = lambda: run(
            self.getter if getter is None else getter, self.abc, [env])
        return env

    def test_native_getter_drops_explicit_pf3_marker(self):
        self.assertIsNone(self.environment(133, getter=self.native)['getBuffTargetAs']())

    def test_all_markers_survive_three_nested_native_environments(self):
        for kind in damage.KINDS:
            with self.subTest(kind=kind):
                env = self.environment(100+kind)
                for _ in range(3):
                    env = self.environment(0, env)
                self.assertEqual(100+kind, env['getBuffTargetAs']())

    def test_native_overrides_and_unknown_values_keep_original_behavior(self):
        outer = self.environment(133)
        for value in (1, 2, 3, 4):
            self.assertEqual(value, self.environment(value, outer)['getBuffTargetAs']())
        for value in (100, 103, 134, 999):
            self.assertIsNone(self.environment(value, outer)['getBuffTargetAs']())
        self.assertEqual(0, self.environment(0)['getBuffTargetAs']())

    def test_ability_skill_inherits_pf3_then_clears_skill_category(self):
        env = self.environment(0, self.environment(0, self.environment(133)))
        attack = dict.fromkeys(damage.FLAGS, False)
        attack.update(buffTargetAs=env['getBuffTargetAs'](), powerFlipChargeLv=0,
                      createdByMainSkillAction=True, createdBySkillInvoker=True,
                      originMemberKind=0)
        run(self.convert, self.abc, [None, attack])
        self.assertTrue(attack['createdByPowerFlipAction'])
        self.assertEqual(3, attack['powerFlipChargeLv'])
        self.assertEqual(0, attack['buffTargetAs'])
        self.assertEqual({'createdByPowerFlipAction'}, {x for x in damage.FLAGS if attack[x]})


if __name__ == '__main__':
    unittest.main()
