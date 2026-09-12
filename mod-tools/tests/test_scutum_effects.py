"""真实官方王子特效的单根颜色字段、图集和时序保护。"""
from copy import deepcopy
import os
from pathlib import Path
import sys
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_dsl
from wf_enhancement_policy import OfficialBaseline
from wf_mod_tool import sha1_path
import wf_scutum_effects as fx


class ScutumEffectsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cdn = Path(os.environ.get('WF_SCUTUM_OFFICIAL_CDN', 'D:/WF/startpoint-cn/.cdn/cn'))
        if not (cdn / 'archive-common-full').is_dir():
            raise unittest.SkipTest('official CN archive required')
        cls.baseline = OfficialBaseline(cdn, write_cache=False)
        cls.source = {}
        for suffix in fx.SUFFIXES:
            h = sha1_path(fx.SOURCE + suffix)
            cls.source[fx.SOURCE + suffix] = cls.baseline.get('common', h[:2]+'/'+h[2:])
        cls.outputs = fx.assets(cls.source.__getitem__)

    def tree(self, raw):
        return wf_dsl.parse_dsl(zlib.decompress(raw, -15))['tree']

    def test_png_and_timeline_identical_atlas_only_names_change(self):
        for suffix in ('.png','.timeline.amf3.deflate'):
            self.assertEqual(self.outputs['common', fx.TARGET+suffix], self.source[fx.SOURCE+suffix])
        suffix = '.atlas.amf3.deflate'
        self.assertEqual(self.tree(self.outputs['common',fx.TARGET+suffix]),
                         fx.remap(self.tree(self.source[fx.SOURCE+suffix])))

    def test_only_one_root_c_added_all_geometry_alpha_blend_and_frames_unchanged(self):
        suffix = '.parts.amf3.deflate'
        before = self.tree(self.source[fx.SOURCE+suffix])
        after = self.tree(self.outputs['common',fx.TARGET+suffix])
        self.assertEqual(len(after['g']),111)
        self.assertEqual(len(after['i']),28)
        self.assertEqual(len(after['t']),218)
        coloured = [(gi,si,ki) for gi,g in enumerate(after['g']) for si,s in enumerate(g['s'])
                    for ki,key in enumerate(s['l']) if 'c' in key]
        self.assertEqual(coloured,[(0,0,0)])
        self.assertEqual(after['g'][0]['s'][0]['l'][0].pop('c'), fx.TINT)
        self.assertEqual(after,fx.remap(before))
        self.assertEqual(sum(len(s['l']) for g in after['g'] for s in g['s']),1438)

    def test_native_shader_fixed_rgb_probes_alpha_not_encoded_in_c(self):
        self.assertEqual(fx.native_rgb((255,255,255)), (119,209,189))
        self.assertEqual(fx.native_rgb((255,200,0)), (119,190,100))
        self.assertEqual(fx.native_rgb((0,0,0)), (30,120,100))
        self.assertEqual(fx.TINT >> 24,35)  # This byte is RGB multiplier percent, not alpha.
        self.assertTrue(fx.metadata()['alpha_blend_geometry_unchanged'])

    def test_reject_source_colour_and_root_drift(self):
        before = self.tree(self.source[fx.SOURCE+'.parts.amf3.deflate'])
        copy = deepcopy(before); copy['g'][0]['t'] = 65
        with self.assertRaises(ValueError):fx.tint_parts(copy)
        copy = deepcopy(before);copy['g'][-1]['s'][0]['l'][0]['c']=0x64000000
        with self.assertRaises(ValueError):fx.tint_parts(copy)
        self.assertEqual(before,self.tree(self.source[fx.SOURCE+'.parts.amf3.deflate']))

    def test_build_emits_exact_four_private_assets_only(self):
        class Seed:
            def __init__(self, inputs):self.inputs,self.outputs=inputs,{}
            def official(self, logical):return self.inputs[logical]
            def emit(self,tier,logical,raw):self.outputs[tier,logical]=raw
        seed = Seed(self.source)
        meta = fx.build(seed)
        self.assertEqual(seed.outputs,self.outputs)
        self.assertEqual(len(meta['assets']),4)
        self.assertFalse(meta['requires_new_apk'])


if __name__ == '__main__':unittest.main()
