"""显示旧行为完整对照及新增格式边界；期待值独立逐例列出。"""
from hidden_icons.runtime import World, LIST, TOTAL, observe

OLD_STRINGS = [
    '', 'normal', 'hidden_', 'hidden_name', 'hidden_wfx:24:0:2500:0:x',
    'hidden', 'Hidden_x', 'HIDDEN_x', '_hidden_x', 'xhidden_x', ' hidden_x',
    '普通状态', '隐藏hidden_x', 'wfx', 'wfx:', 'wfx:24', 'wfx:24:0',
    'wfx:24:0:2500', 'wfx:24:0:2500:0', 'wfx:24:0:2500:0:',
    'wfx:24:0:2500:0:normal', 'wfx:24:0:2500:0:Hidden_x',
    'wfx:24:0:2500:0:xhidden_x', 'wfx:24:0:2500:0: hidden_x',
    'wfx:24:0:2500:0:normal:hidden_x', 'WFX:24:0:2500:0:hidden_x',
    'prefix:wfx:24:0:2500:0:hidden_x', ':wfx:24:0:2500:0:hidden_x',
    'wfx2:24:0:2500:0:hidden_x', 'wfx:24:0:2500:hidden_x:normal',
    'wfx:hidden_x:0:2500:0:normal', None,
]

# (名称, string_id, 是否应显示)；不是复刻实现中的字符串判断算法。
NEW_CASES = [
    ('example_hidden', 'wfx:24:0:2500:0:hidden_kyle_base_plus', False),
    ('example_visible', 'wfx:24:0:2500:0:kyle_base_plus', True),
    ('prefix_only', 'wfx:24:0:2500:0:hidden_', False),
    ('prefix_unicode', 'wfx:24:0:2500:0:hidden_中文', False),
    ('extra_segment_hidden', 'wfx:24:0:2500:0:hidden_a:extra', False),
    ('extra_segment_empty', 'wfx:24:0:2500:0:hidden_a:', False),
    ('extra_segment_not_label', 'wfx:24:0:2500:0:ordinary:hidden_x', True),
    ('extra_segment_empty_label', 'wfx:24:0:2500:0::hidden_x', True),
    ('label_uppercase', 'wfx:24:0:2500:0:HIDDEN_a', True),
    ('label_capitalized', 'wfx:24:0:2500:0:Hidden_a', True),
    ('label_prefix_not_start', 'wfx:24:0:2500:0:xhidden_a', True),
    ('label_space', 'wfx:24:0:2500:0: hidden_a', True),
    ('label_short_prefix', 'wfx:24:0:2500:0:hidden', True),
    ('label_empty', 'wfx:24:0:2500:0:', True),
    ('missing_label', 'wfx:24:0:2500:0', True),
    ('only_wfx', 'wfx:', True),
    ('short_2', 'wfx:hidden_x', True),
    ('short_3', 'wfx:24:hidden_x', True),
    ('short_4', 'wfx:24:0:hidden_x', True),
    ('short_5', 'wfx:24:0:2500:hidden_x', True),
    ('first_segment_uppercase', 'WFX:24:0:2500:0:hidden_a', True),
    ('first_segment_suffix', 'wfx2:24:0:2500:0:hidden_a', True),
    ('not_first_segment', 'x:wfx:24:0:2500:0:hidden_a', True),
    ('embedded_prefix', 'xwfx:24:0:2500:0:hidden_a', True),
    ('leading_space', ' wfx:24:0:2500:0:hidden_a', True),
    ('empty_numeric_segments', 'wfx:::::hidden_a', False),
    ('malformed_numeric_segments', 'wfx:bad:a:value:flags:hidden_a', False),
    ('unregistered_code', 'wfx:999:0:1:0:hidden_a', False),
    ('code28_negative_flags', 'wfx:28:129997:2700:-1:hidden_a', False),
    ('code29_hidden', 'wfx:29:129997:300:11:hidden_a', False),
    ('arg_contains_prefix', 'wfx:24:hidden_a:2500:0:ordinary', True),
    ('value_contains_prefix', 'wfx:24:0:hidden_a:0:ordinary', True),
    ('flags_contains_prefix', 'wfx:24:0:2500:hidden_a:ordinary', True),
    ('legacy_prefix', 'hidden_old', False),
    ('legacy_empty_suffix', 'hidden_', False),
    ('empty_string', '', True),
]


