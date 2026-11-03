"""原方法逐字节恢复、执行轨迹保持和实际缺失格子回归。"""
import itertools

import asm
from materials.runtime import world as material_world
from .patches import TARGET, AT, COUNT, LOCKS
from .runtime import World, VM, SETUP, body, status


def behavioral_suite(before, after):
    """此函数仅行为断言；变异测试不得用字节锁/插入形状作为判红依据。"""
    parity, changed = [], []
    patterns = ([0, 0, 0, 0], [1, 2, 3, 4], [9, 0, 8, 0], [0, 3, 0, 2])
    for count, step, numbers in itertools.product(range(5), range(9), patterns):
        info = status(count, step, numbers=numbers[:count])
        old, new = World(before, count), World(after, count)
        old.apply(info)
        new.apply(info)
        assert new.snapshot() == old.snapshot(), ('完整格子旧行为', count, step, numbers)
        parity.append({'count': count, 'step': step, 'numbers': numbers[:count]})
    # 除真实 1->2 外涵盖 0 格、较少/较多格和中间 null 洞，确保跳过后继续后续有效格。
    for slots, count, holes in itertools.product(range(5), range(5), [(), (0,), (1,), (0, 2)]):
        new = World(after, slots, holes)
        info = status(count, numbers=[0, 3, 0, 8][:count])
        new.apply(info)
        expected = []
        for i in range(min(slots, count)):
            if i not in holes:
                n = info['items'][i]['ownNumber']
                expected.extend([[i, 'number', n], [i, 'gray', n == 0]])
        assert new.calls == expected, ('跳过缺失但继续更新', slots, count, holes, new.calls, expected)
        assert len(new.view['itemThumbnails']) == slots
        assert len(new.texts) == 3
        changed.append({'slots': slots, 'items': count, 'null_indices': list(holes)})
    incident = incident_case(before, after)
    return {'old_parity_checks': parity, 'new_checks': changed,
            'old_parity_count': len(parity), 'new_check_count': len(changed) + 1,
            'incident_reproduction': incident}


def incident_case(before, after):
    # 无 wfx_overlimit_full 键；使用 O11 对 3 与 4 的两种合法传输对象形状。
    ordinary_crystal, full_crystal, core = 10003, 10000320, 10000302
    open_info = status(1, 3, numbers=[5], ids=[ordinary_crystal])
    update_info = status(2, 4, numbers=[4, 0], ids=[full_crystal, core])
    old = World(before, logic_ids=[ordinary_crystal])
    new = World(after, logic_ids=[ordinary_crystal])
    for world in (old, new):
        world.run(SETUP, world.view, open_info)
        world.apply(open_info)
        world.calls.clear()
    try:
        old.apply(update_info)
    except KeyError as exc:
        assert 'null has no property showNumber' in str(exc)
        error = str(exc)
    else:
        raise AssertionError('原 v35g 未复现缺第二格异常')
    new.apply(update_info)
    assert new.calls == [[0, 'number', 4], [0, 'gray', False]]
    assert len(new.view['itemThumbnails']) == 1
    assert new.texts['root/bottom_left/information/over_limit'] == '4'
    # 重开时 O10 创建两个按钮模型；原生 setup 本身保持不变并正常建两格。
    reopened = World(after, logic_ids=[full_crystal, core])
    reopened.run(SETUP, reopened.view, update_info)
    reopened.apply(update_info)
    assert len(reopened.view['itemThumbnails']) == 2
    assert reopened.view['itemThumbnails'][1]['gray'] is True
    # 直接在旧窗口调用原 setup 会触达原生未注册按钮异常，不能以空 stub 掩盖。
    unsafe = World(before, logic_ids=[ordinary_crystal])
    unsafe.run(SETUP, unsafe.view, open_info)
    try:
        unsafe.run(SETUP, unsafe.view, update_info)
    except VM.AvmThrow as exc:
        unsafe_error = exc.value
        assert '登録されていないボタン' in unsafe_error['message']
    else:
        raise AssertionError('原生重建应在新按钮未注册时拒绝')
    return {'fixture': 'character-independent status-object shape', 'full_key_present': False,
            'old_error': error, 'fixed_same_window_slots': 1, 'reopened_slots': 2,
            'same_window_updates': new.calls, 'unsafe_native_rebuild_error': unsafe_error,
            'source_shape': 'O10/O11 第3次单结晶，第4次超限结晶加核；主表与像素资源为夹具'}


