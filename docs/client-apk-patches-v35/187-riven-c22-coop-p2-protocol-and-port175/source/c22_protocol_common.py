"""Small AVM2 emission helpers; no runtime helper method or trait is added."""
from c2_common import DYNAMIC, get, set_

BUILTIN = 'http://adobe.com/AS3/2006/builtin::'
CONTEXT_FIELDS = ('weapon_riven_scope', 'weapon_riven_snapshot_id',
                  'weapon_riven_mode', 'weapon_riven_catalog', 'weapon_riven_reason')


def num(e, value):
    try:
        return [e.number(value)]
    except Exception:
        # Preserve existing numeric pools; ASCII conversion is exact for these
        # bounded integer constants and Number.MAX_SAFE_INTEGER.
        return [e.string(str(value)), ('convert_d',)]


def gp(e, key):
    return get(e, key)


def call(e, key, count, void=False):
    return [('callpropvoid' if void else 'callproperty', e.q(key), count)]


def at(e, array, index):
    return [('getlocal', array), *num(e, index), ('getproperty', DYNAMIC)]


def integer(e, local, minimum, maximum, fail):
    g = ('getlocal', local)
    return [g, ('istype', e.q('Number')), ('iffalse', fail),
            g, *num(e, minimum), ('iflt', fail),
            g, *num(e, maximum), ('ifgt', fail),
            g, *num(e, 1), ('modulo',), *num(e, 0), ('ifne', fail)]


def identifier(e, local, fail):
    return [('getlocal', local), ('istype', e.q('String')), ('iffalse', fail),
            ('getlex', e.q('RegExp')), e.string('^[A-Za-z0-9_-]{1,96}$'),
            ('construct', 1), ('getlocal', local), *call(e, 'test', 1), ('iffalse', fail)]


def array(e, local, fail, length=None):
    code = [('getlocal', local), ('istype', e.q('Array')), ('iffalse', fail)]
    if length is not None:
        code += [('getlocal', local), *gp(e, 'length'), *num(e, length), ('ifne', fail)]
    return code


def append(e, canonical, value):
    return [('getlocal', canonical), e.string('|'), ('add',), *value,
            ('add',), ('setlocal', canonical)]


def option(e, value, output, scratch, fail, tag, field=None):
    """Decode a concrete haxe Option, with exact Some arity and scalar IDs."""
    done, none = tag + '_done', tag + '_none'
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    code = [g(value), ('iffalse', fail), g(value), *gp(e, 'index'),
            *num(e, 1), ('ifeq', none), g(value), *gp(e, 'index'),
            *num(e, 0), ('ifne', fail), g(value), *gp(e, 'params'), p(scratch),
            *array(e, scratch, fail, 1), *at(e, scratch, 0), p(output)]
    if field:
        code += [g(output), ('iffalse', fail), g(output), *gp(e, field), p(output)]
    code += [*integer(e, output, 1, 2147483647, fail), ('jump', done),
             ('label', none), *num(e, 0), p(output), ('label', done)]
    return code


def is_instance(e, local, yes, no):
    g = ('getlocal', local)
    return [g, *num(e, 16000001), ('iflt', no),
            g, *num(e, 16000999), ('ifgt', no),
            g, *num(e, 16000900), ('ifeq', no), ('jump', yes)]


def show(e, message):
    return [('getlocal_0',), e.string(message),
            ('getlex', e.q('pinball.context.scene.instantMessage::InstantMessagePosition')),
            *gp(e, 'Center'), *call(e, 'showInstantMessage', 2, True)]


def clear(e, key):
    return [('getlocal_0',), *gp(e, 'continuationData'), *set_(e, key, [('pushnull',)])]
