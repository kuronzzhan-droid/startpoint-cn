"""Archive metadata for v34 O8–O12 r2; preserve source bytes unchanged."""

SHARED_SOURCE_SHA = "4a67d7aefeee19eadbd344c9f07af7cc089b154135d287ea35acad8611613497"


def method(id_, label, body, before, after, before_header, after_header=None, superseded_after=None):
    row = {"id": id_, "label": label, "body": body, "before": before,
           "after": after, "before_header": before_header,
           "after_header": after_header or before_header}
    if superseded_after:
        row["superseded_r1_after_sha256"] = superseded_after
    return row


SPECS = [
    {"number": 108, "upstream_number": 102, "id": "O8", "slug": "overlimit-owned-pedestal",
     "title": "像素小人改用持有角色的超限台座", "dependencies": [80, 81, 86], "source_revision": "r2",
     "behavior": "玩家持有角色且 player 非空时，把已取得的 GeneralCharacterLogic 换为 player.getOwnedCharacter(id)，让原有全身/半身台座虚调用使用持有角色的突破阶段。未持有、player 为空或 character 为 None 的原路径保留。只插入单方法 P-code，不追加主 ABC 常量池。",
     "caveat": "联机房间、排行榜里的同一角色也按玩家自己的持有角色突破状态显示；这是来源补丁明确列出的行为。",
     "methods": [method("O8", "PixelArtCharacter/getPedestalImagePath", 87354,
                        "7a286e705e1416d02a1d9dcbb811f80d238fe48976b8b1b0ab4cbb54888330ed",
                        "10eb1e21f915782bcd5715a3fb58670cb18737ae8a5f0f569781f774b1a48f0d",
                        [3, 4, 1, 2], [3, 5, 1, 2])]},
    {"number": 109, "upstream_number": 103, "id": "O9", "slug": "overlimit-paradox-core-gate",
     "title": "缺悖论之核时禁止确认超限", "dependencies": [84, 101], "revision": "r2", "source_revision": "r2",
     "revision_note": "在五星且 overLimitStep >= 4 条件后追加 get_maxOverLimitStep() > 4 能力门控。最大突破次数为 4 的普通五星保持原按钮状态路径。r1 已废弃；首发版本仍为 v34。",
     "behavior": "目标角色为五星、overLimitStep >= 4 且 get_maxOverLimitStep() > 4、悖论之核 10000302 持有量 <= 0 时，把传入原 getOverLimitState 的突破道具列表置空。原逻辑据此判定道具不足，禁用确认入口，避免零可突破次数被对话框抬成 count=1。只插入单方法 P-code，不追加主 ABC 常量池。",
     "caveat": "作者已取消零消耗方案；本条 109 与原归档 101 均保留。--without-O9 仅为历史诊断开关，不再是候选，也不是完整零核实现。",
     "methods": [method("O9", "OverLimitWindow/getOverLimitState", 73067,
                        "d39a4847f5adfd05c660a4bacd1ea2bad9b13bdabe8b72a72927fa9bbca7bc9b",
                        "ae683cc1f5574ac7b415c43cf779ea642535cd6a66531aa1ee51a150d1492068",
                        [2, 3, 1, 2], [4, 3, 1, 2],
                        superseded_after="28703c0dae17f7d2e4def4b6e5f3cc0b9183ea87dadcf392b4b9aa2f2469a126")]},
    {"number": 110, "upstream_number": 104, "id": "O10/O11", "slug": "overlimit-two-cost-slots",
     "title": "超限窗口显示超限结晶与悖论之核两个消耗框", "dependencies": [78, 101, 109], "revision": "r2", "source_revision": "r2",
     "revision_note": "O10/O11 都在五星且 overLimitStep >= 4 条件后追加 get_maxOverLimitStep() > 4。最大突破次数为 4 的普通五星不追加悖论之核格，保留原按钮/显示列表。r1 已废弃；首发版本仍为 v34。",
     "behavior": "两个方法取回本次新建的 getAwakingCrystalToOverLimit() 数组后，目标角色为五星、overLimitStep >= 4 且 get_maxOverLimitStep() > 4 时追加悖论之核 10000302。run 注册第二格的道具详情按钮；getStatusInformation 提供第二格持有量与显示数据。原生两格布局与按钮 33554432+itemId 分支继续使用；两种道具各显示持有数，0 个灰掉。只插入单方法 P-code，不追加主 ABC 常量池。",
     "caveat": "本条只改变显示与道具详情按钮注册。突破可否和可选次数仍由 101/109 决定；服务端扣除规则属于外部来源说明，本轮没有访问或验证服务器。",
     "methods": [method("O10", "OverLimitWindow/run", 73055,
                        "2787a647de463c9493d6347076db09a4b4417434174a9394f4e77c7352fbc14a",
                        "b96160fc0f1046a50cf78065ed8d907861a2a65fb13c4f365abad60cbd4b2a7e",
                        [11, 12, 1, 2],
                        superseded_after="d309b01594bb4e93464b089d9554ec5d5472a2439d1861e14e8c40dcdd4d5493"),
                 method("O11", "OverLimitWindow/getStatusInformation", 73065,
                        "5a3d0744321eb787d738b56df42059611df979f493b0c121fdc239ce491ad83d",
                        "c64d19bbf7957fd9490406d4d251abb9d1e16eeb3062e1b49148f56afbd29aa4",
                        [10, 7, 1, 2],
                        superseded_after="cf8cca3dcf9d4d27f7b49ce430953321752d9e5ed7b00fdd307954f40bfb8176")]},
    {"number": 111, "upstream_number": 105, "id": "O12", "slug": "overlimit-dialog-paradox-text",
     "title": "超限确认框文案包含悖论之核", "dependencies": [], "companions": [101, 109, 110], "revision": "r2", "source_revision": "r2",
     "revision_note": "在五星且 overLimitStep >= 4 条件后追加 get_maxOverLimitStep() > 4。最大突破次数为 4 的普通五星不查询/拼接悖论之核名称，保留原文案。r1 已废弃；首发版本仍为 v34。",
     "behavior": "目标角色为五星、overLimitStep >= 4 且 get_maxOverLimitStep() > 4 时，在原超限结晶 itemName 后拼接主 ABC 已有字符串「＋」与 globalLogic.getItem(10000302).get_name() 返回的悖论之核名称。只改变本次确认框模板的 itemName 参数，不改公共文案数据；普通突破保留原路径。只插入单方法 P-code，不追加主 ABC 常量池。",
     "caveat": "本条只改确认框显示文字，不改消耗数量、可否突破或服务端规则；与 101/109/110 配套。作者已取消零消耗方案，本条随双消耗方案保留；设备显示效果未核实。",
     "methods": [method("O12", "ExpodOverLimitByItemDialog/getDescription", 33543,
                        "479e1323bda6560e5033a2f4d303e2932412d19c39b340844ecfb9a2d46fbbec",
                        "a0468818a62ad753f0d18a755b29af19c61ebf5c3cd4a145c7a5a8cfc8a8be55",
                        [6, 2, 1, 2], [9, 2, 1, 2],
                        superseded_after="6e55a92902831e873f57f66e6725e751266466e45d903bad58a648ef409921fc")]},
]
