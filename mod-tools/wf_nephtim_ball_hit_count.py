"""奈芙队长：按当前协力球数量刷新自身直击判定，不增加伤害倍率。"""
from wf_bianca_dragon_skill import block, command, value

STRING_ID = 'ruin_girl_campus_ball_hit_count'
ACTION_PATH = 'battle/action/skill/action/ability_skill/ruin_girl_campus$' + STRING_ID
DESCRIPTION = '暗属性共鸣时，每有1个协力球存在，自身直击判定次数+1。'


def action_tree():
    # Native FloatArray sums its entries; count remains dynamic in this one scope.
    def condition(base, bonus):
        times = [{'min': base, 'max': base}, {'min': 1, 'max': 1, 'mul': 1}]
        return command('CreateCondition', -17,
            [['ACAdditionalDirectAttack', value(2), times, value(bonus), value(1)]],
            value(1), ['None'], False, False, STRING_ID, None, True, 3, value(1), True)
    return ['ActionDsl', 1, ['None'], False, False, False, False, False, False,
            False, 0, block(
                command('MultiballNumberVariable', 1, False, None, [], 1, 2147483647),
                # The helper is invisible; this query sees the ordinary skill buff only,
                # so it cannot feed back into itself and tracks that buff's expiry.
                command('ConditionalsConditionExist', -17, ['DCAdditionalDirectAttack'],
                        block(condition(2, 1)), block(condition(1, 0))))]


def leader_row(source):
    from wf_nephtim_fever_abilities import CODE, _instant, _set
    r = _instant(source, 629, pre='dark', trigger=77)
    _set(r, {70: STRING_ID, 71: ACTION_PATH})
    return [CODE, '0', ''] + r[5:]
