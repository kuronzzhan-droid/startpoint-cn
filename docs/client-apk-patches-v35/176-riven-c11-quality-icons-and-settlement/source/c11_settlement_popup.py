"""Extend the C9 native reward dialog in place, one dialog for mixed results."""
from c1_lookup import number, EQUIPMENT_TABLE
from c2_common import DYNAMIC, get, set_
from c9_data_types import GRANTED
from c9_settlement import popup as granted_popup
from c10_strings import TEXT
from c11_settlement_data import AUTO


def auto_contents(e, ctx, contents, first):
    rows, index, row, name, rewards, reward_i, pair, ident, count, message, master = range(first, first + 11)
    q = e.q
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    n = lambda v: number(e, v)
    gp = lambda v: ('getproperty', q(v))
    call = lambda v, c: ('callproperty', q(v), c)
    gl = [('getlocal_0',), gp('globalLogic')]
    code = [('label', 'c11_auto_begin'), g(ctx), *get(e, AUTO), p(rows), g(rows),
            ('istype', q('Array')), ('iffalse', 'c9_reward_open'), n(0), p(index),
            ('label', 'c11_auto_loop'), ('avm_label',), g(index), g(rows), gp('length'),
            ('ifge', 'c9_reward_open'), g(rows), g(index), ('getproperty', DYNAMIC), p(row),
            g(row), *get(e, 'rewards'), p(rewards), g(rewards), ('istype', q('Array')),
            ('iffalse', 'c11_auto_next'), *gl, call('getLogicAssets', 0),
            ('getlex', q(EQUIPMENT_TABLE)), call('getMasterTable', 1), call('get_data', 0),
            g(row), *get(e, 'weapon_id'), ('convert_i',), call('get', 1), p(master),
            e.string(TEXT['unknown_weapon']), p(name), g(master), ('iffalse', 'c11_auto_name_ready'),
            g(master), gp('name'), p(name), ('label', 'c11_auto_name_ready'),
            e.string(TEXT['auto_dismantled_prefix']), g(name), ('add',), p(message),
            g(rewards), gp('length'), ('iffalse', 'c11_auto_empty'),
            g(message), e.string(TEXT['auto_dismantled_result']), ('add',), p(message), n(0), p(reward_i),
            ('label', 'c11_auto_reward_loop'), ('avm_label',), g(reward_i), g(rewards), gp('length'),
            ('ifge', 'c11_auto_append'), g(rewards), g(reward_i), ('getproperty', DYNAMIC), p(pair),
            g(pair), n(0), ('getproperty', DYNAMIC), p(ident), g(pair), n(1), ('getproperty', DYNAMIC), p(count),
            g(reward_i), ('iffalse', 'c11_auto_reward_name'), g(message), e.string(TEXT['reward_separator']),
            ('add',), p(message), ('label', 'c11_auto_reward_name'), g(message), g(ident), n(16000900),
            ('ifne', 'c11_auto_other_item'), e.string(TEXT['fragments']), ('jump', 'c11_auto_add_name'),
            ('label', 'c11_auto_other_item'), *gl, g(ident), call('getItem', 1), call('get_name', 0),
            ('label', 'c11_auto_add_name'), ('add',), e.string(TEXT['reward_number']), ('add',), g(count),
            ('add',), p(message), ('inclocal_i', reward_i), ('jump', 'c11_auto_reward_loop'),
            ('label', 'c11_auto_empty'), g(message), e.string(TEXT['auto_dismantled_empty']), ('add',), p(message),
            ('label', 'c11_auto_append'), g(contents), ('getlex', q('pinball.dialog.general::DialogContent')),
            g(message), call('DynamicText', 1), ('callpropvoid', q('push'), 1),
            ('label', 'c11_auto_next'), ('inclocal_i', index), ('jump', 'c11_auto_loop')]
    return code


def popup(e, first):
    """Reuse C9 card/affix rendering and its open-success consumption gate."""
    ctx, ids, index, ident, saved, record, item, contents = range(first, first + 8)
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    gp = lambda v: ('getproperty', e.q(v))
    original = granted_popup(e, first)
    start = original.index(('label', 'c9_reward_loop')) - 2
    prefix = [('getlocal_0',), gp('questResultContext'), p(ctx), g(ctx), ('iffalse', 'c9_reward_done'),
              g(ctx), *get(e, GRANTED), p(ids), g(ids), ('istype', e.q('Array')),
              ('iftrue', 'c11_ids_ready'), ('newarray', 0), p(ids), ('label', 'c11_ids_ready'),
              ('getlocal_0',), gp('globalLogic'), ('callproperty', e.q('get_player'), 0), gp('saveData'),
              *get(e, 'weapon_rivens'), p(saved), g(saved), ('iftrue', 'c11_saved_ready'),
              ('newobject', 0), p(saved), ('label', 'c11_saved_ready'),
              ('newarray', 0), p(contents), g(contents), ('getlex', e.q('pinball.dialog.general::DialogContent')),
              g(ids), gp('length'), ('iffalse', 'c11_auto_title'), e.string(TEXT['revealed_title']),
              ('jump', 'c11_title_ready'), ('label', 'c11_auto_title'), e.string(TEXT['auto_dismantled_title']),
              ('label', 'c11_title_ready'), ('callproperty', e.q('DynamicText'), 1), ('callpropvoid', e.q('push'), 1)]
    code = prefix + original[start:]
    # Route the end of the C9 new-card loop through the new lines before opening.
    code = [('ifge', 'c11_auto_begin') if op == ('ifge', 'c9_reward_open') else op for op in code]
    at = code.index(('label', 'c9_reward_open'))
    code[at:at] = auto_contents(e, ctx, contents, first + 17)
    at = code.index(('label', 'c9_reward_done'))
    code[at:at] = [g(ctx), *set_(e, AUTO, [('newarray', 0)])]
    # C9 popup is the tail of these methods. Return bypasses only that old tail.
    return code + [('returnvoid',)]
