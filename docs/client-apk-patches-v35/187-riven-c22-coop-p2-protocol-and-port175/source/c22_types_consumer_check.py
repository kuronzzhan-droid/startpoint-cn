"""Execute serialized C22 schema/consumer and prove admission literal reversal."""
import copy
import json
import sys
from bootstrap import ROOT, WORKSPACE, output_path, write_json, sha
sys.path.insert(0, str(ROOT / 'validation'))
from framework import Editor
from swfabc import SwfAbc
from c22_types import apply as types_apply, FIELDS
from c22_consumer import apply as consumer_apply
from c22_admission import patch, reverse, verify, ADMISSION_BUILD, CAPABILITIES
from c22_catalog import CATALOG_ID
from c22_native_runtime import Interp, native_lex
from c1_world import C1World, NONE, some, entry, flat, project
from avm_runtime import Cls
from typepacker_world import TypePackerWorld, PARTY


def world(abc, save=None):
    result = C1World(abc, save=save)
    result.lex['Array'] = Cls('Array', lambda *xs: list(xs))
    result.lex.update(native_lex())
    result.vm = Interp(abc, result.lex, max_steps=2000000)
    return result


def main():
    base = WORKSPACE / 'build-c21/swf/boot-riven-p1c21-18001.swf'
    e = Editor(base, {})
    changes = {'types': types_apply(e), 'consumer': consumer_apply(e)}
    e.apply()
    assert not e.new_methods and not e.traits
    raw, admission = patch(e.swf.serialize())
    assert reverse(raw) == e.swf.serialize()
    verify(raw)
    candidate = output_path(ROOT / 'audit/types-consumer/types-consumer.swf')
    candidate.write_bytes(raw)
    abc = SwfAbc(candidate).abc
    cases = []

    def passed(name):
        cases.append({'name': name, 'status': 'passed'})

    types = TypePackerWorld(abc)
    schema = types.resolve(PARTY)['params']
    for field, kind in FIELDS.items():
        assert schema[0]['h'][field] == kind
        assert field in schema[1] and field in schema[4]
    passed('actual_type_registry_five_fields_and_optional')
    for level in (1, 25, 80, 100):
        for size in (1, 4):
            w = world(abc, save={'16000001': entry(affixes=[[15990001, 99]])})
            terms = [[15990001 + i, level] for i in range(size)]
            row = entry(affixes=terms)
            values = w.produce([16000001, None, None])
            values['weapon_rivens'][0] = some(flat(16000001, row))
            values.update(weapon_riven_scope='multi-v1', weapon_riven_snapshot_id='snap-1',
                          weapon_riven_mode=1, weapon_riven_catalog=CATALOG_ID, weapon_riven_reason='')
            result = w.consume(values, 0, 16000001, 2010002)
            assert result['index'] == 0 and not w.factory_calls
            assert [x['key'] for x in w.constructed] == [x[0] for x in terms]
            passed(f'p2_party_owned_row_{size}_affixes_L{level}')
    a, b = world(abc), world(abc)
    parties = []
    for w, level in ((a, 80), (b, 25)):
        value = w.produce([None, None, None])
        value['weapon_rivens'][0] = some([16000001, 2010002, 15990001, level])
        parties.append(value)
    assert project(a.consume(parties[0], 0, 16000001, 2010002)['params'][0]) != project(
        b.consume(parties[1], 0, 16000001, 2010002)['params'][0])
    passed('same_instance_id_different_players_read_distinct_party_rows')
    good = parties[0]
    broken = [None, [], [NONE] * 3, [some([]), NONE, NONE],
              [some([16000002, 2010002, 15990001, 80]), NONE, NONE]]
    for row in ([16000001, 2010002, 15990001, 0], [16000001, 2010002, 15990001, 101],
                [16000001, 2010002, 15990001, 1.5], [16000001, 2010002, 15990001, '1'],
                [16000001, 2010002, 9999999, 80], [16000001, 2010002, 15990001],
                [16000001, 2010002, 15990001, 80] + [15990002, 5] * 4):
        broken.append([some(row), NONE, NONE])
    for i, slots in enumerate(broken):
        values = copy.deepcopy(good)
        if slots is None:
            values.pop('weapon_rivens')
        else:
            values['weapon_rivens'] = slots
        w = world(abc, save={'16000001': entry()})
        assert w.consume(values, 0, 16000001, 2010002) is NONE
        assert not w.factory_calls and not w.lookup_keys
        passed(f'missing_or_illegal_row_{i}_returns_none_without_inventory_or_factory')
    for context in ({'weapon_riven_mode': 0}, {'weapon_riven_scope': 'bad'},
                    {'weapon_riven_scope': 'multi-v1', 'weapon_riven_mode': 0},
                    {'weapon_riven_scope': 'multi-v1', 'weapon_riven_mode': 1,
                     'weapon_riven_snapshot_id': 'snap', 'weapon_riven_catalog': 'wrong'}):
        values = {**good, **context}
        w = world(abc)
        assert w.consume(values, 0, 16000001, 2010002) is NONE and not w.factory_calls
        passed('disabled_or_invalid_context_' + str(len(cases)))
    for item in (1010001, 1060001, 1080001, 2020001):
        before, after = world(SwfAbc(base).abc), world(abc)
        values = before.produce([item, None, None])
        expected = before.consume(values, 0, item, 2010002)
        actual = after.consume(values, 0, item, 2010002)
        assert project(expected['params'][0]) == project(actual['params'][0])
        assert before.factory_calls == after.factory_calls == [item]
        passed(f'ordinary_{item}_native_suffix_unchanged')
    result = {'status': 'passed', 'case_count': len(cases), 'cases': cases,
              'candidate_sha256': sha(raw), 'changes': changes, 'admission': admission,
              'boundary': 'Actual serialized AVM2 methods; native containers and master fixtures are adapters, no AIR/device battle.'}
    write_json(ROOT / 'audit/types-consumer/check.json', result)
    registration = {'build': ADMISSION_BUILD, 'capabilities': list(CAPABILITIES),
                    'weapon_riven_catalog': CATALOG_ID, 'configuration_applied': False,
                    'authenticated_server_grant_verified': False,
                    'client_declaration_fields': ['protocol', 'build', 'platform'],
                    'client_capability_declaration_field_exists': False,
                    'admission': admission, 'catalog_manifest': 'catalog.json'}
    write_json(ROOT / 'audit/types-consumer/server-registration-required.json', registration)
    print(json.dumps({'status': 'passed', 'case_count': len(cases)}))


if __name__ == '__main__':
    main()
