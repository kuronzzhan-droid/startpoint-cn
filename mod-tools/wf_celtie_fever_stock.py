"""星风快门共享库存；队长授予2层，能力3授予1层，各自消费。"""
CODE = "wind_spgirl_campus"
STOCK_UID = 14998901
STOCK_NAME = "星风快门"
STOCK_STRING_ID = CODE + "_flip_stock"
ABILITY_STOCK_STRING_ID = STOCK_STRING_ID + "_ability"
_ACTION_PREFIX = "battle/action/skill/action/ability_skill/" + CODE + "$"
STOCK_ACTION_PATH = _ACTION_PREFIX + STOCK_STRING_ID
ABILITY_STOCK_ACTION_PATH = _ACTION_PREFIX + ABILITY_STOCK_STRING_ID
STOCK_ICON = "battle/common/unique_condition/" + STOCK_STRING_ID


def stock_action_tree(layers=2):
    """原生 ACUnique 只加库存，不制造技能发动或伤害事件。"""
    if layers not in (1, 2):
        raise ValueError("Starwind Shutter grant must be one or two layers")
    one = [{"min": 1, "max": 1}]
    count = [{"min": layers, "max": layers}]
    grant = ["Command", ["CreateCondition", -17, [["ACUnique", STOCK_UID, one]], one,
                         ["GenericConditionHitEffect"], False, False, "", None,
                         False, 3, count, True]]
    return ["ActionDsl", 1, ["None"], False, False, False, False, False, False,
            False, 0, ["Block", [grant]]]
