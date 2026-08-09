#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Build the unified 15-stage trial on the native Rush carrier.

The command is read-only unless ``--write`` is supplied.  All fifteen visible
rounds live in one Rush folder so the outer event banner opens the current
round directly.  Rounds 5/10/15 are display placeholders intercepted by the
minimal client patch and routed to their multiplayer-only AdventEvent quests.
"""
from __future__ import annotations

import argparse
import copy
import csv
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


MOD_DIR = Path(__file__).resolve().parent
TOOLS_DIR = MOD_DIR
DEFAULT_SERVER_ROOT = MOD_DIR.parent / "server"
sys.path.insert(0, str(TOOLS_DIR))

import wf_quest_lib as q  # noqa: E402
import wf_gui as gui  # noqa: E402
import wf_rogue_build as abyss  # noqa: E402
import wf_fantasy_shop as fantasy_shop  # noqa: E402
import wf_field_catalog as field_catalog  # noqa: E402
# Some shared helpers place their own directory at sys.path[0].  Restore this
# builder's directory so its paired trial-template implementation is always
# used (also matters when validating a staged upgrade before installation).
sys.path.insert(0, str(MOD_DIR))
import wf_boss_trial as boss_trial  # noqa: E402


RUSH_EVENT_ID = 700098
HIDDEN_DEEP_ABYSS_EVENT_ID = 700099
OLD_CARNIVAL_EVENT_ID = 250698
MULTI_EVENT_ID = 300098
FULL_CLEAR_TOKEN_ID = 2370097
DREAM_EMBLEM_ID = 99
MULTI_QUEST_SET_5_ID = 9000981
MULTI_QUEST_SET_10_ID = 9000982
LEGACY_HARD_MULTI_EVENT_ID = 100098
EVENT_FOLDER_ID = 2
TOKEN_ID = 2370098
SHOP_STOCK = fantasy_shop.STOCK

EVENT_NAME = "幻想连战"
EVENT_STRING_ID = "mod_fifteen_stage"
MODE15_UNLOCK_ID = "mod_fifteen_stage"
MODE15_UNLOCK_CONDITION_ID = "condition_mod_fifteen_stage"
MODE15_MAIN_BANNER = "quest/event/banner/rush_event/mod_fifteen_stage_banner_001"

SOLO_STAGES = (1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14)
MULTI_STAGES = (5, 10, 15)
MULTI_STAGE_NAMES = {
    5: "幻想连战·首战",
    10: "幻想连战·间战",
    15: "幻想连战·最终战",
}
ALL_STAGES = tuple(range(1, 16))
PRACTICE_ROUND = 16
BOSS_TOKEN_REWARDS = {5: 5, 10: 10, 15: 20}
# The client interprets battle_time_limit as 60 Hz frames, not seconds.
BATTLE_TIME_LIMIT_FRAMES = 30 * 60 * 60

RUSH_TEMPLATE_EVENT = "700007"
ADVENT_TEMPLATE_EVENT = "17"
TOKEN_TEMPLATE = "2370007"
SHOP_TEMPLATE = "310200"

# Initial enemy condition kinds used by both RushEvent and AdventEvent:
# 0 ability resistance, 1 direct-attack resistance, 2 power-flip resistance,
# 3 skill resistance, 4 debuff immunity. Negative values are vulnerabilities.
LEGACY_STAGE_CONFIGS = (
    {
        "stage": 1, "source": ("15", "1"), "boss": "水鬼斯拉姆冈",
        "title": "潮汐试炼·水鬼", "level": 20, "hp": 0.90, "atk": 0.85,
        "conditions": (),
    },
    {
        "stage": 2, "source": ("21", "1"), "boss": "雷龟普罗格雷奥",
        "title": "雷鸣试炼·雷龟", "level": 20, "hp": 1.00, "atk": 0.90,
        "conditions": ((1, 10), (3, -10)),
    },
    {
        "stage": 3, "source": ("19", "1"), "boss": "火魔奥尔塔尼亚",
        "title": "炎狱试炼·火魔", "level": 20, "hp": 1.15, "atk": 0.95,
        "conditions": ((3, 15), (2, -10)),
    },
    {
        "stage": 4, "source": ("4", "2"), "boss": "方舟守护者",
        "title": "方舟防线·守护者", "level": 20, "hp": 1.30, "atk": 1.00,
        "conditions": ((2, 15), (0, -10)),
    },
    {
        "stage": 5, "source": ("6", "5"), "boss": "伊萨巴迪卡",
        "title": "协力首领·炎荒龙", "level": 55, "hp": 1.40, "atk": 1.05,
        "conditions": ((0, 15),),
    },
    {
        "stage": 6, "source": ("16", "3"), "boss": "杰克南瓜灯",
        "title": "幻夜试炼·杰克", "level": 55, "hp": 1.20, "atk": 1.00,
        "conditions": ((1, 20), (3, -15)),
    },
    {
        "stage": 7, "source": ("200037", "1"), "boss": "黑龙",
        "title": "黯翼试炼·黑龙", "level": 55, "hp": 1.40, "atk": 1.05,
        "conditions": ((3, 20), (2, -15)),
    },
    {
        "stage": 8, "source": ("100003", "4"), "boss": "狂暴的罗梅罗",
        "title": "狂乱试炼·罗梅罗", "level": 55, "hp": 1.60, "atk": 1.10,
        "conditions": ((2, 20), (0, -15)),
    },
    {
        "stage": 9, "source": ("100006", "2"), "boss": "古拉托顿",
        "title": "饥渴试炼·古拉托顿", "level": 55, "hp": 1.80, "atk": 1.15,
        "conditions": ((0, 20), (1, 10), (3, -20)),
    },
    {
        "stage": 10, "source": ("200006", "3"), "boss": "比翼使魔·拳/魔",
        "title": "协力首领·比翼双魔", "level": 80, "hp": 2.00, "atk": 1.20,
        "conditions": ((4, None), (1, 20)),
    },
    {
        "stage": 11, "source": ("200080", "1"), "boss": "前鬼后鬼",
        "title": "鬼神试炼·前鬼后鬼", "level": 80, "hp": 1.80, "atk": 1.15,
        "conditions": ((3, 25), (1, -20)),
    },
    {
        "stage": 12, "source": ("200028", "1"), "boss": "噬星兽泰奥弗拉索斯",
        "title": "星蚀试炼·噬星兽", "level": 80, "hp": 2.10, "atk": 1.20,
        "conditions": ((2, 25), (0, -20)),
    },
    {
        "stage": 13, "source": ("200063", "1"), "boss": "统领AI",
        "title": "终端试炼·统领AI", "level": 80, "hp": 2.40, "atk": 1.25,
        "conditions": ((1, 25), (3, 15), (2, -25)),
    },
    {
        "stage": 14, "source": ("200068", "1"), "boss": "光之魔像",
        "title": "圣光试炼·光之魔像", "level": 80, "hp": 2.80, "atk": 1.35,
        "conditions": ((4, None), (0, 25), (2, 15), (1, -25)),
    },
    {
        "stage": 15, "source": ("100010", "4"), "boss": "始龙之眼",
        "title": "最终协力·始龙之眼", "level": 80, "hp": 1.0, "atk": 1.50,
        "conditions": ((4, None), (0, 20), (1, 20)),
    },
)

MODE15_ABYSS_PLAN_PATH = MOD_DIR / "mode15_abyss_plan.json"
MODE15_BASELINE_DIR = MOD_DIR / "baselines" / "mode15-unified-rush"
BOSS_TRIAL_CONFIG_PATH = MOD_DIR / "boss_trial_templates.json"
STAGE3_TRIAL_TEMPLATE_NAME = "fantasy-stage3-generic-trials"
STAGE5_TRIAL_TEMPLATE_NAME = "fantasy-stage5-fire-three-trials"
STAGE15_TRIAL_TEMPLATE_NAME = "fantasy-stage15-eye-native-four-phase-trials"
STAGE5_REGENERATION_DURATION_FRAMES = 9_999_999
STAGE5_REGENERATION_VALUE = 200


def load_mode15_abyss_plan(path: Path = MODE15_ABYSS_PLAN_PATH) -> dict:
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("schema_version") != 1:
        raise ValueError("fantasy rush plan schema_version must be 1")
    if plan.get("mode_id") != "fantasy-rush-15":
        raise ValueError("mode15 plan must remain isolated as fantasy-rush-15")
    if plan.get("rounds") != 15:
        raise ValueError("fantasy rush plan must contain exactly 15 rounds")

    rules = plan.get("rules")
    if not isinstance(rules, dict):
        raise ValueError("mode15 abyss plan rules are missing")
    if rules.get("solo_stages") != list(SOLO_STAGES):
        raise ValueError("mode15 solo stage schedule changed unexpectedly")
    if rules.get("multiplayer_stages") != list(MULTI_STAGES):
        raise ValueError("mode15 multiplayer stages must remain 5/10/15")
    if rules.get("allow_character_reuse") is not True:
        raise ValueError("test plan must keep character reuse enabled")

    stages = plan.get("stages")
    if not isinstance(stages, list) or len(stages) != 15:
        raise ValueError("mode15 abyss plan stages must be a 15-item list")
    expected_modes = {
        stage: ("multiplayer" if stage in MULTI_STAGES else "solo")
        for stage in range(1, 16)
    }
    for expected_stage, config in enumerate(stages, start=1):
        if config.get("stage") != expected_stage:
            raise ValueError("mode15 abyss stages must be ordered 1..15")
        if config.get("mode") != expected_modes[expected_stage]:
            raise ValueError(
                f"stage {expected_stage} carrier must be "
                f"{expected_modes[expected_stage]}"
            )
        conditions = config.get("conditions")
        if not isinstance(conditions, list) or len(conditions) > 5:
            raise ValueError(
                f"stage {expected_stage} has an invalid condition list"
            )
        config["source"] = tuple(str(value) for value in config["source"])
        config["conditions"] = tuple(
            (int(kind), None if strength is None else int(strength))
            for kind, strength in conditions
        )
        if expected_stage in MULTI_STAGES and any(
            strength is not None and strength < 0
            for _, strength in config["conditions"]
        ):
            raise ValueError(
                f"stage {expected_stage} must not carry permanent resistance-down conditions"
            )

    difficulty = plan.get("difficulty")
    if not isinstance(difficulty, dict):
        raise ValueError("mode15 abyss difficulty metadata is missing")
    preset = str(difficulty.get("preset"))
    if preset != "normalized-fantasy":
        raise ValueError("fantasy rush must use the normalized-fantasy preset")
    # ATK may follow the historical curve or a fixed multiplier by carrier
    # mode. HP cannot use a raw multiplier curve:
    # official Boss templates have radically different base HP. Each stage
    # records its audited base HP and target effective HP, and the stored
    # multiplier is verified as target/base.
    atk_model = difficulty.get("atk_model", "curve")
    try:
        if atk_model == "fixed-by-mode":
            solo_atk = float(difficulty["solo_atk"])
            multiplayer_atk = float(difficulty["multiplayer_atk"])
        elif atk_model == "curve":
            atk0 = float(difficulty["atk_start"])
            atk_end = float(difficulty["atk_end"])
            atk_growth = (atk_end / atk0) ** (1 / 14)
        elif atk_model == "per-stage":
            pass
        else:
            raise ValueError(f"unsupported ATK model: {atk_model}")
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("fantasy rush difficulty metadata is invalid") from exc
    for config in stages:
        stage = int(config["stage"])
        expected_atk = (
            multiplayer_atk if stage in MULTI_STAGES else solo_atk
        ) if atk_model == "fixed-by-mode" else (
            atk0 * atk_growth ** (stage - 1)
        ) if atk_model == "curve" else float(config["atk"])
        try:
            base_hp = float(config["audited_base_hp"])
            target_hp = float(config["target_effective_hp"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(
                f"stage {stage} normalized HP metadata is invalid"
            ) from exc
        if base_hp <= 0 or target_hp <= 0:
            raise ValueError(f"stage {stage} normalized HP must be positive")
        expected_hp = target_hp / base_hp
        hp_exempt = int(config["stage"]) in set(
            plan.get("rules", {}).get("hp_progression_exempt_stages", [])
        )
        if (
            not hp_exempt
            and not math.isclose(float(config["hp"]), expected_hp, rel_tol=5e-5)
        ):
            raise ValueError(f"stage {stage} HP multiplier is not target/base")
        if not math.isclose(float(config["atk"]), expected_atk, rel_tol=5e-4):
            raise ValueError(
                f"stage {stage} ATK does not match {atk_model}"
            )
        expected_mana = stage * 100000
        if int(config.get("mana_reward", -1)) != expected_mana:
            raise ValueError(f"stage {stage} mana reward must be {expected_mana}")
        expected_time = 108000 if stage <= 5 else 54000 if stage <= 10 else 43200
        if int(config.get("time_limit_frames", -1)) != expected_time:
            raise ValueError(f"stage {stage} time limit must be {expected_time} frames")
        if config.get("curse_tier") not in {
            "off", "standard", "advanced", "final"
        }:
            raise ValueError(f"stage {stage} has an invalid curse tier")
    stage1_direct_trial = rules.get("experimental_stage1_direct_trial") is True
    if stage1_direct_trial:
        first = stages[0]
        if (
            first.get("title") != "直击试炼·水鬼"
            or not math.isclose(float(first["hp"]), 95.558, rel_tol=1e-9)
            or first["conditions"] != ((0, 100), (2, 100), (3, 100))
        ):
            raise ValueError("stage 1 direct-trial experiment metadata is inconsistent")
    stage3_trial_buff = rules.get("experimental_stage3_trial_buff") is True
    if stage3_trial_buff:
        third = stages[2]
        if (
            not math.isclose(float(third["hp"]), 124.9828, rel_tol=1e-9)
            or not math.isclose(
                float(third["target_effective_hp"]), 300000, rel_tol=1e-9
            )
            or third["conditions"] != ()
        ):
            raise ValueError("stage 3 trial-buff experiment metadata is inconsistent")
    hp_progression_exempt_stages = rules.get(
        "hp_progression_exempt_stages", []
    )
    if (
        not isinstance(hp_progression_exempt_stages, list)
        or any(
            not isinstance(stage, int) or stage not in ALL_STAGES
            for stage in hp_progression_exempt_stages
        )
    ):
        raise ValueError(
            "hp_progression_exempt_stages must contain valid stage numbers"
        )
    hp_progression_exempt_stages = set(hp_progression_exempt_stages)
    for segment in ((1, 2, 3, 4), (6, 7, 8, 9), (11, 12, 13, 14)):
        checked_segment = tuple(
            stage for stage in segment
            if not (stage1_direct_trial and stage == 1)
            and not (stage3_trial_buff and stage == 3)
            and stage not in hp_progression_exempt_stages
        )
        targets = [
            float(stages[stage - 1]["target_effective_hp"])
            for stage in checked_segment
        ]
        if targets != sorted(targets) or len(set(targets)) != len(targets):
            raise ValueError(
                f"fantasy rush solo HP segment {segment} is not increasing"
            )
    for stage in MULTI_STAGES:
        if stage in hp_progression_exempt_stages:
            continue
        target = float(stages[stage - 1]["target_effective_hp"])
        previous = float(stages[stage - 2]["target_effective_hp"])
        if target <= previous:
            raise ValueError(
                f"multiplayer stage {stage} is not a Boss HP milestone"
            )
    if float(difficulty.get("atk_hard_ceiling", 0)) > 8:
        raise ValueError("mode15 attack hard ceiling may not exceed 8x")
    try:
        minion_hp_scale = float(rules["minion_hp_scale"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("fantasy rush minion_hp_scale is invalid") from exc
    if not 0 < minion_hp_scale <= 1:
        raise ValueError("fantasy rush minion_hp_scale must be in (0, 1]")
    return plan


MODE15_ABYSS_PLAN = load_mode15_abyss_plan()
STAGE_CONFIGS = tuple(MODE15_ABYSS_PLAN["stages"])
STAGE_BY_NUMBER = {config["stage"]: config for config in STAGE_CONFIGS}
BATTLE_TIME_LIMIT_FRAMES = int(
    MODE15_ABYSS_PLAN["rules"]["battle_time_limit_frames"]
)

START = "2000-01-01 12:00:00"
END = "2099-12-29 23:59:59"
BANNER_PHASE_3 = "2099-12-30 12:00:00"
EXCHANGE_END = "2099-12-31 11:59:59"

Q_RUSH_EVENT = "master/quest/event/rush_event.orderedmap"
Q_RUSH_FOLDER = "master/quest/event/rush_event_quest_folder.orderedmap"
Q_RUSH_QUEST = "master/quest/event/rush_event_quest.orderedmap"
Q_RUSH_CORRECTION = "master/quest/event/rush_event_battle_quest_correction.orderedmap"
Q_ADVENT_EVENT = "master/quest/event/advent_event.orderedmap"
Q_ADVENT_QUEST = "master/quest/event/advent_event_quest.orderedmap"
Q_EXPERT_SINGLE_QUEST = (
    "master/quest/event/expert_single_event_quest.orderedmap"
)
Q_MAIN_QUEST = "master/quest/main_quest.orderedmap"
Q_QUEST_SET = "master/quest/quest_set.orderedmap"
Q_HARD_EVENT = "master/quest/event/hard_multi_event.orderedmap"
Q_HARD_QUEST = "master/quest/event/hard_multi_event_quest.orderedmap"
Q_RANKING_QUEST = "master/quest/event/ranking_event_single_quest.orderedmap"
Q_EVENT_FOLDER = "master/quest/event/event_folder.orderedmap"
Q_EVENT_FOLDER_EVENTS = "master/quest/event/event_folder_events.orderedmap"
Q_EVENT_LIST = "master/quest/event/event_list.orderedmap"
Q_GAME_SYSTEM_UNLOCK = "master/game_system_unlock/game_system_unlock.orderedmap"
Q_GAME_SYSTEM_UNLOCK_CONDITION = (
    "master/game_system_unlock/game_system_unlock_condition.orderedmap"
)
Q_ITEM = "master/item/item.orderedmap"
Q_ADDITIONAL_REWARD = "master/reward/event/additional_reward.orderedmap"
Q_SHOP = "master/shop/event_item_shop.orderedmap"
Q_OLD_CARNIVAL_EVENT = "master/quest/event/carnival_event.orderedmap"
Q_OLD_CARNIVAL_FOLDER = "master/quest/event/carnival_event_quest_folder.orderedmap"
Q_OLD_CARNIVAL_QUEST = "master/quest/event/carnival_event_quest.orderedmap"
Q_FIELD_DATA = "master/battle/field_data.orderedmap"
Q_ZONE = "master/battle/zone.orderedmap"
Q_GENERAL_BOSS = "master/battle/boss/general_boss.orderedmap"
Q_GENERAL_BOSS_STATE = "master/battle/boss/general_boss_state.orderedmap"
Q_GENERAL_BOSS_VARIABLE = "master/battle/boss/general_boss_variable.orderedmap"
Q_BOSS_LEVEL = "master/battle/boss/boss_level.orderedmap"
Q_WIND_SPHERE = "master/battle/boss/wind_sphere.orderedmap"
Q_ACTION_SKILL = "master/skill/action_skill.orderedmap"
Q_ASSIST_YAKUMONO = "master/battle/assist/assist_yakumono.orderedmap"

STAGE3_SOURCE_BOSS = "spirit_beast_fire"
STAGE3_TRIAL_BOSS = "mod_mode15_trial_stage3"
STAGE3_TRIAL_FIELD = "mod_mode15_trial_stage3_field"
STAGE3_TRIAL_ZONE = "mod_mode15_trial_stage3_zone"
STAGE3_TRIAL_ROUTINE = "mod_mode15_trial_stage3"
STAGE3_DIRECT_HIT_TARGET = 80
STAGE3_POWER_FLIP_HIT_TARGET = 40
STAGE3_TRIAL_CLEAR_STATE = "mod_trial_clear1"
STAGE3_TRIAL_CLEAR2_STATE = "mod_trial_clear2"
STAGE3_PHASE2_GUARD_STATE = "mod_phase2_guard"
# .88 briefly published an invalid Queen-Laph-as-GeneralBoss experiment.
# Keep its identifier here only so the forward repair removes the stale rows
# from full master tables; the original kind=7 Queen remains untouched.
RETIRED_STAGE5_TRIAL_ID = "mod_mode15_trial_stage5_queen"
STAGE3_GUARD_PHASE1_ACTION = (
    "battle/action/enemy/action/mod_mode15_trial/"
    "mod_mode15_trial_stage3$guard_phase1"
)
STAGE3_CLEAR_PHASE1_ACTION = (
    "battle/action/enemy/action/mod_mode15_trial/"
    "mod_mode15_trial_stage3$clear_phase1"
)
STAGE3_GUARD_PHASE2_ACTION = (
    "battle/action/enemy/action/mod_mode15_trial/"
    "mod_mode15_trial_stage3$guard_phase2"
)
STAGE3_GUARD_CLEAR_ACTION = (
    "battle/action/enemy/action/mod_mode15_trial/"
    "mod_mode15_trial_stage3$guard_clear"
)
STAGE3_ACTION_LOGICALS = tuple(
    action + ".action.dsl.amf3.deflate"
    for action in (
        STAGE3_GUARD_PHASE1_ACTION,
        STAGE3_CLEAR_PHASE1_ACTION,
        STAGE3_GUARD_PHASE2_ACTION,
        STAGE3_GUARD_CLEAR_ACTION,
    )
)

STAGE3_TRIAL_TEMPLATE = boss_trial.load_template(
    BOSS_TRIAL_CONFIG_PATH, STAGE3_TRIAL_TEMPLATE_NAME
)
STAGE5_TRIAL_TEMPLATE = boss_trial.load_template(
    BOSS_TRIAL_CONFIG_PATH, STAGE5_TRIAL_TEMPLATE_NAME
)
STAGE15_TRIAL_TEMPLATE = boss_trial.load_template(
    BOSS_TRIAL_CONFIG_PATH, STAGE15_TRIAL_TEMPLATE_NAME
)

STAGE5_SOURCE_BOSS = STAGE5_TRIAL_TEMPLATE["source_boss"]
STAGE5_FIELD_BOSS = STAGE5_TRIAL_TEMPLATE["ids"]["boss"]
STAGE5_FIELD = STAGE5_TRIAL_TEMPLATE["ids"]["field"]
STAGE5_ZONE = STAGE5_TRIAL_TEMPLATE["ids"]["zone"]
STAGE5_TRIAL_ROUTINE = STAGE5_TRIAL_TEMPLATE["ids"]["routine"]
STAGE5_ACTION_LOGICALS = boss_trial.action_logicals(STAGE5_TRIAL_TEMPLATE)
STAGE5_NATIVE_FIELD = "advent_spirit_beast_fire_1"

STAGE15_SOURCE_BOSS = STAGE15_TRIAL_TEMPLATE["source_boss"]
STAGE15_FIELD_BOSS = STAGE15_TRIAL_TEMPLATE["ids"]["boss"]
STAGE15_FIELD = STAGE15_TRIAL_TEMPLATE["ids"]["field"]
STAGE15_ZONE = STAGE15_TRIAL_TEMPLATE["ids"]["zone"]
STAGE15_TRIAL_ROUTINE = STAGE15_TRIAL_TEMPLATE["ids"]["routine"]
STAGE15_ACTION_LOGICALS = boss_trial.action_logicals(STAGE15_TRIAL_TEMPLATE)
STAGE15_NATIVE_FIELD = "eye_dragon_multibattle"
STAGE15_NATIVE_SHIELD_ACTIONS = (
    "battle/action/enemy/action/boss_eye_dragon_multibattle/shields1",
    "battle/action/enemy/action/boss_eye_dragon_multibattle/big_shields1",
)
STAGE15_SHIELD_ACTIONS = (
    "battle/action/enemy/action/mod_mode15_trial/"
    "mod_mode15_trial_stage15_eye$shield_small",
    "battle/action/enemy/action/mod_mode15_trial/"
    "mod_mode15_trial_stage15_eye$shield_large",
)
# The native actions use fractions of boss maximum HP.  Against Stage 15's
# configured maximum HP, these ratios yield about 30/70 billion in the user's
# actual-value convention.
STAGE15_SHIELD_RATIOS = (0.033333, 0.077778)
STAGE15_SHIELD_LOGICALS = tuple(
    action + ".action.dsl.amf3.deflate" for action in STAGE15_SHIELD_ACTIONS
)

# Stage 10 uses the complete official Wind-Sphere ranking container.  This is
# the five-element ranking trial known in-game as 旋风试炼.  Its dedicated
# boss table owns the native 300/90-frame field transitions; do not convert it
# to GeneralBoss or splice only the boss name into an unrelated field.
STAGE10_NATIVE_EVENT = "200028"
STAGE10_NATIVE_QUEST = "5"
STAGE10_NATIVE_FIELD = "smr21_big_boss_multi"
STAGE10_NATIVE_ZONE = "smr21_big_boss_multi"
STAGE10_NATIVE_BOSSES = ("smr21_big_boss_multi",)
STAGE10_FIELD_ACTIONS = (
    "battle/action/enemy/action/boss_smr21_big_boss/"
    "boss_smr21_big_boss$difficulity10_ex3",
    "battle/action/enemy/action/boss_smr21_big_boss/"
    "boss_smr21_big_boss$difficulity10_continue1",
    "battle/action/enemy/action/boss_smr21_big_boss/"
    "boss_smr21_big_boss$difficulity10_continue2",
    "battle/action/enemy/action/boss_smr21_big_boss/"
    "boss_smr21_big_boss$difficulity10_ex4",
)
STAGE10_ACTION_LOGICALS = tuple(
    action + ".action.dsl.amf3.deflate" for action in STAGE10_FIELD_ACTIONS
)

# Keep the identifiers already published in .100 as a compatibility
# contract. Config mistakes then fail during a dry-run instead of silently
# changing client asset paths.
if STAGE3_TRIAL_TEMPLATE["source_boss"] != STAGE3_SOURCE_BOSS:
    raise ValueError("Boss trial template source_boss changed unexpectedly")
if STAGE3_TRIAL_TEMPLATE["ids"] != {
    "boss": STAGE3_TRIAL_BOSS,
    "field": STAGE3_TRIAL_FIELD,
    "zone": STAGE3_TRIAL_ZONE,
    "routine": STAGE3_TRIAL_ROUTINE,
}:
    raise ValueError("Boss trial template identifiers changed unexpectedly")
if boss_trial.action_logicals(STAGE3_TRIAL_TEMPLATE) != STAGE3_ACTION_LOGICALS:
    raise ValueError("Boss trial template action paths changed unexpectedly")
if STAGE5_TRIAL_TEMPLATE["target"] != {
    "advent_event_id": MULTI_EVENT_ID,
    "quest_no": 1,
}:
    raise ValueError("stage-5 trial target changed unexpectedly")
if STAGE5_TRIAL_TEMPLATE["source_boss"] != "spirit_beast_fire":
    raise ValueError("stage-5 trial must remain on the fire spirit-beast shell")
if [
    phase.get("trial", {}).get("kind")
    for phase in STAGE5_TRIAL_TEMPLATE["phases"]
] != ["direct_attack", "skill", "skill_chain"]:
    raise ValueError("stage-5 trial order must remain direct/skill/skill-chain")
if STAGE15_TRIAL_TEMPLATE["target"] != {
    "advent_event_id": MULTI_EVENT_ID,
    "quest_no": 3,
}:
    raise ValueError("stage-15 trial target changed unexpectedly")
if STAGE15_SOURCE_BOSS != "eye_dragon_multibattle_boss":
    raise ValueError("stage-15 trial must remain on the native Eye Dragon Boss")
if STAGE15_TRIAL_TEMPLATE.get("preserve_native_phases") is not True:
    raise ValueError("stage-15 trial must preserve the native four-phase graph")
if STAGE_BY_NUMBER[15]["source"] != ("100010", "4"):
    raise ValueError("stage-15 must use the official Eye Dragon Super quest")
if not math.isclose(
    float(STAGE_BY_NUMBER[15]["hp"]), 230.7692307692, rel_tol=1e-9
):
    raise ValueError("stage-15 Super source must remain normalized to 900e8 HP")
if [
    phase.get("trial", {}).get("kind")
    for phase in STAGE15_TRIAL_TEMPLATE["phases"]
] != ["power_flip", "direct_attack", "skill_chain"]:
    raise ValueError("stage-15 trial order must remain PF/direct/skill-chain")

PUBLISH_TABLES = (
    "rush_event",
    "rush_event_quest_folder",
    "rush_event_quest",
    "rush_event_correction",
    "advent_event",
    "advent_event_quest",
    "quest_set",
    "hard_multi_event",
    "hard_multi_event_quest",
    "event_folder",
    "event_folder_events",
    "event_list",
    "game_system_unlock",
    "game_system_unlock_condition",
    "item",
    "additional_reward",
    "event_item_shop",
    "carnival_event",
    "carnival_event_quest_folder",
    "carnival_event_quest",
    "field_data",
    "zone",
    "general_boss",
    "general_boss_state",
    "general_boss_variable",
    "boss_level",
    "action_skill",
    "assist_yakumono",
    *STAGE3_ACTION_LOGICALS,
    *STAGE5_ACTION_LOGICALS,
    *STAGE10_ACTION_LOGICALS,
    *STAGE15_ACTION_LOGICALS,
    *STAGE15_SHIELD_LOGICALS,
)


def cells(leaf: bytes | str) -> list[str]:
    text = leaf.decode("utf-8") if isinstance(leaf, bytes) else leaf
    return next(csv.reader(io.StringIO(text)))


def join(row: list[str], like: bytes | str) -> bytes | str:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="").writerow(row)
    text = buffer.getvalue()
    return text.encode("utf-8") if isinstance(like, bytes) else text


def clear_condition(row: list[str], base: int) -> None:
    row[base:base + 5] = ["(None)", "", "", "", "(None)"]


def set_condition(
    row: list[str],
    base: int,
    *,
    kind: int,
    event_id: int,
    quest_no: int,
    multiplied_id: int,
) -> None:
    row[base:base + 5] = [
        str(kind), str(event_id), "", str(quest_no), str(multiplied_id)
    ]


def number_text(value: float | int) -> str:
    return f"{value:g}"


def get_advent_source(table: dict, config: dict) -> bytes | str:
    event_id, quest_no = config["source"]
    try:
        leaf = table[event_id][quest_no]
    except KeyError as exc:
        raise KeyError(
            f"stage {config['stage']} source AdventEvent "
            f"{event_id}/{quest_no} is missing"
        ) from exc
    row = cells(leaf)
    if len(row) != 132:
        raise ValueError(
            f"stage {config['stage']} AdventEvent source has "
            f"{len(row)} columns, expected 132"
        )
    return leaf


SOURCE_TABLES = {
    "advent": (Q_ADVENT_QUEST, 115),
    "expert_single": (Q_EXPERT_SINGLE_QUEST, 112),
    "hard_multi": (Q_HARD_QUEST, 110),
    "main": (Q_MAIN_QUEST, 109),
    "ranking": (Q_RANKING_QUEST, 92),
}


def get_quest_source(advent_table: dict, config: dict) -> bytes | str:
    """Resolve a configured official quest from any supported carrier."""
    category = config.get("source_category", "advent")
    try:
        logical, _ = SOURCE_TABLES[category]
    except KeyError as exc:
        raise ValueError(
            f"stage {config['stage']} has unsupported source category {category}"
        ) from exc
    table = advent_table if category == "advent" else q.load_table(logical)
    node = table
    try:
        for key in config["source"]:
            node = node[str(key)]
    except (KeyError, TypeError) as exc:
        path = "/".join(config["source"])
        raise KeyError(
            f"stage {config['stage']} source {category}:{path} is missing"
        ) from exc
    if not isinstance(node, (bytes, str)):
        raise ValueError(f"stage {config['stage']} source is not a quest row")
    return node


def get_quest_source_profile(advent_table: dict, config: dict) -> dict:
    category = config.get("source_category", "advent")
    leaf = get_quest_source(advent_table, config)
    row = cells(leaf)
    field_index = SOURCE_TABLES[category][1]
    if len(row) <= field_index + 2:
        raise ValueError(
            f"stage {config['stage']} {category} source has only {len(row)} columns"
        )
    thumbnail = next(
        (value for value in row if "/thumbnail/" in value),
        row[3],
    )
    profile = {
        "category": category,
        "leaf": leaf,
        "row": row,
        "thumbnail": thumbnail,
        "element": row[field_index - 37],
        "element_sub": row[field_index - 36],
        "level": row[field_index - 3],
        "rank": row[field_index - 2],
        "power": row[field_index - 1],
        "field": row[field_index],
        "bgm": row[field_index + 1],
    }
    # Ranking quests use the short layout: recommended element is 24 columns
    # before field, followed by the native Bool flag.  Treating that Bool as
    # an element-sub value writes "0" into RushEventQuestValues' Bool column
    # and makes the Rush page fail immediately with C7101.
    if category == "ranking":
        profile["element"] = row[field_index - 24]
        profile["element_sub"] = row[field_index - 23]
    return profile


def set_enemy_conditions(
    row: list[str],
    *,
    first_kind_column: int,
    conditions: tuple[tuple[int, int | None], ...],
) -> None:
    if len(conditions) > 5:
        raise ValueError("a battle supports at most five initial enemy conditions")
    for slot in range(5):
        base = first_kind_column + slot * 2
        if slot >= len(conditions):
            row[base:base + 2] = ["(None)", ""]
            continue
        kind, strength = conditions[slot]
        row[base] = str(kind)
        row[base + 1] = "" if strength is None else str(strength)


def apply_rush_battle_config(
    row: list[str],
    source: dict,
    config: dict,
) -> None:
    # Thumbnail and element presentation are taken from the official boss.
    row[5] = source["thumbnail"]
    # This mode has no client score-reward group.  Inheriting the template's
    # group 10 makes QuestListDataTools resolve a missing key and throws C8601.
    row[68] = "(None)"
    row[69] = source["element"]
    row[70] = source["element_sub"]
    set_enemy_conditions(
        row,
        first_kind_column=71,
        conditions=config["conditions"],
    )
    row[81] = "1"
    # Preserve the mode's small ordinary clear rewards.
    row[82:86] = ["1", "100", str(config["mana_reward"]), "100"]
    hp = number_text(config["hp"])
    atk = number_text(config["atk"])
    minion_hp = number_text(
        float(config["hp"])
        * float(config.get(
            "minion_hp_scale",
            MODE15_ABYSS_PLAN["rules"]["minion_hp_scale"],
        ))
    )
    # Correction order is zako / funnel / boss.  Keep the audited boss HP and
    # lower only placed minions and dynamically summoned units.
    row[86:89] = [minion_hp, minion_hp, hp]
    row[89:92] = [atk, atk, atk]
    row[92:95] = ["1", "1", "1"]
    row[95] = str(config["level"])
    # Rush battle_quest_rank is also a master-map key rather than an enemy
    # level. Reuse the selected official boss template's valid rank key.
    row[96] = source["rank"]
    row[97] = source["power"]
    row[98] = source["field"]
    row[99] = source["bgm"]
    row[100] = str(config["time_limit_frames"])
    # A failed run resets to stage 1, so paid battle continuation is disabled.
    row[101] = "0"
    row[102] = "9999"


def apply_advent_battle_config(
    row: list[str], source: dict, config: dict
) -> None:
    row[3] = source["thumbnail"]
    row[78] = source["element"]
    row[79] = source["element_sub"]
    row[75] = "10"
    set_enemy_conditions(
        row,
        first_kind_column=80,
        conditions=config["conditions"],
    )
    row[99:103] = ["1", "100", str(config["mana_reward"]), "100"]
    hp = number_text(config["hp"])
    atk = number_text(config["atk"])
    minion_hp = number_text(
        float(config["hp"])
        * float(config.get(
            "minion_hp_scale",
            MODE15_ABYSS_PLAN["rules"]["minion_hp_scale"],
        ))
    )
    # AdventEventQuestValues maps these columns as zako / funnel / boss.
    row[103:106] = [minion_hp, minion_hp, hp]
    row[106:109] = [atk, atk, atk]
    row[109:112] = ["1", "1", "1"]
    row[112] = str(config["level"])
    # Column 113 is battle_quest_rank, not the enemy level. It is a foreign
    # key into the client's battle-quest-rank master map. Values such as 55
    # are valid enemy levels but are not valid rank keys and make random
    # recruitment notifications crash in getBattleQuestRankName() (C8601).
    row[113] = source["rank"]
    row[114] = source["power"]
    row[115] = source["field"]
    row[116] = source["bgm"]
    row[117] = str(config["time_limit_frames"])
    # Boss stages follow the same no-continue rule as solo stages.
    row[125] = "0"
    row[126] = "9999"


def build_rush_event(table: dict) -> bytes | str:
    template = table[RUSH_TEMPLATE_EVENT]
    row = cells(template)
    if len(row) != 18:
        raise ValueError(f"rush_event template has {len(row)} columns, expected 18")
    row[0] = f"{EVENT_STRING_ID}_rush"
    row[1] = EVENT_NAME
    # The three banner images use adjacent TimeRange windows. All four
    # boundaries must increase; repeating END crashes the client with C2044.
    row[2] = f"{START},{END},{BANNER_PHASE_3},{EXCHANGE_END}"
    # Keep all three native carousel phases on the dedicated Mode15 artwork.
    row[3] = ",".join([MODE15_MAIN_BANNER] * 3)
    row[10] = str(TOKEN_ID)
    row[15] = START
    row[16] = END
    row[17] = EXCHANGE_END
    return join(row, template)


def build_rush_folder_legacy(table: dict) -> dict[str, bytes | str]:
    template = table[RUSH_TEMPLATE_EVENT]["4"]
    row = cells(template)
    if len(row) != 37:
        raise ValueError(f"rush folder template has {len(row)} columns, expected 37")
    row[0] = "1"
    row[1] = "1"
    row[2] = EVENT_NAME
    row[3] = "(None)"
    row[4] = "quest/thumbnail/rush_event/combat_diver_07/combat_diver_07_1"
    row[5] = "quest/event/animation_background/rush_event/combat_diver_stadium_rush_background"
    # The complete 15-stage run grants the full-round reward. Boss-stage
    # currency remains a normal additional result reward and is not placed
    # here, otherwise the legacy client treats stages 5/10 as folder clears.
    for base in range(7, 37, 3):
        row[base:base + 3] = ["(None)", "", "(None)"]
    row[7:10] = ["0", str(DREAM_EMBLEM_ID), "200"]
    row[10:13] = ["0", str(FULL_CLEAR_TOKEN_ID), "1"]
    return {"1": join(row, template)}


def build_rush_folder(table: dict) -> dict[str, bytes | str]:
    regular_template = table[RUSH_TEMPLATE_EVENT]["3"]
    regular = cells(regular_template)
    if len(regular) != 37:
        raise ValueError("regular rush folder must have 37 columns")
    regular[0] = "1"
    regular[1] = "1"
    regular[2] = EVENT_NAME
    regular[3] = "(None)"
    regular[4] = "quest/thumbnail/rush_event/combat_diver_07/combat_diver_07_1"
    regular[5] = (
        "quest/event/animation_background/rush_event/"
        "combat_diver_stadium_rush_background"
    )
    for base in range(7, 37, 3):
        regular[base:base + 3] = ["(None)", "", "(None)"]
    regular[7:10] = ["0", str(DREAM_EMBLEM_ID), "200"]
    regular[10:13] = ["0", str(FULL_CLEAR_TOKEN_ID), "1"]

    # The stock Rush top always exposes its endless button.  A type-2 folder
    # is therefore required even when the custom 15-stage run itself is
    # finite; without it RushEventLogic.getEndlessFolderId throws C3442.
    endless_template = table[RUSH_TEMPLATE_EVENT]["4"]
    endless = cells(endless_template)
    if len(endless) != 37:
        raise ValueError("endless rush folder must have 37 columns")
    endless[0] = "100"
    endless[1] = "2"
    endless[2] = "练习模式（不计幻想连战进度）"
    endless[3] = "(None)"
    endless[4] = "quest/thumbnail/rush_event/combat_diver_07/combat_diver_07_8"
    endless[5] = (
        "quest/event/animation_background/rush_event/"
        "combat_diver_stadium_endless_background"
    )
    for base in range(7, 37, 3):
        endless[base:base + 3] = ["(None)", "", "(None)"]
    return {
        "1": join(regular, regular_template),
        "2": join(endless, endless_template),
    }


def _solo_source_rows(
    old_carnival_quests: dict,
    rush_quests: dict,
) -> list[bytes | str]:
    group = old_carnival_quests.get(str(OLD_CARNIVAL_EVENT_ID))
    if not isinstance(group, dict):
        group = rush_quests.get(str(RUSH_EVENT_ID))
    if not isinstance(group, dict):
        raise KeyError(
            f"neither the old Carnival carrier {OLD_CARNIVAL_EVENT_ID} nor "
            f"the Rush carrier {RUSH_EVENT_ID} contains 12 battle definitions"
        )
    rows = [group[str(index)] for index in range(1, 13)]
    if any(len(cells(row)) < 103 for row in rows):
        raise ValueError("existing Carnival battle row is too short")
    return rows


def build_rush_quests_legacy(
    rush_table: dict,
    old_carnival_quests: dict,
) -> dict[str, bytes | str]:
    template_first = rush_table[RUSH_TEMPLATE_EVENT]["1"]
    template_next = rush_table[RUSH_TEMPLATE_EVENT]["2"]
    old_rows = _solo_source_rows(old_carnival_quests, rush_table)
    result: dict[str, bytes | str] = {}

    for internal_no, (display_stage, old_leaf) in enumerate(
        zip(SOLO_STAGES, old_rows), start=1
    ):
        template = template_first if internal_no == 1 else template_next
        row = cells(template)
        old = cells(old_leaf)
        quest_id = RUSH_EVENT_ID * 1000 + internal_no
        row[0] = str(quest_id)
        row[1] = "1"
        row[2] = str(internal_no)
        row[3] = "(None)"
        row[4] = f"第{display_stage}关"
        row[5] = old[5]
        row[6] = "(None)"
        row[7] = START
        row[8] = END

        if internal_no == 1:
            for base in (9, 36):
                clear_condition(row, base)
        elif display_stage == 6:
            for base in (9, 36):
                set_condition(
                    row, base, kind=6, event_id=MULTI_EVENT_ID,
                    quest_no=1, multiplied_id=MULTI_EVENT_ID * 1000 + 1,
                )
        elif display_stage == 11:
            for base in (9, 36):
                set_condition(
                    row, base, kind=6, event_id=MULTI_EVENT_ID,
                    quest_no=2, multiplied_id=MULTI_EVENT_ID * 1000 + 2,
                )
        else:
            previous_id = RUSH_EVENT_ID * 1000 + internal_no - 1
            for base in (9, 36):
                set_condition(
                    row, base, kind=16, event_id=RUSH_EVENT_ID,
                    quest_no=internal_no - 1, multiplied_id=previous_id,
                )
        for base in (14, 41):
            clear_condition(row, base)

        # The common battle columns are compatible through battle_time_limit.
        # Rush's final two fields have different meanings and stay on the Rush
        # template to avoid malformed item/max-mana parsing.
        row[67:101] = old[67:101]
        row[82] = "1"
        row[83] = str((20, 55, 80)[(internal_no - 1) % 3])
        row[84] = str((2, 3, 4)[(internal_no - 1) % 3])
        row[85] = "1000"
        result[str(internal_no)] = join(row, template)

    return result


def build_rush_quests(
    rush_table: dict,
    old_carnival_quests: dict,
    advent_table: dict,
) -> dict[str, bytes | str]:
    template_first = rush_table[RUSH_TEMPLATE_EVENT]["1"]
    template_next = rush_table[RUSH_TEMPLATE_EVENT]["2"]
    # Detect a partial legacy deployment before rebuilding the carrier.
    _solo_source_rows(old_carnival_quests, rush_table)
    result: dict[str, bytes | str] = {}

    for internal_no, display_stage in enumerate(ALL_STAGES, start=1):
        config = STAGE_BY_NUMBER[display_stage]
        template = template_first if internal_no == 1 else template_next
        row = cells(template)
        if len(row) != 103:
            raise ValueError("rush_event_quest row must have 103 columns")
        source = get_quest_source_profile(advent_table, config)
        quest_id = RUSH_EVENT_ID * 1000 + internal_no
        row[0] = str(quest_id)
        row[1] = "1"
        row[2] = str(internal_no)
        row[3] = "(None)"
        row[4] = f"第{display_stage}关 {config['title']}"
        row[6] = "(None)"
        row[7] = START
        row[8] = END

        if internal_no == 1:
            for base in (9, 36):
                clear_condition(row, base)
        else:
            previous_id = RUSH_EVENT_ID * 1000 + internal_no - 1
            for base in (9, 36):
                set_condition(
                    row, base, kind=16, event_id=RUSH_EVENT_ID,
                    quest_no=internal_no - 1, multiplied_id=previous_id,
                )
        for base in (14, 41):
            clear_condition(row, base)

        apply_rush_battle_config(row, source, config)
        # Multiplayer placeholders never settle as Rush battles; their real
        # rewards come from AdventEvent.  Solo rounds keep the native cycle.
        if display_stage in MULTI_STAGES:
            row[82:86] = ["0", "0", "0", "0"]
        else:
            row[82] = "1"
            row[83] = str((20, 55, 80)[(internal_no - 1) % 3])
            row[84] = str(config["mana_reward"])
            row[85] = "1000"
        result[str(internal_no)] = join(row, template)

    practice_template = rush_table[RUSH_TEMPLATE_EVENT]["8"]
    practice = cells(practice_template)
    if len(practice) != 103:
        raise ValueError("endless practice quest must have 103 columns")
    practice_config = STAGE_BY_NUMBER[1]
    practice_source = get_quest_source_profile(advent_table, practice_config)
    practice[0] = str(RUSH_EVENT_ID * 1000 + PRACTICE_ROUND)
    # Rush quest rows reference the folder map key, not folderValues.id.
    # The endless safety folder is the second entry even though its value id is
    # 100; using 100 here leaves getViewableQuests empty and throws C3442.
    practice[1] = "2"
    practice[2] = "0"
    practice[3] = "(None)"
    practice[4] = "练习模式（不计幻想连战进度）"
    practice[6] = "(None)"
    practice[7] = START
    practice[8] = END
    for base in (9, 14, 36, 41):
        clear_condition(practice, base)
    apply_rush_battle_config(practice, practice_source, practice_config)
    practice[82:86] = ["0", "0", "0", "0"]
    result[str(PRACTICE_ROUND)] = join(practice, practice_template)
    return result


def build_advent_event(table: dict, hard_multi_events: dict) -> bytes | str:
    current = table.get(str(MULTI_EVENT_ID))
    template = current or table[ADVENT_TEMPLATE_EVENT]
    row = cells(template)
    if len(row) != 27:
        raise ValueError("advent_event row must have 27 columns")
    legacy = hard_multi_events.get(str(LEGACY_HARD_MULTI_EVENT_ID))
    legacy_row = cells(legacy) if legacy is not None else None
    row[0] = f"{EVENT_STRING_ID}_multi"
    row[1] = "(None)"
    row[2] = f"{EVENT_NAME}·协力挑战"
    row[3] = ""
    if legacy_row is not None:
        # Keep the current second banner/presentation until custom art arrives.
        row[4] = legacy_row[4]
        row[5] = legacy_row[5]
        row[6] = "1"
        row[7] = legacy_row[6]
        row[8] = legacy_row[7]
        row[14] = legacy_row[12]
    row[9] = "(None)"
    row[10] = ""
    row[11] = "3"
    row[12] = "(None)"
    row[13] = "36"
    row[15] = MODE15_UNLOCK_ID
    row[16] = "false"
    row[17] = str(TOKEN_ID)
    row[18:21] = ["(None)", "(None)", "(None)"]
    row[21] = "false"
    row[22] = "(None)"
    row[23] = "true"
    row[24] = START
    row[25] = END
    row[26] = EXCHANGE_END
    return join(row, template)


def build_advent_quests_legacy(table: dict) -> dict[str, bytes | str]:
    current_group = table.get(str(MULTI_EVENT_ID))
    result: dict[str, bytes | str] = {}
    solo_internal_nos = (4, 8, 12)

    for quest_no, (stage, solo_no) in enumerate(
        zip(MULTI_STAGES, solo_internal_nos), start=1
    ):
        if isinstance(current_group, dict) and str(quest_no) in current_group:
            template = current_group[str(quest_no)]
        else:
            template = table[ADVENT_TEMPLATE_EVENT][str(quest_no)]
        row = cells(template)
        if len(row) != 132:
            raise ValueError("advent_event_quest row must have 132 columns")
        quest_id = MULTI_EVENT_ID * 1000 + quest_no
        row[0] = str(quest_id)
        row[1] = f"第{stage}关"
        row[2] = f"{EVENT_NAME} 第{stage}关::quest_rank::"
        row[4] = "(None)"
        row[5] = START
        row[6] = END
        # AdventEvent uses kind/args/multiplied-id at 7..11 for viewability
        # and 36..40 for selectability.  Starting the latter at 37 leaves the
        # multiplied id in column 41, where the client expects another enum
        # constructor, and produces C7050.
        # The legacy initialize parser discards Rush runtime state on login,
        # so a cross-event Rush condition stays false until the player opens
        # the single-player page once.  Keep the first boss visible and chain
        # later bosses from the preceding Advent boss, whose host-clear
        # progress is part of the normal player save.  The server-side Mode15
        # gate remains authoritative and rejects a boss until its preceding
        # solo milestone has actually been cleared.
        for base in (7, 36):
            if quest_no == 1:
                clear_condition(row, base)
            else:
                previous_boss_no = quest_no - 1
                set_condition(
                    row, base, kind=6, event_id=MULTI_EVENT_ID,
                    quest_no=previous_boss_no,
                    multiplied_id=MULTI_EVENT_ID * 1000 + previous_boss_no,
                )
        for base in (12, 41):
            clear_condition(row, base)
        # Play kind 2 disables single play and keeps native room/matching.
        row[52] = "1"
        row[53] = "2"
        result[str(quest_no)] = join(row, template)
    return result


def build_advent_quests(table: dict) -> dict[str, bytes | str]:
    result: dict[str, bytes | str] = {}
    solo_internal_nos = (4, 8, 12)

    for quest_no, (stage, solo_no) in enumerate(
        zip(MULTI_STAGES, solo_internal_nos), start=1
    ):
        config = STAGE_BY_NUMBER[stage]
        source = get_quest_source_profile(table, config)
        if source["category"] == "advent":
            template = source["leaf"]
        else:
            # Non-Advent sources provide the battle field and presentation,
            # while an official Advent row supplies the 132-column room schema.
            template = table[ADVENT_TEMPLATE_EVENT][str(quest_no)]
        row = cells(template)
        quest_id = MULTI_EVENT_ID * 1000 + quest_no
        row[0] = str(quest_id)
        row[1] = f"第{stage}关 {config['title']}"
        row[2] = f"{EVENT_NAME} 第{stage}关 {config['boss']} :quest_rank::"
        row[4] = "(None)"
        row[5] = START
        row[6] = END
        # See the legacy builder above: normal Advent host-clear progress is
        row[1] = MULTI_STAGE_NAMES[stage]
        row[2] = MULTI_STAGE_NAMES[stage]
        # available on a cold client, while Rush runtime progress is not.
        for base in (7, 36):
            if quest_no == 1:
                clear_condition(row, base)
            else:
                previous_boss_no = quest_no - 1
                set_condition(
                    row, base, kind=6, event_id=MULTI_EVENT_ID,
                    quest_no=previous_boss_no,
                    multiplied_id=MULTI_EVENT_ID * 1000 + previous_boss_no,
                )
        for base in (12, 41):
            clear_condition(row, base)
        # Native Advent room presentation scans the viewable quest-set of
        # sibling quests to decide whether to show host-clear sub-progress.
        # A direct quest reference alone is not sufficient: without these
        # QuestSet rows the legacy client dereferences a missing master row
        # and reports F1009 while opening the multiplayer room.
        if quest_no == 1:
            row[17:19] = ["(None)", ""]
        else:
            row[17:19] = [
                str(
                    MULTI_QUEST_SET_5_ID
                    if quest_no == 2
                    else MULTI_QUEST_SET_10_ID
                ),
                "true",
            ]
        # Play kind 2 disables single play and keeps native rooms/matching.
        row[52] = "1"
        row[53] = "2"
        apply_advent_battle_config(row, source, config)
        result[str(quest_no)] = join(row, template)
    return result


def build_mode15_quest_sets(table: dict) -> dict:
    result = copy.deepcopy(table)
    template = next(iter(table.values()))
    result[str(MULTI_QUEST_SET_5_ID)] = join(
        [
            "mod_fifteen_stage_boss_5",
            "6",
            str(MULTI_EVENT_ID),
            "",
            "1",
            str(MULTI_EVENT_ID * 1000 + 1),
        ],
        template,
    )
    result[str(MULTI_QUEST_SET_10_ID)] = join(
        [
            "mod_fifteen_stage_boss_10",
            "6",
            str(MULTI_EVENT_ID),
            "",
            "2",
            str(MULTI_EVENT_ID * 1000 + 2),
        ],
        template,
    )
    return result


def build_event_folder(table: dict) -> bytes | str:
    template = table.get(str(EVENT_FOLDER_ID)) or table["1"]
    row = cells(template)
    row[:] = [
        EVENT_STRING_ID,
        MODE15_MAIN_BANNER,
        "quest/event/background/rush_event/combat_diver_01_background",
        "RushEvent",
        MODE15_UNLOCK_ID,
        "true",
        "900098",
    ]
    return join(row, template)


def build_event_folder_events(table: dict) -> dict[str, bytes | str]:
    source = table.get(str(EVENT_FOLDER_ID)) or table["1"]
    template = next(iter(source.values()))
    as_bytes = isinstance(template, bytes)
    like: bytes | str = b"" if as_bytes else ""
    # EventFolderLogic sorts by display order descending: Rush first.
    return {
        "1": join(["11", str(RUSH_EVENT_ID), "2"], like),
        "2": join(["0", str(MULTI_EVENT_ID), "1"], like),
    }


def build_game_system_unlock(table: dict) -> bytes | str:
    template = table.get(MODE15_UNLOCK_ID) or table["event"]
    row = cells(template)
    row[:] = [MODE15_UNLOCK_CONDITION_ID, "(None)", "(None)", "0"]
    return join(row, template)


def build_game_system_unlock_condition(table: dict) -> dict[str, bytes | str]:
    source = table.get(MODE15_UNLOCK_CONDITION_ID) or table["condition_event"]
    template = next(iter(source.values()))
    row = [
        "(None)", "", "", "", "(None)",
        "(None)", "", "", "", "(None)",
        "(None)", "", "", "", "(None)", "(None)",
    ]
    return {"1": join(row, template)}


def build_token(table: dict) -> bytes | str:
    if str(TOKEN_ID) in table:
        existing = cells(table[str(TOKEN_ID)])
        if existing[0] != f"{EVENT_STRING_ID}_token":
            raise ValueError(f"token ID {TOKEN_ID} is already occupied")
    template = table[TOKEN_TEMPLATE]
    row = cells(template)
    row[0] = f"{EVENT_STRING_ID}_token"
    row[1] = str(TOKEN_ID)
    row[2] = "幻想代币"
    row[5] = "在幻想连战的协力首领关卡中获得的专用代币。可在活动商店兑换后续新增奖励。"
    row[18] = "999999"
    row[19] = START
    row[20] = EXCHANGE_END
    return join(row, template)


def build_full_clear_token(table: dict) -> bytes | str:
    template = table[TOKEN_TEMPLATE]
    row = cells(template)
    row[0] = f"{EVENT_STRING_ID}_full_clear_token"
    row[1] = str(FULL_CLEAR_TOKEN_ID)
    row[2] = "究极图腾"
    row[3] = "item/item/mod/fantasy/fantasy_core_token"
    row[4] = "(None)"
    row[5] = "自幻想而生，被当成神崇拜的图腾"
    # Item category remains "material" (2).  The native inventory-card
    # background/border is controlled by item rarity at column 17; Dream
    # Emblem uses rarity 5.  It must not be painted into the icon bitmap.
    row[14] = "2"
    row[17] = "5"
    row[18] = "999999"
    row[19] = START
    row[20] = EXCHANGE_END
    return join(row, template)


def build_additional_rewards(table: dict) -> dict:
    built = copy.deepcopy(table)
    built["237009800"] = {
        "1": f"mode15_boss_token,0,{TOKEN_ID},1,1",
    }
    built["237009700"] = {
        "1": f"mode15_full_clear_emblem,0,{DREAM_EMBLEM_ID},1,1",
        "2": f"mode15_full_clear_token,0,{FULL_CLEAR_TOKEN_ID},1,1",
    }
    return built


def build_shop_product(
    table: dict,
    item_id: int,
    event_type: int,
    event_id: int,
) -> bytes | str:
    if str(item_id) in table:
        existing = cells(table[str(item_id)])
        if existing[1] not in {str(RUSH_EVENT_ID), str(MULTI_EVENT_ID)}:
            raise ValueError(f"shop ID {item_id} is already occupied")
    template = table[SHOP_TEMPLATE]
    row = cells(template)
    if len(row) != 51:
        raise ValueError("event item shop template must have 51 columns")
    fixed = {
        0: str(event_type),
        1: str(event_id),
        2: "0",
        7: "奖励内容待配置",
        8: str(item_id),
        9: "1",
        10: "1",
        11: "商店入口测试用占位商品。单人和多人入口共用99份总库存，后续将替换为自定义武器与资源。",
        13: "item/materials/event/rush_event/rush_event_item_01",
        14: "3",
        18: str(TOKEN_ID),
        19: "1",
        26: START,
        27: EXCHANGE_END,
        28: "0",
        29: str(SHOP_STOCK),
        30: str(SHOP_STOCK),
        31: "(None)",
        32: "0",
        33: "11001",
        34: "1",
        50: "false",
    }
    for index, value in fixed.items():
        row[index] = value
    return join(row, template)


def build_rush_correction(table: dict) -> dict:
    """Build the identity correction required by the native endless folder."""
    correction = copy.deepcopy(table)
    correction[str(RUSH_EVENT_ID)] = {
        "2": {
            str(PRACTICE_ROUND): {
                "1": "1,1,1,1,1,1,1,1,1",
            },
        },
    }
    correction.pop("700099", None)
    return correction


def _condition_range(value: float | int) -> list[dict[str, float | int]]:
    return [{"min": value, "max": value}]


def _create_boss_resistance(
    kind: str,
    strength: float = 0.99,
    *,
    linked_hit_trial: str | None = None,
    allow_retry: bool = False,
) -> list:
    """Build the protected-condition envelope used by Ilgrau.

    ``linked_hit_trial`` uses CreateCondition's native HitCountCheckTargetKind
    link.  The client then keeps the condition for exactly the lifetime of the
    matching trial and removes it when that trial is completed or replaced.
    This avoids routing condition removal through a visual Boss action slot,
    which ordinary attacks may also execute.
    """
    return [
        "Command",
        [
            "CreateCondition",
            -17,
            [[
                kind,
                _condition_range(99999999),
                _condition_range(strength),
                _condition_range(1),
            ]],
            _condition_range(1),
            ["None"],
            False,
            allow_retry,
            "",
            [linked_hit_trial] if linked_hit_trial is not None else None,
            False,
            3,
            _condition_range(1),
            False,
        ],
    ]


def _delete_boss_resistance(kind: str) -> list:
    return [
        "Command",
        [
            "DeleteCondition",
            -17,
            [kind, 2],
            99,
            1,
            "",
            ["Default"],
        ],
    ]


def _action_dsl(commands: list[list]) -> list:
    return [
        "ActionDsl", 1, ["None"],
        False, False, False, False, False, False, False, 0,
        ["Block", commands],
    ]


def build_stage3_trial_actions() -> dict[str, bytes]:
    """Build portable guards from the reusable Boss trial template."""
    return boss_trial.build_action_assets(STAGE3_TRIAL_TEMPLATE)


def _action_root_commands(tree: list) -> list:
    """Return an ActionDsl root Block's mutable command/event list."""
    if (
        not isinstance(tree, list)
        or len(tree) < 12
        or not isinstance(tree[-1], list)
        or len(tree[-1]) != 2
        or tree[-1][0] != "Block"
        or not isinstance(tree[-1][1], list)
    ):
        raise ValueError("action DSL has no native root Block")
    return tree[-1][1]


