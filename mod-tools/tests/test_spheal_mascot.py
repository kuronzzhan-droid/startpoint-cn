"""海豹球候选集成检查：在有本地候选包时运行，不依赖服务器/模拟器。"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_seasonal7_common as C
import wf_client_legality
import wf_character_workspace as W

WORKSPACE = Path(__file__).resolve().parents[2] / "work/character_packs/spheal-mascot-20260919"


@unittest.skipUnless((WORKSPACE / "evidence/spheal-media.json").exists(), "需要本地海豹球候选")
class SphealCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from wf_spheal_mascot import context
        cls.pack = context()

    def rows(self, logical, key):
        return C.csv_split(self.pack.pkg_flat(logical)[key])

    def test_energy_all_levels(self):
        lg = "master/skill/action_skill.orderedmap"
        table = C.core.load_nested_table_bytes(self.pack.pkg_path("common",lg).read_bytes(),lg)
        for text in table.rows["spheal_mascot"].text_rows().values():
            row = C.csv_split(text)[0]
            self.assertEqual(row[4:6], ["250", "250"])

    def test_leader_only_local_charge(self):
        rows = self.rows("master/ability/leader_ability.orderedmap", "129990")
        charges = [r for r in rows if r[45] == "211"]
        self.assertEqual(len(charges),1)
        self.assertEqual([charges[0][25],charges[0][46],charges[0][49],charges[0][50]],
                         ["0","5","100000","100000"])
        for lg in self.pack.pkg_dsl_programs():
            self.assertFalse(C.commands(C.amf_parse(self.pack.pkg_path("common",lg).read_bytes()), "AddSkillPoint"))

    def test_global_attack_is_eternal_and_does_not_stack(self):
        tree = C.amf_parse(self.pack.pkg_path("common", "battle/action/skill/ability/ability_skill_spheal_mascot_leader.action.dsl.amf3.deflate").read_bytes())
        commands = C.commands(tree,"CreateCondition")
        self.assertEqual({c[1] for c in commands},{1,-33})
        for command in commands:
            effect = command[2][0]
            self.assertEqual(effect[0], "ACAttackPoint")
            self.assertEqual(effect[1],[{"min":99999,"max":99999}])
            self.assertEqual(effect[2:],[ [{"min":1,"max":1}], [{"min":1,"max":1}] ])
            self.assertFalse(command[5])

    def test_mascot_abilities_and_client_abi(self):
        rows=[self.rows("master/ability/ability.orderedmap",f"129990{i}")[0] for i in range(1,7)]
        self.assertEqual([r[47] for r in rows],["205","37","205","205","33","206"])
        self.assertEqual(rows[2][1],"false")
        self.assertEqual(rows[2][48],"5")
        self.assertEqual((rows[5][27],rows[5][34]),("23","5"))
        for r in rows:
            self.assertEqual(wf_client_legality.client_legality_problems("ability",r),[])

    def test_healing_skill_has_no_attack(self):
        for lg in self.pack.pkg_dsl_programs():
            if "/action/rare5/" not in lg:
                continue
            tree=C.amf_parse(self.pack.pkg_path("common",lg).read_bytes())
            self.assertFalse(C.commands(tree,"CreateNormalAttack"))
            heals=C.commands(tree,"CreateRatioHeal")
            self.assertEqual(len(heals),3)
            self.assertIn(-33,[h[1] for h in heals])
            self.assertTrue(all(h[3][0]["max"] <= .04 for h in heals))

    def test_portraits_and_pixels_are_own_media(self):
        from PIL import Image
        import numpy as np
        for i in range(2):
            image=Image.open(self.pack.evidence_path(f"masters/spheal-{i}.png"))
            self.assertEqual(image.mode,"RGBA")
            self.assertGreater(float((np.asarray(image)[:,:,3]==0).mean()),.1)
        report=self.pack.read_evidence("pixel-report.json")
        self.assertEqual(len(report["regular"]["sequences"]),9)
        self.assertEqual(len(report["special"]["sequences"]),1)

    def test_before_and_after_have_safe_speech(self):
        rows=self.rows("master/character/character_speech.orderedmap","129990")
        self.assertEqual({r[1] for r in rows},{"0","1"})
        self.assertTrue(all(r[4]=="(None)" for r in rows))
        self.assertFalse(list(self.pack.pkg_path("common","character/spheal_mascot/voice").glob("**/*.mp3")))

    def test_required_assets_and_three_layers(self):
        status=W.workspace_status(W.load_workspace(WORKSPACE),persist=False)
        self.assertEqual(status.requirement_report["required_present"],37)
        self.assertFalse(status.manifest_errors)
        self.assertTrue(status.three_layer_claim_status["consistent"])


if __name__ == "__main__":
    unittest.main()
