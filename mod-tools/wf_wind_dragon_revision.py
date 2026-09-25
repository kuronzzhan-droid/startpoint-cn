"""风巨蜥的能力伤害与合击位回槽限制；只转换传入的自有行/DSL。"""
from copy import deepcopy

from wf_battle_rules import make_row, gauge_mask, segment_override, TARGETS

CID = '149998'
CODE = 'land_dragon_wind_playable'
BLOCK_TEXT = '作为合击角色编成时，全队无法因技能或能力效果增加技能槽（战斗开始时除外）'
ABILITY_TOTAL_EFFECT = 'battle/common/layer1/total_ability_damage_effect'


def main_only(rows):
    """原生可合击开关负责主位限制；移除重复/互斥的槽位前提。"""
    result = deepcopy(rows)
    for row in result:
        if len(row) != 126:
            raise ValueError('unexpected ability row width')
        row[1] = 'false'
        for col in (6, 13, 20):
            if row[col] in ('202', '203'):  # OwnerIsMain / OwnerIsUnison
                if any(row[col + 1:col + 7]):
                    raise ValueError('unexpected slot precondition arguments')
                row[col] = '0'
    return result


def _preload_ability_total(result):
    # ActionDslAssetResolver visits both IfThisCharacterIsBoss branches while
    # loading. MemberImpl.isBoss() is false, so this declaration never plays or
    # creates an effect in battle. It adds the native timeline AND view assets
    # absent from the default battle preload (only skill/PF totals are common).
    if result[11][0] != 'Block':
        raise ValueError('expected root Block')
    marker = 'wf/preload/ability_total'
    show = ['ShowEffect', marker, ['SpecifyEffectDirectly', ABILITY_TOTAL_EFFECT],
            0, ['ForesideOfCharacter'], ['SpecifyEffectLifetimeDirectly', 1],
            ['AB'], 0, 0, 0, False, False, ['None']]
    declaration = ['Command', ['IfThisCharacterIsBoss', -18,
                              ['Command', show], ['Block', []]]]
    existing = [x for x in nodes(result, 'ShowEffect') if x[1] == marker]
    if existing:
        if existing != [show] or result[11][1].count(declaration) != 1:
            raise ValueError('invalid ability damage preload declaration')
    else:
        result[11][1].insert(0, declaration)


def bonus_rows(rows, *, leader=False):
    """不改变倍率、持续时间、触发条件或充能速度等其它内容。"""
    result = deepcopy(rows)
    kind, instant, during = (3, 45, 107) if leader else (5, 47, 109)
    maps = ({'34': '388', '1': '486', '694': '695'},
            {'2': '154', '411': '412'})
    for row in result:
        if len(row) != (124 if leader else 126):
            raise ValueError('unexpected ability row width')
        col, mapping = (during, maps[1]) if row[kind] == '1' else (instant, maps[0])
        row[col] = mapping.get(row[col], row[col])
    return result


def add_unison_block(rows, donor, *, target='party'):
    result = deepcopy(rows)
    existing = [r for r in result if r[5] == '1' and r[109] == '423']
    if existing:
        if len(existing) != 1 or (existing[0][6], existing[0][110], existing[0][111], existing[0][118]) != ('203', str(TARGETS[target]), '(None)', '12'):
            raise ValueError('existing gauge rule differs')
        return result
    row = make_row(donor, result[0][0], 423, gauge_mask(['skill', 'ability']), target=target)
    row[:5] = result[0][:5]
    row[1] = 'true'
    row[6] = '203'  # OwnerIsUnison: evaluate the ability owner, not fused main.
    result.append(row)
    return result


def nodes(tree, name):
    if isinstance(tree, list):
        if tree and tree[0] == name:
            yield tree
        for child in tree:
            yield from nodes(child, name)


def ability_skill(tree):
    """真实来源转换覆盖普通/Fever随机分支，CreateNormalAttack[5]平加伤害不动。"""
    result = deepcopy(tree)
    if len(result) != 12 or result[0] != 'ActionDsl':
        raise ValueError('expected native ActionDsl')
    if not list(nodes(result, 'CreateNormalAttack')):
        raise ValueError('active skill contains no attacks')
    result[10] = segment_override('ability')
    for area in nodes(result, 'CreateHitArea'):
        if list(nodes(area[23], 'CreateNormalAttack')):
            area[24] = segment_override('ability')
    for condition in nodes(result, 'ACSkillDamage'):
        condition[0] = 'ACAbilityDamage'
    _preload_ability_total(result)
    return result


def remove_fox_direct_combo(rows):
    """删除指定Fever直击+10连击，保留其它Fever/弹射加连击。"""
    result = deepcopy(rows)
    matches = [r for r in result if r[5] == '0' and r[6] == '12'
               and r[27] == '20' and r[47] == '226'
               and r[30:32] == ['100000', '100000']
               and r[51:53] == ['1000000', '1000000']]
    if len(matches) > 1:
        raise ValueError('ambiguous fox direct-combo rows')
    return [r for r in result if r not in matches]