def _wait_then_start_modifier_field(
    frames: int,
    kinds: list,
    cancel_trigger: list,
) -> list:
    """Build the official Wind-Sphere safe-frame transition envelope."""
    return [
        "Event",
        [
            "Wait",
            frames,
            "*",
            [
                "Block",
                [[
                    "Command",
                    ["StartModifierField", 99999999, kinds, cancel_trigger],
                ]],
            ],
        ],
    ]


def build_stage5_field_actions() -> dict[str, bytes]:
    """Build stage-5 trials plus the official fixed-HP regeneration field."""
    built = boss_trial.build_action_assets(STAGE5_TRIAL_TEMPLATE)
    logical = (
        STAGE5_TRIAL_TEMPLATE["actions"]["guard"]
        + ".action.dsl.amf3.deflate"
    )
    if logical not in built:
        raise ValueError("stage-5 trial template guard action is missing")
    blob = built[logical]
    tree = field_catalog.parse_dsl(blob)
    root = _action_root_commands(tree)
    root.insert(
        0,
        [
            "Command",
            [
                "StartModifierField",
                STAGE5_REGENERATION_DURATION_FRAMES,
                [["Regeneration", STAGE5_REGENERATION_VALUE]],
                ["None"],
            ],
        ],
    )
    built[logical] = field_catalog.build_dsl(tree)
    return built


