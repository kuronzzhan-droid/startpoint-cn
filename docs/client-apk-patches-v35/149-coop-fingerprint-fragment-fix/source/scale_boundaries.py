"""独立容量边界；2.2MiB字符串明确为合成压力，不冒充现场运行状态。"""
import copy
import types
import bootstrap
from swfabc import SwfAbc
from test_fp_transport import World, compact


def run_boundaries(abc, empty_row, transmit):
    evidence, executed = [], set()
    template = copy.deepcopy(empty_row)
    template['values']['/modifier/key'] = ''
    world = World(types.SimpleNamespace(abc=abc))
    ctx = world.context([template])
    envelope = world.call('wfxFpEnvelope', ctx, 0, 1, None,
                          {'rows': [template], 'events': [], 'gaps': []})
    base_size = len(compact([0, [5, envelope]]).encode('utf-8')) + 1
    assert base_size < 16384
    for target in (16384, 16385):
        row = copy.deepcopy(template)
        row['values']['/modifier/key'] = 'x' * (target - base_size)
        report, methods = transmit(abc, [row])
        assert (report['parts'] == 1) == (target == 16384)
        if target == 16384:
            assert report['max_wire_utf8_plus_nul'] == 16384
        report['name'] = 'unfragmented_wire_boundary_' + str(target)
        evidence.append(report)
        executed.update(methods)
    row = copy.deepcopy(template)
    row['values']['/modifier/key'] = 'x' * 2200000
    rows = [row]
    old = SwfAbc(bootstrap.BASE).abc
    old_world = World(types.SimpleNamespace(abc=old))
    old_ctx = old_world.context(copy.deepcopy(rows))
    assert old_world.call('wfxFpPack', old_ctx) is False
    assert old_ctx['seq'] == 1 and old_ctx['gaps'][0]['reason'] == 'oversize'
    assert not old_ctx['sendQueue']
    new_world = World(types.SimpleNamespace(abc=abc))
    if 'Battle$/wfxFpChunkEnd' not in new_world.labels:
        evidence.append({'name': 'synthetic_2200000_ascii_legacy_reproduction',
                         'legacy_oversize': True, 'logical_utf8': len(compact({'rows': rows, 'events': [], 'gaps': []}).encode('utf-8')),
                         'scope': '旧512x4096窗口上限的独立反例；不是现场原因证明。'})
    else:
        report, methods = transmit(abc, rows)
        report.update(name='synthetic_2200000_ascii_legacy_reproduction', legacy_oversize=True,
                      scope='相同合成逻辑数据由旧真实SWF丢弃、新真实SWF分片重组；不作为现场规模或首因证据。')
        evidence.append(report)
        executed.update(methods)
    return evidence, executed
