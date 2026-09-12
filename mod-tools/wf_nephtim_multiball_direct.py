"""按存续协力球数量，为队伍成员与协力球写入原生独立直击增益。"""
from wf_bianca_dragon_skill import block, command, value
from wf_character_revision import encode_tree

STRING_ID = "ruin_girl_campus_multiball_direct"
ACTION_PATH = "battle/action/skill/action/ability_skill/ruin_girl_campus$" + STRING_ID
LOGICAL_PATH = ACTION_PATH + ".action.dsl.amf3.deflate"
COUNT_VARIABLE = 1
CONDITION_KEY = STRING_ID
TTL_FRAMES = 2
NATIVE_COUNT_MAX = 2_147_483_647


def action_tree():
    """即时执行且无监听/等待；每球同来源、同 key 覆盖，数量降低也会降值。

    原生 D410 的球共享总计器未被球的伤害 getter 读取，故必须使用各球
    conditionSlot。数量放在 strength，不放 magnification，避免低值刷新被拒。
    MultiballNumberVariable 的 ID 数组必须为 null；空数组代表不匹配任何球。
    """
    strength = [{"min": 0.1, "max": 0.1, "mul": COUNT_VARIABLE}]
    def condition(subject):
        return command("CreateCondition", subject,
            [["ACSeparatedTermDirectDamage", value(TTL_FRAMES), strength, value(1)]],
            value(1), ["None"], False, False, CONDITION_KEY, None, True, 3, value(1), True)
    return ["ActionDsl", 1, ["None"], False, False, False, False, False, False,
            False, 0, block(
                command("MultiballNumberVariable", COUNT_VARIABLE, False, None, [],
                        1, NATIVE_COUNT_MAX),
                command("FindAllSubjects", 72, 82, [], [], [], [], [], block(), condition(72)),
                command("FindMultiballSubjects", 70, 71, False, [], block(), condition(71)))]


def action_assets():
    return {("common", LOGICAL_PATH): encode_tree(action_tree())}


def flat_string_rows():
    return {STRING_ID: [["每有1个协力球存在时，全队及协力球对敌人造成的直接攻击伤害+10%（独立乘区）。"]]}


def metadata():
    return {
        "per_surviving_multiball_percent": 10,
        "main_only": True, "requires_dark_resonance": True, "requires_fever": False,
        "party_and_multiballs": "same N, each member's invisible ConditionSlot",
        "count_scope": "native surviving count, including inactive and ectoplasmic squads",
        "count_filters": {"element": None, "summoner": None, "multiball_ids": None},
        "update_period_frames": 1, "requires_at_least_one_ball_to_invoke": False,
        "zero_count": "overwrite party strength with zero; one zero-valued hidden record may remain until refresh stops",
        "condition_duration_frames": TTL_FRAMES, "condition_key": CONDITION_KEY,
        "quantity_changes_strength_only": True, "maximum_conditions_per_ball": 1,
        "expires_after_last_successful_write_ball_updates": TTL_FRAMES,
        "in_flight_write": "an already queued condition may apply in the current impact phase",
        "new_ball_refresh": "next living owner update and native impact phase",
        "lifetime": "immediate commands only; evaluator removed at frame-end removal phase",
        "twenty_balls_at_60_hz": {"helper_invocations_per_second": 60,
                                  "maximum_condition_overwrites_per_second": 1380},
        "new_client_patch_required": False,
    }
