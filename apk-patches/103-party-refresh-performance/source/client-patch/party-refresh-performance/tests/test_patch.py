"""Fail-closed checks against the actual LAN method, without emitting test SWFs."""
import argparse
import copy
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch as mock_patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("party_perf_negative", HERE.parent/"patch_swf.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
SOURCE = None
WORK = None


class PatchChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = p.s.parts(SOURCE)
        cls.main = next(t[3] for t in cls.base[2] if t[0]==82 and t[2][4:-1]==b"boot_ffc6")

    def test_actual_target_supported_and_inverse_recovers_body(self):
        abc=copy.deepcopy(self.main)
        index, result=p.patch_body(abc)
        self.assertEqual(index,66996)
        self.assertEqual(result['inserted_instructions'],16)
        self.assertTrue(result['reversible_insertion'])
        self.assertEqual(result['check']['unreachable_instructions'],0)
        self.assertEqual(abc.bodies[index][:5],self.main.bodies[index][:5])

    def test_changed_target_refused(self):
        abc=copy.deepcopy(self.main)
        index,=p.view(abc).by_label[p.LABEL]
        abc.bodies[index][5]+=b'\x02'
        with self.assertRaisesRegex(AssertionError,'unsupported PartyTranslator'):
            p.patch_body(abc)

    def test_changed_consumer_refused_before_output_write(self):
        version,header,tags=copy.deepcopy(self.base)
        abc=next(t[3] for t in tags if t[0]==82 and t[2][4:-1]==b"boot_ffc6")
        index,=p.view(abc).by_label['pinball.scene.character.translator::PartyTranslator/createStatus|1']
        abc.bodies[index][5]+=b'\x02'
        target=WORK/'refused-consumer.swf'
        self.assertFalse(target.exists())
        with mock_patch.object(p.s,'parts',return_value=(version,header,tags)):
            with self.assertRaisesRegex(AssertionError,'reader/source changed'):
                p.patch(SOURCE,target)
        self.assertFalse(target.exists())

    def test_preexisting_unrelated_body_can_survive(self):
        abc=copy.deepcopy(self.main)
        v=p.view(abc)
        index,=v.by_label['pinball.scene.character.partyCarousel::PartyCarousel/update|1']
        abc.bodies[index][5]+=b'\x02'
        existing=copy.deepcopy(abc.bodies[index])
        p.patch_body(abc)
        self.assertEqual(p.s.m.freeze(abc.bodies[index]),p.s.m.freeze(existing))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('work',type=Path)
    args=parser.parse_args();SOURCE=args.source;WORK=args.work;WORK.mkdir(parents=True,exist_ok=True)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PatchChecks))
    raise SystemExit(0 if result.wasSuccessful() else 1)
