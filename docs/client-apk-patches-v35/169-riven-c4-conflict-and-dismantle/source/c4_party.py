"""Route serialized party deltas by category and cached party ID, without event guesses."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, queue
from c4_party_parse import parse_parties
from c4_party_types import queue_party_types


def apply_parties(e, first):
    rows, index, row, category, ident, holder, saved, loaded, logic, converted = range(first, first+10)
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    n = lambda v: number(e, v)
    q = e.q
    done, loop, skip, mapped = 'c4_party_done', 'c4_party_loop', 'c4_party_skip', 'c4_party_mapped'
    code = [('getlocal_1',), *get(e, 'party_info_list'), p(rows), g(rows), ('istype', q('Array')),
            ('iffalse', done), g(rows), ('getproperty', q('length')), ('iffalse', done),
            ('getlex', q('PinballClientMain')), ('getproperty', q('top')), p(logic), g(logic), ('iffalse', done)]
    for field in ('logic', 'globalLogic'):
        code += [g(logic), *get(e, field), p(logic), g(logic), ('iffalse', done)]
    code += [g(logic), *get(e, 'logicStatus'), ('callproperty', q('getLoadedData'), 0), p(loaded),
             g(loaded), ('iffalse', done), n(0), p(index),
             ('label', loop), ('avm_label',), g(index), g(rows), ('getproperty', q('length')),
             ('ifge', done), g(rows), g(index), ('getproperty', DYNAMIC), p(row),
             g(row), *get(e, 'party_category'), ('convert_i',), p(category),
             g(row), *get(e, 'party_id'), ('convert_i',), p(ident),
             g(category), n(1), ('ifeq', 'c4_party_normal'),
             g(category), n(2), ('ifeq', 'c4_party_carnival'),
             g(category), n(3), ('ifeq', 'c4_party_raid'),
             g(category), n(99), ('ifeq', 'c4_party_profile'),
             g(category), n(100), ('ifeq', 'c4_party_history'),
             g(category), n(4), ('iflt', skip), g(category), n(7), ('ifgt', skip),
             g(category), ('getlex', q('cn.mod::IndependentRushParty')), ('callproperty', q('category'), 0),
             ('ifne', skip), g(loaded), *get(e, 'rushEventData'), p(holder), ('jump', mapped)]
    for tag, field in [('carnival','carnivalEventData'), ('raid','raidEventData')]:
        code += [('label', 'c4_party_'+tag), g(loaded), *get(e, field), p(holder), ('jump', mapped)]
    for tag, field in [('profile','profile'), ('history','playerHistoryData')]:
        code += [('label', 'c4_party_'+tag), ('getlocal_0',), *get(e, 'saveData'), *get(e, field),
                 p(holder), g(holder), ('iffalse', skip), g(holder), ('getproperty', q('index')),
                 n(0), ('ifne', skip), g(holder), ('getproperty', q('params')), n(0),
                 ('getproperty', DYNAMIC), p(holder), ('jump', mapped)]
    code += [('label', 'c4_party_normal'), ('getlocal_0',), *get(e, 'saveData'), p(holder),
             ('label', mapped), g(holder), ('iffalse', skip), g(holder), *get(e, 'parties'), p(saved),
             g(saved), ('iffalse', skip), g(saved), *get(e, 'h'), p(saved), g(saved), ('iffalse', skip),
             g(saved), g(ident), ('getproperty', DYNAMIC), p(saved), g(saved), ('iffalse', skip),
             # The original applyPartySaveData validates a nonempty leader. A
             # malformed/empty server party must never turn this path fatal.
             g(row), *get(e, 'character_ids'), n(0), ('getproperty', DYNAMIC),
             ('getproperty', q('index')), n(0), ('ifne', skip),
             g(category), n(1), ('ifne', 'c4_party_event_apply'),
             ('getlocal_0',), ('getlex', q('haxe.ds::Option')), g(row),
             ('callproperty', q('Some'), 1), ('callpropvoid', q('updatePartyInfo'), 1),
             ('jump', 'c4_party_changed'), ('label', 'c4_party_event_apply'),
             ('getlex', q('pinball.common.data.save::PartySaveDataTools')), g(row),
             ('callproperty', q('fromPartyInfo'), 1), p(converted),
             ('findpropstrict', q('pinball.common.data.party::PartyLogic')), g(ident), g(saved),
             ('getlocal_0',), ('getlocal_0',), ('getproperty', q('logicAssets')),
             ('constructprop', q('pinball.common.data.party::PartyLogic'), 4), g(converted),
             ('callpropvoid', q('applyPartySaveData'), 1),
             ('label', 'c4_party_changed'), ('pushtrue',), ('setlocal_2',),
             ('label', skip), ('inclocal_i', index), ('jump', loop), ('label', done)]
    return code


def queue_party_splices(e):
    label = 'RealRemoteService/earlySuccessHandler'
    ops = asm.decode(e.body(label)[5])
    assert ops[7397].name == 'findproperty' and e.abc.mn_name(ops[7397].args[0]) == 'hook'
    parser = queue(e, label, parse_parties(e, e.body(label)[2]), at=7397)
    label = 'PlayerLogic/applyCommonResponse'
    ops = asm.decode(e.body(label)[5])
    assert [o.name for o in ops[2:5]] == ['pushfalse', 'convert_b', 'setlocal_2']
    apply = queue(e, label, apply_parties(e, e.body(label)[2]), at=5)
    schema = queue_party_types(e)
    return {'parser': parser, 'apply': apply, 'schema': schema,
            'normal_route': 'PlayerLogic.updatePartyInfo(Some(PartyInfo))',
            'event_route': 'PartySaveDataTools.fromPartyInfo -> PartyLogic.applyPartySaveData',
            'identity': 'party_category + party_id; group/slot encoded in party_id',
            'cache_fields': {2: 'carnivalEventData', 3: 'raidEventData', '4..7': 'rushEventData',
                             99: 'player.profile Some', 100: 'player.playerHistoryData Some'},
            'rush_guard': 'cn.mod.IndependentRushParty.category must match; no inactive cache fabricated',
            'missing_party_policy': 'skip absent caches/IDs and malformed empty-leader payload; never cross categories'}
