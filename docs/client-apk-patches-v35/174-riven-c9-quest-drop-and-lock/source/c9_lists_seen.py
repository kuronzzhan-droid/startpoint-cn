"""Use the batch seen endpoint only for a card whose detail has opened."""
import asm
from c1_lookup import number
from c2_common import context, get, queue
from c9_lists import current_lookup


def send(e, ident, scratch, record, dialog=False):
    q = e.q
    remote = [('getlocal_0',)] + ([('getproperty', q('logic'))] if dialog else [])
    remote += [('getproperty', q('remote'))]
    return [*current_lookup(e, ident, scratch, record, 'seen_done'),
            ('getlocal', record), *get(e, 'seen'), number(e, 0), ('ifstrictne', 'seen_done'),
            *remote, e.string('weapon_riven/seen'),
            e.string('item_ids'), ('getlocal', ident), ('newarray', 1), ('newobject', 1),
            ('callpropvoid', q('sendOnlyUserRequest'), 2), ('label', 'seen_done')]


def queue_seen(e):
    result = {}
    label = 'AbilitySoulDetailDialog/initialize'
    body = e.body(label); ops = asm.decode(body[5]); assert ops[-1].name == 'returnvoid'
    first = body[2]
    result[label] = queue(e, label, [('getlocal_1',), ('getproperty', e.q('id')),
        ('setlocal', first), *send(e, first, first+1, first+2, dialog=True)], len(ops)-1)
    # Direct resume of pending cards can open the EX page without the item dialog.
    label = 'ExBoostWindow/run'
    body = e.body(label); first = body[2]
    result[label] = queue(e, label, [*context(e, first, 'seen_original'),
        ('getlocal', first), *get(e, 'item_id'), ('setlocal', first+1),
        *send(e, first+1, first+2, first+3), ('label', 'seen_original')], 2)
    label = 'ExBoostWindow/buttonClicked'
    body = e.body(label); ops = asm.decode(body[5]); first = body[2]
    assert ops[302].name == 'setproperty' and ops[304].name == 'callpropvoid'
    assert e.abc.mn_name(ops[304].args[0]) == 'updateExBoostItems'
    result[label] = queue(e, label, [('getlocal', 13), *get(e, 'item_id'),
        ('setlocal', first), *send(e, first, first+1, first+2)], 303)
    return {'methods': result, 'path': 'weapon_riven/seen', 'payload': 'item_ids:[opened item_id]',
            'merge': 'existing RealRemote.sendOnlyUserRequest -> RealRemoteService common response',
            'revision': 'never written optimistically; subsequent actions use existing fresh_record lookup'}
