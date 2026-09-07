# -*- coding: utf-8 -*-
"""「只有打了补丁的客户端才认识」的枚举值:三处登记必须一致。

V12 往两个内容块各塞了一个**非官方**枚举值:

    instant_content 724 AddFeverPointRatio  ← client-patch/kyubi-fever-ratio
    during_content  422 DashParameter       ← client-patch/dash-parameter

官方 `AbilityValues.parseAt47` / `parseAt109` 的 else 分支是
`throw new ClientError(7050,"不存在的构造函数。")`,所以这两个值在没打补丁的客户端上
= 打开角色详情页即崩。风险不在「能不能写」,而在「写了之后有没有人记得先换 APK」。

因此三处登记必须同时在场、且互相自洽:

  1. `ability_enum_map.json` 的 `enums`(枚举域)—— 决定合法性检查放不放行;
  2. 同一份 JSON 的 `cases`(字段表)—— 决定「声明即必填」通用律管哪几列,
     并且必须带 `requires_client_capability`;
  3. `wf_client_legality.CLIENT_PATCH_CONTENT_KINDS` —— 决定
     `required_client_capabilities()` 报出哪个 capability;
  4. `词条条件代码全表.md` 的对应小节 —— 人读的那一份。

删掉这里任何一条断言都必须变红:这是唯一一处说「这两个 kind 不是官方的」的地方。

本文件末尾另有一组用例管 `custom_ability_string` 的 `desc_override_*` 行:那条门禁
与上面三条不同 —— **缺补丁不崩,只是不生效**(行是惰性的)。它要回答的是「这行要
在真机上显示出来,需要哪一版 APK」:V11 的守卫只认 `fox_oracle_autumn`,V14 泛化
成任意 `string_id`。
"""
from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wf_describe  # noqa: E402
from wf_client_legality import (  # noqa: E402
    CLIENT_PATCH_CONTENT_KINDS, CUSTOM_ABILITY_STRING_KIND,
    PANEL_OVERRIDE_KEY_PREFIX, PANEL_OVERRIDE_V1, PANEL_OVERRIDE_V1_STRING_ID_PREFIX,
    PANEL_OVERRIDE_V2, panel_override_capability, required_client_capabilities,
)

ROOT = Path(__file__).resolve().parents[1]
TABLE_MD = ROOT / "词条条件代码全表.md"

EXPECTED = {
    "instant_content": {
        "724": ("AddFeverPointRatio", "kyubi-fever-ratio-v1",
                "InstantAbilityContentMasterValue", {"strength": "parseAt51"}),
    },
    "during_content": {
        "422": ("DashParameter", "dash-parameter-v1",
                "CommonAbilityContentMasterValue",
                {"unique_condition_id": "parseAt118", "strength": "parseAt113"}),
    },
}
# 官方枚举的最后一个值(补丁值必须紧接其后,不能占用官方以后可能用的号)。
OFFICIAL_LAST = {"instant_content": 723, "during_content": 421}


def _row(kind: str, trigger_mode: str, block: str, value: str) -> list[str]:
    layout = wf_describe.layout(kind)
    row = [""] * int(layout["ncols"])
    blocks = {name: int(index) for name, index in layout["blocks"].items()}
    row[blocks["precondition1"] - 1] = trigger_mode
    row[blocks[block]] = value
    return row


