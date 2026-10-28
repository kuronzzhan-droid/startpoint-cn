"""Author rules 2026-10-27 15:17 / 15:19.

1. Consumer (BattleCharacterLogic/getAbilitySoulAbility): a riven only applies when
   the main slot holds the bound weapon (already enforced by the inherited C21
   consumer: isUnison -> None, equipment None -> None, equipment.id != row[1] -> None)
   AND the party has at most one revealed riven. Count = slots s in
   party.values.weapon_rivens whose Some(row) has row[0] revealed
   (16000001..16000999, != 16000900, not 16000901..16000919). >1 -> Option.None.
   Inserted inside the riven-only C21 region, right before the isUnison test, so
   ordinary souls and every earlier fail-closed check are untouched.
2. Party screen (PartyTranslator/translate): mark the slot inactive (grey icon) also
   when the edited party holds >1 revealed riven (counted from the native
   PartyLogic.getAbilitySoul(0..2) the translator already uses).
3. Party screen (PartyCarouselAbilitySoulView/present): grey icon only; the
   「未生效」 TextField is never created/shown (an already created one is hidden).
"""
import asm
from r2_common import ops_of, mn, num, revealed_jump, first_free, DYNAMIC, OPTION

CONSUMER = 'BattleCharacterLogic/getAbilitySoulAbility'
TRANSLATE = 'PartyTranslator/translate'
PRESENT = 'PartyCarouselAbilitySoulView/present'
INACTIVE = 'wfxRivenInactive'


def _count_rows(e, rows, slot, opt, ident, count, tag):
    """count = revealed Some(row) entries of Array `rows` (row = [id, weapon, ...])."""
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    L = lambda s: tag + s
    return [('pushbyte', 0), p(count), ('pushbyte', 0), p(slot),
            ('label', L('loop')), ('avm_label',), g(slot), g(rows), ('getproperty', e.q('length')),
            ('ifge', L('counted')),
            g(rows), g(slot), ('getproperty', DYNAMIC), ('coerce_a',), p(opt),
            g(opt), ('iffalse', L('next')), g(opt), ('getproperty', e.q('index')), ('pushbyte', 0),
            ('ifne', L('next')), g(opt), ('getproperty', e.q('params')), ('pushbyte', 0),
            ('getproperty', DYNAMIC), ('coerce_a',), p(opt), g(opt), ('iffalse', L('next')),
            g(opt), ('pushbyte', 0), ('getproperty', DYNAMIC), ('convert_i',), p(ident),
            *revealed_jump(e, ident, L('yes'), L('next')),
            ('label', L('yes')), ('inclocal_i', count),
            ('label', L('next')), ('inclocal_i', slot), ('jump', L('loop')),
            ('label', L('counted'))]


def queue_consumer(q):
    e = q.e
    ops = ops_of(e, CONSUMER)
    hits = [i for i in range(len(ops) - 2) if ops[i].name == 'getlocal_0'
            and ops[i + 1].name == 'getproperty' and mn(e, ops[i + 1]) == 'isUnison'
            and ops[i + 2].name == 'iftrue']
    assert len(hits) == 1, hits
    at = hits[0]
    # rows local: `pushstring 'weapon_rivens'; getproperty L; coerce_a; setlocal R` (C21 region)
    rows = [ops[i + 3].args[0] for i in range(at) if ops[i].name == 'pushstring'
            and e.abc.strings[ops[i].args[0]] == b'weapon_rivens'
            and ops[i + 1].name == 'getproperty' and ops[i + 2].name == 'coerce_a'
            and ops[i + 3].name == 'setlocal']
    assert len(rows) == 1, rows
    rows = rows[0]
    # The inherited checks just before the anchor: row[0] == id, then isUnison / weapon match.
    assert ops[at - 1].name == 'ifne'
    base = first_free(e, CONSUMER, 4)
    slot, opt, ident, count = base, base + 1, base + 2, base + 3
    code = [*_count_rows(e, rows, slot, opt, ident, count, 'r2c_'),
            ('getlocal', count), ('pushbyte', 1), ('ifle', 'single'),
            ('getlex', e.q(OPTION)), ('getproperty', e.q('None')), ('returnvalue',),
            ('label', 'single')]
    q.add('party-one-riven', CONSUMER, at, code, asm.FORBID,
          '>1 revealed riven rows in party.values.weapon_rivens -> Option.None')
    return {'method': CONSUMER, 'at': at, 'rows_local': rows, 'locals': [slot, opt, ident, count],
            'weapon_match_preexisting': 'isUnison->None; equipment None->None; equipment.id!=row[1]->None'}


