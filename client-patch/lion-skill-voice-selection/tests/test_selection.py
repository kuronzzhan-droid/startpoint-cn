from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import patch
import verify
import asm
import ui_block
import ui_verify


class SelectionTests(unittest.TestCase):
    def setUp(self):
        names = {6: 'Array', 7439: 'characterId', 16729: 'generateVoicePaths',
                 210: 'http://adobe.com/AS3/2006/builtin::splice'}
        self.abc = SimpleNamespace(mn_name=names.__getitem__, ints={5756: 119996},
                                  strings={26766: b'battle/skill_'})
        original = [('getlocal_0',), ('pushscope',), ('findproperty', 16729),
                    ('pushstring', 26766), ('callproperty', 16729, 1), ('coerce', 6)]
        raw, _ = asm.encode(asm.assemble(original + [('returnvalue',)]))
        body = [0, 2, 1, 1, 2, raw, []]
        _, _, self.code, _ = asm.splice_many(body, [(6, asm.assemble(patch.block()), asm.ENTER)])

    def test_current_seven_recordings_keep_only_requested_five(self):
        paths = [f'skill_{i}' for i in range(7)]
        actor = SimpleNamespace(characterId=119996, generateVoicePaths=lambda _: paths)
        result, _ = verify.execute(self.code, self.abc, actor)
        self.assertEqual(result, ['skill_0', 'skill_1', 'skill_4', 'skill_5', 'skill_6'])

    def test_missing_assets_and_unrelated_characters_preserve_native_behavior(self):
        self.assertEqual(len(verify.scenarios(self.code, self.abc)), 640)

    def test_wrong_character_or_splice_mutations_are_detected(self):
        for mutate in ('guard', 'splice'):
            code = [asm.Instruction(x.op, list(x.args), target=x.target) for x in self.code]
            if mutate == 'guard':
                target = next(x for x in code if x.name == 'ifne')
                target.op = asm.MNEMONICS['ifeq']
            else:
                target = next(x for x in code if x.name == 'pushbyte')
                target.args[0] = 1
            with self.assertRaises(AssertionError):
                verify.scenarios(code, self.abc)

    def test_unverified_swf_fails_before_creating_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            source = folder/'other.swf'
            source.write_bytes(b'not the approved input')
            with self.assertRaises(asm.AsmError):
                patch.apply(source, folder/'new.swf', folder/'report.json')
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ['other.swf'])

    def test_ready_ui_three_distinct_lines_and_all_missing_file_fallbacks(self):
        names = {6:'Array', 7439:'characterId', 7746:'logicAssets'}
        abc = SimpleNamespace(mn_name=names.__getitem__, ints={5756:119996},
            strings={i:p.encode() for i,p in zip(ui_block.STRING_IDS, ui_block.PATHS)})
        self.assertEqual(ui_verify.scenarios(asm.assemble(ui_block.block()), abc), 80)


if __name__ == '__main__':
    unittest.main()
