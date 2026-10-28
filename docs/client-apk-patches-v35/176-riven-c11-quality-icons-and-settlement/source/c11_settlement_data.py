"""C11 optional auto-dismantle payload copying and TypePacker descriptors."""
from c1_lookup import number
from c2_common import DYNAMIC, get, set_, queue
from c9_data_types import COMMON, FINISH, CONTEXT
import asm

AUTO = 'weapon_riven_auto_dismantled'
ROW = 'c11.WeaponRivenAutoDismantled'
ROWS = 'c11.WeaponRivenAutoDismantledList'


def copy_pairs(e, source, out, first, tag, fail, affixes=False):
    """Deep-copy validated server tuples; cap_L remains data, never display."""
    rows, index, pair, value, copied = range(first, first + 5)
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    n = lambda v: number(e, v)
    gp = lambda v: ('getproperty', e.q(v))
    loop, done, pair_ok = [tag + '_' + s for s in ('loop', 'done', 'pair_ok')]
    code = [*source, p(rows), g(rows), ('istype', e.q('Array')), ('iffalse', fail),
            ('newarray', 0), p(out), n(0), p(index)]
    if affixes:
        code += [g(rows), gp('length'), n(1), ('iflt', fail),
                 g(rows), gp('length'), n(4), ('ifgt', fail)]
    code += [('label', loop), ('avm_label',), g(index), g(rows), gp('length'),
             ('ifge', done), g(rows), g(index), ('getproperty', DYNAMIC), p(pair),
             g(pair), ('istype', e.q('Array')), ('iffalse', fail),
             g(pair), gp('length'), n(2), ('ifeq', pair_ok)]
    if affixes:
        code += [g(pair), gp('length'), n(3), ('ifne', fail)]
    else:
        code += [('jump', fail)]
    code += [('label', pair_ok)]
    for slot, minimum, maximum in ((0, 1, None), (1, 1 if affixes else 0, 100 if affixes else None)):
        code += [g(pair), n(slot), ('getproperty', DYNAMIC), p(value), g(value),
                 g(value), ('convert_i',), ('ifstrictne', fail), g(value), n(minimum), ('iflt', fail)]
        if maximum is not None:
            code += [g(value), n(maximum), ('ifgt', fail)]
    code += [g(pair), n(0), ('getproperty', DYNAMIC), g(pair), n(1),
             ('getproperty', DYNAMIC), ('newarray', 2), p(copied)]
    if affixes:
        no_cap = tag + '_no_cap'
        code += [g(pair), gp('length'), n(3), ('ifne', no_cap), g(pair), n(2),
                 ('getproperty', DYNAMIC), p(value), g(value), g(value), ('convert_i',),
                 ('ifstrictne', fail), g(value), n(1), ('iflt', fail),
                 g(value), n(100), ('ifgt', fail), g(copied), g(value),
                 ('callpropvoid', e.q('push'), 1), ('label', no_cap)]
    code += [g(out), g(copied), ('callpropvoid', e.q('push'), 1),
             ('inclocal_i', index), ('jump', loop), ('label', done)]
    return code


def parse_auto(e, source, target, first, tag):
    rows, index, row, weapon, affixes, rewards, out = range(first, first + 7)
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    n = lambda v: number(e, v)
    done, loop, skip, store = [tag + '_' + s for s in ('done', 'loop', 'skip', 'store')]
    code = [*source, *get(e, AUTO), p(rows), g(rows), ('istype', e.q('Array')),
            ('iffalse', done), ('newarray', 0), p(out), n(0), p(index),
            ('label', loop), ('avm_label',), g(index), g(rows), ('getproperty', e.q('length')),
            ('ifge', store), g(rows), g(index), ('getproperty', DYNAMIC), p(row),
            g(row), ('iffalse', skip), g(row), *get(e, 'weapon_id'), p(weapon),
            g(weapon), g(weapon), ('convert_i',), ('ifstrictne', skip),
            g(weapon), n(1), ('iflt', skip)]
    code += copy_pairs(e, [g(row), *get(e, 'affixes')], affixes, first + 7, tag + '_affix', skip, True)
    code += copy_pairs(e, [g(row), *get(e, 'rewards')], rewards, first + 7, tag + '_rewards', skip)
    code += [g(out), e.string('weapon_id'), g(weapon), e.string('affixes'), g(affixes),
             e.string('rewards'), g(rewards), ('newobject', 3), ('callpropvoid', e.q('push'), 1),
             ('label', skip), ('inclocal_i', index), ('jump', loop), ('label', store),
             *target, *set_(e, AUTO, [g(out)]), ('label', done)]
    return code


def queue_types(e):
    label = 'TypePackerResource2/resolveMap2201'
    body = e.body(label)
    reg, params = body[2], body[2] + 1
    g = lambda v: ('getlocal', v)
    n = lambda v: number(e, v)
    gp = lambda v: ('getproperty', e.q(v))
    fields = {'weapon_id': 'Int', 'affixes': 'c1.WeaponRivenAffixes', 'rewards': 'c1.WeaponRivenAffixes'}
    code = [('dup',), ('setlocal', reg), g(reg), gp('h'), e.string(ROW),
            ('getlex', e.q('typepacker.core::TypeInformation')),
            ('findpropstrict', e.q('haxe.ds::StringMap')), ('constructprop', e.q('haxe.ds::StringMap'), 0)]
    for field, kind in fields.items():
        code += [('dup',), gp('h'), e.string(field), e.string(kind), ('setproperty', DYNAMIC)]
    code += [*[e.string(field) for field in fields], ('newarray', 3), ('pushnull',),
             ('pushfalse',), ('pushnull',), ('callproperty', e.q('ANONYMOUS'), 5), ('setproperty', DYNAMIC),
             g(reg), gp('h'), e.string(ROWS), ('getlex', e.q('typepacker.core::TypeInformation')),
             e.string(ROW), n(0), ('callproperty', e.q('COLLECTION'), 2), ('setproperty', DYNAMIC)]
    for typ in (COMMON, FINISH, CONTEXT):
        code += [g(reg), gp('h'), e.string(typ), ('getproperty', DYNAMIC), gp('params'), ('setlocal', params),
                 g(params), n(0), ('getproperty', DYNAMIC), gp('h'), e.string(AUTO), e.string(ROWS),
                 ('setproperty', DYNAMIC)]
        for slot in (1, 4):
            code += [g(params), n(slot), ('getproperty', DYNAMIC), e.string(AUTO),
                     ('callpropvoid', e.q('push'), 1)]
    return {'insertion': queue(e, label, code, len(asm.decode(body[5])) - 1),
            'optional_field': AUTO, 'schemas': [ROW, ROWS], 'new_runtime_types': []}
