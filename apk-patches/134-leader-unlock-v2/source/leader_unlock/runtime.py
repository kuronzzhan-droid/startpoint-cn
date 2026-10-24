"""复用第二轮真实队伍夹具；共鸣统计直接解释官方方法。"""
import sys

import bootstrap
import asm
import bodies

if str(bootstrap.RUN2) not in sys.path:
    sys.path.append(str(bootstrap.RUN2))
from party.worlds import world as old_world, summary, preload, FIXTURE
from party.runtime import none
from overflow.base_runtime import VM as NativeVM

SAME = 'BattlePartyLogic/getNumberOfSameElement'


def world(abc, table=None, elements=None, **kwargs):
    e, p, mains, unisons = old_world(abc, table, **kwargs)
    native_body = abc.bodies[bodies.resolve(abc, SAME)]
    inherited = e.run_body

    def iterator(values):
        values = iter(values.values())
        state = {'next': None, 'ready': False}
        def has_next():
            if state['ready']:
                return True
            try:
                state['next'], state['ready'] = next(values), True
                return True
            except StopIteration:
                return False
        def next_value():
            assert has_next()
            state['ready'] = False
            return state['next']
        return {'hasNext': has_next, 'next': next_value}

    def run_body(body, args, scopes=None):
        if body[0] != native_body[0]:
            return inherited(body, args, scopes)
        e.executed.add(body[0])
        lex = dict(e.lex)
        lex['IntMap'] = NativeVM.Cls('IntMap', lambda: {'_type': 'IntMap', 'h': {}})
        lex['IntMapValuesIterator'] = NativeVM.Cls('IntMapValuesIterator', iterator)
        return NativeVM.Interp(abc, lex).run(asm.decode(body[5]), args, scopes)

    e.run_body = run_body
    e.bind(p, 'BattlePartyLogic', ['getNumberOfSameElement'])
    if elements is not None:
        assert len(elements) == 6
        for char, element in zip(mains + unisons, elements):
            char['squadMemberSourceValues']['element'] = element
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
    snapshot = {'rows': rows, 'panel': panel, 'preloaded_ids': assets, 'with_condition': filtered}
    return snapshot, e, p, mains, unisons
