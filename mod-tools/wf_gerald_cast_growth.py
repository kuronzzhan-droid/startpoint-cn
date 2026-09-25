"""光狼队长的施技成长：起手快照，每次强化技能递增当前HP比例。"""
from copy import deepcopy
from wf_bianca_dragon_skill import block, command, value
from wf_wind_dragon_revision import nodes

CODE = 'white_wolf_gerald'
COUNTER_UID = 14999903
COUNTER_VARIABLE = 360
CONDITION_KEY = CODE + '_cast_growth'
ENHANCEMENT_TEXT = '强化自身技能效果，额外造成一定固定伤害。'


def relocate(a2, a3, leaders):
    """仅移Fever时空裂痕和白共鸣I536；时之刻印属于原PF门，保持原位。"""
    a2, a3, leaders = deepcopy((a2, a3, leaders))
    rifts = [r for r in a2 if r[6] == '12' and r[47] == '629'
             and r[70] == 'ability_skill_gerald_time_rift']
    flags = [r for r in a3 if r[47] == '536' and r[70] == 'change_skill_' + CODE]
    if len(rifts) != 1 or len(flags) != 1:
        raise ValueError('reviewed Gerald ability rows changed')
    for r in rifts + flags:
        leaders.append([leaders[0][0], '0', ''] + r[5:])
    return [r for r in a2 if r not in rifts], [r for r in a3 if r not in flags], leaders


def counter_row():
    return [[CONDITION_KEY, '时空侵蚀', 'battle/common/unique_condition/unique_gerald_time_seal',
             '99999999', '2147483647', '(None)', '(None)', '(None)', '(None)',
             'false', 'true', '0', '0', 'false', '(None)']]


def rewrite(tree):
    result = deepcopy(tree)
    flags = list(nodes(result, 'ConditionalsChangeSkillFlag'))
    if len(flags) != 1 or flags[0][1] != 1:
        raise ValueError('expected one enhanced skill branch')
    enhanced = flags[0][2]
    ratios = list(nodes(enhanced, 'CreateRatioAttack'))
    if len(ratios) != 2:
        raise ValueError('expected current-HP strike and execute branches')
    strike = next((r for r in ratios if r[3] == value(.05)), None)
    execution = next((r for r in ratios if r[3] == value(1)), None)
    if strike is None or execution is None or strike[2] != 1 or execution[2] != 1:
        raise ValueError('ratio baseline changed')
    if list(nodes(result, 'BindConditionAccumulationVariable')):
        raise ValueError('unexpected existing variable binding')
    strike[3] = [{'min': .05, 'max': .05}, {'min': .01, 'max': .01, 'mul': COUNTER_VARIABLE}]
    bind = command('BindConditionAccumulationVariable', -17, COUNTER_VARIABLE,
                   ['DCUnique', COUNTER_UID], 1, 2147483647)
    increment = command('CreateCondition', -17, [['ACUnique', COUNTER_UID, value(1)]],
                        value(1), ['None'], False, False, CONDITION_KEY, None, False, 3, value(1), True)
    # Snapshot before the increment; each evaluator retains its own prior-cast count.
    enhanced[1][0:0] = [bind, increment]
    return result
