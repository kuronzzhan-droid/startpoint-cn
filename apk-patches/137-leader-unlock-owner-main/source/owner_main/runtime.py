"""真实 AVM2 调用链；主表、描述排版及游戏对象使用离线边界夹具。"""
import sys

import bootstrap
import bodies
from pathlib import Path
from functools import lru_cache

for directory in ('run6', 'run2'):
    path = str(bootstrap.ROOT.parent / directory)
    if path not in sys.path:
        sys.path.append(path)
from leader_unlock.runtime import world as base_world
from party.runtime import VM, some, none

COUNT = 'BattleCharacterLogic/getInstantAbiltyCountWithoutLimit'
MATCH = 'InitialAbilityTriggerKindTools$/matchCharacter'
REASON = 'AbilityDisabledReasonResolver/resolveInitial'
PANEL = 'TriggerableAbilityDialogAllAbilitiesGenerator/addAbility'
KEY = 'wfx_unlock_111001'
LAYOUTS = {'mixed': [0, 1, 2, 0, 1, 3], 'five': [1, 1, 1, 1, 1, 0],
           'six_water': [1] * 6, 'six_fire': [0] * 6}


def enum(index, *params, cls='InitialAbilityTriggerKind'):
    return {'_type': cls, 'index': index, 'params': list(params)}


_lookup = VM._lookup


def lookup(obj, key):
    if isinstance(obj, list) and isinstance(key, str) and key.split('::')[-1] == 'indexOf':
        return lambda value: obj.index(value) if value in obj else -1
    if isinstance(obj, list) and isinstance(key, str) and key.split('::')[-1] == 'concat':
        return lambda other: obj + other
    return _lookup(obj, key)


VM._lookup = lookup


@lru_cache(maxsize=64)
def method_names(abc, cls):
    return [x.split('/')[-1] for x in bodies.label_map(abc).values()
            if x.startswith(cls + '/') and '<' not in x]


def world(abc, table=None, layout='six_water', **kwargs):
    e, party, mains, unisons = base_world(abc, table, LAYOUTS[layout], **kwargs)
    e.lex['Boot'] = {'skip_constructor': False}
    e.lex['Equal'] = {'equals': lambda a, b: a == b}
    e.lex['InstantAbilityContentTools'] = {'getInstantTargetKind': lambda content: none()}
    e.lex['InstantAbilityMultiplyTrigger'] = VM.Cls('InstantAbilityMultiplyTrigger', **{'None': enum(0)})
    e.lex['InstantAbilityTriggerKind'] = VM.Cls('InstantAbilityTriggerKind',
        Initial=lambda count, kind: enum(0, count, kind, cls='InstantAbilityTriggerKind'))
    e.lex['AbilityPreconditionKindTools'] = {}
    e.bind(e.lex['AbilityPreconditionKindTools'], 'AbilityPreconditionKindTools$',
           ['getTotalPreconditionCount'])
    e.lex['InitialAbilityCountKindTools'] = {}
    e.bind(e.lex['InitialAbilityCountKindTools'], 'InitialAbilityCountKindTools$', ['isActive'])
    e.lex['TriggerLimitTools'] = {}
    e.bind(e.lex['TriggerLimitTools'], 'TriggerLimitTools$', ['limit'])
    e.lex['InitialAbilityTriggerKindTools'] = {}
    e.bind(e.lex['InitialAbilityTriggerKindTools'], 'InitialAbilityTriggerKindTools$', ['matchCharacter'])
    e.asset.update(getUiString=lambda key: key,
                   getUiStringWithContext=lambda key, context: key + ':' + str(context),
                   getSimpleAbilityDescriptionEnabled=lambda: False)
    party['mainCharacters'] = [some(c) for c in mains]
    party['values'] = {'characters': party['mainCharacters'], 'options': {},
                      'unison_characters': [none() if kwargs.get('empty_unison') else some(c) for c in unisons]}
    party['getBattleEquipment'] = lambda slot: none()
    party['getAbilitySoul'] = lambda slot: none()
    e.lex['BattleCharacterLogic'].ctor = lambda source, *args: source
    e.lex['Error'] = VM.Cls('Error', lambda: {'_type': 'Error'})
    e.lex['ClientError'] = VM.Cls('ClientError', lambda *args: {'_type': 'ClientError', 'args': args})
    party['get_mainCharacters'] = lambda: party['mainCharacters']
    party['get_secondCharacter'] = lambda: party['mainCharacters'][1]
    party['get_thirdCharacter'] = lambda: party['mainCharacters'][2]
    for char in mains + unisons:
        e.bind(char, 'BattleCharacterLogic', ['getInstantAbiltyCount'])
        char['getUnisonCharacter'] = char['get_unisonCharacter']
    e.bind(party, 'BattlePartyLogic', ['get_leaderCharacter'])

    def construct(cls, *args):
        obj = {'_type': cls}
        e.bind(obj, cls, method_names(abc, cls))
        e.run(cls + '/<ctor>', obj, *args)
        return obj

    for cls in ('AbilityDisabledReasonResolver', 'TriggerableAbilityDialogAbilityContent',
                'TriggerableAbilityDialogAbility', 'InstantBattleAbility', 'DuringBattleAbility',
                'InstantInitialAbility'):
        e.lex[cls] = VM.Cls(cls, lambda *args, c=cls: construct(c, *args))
    e.lex['InstantAbilityDescriptionGenerator'] = VM.Cls('InstantAbilityDescriptionGenerator',
        lambda *args: {'target': args[6], 'simpleAbilityDescriptionEnabled': args[8],
                       'trigger': args[9]})
    e.construct_native = construct
    from .cases_party import bind_party_world
    bind_party_world(e, party, mains, unisons)
    return e, party, mains, unisons


