"""Inline list predicates/sorting. Python emitters add no AVM methods/traits."""
import json
from bootstrap import ROOT, sha, write_json
from c1_lookup import number
from c2_common import DYNAMIC, get

CATALOG = ROOT.parent.parent / 'library/generator/out/weapon_riven_affixes.json'
LOCK = ROOT.parent.parent / 'library/generator/affix_keys.lock.json'
CATALOG_SHA = '9061669bf29e496600b1c595e59e9327cbf7ee4be18c16461f3248a172f69ac6'
LOCK_SHA = '634f4d6a108e856bbc70275e9afcf2621417eceb0e510f365ed642ee6ba10640'


def catalog_keys():
    raw = CATALOG.read_bytes()
    lock_raw = LOCK.read_bytes()
    assert sha(raw) == CATALOG_SHA, 'affix catalog changed; review before rebuilding C3'
    assert sha(lock_raw) == LOCK_SHA, 'affix key lock changed; review before rebuilding C3'
    entries = json.loads(raw)['affixes']
    locked = json.loads(lock_raw)['entries']
    assert set(locked) == {a['id'] for a in entries}
    for entry in entries:
        match = locked[entry['id']]
        assert match['key'] == entry['key']
        assert match['definition']['polarity'] == entry['polarity']
    keys = [int(a['key']) for a in entries]
    negative = [int(a['key']) for a in entries if a['polarity'] == '-']
    assert len(keys) == len(set(keys)) == 20
    assert len(negative) == 7
    # This locks evidence, not a speculative sign inferred from ID/L/wording.
    write_json(ROOT / 'audit/filter-affix-catalog.json', {
        'catalog': str(CATALOG), 'catalog_sha256': sha(raw),
        'key_lock': str(LOCK), 'key_lock_sha256': sha(lock_raw),
        'all_keys': keys, 'negative_keys': negative,
        'unknown_key_policy': 'shown unfiltered, excluded from explicit polarity filters',
        'acquisition_order': 'monotonic non-reused riven_id; no timestamp received'})
    return keys, negative


def emit_filter_record(e, setting, record, weapon, first, reject, tag='filter'):
    """Reject nonmatches; caller supplies a GeneralEquipment with get_name().

    elements: Some(0..3)=count1..4, Some(4)=negative, Some(5)=no-negative,
    None=unrestricted count/polarity. No count or polarity choices means any.
    keywordSearchText: bound weapon name substring (case-insensitive).
    Scratch locals first..first+8. Does not mutate record, weapon or setting.
    """
    known, negatives = catalog_keys()
    selected, i, value, counts, polarities, affixes, hasnegative, unknown, key = range(first, first + 9)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    n = lambda v: number(e, v)
    q = e.q
    L = lambda name: tag + '_' + name
    code = [g(setting), *get(e, 'keywordSearchText'), p(value),
            g(value), ('getproperty', q('index')), n(0), ('ifne', L('keyword_done')),
            g(weapon), ('callproperty', q('get_name'), 0),
            ('callproperty', q('http://adobe.com/AS3/2006/builtin::toLowerCase'), 0),
            g(value), ('getproperty', q('params')), n(0), ('getproperty', DYNAMIC),
            ('callproperty', q('http://adobe.com/AS3/2006/builtin::toLowerCase'), 0),
            ('callproperty', q('http://adobe.com/AS3/2006/builtin::indexOf'), 1), n(0), ('iflt', reject),
            ('label', L('keyword_done')), n(0), p(counts), n(0), p(polarities),
            g(setting), *get(e, 'elements'), p(selected), n(0), p(i),
            ('label', L('choices')), ('avm_label',),
            g(i), g(selected), ('getproperty', q('length')), ('ifge', L('choices_done')),
            g(selected), g(i), ('getproperty', DYNAMIC), p(value),
            g(value), ('getproperty', q('index')), n(1), ('ifeq', L('done')),
            g(value), ('getproperty', q('params')), n(0), ('getproperty', DYNAMIC), ('convert_i',), p(value),
            g(value), n(4), ('ifge', L('polarity_choice')),
            g(counts), n(1), g(value), ('lshift',), ('bitor',), p(counts), ('jump', L('choice_next')),
            ('label', L('polarity_choice')), g(polarities), n(1), g(value), n(4), ('subtract_i',),
            ('lshift',), ('bitor',), p(polarities),
            ('label', L('choice_next')), ('inclocal_i', i), ('jump', L('choices')),
            ('label', L('choices_done')), g(record), *get(e, 'affixes'), p(affixes),
            g(counts), ('iffalse', L('count_done')), g(counts), n(1),
            g(affixes), ('getproperty', q('length')), n(1), ('subtract_i',), ('lshift',), ('bitand',),
            ('iffalse', reject), ('label', L('count_done')),
            g(polarities), ('iffalse', L('done')),
            g(polarities), n(3), ('ifeq', L('done')),
            n(0), p(hasnegative), n(0), p(unknown), n(0), p(i),
            ('label', L('affix_loop')), ('avm_label',),
            g(i), g(affixes), ('getproperty', q('length')), ('ifge', L('affix_done')),
            g(affixes), g(i), ('getproperty', DYNAMIC), n(0), ('getproperty', DYNAMIC), ('convert_i',), p(key)]
    for k in negatives:
        code += [g(key), n(k), ('ifeq', L('negative'))]
    for k in known:
        code += [g(key), n(k), ('ifeq', L('affix_next'))]
    code += [n(1), p(unknown), ('jump', L('affix_next')),
             ('label', L('negative')), n(1), p(hasnegative),
             ('label', L('affix_next')), ('inclocal_i', i), ('jump', L('affix_loop')),
             ('label', L('affix_done')), g(unknown), ('iftrue', reject),
             g(hasnegative), ('iffalse', L('no_negative')), g(polarities), n(1), ('ifne', reject),
             ('jump', L('done')), ('label', L('no_negative')), g(polarities), n(2), ('ifne', reject),
             ('label', L('done'))]
    return code


