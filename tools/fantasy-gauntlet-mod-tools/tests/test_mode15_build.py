from __future__ import annotations

import sys
import unittest
from pathlib import Path

MOD_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MOD_DIR))

import wf_mode15_build as mode15  # noqa: E402


def blank_row(size: int) -> list[str]:
    return [""] * size


class TestMode15Progression(unittest.TestCase):
    def test_carnival_rows_bridge_to_multiplayer_milestones(self) -> None:
        table = {}
        for event_id, count in (
            (mode15.CARNIVAL_TEMPLATE_EVENT, 9),
            (mode15.CARNIVAL_EXTRA_TEMPLATE_EVENT, 3),
        ):
            rows = {}
            for quest_no in range(1, count + 1):
                row = blank_row(110)
                rows[str(quest_no)] = mode15.join(row, False)
            table[event_id] = rows

        patched = mode15.build_carnival_quests(table, mode15.ModeIds())

        stage4 = mode15.cells(patched["4"])
        self.assertEqual(
            ["13", "250698", "", "3", "250698003"],
            stage4[9:14],
        )
        self.assertEqual(stage4[9:14], stage4[36:41])

        stage6 = mode15.cells(patched["5"])
        self.assertEqual("十五关试炼 第6关 ::quest_rank::", stage6[4])
        self.assertEqual(
            ["18", "100098", "", "1", "100098001"],
            stage6[9:14],
        )
        self.assertEqual(stage6[9:14], stage6[36:41])

        stage11 = mode15.cells(patched["9"])
        self.assertEqual(
            ["18", "100098", "", "2", "100098002"],
            stage11[9:14],
        )

    def test_first_carnival_stage_has_no_inherited_prerequisite(self) -> None:
        table = {}
        for event_id, count in (
            (mode15.CARNIVAL_TEMPLATE_EVENT, 9),
            (mode15.CARNIVAL_EXTRA_TEMPLATE_EVENT, 3),
        ):
            rows = {}
            for quest_no in range(1, count + 1):
                row = blank_row(130)
                row[9:14] = ["13", "1", "", "1", "1001"]
                row[36:41] = ["13", "1", "", "1", "1001"]
                rows[str(quest_no)] = mode15.join(row, False)
            table[event_id] = rows
        first = mode15.cells(
            mode15.build_carnival_quests(table, mode15.ModeIds())["1"]
        )
        self.assertEqual(["(None)", "", "", "", ""], first[9:14])
        self.assertEqual(["(None)", "", "", "", ""], first[36:41])

    def test_hard_multi_rows_require_carnival_4_8_12(self) -> None:
        table = {}
        for template_event in mode15.MULTI_TEMPLATE_EVENTS:
            row = blank_row(130)
            row[0] = f"{template_event}001"
            table[template_event] = {"1": mode15.join(row, False)}

        quests = mode15.build_hard_multi_quests(table, mode15.ModeIds())
        expected_solo_nos = (4, 8, 12)
        for quest_no, solo_no in enumerate(expected_solo_nos, start=1):
            row = mode15.cells(quests[str(quest_no)])
            expected = [
                "13",
                "250698",
                "",
                str(solo_no),
                str(250698000 + solo_no),
            ]
            self.assertEqual(expected, row[7:12])
            self.assertEqual(expected, row[34:39])
            self.assertEqual("(None)", row[12])
            self.assertEqual("(None)", row[39])

    def test_event_folder_orders_carnival_before_hard_multi(self) -> None:
        table = {"1": {"1": mode15.join(["13", "1001", "1"], False)}}
        rows = mode15.build_event_folder_events(table, mode15.ModeIds())
        self.assertEqual(["9", "250698", "2"], mode15.cells(rows["1"]))
        self.assertEqual(["13", "100098", "1"], mode15.cells(rows["2"]))

    def test_event_folder_is_not_registered_as_score_attack(self) -> None:
        # EventIdKind 14 is ScoreAttackEvent.  Event folders are discovered
        # directly from EventFolderTable and must not appear in event_list.
        self.assertFalse(hasattr(mode15, "build_event_list_entry"))
        self.assertNotIn("event_list", mode15.PUBLISH_TABLES)


if __name__ == "__main__":
    unittest.main()
