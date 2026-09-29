"""Editorial wiki sections, identified by character ID rather than species guesses.

The project's established 小动物 batch includes fifteen miniboss characters (also
robots, haniwa and spirits); the author requested that existing group separately.
Spheal joins it as a mascot. Beast-race playable people are ordinary characters.
"""
from __future__ import annotations

CATEGORIES = ("原创与改版", "毛茸异世界", "Boss角色", "小动物")
FURRY_WORLD_IDS = frozenset({"129999", "149999", "169999", "139990"})
EDITOR_NOTES = {
    "129999": "早期方案，后续将重做。此页保留当前已生效版本的数据。",
}

BOSS_GROUPS = (
    (frozenset({"119950", "129950", "139950", "149950", "159950", "169950"}),
     "荒龙六属性", "work/character_packs/discarded_dragon_water_playable/DESIGN.md"),
    (frozenset({"119951", "129951", "139951", "149951", "159951", "169951"}),
     "精灵兽六属性", "work/character_packs/spirit_beast_fire_playable/DESIGN.md"),
    (frozenset({"119970", "129970", "139970", "149970", "159970", "169970", "179970"}),
     "机兵七型", "work/character_packs/steam_robot_fire_playable/DESIGN.md"),
    (frozenset({"169994", "169980", "179981", "169995"}),
     "Rank P5b 四 Boss", "mod-tools/wf_enhancement_policy.py:RANK_P5B_BOSSES"),
    (frozenset({"179982", "179983", "179984", "179985", "179986"}),
     "歼灭者四型与噬龙者", "work/character_packs/<code>/evidence/source-report.json:wf.boss_source_locks/v1"),
    (frozenset({"149998"}), "风巨蜥", "mod-tools/docs/boss战与副本分析报告.md:boss_land_dragon_wind"),
)
BOSS_IDS = frozenset(cid for group, _label, _source in BOSS_GROUPS for cid in group)
SMALL_ANIMAL_IDS = frozenset({
    "129998", "139996", "129996", "149994", "159999", "129995", "149993", "119995",
    "149992", "129994", "119993", "129993", "169993", "149991", "119994", "129990",
})
SMALL_ANIMAL_NOTE = "沿用项目“小动物”十五角色批次，另含海豹球；该组也包括哈宁、机器人与幽魂。"


def category_for(cid: str) -> tuple[str, str]:
    cid = str(cid)
    if cid in FURRY_WORLD_IDS:
        return "毛茸异世界", "作者于 2026-09-29 本次 Wiki 请求明确指定：赛瑞斯、杰拉德、基诺维、凯尔。"
    if cid in SMALL_ANIMAL_IDS:
        source = ("work/character_packs/spheal-mascot-20260919/workspace.json" if cid == "129990"
                  else "mod-tools/wf_miniboss_roster.py:ROSTER;mod-tools/wf_balance_20260927_miniboss.py")
        return "小动物", source
    for group, _label, source in BOSS_GROUPS:
        if cid in group:
            return "Boss角色", source
    return "原创与改版", "新增、主题改版及改版官方的普通角色；不按 Beast 种族自动分类。"
