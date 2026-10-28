"""C9 NEW and native protection icons read current save records on every draw."""
import asm
from c1_lookup import lookup, number
from c2_common import get, queue

NEW_ASSET = 'scene/general/sprite_sheet/bitmap_text-assets/status_new'
NEW_CHILD = 'wfx-riven-new'


def current_lookup(e, ident, scratch, record, fail):
    # C4 widened the display-only instance range; preserve it in fresh C9 splices.
    old, new = number(e, 16000200), number(e, 16000999)
    return [new if op == old else op for op in lookup(e, ident, scratch, record, fail)]


def states(e, ident, scratch, record, unseen, locked, tag):
    g = lambda n: ('getlocal', n)
    return [('pushfalse',), ('setlocal', unseen), ('pushfalse',), ('setlocal', locked),
            *current_lookup(e, ident, scratch, record, tag + '_ready'),
            g(record), *get(e, 'seen'), number(e, 0), ('strictequals',), ('setlocal', unseen),
            g(record), *get(e, 'locked'), number(e, 1), ('strictequals',), ('setlocal', locked),
            ('label', tag + '_ready')]


def panel(e, info, thumbnail, first):
    ident, scratch, record, unseen, locked = range(first, first + 5)
    g = lambda n: ('getlocal', n)
    return [g(info), ('getproperty', e.q('itemId')), ('setlocal', ident),
            g(ident), number(e, 16000001), ('iflt', 'list_previous'),
            g(ident), number(e, 16000999), ('ifle', 'list_riven'),
            ('label', 'list_previous'), g(thumbnail), ('getproperty', e.q('layer')),
            e.string('wfx-riven-name'), ('callproperty', e.newq('getChildByName'), 1),
            ('iffalse', 'list_done'), ('label', 'list_riven'),
            *states(e, ident, scratch, record, unseen, locked, 'list'),
            g(thumbnail), g(unseen), ('callpropvoid', e.q('set_newIconVisible'), 1),
            g(thumbnail), ('callproperty', e.q('getItemThumbnail'), 0),
            g(locked), ('callpropvoid', e.q('setProtectionIconVisible'), 1), ('label', 'list_done')]


def weapon_new(e, unseen, first):
    layer, image = first, first + 1
    g = lambda n: ('getlocal', n)
    q = e.q
    return [('getlocal_0',), ('getproperty', q('thumbnailView')), ('getproperty', q('layer')),
            ('setlocal', layer), g(layer), e.string(NEW_CHILD),
            ('callproperty', e.newq('getChildByName'), 1), ('setlocal', image),
            g(image), ('iftrue', 'weapon_new_ready'), g(unseen), ('iffalse', 'weapon_new_done'),
            ('getlocal_0',), ('getproperty', q('view')), ('getproperty', q('asset')),
            e.string(NEW_ASSET), ('callproperty', q('getImage'), 1), ('setlocal', image),
            g(image), e.string(NEW_CHILD), ('setproperty', q('name')),
            g(image), number(e, 76), ('negate',), ('setproperty', q('x')),
            g(image), number(e, 78), ('negate',), ('setproperty', q('y')),
            g(image), ('pushfalse',), ('setproperty', q('touchable')),
            g(layer), g(image), ('callpropvoid', q('addChild'), 1),
            ('label', 'weapon_new_ready'), g(image), g(unseen), ('setproperty', q('visible')),
            ('label', 'weapon_new_done')]


def weapon(e, first):
    ident, scratch, record, unseen, locked = range(first, first + 5)
    q = e.q
    return [('getlocal_1',), *get(e, 'item_id'), ('setlocal', ident),
            *states(e, ident, scratch, record, unseen, locked, 'weapon'),
            ('getlocal_0',), ('getproperty', q('thumbnailView')), ('getlocal', locked),
            ('callpropvoid', q('setProtectionIconVisible'), 1),
            *weapon_new(e, unseen, first + 5)]


def clear_weapon_new(e, first):
    q = e.q
    return [('getlocal_0',), ('getproperty', q('layout')), ('iffalse', 'weapon_clear_done'),
            ('pushfalse',), ('setlocal', first), *weapon_new(e, first, first + 1),
            ('label', 'weapon_clear_done')]


def queue_lists(e):
    from c9_lists_refresh import queue_refresh
    result = {}
    for label, info, thumbnail in [('PanelInnerContentItemListTableView/draw', 5, 6),
                                  ('PanelInnerContentItemListTableView/apply', 14, 12)]:
        body = e.body(label); ops = asm.decode(body[5])
        if label.endswith('/draw'):
            assert ops[86].name == 'setlocal' and ops[86].args == [6]
            at = 87
        else:
            matches = [i for i, op in enumerate(ops) if op.name == 'callpropvoid'
                       and e.abc.mn_name(op.args[0]) == 'showItem']
            assert len(matches) == 1
            at = matches[0] + 1
        result[label] = queue(e, label, panel(e, info, thumbnail, body[2]), at)
    label = 'EquipmentListTableItemView/apply'
    body = e.body(label); ops = asm.decode(body[5])
    assert ops[90].name == 'callpropvoid' and e.abc.mn_name(ops[90].args[0]) == 'set_text'
    # The C3 null-layout guard jumps directly to return. Only rendered rows
    # falling through the last text update have a native thumbnail to decorate.
    result[label] = queue(e, label, weapon(e, body[2]), 91, asm.SKIP)
    queue(e, label, clear_weapon_new(e, body[2] + 7), 2)
    result.update(queue_refresh(e))
    return {'methods': result, 'new_asset': NEW_ASSET, 'lock': 'existing ItemThumbnailView.setProtectionIconVisible',
            'missing_v12': 'no NEW and no protection icon', 'state_source': 'current save lookup; no optimistic update'}