def build_stage15_trial_actions() -> dict[str, bytes]:
    """Build linked guards for the native four-phase Eye Dragon Boss."""
    return boss_trial.build_action_assets(STAGE15_TRIAL_TEMPLATE)


def build_stage15_shield_actions() -> dict[str, bytes]:
    """Clone Eye Dragon shields with Stage-15-only maximum-HP ratios."""
    built: dict[str, bytes] = {}

    for source, destination, ratio in zip(
        STAGE15_NATIVE_SHIELD_ACTIONS,
        STAGE15_SHIELD_ACTIONS,
        STAGE15_SHIELD_RATIOS,
        strict=True,
    ):
        source_logical = source + ".action.dsl.amf3.deflate"
        destination_logical = destination + ".action.dsl.amf3.deflate"
        tree = field_catalog.parse_dsl(q.store_path(source_logical).read_bytes())
        barriers: list[list] = []

        def collect(node) -> None:
            if isinstance(node, list):
                if node and node[0] == "CreateBarrier":
                    barriers.append(node)
                for child in node:
                    collect(child)
            elif isinstance(node, dict):
                for child in node.values():
                    collect(child)

        collect(tree)
        if len(barriers) != 1:
            raise ValueError(
                f"stage-15 shield source must contain one CreateBarrier: "
                f"{source_logical} has {len(barriers)}"
            )
        barrier = barriers[0]
        if (
            len(barrier) < 3
            or not isinstance(barrier[2], list)
            or len(barrier[2]) != 1
            or not isinstance(barrier[2][0], dict)
        ):
            raise ValueError(f"malformed CreateBarrier payload: {source_logical}")
        barrier[2][0]["min"] = ratio
        barrier[2][0]["max"] = ratio
        blob = field_catalog.build_dsl(tree)
        if field_catalog.parse_dsl(blob) != tree:
            raise RuntimeError(
                f"stage-15 shield action roundtrip failed: {destination_logical}"
            )
        built[destination_logical] = blob

    return built


