"""独立验收的计数/时钟外围；复用既有 AVM2，不替换任何生产助手。"""
import copy
from collections import Counter
import bootstrap
import asm
from fp_test_vm import Machine, VM, make_world
from test_fp_core import scene_fixture
from test_fp_transport import compact


_machine_run = Machine.run


def counted_machine_run(self, *args, **kwargs):
    # Large asset-constrained collections legitimately execute more than the
    # inherited toy fixture's 200k instructions in a single hash helper.
    self.max_steps = 5_000_000
    try:
        return _machine_run(self, *args, **kwargs)
    finally:
        if hasattr(self.world, 'instruction_count'):
            self.world.instruction_count += self.steps


Machine.run = counted_machine_run
_lookup = VM._lookup


def utf16_lookup(obj, key):
    name = str(key).split('::')[-1]
    if isinstance(obj, str):
        raw = obj.encode('utf-16-le', 'surrogatepass')
        if name == 'length': return len(raw) // 2
        if name == 'charCodeAt':
            return lambda i: int.from_bytes(raw[int(i)*2:int(i)*2+2], 'little')
        if name == 'slice':
            return lambda a, b: raw[int(a)*2:int(b)*2].decode('utf-16-le', 'surrogatepass')
    return _lookup(obj, key)


VM._lookup = utf16_lookup


def measured_world(abc, enabled=True):
    world = make_world(abc)
    world.instruction_count = 0
    world.calls = Counter()
    world.costs = []
    world.rows = []
    world.events = []
    world.now = 0
    world.sent = []
    world.json_calls = 0
    world.timer_calls = 0
    world.lex['Battle']['wfxFpEnabled'] = enabled
    world.lex['Battle']['wfxFpUplink'] = None
    original = world.run

    def run(label, this, *args):
        world.calls[label] += 1
        start = world.instruction_count
        result = original(label, this, *args)
        if label == 'Battle$/wfxFpQueue' and args[1] == 'rows':
            world.rows.append(copy.deepcopy(args[2]))
        if label == 'Battle$/wfxFpQueue' and args[1] == 'events':
            world.events.append(copy.deepcopy(args[2]))
        if label in ('Battle$/wfxFpSample', 'Battle$/wfxFpSnapshot',
                     'Battle$/wfxFpCompactSnapshot', 'Battle$/wfxFpCaptureInputs'):
            world.costs.append((label, world.instruction_count-start))
        return result

    def stringify(value):
        world.json_calls += 1
        return compact(value)

    def timer():
        world.timer_calls += 1
        return world.now

    world.run = run
    world.lex['JSON']['stringify'] = stringify
    world.lex['flash.utils::getTimer'] = {'getTimer': timer}
    world.lex['BattleNotifyMessage'] = VM.Cls('BattleNotifyMessage',
        lambda tag, index, params: {'tag': tag, 'index': index, 'params': params})
    return world


def connected_scene(world):
    scene = scene_fixture()
    scene['battleSocketContact'] = {}
    tx = scene['battleTransmitter']['params'][0]
    connection = tx['connection']
    connection.update(waitingFinalizeResponse=False,
        serializeManager={'battleSerializer': {'serialize': compact}})
    connection['connection']['send'] = lambda wire: world.sent.append((world.now, wire))
    tx['notify'] = lambda value: world.run('BattleConnection/send', connection,
                                          {'index': 0, 'params': [value]})
    return scene


def wire_size(wire):
    return len(wire.encode('utf-8')) + 1


def rolling_max(sent):
    """任何半开 [t,t+1000) 窗口的精确上界；事件时间即足够枚举的边界。"""
    ordered = sorted((t, wire_size(wire)) for t, wire in sent)
    left = total = maximum = 0
    for right, (time, size) in enumerate(ordered):
        total += size
        while time - ordered[left][0] >= 1000:
            total -= ordered[left][1]
            left += 1
        maximum = max(maximum, total)
    return maximum


def override_constant(world, method, old, new):
    body = world.abc.bodies[world.labels['Battle$/' + method]]
    ins = asm.decode(body[5])
    count = 0
    for i in ins:
        if i.name == 'pushshort' and i.args == [old]:
            i.args[0] = new
            count += 1
        elif i.name == 'pushbyte' and i.args == [old]:
            i.args[0] = new
            count += 1
    assert count, (method, old, 'mutation anchor missing')
    world.overrides['Battle$/' + method] = ins
    return count
