"""首个15帧自动flush：三Battle实际proceed与sampler/transport连续执行。"""
import copy
import json
import bootstrap
from fp_test_vm import VM, make_world
from scale_fixtures import make_battle
from test_fp_core import call, proceed_fixture, scene_fixture
from test_fp_transport import compact


def run_flow(abc, case):
    fallback = VM._lookup
    def lookup(obj, key):
        name = str(key).split('::')[-1]
        if isinstance(obj, str):
            raw = obj.encode('utf-16-le', 'surrogatepass')
            if name == 'length': return len(raw) // 2
            if name == 'charCodeAt': return lambda i: int.from_bytes(raw[int(i)*2:int(i)*2+2], 'little')
            if name == 'slice': return lambda a, b: raw[int(a)*2:int(b)*2].decode('utf-16-le', 'surrogatepass')
        return fallback(obj, key)
    VM._lookup = lookup
    try:
        world = make_world(abc)
        world.lex['JSON']['stringify'] = compact
        world.lex['BattleNotifyMessage'] = VM.Cls('BattleNotifyMessage',
            lambda tag, index, params: {'tag': tag, 'index': index, 'params': params})
        clock = [0]
        world.lex['flash.utils::getTimer'] = {'getTimer': lambda: clock[0]}
        scene = scene_fixture()
        sent = []
        tx = scene['battleTransmitter']['params'][0]
        connection = tx['connection']
        connection.update(waitingFinalizeResponse=False,
                          serializeManager={'battleSerializer': {'serialize': lambda value: compact(value)}})
        connection['connection']['send'] = sent.append
        tx['notify'] = lambda msg: world.run('BattleConnection/send', connection, {'index': 0, 'params': [msg]})
        battles = [make_battle(case, i) for i in range(3)]
        outputs = []
        for i, battle in enumerate(battles):
            first = next(iter(battle['zoneManager']['state']['params'][0]['enemyManager']['enemies']['h'].values()))
            first['hitCountCheck']['gauge']['trialProgress']['h'][7] = 0
            output, _, _ = proceed_fixture(world, battle)
            battle['primary'] = i == 0
            outputs.append(output)
            state = call(world, 'wfxFpBind', battle, scene)
            assert state is not None
        ctx = state['ctx']
        for frame in range(15):
            clock[0] = int((frame + 1) * 1000 / 60)
            for battle, output in zip(battles, outputs):
                assert world.run('Battle/proceed', battle) is output
            if frame < 14:
                assert ctx['seq'] == 0 and not sent, 'flush before own frame15'
        assert [b['currentFrame'] for b in battles] == [15, 15, 15]
        assert ctx['seq'] == 1 and not ctx['gaps'], {'seq': ctx['seq'], 'gaps': ctx['gaps']}
        assert len(ctx['rows']) == 2, 'replica frame15 remains for next batch when own proceeds first'
        staged = [json.loads(s)[1][1] for s in sent] + [copy.deepcopy(e['payload']) for e in ctx['sendQueue']]
        assert len(staged) == staged[0]['parts']
        while ctx['sendQueue']:
            clock[0] += 250
            call(world, 'wfxFpDrain', ctx)
            assert clock[0] < 120000
        from test_scale_acceptance import reassemble
        logical, sizes = reassemble(sent)
        assert len(logical['rows']) == 46
        assert sum(r['phase'] == 'initial' for r in logical['rows']) == 3
        assert len({r['battleId'] for r in logical['rows']}) == 3
        assert not logical['gaps']
        return {'name': case['name'] + '_actual_proceed15_primary_first',
                'battle_proceed_calls': 45, 'rows_in_seq0': 46, 'pending_replica_rows': 2,
                'logical_utf8': len(compact(logical).encode('utf-8')),
                'parts': len(sizes), 'max_wire_utf8_plus_nul': max(sizes),
                'total_wire_utf8_plus_nul': sum(sizes), 'drain_end_ms': clock[0],
                'scope': '真实Battle.proceed/采样/自动flush/transport；每Battle固定输入与显式模拟推进回调；不冒称完整物理战斗。'}, world.executed
    finally:
        VM._lookup = fallback
