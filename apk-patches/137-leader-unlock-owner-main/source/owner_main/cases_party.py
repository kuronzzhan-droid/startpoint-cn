"""执行原生队伍getter/party构造；角色资源构造是明确的边界替身。"""
from .runtime import VM, none, method_names
import asm
from overflow.base_runtime import VM as CollectionVM


def bind_party_world(e, party, mains, unisons):
    def iterator(values):
        values = list(values.values())
        state = {'position': 0}
        def take():
            value = values[state['position']]
            state['position'] += 1
            return value
        return {'hasNext': lambda: state['position'] < len(values), 'next': take}

    inherited = e.run_body
    label = 'BattlePartyLogic/wfxSameElementBeforeOwnerMain'
    snapshot_id = e.abc.bodies[e.labels[label]][0] if label in e.labels else None
    def run_body(body, args, scopes=None):
        if body[0] != snapshot_id:
            return inherited(body, args, scopes)
        e.executed.add(body[0])
        lex = dict(e.lex)
        lex['IntMap'] = CollectionVM.Cls('IntMap', lambda: {'_type': 'IntMap', 'h': {}})
        lex['IntMapValuesIterator'] = CollectionVM.Cls('IntMapValuesIterator', iterator)
        return CollectionVM.Interp(e.abc, lex).run(asm.decode(body[5]), args, scopes)
    e.run_body = run_body
    methods = ['get_leaderCharacter', 'get_mainCharacters', 'get_unisonCharacters',
               'get_allCharacters', 'getNumberOfSameElement', 'matchCharacterGroup']
    methods += [n for n in method_names(e.abc, 'BattlePartyLogic') if n.startswith('wfx')]

    def new_party(values, assets):
        obj = {'_type': 'BattlePartyLogic', 'getBattleEquipment': lambda slot: none(),
               'getAbilitySoul': lambda slot: none()}
        e.bind(obj, 'BattlePartyLogic', methods)
        e.run('BattlePartyLogic/<ctor>', obj, values, assets)
        return obj

    names = ['getInstantAbiltyCount', 'getInstantAbiltyCountWithoutLimit', 'getElement',
             'get_element', 'getSelfAbilitySlots', 'getAbilityPowerAt', 'getAbilityAwakeLevelAt',
             'matchCharacterGroup', 'get_unisonCharacter']
    names += [n for n in method_names(e.abc, 'BattleCharacterLogic') if n.startswith('wfx')]

    def new_character(source, assets, owner_party, equipment, soul, slot, is_unison):
        # Preserve controlled master rows and learned mana values, but rebind all executed
        # methods to this NEW object and its actual owner party. Never return cached mains.
        obj = dict(source, party=owner_party, logicAssets=assets, index=slot,
                   isUnison=is_unison, cachedElement=None, cachedUnisonCharacter=None)
        e.bind(obj, 'BattleCharacterLogic', names)
        e.bind(obj, 'GeneralCharacterLogic', ['_getSelfAbilitySlot', 'get_originalElement'])
        if '_controlled_slots' in source:
            obj['getSelfAbilitySlots'] = lambda *args: source['_controlled_slots']
        obj['getUnisonCharacter'] = obj['get_unisonCharacter']
        return obj

    e.lex['BattlePartyLogic'] = VM.Cls('BattlePartyLogic', new_party)
    e.lex['BattleCharacterLogic'].ctor = new_character
    e.bind(party, 'BattlePartyLogic', methods)
    for char in mains + unisons:
        char['cachedUnisonCharacter'] = None
        e.bind(char, 'BattleCharacterLogic', ['get_unisonCharacter'])
        char['getUnisonCharacter'] = char['get_unisonCharacter']
