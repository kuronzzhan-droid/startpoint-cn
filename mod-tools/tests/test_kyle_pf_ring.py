"""Native mechanics and Flatomo failure guards for Kyle's scoped PF replacement."""
import copy
import sys
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_dsl
import wf_client_legality as legality
import wf_kyle_pf_effect as F
import wf_kyle_pf_ring as P
import wf_mod_tool as core
import wf_seasonal7_common as C
from wf_seasonal7_kit_zehr import apk_pf_sources


class RingAnimationTests(unittest.TestCase):
    def test_birth_loop_fade_fit_each_original_hit_window(self):
        for lifetime in F.LIFETIMES:
            parts, timeline = F.native_animation(lifetime)
            self.assertEqual(parts['g'][0]['t'], lifetime)
            self.assertEqual(timeline['sequences'][0]['end'], lifetime)
            self.assertEqual(timeline['sequences'][0]['kind'], 'once')
            last = [s for s in parts['g'][0]['s'] if s['s'] == lifetime-1]
            self.assertTrue(last)
            self.assertTrue(all(k['m'] & 255 == 0 for s in last for k in s['l']))

    def test_rotation_is_continuous_during_sustain(self):
        parts, _ = F.native_animation(110)
        ring = {s['s']:parts['t'][s['l'][0]['m']>>12]
                for s in parts['g'][0]['s'] if s['i']==1}
        self.assertNotEqual(ring[15], ring[16])
        self.assertEqual(ring[15], ring[45])
        for frame in range(8, 97):
            self.assertNotEqual(ring[frame], ring[frame+1])

    def test_matrix_rotation_keeps_origin_fixed(self):
        parts, _ = F.native_animation(90)
        for matrix in parts['t']:
            self.assertLessEqual(abs(64*matrix['a']+64*matrix['c']+matrix['x']), 65)
            self.assertLessEqual(abs(64*matrix['b']+64*matrix['d']+matrix['y']), 65)

    def test_no_unused_or_oversubscribed_pool(self):
        for lifetime in F.LIFETIMES:
            parts, _ = F.native_animation(lifetime)
            self.assertEqual(F.capacity.image_capacities(parts), [1, 1, 1])

    def test_accepted_assets_have_closed_atlas_references(self):
        assets, note = F.build_assets(core.project_root())
        self.assertEqual(len(assets), 8)
        atlas = C.amf_parse(assets[F.SHEET+'.atlas.amf3.deflate'])
        names = {v['n'] for v in atlas}
        for level in (1, 2, 3):
            parts = C.amf_parse(assets[F.effect(level)+'.parts.amf3.deflate'])
            self.assertEqual({v['p'] for v in parts['i']}, names)
        self.assertTrue(note['center_empty'])
        self.assertLessEqual(note['atlas_size'][0]*note['atlas_size'][1], 384*128)

    def test_invalid_lifetime_and_level_are_rejected(self):
        with self.assertRaises(ValueError): F.native_animation(999)
        with self.assertRaises(ValueError): F.effect(4)


class SwordMechanicsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources, _ = apk_pf_sources(core.project_root())

    def test_all_three_levels_preserve_native_lifecycle_and_geometry(self):
        for level in (1, 2, 3):
            raw = self.sources[f'knight_lv{level}']
            original = wf_dsl.parse_dsl(zlib.decompress(raw, -15))['tree']
            tree = P.build_tree(raw, level)
            P.verify_tree(tree, original, level)
            self.assertEqual(list(wf_dsl.iter_dsl_commands(tree,'SetPowerFilpSuppress')),
                             [['SetPowerFilpSuppress',F.LIFETIMES[level-1]]])
            self.assertEqual(len(list(wf_dsl.iter_dsl_commands(tree,'NotifyPowerflipEnd'))),1)

    def test_native_donor_drift_is_not_silently_accepted(self):
        with self.assertRaises(ValueError): P.build_tree(b'corrupt', 1)

    def test_native_lookup_hit_targets_and_element_are_legal(self):
        for level in (1, 2, 3):
            tree=P.build_tree(self.sources[f'knight_lv{level}'],level)
            for checker in (legality.action_dsl_subject_binding_problems,
                            legality.action_dsl_lookup_scope_problems,
                            legality.action_dsl_hit_area_target_problems):
                self.assertEqual(checker(tree),[])
            self.assertEqual(legality.action_dsl_element_problems(tree,2),[])

    def test_accidental_damage_increase_is_rejected(self):
        raw=self.sources['knight_lv3']
        original=wf_dsl.parse_dsl(zlib.decompress(raw,-15))['tree']
        tree=P.build_tree(raw,3)
        list(wf_dsl.iter_dsl_commands(tree,'CreateNormalAttack'))[0][6][0]['max']=999
        with self.assertRaises(ValueError): P.verify_tree(tree,original,3)


if __name__ == '__main__': unittest.main()
