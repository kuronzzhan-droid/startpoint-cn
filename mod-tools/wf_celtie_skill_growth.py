"""星风心得的主动基础倍率成长；原生浮点绑定，不改伤害加成区。"""
from copy import deepcopy

from wf_celtie_fever_stock import GAIN_UID

GAIN_FLOAT_ID = 14998905
GAIN_MAX_LAYERS = 2147483647  # Same limit as the existing UniqueCondition master.
MULTIPLIER_PER_LAYER = 10


def _nodes(tree, kind):
    if isinstance(tree, list):
        if tree and tree[0] == kind:
            yield tree
        for child in tree:
            yield from _nodes(child, kind)


def _command(name, *args):
    return ['Command', [name, *args]]


def _block(*children):
    return ['Block', list(children)]


def with_starwind_growth(near):
    """在施技入口取心得快照，三个互斥子作用域各自绑定并执行动作。

    官方 blackflower_wiz_smr22 使用相同 Bind + SLvValue.vlv 写法。
    条件分支内绑定不会写回父 Environment，因此不能把 near 放在门槛外。
    无共鸣/非Fever用零上限绑定；没有心得时原生层数为零。
    """
    template = deepcopy(near)
    attacks = list(_nodes(template, 'CreateNormalAttack'))
    if len(attacks) != 4:
        raise ValueError('expected four attacks across collision and timeout')
    for attack, weight in zip(attacks, (25, 45, 25, 45)):
        base = weight * 75 / 70
        if attack[6] != [{'min': base, 'max': base}]:
            raise ValueError('unexpected base multiplier before Starwind growth')
        attack[6][0]['vlv'] = [{'vid': GAIN_FLOAT_ID, 'min': 0,
                              'max': MULTIPLIER_PER_LAYER * weight / 70}]

    def branch(ceiling):
        return _block(_command('BindConditionAccumulationVariable', -17,
            GAIN_FLOAT_ID, ['DCUnique', GAIN_UID], 1, ceiling),
            _command(*deepcopy(template)))

    return _command('ConditionalsFeverMode',
        _block(_command('ConditionalsUnifyElement', 4, 6,
            branch(GAIN_MAX_LAYERS), branch(0))), branch(0))
