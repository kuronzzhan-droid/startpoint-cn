import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).parents[1]
FIXTURE = Path("D:/WF/startpoint-cn/work/codex_out/newchars-revision-20260906/"
               "pf-agent-package/client-source/pcode-v8/scripts/pinball/scene/battle/"
               "battle/squad/SquadManagerImpl.pcode")


class SquadPcodeTests(unittest.TestCase):
    def module(self):
        path = HERE / "patch_squad_pcode.py"
        self.assertTrue(path.is_file(), "the existing Seris bytecode must be preserved")
        spec = importlib.util.spec_from_file_location("kyubi_squad", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_preserves_the_entire_existing_control_flow(self):
        patch = self.module()
        if not FIXTURE.is_file():
            self.skipTest("V8 P-code export unavailable")
        original = patch.extract(FIXTURE.read_text(encoding="utf-8"))
        result = patch.patch_method(original)
        self.assertEqual(patch.unpatch_method(result), original)
        self.assertEqual(patch.patch_method(result), result)
        self.assertEqual(result.count("newobject 14"), 2)
        self.assertIn("maxstack 33", result)
        self.assertEqual(result.count('pushstring "kyubiPfDamage"'), 2)
        before_branches = [s for s in original.splitlines() if s.startswith(("if", "jump", "lookupswitch"))]
        after_branches = [s for s in result.splitlines() if s.startswith(("if", "jump", "lookupswitch"))]
        self.assertEqual(before_branches, after_branches)

    def test_rejects_unknown_control_flow(self):
        patch = self.module()
        with self.assertRaises(patch.PatchError):
            patch.patch_method("method\nmaxstack 29\ncode\nreturnvoid\nend\n")


if __name__ == "__main__":
    unittest.main()