def build_stage10_field_actions() -> dict[str, bytes]:
    """Retarget Theophrastus's native field actions for four HP phases.

    Each phase transition is routed through a different *native marker
    animation* and therefore a different enemy-action slot.  Do not attempt to
    count repeated ``ex3`` calls with battle conditions: GeneralBoss clears
    those carrier-local flags during its invincible phase hand-off.

    Native slot assignment:
      continue1-> opening and phase 4, native ComboBoost
      ex3      -> phase 2, Attack -5000% (20 ability-damage hits)
      continue2-> phase 3, Attack -5000% (300M power-flip damage)
      ex4      -> no-op (native field-completion callback)
    """
    # DamageToEnemy uses DamageOriginKind, whose client enum is:
    # 1=skill, 2=ability, 3=power flip, 4=direct attack.  Keep subtype 3 here;
    # subtype 4 renders and behaves as direct-attack damage.
    attack_down_ability = (
        ["Attack", -50.0],
        ["AbilityDamage", 20, ["TotalOfParty", []]],
    )
    attack_down_power_flip = (
        ["Attack", -50.0],
        ["DamageToEnemy", 300_000_000, 3],
    )
    combo = (["ComboBoost", 10], ["None"])
    built: dict[str, bytes] = {}

    def field_block(field) -> list:
        kind, cancel = field
        return [
            "Block",
            [["Command", ["StartModifierField", 99_999_999, [kind], cancel]]],
        ]

    for index, logical in enumerate(STAGE10_ACTION_LOGICALS):
        tree = field_catalog.parse_dsl(q.store_path(logical).read_bytes())
        root_commands = _action_root_commands(tree)
        field = (attack_down_ability, combo, attack_down_power_flip, None)[index]
        if index == 3:
            # Runtime verification shows the native modifier-field completion
            # callback is ex4 (not continue1).  Keep ex4 empty so completing
            # Either Attack-down field cannot overwrite the active field.
            root_commands[:] = []
        else:
            assert field is not None
            root_commands[:] = field_block(field)[1]
        blob = field_catalog.build_dsl(tree)
        if field_catalog.parse_dsl(blob) != tree:
            raise RuntimeError(f"stage-10 field action roundtrip failed: {logical}")
        built[logical] = blob
    return built


def configure_stage10_four_phase_boss(
    bosses: dict, boss_states: dict,
) -> None:
    """Expand the official two-phase smr21 multiplayer Boss to four phases.

    GeneralBossValues natively exposes subroutine_change2/3/4.  Each change
    record is exactly seven columns.  Reuse the official phase-2 routine for
    phases 3 and 4 so the Boss keeps its multiplayer-safe movement, attacks,
    invincibility hand-off, and network behaviour.
    """
    boss_node = bosses.get("smr21_big_boss_multi")
    if not isinstance(boss_node, dict) or "79" not in boss_node:
        raise ValueError("stage-10 smr21 multiplayer level-79 Boss is missing")
    row = cells(boss_node["79"])
    while len(row) <= 65:
        row.append("")
    phase_change = [
        "neutral1", "continue", "0.90", "1",
        "neutral1_2", "(None)", "(None)",
    ]
    row[45:52] = phase_change
    row[52:59] = [*phase_change[:2], "0.65", *phase_change[3:]]
    row[59:66] = [*phase_change[:2], "0.40", *phase_change[3:]]
    boss_node["79"] = join(row, boss_node["79"])

    routine = boss_states.get("smr21_big_boss_multi")
    if not isinstance(routine, dict) or not isinstance(routine.get("2"), dict):
        raise ValueError("stage-10 smr21 official phase-2 routine is missing")
    routine["3"] = copy.deepcopy(routine["2"])
    routine["4"] = copy.deepcopy(routine["2"])

    # The phase-1 neutral1 state is entered once at battle opening.  Route its
    # marker animation to continue1; ex4 must remain empty because the native
    # modifier-field controller calls it whenever a field is completed.
    opening_state = routine["1"].get("neutral1")
    if not isinstance(opening_state, str):
        raise ValueError("stage-10 phase-1 neutral1 state is missing")
    opening_cells = cells(opening_state)
    if len(opening_cells) != 53:
        raise ValueError("stage-10 phase-1 neutral1 schema changed")
    opening_cells[3] = "continue1"
    routine["1"]["neutral1"] = join(opening_cells, opening_state)

    # ``neutral1_2`` is the official invincibility hand-off state used by all
    # three subroutine changes.  Its marker animation (c3) fires the field
    # action.  Give phases 2, 3 and 4 distinct native marker sequences so they
    # cannot replay the opening HealRejection field.
    marker_by_phase = {
        "2": "neutral3",   # enemy_action33 -> ex3 -> Attack -2000%
        "3": "continue2",  # enemy_action39 -> continue2 -> SkillDamage -2000%
        "4": "continue1",  # enemy_action38 -> continue1 -> ComboBoost
    }
    for phase, marker_animation in marker_by_phase.items():
        state = routine[phase].get("neutral1_2")
        if not isinstance(state, str):
            raise ValueError(
                f"stage-10 phase {phase} neutral1_2 state is missing"
            )
        state_cells = cells(state)
        if len(state_cells) != 53:
            raise ValueError(
                f"stage-10 phase {phase} neutral1_2 schema changed"
            )
        state_cells[3] = marker_animation
        routine[phase]["neutral1_2"] = join(state_cells, state)


def _build_stage3_trial_actions_legacy() -> dict[str, bytes]:
    """Historical implementation retained for temporary output comparison."""
    phase1_resistances = (
        "ACAbilityDamageResistance",
        "ACPowerFlipDamageResistance",
        "ACSkillDamageResistance",
    )
    phase2_resistances = (
        "ACAbilityDamageResistance",
        "ACDirectAttackDamageResistance",
        "ACSkillDamageResistance",
    )
    phase2_retry_commands = [
        _create_boss_resistance(
            kind,
            linked_hit_trial="PowerFlip",
            allow_retry=True,
        )
        for kind in phase2_resistances
    ]
    phase1_commands = [
        _create_boss_resistance(kind, linked_hit_trial="DirectAttack")
        for kind in phase1_resistances
    ]
    # The phase-2 trial can start on a visual state that has no reliable
    # action marker across different Boss shells.  Register one generic retry
    # loop at spawn instead: attempts made during phase 1 are rejected by the
    # native PowerFlip trial link; once phase 2 exposes that trial, the next
    # tick applies the protected resistances.  `allow_retry` prevents a
    # rejected attempt from being memoized by ActionEvaluator.
    phase1_commands.append([
        "Event",
        [
            "Repeat", 30, 3600, "*",
            ["Block", phase2_retry_commands],
        ],
    ])
    phase1 = _action_dsl(phase1_commands)
    # Trial-linked conditions expire natively when their gauge reaches zero.
    # Keep the historical clear carriers as no-ops because their animation
    # slots are also used by ordinary attacks on some visual Boss shells.
    clear_phase1 = _action_dsl([])
    phase2 = _action_dsl(phase2_retry_commands)
    clear = _action_dsl([])
    trees = (phase1, clear_phase1, phase2, clear)
    assets = {
        logical: field_catalog.build_dsl(tree)
        for logical, tree in zip(STAGE3_ACTION_LOGICALS, trees)
    }
    for logical, blob in assets.items():
        if field_catalog.parse_dsl(blob) != trees[STAGE3_ACTION_LOGICALS.index(logical)]:
            raise ValueError(f"stage-3 action roundtrip failed: {logical}")
    return assets