def fixture(abc, text, outer=False, overrides=None, missing=False, loaded=True,
            content=31):
    world = World(abc, {} if missing else {1: text}, loaded, overrides)
    subject = world.condition(1, 7, content=content, tag='subject', added=8)
    ordinary = world.condition(88, 3, content=2, tag='ordinary', added=2)
    member = world.member_for_display([ordinary] if outer else [subject, ordinary],
                                      outer=[subject] if outer else [])
    return world, member


def regression(before, after, overrides=None):
    checks = []
    for index, text in enumerate(OLD_STRINGS):
        for outer in (False, True):
            for method in (LIST, TOTAL):
                outcomes = []
                for abc, changes in ((before, None), (after, overrides)):
                    world, member = fixture(abc, text, outer, changes)
                    outcomes.append(observe(world, member, method))
                assert outcomes[0] == outcomes[1], (text, outer, method, outcomes)
                checks.append({'name': f'old.{index}.outer={outer}.{method}',
                               'string_id': text, 'outcome': outcomes[1]})
    for name, options in [
            ('missing_row', {'missing': True}), ('no_table', {'loaded': False}),
            ('non_unique', {'content': 2}), ('non_unique_missing', {'content': 2, 'missing': True})]:
        for method in (LIST, TOTAL):
            outcomes = []
            for abc, changes in ((before, None), (after, overrides)):
                world, member = fixture(abc, 'wfx:24:0:2500:0:hidden_new', overrides=changes, **options)
                outcomes.append(observe(world, member, method))
            assert outcomes[0] == outcomes[1], (name, outcomes)
            checks.append({'name': name + '.' + method, 'outcome': outcomes[1]})
    for loaded in (False, True):
        for method in (LIST, TOTAL):
            outcomes = []
            for abc, changes in ((before, None), (after, overrides)):
                world = World(abc, loaded=loaded, overrides=changes)
                outcomes.append(observe(world, world.member_for_display(), method))
            assert outcomes[0] == outcomes[1], outcomes
            checks.append({'name': f'empty.loaded={loaded}.{method}', 'outcome': outcomes[1]})
    return checks


def behavior(after, overrides=None):
    checks = []
    for name, text, visible in NEW_CASES:
        for outer in (False, True):
            for method in (LIST, TOTAL):
                world, member = fixture(after, text, outer, overrides)
                result = observe(world, member, method)
                expected = (['ordinary', 'subject'] if outer else ['subject', 'ordinary']) if visible else ['ordinary']
                if method == TOTAL:
                    expected = len(expected)
                assert result['status'] == 'value' and result['value'] == expected, (name, outer, method, result, expected)
                assert LIST in world.executed
                assert 'ConditionSlot/getConditionsIncludingOuterEnvironments' in world.executed
                if outer:
                    assert 'ConditionSlot/sortByAddedTime' in world.executed
                if method == TOTAL:
                    assert 'ConditionSlot/getTotalNumberOfConditionsIncludingOuterEnvironments' in world.executed
                    assert 'ConditionSlot/getTotalNumberOfConditions' in world.executed
                checks.append({'name': f'{name}.outer={outer}.{method}', 'expected': expected,
                               'outcome': result, 'state_and_identity_unchanged': True})
    # 多状态、两来源、重复层数与不可见槽；同时证明过滤列表和翻页计数一致。
    world = World(after, {1: 'wfx:24:0:2500:0:hidden_self', 2: 'wfx:24:0:1000:0:normal',
                         3: 'hidden_old', 4: 'wfx:29:129997:300:11:hidden_squad',
                         5: 'normal', 6: 'wfx:24:0:50:0:hidden_invisible'}, overrides=overrides)
    make = lambda uid, layer, tag, added: world.condition(uid, layer, tag=tag, added=added)
    member = world.member_for_display(
        [make(1, 7, 'own-hidden', 3), make(2, 2, 'own-visible', 8), make(3, 4, 'old-hidden', 5)],
        [make(4, 11, 'outer-hidden', 1), make(5, 9, 'outer-visible', 2)],
        [make(6, 13, 'invisible', 4)])
    listing, total = observe(world, member, LIST), observe(world, member, TOTAL)
    assert listing['status'] == 'value' and listing['value'] == ['outer-visible', 'own-visible'], listing
    assert total['status'] == 'value' and total['value'] == 2, total
    checks.append({'name': 'mixed_sources.hidden_visibility_and_page_count',
                   'list': listing, 'total': total, 'state_and_identity_unchanged': True})
    return checks
