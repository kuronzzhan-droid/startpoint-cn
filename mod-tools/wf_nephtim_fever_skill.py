"""奈芙提姆的全队增益与光暗协力球召唤，纯原生Action DSL。"""
from copy import deepcopy

from wf_bianca_dragon_skill import command, block, value

CODE = "ruin_girl_campus"
STATE_UID = 16998901
LIGHT_ID, DARK_ID = 1699891, 1699892
STATE_NAME = "星夜茶会"
STATE_ICON = "battle/common/unique_condition/" + CODE + "_starry_tea"
ACTIVE_PATHS = tuple(f"battle/action/skill/action/rare5/{CODE}${CODE}_{level}"
                     for level in (1, 2))
SKILL_FX = "battle/effect/skill_unique/" + CODE + "_fever/"
BALL_FX = {kind: f"battle/effect/skill_unique/{CODE}_{kind}_call/" for kind in ("light", "dark")}
LIGHT_FADE_FX = f"battle/effect/skill_unique/{CODE}_light_fade/{CODE}_light_fade_disappear"
DURATION = 1200


def condition(subject, *contents, silent=False, magnification=1):
    return command("CreateCondition", subject, list(contents), value(1),
                   ["None"] if silent else ["GenericConditionHitEffect"],
                   False, False, "", None, False, 3, value(magnification), True)


def find(subject, selector, contents, elements=()):
    return command("FindAllSubjects", subject, selector, list(elements), [], [], [], [],
                   ["DoNothing"], block(condition(subject, *contents)))


def dark_and_balls(*contents):
    # 82 is primary members only; 86 is multiball members only. No duplicate dark ball grant.
    return block(find(70, 82, contents, (6,)), find(71, 86, contents))


def direct_buff():
    return ["ACDirectDamage", value(DURATION), value(2), value(1)]


def attack_buff():
    return ["ACAttackPoint", value(DURATION), value(1), value(1)]


def split_buff():
    # (1 + strength) / times = (1+1)/2 per hit; total direct damage is doubled.
    return ["ACAdditionalDirectAttack", value(DURATION), value(2), value(1), value(1)]


def show(name, subject=-18):
    return command("ShowEffect", name, ["SpecifyEffectDirectly", SKILL_FX + name],
                   subject, ["ForesideOfCharacter"], ["PlayOnlyFirstSequence"],
                   ["AB"], 0, 0, 0, False, False, ["None"])


def action(*expressions):
    return ["ActionDsl", 1, ["None"], False, False, False, False, False, False,
            False, 0, block(*expressions)]


def _grant_state():
    # Adding zero accumulation refreshes an existing native Unique's duration,
    # preserving phase 1/2. It cannot recreate a condition removed before impact.
    unique = ["ACUnique", STATE_UID, value(1)]
    return command("ConditionalsConditionExist", -17, ["DCUnique", STATE_UID],
        block(condition(-17, unique, silent=True, magnification=0)),
        block(condition(-17, unique, silent=True)))


def build_skill(level):
    if level not in (1, 2):
        raise ValueError("skill level must be 1 or 2")
    piercing = ["ACPiercing", value(DURATION)]
    fever = command("ConditionalsFeverMode", block(
        dark_and_balls(split_buff()), show(CODE + "_fever_2yellow")),
        block(show(CODE + "_fever_1blue")))
    enhanced = command("ConditionalsChangeSkillFlag", 1, block(
        dark_and_balls(attack_buff()),
        command("ConditionalsFeverMode", block(
            _grant_state()), block())), block())
    return action(show(CODE + "_fever_all", -1),
        find(72, 33, [direct_buff(), piercing]),
        # Native co-op condition channel: remote primary members, local balls handled above.
        command("TargetMate", 73, [], [], [], [], []),
        condition(73, piercing), fever, enhanced)


def _advance_phase(kind):
    """Use the existing timed status as a two-state phase without refreshing its expiry.

    Native ConsumeUniqueCondition forwards signed limits: at one layer, -1 raises
    the count to two; at two layers, +1 lowers it to one. Guards keep the count
    within 1..2 and avoid recreating an expired/cleared condition in late callbacks.
    """
    increment = command("ConsumeUniqueCondition", -17, STATE_UID, ["Some", -1])
    decrement = command("ConsumeUniqueCondition", -17, STATE_UID, ["Some", 1])
    change = command("ConditionalsConditionAccumulationNumber", ["DCUnique", STATE_UID], 2,
                     block(decrement) if kind == "dark" else block(),
                     block(increment) if kind == "light" else block())
    return command("ConditionalsFeverMode", block(
        command("ConditionalsConditionExist", -17, ["DCUnique", STATE_UID],
                block(change), block())), block())


def summon(kind):
    uid = LIGHT_ID if kind == "light" else DARK_ID
    prefix = BALL_FX[kind]
    stem = CODE + "_" + kind + "_call"
    effect = lambda tail: ["SpecifyEffectDirectly", prefix + stem + tail]
    disappear = ["SpecifyEffectDirectly", LIGHT_FADE_FX] if kind == "light" else effect("_disappear")
    return command("CreateSummonsMultiball", 1, uid, value(DURATION),
        ["E2", effect("_ready_generation"), effect("_ready_left"), effect("_ready_right")],
        effect("_appear"), disappear, 0, False,
        "campus_nephtim_" + kind + "_spawn", 74, 75, block(
            condition(75, direct_buff(), attack_buff(), split_buff(), ["ACPiercing", value(DURATION)]),
            _advance_phase(kind)), None)


def build_spawn():
    choose = command("ConditionalsConditionAccumulationNumber", ["DCUnique", STATE_UID], 2,
                     block(summon("dark")), block(summon("light")))
    return action(command("ConditionalsFeverMode", block(
        command("ConditionalsConditionExist", -17, ["DCUnique", STATE_UID],
                block(choose), block())), block()))


def unique_rows():
    return {
        str(STATE_UID): [[CODE + "_starry_tea", STATE_NAME, STATE_ICON, str(DURATION), "2",
                         "(None)", "(None)", "(None)", "(None)", "false", "true",
                         "0", "0", "true", "(None)"]],
    }


def multiball_rows(multiballs, levels):
    result, growth = {}, {}
    for uid, kind, element in ((LIGHT_ID, "light", 4), (DARK_ID, "dark", 5)):
        row = deepcopy(multiballs["1611772"][0])
        actor = CODE + "_" + kind + "_ball"
        row[0:2] = [actor + "_1", actor]
        row[3] = str(element)
        result[str(uid)] = [row]
        growth[str(uid)] = deepcopy(levels["1611772"])
    return {"master/battle/multiball/multiball.orderedmap": result,
            "master/battle/multiball/multiball_level.orderedmap": growth}


def metadata():
    return {"base_direct_percent": 200, "enhanced_attack_percent": 100,
            "duration_frames": DURATION, "additional_direct_times": 2,
            "additional_direct_total_ratio": 2,
            "spawn_unique_id": STATE_UID, "alternate_phase": "single timed Unique, guarded signed consumption 1/2",
            "spawn_order": ["light", "dark"], "each_ball_lifetime_frames": DURATION,
            "new_ball_buffs": "activated callback grants the same 20s skill effects to each newborn ball",
            "light_appearance": "native ruin_girl_meteor; author-approved Summons conversion",
            "remote_piercing": "native TargetMate channel to primary members",
            "local_targets": "all primary members and all skill-targetable multiballs"}