def apply_stage3_trial_carrier(tables: dict[str, dict]) -> None:
    """Clone a Boss shell while keeping trial mechanics fully portable.

    The shell supplies only animation/attacks.  Protected resistances and
    their removal use isolated generic actions modelled on Ilgrau's official
    CreateCondition/DeleteCondition pair.
    """
    rush = tables[Q_RUSH_QUEST][str(RUSH_EVENT_ID)]
    stage3 = cells(rush["3"])
    source_field = stage3[98]

    field_data = tables[Q_FIELD_DATA]
    zones = tables[Q_ZONE]
    bosses = tables[Q_GENERAL_BOSS]
    boss_states = tables[Q_GENERAL_BOSS_STATE]
    boss_levels = tables[Q_BOSS_LEVEL]

    source_field_row = cells(field_data[source_field])
    source_zone = source_field_row[2]
    if not isinstance(zones.get(source_zone), dict):
        raise ValueError("stage-3 source field has no cloneable zone")
    if STAGE3_SOURCE_BOSS not in bosses:
        raise KeyError("stage-3 source boss is missing from general_boss")
    if STAGE3_SOURCE_BOSS not in boss_states:
        raise KeyError("stage-3 source routine is missing from general_boss_state")

    def clone_boss_node(node):
        if isinstance(node, dict):
            return {key: clone_boss_node(value) for key, value in node.items()}
        row = cells(node)
        while len(row) <= 58:
            row.append("")
        row[42] = STAGE3_TRIAL_ROUTINE
        row[43] = "neutral1_1"

        # Register both trial guards from pre_action.  Phase-2 protection is
        # retried through a generic Event/Repeat and therefore does not depend
        # on a Boss-specific animation action slot.
        row[109] = STAGE3_GUARD_PHASE1_ACTION

        # The stock fire boss is single-phase.  Its normal neutral entry is a
        # safe hand-off point for both added HP dividers.
        # GeneralBossValues constructs each phase from an exact seven-field
        # record.  Empty strings are accepted only for the optional phase-end
        # action; the phase kind and the two disabled reaction states must be
        # explicit.  Leaving those constructor arguments blank raises C7050
        # before any action DSL is loaded.
        row[45:52] = [
            STAGE3_PHASE2_GUARD_STATE, "(None)", "0.75", "0", "", "(None)", "(None)"
        ]
        row[52:59] = [
            "neutral1_1", "(None)", "0.5", "0", "", "(None)", "(None)"
        ]
        return join(row, node)

    bosses[STAGE3_TRIAL_BOSS] = clone_boss_node(bosses[STAGE3_SOURCE_BOSS])

    source_routine = boss_states[STAGE3_SOURCE_BOSS]
    if not isinstance(source_routine.get("1"), dict):
        raise ValueError("stage-3 source routine has no cloneable phase")
    cloned_routine = {
        str(phase): copy.deepcopy(source_routine["1"])
        for phase in (1, 2, 3)
    }
    post_suffix = "__mod_after_trial"

    def rewrite_next_phase(states: dict, next_state: str) -> None:
        for key, leaf in list(states.items()):
            row = cells(leaf)
            while len(row) <= 52:
                row.append("")
            row[14] = next_state
            states[key] = join(row, leaf)

    def attach_trial_to_active_chain(
        states: dict,
        *,
        trial_kind: int,
        hit_target: int,
        success_state: str,
    ) -> None:
        """Overlay a native hit trial without replacing boss behaviour.

        Native bosses repeat the trial descriptor on every active state in a
        phase.  Their normal animation, next-state and timeout columns remain
        intact, so phase-change invulnerability can finish normally and the
        boss continues attacking while the gauge is active.
        """
        for key, leaf in list(states.items()):
            row = cells(leaf)
            while len(row) <= 52:
                row.append("")
            row[22] = str(trial_kind)
            row[23] = str(hit_target)
            # Keep the native hit gauge but suppress its 3-count presentation.
            # This descriptor is repeated on every active state, so enabling
            # the countdown would restart the visible number on every action.
            row[24] = "false"
            row[25] = "true"
            row[26] = success_state
            states[key] = join(row, leaf)

    def build_post_trial_chain(states: dict) -> tuple[dict, dict[str, str]]:
        """Clone a phase's native loop without a trial descriptor.

        Trial success must not return to the original loop: those states all
        carry the hit-gauge descriptor and would immediately create a fresh
        trial.  The post-trial loop keeps the Boss's native behaviour while
        retaining row 14 as the real HP-divider hand-off to the next phase.
        """
        mapping = {key: f"{key}{post_suffix}" for key in states}
        result = {}
        for key, leaf in states.items():
            row = cells(copy.deepcopy(leaf))
            while len(row) <= 52:
                row.append("")
            row[0] = mapping[key]
            row[22:27] = ["(None)", "", "false", "false", "(None)"]
            for index, value in enumerate(row):
                if index not in {0, 14} and value in mapping:
                    row[index] = mapping[value]
            result[mapping[key]] = join(row, leaf)
        return result, mapping

    def build_action_carrier_chain(
        source_states: dict,
        templates: tuple[str, ...],
        names: tuple[str, ...],
        final_destination: str,
        *,
        next_phase_state: str = "neutral1_1",
    ) -> dict:
        """Keep a complete native animation chain for a generic field action."""
        if len(templates) != len(names):
            raise ValueError("stage-3 carrier template/name length mismatch")
        carrier_mapping = dict(zip(templates, names))
        result = {}
        for position, (template, name) in enumerate(zip(templates, names)):
            if template not in source_states:
                raise KeyError(f"stage-3 carrier state is missing: {template}")
            leaf = source_states[template]
            row = cells(copy.deepcopy(leaf))
            while len(row) <= 52:
                row.append("")
            row[0] = name
            row[14] = next_phase_state
            row[22:27] = ["(None)", "", "false", "false", "(None)"]
            for index, value in enumerate(row):
                if index in {0, 14}:
                    continue
                if value in carrier_mapping:
                    row[index] = carrier_mapping[value]
            # The final carrier must always settle in the non-trial loop.
            if position == len(templates) - 1:
                row[31] = final_destination
                row[40] = final_destination
                if row[41] not in {"", "(None)"}:
                    row[41] = final_destination
            result[name] = join(row, leaf)
        return result

    # Every phase-1 state must know where a threshold phase change starts.
    rewrite_next_phase(cloned_routine["1"], STAGE3_PHASE2_GUARD_STATE)
    phase1_post, phase1_post_mapping = build_post_trial_chain(
        cloned_routine["1"]
    )
    attach_trial_to_active_chain(
        cloned_routine["1"],
        trial_kind=0,
        hit_target=STAGE3_DIRECT_HIT_TARGET,
        success_state=STAGE3_TRIAL_CLEAR_STATE,
    )
    cloned_routine["1"].update(phase1_post)
    cloned_routine["1"].update(build_action_carrier_chain(
        source_routine["1"],
        (
            "shot_start1_1", "shot_charge1_1", "shot_fire_start1_1",
            "shot_fire_loop1_1", "shot_end1_1",
        ),
        (
            STAGE3_TRIAL_CLEAR_STATE, "mod_trial_clear1_charge",
            "mod_trial_clear1_fire_start", "mod_trial_clear1_fire_loop",
            "mod_trial_clear1_end",
        ),
        phase1_post_mapping["neutral1_1"],
        next_phase_state=STAGE3_PHASE2_GUARD_STATE,
    ))

    rewrite_next_phase(cloned_routine["2"], "neutral1_1")
    phase2_post, phase2_post_mapping = build_post_trial_chain(
        cloned_routine["2"]
    )
    attach_trial_to_active_chain(
        cloned_routine["2"],
        trial_kind=2,
        hit_target=STAGE3_POWER_FLIP_HIT_TARGET,
        success_state=STAGE3_TRIAL_CLEAR2_STATE,
    )
    cloned_routine["2"].update(phase2_post)
    cloned_routine["2"].update(build_action_carrier_chain(
        source_routine["1"],
        (
            "skill_start4_1", "skill_charge4_1", "skill_fire_start4_1",
            "skill_fire_loop4_1", "skill_end4_1",
        ),
        (
            STAGE3_TRIAL_CLEAR2_STATE, "mod_trial_clear2_charge",
            "mod_trial_clear2_fire_start", "mod_trial_clear2_fire_loop",
            "mod_trial_clear2_end",
        ),
        phase2_post_mapping["neutral1_1"],
    ))
    phase2_guard_chain = build_action_carrier_chain(
        source_routine["1"],
        (
            "skill_start2_1", "skill_charge2_1", "skill_fire_start2_1",
            "skill_fire_loop2_1", "skill_end2_1",
        ),
        (
            STAGE3_PHASE2_GUARD_STATE, "mod_phase2_guard_charge",
            "mod_phase2_guard_fire_start", "mod_phase2_guard_fire_loop",
            "mod_phase2_guard_end",
        ),
        "neutral1_1",
    )
    # The linked resistance action runs from this entry animation.  Register
    # the PowerFlip trial on the carrier itself so the trial already exists
    # when CreateCondition asks the client for its linked trial id.  The stock
    # Boss format repeats the same descriptor across every active state, so
    # continuing it into the normal phase-2 loop preserves one shared gauge.
    attach_trial_to_active_chain(
        phase2_guard_chain,
        trial_kind=2,
        hit_target=STAGE3_POWER_FLIP_HIT_TARGET,
        success_state=STAGE3_TRIAL_CLEAR2_STATE,
    )
    cloned_routine["2"].update(phase2_guard_chain)
    rewrite_next_phase(cloned_routine["3"], "(None)")
    boss_states[STAGE3_TRIAL_ROUTINE] = cloned_routine

    if STAGE3_SOURCE_BOSS in boss_levels:
        boss_levels[STAGE3_TRIAL_BOSS] = copy.deepcopy(
            boss_levels[STAGE3_SOURCE_BOSS]
        )

    cloned_zone = {}
    swapped = 0
    for wave, leaf in zones[source_zone].items():
        if isinstance(leaf, dict):
            raise ValueError("stage-3 source zone is unexpectedly nested")
        row = cells(leaf)
        before = list(row)
        abyss.apply_boss_swap(row, STAGE3_SOURCE_BOSS, STAGE3_TRIAL_BOSS)
        swapped += sum(
            1 for old, new in zip(before, row)
            if old == STAGE3_SOURCE_BOSS and new == STAGE3_TRIAL_BOSS
        )
        cloned_zone[wave] = join(row, leaf)
    if swapped == 0:
        raise ValueError("stage-3 trial clone did not replace a boss slot")
    zones[STAGE3_TRIAL_ZONE] = cloned_zone

    cloned_field_row = list(source_field_row)
    cloned_field_row[2] = STAGE3_TRIAL_ZONE
    field_data[STAGE3_TRIAL_FIELD] = join(
        cloned_field_row, field_data[source_field]
    )
    stage3[98] = STAGE3_TRIAL_FIELD
    rush["3"] = join(stage3, rush["3"])


def apply_configured_stage3_trial(tables: dict[str, dict]) -> dict[str, object]:
    """Apply the selected reusable Boss trial template to client tables."""
    return boss_trial.apply_template(
        rush_quests=tables[Q_RUSH_QUEST],
        field_data=tables[Q_FIELD_DATA],
        zones=tables[Q_ZONE],
        bosses=tables[Q_GENERAL_BOSS],
        boss_states=tables[Q_GENERAL_BOSS_STATE],
        boss_levels=tables[Q_BOSS_LEVEL],
        template=STAGE3_TRIAL_TEMPLATE,
    )


def apply_configured_stage5_trial(tables: dict[str, dict]) -> dict[str, object]:
    """Apply the reusable three-phase trial to the native fire-beast room."""
    result = boss_trial.apply_template(
        rush_quests=tables[Q_RUSH_QUEST],
        advent_quests=tables[Q_ADVENT_QUEST],
        field_data=tables[Q_FIELD_DATA],
        zones=tables[Q_ZONE],
        bosses=tables[Q_GENERAL_BOSS],
        boss_states=tables[Q_GENERAL_BOSS_STATE],
        boss_levels=tables[Q_BOSS_LEVEL],
        template=STAGE5_TRIAL_TEMPLATE,
    )

    # Rush round 5 is only the unified-list placeholder.  Point it at the
    # same isolated field so previews and a cold client never load a different
    # carrier than the real Advent multiplayer quest.
    rush_group = tables[Q_RUSH_QUEST][str(RUSH_EVENT_ID)]
    rush_row = cells(rush_group["5"])
    rush_row[98] = STAGE5_FIELD
    rush_group["5"] = join(rush_row, rush_group["5"])
    return result


def apply_configured_stage15_trial(tables: dict[str, dict]) -> dict[str, object]:
    """Overlay three trials without flattening Eye Dragon's four phases."""
    result = boss_trial.apply_native_phase_template(
        rush_quests=tables[Q_RUSH_QUEST],
        advent_quests=tables[Q_ADVENT_QUEST],
        field_data=tables[Q_FIELD_DATA],
        zones=tables[Q_ZONE],
        bosses=tables[Q_GENERAL_BOSS],
        boss_states=tables[Q_GENERAL_BOSS_STATE],
        boss_levels=tables[Q_BOSS_LEVEL],
        template=STAGE15_TRIAL_TEMPLATE,
    )

    # Redirect only the isolated Fantasy Gauntlet clone.  The native Eye
    # Dragon keeps its original 10%/30% barriers in every other mode.
    for variant, leaf in list(tables[Q_GENERAL_BOSS][STAGE15_FIELD_BOSS].items()):
        row = cells(leaf)
        if len(row) <= 136:
            raise ValueError(f"malformed stage-15 boss row: {variant}")
        if row[127] != STAGE15_NATIVE_SHIELD_ACTIONS[0]:
            raise ValueError(
                f"stage-15 small shield slot changed unexpectedly: {variant}"
            )
        if row[136] != STAGE15_NATIVE_SHIELD_ACTIONS[1]:
            raise ValueError(
                f"stage-15 large shield slot changed unexpectedly: {variant}"
            )
        row[127] = STAGE15_SHIELD_ACTIONS[0]
        row[136] = STAGE15_SHIELD_ACTIONS[1]
        tables[Q_GENERAL_BOSS][STAGE15_FIELD_BOSS][variant] = join(row, leaf)

    # Keep the unified Rush preview on the exact same isolated field as the
    # real Advent room.  The click still routes to multiplayer, while cold
    # clients cannot preview an unmodified Eye Dragon carrier.
    rush_group = tables[Q_RUSH_QUEST][str(RUSH_EVENT_ID)]
    rush_row = cells(rush_group["15"])
    rush_row[98] = STAGE15_FIELD
    rush_group["15"] = join(rush_row, rush_group["15"])
    return result


def stage3_trial_enabled() -> bool:
    return MODE15_ABYSS_PLAN["rules"].get(
        "experimental_stage3_trial_buff"
    ) is True


def configure_stage10_invoker_cutins(
    action_skills: dict, assist_yakumono: dict
) -> None:
    """Keep both mandatory NPC skills while disabling only their cut-in image.

    The Advent carrier lacks the story quest's dynamic 064-name preload.
    AssistYakumonoValues column 7 controls the cut-in image; clearing it skips
    only that presentation while preserving the action DSL, voice and effects.
    ActionSkillValues column 3 is ``unisonable`` and remains at its native value.
    """
    for skill_id in ("stella_chapter12_assist", "stella_copy_assist"):
        variants = action_skills.get(skill_id)
        if not isinstance(variants, dict):
            raise KeyError(f"missing stage-10 NPC action skill: {skill_id}")
        for variant, leaf in list(variants.items()):
            row = cells(leaf)
            if len(row) < 4:
                raise ValueError(f"malformed NPC action skill: {skill_id}/{variant}")
            row[3] = "true"
            variants[variant] = join(row, leaf)

        leaf = assist_yakumono.get(skill_id)
        if not isinstance(leaf, (str, bytes)):
            raise KeyError(f"missing stage-10 assist yakumono: {skill_id}")
        row = cells(leaf)
        if len(row) < 11:
            raise ValueError(f"malformed assist yakumono: {skill_id}")
        row[7] = "(None)"
        assist_yakumono[skill_id] = join(row, leaf)


def load_and_build_client_tables() -> dict[str, dict]:
    logicals = (
        Q_RUSH_EVENT, Q_RUSH_FOLDER, Q_RUSH_QUEST, Q_RUSH_CORRECTION,
        Q_ADVENT_EVENT, Q_ADVENT_QUEST, Q_RANKING_QUEST,
        Q_QUEST_SET,
        Q_HARD_EVENT, Q_HARD_QUEST,
        Q_EVENT_FOLDER, Q_EVENT_FOLDER_EVENTS, Q_EVENT_LIST,
        Q_GAME_SYSTEM_UNLOCK, Q_GAME_SYSTEM_UNLOCK_CONDITION,
        Q_ITEM, Q_ADDITIONAL_REWARD, Q_SHOP,
        Q_OLD_CARNIVAL_EVENT, Q_OLD_CARNIVAL_FOLDER, Q_OLD_CARNIVAL_QUEST,
        Q_FIELD_DATA, Q_ZONE, Q_GENERAL_BOSS, Q_GENERAL_BOSS_STATE,
        Q_GENERAL_BOSS_VARIABLE,
        Q_BOSS_LEVEL, Q_WIND_SPHERE, Q_ACTION_SKILL, Q_ASSIST_YAKUMONO,
    )
    tables = {logical: q.load_table(logical) for logical in logicals}

    # Remove every table row created by the invalid .88 carrier conversion.
    # The action assets are unreferenced after these rows disappear and may
    # safely remain in an older client cache.
    tables[Q_FIELD_DATA].pop(f"{RETIRED_STAGE5_TRIAL_ID}_field", None)
    tables[Q_ZONE].pop(f"{RETIRED_STAGE5_TRIAL_ID}_zone", None)
    tables[Q_GENERAL_BOSS].pop(RETIRED_STAGE5_TRIAL_ID, None)
    tables[Q_GENERAL_BOSS_STATE].pop(RETIRED_STAGE5_TRIAL_ID, None)
    tables[Q_BOSS_LEVEL].pop(RETIRED_STAGE5_TRIAL_ID, None)

    # The former Mode15 implementation overwrote EventFolder id 2 in the
    # target store.  Restore these two small tables from a pinned pre-Mode15
    # baseline before exposing Rush directly, otherwise both the old wrapper
    # and the new direct event_list entry appear at the same time.
    tables[Q_EVENT_FOLDER] = q.parse_node(
        (MODE15_BASELINE_DIR / "event_folder.orderedmap").read_bytes()
    )
    tables[Q_EVENT_FOLDER_EVENTS] = q.parse_node(
        (MODE15_BASELINE_DIR / "event_folder_events.orderedmap").read_bytes()
    )

    old_carnival_quests = tables[Q_OLD_CARNIVAL_QUEST]
    tables[Q_RUSH_EVENT][str(RUSH_EVENT_ID)] = build_rush_event(tables[Q_RUSH_EVENT])
    tables[Q_RUSH_FOLDER][str(RUSH_EVENT_ID)] = build_rush_folder(tables[Q_RUSH_FOLDER])
    tables[Q_RUSH_QUEST][str(RUSH_EVENT_ID)] = build_rush_quests(
        tables[Q_RUSH_QUEST], old_carnival_quests, tables[Q_ADVENT_QUEST]
    )
    tables[Q_ADVENT_EVENT][str(MULTI_EVENT_ID)] = build_advent_event(
        tables[Q_ADVENT_EVENT], tables[Q_HARD_EVENT]
    )
    tables[Q_ADVENT_QUEST][str(MULTI_EVENT_ID)] = build_advent_quests(
        tables[Q_ADVENT_QUEST]
    )
    tables[Q_QUEST_SET] = build_mode15_quest_sets(tables[Q_QUEST_SET])
    tables[Q_HARD_EVENT].pop(str(LEGACY_HARD_MULTI_EVENT_ID), None)
    tables[Q_HARD_QUEST].pop(str(LEGACY_HARD_MULTI_EVENT_ID), None)
    tables[Q_GAME_SYSTEM_UNLOCK][MODE15_UNLOCK_ID] = build_game_system_unlock(
        tables[Q_GAME_SYSTEM_UNLOCK]
    )
    tables[Q_GAME_SYSTEM_UNLOCK_CONDITION][MODE15_UNLOCK_CONDITION_ID] = (
        build_game_system_unlock_condition(tables[Q_GAME_SYSTEM_UNLOCK_CONDITION])
    )
    tables[Q_ITEM][str(TOKEN_ID)] = build_token(tables[Q_ITEM])
    tables[Q_ITEM][str(FULL_CLEAR_TOKEN_ID)] = build_full_clear_token(tables[Q_ITEM])
    tables[Q_ADDITIONAL_REWARD] = build_additional_rewards(
        tables[Q_ADDITIONAL_REWARD]
    )
    tables[Q_SHOP] = fantasy_shop.build_client_shop(tables[Q_SHOP])
    tables[Q_RUSH_CORRECTION] = build_rush_correction(tables[Q_RUSH_CORRECTION])
    configure_stage10_invoker_cutins(
        tables[Q_ACTION_SKILL], tables[Q_ASSIST_YAKUMONO]
    )
    configure_stage10_four_phase_boss(
        tables[Q_GENERAL_BOSS], tables[Q_GENERAL_BOSS_STATE]
    )
    if stage3_trial_enabled():
        apply_configured_stage3_trial(tables)
    apply_configured_stage5_trial(tables)
    apply_configured_stage15_trial(tables)

    # Expose Rush itself in the outer event list.  Do not wrap it in an
    # EventFolder: that wrapper creates the three tabs and separate banners.
    tables[Q_EVENT_LIST].pop("750098", None)
    tables[Q_EVENT_LIST].pop(str(MULTI_EVENT_ID), None)
    # Deep Abyss is a separate mode and is intentionally hidden for now.
    # Keep its quest/shop/progress data intact; remove only its outer banner.
    tables[Q_EVENT_LIST].pop(str(HIDDEN_DEEP_ABYSS_EVENT_ID), None)
    event_list_template = tables[Q_EVENT_LIST][RUSH_TEMPLATE_EVENT]
    tables[Q_EVENT_LIST][str(RUSH_EVENT_ID)] = join(
        ["11", str(RUSH_EVENT_ID), "900098"], event_list_template
    )

    # Remove the retired Carnival carrier after its battle definitions have
    # been copied into the Rush rows.
    tables[Q_OLD_CARNIVAL_EVENT].pop(str(OLD_CARNIVAL_EVENT_ID), None)
    tables[Q_OLD_CARNIVAL_FOLDER].pop(str(OLD_CARNIVAL_EVENT_ID), None)
    tables[Q_OLD_CARNIVAL_QUEST].pop(str(OLD_CARNIVAL_EVENT_ID), None)
    return tables


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def build_server_assets(server_root: Path) -> dict[Path, object]:
    carnival_path = server_root / "assets" / "carnival_event_quest.json"
    carnival_scores_path = server_root / "assets" / "carnival_event_quest_scores.json"
    rush_path = server_root / "assets" / "rush_event_quest.json"
    rush_folder_path = server_root / "assets" / "rush_event_quest_folder.json"
    advent_path = server_root / "assets" / "advent_event_quest.json"
    hard_path = server_root / "assets" / "hard_multi_event_quest.json"
    item_ids_path = server_root / "assets" / "item_ids.json"
    shop_path = server_root / "assets" / "event_item_shop.json"
    shop_map_path = server_root / "assets" / "event_item_shop_id_map.json"

    carnival = _read_json(carnival_path)
    carnival_scores = _read_json(carnival_scores_path)
    rush = _read_json(rush_path)
    rush_folders = _read_json(rush_folder_path)
    advent = _read_json(advent_path)
    hard = _read_json(hard_path)
    item_ids = _read_json(item_ids_path)
    shop = _read_json(shop_path)
    shop_map = _read_json(shop_map_path)

    old_entries = []
    for internal_no in range(1, 13):
        old_id = str(OLD_CARNIVAL_EVENT_ID * 1000 + internal_no)
        new_id = str(RUSH_EVENT_ID * 1000 + internal_no)
        entry = carnival.get(old_id) or rush.get(new_id)
        if not isinstance(entry, dict):
            raise KeyError(f"missing server source quest {old_id}/{new_id}")
        old_entries.append(copy.deepcopy(entry))

    for internal_no, display_stage in enumerate(ALL_STAGES, start=1):
        quest_id = str(RUSH_EVENT_ID * 1000 + internal_no)
        old_entry = old_entries[(internal_no - 1) % len(old_entries)]
        entry = copy.deepcopy(old_entry)
        entry["name"] = f"{EVENT_NAME} 第{display_stage}关::quest_rank::"
        entry.pop("clearRewardId", None)
        entry.pop("scoreRewardGroupId", None)
        config = STAGE_BY_NUMBER[display_stage]
        entry["name"] = (
            f"{EVENT_NAME} 第{display_stage}关 {config['boss']} :quest_rank::"
        )
        entry.update({
            "manaReward": config["mana_reward"],
            "rushEventId": RUSH_EVENT_ID,
            "rushEventFolderId": 1,
            "rushEventRound": internal_no,
        })
        rush[quest_id] = entry

    practice_id = str(RUSH_EVENT_ID * 1000 + PRACTICE_ROUND)
    practice = copy.deepcopy(old_entries[0])
    practice["name"] = "练习模式（不计幻想连战进度）"
    practice.pop("clearRewardId", None)
    practice.pop("scoreRewardGroupId", None)
    practice.update({
        "rankPointReward": 0,
        "characterExpReward": 0,
        "manaReward": 0,
        "poolExpReward": 0,
        "rushEventId": RUSH_EVENT_ID,
        "rushEventFolderId": 2,
        "rushEventRound": 0,
    })
    rush[practice_id] = practice
    rush_folders[str(RUSH_EVENT_ID)] = {
        "1": [
            {"type": 0, "id": DREAM_EMBLEM_ID, "count": 200},
            {"type": 0, "id": FULL_CLEAR_TOKEN_ID, "count": 1},
        ],
        "2": [],
    }

    advent_templates = tuple(
        str(int(STAGE_BY_NUMBER[stage]["source"][0]) * 1000
            + int(STAGE_BY_NUMBER[stage]["source"][1]))
        for stage in MULTI_STAGES
    )
    for quest_no, (stage, template_id) in enumerate(
        zip(MULTI_STAGES, advent_templates), start=1
    ):
        quest_id = str(MULTI_EVENT_ID * 1000 + quest_no)
        source = advent.get(quest_id) or advent[template_id]
        entry = copy.deepcopy(source)
        entry["name"] = f"{EVENT_NAME} 第{stage}关::quest_rank::"
        entry.pop("clearRewardId", None)
        entry.pop("scoreRewardGroupId", None)
        entry.pop("sPlusRewardId", None)
        config = STAGE_BY_NUMBER[stage]
        entry["name"] = (
            f"{EVENT_NAME} 第{stage}关 {config['boss']} :quest_rank::"
        )
        entry.update({
            "rankPointReward": 1,
            "characterExpReward": 100,
            "manaReward": config["mana_reward"],
            "poolExpReward": 100,
        })
        entry["name"] = MULTI_STAGE_NAMES[stage]
        advent[quest_id] = entry

    for quest_no in range(1, len(MULTI_STAGES) + 1):
        hard.pop(str(LEGACY_HARD_MULTI_EVENT_ID * 1000 + quest_no), None)

    for internal_no in range(1, 13):
        old_id = str(OLD_CARNIVAL_EVENT_ID * 1000 + internal_no)
        carnival.pop(old_id, None)
        carnival_scores.pop(old_id, None)

    numeric_item_ids = {int(value) for value in item_ids}
    numeric_item_ids.add(TOKEN_ID)
    numeric_item_ids.add(FULL_CLEAR_TOKEN_ID)
    item_ids = sorted(numeric_item_ids)

    # Client EventItemShopValues uses constructor kind 6 for RushEvent, while
    # the shop API identifies the same event family as event_type 11.
    # Keep those two protocol enums separate.
    shop, shop_map = fantasy_shop.build_server_shop(shop, shop_map)

    return {
        carnival_path: carnival,
        carnival_scores_path: carnival_scores,
        rush_path: rush,
        rush_folder_path: rush_folders,
        advent_path: advent,
        hard_path: hard,
        item_ids_path: item_ids,
        shop_path: shop,
        shop_map_path: shop_map,
    }


