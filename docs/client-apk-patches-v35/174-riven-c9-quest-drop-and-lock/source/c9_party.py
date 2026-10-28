"""C9: expose the same-slot binding result in the existing party soul view."""
import asm
from c1_lookup import lookup, number
from c2_common import DYNAMIC, get, set_, queue
from c9_lists import current_lookup
from c9_party_gray import gray

INACTIVE = 'wfxRivenInactive'
CHILD = 'wfx-riven-inactive-'


def annotate(e, first):
    dto, ident, scratch, record = range(first, first + 4)
    g = lambda n: ('getlocal', n)
    q = e.q
    return [('setlocal', dto), g(dto), *set_(e, INACTIVE, [('pushfalse',)]),
            g(33), ('getproperty', q('params')), number(e, 0), ('getproperty', DYNAMIC),
            ('callproperty', q('get_abilitySoulId'), 0), ('setlocal', ident),
            *current_lookup(e, ident, scratch, record, 'party_mark_done'),
            g(24), ('getproperty', q('index')), number(e, 0), ('ifne', 'party_inactive'),
            g(24), ('getproperty', q('params')), number(e, 0), ('getproperty', DYNAMIC),
            ('getproperty', q('id')), g(record), *get(e, 'weapon_id'), ('convert_i',),
            ('ifeq', 'party_mark_done'), ('label', 'party_inactive'),
            g(dto), *set_(e, INACTIVE, [('pushtrue',)]),
            ('label', 'party_mark_done'), g(dto)]


def find_label(e, layer, text):
    q = e.q
    return [('getlocal_0',), ('getproperty', q('pixelArtAbilitySoulLayer')), ('setlocal', layer),
            ('getlocal', layer), e.string(CHILD), ('getlocal_0',),
            ('getproperty', q('partyCharacterIndex')), ('add',),
            ('callproperty', e.newq('getChildByName'), 1), ('setlocal', text)]


def present(e, first):
    inactive, layer, text = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    q = e.q
    return [('pushfalse',), ('setlocal', inactive), ('getlocal_1',),
            ('getproperty', q('index')), number(e, 0), ('ifne', 'party_view_ready'),
            ('getlocal_1',), ('getproperty', q('params')), number(e, 0),
            ('getproperty', DYNAMIC), *get(e, INACTIVE), ('convert_b',), ('setlocal', inactive),
            ('label', 'party_view_ready'), *gray(e, inactive, first+3), *find_label(e, layer, text),
            g(text), ('iftrue', 'party_text_ready'), g(inactive), ('iffalse', 'party_view_done'),
            ('getlex', q('starling.text::TextField')), number(e, 48), number(e, 16),
            e.string('未生效'), ('getlex', q('starling.text::TextFormat')),
            ('getlex', q('pinball.font::Fonts')), ('callproperty', q('get_defaultFont'), 0),
            ('getproperty', q('fontName')), number(e, 11), number(e, 0x555555),
            ('construct', 3), ('construct', 4), ('setlocal', text),
            g(text), e.string(CHILD), ('getlocal_0',), ('getproperty', q('partyCharacterIndex')),
            ('add',), ('setproperty', q('name')), g(text), ('pushfalse',),
            ('setproperty', q('touchable')), g(text), ('pushtrue',), ('setproperty', q('autoScale')),
            g(layer), g(text), ('callpropvoid', q('addChild'), 1),
            ('label', 'party_text_ready'), g(text), g(inactive), ('setproperty', q('visible')),
            ('label', 'party_view_done')]


def draw(e, first):
    layer, text = first, first + 1
    q = e.q
    g = lambda n: ('getlocal', n)
    return [*find_label(e, layer, text), g(text), ('iffalse', 'party_draw_done'),
            g(text), ('getlocal_0',), ('getproperty', q('abilitySoul')), ('getproperty', q('x')),
            number(e, 24), ('subtract',), ('setproperty', q('x')),
            g(text), ('getlocal_0',), ('getproperty', q('abilitySoul')), ('getproperty', q('y')),
            number(e, 2), ('add',), ('setproperty', q('y')),
            g(text), ('getlocal_2',), ('setproperty', q('alpha')), ('label', 'party_draw_done')]


def queue_party(e):
    result = {}
    label = 'PartyTranslator/translate'
    body = e.body(label); ops = asm.decode(body[5])
    assert ops[402].name == 'newobject' and ops[402].args == [1]
    assert ops[403].name == 'callproperty' and e.abc.mn_name(ops[403].args[0]) == 'Some'
    result[label] = queue(e, label, annotate(e, body[2]), 403)
    for name, builder in [('present', present), ('draw', draw)]:
        label = 'PartyCarouselAbilitySoulView/' + name
        body = e.body(label); ops = asm.decode(body[5]); assert ops[-1].name == 'returnvoid'
        result[label] = queue(e, label, builder(e, body[2]), len(ops)-1)
    return {'methods': result, 'binding': 'same party slot equipment.id == weapon_rivens[item_id].weapon_id',
            'style': 'existing ColorMatrixFilter grayscale and Fonts TextField',
            'reset': 'ordinary, empty and matching slots restore white and hide label'}
