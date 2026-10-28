"""C10 裂罅界面文案总表；值可统一修改，旧 SWF 常量池保持原样。"""

# 第一列是稳定 C9 文本，第二列是现行文本；后续改名只改第二列。
# None 表示沿用原文；无 C9 原文的新条目使用空第一列。
COPY = {
    'workshop': (None, '裂罅工坊'),
    'unknown_name': (None, '未知裂罅'),
    'revealed_name': (None, '武器裂罅'),
    'unknown_detail': (None, '携带通关五重后揭示为武器裂罅'),
    'sync_detail': (None, '数据同步中'),
    'suffix': ('裂罅', None),
    'bound_weapon': ('绑定武器：', None),
    'detail_count': ('\n已重抽 ', '\n已重铸 '),
    'times': (' 次', None),
    'reforge': ('重抽', '重铸'),
    'currency': ('深渊币', None),
    'current_count': ('当前词条 · 已重抽 ', '当前词条 · 已重铸 '),
    'legacy_cost': ('下次费用：', '本次重铸费用：'),
    'balance': (' 深渊币　余额：', None),
    'insufficient': ('深渊币不足', None),
    'confirm_title': ('重抽裂罅', '重铸裂罅'),
    'consume': ('消耗 ', None),
    'confirm_description': (' 深渊币重抽。抽取后可保留新的或原来的词条。',
                            ' 深渊币重铸。重铸后可保留新的或原来的词条。'),
    'confirm_count': ('已重抽次数', '已重铸次数'),
    'affix_count': ('词条数量', None),
    'affix_range': ('1～4 条', None),
    'currency_balance': ('深渊币余额', None),
    'confirm_notice': ('每次重抽仅扣费一次，保留原词条不会返还费用。',
                       '每次重铸仅扣费一次，保留原词条不会返还费用。'),
    'select_title': ('选择保留的裂罅词条', '选择要保留的词条'),
    'old_affixes': ('原来的词条', None),
    'new_affixes': ('新的词条', None),
    'legacy_select_notice': ('左侧为原词条，右侧为新词条。请选择保留哪一组。', None),
    'select_new': ('保留新的', '选用新词条'),
    'select_old': ('保留原来的', '保留原词条'),
    'category_to_equipment': ('裂罅 → 装备', None),
    'category_to_riven': ('装备 → 裂罅', None),
    'list_affix_count': ('词条 ', None),
    'affix_unit': (' 条', None),
    'list_roll_count': ('重抽 ', '重铸 '),
    'empty_list': ('暂无符合条件的已揭示裂罅', None),
    'filter_placeholder': ('输入绑定武器名称', None),
    'filter_notice': ('名称筛选绑定武器。条数、负面可多选；不限忽略两组限制。\n默认按获得顺序由新到旧；勾选重抽排序 / 升序可切换。',
                      '名称筛选绑定武器。条数、负面可多选；不限忽略两组限制。\n默认按获得顺序由新到旧；勾选重铸排序 / 升序可切换。'),
    'sort_roll_count': ('按重抽次数', '按重铸次数'),
    'sort_ascending': ('升序排列', None),
    'one_affix': ('1条', None),
    'two_affixes': ('2条', None),
    'three_affixes': ('3条', None),
    'four_affixes': ('4条', None),
    'has_negative': ('有负', None),
    'no_negative': ('无负', None),
    'unlimited': ('不限', None),
    'filter_title': ('裂罅筛选与排序', None),
    'filter_name_sort': ('武器名称与排序', None),
    'filter_affixes': ('词条数量与负面', None),
    'changed_notice': ('裂罅已变化，请重试', None),
    'dismantle_confirm': ('确定分解这张裂罅吗？分解后无法恢复，并会解除所有编队中的装备。', None),
    'dismantle': ('分解', None),
    'dismantle_title': ('分解裂罅', None),
    'equipment': ('装备', None),
    'ordinary': ('常规', None),
    'cost': ('本次费用 ', '本次重铸费用 '),
    'owned_currency': (' 深渊币（持有 ', None),
    'select_notice': ('上方为原词条，下方为新词条。请选择保留哪一组。', None),
    'revealed_title': ('获得武器裂罅', None),
    'affixes': ('词条', None),
    'cap': ('（满档 ', None),
    'disposition': (' · 倾向 ', None),
    'locked': ('已锁定', None),
    'unlocked': ('未锁定', None),
    'dismantle_return': ('\n分解后获得 ', None),
    'reward_separator': ('、', None),
    'reward_number': (' ×', None),
    'fragments': ('裂罅碎片', None),
    'dismantle_empty': ('\n分解后无返还', None),
    'inactive': ('未生效', None),
    'weapon_cards': ('该武器的裂罅 ', None),
    'card_unit': (' 张', None),
}

TEXT = {key: original if current is None else current
        for key, (original, current) in COPY.items()}
BASE_TEXT = {original: key for key, (original, current) in COPY.items()
             if original is not None}


def value(key):
    return TEXT[key]
