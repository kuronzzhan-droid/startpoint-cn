"""复用既有真实队伍与解释器；队长 getter 本身执行未修改原生字节码。"""
import sys

import bootstrap

for path in (bootstrap.RUN6, bootstrap.RUN2):
    if str(path) not in sys.path:
        sys.path.append(str(path))
from leader_unlock.runtime import world as previous_world, SAME
from party.worlds import summary, preload, FIXTURE
from party.runtime import VM, some, none

NATIVE = 'BattlePartyLogic/get_leaderCharacter'


def world(abc, table=None, elements=None, first_some=True, **kwargs):
    e, p, mains, unisons = previous_world(abc, table, elements, **kwargs)
    # 原生 getter 的 Some 路径仍构造 BCL；这里只替代该构造器的外围依赖。
    # values.characters 的内容与构造器首参相同，返回现有同值角色夹具。
    characters = mains + unisons
    by_values = {id(char['values']): char for char in characters}
    e.lex['BattleCharacterLogic'] = VM.Cls('BattleCharacterLogic',
        lambda values, assets, party, equipment, soul, index, is_unison: by_values[id(values)])
    e.lex['Boot'] = {}
    e.lex['Error'] = VM.Cls('Error', lambda: {'_type': 'Error'})
    e.lex['ClientError'] = VM.Cls('ClientError',
        lambda code, message: {'_type': 'ClientError', 'code': code, 'message': message})
    p.update(values={'characters': [some(char['values']) for char in mains]},
             getBattleEquipment=lambda index: none(), getAbilitySoul=lambda index: none())
    if not first_some:
        p['values']['characters'][0] = none()
    # 覆盖旧测试的 lambda:mains[0]；这里不能把报错模型写成测试 stub。
    e.bind(p, 'BattlePartyLogic', ['get_leaderCharacter'])
    return e, p, mains, unisons


def capture(abc, table=None, elements=None, **kwargs):
    e, p, mains, unisons = world(abc, table, elements, **kwargs)
    rows = [e.run('BattleCharacterLogic/getAvailableAbilities', char, p, i,
                 {'index': 9}, [none()] * 3)['records'] for i, char in enumerate(mains)]
    panel = summary(e, p, mains)
    e.preloads.clear()
    assets = sorted(set(preload(e, mains, unisons)))
    filtered = [e.run('BattleCharacterLogic/getAvailableAbilitiesWithCond', char, p, i,
                     lambda cond: True, [none()] * 3, False, False)['records']
                for i, char in enumerate(mains)]
    snapshot = {'rows': rows, 'panel': panel, 'preloaded_ids': assets,
                'with_condition': filtered, 'reads': e.reads.copy()}
    return snapshot, e, p, mains, unisons


def client_error(call):
    try:
        call()
    except VM.AvmThrow as exc:
        assert exc.value['_type'] == 'ClientError'
        assert exc.value['code'] == 2330, exc.value
        return exc.value
    raise AssertionError('期望真实原生 getter 抛出 ClientError(2330)，但未抛出')
