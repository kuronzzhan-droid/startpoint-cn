"""Negative controls for receiver, method and login-hook composition guards."""
from __future__ import annotations

import argparse
import copy
from pathlib import Path
import unittest

import prepare_profile_town as recipe

BASE = None
DONOR = None
TOWN_STAGE = None


class Guards(unittest.TestCase):
    def setUp(self):
        self.target = recipe.view(BASE)
        self.donor = recipe.view(DONOR)
        self.label = recipe.PROFILE_LABELS[0]
        self.ti, self.si = recipe._guard_native(self.target, self.donor, self.label)
        self.mid = BASE.bodies[self.ti][0]

    def mutate_method(self, callback):
        old = copy.deepcopy(BASE.methods[self.mid])
        try:
            callback(BASE.methods[self.mid])
            with self.assertRaisesRegex(AssertionError, 'signature'):
                recipe._guard_native(self.target, self.donor, self.label)
        finally:
            BASE.methods[self.mid] = old

    def test_flags_rejected(self):
        self.mutate_method(lambda row: row.__setitem__(3, row[3] ^ 2))

    def test_optional_default_rejected(self):
        def change(row):
            row[3] |= 8
            row[4] = [(0, 0x0c)]
        self.mutate_method(change)

    def test_parameter_names_rejected(self):
        def change(row):
            row[3] |= 0x80
            row[5] = [0]
        self.mutate_method(change)

    def test_existing_body_drift_rejected(self):
        old = BASE.bodies[self.ti][5]
        try:
            BASE.bodies[self.ti][5] = b'\xd0\x48'
            with self.assertRaisesRegex(AssertionError, 'nonstub'):
                recipe._guard_native(self.target, self.donor, self.label)
        finally:
            BASE.bodies[self.ti][5] = old

    def test_receiver_slot_drift_rejected(self):
        owner = self.label.split('/')[0]
        inst, = [x for x in BASE.instances if BASE.mn_name(x[0]) == owner]
        trait = next(t for t in inst[6] if t.data[0] == 'slot')
        old = trait.data[1]
        try:
            trait.data[1] = old+1
            with self.assertRaisesRegex(AssertionError, 'receiver layout'):
                recipe._guard_native(self.target, self.donor, self.label)
        finally:
            trait.data[1] = old

    def test_new_closure_rejected(self):
        source = DONOR.bodies[self.si]
        old = source[5]
        try:
            source[5] = recipe.p.asm.encode(recipe.p.asm.assemble([('newfunction', source[0]),('returnvalue',)]))[0]
            with self.assertRaisesRegex(AssertionError, 'lexical method'):
                recipe._guard_native(self.target, self.donor, self.label)
        finally:
            source[5] = old

    def test_final_response_is_exact_r11(self):
        row = recipe.response_capture_contract(TOWN_STAGE, DONOR)
        self.assertEqual(row['capture_order'], ['cn.town::TownThemeState','cn.content::ContentOperationsState'])

    def test_duplicate_capture_rejected(self):
        temporary = copy.deepcopy(TOWN_STAGE)
        with self.assertRaisesRegex(AssertionError, 'prior constructor'):
            recipe.insert_town_capture(temporary, DONOR)


def main():
    global BASE, DONOR, TOWN_STAGE
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('base','r11','town-stage','out'):
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args()
    BASE = recipe.p.abcfmt.ABC(args.base.read_bytes())
    DONOR, _, _ = recipe.load_r11(args.r11)
    TOWN_STAGE = recipe.p.abcfmt.ABC(args.town_stage.read_bytes())
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Guards))
    recipe.dump(args.out, dict(passed=result.wasSuccessful(), tests=result.testsRun,
                              failures=len(result.failures), errors=len(result.errors),
                              base_sha256=recipe.sha(args.base.read_bytes()),
                              town_stage_sha256=recipe.sha(args.town_stage.read_bytes())))
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == '__main__':
    main()
