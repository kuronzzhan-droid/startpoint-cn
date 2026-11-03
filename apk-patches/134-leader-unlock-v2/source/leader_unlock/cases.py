"""完整能力分发/面板/DSL预载旧行为对照及 v2 位组合。"""
from .runtime import capture, world, SAME, FIXTURE, none
from .patches import TARGETS, MASK, LEADERS, OPTIONS
import bodies

KEY = 'wfx_unlock_111001'
LAYOUTS = {'mixed': [0, 1, 2, 0, 1, 3], 'five': [1, 1, 1, 1, 1, 0],
           'six_water': [1] * 6, 'six_fire': [0] * 6}


def suite(before, after):
    old, new, executed = [], [], set()
    examples = {}

    def ok(name, actual, expected=True, legacy=False):
        assert actual == expected, (name, actual, expected)
        (old if legacy else new).append(name)

    # 旧开关0..7执行原/新完整调用链；显式断言未访问共鸣API。
    reference = {}
    for layout in ('mixed', 'six_water'):
        for mask in range(8):
            table = {KEY: str(mask)}
            a, _, _, _, _ = capture(before, table, LAYOUTS[layout], restricted=True)
            b, e, _, _, _ = capture(after, table, LAYOUTS[layout], restricted=True)
            for field in a:
                ok(f'旧值{mask}/{layout}/{field}', b[field], a[field], True)
            ok(f'旧值{mask}/{layout}/不增加共鸣查询',
               after.bodies[bodies.resolve(after, SAME)][0] not in e.executed,
               True, True)
            reference[layout, mask] = a
            executed.update(e.executed)

    for table, kw in [({}, {}), ({KEY: '3'}, {'loaded': False}),
                      ({KEY: '7'}, {'missing_leader': True}),
                      ({KEY: '7'}, {'empty_unison': True}),
                      ({KEY: '3'}, {'learned': False}),
                      ({'wfx_unlock_121001': '7', 'wfx_unlock_111002': '7'}, {})]:
        a, ae, _, _, _ = capture(before, table, **kw)
        b, be, _, _, _ = capture(after, table, **kw)
        ok(f'旧边界/{table}/{kw}', b, a, True)
        ok(f'旧读表顺序/{table}/{kw}', be.reads, ae.reads, True)
        executed.update(be.executed)

    # 所有新位单独/组合；expected调用旧引擎，各slot选取对应旧0..7模式。
    for layout, elements in LAYOUTS.items():
        expected_count = 6 if layout.startswith('six') else 5 if layout == 'five' else 2
        for mask in range(8, 32):
            result, e, p, mains, unisons = capture(after, {KEY: str(mask)}, elements, restricted=True)
            enabled = not (mask & 16) or expected_count >= 6
            per_slot = [((mask & 7) if enabled else 0),
                        ((mask & (4 if mask & 8 else 7)) if enabled else 0),
                        ((mask & (4 if mask & 8 else 7)) if enabled else 0)]
            key_layout = 'six_water' if layout.startswith('six') else 'mixed'
            expected = [reference[key_layout, effective]['rows'][slot]
                        for slot, effective in enumerate(per_slot)]
            ok(f'新mask{mask}/{layout}/完整分发', result['rows'], expected)
            ok(f'新mask{mask}/{layout}/面板', result['panel'], sum(expected, []))
            ok(f'新mask{mask}/{layout}/过滤分发', result['with_condition'], expected)
            ok(f'新mask{mask}/{layout}/预载', result['preloaded_ids'],
               sorted({row[1] for rows in expected for row in rows}))
            ok(f'新mask{mask}/{layout}/原生共鸣', p['getNumberOfSameElement'](), expected_count)
            ok(f'新mask{mask}/{layout}/有效掩码', mains[2]['wfxPartyMask'](), mask if enabled else 0)
            # 合击对象自己不能再追加队长技。
            ok(f'新mask{mask}/{layout}/合击对象不递归追加',
               [char['wfxExtraLeaders']() for char in unisons], [[], [], []])
            executed.update(e.executed)
            if mask in (8, 16, 27, 31):
                examples[f'{mask}/{layout}'] = result

    for text, expected in [('', 0), ('x', 0), ('-1', 0), ('1.5', 0), ('NaN', 0),
                           ('Infinity', 0), ('2147483648', 0), ('32', 0), ('39', 7), ('59', 27)]:
        e, p, mains, _ = world(after, {KEY: text}, LAYOUTS['six_water'])
        ok('解析保持/高位忽略/' + text, mains[0]['wfxPartyMask'](), expected)
        executed.update(e.executed)
    for kw in ({'loaded': False}, {'missing_leader': True}, {'empty_unison': True}):
        result, e, p, mains, _ = capture(after, {KEY: '27'}, LAYOUTS['six_water'], **kw)
        expected, _, _, _, _ = capture(before, {}, LAYOUTS['six_water'], **kw)
        ok('v2缺表/队长技/合击安全/' + str(kw), result, expected)
        executed.update(e.executed)
    e, _, mains, _ = world(after, {KEY: '27'}, LAYOUTS['six_water'])
    mains[0]['party'] = None
    ok('v2未关联队伍安全', mains[0]['wfxPartyMask'](), 0)
    executed.update(e.executed)
    e, _, mains, _ = world(after, {KEY: '27'}, LAYOUTS['six_water'])
    e.leader_ids.clear()
    ok('v2缺LeaderAbility表行安全', [char['wfxExtraLeaders']() for char in mains], [[], [], []])
    executed.update(e.executed)

    # 六属性由真实get_element及自适应读取，非测试夹具直接硬填统计值。
    table = {KEY: '27'}
    for cid in FIXTURE['main_ids'] + FIXTURE['unison_ids']:
        aid = FIXTURE['character'][cid][0][19]
        table['wfx_adaptive_' + aid] = '1'
    result, e, p, mains, _ = capture(after, table, LAYOUTS['mixed'], restricted=True)
    ok('自适应六同色原生共鸣', p['getNumberOfSameElement'](), 6)
    ok('自适应六同色v2生效', mains[0]['wfxPartyMask'](), 27)
    expected = [reference['mixed', mask]['rows'][slot] for slot, mask in enumerate((3, 0, 0))]
    ok('自适应slot0完整分发', result['rows'], expected)
    executed.update(e.executed)

    # 208对应的官方SameElement计数分支，阈值6时与bit16用同一原生方法。
    for layout in ('mixed', 'five', 'six_water'):
        e, p, mains, _ = world(after, {KEY: '27'}, LAYOUTS[layout])
        count = e.run('BattleCharacterLogic/getInstantAbiltyCountWithoutLimit', mains[0],
                      {'index': 13, 'params': [6]}, p, 0, 1000, False)
        expected = 1 if layout == 'six_water' else 0
        ok('原生208共鸣阈值/' + layout, count['params'][0], expected)
        ok('bit16与208同口径/' + layout, bool(mains[0]['wfxPartyMask']()), bool(expected))
        executed.update(e.executed)

    for label in TARGETS + [SAME]:
        ok('执行目标完整字节码/' + label, after.bodies[bodies.resolve(after, label)][0] in executed)
    return {'status': 'pass', 'old_parity_count': len(old), 'old_parity_checks': old,
            'new_check_count': len(new), 'new_checks': new,
            'executed_method_ids': sorted(executed), 'examples': examples}
