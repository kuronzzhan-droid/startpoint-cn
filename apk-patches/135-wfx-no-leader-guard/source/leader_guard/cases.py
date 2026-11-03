"""首位 None 安全矩阵、真实 C2330 事故重现及旧行为逐项对照。"""
import asm
import bodies
from .runtime import world, FIXTURE, some, none, client_error, NATIVE
from party.consumers import enum
from .patches import TARGETS, ADAPTIVE, MASK, INSERTIONS
from .old_cases import run as old_cases, KEY


def body(abc, label):
    return abc.bodies[bodies.resolve(abc, label)]


def suite(before, after):
    old, new, executed = [], [], set()

    def ok(name, actual, expected=True, legacy=False):
        assert actual == expected, (name, actual, expected)
        (old if legacy else new).append(name)

    def remember(e):
        executed.update(e.executed)

    examples = old_cases(before, after, ok, remember)
    native_id = body(after, NATIVE)[0]
    # 两侧皆执行真实原生 getter 的 Option.None/Some 分支，不用自制报错 lambda。
    native_errors = {}
    for version, abc in [('v35f', before), ('v35g', after)]:
        e, p, mains, _ = world(abc, first_some=False)
        error = client_error(p['get_leaderCharacter'])
        ok(version + '/原生None真实抛2330', error['code'], 2330)
        ok(version + '/原生getter字节码确实执行', body(abc, NATIVE)[0] in e.executed)
        native_errors[version] = error
        e, p, mains, _ = world(abc)
        ok(version + '/原生Some返回slot0', p['get_leaderCharacter']() is mains[0])
        remember(e)
    ok('原生getter完整方法记录不变', body(after, NATIVE), body(before, NATIVE))
    # 触发记录中的水杰拉德能力3键；原生完整BCL构造器仍为受控外围边界。
    incidents = {}
    for version, abc in [('v35f', before), ('v35g', after)]:
        e, p, mains, _ = world(abc, {'wfx_adaptive_1299893': '1'}, first_some=False)
        mains[1]['id'] = 129989
        mains[1]['values']['ability_3'] = some(1299893)
        if version == 'v35f':
            incidents[version] = client_error(mains[1]['get_element'])
            ok('事故v35f/get_element真实抛2330', incidents[version]['code'], 2330)
            ok('事故v35f/wfxPartyMask真实抛2330', client_error(mains[1]['wfxPartyMask'])['code'], 2330)
        else:
            incidents[version] = {'adaptive': mains[1]['wfxAdaptiveElement'](),
                                 'element': mains[1]['get_element'](),
                                 'mask': mains[1]['wfxPartyMask']()}
            ok('事故v35g/能力3回落原属性且无解锁', incidents[version],
               {'adaptive': -1, 'element': 1, 'mask': 0})
            ok('事故v35g/不调用原生getter', native_id not in e.executed)
            ok('事故v35g/不读自适应表', e.reads, [])
        remember(e)
    # 首位None，其余两个主位仍Some，专门覆盖误查slot1/slot2的变异。
    for slot in range(1, 7):
        for learned in (False, True):
            for loaded in (False, True):
                for value in (None, '1', '2'):
                    table = {}
                    if value is not None:
                        for cid in FIXTURE['main_ids'] + FIXTURE['unison_ids']:
                            aid = FIXTURE['character'][cid][0][18 + slot]
                            table['wfx_adaptive_' + aid] = value
                    e, p, mains, unisons = world(after, table, first_some=False,
                                                loaded=loaded, learned=learned)
                    chars = mains + unisons
                    name = f'None/adaptive槽{slot}/学习{learned}/表{loaded}/键{value}'
                    ok(name + '/六角色助手原出口', [c['wfxAdaptiveElement']() for c in chars], [-1] * 6)
                    originals = [c['squadMemberSourceValues']['element'] for c in chars]
                    ok(name + '/getElement回落原属性', [c['getElement']() for c in chars], originals)
                    ok(name + '/get_element缓存及回落', [c['get_element']() for c in chars], originals)
                    owners = [[x['params'][0]['ownerElement'] for x in c['getSelfAbilitySlots'](True)
                               if x['index'] == 0] for c in chars]
                    ok(name + '/真实AdaptiveSlots保持原属性', owners,
                       [[originals[i]] * len(row) for i, row in enumerate(owners)])
                    ok(name + '/不调用会抛错的原生getter', native_id not in e.executed)
                    ok(name + '/守卫发生在读表之前', e.reads, [])
                    remember(e)
    values = [str(mask) for mask in range(32)] + [None, '', 'x', '-1', '1.5', 'NaN',
              'Infinity', '2147483648', '32', '39', '59']
    for value in values:
        for loaded in (False, True):
            for learned in (False, True):
                table = {} if value is None else {KEY: value}
                e, p, mains, unisons = world(after, table, first_some=False,
                                            loaded=loaded, learned=learned)
                chars = mains + unisons
                name = f'None/mask{value}/表{loaded}/学习{learned}'
                ok(name + '/六角色均无解锁', [c['wfxPartyMask']() for c in chars], [0] * 6)
                ok(name + '/传递至额外队长技', [c['wfxExtraLeaders']() for c in chars], [[]] * 6)
                ok(name + '/不调用原生getter', native_id not in e.executed)
                ok(name + '/不读表', e.reads, [])
                remember(e)
    # 原getElement的kind720分支保留：无队长时自适应退出，继续原覆盖属性逻辑。
    for first_some in (False, True):
        for adaptive in (False, True):
            table = {'wfx_adaptive_1210021': '1'} if adaptive else {}
            e, _, _, unisons = world(after, table, first_some=first_some)
            e.lex['InitialAbilityTriggerKindTools'] = {'matchCharacter': lambda c, k: True}
            trigger = enum(0, {'content': enum(2, enum(1, enum(0), enum(36, 5))),
                              'preconditions': [], 'trigger': enum(0, 0, enum(0))})
            unisons[1]['getSelfAbilitySlots'] = lambda flag: [some({'getTriggers': lambda: [trigger]})]
            ok(f'原kind720回落/Some{first_some}/自适应{adaptive}',
               unisons[1]['get_element'](), 0 if first_some and adaptive else 5)
            if not first_some:
                ok('None原kind720回落不调用队长getter/' + str(adaptive), native_id not in e.executed)
            remember(e)
    for abc, version in [(before, 'v35f'), (after, 'v35g')]:
        e, _, mains, unisons = world(abc, {KEY: '31', 'wfx_adaptive_1210011': '1'})
        for char in mains + unisons:
            char['party'] = None
        ok(version + '/party空/自适应原出口', [c['wfxAdaptiveElement']() for c in mains + unisons], [-1] * 6)
        ok(version + '/party空/mask原出口', [c['wfxPartyMask']() for c in mains + unisons], [0] * 6)
        ok(version + '/party空/getElement', [c['get_element']() for c in mains + unisons], [0, 1, 2, 0, 1, 3])
        remember(e)
    # 与v35f完整方法记录的静态保持检查；行为断言与这些字节断言分别计数。
    for label in TARGETS:
        at, count = INSERTIONS[label]
        ok(label + '/移除守卫逐字节恢复原方法',
           asm.unsplice_many(body(after, label)[5], [(at, count, asm.FORBID)]), body(before, label)[5])
        ok(label + '/header逐字节保持', body(after, label)[1:5], body(before, label)[1:5])
        ok(label + '/已执行最终完整方法', body(after, label)[0] in executed)
    return {'status': 'pass', 'old_parity_count': len(old), 'old_parity_checks': old,
            'new_check_count': len(new), 'new_checks': new, 'examples': examples,
            'native_none_errors': native_errors, 'incident_reproduction': incidents,
            'executed_method_ids': sorted(executed),
            'sentinel': {'original_pushbyte_operand': 255, 'encoded_byte': 'ff',
                         'avm2_signed_integer_result': -1, 'old_exit_bytes_preserved': True}}