class ClientPatchKindTests(unittest.TestCase):
    def setUp(self):
        self.enum_map = wf_describe.enum_map()

    def test_registry_matches_the_enum_map_exactly(self):
        self.assertEqual(sorted(EXPECTED), sorted(CLIENT_PATCH_CONTENT_KINDS))
        for block, expected in EXPECTED.items():
            self.assertEqual(
                {value: capability for value, (_c, capability, _cls, _f) in expected.items()},
                CLIENT_PATCH_CONTENT_KINDS[block], block)
            for value, (ctor, capability, cls, fields) in expected.items():
                case = self.enum_map["cases"][block].get(value)
                self.assertIsNotNone(case, f"{block} {value} is missing from cases")
                self.assertEqual(ctor, case["ctor"])
                self.assertEqual(cls, case["cls"])
                self.assertEqual(fields, case["fields"])
                self.assertEqual(capability, case.get("requires_client_capability"))
                self.assertEqual(ctor, self.enum_map["enums"][cls][value])

    def test_no_official_kind_carries_a_capability_gate(self):
        """反向:除了这两条,`cases` 里不许再冒出别的 requires_client_capability。"""
        gated = []
        for block, cases in self.enum_map["cases"].items():
            for value, case in cases.items():
                if case.get("requires_client_capability"):
                    gated.append((block, value, case["requires_client_capability"]))
        self.assertEqual(
            sorted((block, value, capability)
                   for block, entries in EXPECTED.items()
                   for value, (_c, capability, _cls, _f) in entries.items()),
            sorted(gated))

    def test_each_patch_kind_sits_right_after_the_official_range(self):
        for block, expected in EXPECTED.items():
            cls = next(iter(expected.values()))[2]
            values = sorted(int(v) for v in self.enum_map["enums"][cls])
            official = [v for v in values if str(v) not in expected]
            self.assertEqual(OFFICIAL_LAST[block], max(official), block)
            for value in expected:
                self.assertEqual(OFFICIAL_LAST[block] + 1, int(value), block)

    def test_the_gate_reports_the_capability_for_the_parsed_block_only(self):
        # 瞬发行(mode 0)只读 instant_content
        row = _row("ability", "0", "instant_content", "724")
        self.assertEqual(["kyubi-fever-ratio-v1"], required_client_capabilities("ability", row))
        # 持续行(mode 1)只读 during_content
        row = _row("ability", "1", "during_content", "422")
        self.assertEqual(["dash-parameter-v1"], required_client_capabilities("ability", row))
        # 模式不匹配的残值不算数:持续行里的 c47=724 客户端根本不解析
        row = _row("ability", "1", "instant_content", "724")
        self.assertEqual([], required_client_capabilities("ability", row))
        row = _row("ability", "0", "during_content", "422")
        self.assertEqual([], required_client_capabilities("ability", row))
        # 开幕行(mode 2)两个块都不读
        for block, value in (("instant_content", "724"), ("during_content", "422")):
            self.assertEqual([], required_client_capabilities(
                "ability", _row("ability", "2", block, value)))

    def test_official_rows_need_no_capability(self):
        for block, value in (("instant_content", "213"), ("during_content", "421")):
            mode = "0" if block == "instant_content" else "1"
            self.assertEqual([], required_client_capabilities(
                "ability", _row("ability", mode, block, value)))

    def test_the_gate_works_on_every_layout_that_has_both_blocks(self):
        for kind in ("ability", "leader_ability", "ability_soul",
                     "equipment_enhancement_ability", "ex_ability"):
            blocks = wf_describe.layout(kind)["blocks"]
            if "instant_content" not in blocks or "during_content" not in blocks:
                continue
            row = [""] * int(wf_describe.layout(kind)["ncols"])
            row[int(blocks["precondition1"]) - 1] = "1"
            row[int(blocks["during_content"])] = "422"
            self.assertEqual(["dash-parameter-v1"], required_client_capabilities(kind, row), kind)

    def test_the_markdown_table_documents_both_kinds(self):
        text = TABLE_MD.read_text(encoding="utf-8")
        self.assertIn("| 724 | AddFeverPointRatio |", text)
        self.assertIn("kyubi-fever-ratio-v1", text)
        self.assertIn("| 422 | DashParameter |", text)
        self.assertIn("dash-parameter-v1", text)
        # 小节标题必须说清「官方 N 种 + 客户端补丁 1 种」,别让人以为是官方枚举
        self.assertIn("### 6.4 瞬发效果 instant_content(官方 724 种 + 客户端补丁 1 种)", text)
        self.assertIn("### 6.5 持续效果 during_content(官方 422 种 + 客户端补丁 1 种)", text)

    def test_the_dash_param_id_column_is_enforced_as_required(self):
        """422 借的是 unique_condition_id 列,「声明即必填」必须照样管得住它。"""
        from wf_client_legality import declared_block_field_problems
        blocks = {name: int(index) for name, index in
                  wf_describe.layout("ability")["blocks"].items()}
        row = _row("ability", "1", "during_content", "422")
        problems = declared_block_field_problems("ability", row)
        self.assertTrue(any("c118" in text for text in problems), problems)
        self.assertTrue(any("c113" in text for text in problems), problems)
        row[blocks["during_content"] + 9] = "0"        # param_id
        row[blocks["during_content"] + 4] = "-30000"   # strength SLv1
        row[blocks["during_content"] + 5] = "-30000"   # strength 满级
        self.assertEqual([], declared_block_field_problems("ability", row))