def trigger(kinds=(11,), mode='battle'):
    """显式控制行：202，以及202+208；不冒充线上主表内容。"""
    conditions = [enum(0, kind if isinstance(kind, dict) else enum(kind),
                       cls='AbilityPreconditionKind') for kind in kinds]
    if mode == 'during':
        source = {'_type': 'DuringAbilitySource', 'preconditions': conditions,
                  'accumulationTrigger': none(), 'accumulationTriggerLimit': none(),
                  'accumulationCooltime': 0, 'trigger': enum(0), 'content': enum(0),
                  'evenIfOwnerDead': False}
        return enum(1, source, cls='AbilityTrigger')
    initial = enum(0, 1, enum(0), cls='InstantAbilityTriggerKind')
    battle = enum(1, enum(0, cls='InstantBattleAbilityTriggerKind'), none(), 0,
                  cls='InstantAbilityTriggerKind')
    source = {'_type': 'InstantAbilitySource', 'preconditions': conditions,
              'trigger': initial if mode == 'initial' else battle,
              'precontent': enum(2, enum(0)), 'delayFrame': 0, 'delaySec': 0,
              'content': enum(9)}
    return enum(0, source, cls='AbilityTrigger')


def battle(e, party, char, origin=1001000, kinds=(11,), mode='battle'):
    source = {'_type': 'BattleAbilitySource', 'abilityDescription': '',
              'instantInitialAbilities': [], 'instantBattleAbilities': [],
              'duringAbilities': [], 'openingAbilities': []}
    e.bind(source, 'BattleAbilitySource', ['add'])
    source['add'](origin, trigger(kinds, mode), char, party, char['index'], False)
    key = {'initial': 'instantInitialAbilities', 'battle': 'instantBattleAbilities',
           'during': 'duringAbilities'}[mode]
    return len(source[key])


def panel(e, party, mains, slot=0, kinds=(11,), unison=True, number=1,
          unisonable=True, learned=True, origin_kind=0):
    if party is not None:
        resolver = e.construct_native('AbilityDisabledReasonResolver', e.asset, party)
    else:
        resolver = {'_type': 'AbilityDisabledReasonResolver', 'party': None,
                    'battleCharacterLogics': [none()] * 6, 'logicAssets': e.asset}
        e.bind(resolver, 'AbilityDisabledReasonResolver', method_names(e.abc, 'AbilityDisabledReasonResolver'))
    ability = {'_type': 'AbilityLogic', 'number': number, 'id': 1211771,
               'getTriggers': lambda: [trigger(kinds)],
               'get_unisonable': lambda: unisonable,
               'get_originKind': lambda: enum(origin_kind, number)}
    united = mains[slot] if party is not None else dict(mains[slot], getUnisonCharacter=lambda: none())
    obj = {'_type': 'TriggerableAbilityDialogAllAbilitiesGenerator', 'logicAsset': e.asset,
           'disabledReasonResolver': resolver, 'partyCharacterIndex': slot,
           'unitedCharacter': united, 'party': party,
           'descriptionGenerator': {'stringfyWithoutJoin': lambda rows: ['control-row']}}
    result = {'triggerableAbilities': [], 'notTriggerableAbilities': []}
    e.run(PANEL, obj, result, ability, learned, unison, 0)
    return {key: [{'disabled': row['disabled'], 'reasons': row['disabledReasons']}
                  for item in result[key] for row in item['contents']] for key in result}


def snapshot(abc, table=None, layout='six_water', slot=0, kinds=(11,),
             origin=1001000, unisonable=True, **kwargs):
    e, p, mains, unisons = world(abc, table, layout, **kwargs)
    char = mains[slot]
    value = e.run(COUNT, char, kinds[0] if isinstance(kinds[0], dict) else enum(kinds[0]),
                  p, slot, origin, False)
    result = {'count': value['params'][0],
              'battle': battle(e, p, char, origin, kinds),
              'during': battle(e, p, char, origin, kinds, 'during'),
              'initial': battle(e, p, char, origin, kinds, 'initial'),
              'panel': panel(e, p, mains, slot, kinds, unisonable=unisonable)}
    return result, e
