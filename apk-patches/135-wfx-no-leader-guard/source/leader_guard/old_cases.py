"""首位 Some 时对照 v35f 的完整分发、共鸣、面板和资源调用链。"""
from .runtime import world, capture, FIXTURE

KEY = 'wfx_unlock_111001'
LAYOUTS = {'mixed': [0, 1, 2, 0, 1, 3], 'five': [1, 1, 1, 1, 1, 0],
           'six_water': [1] * 6, 'six_fire': [0] * 6}


def run(before, after, ok, remember):
    examples = {}
    # 0..31 每一掩码均走所有主位完整分发，不只检查 wfxPartyMask 返回值。
    for layout, elements in LAYOUTS.items():
        for mask in range(32):
            table = {KEY: str(mask)}
            a, ae, ap, am, au = capture(before, table, elements, restricted=True)
            b, be, bp, bm, bu = capture(after, table, elements, restricted=True)
            for field in a:
                ok(f'Some/mask{mask}/{layout}/{field}', b[field], a[field], True)
            ok(f'Some/mask{mask}/{layout}/六角色实际mask',
               [c['wfxPartyMask']() for c in bm + bu],
               [c['wfxPartyMask']() for c in am + au], True)
            ok(f'Some/mask{mask}/{layout}/原生共鸣',
               bp['getNumberOfSameElement'](), ap['getNumberOfSameElement'](), True)
            remember(be)
            if mask in (0, 7, 27, 31):
                examples[f'{mask}/{layout}'] = b
    for table, kw in [({}, {}), ({KEY: '31'}, {'loaded': False}),
                      ({KEY: '31'}, {'missing_leader': True}),
                      ({KEY: '31'}, {'empty_unison': True}),
                      ({KEY: '31'}, {'learned': False}),
                      ({'wfx_unlock_121001': '31'}, {})]:
        a, *_ = capture(before, table, **kw)
        b, be, *_ = capture(after, table, **kw)
        ok('Some/边界/' + str((table, kw)), b, a, True)
        remember(be)
    for text in ('', 'x', '-1', '1.5', 'NaN', 'Infinity', '2147483648', '32', '39', '59'):
        a, _, am, au = world(before, {KEY: text}, LAYOUTS['six_water'])
        b, _, bm, bu = world(after, {KEY: text}, LAYOUTS['six_water'])
        ok('Some/解析/' + text, [c['wfxPartyMask']() for c in bm + bu],
           [c['wfxPartyMask']() for c in am + au], True)
        ok('Some/解析读表/' + text, b.reads, a.reads, True)
        remember(b)
    # 六能力槽逐一检查主/合击，两侧均解释原方法及真实 get_leaderCharacter。
    for slot in range(1, 7):
        for learned in (False, True):
            for loaded in (False, True):
                for key_value in (None, '1', '2'):
                    table = {}
                    if key_value is not None:
                        for cid in FIXTURE['main_ids'] + FIXTURE['unison_ids']:
                            aid = FIXTURE['character'][cid][0][18 + slot]
                            table['wfx_adaptive_' + aid] = key_value
                    a, _, am, au = world(before, table, learned=learned, loaded=loaded)
                    b, _, bm, bu = world(after, table, learned=learned, loaded=loaded)
                    name = f'Some/adaptive槽{slot}/学习{learned}/表{loaded}/键{key_value}'
                    for method in ('wfxAdaptiveElement', 'getElement', 'get_element'):
                        ok(name + '/' + method, [c[method]() for c in bm + bu],
                           [c[method]() for c in am + au], True)
                    owners = lambda chars: [[x['params'][0]['ownerElement']
                        for x in c['getSelfAbilitySlots'](True) if x['index'] == 0] for c in chars]
                    ok(name + '/能力ownerElement', owners(bm + bu), owners(am + au), True)
                    ok(name + '/读表顺序', b.reads, a.reads, True)
                    remember(b)
    return examples
