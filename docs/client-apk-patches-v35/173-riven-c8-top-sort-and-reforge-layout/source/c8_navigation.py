"""C8 card navigation using existing window handlers and owned save records."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, context, get, set_, queue
from c3_filter_engine import emit_sort_ids
from c4_dismantle import owned_window
from c2_transaction import refresh

LEFT, RIGHT = 0x0A000000, 0x0B000000
MIN_ID, MAX_ID = 16000001, 16000999


def records(e):
    q = e.q
    return [('getlex', q('PinballClientMain')), ('getproperty', q('top')),
            ('getproperty', q('logic')), ('getproperty', q('globalLogic')),
            ('getproperty', q('logicStatus')), ('callproperty', q('getPlayerSaveData'), 0),
            *get(e, 'weapon_rivens')]


def enumerate_cards(e, collection, ids, ident, record, tag):
    q = e.q
    g = lambda n: ('getlocal', n)
    return [*records(e), ('setlocal', collection), ('newarray', 0), ('setlocal', ids),
            g(collection), ('iffalse', tag + '_end'), number(e, MIN_ID), ('setlocal', ident),
            ('label', tag + '_loop'), ('avm_label',), g(ident), number(e, MAX_ID),
            ('ifgt', tag + '_end'), g(collection), g(ident), ('getproperty', DYNAMIC),
            ('setlocal', record), g(record), ('iffalse', tag + '_next'),
            g(ids), g(ident), ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
            ('label', tag + '_next'), ('inclocal_i', ident), ('jump', tag + '_loop'),
            ('label', tag + '_end')]


def available(e, first, busy=False):
    ctx, collection, ids, ident, record = range(first, first + 5)
    code = context(e, ctx, 'c8_original') + owned_window(e, ctx, 'c8_no')
    if busy:
        code += [('getlocal_0',), ('getproperty', e.q('scene')), ('getlocal_0',),
                 ('getproperty', e.q('kind')), ('callproperty', e.q('isInputAvailableForStateKind'), 1),
                 ('iffalse', 'c8_no'), ('getlocal_0',), ('getproperty', e.q('scene')),
                 ('callproperty', e.q('isMainLoop'), 0), ('iffalse', 'c8_no'),
                 ('getlocal_0',), ('getproperty', e.q('windowStatus')),
                 ('getproperty', e.q('index')), number(e, 0), ('ifne', 'c8_no')]
    code += enumerate_cards(e, collection, ids, ident, record, 'c8_count')
    return code + [('getlocal', ids), ('getproperty', e.q('length')), number(e, 1),
                   ('greaterthan',), ('returnvalue',), ('label', 'c8_no'),
                   ('pushfalse',), ('returnvalue',), ('label', 'c8_original')]


def switch_card(e, first):
    q = e.q
    ctx, collection, ids, ident, record, setting, index, position = range(first, first + 8)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    code = [('getlocal_1',), number(e, LEFT), ('ifeq', 'c8_button'),
            ('getlocal_1',), number(e, RIGHT), ('ifne', 'c8_original'), ('label', 'c8_button')]
    code += context(e, ctx, 'c8_original') + owned_window(e, ctx, 'c8_done')
    code += [('getlocal_0',), ('getproperty', q('scene')), ('getlocal_0',),
             ('getproperty', q('kind')), ('callproperty', q('isInputAvailableForStateKind'), 1),
             ('iffalse', 'c8_done'), ('getlocal_0',), ('getproperty', q('scene')),
             ('callproperty', q('isMainLoop'), 0), ('iffalse', 'c8_done'),
             ('getlocal_0',), ('getproperty', q('windowStatus')),
             ('getproperty', q('index')), number(e, 0), ('ifne', 'c8_done')]
    code += enumerate_cards(e, collection, ids, ident, record, 'c8_cards')
    code += [g(ids), ('getproperty', q('length')), ('iffalse', 'c8_done'),
             e.string('keywordSearchKinds'), ('newarray', 0), ('newobject', 1), p(setting)]
    code += emit_sort_ids(e, ids, collection, setting, first + 8, 'c8_order')
    code += [number(e, 1), ('negate_i',), p(position), number(e, 0), p(index),
             ('label', 'c8_find'), ('avm_label',), g(index), g(ids), ('getproperty', q('length')),
             ('ifge', 'c8_found'), g(ids), g(index), ('getproperty', DYNAMIC),
             g(ctx), *get(e, 'item_id'), ('ifne', 'c8_find_next'), g(index), p(position),
             ('jump', 'c8_found'), ('label', 'c8_find_next'), ('inclocal_i', index),
             ('jump', 'c8_find'), ('label', 'c8_found'), ('getlocal_1',), number(e, LEFT),
             ('ifeq', 'c8_previous'), ('inclocal_i', position), g(position), g(ids),
             ('getproperty', q('length')), ('iflt', 'c8_chosen'), number(e, 0), p(position),
             ('jump', 'c8_chosen'), ('label', 'c8_previous'), ('declocal_i', position),
             g(position), number(e, 0), ('ifge', 'c8_chosen'),
             g(ids), ('getproperty', q('length')), number(e, 1), ('subtract_i',), p(position),
             ('label', 'c8_chosen'), g(ids), g(position), ('getproperty', DYNAMIC), p(ident),
             g(collection), g(ident), ('getproperty', DYNAMIC), p(record),
             g(ctx), *set_(e, 'item_id', [g(ident)]),
             g(ctx), *set_(e, 'status_id', [g(ident), ('negate_i',)]),
             g(ctx), *set_(e, 'record', [g(record)]),
             g(ctx), *set_(e, 'c4_dismantle_target', [('pushnull',)]), *refresh(e),
             g(record), *get(e, 'pending'), ('iffalse', 'c8_done'), ('getlocal_0',),
             ('callpropvoid', q('finishTransitionToExpodScene'), 0),
             ('label', 'c8_done'), ('returnvoid',), ('label', 'c8_original')]
    return code


def route_swipe(e, first):
    """Inserted after the original recognizer's end() result becomes local 6."""
    q = e.q
    ctx, node, window = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    return context(e, ctx, 'c8_swipe_original') + [
        ('getlocal', 6), number(e, 1), ('ifeq', 'c8_swipe_valid'),
        ('getlocal', 6), number(e, 1), ('negate_i',), ('ifne', 'c8_swipe_done'),
        ('label', 'c8_swipe_valid'), ('getlocal_0',), ('getproperty', q('scene')),
        ('getproperty', q('activeStates')), ('getproperty', q('h')), ('setlocal', node),
        ('label', 'c8_swipe_states'), ('avm_label',), g(node), ('iffalse', 'c8_swipe_done'),
        g(node), ('getproperty', q('item')), ('setlocal', window),
        g(window), ('getproperty', q('kind')), ('getproperty', q('index')),
        number(e, 6), ('ifne', 'c8_swipe_next'), g(window), ('getlocal', 6), number(e, 1),
        ('ifeq', 'c8_swipe_left'), number(e, RIGHT), ('jump', 'c8_swipe_call'),
        ('label', 'c8_swipe_left'), number(e, LEFT), ('label', 'c8_swipe_call'),
        ('callpropvoid', q('buttonClicked'), 1), ('returnvoid',),
        ('label', 'c8_swipe_next'), g(node), ('getproperty', q('next')), ('setlocal', node),
        ('jump', 'c8_swipe_states'), ('label', 'c8_swipe_done'), ('returnvoid',),
        ('label', 'c8_swipe_original')]