def integrated_status_suite(before, after):
    rows = []
    for cid in (111183, 141099):
        worlds = []
        for abc in (before, after):
            _, char, _, logic_window, _, _, _ = material_world(abc, step=3, key=None, cid=cid)
            logic_window['run']()  # 执行真实O10，以窗口打开时的模型清单初始化UI边界。
            first = logic_window['getStatusInformation']()
            ids = [value - 33554432 for value in logic_window['buttonGroup']['ids']
                   if 33554432 <= value < 50331648]
            ui = World(abc, logic_ids=ids)
            ui.run(SETUP, ui.view, first)
            ui.apply(first)
            ui.calls.clear()
            char['overLimitStep'] = 4  # 同一持有角色对象、同一逻辑窗口、同一视图。
            second = logic_window['getStatusInformation']()
            assert [x['id'] for x in first['items']] == [10003]
            assert [x['id'] for x in second['items']] == [10000320, 10000302]
            worlds.append((ui, first, second, ids))
        old, new = worlds
        assert old[1:] == new[1:]
        try:
            old[0].apply(old[2])
        except KeyError as exc:
            assert 'null has no property showNumber' in str(exc)
        else:
            raise AssertionError('真实O11未重现旧崩溃')
        new[0].apply(new[2])
        assert new[0].calls == [[0, 'number', 9], [0, 'gray', False]]
        assert len(new[0].view['itemThumbnails']) == 1
        rows.append({'cid': cid, 'key': None, 'step_transition': [3, 4],
                     'real_o10_ids': new[3], 'real_o11_item_ids': [x['id'] for x in new[2]['items']],
                     'same_window_slots': 1, 'result': 'original-null-call / fixed-pass'})
    for step in range(9):
        _, _, _, logic_window, _, _, _ = material_world(after, step=step, key='1', cid=129989, cores=0)
        logic_window['run']()
        info = logic_window['getStatusInformation']()
        ids = [value - 33554432 for value in logic_window['buttonGroup']['ids']
               if 33554432 <= value < 50331648]
        assert ids == [10000320, 10000302]
        assert [x['id'] for x in info['items']] == ids
        ui = World(after, logic_ids=ids)
        ui.run(SETUP, ui.view, info)
        ui.apply(info)
        assert len(ui.view['itemThumbnails']) == 2
        assert [x['gray'] for x in ui.view['itemThumbnails']] == [False, True]
        rows.append({'cid': 129989, 'key': '1', 'step': step, 'real_o10_ids': ids,
                     'real_o11_item_ids': ids, 'slots': 2, 'core_zero_grayed': True})
    return rows


def preservation(before, after):
    old, new = body(before, TARGET), body(after, TARGET)
    assert old[1:5] == new[1:5] == LOCKS[TARGET]['header']
    assert asm.unsplice_many(new[5], [(AT, COUNT, asm.FORBID)]) == old[5]
    traces = 0
    for count in range(5):
        for numbers in ([0] * count, list(range(count))):
            info = status(count, numbers=numbers)
            a, b = World(before, count), World(after, count)
            a.apply(info)
            b.apply(info)
            actual = b.machines[-1][1].trace
            kept = [pc if pc < AT else pc - COUNT for pc in actual if pc not in range(AT, AT + COUNT)]
            assert kept == a.machines[-1][1].trace, ('数量相同原执行轨迹', count, numbers)
            traces += 1
    return {'original_code_exactly_restored': True, 'headers_unchanged': True,
            'old_instruction_trace_parity_cases': traces}


def suite(before, after):
    result = behavioral_suite(before, after)
    result['preservation'] = preservation(before, after)
    result['integrated_real_o10_o11'] = integrated_status_suite(before, after)
    result['new_check_count'] += len(result['integrated_real_o10_o11'])
    return result
