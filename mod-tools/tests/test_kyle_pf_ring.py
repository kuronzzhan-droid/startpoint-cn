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
    @classmethod
    def setUpClass(cls):
        cls.source = core.project_root() / F.SOURCE
        cls.raw = (cls.source / F.PARTS).read_bytes()
        cls.original = C.amf_parse(cls.raw)

    def test_birth_fade_and_once_timeline_fit_all_hit_windows(self):
        for lifetime in F.LIFETIMES:
            parts, timeline = F.native_animation(lifetime)
            self.assertEqual(parts['g'][0]['t'], lifetime)
            self.assertEqual(timeline['sequences'], [dict(begin=1,end=lifetime,name='neutral',kind='once')])
            keys = parts['g'][0]['s'][0]['l']
            self.assertEqual(keys[0]['m'] & 255, 0)
            self.assertEqual(keys[-1]['m'] & 255, 0)
            self.assertEqual(sum(k['t'] & 65535 for k in keys), lifetime)

    def test_original_perspective_and_custom_curves_are_unchanged(self):
        for lifetime in F.LIFETIMES:
            parts, _ = F.native_animation(lifetime)
            self.assertEqual(parts['t'], self.original['t'])
            self.assertEqual(parts['c'], self.original['c'])
            self.assertEqual(len(parts['g']), len(self.original['g']))
            self.assertEqual({k['m'] >> 12 for k in parts['g'][0]['s'][0]['l']}, {0})

    def test_front_back_arcs_and_electric_layers_keep_independent_tweens(self):
        for lifetime in F.LIFETIMES:
            parts, _ = F.native_animation(lifetime)
            for group in (37,38,45,46,48,50,57,58,63,65):
                old=self.original['g'][group]['s']; new=parts['g'][group]['s']
                self.assertEqual(len(old),len(new))
                for a,b in zip(old,new):
                    self.assertEqual([k['m'] for k in a['l']],[k['m'] for k in b['l']])
                    self.assertEqual([int(k.get('t') or 1) & ~65535 for k in a['l']],
                                     [k['t'] & ~65535 for k in b['l']])

    def test_orb_images_and_central_charge_are_removed(self):
        parts,_=F.native_animation(110)
        self.assertTrue({i['p'].split('/')[-1]for i in parts['i']} <= F.KEEP)
        self.assertEqual(len(parts['g'][1]['s']),1)
        self.assertEqual(parts['g'][1]['s'][0]['i'],11)
        for group in (18,20,22,24,26,28,30,42,55):
            # These official direct-image groups carried the removed orb layers.
            for strip in parts['g'][group]['s']:
                self.assertNotEqual((int(strip['s']) & 0xffffffff) >> 30, 0)

    def test_native_pools_cover_every_live_nested_instance(self):
        for lifetime in F.LIFETIMES:
            parts,_=F.native_animation(lifetime)
            self.assertEqual(parts['a'], F.capacity.validate_image_capacities(parts))
            self.assertGreater(max(parts['a']), 1)
            self.assertTrue(all(n > 0 for n in parts['a']))

    def test_packed_atlas_is_closed_and_keeps_native_sprite_frames(self):
        assets,note=F.build_assets(core.project_root())
        self.assertEqual(len(assets),8)
        atlas=C.amf_parse(assets[F.SHEET+'.atlas.amf3.deflate'])
        original=C.amf_parse((self.source/(F.DONOR+'.atlas.amf3.deflate')).read_bytes())
        old={i['n'].split('/')[-1]:i for i in original if '/.gen/starbreak_hunter_meteor23_explosion/' in i['n']}
        for i in atlas:
            source=old[i['n'].split('/')[-1]]
            self.assertEqual((i['fw'],i['fh']),
                             (source.get('fw',source['h' if source.get('r') else 'w']),
                              source.get('fh',source['w' if source.get('r') else 'h'])))
        for level in (1,2,3):
            parts=C.amf_parse(assets[F.effect(level)+'.parts.amf3.deflate'])
            self.assertEqual({i['p'] for i in parts['i']},{i['n'] for i in atlas})
        self.assertFalse(note['whole_image_rotation'])
        self.assertLess(note['atlas_size'][0]*note['atlas_size'][1],60000)

    def test_source_alpha_and_brightness_are_preserved_after_api_palette_transfer(self):
        import io
        from PIL import Image, ImageChops
        import wf_assets
        old=Image.open(io.BytesIO(wf_assets.png_decode((self.source/(F.DONOR+'.png')).read_bytes()))).convert('RGBA')
        new=Image.open(self.source/'palette-atlas.png').convert('RGBA')
        self.assertEqual(old.size,new.size)
        self.assertIsNone(ImageChops.difference(old.getchannel('A'),new.getchannel('A')).getbbox())
        def value(im):
            r,g,b,_=im.split()
            return ImageChops.lighter(ImageChops.lighter(r,g),b)
        self.assertIsNone(ImageChops.difference(value(old),value(new)).getbbox())

    def test_invalid_lifetime_level_and_donor_are_rejected(self):
        with self.assertRaises(ValueError): F.native_animation(999)
        with self.assertRaises(ValueError): F.effect(4)
        with self.assertRaises(ValueError): F.filtered_native(b'corrupt')


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
