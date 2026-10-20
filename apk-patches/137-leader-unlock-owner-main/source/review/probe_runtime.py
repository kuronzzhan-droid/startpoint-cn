"""独立夹具：执行真实 party getter 和元素方法，外围构造初始化使用明确替身。"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
sys.path[:0] = [str(ROOT / 'run8' / 'vendor'), str(ROOT / 'run2')]
import asm
from party.runtime import Harness, VM, some, none
from overflow.base_runtime import VM as CountVM


def kind(index, *params):
    return {'index': index, 'params': list(params)}


def change_element(element, condition=11):
    source = {'preconditions': [kind(0, kind(condition))],
              'trigger': kind(0, 1, kind(0)),
              'content': kind(2, kind(1, kind(0), kind(36, element)))}
    return {'getTriggers': lambda: [kind(0, source)]}


fallback = VM._lookup


def lookup(obj, key):
    if isinstance(obj, list) and isinstance(key, str) and key.split('::')[-1] == 'concat':
        return lambda other: obj + other
    return fallback(obj, key)


VM._lookup = lookup


def make_world(abc, mask, elements=(1, 1, 1, 1, 1, 1), changes=None, first_none=False):
    table = {} if mask is None else {'wfx_unlock_129989': str(mask)}
    e = Harness(abc, table)
    e.created = []
    e.lex['InitialAbilityTriggerKindTools'] = {}
    e.bind(e.lex['InitialAbilityTriggerKindTools'], 'InitialAbilityTriggerKindTools$', ['matchCharacter'])
    e.lex['IterableOptionTools'] = {'flatten': lambda items: [x['params'][0] for x in items if x['index'] == 0]}
    characters = [dict(id=100 + i, element=el, leader_ability=some({'id': 129989}),
                       changes=(changes or {}).get(i, [])) for i, el in enumerate(elements)]
    bind_names = {cls: [x.split('/')[-1] for x in e.labels
                       if x.startswith(cls + '/') and '<' not in x]
                  for cls in ('BattleCharacterLogic', 'BattlePartyLogic')}

    def bind_all(obj, cls):
        e.bind(obj, cls, bind_names[cls])

    def character(values, assets, party, equipment, soul, slot, unison):
        obj = {'_type': 'BattleCharacterLogic', 'values': values, 'id': values['id'],
               'logicAssets': assets, 'party': party, 'equipment': equipment,
               'index': slot, 'isUnison': unison, 'cachedElement': None}
        bind_all(obj, 'BattleCharacterLogic')
        obj['get_originalElement'] = lambda: values['element']
        obj['wfxAdaptiveElement'] = lambda: -1
        obj['getSelfAbilitySlots'] = lambda flag: [some(change_element(*row)) for row in values['changes']]
        e.created.append(obj)
        return obj

    def party(values, assets):
        obj = {'_type': 'BattlePartyLogic', 'values': values, 'logicAssets': assets}
        bind_all(obj, 'BattlePartyLogic')
        obj['getBattleEquipment'] = lambda i: none()
        obj['getAbilitySoul'] = lambda i: none()
        return obj

    e.lex['BattleCharacterLogic'] = VM.Cls('BattleCharacterLogic', character)
    e.lex['BattlePartyLogic'] = VM.Cls('BattlePartyLogic', party)
    e.lex['InitialAbilityCountKind'] = VM.Cls('InitialAbilityCountKind', General=lambda n: kind(0, n))
    values = {'characters': [some(v) for v in characters[:3]],
              'unison_characters': [some(v) for v in characters[3:]],
              'equipments': [none()] * 3, 'abilitySoulIds': [none()] * 3, 'options': {}}
    if first_none:
        values['characters'][0] = none()
    p = party(values, e.asset)
    main = character(characters[0], e.asset, p, none(), none(), 0, False)
    unison = character(characters[3], e.asset, p, none(), none(), 0, True)
    inherited = e.run_body
    count_ids = {abc.bodies[i][0] for label, i in e.labels.items()
                 if label in ('BattlePartyLogic/getNumberOfSameElement',
                              'BattlePartyLogic/wfxSameElementBeforeOwnerMain')}

    def iterator(values):
        it = iter(values.values())
        pending = []
        def has_next():
            if pending:
                return True
            try:
                pending.append(next(it))
                return True
            except StopIteration:
                return False
        return {'hasNext': has_next, 'next': lambda: pending.pop() if has_next() else None}

    def run_body(body, args, scopes=None):
        if body[0] not in count_ids:
            return inherited(body, args, scopes)
        e.executed.add(body[0])
        lex = dict(e.lex)
        lex['IntMap'] = CountVM.Cls('IntMap', lambda: {'h': {}})
        lex['IntMapValuesIterator'] = CountVM.Cls('IntMapValuesIterator', iterator)
        return CountVM.Interp(abc, lex).run(asm.decode(body[5]), args, scopes)

    e.run_body = run_body
    return e, p, main, unison
