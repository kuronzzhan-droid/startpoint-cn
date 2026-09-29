"""Focused contracts for read-only wiki roster, source consistency and semantics."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_mod_tool as core
import wf_wiki_catalog as catalog
from wf_wiki_catalog_source import WikiSource, detect_roster, walk_commands
from wf_wiki_categories import BOSS_IDS, EDITOR_NOTES, FURRY_WORLD_IDS, SMALL_ANIMAL_IDS, category_for


def character(code="example", leader="3"):
    row = [""] * 37
    for column, value in {0: code, 2: "5", 3: "3", 4: "Human,Beast", 6: "0", 7: "Male",
                          8: code, 9: "(None)", 17: leader, 18: "队长技", 26: "Attacker"}.items():
        row[column] = value
    row[19:25] = [str(i) for i in range(81, 87)]
    return row


class MemorySource:
    def __init__(self):
        self.live = {"character": {"10": [character()]}}
        self.base = {"character": {"10": [character()]}}
        self.trees = {}

    def table(self, key, official=False):
        return (self.base if official else self.live).get(key, {})

    def raw(self, logical, official=False):
        return (b"base" if official else b"live") if logical in self.trees else None

    def tree(self, logical, official=False):
        value = self.trees.get(logical)
        return value[1 if official else 0] if value else None

    def citation(self, logical):
        return {"logical": logical, "sha256": "example"}


class RosterTests(unittest.TestCase):
    def test_new_key_and_legacy_leader_id_are_detected(self):
        source = MemorySource()
        source.live["character"]["99"] = [character("new", "99")]
        source.live["leader"] = {"3": [["changed"]]}
        source.base["leader"] = {"3": [["original"]]}
        roster, modified = detect_roster(source)
        self.assertEqual(roster, ["10", "99"])
        self.assertEqual(modified, {"10": ["leader:3"]})

    def test_official_baseline_is_required(self):
        source = MemorySource()
        source.base = {}
        with self.assertRaisesRegex(ValueError, "官方角色基准为空"):
            detect_roster(source)

    def test_removed_ability_and_awake_changes_are_in_scope(self):
        source = MemorySource()
        source.base["ability"] = {"81": [["original"]]}
        source.live["awake"] = {"10": [["9", "18"]]}
        self.assertEqual(detect_roster(source)[1]["10"], ["awake:10", "ability:81"])

    def test_different_dsl_encoding_with_same_tree_is_not_mod(self):
        source = MemorySource()
        fields = ["", "", "", "", "", "", "", "battle/example"]
        source.live["skill"] = source.base["skill"] = {"example": {"1": [fields]}}
        source.trees["battle/example.action.dsl.amf3.deflate"] = (["same"], ["same"])
        self.assertEqual(detect_roster(source), ([], {}))
        source.trees["battle/example.action.dsl.amf3.deflate"] = (["new"], ["same"])
        self.assertEqual(detect_roster(source)[0], ["10"])


class SourceConsistencyTests(unittest.TestCase):
    def test_changed_live_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp, patch(
                "wf_wiki_catalog_source.OfficialBaseline", return_value=Mock()):
            root = Path(temp)
            logical = "example.orderedmap"
            path = core.table_path(root, logical)
            path.parent.mkdir(parents=True)
            path.write_bytes(b"before")
            source = WikiSource(root, root)
            self.assertEqual(source.raw(logical), b"before")
            source.verify_unchanged()
            path.write_bytes(b"after")
            with self.assertRaisesRegex(RuntimeError, "源文件发生变化"):
                source.verify_unchanged()

    def test_fallback_is_not_live_and_missing_path_creation_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp, patch(
                "wf_wiki_catalog_source.OfficialBaseline", return_value=Mock(get=Mock(return_value=b"official"))):
            root = Path(temp)
            source = WikiSource(root, root)
            self.assertEqual(source.raw("example"), b"official")
            self.assertEqual(source.live_hashes, {})
            self.assertEqual(source.missing, {"example"})
            path = core.table_path(root, "example")
            path.parent.mkdir(parents=True)
            path.write_bytes(b"newly arrived")
            with self.assertRaises(RuntimeError):
                source.verify_unchanged()


class PresentationSemanticsTests(unittest.TestCase):
    def test_categories_follow_project_batches_not_beast_species(self):
        self.assertEqual(len(BOSS_IDS), 29)
        self.assertEqual(len(SMALL_ANIMAL_IDS), 16)
        self.assertFalse(BOSS_IDS & SMALL_ANIMAL_IDS)
        for cid in ("10", "119990", "129992", "261089"):
            self.assertEqual(category_for(cid)[0], "原创与改版")
        for cid in ("139996", "129990", "119994"):
            self.assertEqual(category_for(cid)[0], "小动物")
        for cid in ("169994", "179986", "149998"):
            self.assertEqual(category_for(cid)[0], "Boss角色")

    def test_author_furry_world_ids_do_not_conflate_gerald_and_gerard(self):
        self.assertEqual(FURRY_WORLD_IDS, {"129999", "149999", "169999", "139990"})
        for cid in FURRY_WORLD_IDS:
            self.assertEqual(category_for(cid)[0], "毛茸异世界")
        self.assertEqual(category_for("129992")[0], "原创与改版")
        self.assertIn("后续将重做", EDITOR_NOTES["129999"])
        self.assertEqual(set(EDITOR_NOTES), {"129999"})

    def test_conditions_use_only_verified_names_and_keep_unknown_ids(self):
        source = MemorySource()
        source.live["condition"] = {"22": [["internal", "龙王显现"]]}
        self.assertEqual(catalog.condition_names(source, "固有22 / 固有999"),
                         "龙王显现（固有22） / 固有999")

    def test_stats_sort_levels_and_keep_awake_atk_hp_separate(self):
        source = MemorySource()
        source.live["status"] = {"10": [("10", 100, 20), ("1", 50, 10), ("100", 500, 100)]}
        source.live["awake"] = {"10": [["12", "34"]]}
        media = Mock(image=Mock(return_value=None))
        entry = catalog.character_entry(source, "10", [], media)
        self.assertEqual([row["level"] for row in entry["stats"]["levels"]], [1, 10, 100])
        self.assertEqual(entry["stats"]["awakePerNode"], {"atk": 12, "hp": 34})
        self.assertEqual(entry["stats"]["levels"][-1], {"level": 100, "hp": 500, "atk": 100})

    def test_native_main_icon_forms_are_plain_text(self):
        self.assertEqual(catalog.plain("<icon id='main'> 技能"), "【主位】 技能")
        self.assertEqual(catalog.plain('<icon id="main" /> 技能'), "【主位】 技能")

    def test_nested_commands_keep_numbers_without_recursive_duplication(self):
        child = ["Command", ["Damage", 25.5, {"min": 2, "max": 8}]]
        parent = ["Event", ["Sequence", [child]]]
        output = catalog.compact_commands(list(walk_commands(parent)))
        self.assertEqual(output[0]["arguments"], [[{"commandRef": 2}]])
        self.assertEqual(output[1]["arguments"], [25.5, {"min": 2, "max": 8}])

    def test_gauge_uses_max_and_real_form_without_voice_suffix_is_not_mislabeled(self):
        source = MemorySource()
        source.live["skill"] = {"example": {"2": [["技能＋", "描述", "", "", "600", "450", "", "battle/main"]]}}
        source.live["switched"] = {"real_form": {"2": [["battle/main"]]}}
        source.trees["battle/main.action.dsl.amf3.deflate"] = (["Command", ["Damage", 5]], None)
        row = character()
        row[9], row[14] = "1", "real_form"
        skills, switch = catalog.skills_for(source, row)
        self.assertEqual(skills[0]["gauge"], 450)
        self.assertEqual(skills[0]["gaugeMin"], 600)
        self.assertEqual(skills[0]["label"], "进化技能")
        self.assertNotIn("语音路由", skills[1]["label"])
        self.assertEqual(switch["key"], "real_form")

    def test_invoke_skill_uses_actual_program_column_and_not_caption_key(self):
        source = MemorySource()
        row = [""] * 126
        row[47], row[70], row[71] = "629", "text_key", "battle/actual/path"
        with patch.object(catalog, "skill_program", return_value={"commands": []}) as program:
            refs = catalog.related_programs(source, [row], "ability")
        program.assert_called_once_with(source, "battle/actual/path")
        self.assertEqual(refs[0]["key"], "text_key")

    def test_powerflip_only_reads_override_fields_not_category(self):
        source = MemorySource()
        source.live["power_flip"] = {"special": [["battle/special"]], "custom": [["battle/custom"]]}
        row = [""] * 126
        row[2] = "special"  # Ability category is not a PF override.
        row[82] = "custom"
        with patch.object(catalog, "skill_program", return_value={"commands": []}) as program:
            refs = catalog.related_programs(source, [row], "ability")
        program.assert_called_once_with(source, "battle/custom")
        self.assertEqual(len(refs), 1)


if __name__ == "__main__":
    unittest.main()
