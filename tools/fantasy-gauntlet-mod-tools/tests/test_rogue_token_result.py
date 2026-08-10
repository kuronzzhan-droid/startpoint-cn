# -*- coding: utf-8 -*-
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import wf_rogue_token_result as token_result  # noqa: E402


class TestRogueTokenResult(unittest.TestCase):
    def test_build_preserves_existing_groups(self):
        source = {
            "490000": {"1": "rescue_fragment_silver,0,49000,10,1"},
        }
        built = token_result.build_table(source)

        self.assertEqual(source["490000"], built["490000"])
        self.assertEqual(
            {"1": token_result.ABYSS_TOKEN_ROW},
            built[str(token_result.ABYSS_TOKEN_GROUP_ID)],
        )
        self.assertNotIn(str(token_result.ABYSS_TOKEN_GROUP_ID), source)

    def test_refuses_to_overwrite_an_unrelated_group(self):
        source = {
            str(token_result.ABYSS_TOKEN_GROUP_ID): {
                "1": "occupied,0,1,1,1",
            },
        }
        with self.assertRaises(ValueError):
            token_result.build_table(source)

    def test_generated_row_is_valid(self):
        built = token_result.build_table({})
        token_result.validate_table(built)


if __name__ == "__main__":
    unittest.main()