class PanelDescriptionOverrideGateTests(unittest.TestCase):
    """`custom_ability_string` 的 `desc_override_*` 行需要哪版面板覆盖补丁。

    与 724/422 不同,这里缺补丁**不会 C7050**:没打补丁的客户端根本不查这张键,
    行是惰性的,面板照旧走官方生成器。所以这组断言的意义是「别把已经发了数据、
    但真机上根本不生效的行当成已完成」—— ginovi 的 7 条覆盖行就是这么惰性了一轮。
    """

    def test_the_two_capability_names(self):
        self.assertEqual("desc_override_", PANEL_OVERRIDE_KEY_PREFIX)
        self.assertEqual("fox_oracle_autumn", PANEL_OVERRIDE_V1_STRING_ID_PREFIX)
        self.assertEqual("kyubi-panel-description-override-v1", PANEL_OVERRIDE_V1)
        self.assertEqual("panel-description-override-v2", PANEL_OVERRIDE_V2)
        self.assertEqual("custom_ability_string", CUSTOM_ABILITY_STRING_KIND)

    def test_fox_rows_still_report_v1(self):
        """V11 就能显示的行只要求 v1;V14 同时提供 v1/v2,所以两版都满足。"""
        for key in ("desc_override_fox_oracle_autumn",
                    "desc_override_fox_oracle_autumn_1",
                    "desc_override_fox_oracle_autumn_2",
                    "desc_override_fox_oracle_autumn_6"):
            self.assertEqual([PANEL_OVERRIDE_V1], required_client_capabilities(
                CUSTOM_ABILITY_STRING_KIND, [key, "文案"]), key)

    def test_every_other_override_row_needs_the_generalized_patch(self):
        """基诺维的 7 条(以及以后任何自制角色的)只有 V14 认。"""
        keys = ["desc_override_ginovi"] + [f"desc_override_ginovi_{n}" for n in range(1, 7)]
        self.assertEqual(7, len(keys))
        for key in keys + ["desc_override_gerald_1", "desc_override_seris_dragon_king",
                           "desc_override_null", "desc_override_"]:
            self.assertEqual([PANEL_OVERRIDE_V2], required_client_capabilities(
                CUSTOM_ABILITY_STRING_KIND, [key, "文案"]), key)

    def test_non_override_keys_need_nothing(self):
        """同一张表里的 629 描述键、PF 覆盖文案键不属于这条门禁。"""
        for key in ("ability_skill_fox_oracle_autumn_fever_pf",
                    "override_string_fox_oracle_autumn_dual_pf",
                    "override_string_ginovi_pf", "change_skill_ginovi",
                    "desc_overrid", "", "adesc_override_ginovi"):
            self.assertEqual([], required_client_capabilities(
                CUSTOM_ABILITY_STRING_KIND, [key, "文案"]), key)
        self.assertEqual([], required_client_capabilities(CUSTOM_ABILITY_STRING_KIND, []))

    def test_the_helper_and_the_gate_agree(self):
        for key in ("desc_override_fox_oracle_autumn_2", "desc_override_ginovi_3",
                    "override_string_ginovi_pf"):
            capability = panel_override_capability(key)
            self.assertEqual([capability] if capability else [],
                             required_client_capabilities(CUSTOM_ABILITY_STRING_KIND, [key]))

    def test_the_ability_gate_is_untouched_by_the_string_table_branch(self):
        """反向:词条行的判据不许因为多了这条分支而改变。"""
        row = _row("ability", "0", "instant_content", "724")
        self.assertEqual(["kyubi-fever-ratio-v1"], required_client_capabilities("ability", row))
        row = _row("ability", "0", "instant_content", "213")
        self.assertEqual([], required_client_capabilities("ability", row))


if __name__ == "__main__":
    unittest.main()