def queue_translate(q):
    e = q.e
    ops = ops_of(e, TRANSLATE)
    marks = [i for i, o in enumerate(ops) if o.name == 'pushstring'
             and e.abc.strings[o.args[0]] == INACTIVE.encode()]
    assert len(marks) == 2, marks         # C9 annotate: false first, true on mismatch
    start = marks[0] - 1
    assert ops[start].name == 'getlocal' and ops[start - 1].name == 'setlocal'
    dto = ops[start - 1].args[0]
    sid = [i for i in range(marks[0], marks[1]) if ops[i].name == 'callproperty'
           and mn(e, ops[i]) == 'get_abilitySoulId']
    assert ops[sid[0] + 1].name == 'setlocal'
    soul_id = ops[sid[0] + 1].args[0]
    ends = [i for i in range(marks[1], len(ops) - 1) if ops[i].name == 'getlocal'
            and ops[i].args[0] == dto and ops[i + 1].name == 'callproperty' and mn(e, ops[i + 1]) == 'Some']
    at = ends[0] + 1                       # stack: [..., dto]; before Some(dto)
    base = first_free(e, TRANSLATE, 4)
    slot, opt, ident, count = base, base + 1, base + 2, base + 3
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    code = [g(soul_id), ('convert_i',), p(ident),
            *revealed_jump(e, ident, 'mine', 'done'), ('label', 'mine'),
            ('pushbyte', 0), p(count), ('pushbyte', 0), p(slot),
            ('label', 'loop'), ('avm_label',), g(slot), ('pushbyte', 3), ('ifge', 'counted'),
            ('getlocal_2',), g(slot), ('callproperty', e.q('getAbilitySoul'), 1), ('coerce_a',), p(opt),
            g(opt), ('iffalse', 'next'), g(opt), ('getproperty', e.q('index')), ('pushbyte', 0),
            ('ifne', 'next'), g(opt), ('getproperty', e.q('params')), ('pushbyte', 0),
            ('getproperty', DYNAMIC), ('callproperty', e.q('get_abilitySoulId'), 0), ('convert_i',), p(ident),
            *revealed_jump(e, ident, 'yes', 'next'), ('label', 'yes'), ('inclocal_i', count),
            ('label', 'next'), ('inclocal_i', slot), ('jump', 'loop'),
            ('label', 'counted'), g(count), ('pushbyte', 1), ('ifle', 'done'),
            g(dto), e.string(INACTIVE), ('pushtrue',), ('setproperty', DYNAMIC),
            ('label', 'done')]
    q.add('party-one-riven-ui', TRANSLATE, at, code, asm.FORBID,
          'edited party with >1 revealed riven: every revealed slot inactive (grey)')
    return {'method': TRANSLATE, 'at': at, 'dto_local': dto, 'soul_id_local': soul_id}


def queue_present(q):
    e = q.e
    ops = ops_of(e, PRESENT)
    hits = [i for i in range(len(ops) - 4) if ops[i].name == 'getlocal' and ops[i + 1].name == 'iftrue'
            and ops[i + 2].name == 'getlocal' and ops[i + 3].name == 'iffalse'
            and ops[i + 4].name == 'getlex' and mn(e, ops[i + 4]) == 'starling.text::TextField']
    assert len(hits) == 1, hits
    at = hits[0]
    inactive = ops[at + 2].args[0]
    code = [('pushfalse',), ('setlocal', inactive)]
    q.add('party-gray-only', PRESENT, at, code, asm.FORBID,
          'grey filter already applied above; badge text never created, existing one hidden')
    return {'method': PRESENT, 'at': at, 'inactive_local': inactive}