def queue_navigation(e):
    from c8_navigation_view import queue_navigation_view
    result = {}
    for label, fn in [('ExBoostWindow/buttonClicked', switch_card),
                      ('ExBoostWindow/needShowSideArrow', available),
                      ('ExBoostWindow/canChangeStateBySwipe', lambda e,n: available(e,n,True))]:
        body = e.body(label)
        ops = asm.decode(body[5])
        at = 2 if [o.name for o in ops[:2]] == ['getlocal_0', 'pushscope'] else 0
        result[label] = queue(e, label, fn(e, body[2]), at)
    label = 'ExpodSwipeLogic/swipeInput'
    body = e.body(label)
    ops = asm.decode(body[5])
    assert ops[167].name == 'setlocal' and ops[167].args == [6]
    assert ops[153].name == 'callproperty' and e.abc.mn_name(ops[153].args[0]) == 'end'
    result[label] = queue(e, label, route_swipe(e, body[2]), 168)
    result.update(queue_navigation_view(e))
    return {'methods': result, 'buttons': [LEFT, RIGHT],
            'order': 'weapon list default: riven_id descending, item_id descending tie',
            'range': [MIN_ID, MAX_ID], 'wrap': True,
            'optional_icon_picker': 'not added; arrows and existing swipe recognizer are supported',
            'new_methods': 0, 'new_traits': 0}