def _backup(path: Path, suffix: str) -> None:
    if path.is_file():
        stamp = time.strftime("%Y%m%d-%H%M%S")
        shutil.copy2(path, path.with_name(f"{path.name}.{suffix}-{stamp}"))


def _write_json_atomic(path: Path, value: object) -> None:
    _backup(path, "bak-mode15-rush")
    fd, temporary_name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def validate(
    client_tables: dict[str, dict],
    server_assets: dict[Path, object],
    server_root: Path,
) -> None:
    rush_quests = client_tables[Q_RUSH_QUEST][str(RUSH_EVENT_ID)]
    if list(rush_quests) != [str(i) for i in range(1, PRACTICE_ROUND + 1)]:
        raise ValueError("Rush table must contain 15 run stages plus one practice quest")
    rush_folders = client_tables[Q_RUSH_FOLDER][str(RUSH_EVENT_ID)]
    if list(rush_folders) != ["1", "2"]:
        raise ValueError("Rush must contain one finite folder and one endless safety folder")
    endless_folder = cells(rush_folders["2"])
    if endless_folder[0:2] != ["100", "2"]:
        raise ValueError("Rush endless safety folder is malformed")
    practice = cells(rush_quests[str(PRACTICE_ROUND)])
    if practice[1:3] != ["2", "0"]:
        raise ValueError("Rush endless practice quest is malformed")
    advent_quests = client_tables[Q_ADVENT_QUEST][str(MULTI_EVENT_ID)]
    if list(advent_quests) != ["1", "2", "3"]:
        raise ValueError("AdventEvent boss quests are not exactly 1..3")
    if any(cells(row)[53] != "2" for row in advent_quests.values()):
        raise ValueError("AdventEvent boss quest is not multiplayer-only")
    quest_sets = client_tables[Q_QUEST_SET]
    if str(MULTI_QUEST_SET_5_ID) not in quest_sets:
        raise ValueError("Mode15 QuestSet for boss 5 is missing")
    if str(MULTI_QUEST_SET_10_ID) not in quest_sets:
        raise ValueError("Mode15 QuestSet for boss 10 is missing")
    if cells(advent_quests["2"])[17:19] != [
        str(MULTI_QUEST_SET_5_ID),
        "true",
    ]:
        raise ValueError("boss 10 viewable QuestSet reference is wrong")
    if cells(advent_quests["3"])[17:19] != [
        str(MULTI_QUEST_SET_10_ID),
        "true",
    ]:
        raise ValueError("boss 15 viewable QuestSet reference is wrong")
    configured_fields: list[str] = []
    for internal_no, stage in enumerate(ALL_STAGES, start=1):
        config = STAGE_BY_NUMBER[stage]
        row = cells(rush_quests[str(internal_no)])
        source = get_quest_source_profile(
            client_tables[Q_ADVENT_QUEST], config
        )
        expected_field = (
            STAGE3_TRIAL_FIELD
            if stage == 3 and stage3_trial_enabled()
            else STAGE5_FIELD
            if stage == 5
            else STAGE15_FIELD
            if stage == 15
            else source["field"]
        )
        if row[98] != expected_field or row[99] != source["bgm"]:
            raise ValueError(f"stage {stage} did not inherit its boss field/BGM")
        if row[95] != str(config["level"]):
            raise ValueError(f"stage {stage} enemy level is wrong")
        if row[96] not in {str(value) for value in range(1, 9)}:
            raise ValueError(
                f"stage {stage} battle quest rank key would cause C8601"
            )
        if row[68] != "(None)":
            raise ValueError(f"stage {stage} references an unavailable score reward group")
        if row[101] != "0":
            raise ValueError(f"stage {stage} must disable battle continuation")
        if stage in MULTI_STAGES:
            if row[82:86] != ["0", "0", "0", "0"]:
                raise ValueError(f"stage {stage} Rush placeholder rewards are wrong")
        elif row[82] != "1" or row[84] != str(config["mana_reward"]):
            raise ValueError(f"stage {stage} Rush ordinary mana reward is wrong")
        if row[100] != str(config["time_limit_frames"]):
            raise ValueError(f"stage {stage} Rush time limit is wrong")
        expected_hp = number_text(config["hp"])
        expected_minion_hp = number_text(
            float(config["hp"])
            * float(config.get(
                "minion_hp_scale",
                MODE15_ABYSS_PLAN["rules"]["minion_hp_scale"],
            ))
        )
        expected_atk = number_text(config["atk"])
        if row[86:89] != [expected_minion_hp, expected_minion_hp, expected_hp] or row[89:92] != [expected_atk] * 3:
            raise ValueError(f"stage {stage} Rush HP/ATK correction is wrong")
        expected_conditions = [""] * 10
        set_enemy_conditions(
            expected_conditions,
            first_kind_column=0,
            conditions=config["conditions"],
        )
        if row[71:81] != expected_conditions:
            raise ValueError(f"stage {stage} initial enemy conditions are wrong")
        # Multiplayer rounds keep a Rush-side display placeholder, but their
        # actual battle field comes from the Advent quest below.  Count only
        # real playable fields here so a generic trial field applied to an
        # Advent boss does not look like an extra sixteenth stage.
        if stage not in MULTI_STAGES:
            configured_fields.append(row[98])
    for quest_no, stage in enumerate(MULTI_STAGES, start=1):
        config = STAGE_BY_NUMBER[stage]
        row = cells(advent_quests[str(quest_no)])
        if row[36:41] != row[7:12]:
            raise ValueError(f"stage {stage} Advent selectable condition is wrong")
        expected_visibility = [""] * 5
        if quest_no == 1:
            clear_condition(expected_visibility, 0)
        else:
            previous_boss_no = quest_no - 1
            set_condition(
                expected_visibility,
                0,
                kind=6,
                event_id=MULTI_EVENT_ID,
                quest_no=previous_boss_no,
                multiplied_id=MULTI_EVENT_ID * 1000 + previous_boss_no,
            )
        if row[7:12] != expected_visibility:
            raise ValueError(
                f"stage {stage} Advent cold-start visibility chain is wrong"
            )
        valid_reference_kinds = {"(None)", *(str(value) for value in range(20))}
        # Column 17 is viewable_need_quest_set (an integer ID), not a
        # QuestReferenceIdKind constructor.
        for column in (7, 12, 22, 27, 36, 41):
            if row[column] not in valid_reference_kinds:
                raise ValueError(
                    f"stage {stage} Advent column {column} would cause C7050"
                )
        if row[52] not in {"0", "1"} or row[56] not in {"0", "1"}:
            raise ValueError(f"stage {stage} Advent battle kind would cause C7050")
        if row[61] not in {"(None)", "0", "1"}:
            raise ValueError(f"stage {stage} Advent item mode would cause C7050")
        for column in (80, 82, 84, 86, 88):
            if row[column] not in {"(None)", "0", "1", "2", "3", "4"}:
                raise ValueError(
                    f"stage {stage} Advent enemy condition would cause C7050"
                )
        expected_hp = number_text(config["hp"])
        expected_minion_hp = number_text(
            float(config["hp"])
            * float(config.get(
                "minion_hp_scale",
                MODE15_ABYSS_PLAN["rules"]["minion_hp_scale"],
            ))
        )
        expected_atk = number_text(config["atk"])
        if row[103:106] != [expected_minion_hp, expected_minion_hp, expected_hp] or row[106:109] != [expected_atk] * 3:
            raise ValueError(f"stage {stage} Advent HP/ATK correction is wrong")
        if row[112] != str(config["level"]):
            raise ValueError(f"stage {stage} enemy level is wrong")
        if row[113] not in {str(value) for value in range(1, 9)}:
            raise ValueError(
                f"stage {stage} battle quest rank key would cause C8601"
            )
        if row[125] != "0":
            raise ValueError(f"stage {stage} must disable battle continuation")
        if row[99:103] != [
            "1", "100", str(config["mana_reward"]), "100"
        ]:
            raise ValueError(f"stage {stage} Advent ordinary rewards are wrong")
        if row[117] != str(config["time_limit_frames"]):
            raise ValueError(f"stage {stage} Advent time limit is wrong")
        expected_conditions = [""] * 10
        set_enemy_conditions(
            expected_conditions,
            first_kind_column=0,
            conditions=config["conditions"],
        )
        if row[80:90] != expected_conditions:
            raise ValueError(f"stage {stage} initial enemy conditions are wrong")
        configured_fields.append(row[115])
    if len(configured_fields) != 15 or len(set(configured_fields)) != 15:
        # Twelve Rush single-player fields plus three Advent multiplayer
        # fields form the fifteen actual playable stages.  Rush-side entries
        # for stages 5/10/15 are display placeholders and are not counted.
        raise ValueError("the unified lineup must contain 15 distinct boss fields")
    for skill_id in ("stella_chapter12_assist", "stella_copy_assist"):
        variants = client_tables[Q_ACTION_SKILL].get(skill_id)
        if not isinstance(variants, dict) or not variants:
            raise ValueError(f"stage-10 NPC skill is missing: {skill_id}")
        if any(cells(leaf)[3] != "true" for leaf in variants.values()):
            raise ValueError(f"stage-10 NPC unisonable flag is not native: {skill_id}")
        assist_row = cells(client_tables[Q_ASSIST_YAKUMONO][skill_id])
        if assist_row[7] != "(None)":
            raise ValueError(f"stage-10 NPC assist cut-in is still enabled: {skill_id}")
    event_list_row = cells(client_tables[Q_EVENT_LIST][str(RUSH_EVENT_ID)])
    if event_list_row[:2] != ["11", str(RUSH_EVENT_ID)]:
        raise ValueError("Rush is not exposed directly in event_list")
    if str(HIDDEN_DEEP_ABYSS_EVENT_ID) in client_tables[Q_EVENT_LIST]:
        raise ValueError("hidden Deep Abyss entry was reintroduced")
    if str(EVENT_FOLDER_ID) in client_tables[Q_EVENT_FOLDER]:
        raise ValueError("legacy Mode15 EventFolder wrapper still exists")
    if str(EVENT_FOLDER_ID) in client_tables[Q_EVENT_FOLDER_EVENTS]:
        raise ValueError("legacy Mode15 EventFolder child list still exists")
    if str(LEGACY_HARD_MULTI_EVENT_ID) in client_tables[Q_HARD_EVENT]:
        raise ValueError("legacy HardMulti carrier still exists")
    if str(OLD_CARNIVAL_EVENT_ID) in client_tables[Q_OLD_CARNIVAL_EVENT]:
        raise ValueError("retired Carnival carrier still exists")
    if str(TOKEN_ID) not in client_tables[Q_ITEM]:
        raise ValueError("custom token is missing")
    if any(key in client_tables[Q_SHOP] for key in fantasy_shop.PLACEHOLDER_IDS):
        raise ValueError("placeholder shop product still exists")
    if any(key not in client_tables[Q_SHOP] for key in fantasy_shop.ALL_SHOP_IDS):
        raise ValueError("formal Fantasy Rush shop product is missing")
    stage5_row = cells(client_tables[Q_ADVENT_QUEST][str(MULTI_EVENT_ID)]["1"])
    if stage5_row[115] != STAGE5_FIELD:
        raise ValueError("stage-5 Advent quest does not use the isolated fire-beast field")
    rush_stage5_row = cells(client_tables[Q_RUSH_QUEST][str(RUSH_EVENT_ID)]["5"])
    if rush_stage5_row[98] != STAGE5_FIELD:
        raise ValueError("stage-5 Rush placeholder does not use the fire-beast field")
    if STAGE5_FIELD not in client_tables[Q_FIELD_DATA]:
        raise ValueError("stage-5 fire-beast field clone is missing")
    if STAGE5_ZONE not in client_tables[Q_ZONE]:
        raise ValueError("stage-5 fire-beast zone clone is missing")
    if STAGE5_FIELD_BOSS not in client_tables[Q_GENERAL_BOSS]:
        raise ValueError("stage-5 fire-beast Boss clone is missing")
    stage5_zone_values = [
        value
        for leaf in client_tables[Q_ZONE][STAGE5_ZONE].values()
        for value in cells(leaf)
    ]
    if STAGE5_FIELD_BOSS not in stage5_zone_values:
        raise ValueError("stage-5 fire-beast zone does not contain the trial Boss")
    if STAGE5_SOURCE_BOSS in stage5_zone_values:
        raise ValueError("stage-5 fire-beast source Boss was not isolated")
    stage5_field_row = cells(client_tables[Q_FIELD_DATA][STAGE5_FIELD])
    source_fire_field_row = cells(client_tables[Q_FIELD_DATA][STAGE5_NATIVE_FIELD])
    if stage5_field_row[:2] != source_fire_field_row[:2]:
        raise ValueError(
            "stage-5 field no longer carries the official fire-beast multiplayer terrain"
        )
    if stage5_field_row[2] != STAGE5_ZONE:
        raise ValueError("stage-5 fire-beast field does not point to its cloned zone")
    for variant, leaf in client_tables[Q_GENERAL_BOSS][STAGE5_FIELD_BOSS].items():
        row = cells(leaf)
        if row[42] != STAGE5_TRIAL_ROUTINE or row[43] != "neutral1_1":
            raise ValueError(
                f"stage-5 fire-beast routine is incomplete: {variant}"
            )
        if row[45:52] != [
            "mod_stage5_phase2_handoff", "(None)", "0.7", "1",
            "mod_stage5_phase2_handoff__wait3", "(None)", "(None)",
        ] or row[52:59] != [
            "mod_stage5_phase3_handoff", "(None)", "0.4", "1",
            "mod_stage5_phase3_handoff__wait3", "(None)", "(None)",
        ]:
            raise ValueError(
                f"stage-5 fire-beast phase thresholds are incomplete: {variant}"
            )
        if row[109] != STAGE5_TRIAL_TEMPLATE["actions"]["guard"]:
            raise ValueError(f"stage-5 fire-beast guard action is missing: {variant}")
        if STAGE5_TRIAL_TEMPLATE["phase_reentry_action_slots"] != [124, 123]:
            raise ValueError(
                "stage-5 phase reentry must follow Fire Beast skill2/skill3 "
                "carrier slots 124/123"
            )
        phase_reentry = STAGE5_TRIAL_TEMPLATE["actions"]["phase_reentry"]
        for slot in STAGE5_TRIAL_TEMPLATE["phase_reentry_action_slots"]:
            if phase_reentry not in row[int(slot)].split(","):
                raise ValueError(
                    f"stage-5 phase reentry action is missing: {variant}/{slot}"
                )
    stage5_routine = client_tables[Q_GENERAL_BOSS_STATE].get(STAGE5_TRIAL_ROUTINE)
    if not isinstance(stage5_routine, dict) or not all(
        isinstance(stage5_routine.get(key), dict) for key in ("1", "2", "3")
    ):
        raise ValueError("stage-5 fire-beast routine is not three-phase")
    for phase, phase_config, destination in (
        (
            "2", STAGE5_TRIAL_TEMPLATE["phases"][0],
            "mod_stage5_phase2_guard",
        ),
        (
            "3", STAGE5_TRIAL_TEMPLATE["phases"][1],
            "mod_stage5_phase3_guard",
        ),
    ):
        timer_states = boss_trial.transition_handoff_states(
            phase_config["transition_handoff"]
        )
        for timer_index, (handoff, frames) in enumerate(timer_states):
            if handoff not in stage5_routine[phase]:
                raise ValueError(
                    f"stage-5 phase {phase} transition handoff is missing: {handoff}"
                )
            next_state = (
                timer_states[timer_index + 1][0]
                if timer_index + 1 < len(timer_states)
                else destination
            )
            handoff_row = cells(stage5_routine[phase][handoff])
            if (
                handoff_row[46:48] != ["2", str(frames)]
                or any(
                    handoff_row[index] != next_state
                    for index in boss_trial.NATIVE_STATE_REFERENCE_COLUMNS
                )
            ):
                raise ValueError(
                    f"stage-5 phase {phase} transition handoff is not "
                    f"deterministic: {handoff}"
                )
        source_offset = 45 if phase == "2" else 52
        boss_row = cells(next(iter(client_tables[Q_GENERAL_BOSS][STAGE5_FIELD_BOSS].values())))
        if boss_row[source_offset] != timer_states[0][0]:
            raise ValueError(
                f"stage-5 phase {phase} transition does not start at the "
                "first timed handoff"
            )
        if boss_row[source_offset + 4] != timer_states[-1][0]:
            raise ValueError(
                f"stage-5 phase {phase} Withstand must end when the final timed "
                "transition handoff exits"
            )
    for source_phase, handoff in (
        ("1", "mod_stage5_phase2_handoff"),
        ("2", "mod_stage5_phase3_handoff"),
    ):
        bypasses = []
        for state_name, leaf in stage5_routine[source_phase].items():
            if isinstance(leaf, dict):
                continue
            state_row = cells(leaf)
            if len(state_row) <= 14 or state_row[14] != handoff:
                bypasses.append((state_name, state_row[14] if len(state_row) > 14 else None))
        if bypasses:
            raise ValueError(
                f"stage-5 phase {source_phase} bypasses transition handoff: "
                f"{bypasses[:5]}"
            )
    stage5_phase3_chain = (
        "mod_stage5_phase3_guard",
        "mod_stage5_phase3_guard_charge",
        "mod_stage5_phase3_guard_fire_start",
        "mod_stage5_phase3_guard_fire_loop",
        "mod_stage5_phase3_guard_end",
        "neutral1_1",
    )
    for source, destination in zip(stage5_phase3_chain, stage5_phase3_chain[1:]):
        source_row = cells(stage5_routine["3"][source])
        if source_row[31] != destination or source_row[32] != destination:
            raise ValueError(
                f"stage-5 phase-3 carrier has a nondeterministic exit: "
                f"{source} -> {source_row[31]}/{source_row[32]}"
            )
        if source_row[40] not in {source, destination}:
            raise ValueError(
                f"stage-5 phase-3 carrier wait fallback leaked: "
                f"{source} -> {source_row[40]}"
            )
    for phase, kind, target in (
        ("1", "0", "200"),
        ("2", "1", "40"),
        ("3", "3", "6"),
    ):
        descriptors = []
        post_descriptors = []
        for state_name, leaf in stage5_routine[phase].items():
            if isinstance(leaf, dict) or len(cells(leaf)) <= 26:
                continue
            descriptor = cells(leaf)[22:27]
            if descriptor[0] not in {"", "(None)"} and descriptor[3] == "true":
                descriptors.append(descriptor)
                if state_name.endswith("__mod_after_trial"):
                    post_descriptors.append((state_name, descriptor))
        expected = [kind, target, "false", "true", f"mod_stage5_trial_clear{phase}"]
        if not descriptors or any(row != expected for row in descriptors):
            raise ValueError(
                f"stage-5 phase {phase} active trial loop is incomplete"
            )
        if post_descriptors:
            raise ValueError(
                f"stage-5 phase {phase} repeats its trial after clear: {post_descriptors}"
            )
    stage5_actions = build_stage5_field_actions()
    if set(stage5_actions) != set(STAGE5_ACTION_LOGICALS):
        raise ValueError("stage-5 trial action asset set is incomplete")
    stage5_guard = field_catalog.parse_dsl(next(iter(stage5_actions.values())))
    stage5_condition_kinds: list[str] = []
    stage5_resistance_payloads: list[list] = []
    stage5_modifier_fields: list[list] = []
    def collect_stage5_create_conditions(node):
        if isinstance(node, list):
            if (
                len(node) == 2
                and node[0] == "Command"
                and isinstance(node[1], list)
                and node[1]
                and node[1][0] == "CreateCondition"
            ):
                linked = node[1][8]
                if isinstance(linked, list) and linked:
                    stage5_condition_kinds.append(linked[0])
                payload = node[1][2][0]
                if payload[0] in boss_trial.RESISTANCE_KINDS.values():
                    stage5_resistance_payloads.append(payload)
            if (
                len(node) == 2
                and node[0] == "Command"
                and isinstance(node[1], list)
                and node[1]
                and node[1][0] == "StartModifierField"
            ):
                stage5_modifier_fields.append(node[1][1:])
            for child in node:
                collect_stage5_create_conditions(child)
    collect_stage5_create_conditions(stage5_guard)
    expected_linked_counts = {}
    for phase_index, phase in enumerate(STAGE5_TRIAL_TEMPLATE["phases"]):
        linked_kind = boss_trial.TRIAL_KINDS[phase["trial"]["kind"]][1]
        condition_count = (
            len(phase.get("resistances", []))
            + len(STAGE5_TRIAL_TEMPLATE.get("common_trial_buffs", {}))
            + len(phase.get("trial_buffs", {}))
        )
        # Phase 1 is applied immediately and also participates in the
        # top-up loop; later phases are first discovered by that loop.
        expected_linked_counts[linked_kind] = condition_count * (
            2 if phase_index == 0 else 1
        )
    actual_linked_counts = {
        kind: stage5_condition_kinds.count(kind) for kind in expected_linked_counts
    }
    if actual_linked_counts != expected_linked_counts:
        raise ValueError(
            "stage-5 trial buffs are not linked to all three trials: "
            f"{actual_linked_counts}"
        )
    if not stage5_resistance_payloads or any(
        payload[2][0] != {"min": 100.0, "max": 100.0}
        or payload[3][0] != {"min": 99, "max": 99}
        for payload in stage5_resistance_payloads
    ):
        raise ValueError("stage-5 trial immunity is not 1000% with 99 layers")
    expected_stage5_regeneration = [
        STAGE5_REGENERATION_DURATION_FRAMES,
        [["Regeneration", STAGE5_REGENERATION_VALUE]],
        ["None"],
    ]
    if stage5_modifier_fields != [expected_stage5_regeneration]:
        raise ValueError(
            "stage-5 regeneration field is missing or duplicated: "
            f"{stage5_modifier_fields}"
        )

    stage15_row = cells(client_tables[Q_ADVENT_QUEST][str(MULTI_EVENT_ID)]["3"])
    if stage15_row[115] != STAGE15_FIELD:
        raise ValueError("stage-15 Advent quest does not use the isolated Eye Dragon field")
    rush_stage15_row = cells(client_tables[Q_RUSH_QUEST][str(RUSH_EVENT_ID)]["15"])
    if rush_stage15_row[98] != STAGE15_FIELD:
        raise ValueError("stage-15 Rush placeholder does not use the Eye Dragon field")
    if STAGE15_FIELD not in client_tables[Q_FIELD_DATA]:
        raise ValueError("stage-15 Eye Dragon field clone is missing")
    if STAGE15_ZONE not in client_tables[Q_ZONE]:
        raise ValueError("stage-15 Eye Dragon zone clone is missing")
    if STAGE15_FIELD_BOSS not in client_tables[Q_GENERAL_BOSS]:
        raise ValueError("stage-15 Eye Dragon Boss clone is missing")
    stage15_zone_values = [
        value
        for leaf in client_tables[Q_ZONE][STAGE15_ZONE].values()
        for value in cells(leaf)
    ]
    if STAGE15_FIELD_BOSS not in stage15_zone_values:
        raise ValueError("stage-15 Eye Dragon zone does not contain the trial Boss")
    if STAGE15_SOURCE_BOSS in stage15_zone_values:
        raise ValueError("stage-15 native Eye Dragon Boss was not isolated")
    stage15_field_row = cells(client_tables[Q_FIELD_DATA][STAGE15_FIELD])
    source_eye_field_row = cells(client_tables[Q_FIELD_DATA][STAGE15_NATIVE_FIELD])
    if stage15_field_row[:2] != source_eye_field_row[:2]:
        raise ValueError("stage-15 trial no longer uses the native multiplayer terrain")
    if stage15_field_row[2] != STAGE15_ZONE:
        raise ValueError("stage-15 Eye Dragon field does not point to its cloned zone")
    source_eye_boss = client_tables[Q_GENERAL_BOSS][STAGE15_SOURCE_BOSS]
    for variant, leaf in client_tables[Q_GENERAL_BOSS][STAGE15_FIELD_BOSS].items():
        row = cells(leaf)
        native_row = cells(source_eye_boss[variant])
        if row[42] != STAGE15_TRIAL_ROUTINE:
            raise ValueError(f"stage-15 Eye Dragon routine is incomplete: {variant}")
        expected_phase_graph = native_row[45:66]
        for phase_config in STAGE15_TRIAL_TEMPLATE["phases"]:
            end_state = phase_config.get("transition_invincible_end_state")
            if not end_state:
                continue
            native_phase = int(phase_config["native_phase"])
            transition_offset = (native_phase - 1) * 7
            handoff = phase_config.get("transition_handoff")
            if handoff is not None:
                expected_phase_graph[transition_offset] = str(handoff["name"])
            if phase_config.get("hp_threshold") is not None:
                expected_phase_graph[transition_offset + 2] = str(
                    float(phase_config["hp_threshold"])
                )
            expected_phase_graph[transition_offset + 3] = "1"
            expected_phase_graph[transition_offset + 4] = str(end_state)
        if row[43] != native_row[43] or row[45:66] != expected_phase_graph:
            raise ValueError(f"stage-15 native phase graph was flattened: {variant}")
        if row[109] != STAGE15_TRIAL_TEMPLATE["actions"]["guard"]:
            raise ValueError(f"stage-15 Eye Dragon guard action is missing: {variant}")
        if row[127] != STAGE15_SHIELD_ACTIONS[0]:
            raise ValueError(f"stage-15 small shield override is missing: {variant}")
        if row[136] != STAGE15_SHIELD_ACTIONS[1]:
            raise ValueError(f"stage-15 large shield override is missing: {variant}")
        if row[122] != native_row[122] or row[124] != native_row[124]:
            raise ValueError(f"stage-15 native dedicated actions changed: {variant}")
    stage15_routine = client_tables[Q_GENERAL_BOSS_STATE].get(STAGE15_TRIAL_ROUTINE)
    if not isinstance(stage15_routine, dict) or not all(
        isinstance(stage15_routine.get(key), dict) for key in ("1", "2", "3", "4")
    ):
        raise ValueError("stage-15 Eye Dragon native four-phase routine is incomplete")
    source_stage15_routine = client_tables[Q_GENERAL_BOSS_STATE].get(
        STAGE15_SOURCE_BOSS
    )
    if not isinstance(source_stage15_routine, dict):
        raise ValueError("stage-15 source Eye Dragon routine is missing")
    stage15_handoffs_by_destination: dict[str, list[tuple[str, int]]] = {}
    for phase_config in STAGE15_TRIAL_TEMPLATE["phases"]:
        handoff = phase_config.get("transition_handoff")
        if handoff is None:
            continue
        destination_phase = str(int(phase_config["native_phase"]) + 1)
        stage15_handoffs_by_destination[destination_phase] = (
            boss_trial.transition_handoff_states(handoff)
        )
    for phase_config in STAGE15_TRIAL_TEMPLATE["phases"]:
        phase = str(phase_config["native_phase"])
        states = stage15_routine[phase]
        source_states = source_stage15_routine[phase]
        handoff_names = {
            name for name, _ in stage15_handoffs_by_destination.get(phase, [])
        }
        if set(states) != set(source_states) | handoff_names:
            raise ValueError(
                f"stage-15 phase {phase} has an unexpected state set"
            )
        partition = phase_config["native_state_partition"]
        pre_states = set(partition["pre_states"])
        post_entry = partition["post_entry_state"]
        kind = str(boss_trial.TRIAL_KINDS[phase_config["trial"]["kind"]][0])
        target = str(int(phase_config["trial"]["target"]))
        expected = [kind, target, "false", "true", post_entry]
        descriptors: set[str] = set()
        for state_name, leaf in states.items():
            if isinstance(leaf, dict) or len(cells(leaf)) <= 40:
                continue
            state_row = cells(leaf)
            if state_name in handoff_names:
                if state_row[22] not in {"", "(None)"}:
                    raise ValueError(
                        f"stage-15 phase {phase} handoff owns a trial descriptor: "
                        f"{state_name}"
                    )
                continue
            if state_row[22] not in {"", "(None)"}:
                descriptors.add(state_name)
                if state_row[22:27] != expected:
                    raise ValueError(
                        f"stage-15 phase {phase} has a divergent trial descriptor: "
                        f"{state_name}"
                    )
            for index in boss_trial.NATIVE_STATE_REFERENCE_COLUMNS:
                target_state = state_row[index]
                if target_state not in states:
                    continue
                if (state_name in pre_states) != (target_state in pre_states):
                    raise ValueError(
                        f"stage-15 phase {phase} trial graph crosses its clear "
                        f"boundary: {state_name}[{index}] -> {target_state}"
                    )
        if descriptors != pre_states:
            raise ValueError(
                f"stage-15 phase {phase} descriptor partition is incomplete"
            )
        post_row = cells(states[post_entry])
        if post_row[0] != post_entry or post_row[22] not in {"", "(None)"}:
            raise ValueError(
                f"stage-15 phase {phase} clear state is not a descriptor-free "
                f"official timeline"
            )
    phase4_descriptors = [
        cells(leaf)[22:27]
        for leaf in stage15_routine["4"].values()
        if not isinstance(leaf, dict)
        and len(cells(leaf)) > 26
        and cells(leaf)[22] not in {"", "(None)"}
    ]
    if phase4_descriptors:
        raise ValueError("stage-15 native final phase unexpectedly owns a trial")
    for phase_config in STAGE15_TRIAL_TEMPLATE["phases"]:
        handoff = phase_config.get("transition_handoff")
        if handoff is None:
            continue
        source_phase = str(phase_config["native_phase"])
        destination_phase = str(int(source_phase) + 1)
        timer_states = boss_trial.transition_handoff_states(handoff)
        destination = cells(
            next(iter(source_eye_boss.values()))
        )[45 + (int(source_phase) - 1) * 7]
        source_entry_row = cells(source_stage15_routine[destination_phase][destination])
        for timer_index, (name, duration) in enumerate(timer_states):
            row = cells(stage15_routine[destination_phase][name])
            next_state = (
                timer_states[timer_index + 1][0]
                if timer_index + 1 < len(timer_states)
                else destination
            )
            if row[0] != source_entry_row[0]:
                raise ValueError(
                    f"stage-15 handoff lost the native timeline: {name}"
                )
            if row[46:48] != ["2", str(duration)]:
                raise ValueError(f"stage-15 handoff timer is malformed: {name}")
            if row[22:27] != ["(None)", "", "false", "false", "(None)"]:
                raise ValueError(
                    f"stage-15 handoff unexpectedly creates a trial: {name}"
                )
            if any(
                row[index] != next_state
                for index in boss_trial.NATIVE_STATE_REFERENCE_COLUMNS
            ):
                raise ValueError(f"stage-15 handoff chain diverged: {name}")
        first_timer = timer_states[0][0]
        if any(
            cells(leaf)[14] != first_timer
            for leaf in stage15_routine[source_phase].values()
            if not isinstance(leaf, dict)
        ):
            raise ValueError(
                f"stage-15 phase {source_phase} can bypass its transition handoff"
            )
    stage15_actions = build_stage15_trial_actions()
    if set(stage15_actions) != set(STAGE15_ACTION_LOGICALS):
        raise ValueError("stage-15 trial action asset set is incomplete")
    stage15_shields = build_stage15_shield_actions()
    if set(stage15_shields) != set(STAGE15_SHIELD_LOGICALS):
        raise ValueError("stage-15 shield action asset set is incomplete")
    actual_shield_ratios: list[float] = []
    for logical in STAGE15_SHIELD_LOGICALS:
        tree = field_catalog.parse_dsl(stage15_shields[logical])
        barriers: list[list] = []

        def collect_stage15_barriers(node):
            if isinstance(node, list):
                if node and node[0] == "CreateBarrier":
                    barriers.append(node)
                for child in node:
                    collect_stage15_barriers(child)
            elif isinstance(node, dict):
                for child in node.values():
                    collect_stage15_barriers(child)

        collect_stage15_barriers(tree)
        if len(barriers) != 1:
            raise ValueError(f"stage-15 shield action is malformed: {logical}")
        payload = barriers[0][2][0]
        if payload["min"] != payload["max"]:
            raise ValueError(f"stage-15 shield ratio is random: {logical}")
        actual_shield_ratios.append(float(payload["min"]))
    if any(
        abs(actual - expected) > 1e-12
        for actual, expected in zip(
            actual_shield_ratios, STAGE15_SHIELD_RATIOS, strict=True
        )
    ):
        raise ValueError(
            f"stage-15 shield ratios are wrong: {actual_shield_ratios}"
        )
    stage15_guard = field_catalog.parse_dsl(next(iter(stage15_actions.values())))
    stage15_condition_kinds: list[str] = []
    stage15_resistance_payloads: list[list] = []
    def collect_stage15_create_conditions(node):
        if isinstance(node, list):
            if (
                len(node) == 2
                and node[0] == "Command"
                and isinstance(node[1], list)
                and node[1]
                and node[1][0] == "CreateCondition"
            ):
                linked = node[1][8]
                if isinstance(linked, list) and linked:
                    stage15_condition_kinds.append(linked[0])
                payload = node[1][2][0]
                if payload[0] in boss_trial.RESISTANCE_KINDS.values():
                    stage15_resistance_payloads.append(payload)
            for child in node:
                collect_stage15_create_conditions(child)
    collect_stage15_create_conditions(stage15_guard)
    expected_stage15_counts = {}
    for phase_index, phase in enumerate(STAGE15_TRIAL_TEMPLATE["phases"]):
        linked_kind = boss_trial.TRIAL_KINDS[phase["trial"]["kind"]][1]
        condition_count = (
            len(phase.get("resistances", []))
            + len(STAGE15_TRIAL_TEMPLATE.get("common_trial_buffs", {}))
            + len(phase.get("trial_buffs", {}))
        )
        expected_stage15_counts[linked_kind] = condition_count * (
            2 if phase_index == 0 else 1
        )
    actual_stage15_counts = {
        kind: stage15_condition_kinds.count(kind)
        for kind in expected_stage15_counts
    }
    if actual_stage15_counts != expected_stage15_counts:
        raise ValueError(
            "stage-15 trial buffs are not linked to all three trials: "
            f"{actual_stage15_counts}"
        )
    if not stage15_resistance_payloads or any(
        payload[2][0] != {"min": 100.0, "max": 100.0}
        or payload[3][0] != {"min": 99, "max": 99}
        for payload in stage15_resistance_payloads
    ):
        raise ValueError("stage-15 trial immunity does not match the stage-5 full guard")

    stage10_actions = build_stage10_field_actions()
    if set(stage10_actions) != set(STAGE10_ACTION_LOGICALS):
        raise ValueError("stage-10 field action asset set is incomplete")
    expected_stage10_fields = (
        [(
            [["Attack", -50.0]],
            ["AbilityDamage", 20, ["TotalOfParty", []]],
        )],
        [([["ComboBoost", 10]], ["None"])],
        [([["Attack", -50.0]], ["DamageToEnemy", 300_000_000, 3])],
        [],
    )
    def contains_stage10_field_start(node):
        if isinstance(node, list):
            if node and node[0] == "StartModifierField":
                return True
            return any(contains_stage10_field_start(child) for child in node)
        return False

    expected_stage10_waits = ([], [], [], [])
    for logical, expected_field, expected_waits in zip(
        STAGE10_ACTION_LOGICALS,
        expected_stage10_fields,
        expected_stage10_waits,
    ):
        found = []
        waits = []
        def collect_stage10_fields(node):
            if isinstance(node, list):
                if node and node[0] == "StartModifierField":
                    found.append((node[2], node[3]))
                if (
                    len(node) >= 4
                    and node[0] == "Wait"
                    and contains_stage10_field_start(node[3])
                ):
                    waits.append(node[1])
                for child in node:
                    collect_stage10_fields(child)
        collect_stage10_fields(field_catalog.parse_dsl(stage10_actions[logical]))
        if found != expected_field:
            raise ValueError(
                f"stage-10 field transition is invalid: {logical}: {found}"
            )
        if waits != expected_waits:
            raise ValueError(
                f"stage-10 field transition wait is invalid: {logical}: {waits}"
            )

    completion_tree = field_catalog.parse_dsl(
        stage10_actions[STAGE10_ACTION_LOGICALS[3]]
    )
    if _action_root_commands(completion_tree):
        raise ValueError("stage-10 ex4 completion callback must be empty")

    # Stage 10 inherits Theophrastus's complete official multiplayer carrier.
    # Its GeneralBoss state chain owns both `continue` transitions.
    stage10_row = cells(client_tables[Q_ADVENT_QUEST][str(MULTI_EVENT_ID)]["2"])
    native_stage10_row = cells(
        client_tables[Q_ADVENT_QUEST][STAGE10_NATIVE_EVENT][STAGE10_NATIVE_QUEST]
    )
    if stage10_row[115] != STAGE10_NATIVE_FIELD:
        raise ValueError("stage-10 does not use the native Theophrastus field")
    if stage10_row[115:117] != native_stage10_row[115:117]:
        raise ValueError("stage-10 lost the native Theophrastus field or BGM")
    if STAGE10_NATIVE_FIELD not in client_tables[Q_FIELD_DATA]:
        raise ValueError("stage-10 native Theophrastus field is missing")
    stage10_field_row = cells(client_tables[Q_FIELD_DATA][STAGE10_NATIVE_FIELD])
    if stage10_field_row[2] != STAGE10_NATIVE_ZONE:
        raise ValueError("stage-10 native Theophrastus field points to the wrong zone")
    stage10_zone = client_tables[Q_ZONE].get(STAGE10_NATIVE_ZONE)
    if not isinstance(stage10_zone, dict):
        raise ValueError("stage-10 native Theophrastus zone is missing")
    stage10_zone_values = [
        value for leaf in stage10_zone.values() for value in cells(leaf)
    ]
    if any(boss not in stage10_zone_values for boss in STAGE10_NATIVE_BOSSES):
        raise ValueError("stage-10 native Theophrastus zone is incomplete")
    stage10_boss = client_tables[Q_GENERAL_BOSS].get("smr21_big_boss_multi", {})
    if "79" not in stage10_boss:
        raise ValueError("stage-10 Theophrastus level-79 boss data is missing")
    stage10_boss_cells = cells(stage10_boss["79"])
    expected_stage10_phase_changes = [
        "neutral1", "continue", "0.90", "1", "neutral1_2", "(None)", "(None)",
        "neutral1", "continue", "0.65", "1", "neutral1_2", "(None)", "(None)",
        "neutral1", "continue", "0.40", "1", "neutral1_2", "(None)", "(None)",
    ]
    if stage10_boss_cells[41:45] != [
        "p0", "smr21_big_boss_multi", "neutral1", "continue",
    ] or stage10_boss_cells[45:66] != expected_stage10_phase_changes:
        raise ValueError(
            "stage-10 Theophrastus four-phase chain changed: "
            f"{stage10_boss_cells[41:66]}"
        )
    stage10_routine = client_tables[Q_GENERAL_BOSS_STATE].get(
        "smr21_big_boss_multi", {}
    )
    if tuple(stage10_routine) != ("1", "2", "3", "4"):
        raise ValueError(
            "stage-10 Theophrastus must expose four native routines: "
            f"{tuple(stage10_routine)}"
        )
    expected_transition_markers = {
        "2": "neutral3",
        "3": "continue2",
        "4": "continue1",
    }
    for phase, expected_marker in expected_transition_markers.items():
        state = stage10_routine[phase].get("neutral1_2")
        if not isinstance(state, str) or cells(state)[3] != expected_marker:
            raise ValueError(
                "stage-10 transition marker routing changed: "
                f"phase={phase}, expected={expected_marker}"
            )
    opening_state = stage10_routine["1"].get("neutral1")
    if not isinstance(opening_state, str) or cells(opening_state)[3] != "continue1":
        raise ValueError("stage-10 opening ComboBoost marker routing changed")
    for table_key in (Q_GENERAL_BOSS, Q_GENERAL_BOSS_STATE, Q_BOSS_LEVEL):
        if RETIRED_STAGE5_TRIAL_ID in client_tables[table_key]:
            raise ValueError("retired stage-5 GeneralBoss carrier was reintroduced")
    if f"{RETIRED_STAGE5_TRIAL_ID}_field" in client_tables[Q_FIELD_DATA]:
        raise ValueError("retired stage-5 field clone was reintroduced")
    if f"{RETIRED_STAGE5_TRIAL_ID}_zone" in client_tables[Q_ZONE]:
        raise ValueError("retired stage-5 zone clone was reintroduced")
    if STAGE3_TRIAL_FIELD not in client_tables[Q_FIELD_DATA]:
        raise ValueError("stage-3 trial field clone is missing")
    if STAGE3_TRIAL_ZONE not in client_tables[Q_ZONE]:
        raise ValueError("stage-3 trial zone clone is missing")
    if STAGE3_TRIAL_BOSS not in client_tables[Q_GENERAL_BOSS]:
        raise ValueError("stage-3 trial boss clone is missing")
    trial_boss_blob = json.dumps(
        client_tables[Q_GENERAL_BOSS][STAGE3_TRIAL_BOSS],
        ensure_ascii=False,
        default=lambda value: value.decode("utf-8"),
    )
    if STAGE3_TRIAL_ROUTINE not in trial_boss_blob:
        raise ValueError("stage-3 trial boss does not use its isolated routine")
    if '0.75' not in trial_boss_blob or '0.5' not in trial_boss_blob:
        raise ValueError("stage-3 trial boss is missing the 75%/50% dividers")
    expected_phase_records = (
        [STAGE3_PHASE2_GUARD_STATE, "(None)", "0.75", "0", "", "(None)", "(None)"],
        ["neutral1_1", "(None)", "0.5", "0", "", "(None)", "(None)"],
    )
    for variant, leaf in client_tables[Q_GENERAL_BOSS][STAGE3_TRIAL_BOSS].items():
        row = cells(leaf)
        if row[45:52] != expected_phase_records[0] or row[52:59] != expected_phase_records[1]:
            raise ValueError(
                f"stage-3 GeneralBoss phase constructor is incomplete: variant {variant}"
            )
    if STAGE3_TRIAL_ROUTINE not in client_tables[Q_GENERAL_BOSS_STATE]:
        raise ValueError("stage-3 native trial routine clone is missing")
    trial_routine = client_tables[Q_GENERAL_BOSS_STATE][STAGE3_TRIAL_ROUTINE]
    if not all(isinstance(trial_routine.get(key), dict) for key in ("1", "2", "3")):
        raise ValueError("stage-3 native trial routine is not three-phase")
    for phase, kind, target in (
        ("1", "0", str(STAGE3_DIRECT_HIT_TARGET)),
        ("2", "2", str(STAGE3_POWER_FLIP_HIT_TARGET)),
    ):
        rows = [
            cells(value) for key, value in trial_routine[phase].items()
            if not key.startswith("mod_") and "__mod_after_trial" not in key
        ]
        if not rows or any(
            len(row) <= 26
            or row[22] != kind
            or row[23] != target
            or row[24] != "false"
            or row[25] != "true"
            for row in rows
        ):
            raise ValueError(f"stage-3 phase {phase} active trial overlay is incomplete")
    carrier_specs = (
        (
            "1",
            (
                STAGE3_TRIAL_CLEAR_STATE, "mod_trial_clear1_charge",
                "mod_trial_clear1_fire_start", "mod_trial_clear1_fire_loop",
                "mod_trial_clear1_end",
            ),
            ("shot3_start", "shot4_start1"),
        ),
        (
            "2",
            (
                STAGE3_TRIAL_CLEAR2_STATE, "mod_trial_clear2_charge",
                "mod_trial_clear2_fire_start", "mod_trial_clear2_fire_loop",
                "mod_trial_clear2_end",
            ),
            ("skill2_start", "skill2_start"),
        ),
    )
    for phase, names, first_animation in carrier_specs:
        rows = []
        for name in names:
            leaf = trial_routine[phase].get(name)
            if leaf is None:
                raise ValueError(f"stage-3 action carrier is missing: {name}")
            row = cells(leaf)
            if len(row) <= 40 or row[22] != "(None)":
                raise ValueError(f"stage-3 action carrier still owns a trial: {name}")
            rows.append(row)
        if rows[0][2:4] != list(first_animation):
            raise ValueError(f"stage-3 phase {phase} uses an invalid visual carrier")
        if any(rows[index][31] != names[index + 1] for index in range(4)):
            raise ValueError(f"stage-3 phase {phase} carrier chain is incomplete")
        if rows[-1][31] != "neutral1_1__mod_after_trial":
            raise ValueError(f"stage-3 phase {phase} carrier does not enter post-trial loop")
        post_leaf = trial_routine[phase].get("neutral1_1__mod_after_trial")
        if post_leaf is None or cells(post_leaf)[22] != "(None)":
            raise ValueError(f"stage-3 phase {phase} post-trial loop is missing")
    phase2_guard_names = (
        STAGE3_PHASE2_GUARD_STATE, "mod_phase2_guard_charge",
        "mod_phase2_guard_fire_start", "mod_phase2_guard_fire_loop",
        "mod_phase2_guard_end",
    )
    phase2_guard_rows = []
    for name in phase2_guard_names:
        leaf = trial_routine["2"].get(name)
        if leaf is None:
            raise ValueError(f"stage-3 phase-2 guard carrier is missing: {name}")
        phase2_guard_rows.append(cells(leaf))
    if phase2_guard_rows[0][2:4] != ["skill1_start", "skill1_start1"]:
        raise ValueError("stage-3 phase-2 guard uses an invalid visual carrier")
    if any(
        phase2_guard_rows[index][31] != phase2_guard_names[index + 1]
        for index in range(4)
    ) or phase2_guard_rows[-1][31] != "neutral1_1":
        raise ValueError("stage-3 phase-2 guard carrier chain is incomplete")
    if any(
        row[22:27] != [
            "2", str(STAGE3_POWER_FLIP_HIT_TARGET), "false", "true",
            STAGE3_TRIAL_CLEAR2_STATE,
        ]
        for row in phase2_guard_rows
    ):
        raise ValueError("stage-3 phase-2 guard starts before its linked trial")
    # Only pre_action needs registration now.  Phase-2 retry commands are
    # nested in that asset; legacy standalone carriers remain buildable for
    # compatibility but are deliberately not assigned to attack slots.
    if STAGE3_GUARD_PHASE1_ACTION not in trial_boss_blob:
        raise ValueError(
            f"stage-3 generic action is not registered: {STAGE3_GUARD_PHASE1_ACTION}"
        )
    action_assets = build_stage3_trial_actions()
    if set(action_assets) != set(STAGE3_ACTION_LOGICALS):
        raise ValueError("stage-3 generic action asset set is incomplete")
    parsed_actions = {
        logical: field_catalog.parse_dsl(blob)
        for logical, blob in action_assets.items()
    }
    def collect_create_conditions(node):
        found = []
        if isinstance(node, list):
            if (
                len(node) == 2
                and node[0] == "Command"
                and isinstance(node[1], list)
                and node[1]
                and node[1][0] == "CreateCondition"
            ):
                found.append(node)
            else:
                for child in node:
                    found.extend(collect_create_conditions(child))
        return found

    for logical, linked_kind in (
        (STAGE3_GUARD_PHASE1_ACTION, "DirectAttack"),
        (STAGE3_GUARD_PHASE2_ACTION, "PowerFlip"),
    ):
        tree = parsed_actions[logical + ".action.dsl.amf3.deflate"]
        expected_count = 3 + len(STAGE3_TRIAL_TEMPLATE.get("common_trial_buffs", {}))
        commands = (
            tree[-1][1][:expected_count]
            if logical == STAGE3_GUARD_PHASE1_ACTION
            else collect_create_conditions(tree)
        )
        if len(commands) != expected_count or any(
            command[0] != "Command"
            or command[1][0] != "CreateCondition"
            or command[1][8] != [linked_kind]
            for command in commands
        ):
            raise ValueError(
                f"stage-3 guard is not linked to {linked_kind}: {logical}"
            )
    phase1_tree = parsed_actions[
        STAGE3_GUARD_PHASE1_ACTION + ".action.dsl.amf3.deflate"
    ]
    repeats = []
    def collect_repeats(node):
        if isinstance(node, list):
            if len(node) == 2 and node[0] == "Event" and node[1][0] == "Repeat":
                repeats.append(node[1])
            for child in node:
                collect_repeats(child)
    collect_repeats(phase1_tree)
    if len(repeats) != 1 or repeats[0][1:4] != [30, 3600, "*"]:
        raise ValueError("stage-3 phase-2 retry scheduler is invalid")
    retry_commands = collect_create_conditions(repeats[0][4])
    expected_retry_count = sum(
        len(phase.get("resistances", []))
        + len(STAGE3_TRIAL_TEMPLATE.get("common_trial_buffs", {}))
        + len(phase.get("trial_buffs", {}))
        for phase in STAGE3_TRIAL_TEMPLATE["phases"]
        if phase.get("trial") is not None
    )
    retry_linked_kinds = {command[1][8][0] for command in retry_commands}
    if (
        len(retry_commands) != expected_retry_count
        or retry_linked_kinds != {"DirectAttack", "PowerFlip"}
        or any(command[1][6] is not True for command in retry_commands)
    ):
        raise ValueError("stage-3 phase-2 retry conditions are invalid")
    for logical in (STAGE3_CLEAR_PHASE1_ACTION, STAGE3_GUARD_CLEAR_ACTION):
        if parsed_actions[logical + ".action.dsl.amf3.deflate"][-1][1]:
            raise ValueError(f"stage-3 legacy clear carrier is not a no-op: {logical}")
    # Every modified orderedmap must survive the exact encoder/parser roundtrip.
    for logical, table in client_tables.items():
        encoded = q.build_node(table)
        if q.parse_node(encoded) != table:
            raise ValueError(f"orderedmap roundtrip failed: {logical}")
    rush_server = server_assets[server_root / "assets" / "rush_event_quest.json"]
    for internal_no in range(1, 16):
        quest_id = str(RUSH_EVENT_ID * 1000 + internal_no)
        if quest_id not in rush_server:
            raise ValueError(f"server Rush round {internal_no} is missing")
        if rush_server[quest_id].get("manaReward") != STAGE_BY_NUMBER[internal_no]["mana_reward"]:
            raise ValueError(f"server Rush round {internal_no} mana reward is wrong")
    practice_server = rush_server.get(str(RUSH_EVENT_ID * 1000 + PRACTICE_ROUND))
    if not isinstance(practice_server, dict):
        raise ValueError("server Rush endless practice quest is missing")
    if practice_server.get("rushEventFolderId") != 2:
        raise ValueError("server Rush endless practice folder is wrong")
    fantasy_shop.validate(
        client_tables[Q_SHOP],
        server_assets[server_root / "assets" / "event_item_shop.json"],
        server_assets[server_root / "assets" / "event_item_shop_id_map.json"],
    )
    advent_server = server_assets[server_root / "assets" / "advent_event_quest.json"]
    for quest_no, stage in enumerate(MULTI_STAGES, start=1):
        quest_id = str(MULTI_EVENT_ID * 1000 + quest_no)
        if quest_id not in advent_server:
            raise ValueError(f"server AdventEvent boss {quest_no} is missing")
        if advent_server[quest_id].get("manaReward") != STAGE_BY_NUMBER[stage]["mana_reward"]:
            raise ValueError(f"server AdventEvent stage {stage} mana reward is wrong")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--server-root", type=Path, default=DEFAULT_SERVER_ROOT)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    server_root = args.server_root.resolve()

    try:
        client_tables = load_and_build_client_tables()
        action_assets = build_stage3_trial_actions()
        action_assets.update(build_stage5_field_actions())
        action_assets.update(build_stage10_field_actions())
        action_assets.update(build_stage15_trial_actions())
        action_assets.update(build_stage15_shield_actions())
        server_assets = build_server_assets(server_root)
        validate(client_tables, server_assets, server_root)
    except Exception as exc:
        print(f"[ERR] preflight failed: {exc}")
        return 1

    print(
        f"[PLAN] Rush {RUSH_EVENT_ID}: unified visible rounds 1..15; "
        f"5/10/15 -> AdventEvent {MULTI_EVENT_ID} via minimal SWF routing"
    )
    print(f"[PLAN] token {TOKEN_ID}; boss rewards {BOSS_TOKEN_REWARDS}; shared shop stock={SHOP_STOCK}")
    print(f"[PLAN] remove retired Carnival carrier {OLD_CARNIVAL_EVENT_ID}; preserve solo base rewards")
    for config in STAGE_CONFIGS:
        mode = "MULTI" if config["stage"] in MULTI_STAGES else "SOLO"
        print(
            f"[STAGE {config['stage']:02d}] {mode} {config['boss']} "
            f"Lv{config['level']} HPx{number_text(config['hp'])} "
            f"ATKx{number_text(config['atk'])}"
        )
    if not args.write:
        print("[DRY-RUN] all client tables and server assets built and validated in memory")
        return 0

    try:
        for logical, table in client_tables.items():
            gui.add_pending(q.save_table(logical, table))
        for logical, blob in action_assets.items():
            path = q.store_path(logical)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(blob)
            gui.add_pending(path)
        for path, value in server_assets.items():
            _write_json_atomic(path, value)
    except Exception as exc:
        print(f"[ERR] write failed: {exc}")
        return 1

    print("[OK] unified Rush carrier, Advent bosses, token, shop skeleton, and server mirrors written")
    if args.publish:
        completed = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "wf_publish.py"),
                "--tables", ",".join(PUBLISH_TABLES),
                "--cdn-root", str(server_root / ".cdn" / "cn"),
            ],
            cwd=TOOLS_DIR,
        )
        return completed.returncode
    print("[NEXT] publish tables: " + ",".join(PUBLISH_TABLES))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
