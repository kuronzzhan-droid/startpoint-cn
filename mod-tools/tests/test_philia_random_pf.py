"""覆盖每一条原生随机分支，不以静态分支总数冒充实际发射数。"""
from copy import deepcopy
import json
from math import degrees
from pathlib import Path
import random
import unittest

import wf_seasonal7_kit_philia as K
import wf_philia_random_pf as R
from wf_philia_wind_revision import revise_pf as straight_pf
from wf_character_revision import encode_tree

PROTO = Path(__file__).resolve().parents[2] / K.PROTO_REL


@unittest.skipUnless((PROTO/'pf_lv1.json').is_file(), 'official-derived PF fixture absent')
class RandomPfTest(unittest.TestCase):
    def source(self, level):
        return straight_pf(json.loads((PROTO/f'pf_lv{level}.json').read_bytes()))

    def test_all_levels_all_branches_keep_damage_hit_policy_and_visuals(self):
        for level in (1, 2, 3):
            source = self.source(level)
            original = [n for n in R.launch_body(source) if n[0] == 'Command'
                        and n[1][0] == 'CreateHitArea' and 200 <= n[1][19] < 225]
            tree = R.revise_pf(source)
            self.assertEqual(set(K.spec_paths(tree)), set(K.spec_paths(source)))
            for name in ('NotifyPowerflipEnd', 'SetPowerFilpSuppress', 'CreateCondition'):
                self.assertEqual(K.cmds(tree, name), K.cmds(source, name))
            for i, choice in enumerate(K.cmds(tree, 'ConditionalsProbability')):
                for branch in choice[1][1]:
                    blade = branch[1][1][1][0]
                    # Undo only angle/art heading and subject remapping; exact tree equality
                    # proves no change to hit count, damage, speed, rain, or its timing.
                    reverse = {1: 1}
                    old_ids, new_ids = [], []
                    K.remap_subjects(deepcopy(original[i]), lambda n: old_ids.append(n) or n)
                    K.remap_subjects(deepcopy(blade), lambda n: new_ids.append(n) or n)
                    reverse.update(zip(new_ids, old_ids))
                    restored = deepcopy(blade)
                    K.remap_subjects(restored, reverse.__getitem__)
                    restored[1][6] = original[i][1][6]
                    for a, b in zip(K.cmds(restored, 'ShowEffect'), K.cmds(original[i], 'ShowEffect')):
                        a[9] = b[9]
                    self.assertEqual(restored, original[i])
            self.assertEqual(R.revise_pf(tree), tree)
            self.assertEqual(straight_pf(tree), tree)
            encode_tree(tree)

    def test_runtime_draws_exactly_five_distinct_angles_covering_full_circle(self):
        choices = K.cmds(R.revise_pf(self.source(3)), 'ConditionalsProbability')
        angle_sets = []
        for choice in choices:
            angles = [round(degrees(b[1][1][1][0][1][6])) for b in choice[1][1]]
            self.assertEqual(len(angles), 36)
            self.assertEqual({a//90 for a in angles}, {0, 1, 2, 3})
            angle_sets.append(set(angles))
        for i in range(5):
            for j in range(i):
                self.assertFalse(angle_sets[i] & angle_sets[j])
        rng = random.Random(921)
        patterns = set()
        for _ in range(500):
            draw = [rng.choice(c[1][1])[1][1][1][0] for c in choices]
            angles = tuple(n[1][6] for n in draw)
            self.assertEqual(len(set(angles)), 5)
            self.assertEqual(len(draw), 5)
            patterns.add(angles)
        self.assertGreater(len(patterns), 490)

    def test_invalid_random_payload_or_scope_is_rejected(self):
        tree = R.revise_pf(self.source(1))
        broken = deepcopy(tree)
        K.cmds(broken, 'ConditionalsProbability')[0][1][1][0][1].pop()
        with self.assertRaises(ValueError):
            R.validate(broken)
        broken = deepcopy(tree)
        K.cmds(broken, 'MoveHitArea')[-1][1] = 999999
        with self.assertRaises(ValueError):
            R.validate(broken)


if __name__ == '__main__':
    unittest.main()
