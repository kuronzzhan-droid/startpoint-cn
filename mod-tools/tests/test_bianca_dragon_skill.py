"""协力幼龙分支、标记结算顺序和像素来源的回归约束。"""
import io
import math
import sys
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image

import wf_assets
import wf_dsl
import wf_bianca_dragon_skill as skill
import wf_bianca_dragon_pixels as pixels
from wf_campus_bianca_data import validate_skill, walk_commands
from wf_dsl_sig import COMMANDS
from wf_pixelart_vfx import entry_for_frame, frame_index, restore_frame


def commands(tree):
    return list(walk_commands(tree))


class DragonSkillTests(unittest.TestCase):
    def test_exact_owned_dragon_and_recall_only_when_absent(self):
        tree = skill.build_skill(2)
        selector = next(c for c in commands(tree) if c[0] == "FindMultiballSubjects")
        self.assertEqual(selector[1:5], [10, 11, True, [1199891]])
        absent, present = selector[5:7]
        self.assertEqual(sum(c[0] == "CreateSummonsMultiball" for c in commands(absent)), 1)
        self.assertFalse(any(c[0] == "CreateSummonsMultiball" for c in commands(present)))
        remove = next(c for c in commands(present) if c[0] == "RemoveMultiball")
        self.assertEqual(remove, ["RemoveMultiball", True, [1199891]])

    def test_support_damage_has_time_to_resolve_before_removal(self):
        tree = skill.build_skill(2)
        present = next(c for c in commands(tree) if c[0] == "FindMultiballSubjects")[6]
        breath = next(node[1] for node in present[1] if node[0] == "Event")
        self.assertEqual(breath[0:2], ["Wait", 24])
        actions = breath[3][1]
        self.assertEqual(actions[-2][1][1:3], [11, [["ACUnique", 11998902, skill.value(1)]]])
        signal = actions[-1][1]
        self.assertEqual(signal[0:2], ["Wait", 1])
        self.assertEqual(signal[3][1][0][1][1], -17)
        depart = signal[3][1][-1][1]
        self.assertEqual(depart[0:2], ["Wait", 2])
        self.assertEqual(depart[3][1][0][1], ["RemoveMultiball", True, [1199891]])
        self.assertFalse(any("Attack" in c[0] for c in commands(tree)))

    def test_native_timed_resists_and_top_down_breath(self):
        tree = skill.build_skill(2)
        cs = commands(tree)
        effects = [c for c in cs if c[0] == "CreateCondition"]
        status = {c[2][0][0]: c[2][0] for c in effects if c[2][0][0] != "ACUnique"}
        self.assertEqual(status["ACAttackPoint"][1:], [skill.value(900), skill.value(-.2), skill.value(1)])
        self.assertEqual(status["ACToleranceOfElement"][1:], [skill.value(900), 1, skill.value(-.25), skill.value(1)])
        self.assertEqual(status["ACAbilityDamageResistance"][1:], [skill.value(900), skill.value(-.2), skill.value(1)])
        enhanced = next(c for c in cs if c[0] == "ConditionalsChangeSkillFlag")
        self.assertEqual(enhanced[1], 1)
        self.assertTrue(any(c[0] == "CreateCondition" for c in commands(enhanced[2])))
        self.assertEqual(enhanced[3], ["Block", []])
        visual = next(c for c in cs if c[0] == "ShowEffect" and c[1] == "campus_dragon_descent")
        self.assertEqual(visual[9], math.pi)
        invincible = next(c for c in effects if c[2][0][0] == "ACInvincible")
        self.assertEqual(invincible[1], 11)
        self.assertEqual(invincible[2], [["ACInvincible", skill.value(60)]])
        self.assertTrue(invincible[5])
        ascent = next(c for c in cs if c[0] == "MoveHitArea")
        self.assertEqual(ascent[1:5], [12, ["AB"], 0, 120])
        self.assertFalse(any(c[0] == "MoveBall" for c in cs))

    def test_activation_marks_member_and_does_not_expire_in_fifteen_seconds(self):
        summon = next(c for c in commands(skill.build_skill(1)) if c[0] == "CreateSummonsMultiball")
        self.assertEqual(summon[1:4], [1, 1199891, skill.value(2147483647)])
        mark = summon[12][1][0][1]
        self.assertEqual(mark[1:3], [-17, [["ACUnique", 11998901, skill.value(1)]]])

    def test_both_levels_roundtrip_and_native_signatures(self):
        for level in (1, 2):
            tree = skill.build_skill(level)
            self.assertEqual(wf_dsl.parse_dsl(zlib.decompress(skill.amf_bytes(tree), -15))["tree"], tree)
            validate_skill(tree)
            for c in commands(tree):
                self.assertEqual(len(c)-1, len(COMMANDS[c[0]]), c[0])
        with self.assertRaises(ValueError):
            skill.build_skill(3)

    def test_multiball_data_has_private_body_and_support(self):
        donor = ["original", "original", "5", "0", "Mystery", "", "1", "Unknown", "false", "(None)"] + [""]*10 + ["(None)"]*4 + ["1", "0", "false", "false"]
        level = [["curve", "304", "1", "curve", "455", "1"]]
        result = skill.build_multiball_tables({"1111711": [donor]}, {"1111711": level})
        row = result["master/battle/multiball/multiball.orderedmap"]["1199891"][0]
        self.assertEqual(row[1], "lady_summoner_campus_dragon")
        self.assertEqual(row[3:5], ["0", "Dragon"])
        self.assertEqual(row[20:24], ["11998991", "(None)", "(None)", "(None)"])
        self.assertEqual(donor[0], "original")

    def test_pixel_frames_preserve_native_texels_and_have_collision(self):
        keys = sorted({k for seq in pixels.SEQUENCES.values() for k in seq})
        source = Image.new("RGBA", (len(keys)*6, 6))
        atlas = []
        originals = {}
        for index, key in enumerate(keys):
            tile = Image.new("RGBA", (4, 4), (index*17, 21, 127, 255))
            source.paste(tile, (index*6, 0)); originals[key] = tile
            atlas.append(dict(n="source/"+key, x=index*6, y=0, w=4, h=4))
        buf = io.BytesIO(); source.save(buf, format="PNG")
        fixture = {pixels.SOURCE+".png": wf_assets.png_encode(buf.getvalue()),
                   pixels.SOURCE+".atlas.amf3.deflate": skill.amf_bytes(atlas)}
        files, report = pixels.build_dragon_assets(fixture.__getitem__)
        prefix = "character/lady_summoner_campus_dragon/pixelart/"
        sheet = Image.open(io.BytesIO(wf_assets.png_decode(files["common", prefix+"sprite_sheet.png"])))
        def read(stem):
            return wf_dsl.parse_dsl(zlib.decompress(files["common", prefix+stem+".amf3.deflate"], -15))["tree"]
        idx = frame_index(read("sprite_sheet.atlas"), prefix+"pixelart")
        for item in report["frames"]:
            frame = restore_frame(sheet, entry_for_frame(idx, item["end"]))
            tile = frame.crop(frame.getchannel("A").getbbox())
            self.assertEqual(tile.tobytes(), originals[item["source"].rsplit("/", 1)[-1]].tobytes())
        self.assertEqual(read("pixelart.timeline")["circles"][0]["path"], "unit_body")
        self.assertFalse(report["pixel_content_changed"])
        # 每个演出图层都必须命中本包原龙atlas，不能隐含借入海盗等外观。
        fx_atlas_path = skill.CALL_EFFECT + "campus_bianca_dragon_call.atlas.amf3.deflate"
        fx_atlas = wf_dsl.parse_dsl(zlib.decompress(files["common", fx_atlas_path], -15))["tree"]
        names = {entry["n"] for entry in fx_atlas}
        parts_count = 0
        for (_, logical), raw in files.items():
            if logical.endswith(".parts.amf3.deflate"):
                parts = wf_dsl.parse_dsl(zlib.decompress(raw, -15))["tree"]
                self.assertTrue({entry["p"] for entry in parts["i"]} <= names)
                self.assertEqual(parts["t"][0]["a"], 6*4096)
                parts_count += 1
        self.assertEqual(parts_count, 6)


if __name__ == "__main__":
    unittest.main()
