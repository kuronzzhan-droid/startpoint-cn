from __future__ import annotations

import sys
import unittest
from pathlib import Path


MOD_TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MOD_TOOLS))

import wf_client_legality  # noqa: E402
import wf_describe  # noqa: E402


def _base_row(kind: str, trigger_mode: str) -> list[str]:
    layout = wf_describe.layout(kind)
    blocks = {name: int(index) for name, index in layout["blocks"].items()}
    row = [""] * int(layout["ncols"])
    row[blocks["precondition1"] - 1] = trigger_mode
    for name in ("precondition1", "precondition2", "precondition3"):
        row[blocks[name]] = "0"
    if trigger_mode == "0":
        row[blocks["instant_trigger"]] = "0"
        row[blocks["instant_precontent"]] = "(None)"
        row[blocks["instant_delay"]] = "0"
        row[blocks["instant_content"]] = "0"
    elif trigger_mode == "1":
        row[blocks["during_accumulation_trigger"]] = "(None)"
        row[blocks["during_trigger"]] = "0"
        row[blocks["even_if_owner_dead"]] = "false"
        row[blocks["during_content"]] = "0"
    else:
        row[blocks["opening"]] = "0"
    return row


class ClientLegalityTests(unittest.TestCase):
    def test_constructor_kind_columns_require_declared_enum_members(self) -> None:
        cases = (
            ("0", "precondition1", "AbilityPreconditionMasterValue", "precondition1.kind"),
            ("0", "precondition2", "AbilityPreconditionMasterValue", "precondition2.kind"),
            ("0", "precondition3", "AbilityPreconditionMasterValue", "precondition3.kind"),
            ("0", "instant_trigger", "InstantAbilityTriggerMasterValue", "瞬发触发kind"),
            (
                "0", "instant_precontent", "InstantAbilityPrecontentMasterValue",
                "instant_precontent",
            ),
            (
                "1", "during_accumulation_trigger",
                "InstantAbilityTriggerMasterValue", "累积触发",
            ),
            ("1", "during_trigger", "DuringAbilityTriggerMasterValue", "持续触发kind"),
            ("2", "opening", "OpeningAbilityMasterValue", "开幕kind"),
        )
        blocks = {
            name: int(index)
            for name, index in wf_describe.layout("ability")["blocks"].items()
        }
        for mode, block, enum_name, label in cases:
            with self.subTest(block=block):
                row = _base_row("ability", mode)
                if mode == "0":
                    row[72] = "false"
                row[blocks[block]] = "9999"

                problems = wf_client_legality.client_legality_problems(
                    "ability", row,
                )

                self.assertIn(
                    f"c{blocks[block]} {label}='9999' 不属于 {enum_name} 枚举域",
                    problems,
                )

    def test_declared_enum_members_remain_legal_across_trigger_modes(self) -> None:
        for mode in ("0", "1", "2"):
            with self.subTest(mode=mode):
                row = _base_row("ability", mode)
                if mode == "0":
                    row[72] = "false"

                self.assertEqual(
                    wf_client_legality.client_legality_problems("ability", row),
                    [],
                )

        numeric_accumulation = _base_row("ability", "1")
        accumulation_col = int(
            wf_describe.layout("ability")["blocks"]["during_accumulation_trigger"]
        )
        numeric_accumulation[accumulation_col] = "0"
        self.assertEqual(
            wf_client_legality.client_legality_problems(
                "ability", numeric_accumulation,
            ),
            [],
        )

    def test_during_content_rejects_instant_only_constructor(self) -> None:
        """Catches numeric kind 723 reaching parseAt109 where no constructor exists."""
        row = _base_row("ability", "1")
        row[109] = "723"

        problems = wf_client_legality.client_legality_problems("ability", row)

        self.assertIn(
            "c109 持续效果kind='723' 不属于 CommonAbilityContentMasterValue 枚举域",
            problems,
        )

    def test_instant_content_rejects_unknown_numeric_constructor(self) -> None:
        """Catches an all-digit value bypassing the client constructor domain gate."""
        row = _base_row("ability", "0")
        row[47] = "9999"

        problems = wf_client_legality.client_legality_problems("ability", row)

        self.assertIn(
            "c47 瞬发效果kind='9999' 不属于 InstantAbilityContentMasterValue 枚举域",
            problems,
        )

    def test_instant_condition_requires_by_each_trigger_puller_boolean(self) -> None:
        """Catches ConditionAttackPoint reaching parseAt72 with an empty string."""
        row = _base_row("ability", "0")
        row[47] = "0"
        row[72] = ""

        problems = wf_client_legality.client_legality_problems("ability", row)

        self.assertIn(
            "c72 by_each_trigger_puller='' 须为 true/false(否则C7101)",
            problems,
        )

    def test_boolean_requirement_uses_each_table_layout(self) -> None:
        """Catches leader rows being checked at ability c72 instead of leader c70."""
        row = _base_row("leader_ability", "0")
        blocks = wf_describe.layout("leader_ability")["blocks"]
        row[int(blocks["instant_content"])] = "486"
        row[70] = ""

        problems = wf_client_legality.client_legality_problems("leader_ability", row)

        self.assertIn(
            "c70 by_each_trigger_puller='' 须为 true/false(否则C7101)",
            problems,
        )

    def test_required_boolean_accepts_false(self) -> None:
        """Catches a gate that rejects the canonical false sentinel while hardening C7101."""
        row = _base_row("ability", "0")
        row[47] = "0"
        row[72] = "false"

        self.assertEqual(
            wf_client_legality.client_legality_problems("ability", row),
            [],
        )


if __name__ == "__main__":
    unittest.main()