def emit_sort_ids(e, ids, records, setting, first, tag='sort'):
    """Stable insertion sort, max 200 cards. Replaces ids local with a copy.

    Defaults newest acquisition first, using riven_id, not reused item slots.
    keywordSearchKinds contains 0 => roll_count primary, 1 => ascending.
    Explicit riven_id + row key ties make results deterministic. Scratch +0..9.
    """
    kinds, roll, asc, i, j, item, prior, a, b, cmp = range(first, first + 10)
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    n = lambda v: number(e, v)
    q = e.q
    L = lambda name: tag + '_' + name
    code = [g(setting), *get(e, 'keywordSearchKinds'), p(kinds), n(0), p(roll), n(0), p(asc), n(0), p(i),
            ('label', L('kind_loop')), ('avm_label',), g(i), g(kinds), ('getproperty', q('length')), ('ifge', L('start')),
            g(kinds), g(i), ('getproperty', DYNAMIC), ('convert_i',), p(item),
            g(item), n(0), ('ifne', L('kind_asc')), n(1), p(roll),
            ('label', L('kind_asc')), g(item), n(1), ('ifne', L('kind_next')), n(1), p(asc),
            ('label', L('kind_next')), ('inclocal_i', i), ('jump', L('kind_loop')),
            ('label', L('start')), g(ids), ('newarray', 0), ('callproperty', q('http://adobe.com/AS3/2006/builtin::concat'), 1), p(ids),
            n(1), p(i), ('label', L('outer')), ('avm_label',),
            g(i), g(ids), ('getproperty', q('length')), ('ifge', L('done')),
            g(ids), g(i), ('getproperty', DYNAMIC), p(item), g(i), p(j),
            ('label', L('inner')), ('avm_label',), g(j), n(0), ('ifle', L('insert')),
            g(ids), g(j), n(1), ('subtract_i',), ('getproperty', DYNAMIC), p(prior),
            g(records), g(item), n(0xFFFFFF), ('bitand',), ('getproperty', DYNAMIC), p(a),
            g(records), g(prior), n(0xFFFFFF), ('bitand',), ('getproperty', DYNAMIC), p(b),
            g(roll), ('iffalse', L('acquire')), g(a), *get(e, 'roll_count'), ('convert_i',),
            g(b), *get(e, 'roll_count'), ('convert_i',), ('subtract',), p(cmp), g(cmp), ('iftrue', L('compare')),
            ('label', L('acquire')), g(a), *get(e, 'riven_id'), ('convert_d',),
            g(b), *get(e, 'riven_id'), ('convert_d',), ('subtract',), p(cmp),
            g(cmp), ('iftrue', L('compare')), g(item), g(prior), ('subtract',), p(cmp),
            ('label', L('compare')), g(asc), ('iffalse', L('descending')),
            g(cmp), n(0), ('ifge', L('insert')), ('jump', L('shift')),
            ('label', L('descending')), g(cmp), n(0), ('ifle', L('insert')),
            ('label', L('shift')), g(ids), g(j), g(prior), ('setproperty', DYNAMIC),
            ('declocal_i', j), ('jump', L('inner')),
            ('label', L('insert')), g(ids), g(j), g(item), ('setproperty', DYNAMIC),
            ('inclocal_i', i), ('jump', L('outer')), ('label', L('done'))]
    return code
