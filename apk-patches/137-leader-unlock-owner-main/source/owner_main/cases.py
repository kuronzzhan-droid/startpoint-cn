"""202 的掩码、槽位、能力来源与原生限制矩阵。"""
import bodies
from .runtime import (COUNT, MATCH, PANEL, REASON, KEY, LAYOUTS, enum,
                      snapshot, world, panel, battle, none)


def enabled(mask, layout, slot):
    return bool(mask & 1 and (not mask & 8 or slot == 0)
                and (not mask & 16 or layout.startswith('six')))


def suite(before, after, quick=False):
    old, new, executed, examples = [], [], set(), {}

    def ok(name, actual, expected=True, legacy=False):
        assert actual == expected, (name, actual, expected)
        (old if legacy else new).append(name)

    masks = (0, 1, 2, 8, 9, 16, 17, 19, 27, 31) if quick else range(32)
    layouts = ('five', 'six_water') if quick else LAYOUTS
    for layout in layouts:
        for mask in masks:
            for slot in range(3):
                table = {KEY: str(mask)}
                allow = enabled(mask, layout, slot)
                result, e = snapshot(after, table, layout, slot)
                prefix = f'mask={mask}/{layout}/slot={slot}'
                for field in ('count', 'battle', 'during', 'initial'):
                    ok(prefix + '/' + field, result[field], int(allow))
                active = result['panel']['triggerableAbilities']
                disabled = result['panel']['notTriggerableAbilities']
                ok(prefix + '/发动列表', len(active), int(allow))
                ok(prefix + '/未激活列表', len(disabled), int(not allow))
                ok(prefix + '/DisabledReason', [r['reasons'] for r in active + disabled],
                   [[]] if allow else [['ability_disabled_reason_not_main_character']])
                executed.update(e.executed)
                if not allow:
                    prior, _ = snapshot(before, table, layout, slot)
                    ok(prefix + '/v35h完整结果', result, prior, True)
                if mask in (27, 31):
                    examples[prefix] = result
                if quick:
                    continue
                second, e = snapshot(after, table, layout, slot, kinds=(11, enum(13, 6)))
                expected = int(allow and layout.startswith('six'))
                for field in ('battle', 'during', 'initial'):
                    ok(prefix + '/202及208/' + field, second[field], expected)
                ok(prefix + '/202及208/面板', len(second['panel']['triggerableAbilities']), expected)
                executed.update(e.executed)

    for text in (None, '', 'x', '-1', '1.5', 'NaN', 'Infinity', '2147483648', '32'):
        table = {} if text is None else {KEY: text}
        a, _ = snapshot(before, table)
        b, e = snapshot(after, table)
        ok('无键或非法掩码/' + str(text), b, a, True)
        executed.update(e.executed)
    for kw in ({'loaded': False}, {'missing_leader': True}, {'empty_unison': True}):
        a, _ = snapshot(before, {KEY: '27'}, **kw)
        b, e = snapshot(after, {KEY: '27'}, **kw)
        ok('缺省安全/' + str(kw), b, a, True)
        executed.update(e.executed)

    # origin来自实际BattleAbilitySource.add参数；this保持所在主位对象。
    for origin in (1000, 6000, 21000, 1000999, 1001000, 1006999, 1007000,
                   1011000, 1021000, 1022000, 1023000, 1031000):
        e, p, mains, _ = world(after, {KEY: '27'})
        ae, ap, am, _ = world(before, {KEY: '27'})
        allow = 1001000 <= origin < 1007000
        for mode in ('initial', 'battle', 'during'):
            actual = battle(e, p, mains[0], origin, (11,), mode)
            expected = 1 if allow else battle(ae, ap, am[0], origin, (11,), mode)
            ok(f'能力来源/{origin}/{mode}', actual, expected, not allow)
        executed.update(e.executed)
    for number in range(8):
        for origin_kind in (0, 2, 3, 4):
            for unisonable in (False, True):
                e, p, mains, _ = world(after, {KEY: '27'})
                ae, ap, am, _ = world(before, {KEY: '27'})
                kw = dict(number=number, origin_kind=origin_kind, unisonable=unisonable)
                result = panel(e, p, mains, **kw)
                allow = origin_kind == 0 and 1 <= number <= 6
                if allow:
                    ok(f'面板自身槽/{kw}', len(result['triggerableAbilities']), 1)
                else:
                    ok(f'面板非自身/{kw}', result, panel(ae, ap, am, **kw), True)
                executed.update(e.executed)
    from .cases_edges import edges
    edges(before, after, ok, executed)
    from .cases_integration import integration
    integration(before, after, ok, executed)
    from .cases_lifecycle import lifecycle
    lifecycle(before, after, ok, executed)
    return {'status': 'pass', 'old_parity_count': len(old), 'old_parity_checks': old,
            'new_check_count': len(new), 'new_checks': new,
            'executed_method_ids': sorted(executed), 'examples': examples}
