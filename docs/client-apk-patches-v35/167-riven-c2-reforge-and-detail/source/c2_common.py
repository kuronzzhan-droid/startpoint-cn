"""Inline AVM2 emitters shared by C2; these add no runtime methods or traits."""
import asm
from bootstrap import sha
from c1_lookup import number, dynamic_get

DYNAMIC = 14
MODE = 'wfx_riven'
OPTION = 'haxe.ds::Option'


def get(e, key):
    return dynamic_get(e, key)


def set_(e, key, value):
    """Object is already on stack; value is an instruction list."""
    return [e.string(key), *value, ('setproperty', DYNAMIC)]


def context(e, ctx, fail, scratch=None):
    """Read loadedData.wfx_riven, check mode, leave it in local ctx."""
    scratch = ctx if scratch is None else scratch
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    gp = lambda n: ('getproperty', e.q(n))
    code = [('getlex', e.q('PinballClientMain')), gp('top'), ('coerce_a',), p(scratch),
            g(scratch), ('iffalse', fail)]
    for field in ('logic', 'globalLogic', 'logicStatus'):
        code += [g(scratch), gp(field), ('coerce_a',), p(scratch), g(scratch), ('iffalse', fail)]
    code += [g(scratch), ('callproperty', e.q('getLoadedData'), 0), ('coerce_a',), p(scratch),
             g(scratch), ('iffalse', fail), g(scratch), *get(e, MODE), ('coerce_a',), p(ctx),
             g(ctx), ('iffalse', fail), g(ctx), *get(e, 'mode'), e.string(MODE), ('ifne', fail)]
    return code


def fresh_record(e, ctx, record, scratch, fail):
    """Refresh a context from the C1 save dictionary without mutating that record."""
    gp = lambda n: ('getproperty', e.q(n))
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    return [('getlex', e.q('PinballClientMain')), gp('top'), gp('logic'), gp('globalLogic'),
            gp('logicStatus'), ('callproperty', e.q('getPlayerSaveData'), 0),
            ('coerce_a',), p(scratch), g(scratch), ('iffalse', fail),
            g(scratch), *get(e, 'weapon_rivens'), ('coerce_a',), p(scratch),
            g(scratch), ('iffalse', fail), g(scratch), g(ctx), *get(e, 'item_id'),
            ('getproperty', DYNAMIC), ('coerce_a',), p(record),
            g(record), ('iffalse', fail), g(ctx), *set_(e, 'record', [g(record)])]


def queue(e, label, code, at=2, incoming=asm.ENTER):
    body = e.body(label)
    e.locks.setdefault(label, {'sha': sha(body[5]), 'header': list(body[1:5])})
    e.insert(label, at, code, incoming)
    return {'at': at, 'first_local': body[2], 'instructions': len(asm.assemble(code))}


def prefix(e, label, builder):
    """Builder(e, first_free_local) emits a branch with original fallthrough."""
    body = e.body(label)
    ops = asm.decode(body[5])
    assert [x.name for x in ops[:2]] == ['getlocal_0', 'pushscope'], label
    return queue(e, label, builder(e, body[2]))


def dtos(e, affixes, result, first, assets, tag='dto'):
    """Create [{mode,rarity,description}] from each actual L-scaled soul ability.

    assets is an AVM2 instruction list leaving LogicAssetContainer on stack.
    No ExAbilityPeek or fake ExStatus object is involved.
    """
    index, term, ability = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    gp = lambda n: ('getproperty', e.q(n))
    num = lambda n: number(e, n)
    again, done = tag + '_test', tag + '_done'
    return [('newarray', 0), p(result), num(0), p(index),
            ('label', again), ('avm_label',), g(index), g(affixes), gp('length'), ('ifge', done),
            g(affixes), g(index), ('getproperty', DYNAMIC), ('coerce_a',), p(term),
            ('getlex', e.q('pinball.common.data.ability::AbilitySoulAbilityLogic')), num(31),
            g(term), num(0), ('getproperty', DYNAMIC), ('convert_i',),
            ('getlex', e.q('pinball.common.data.ability::AbilityPowerValueCalculateMethod')),
            g(term), num(1), ('getproperty', DYNAMIC), ('convert_i',), num(1), num(100),
            ('callproperty', e.q('MinToMaxLevelScale'), 3), ('pushfalse',), *assets,
            ('construct', 5), p(ability),
            g(result), e.string('mode'), e.string(MODE), e.string('rarity'), num(5),
            e.string('description'), g(ability), ('callproperty', e.q('getDescriptions'), 0),
            e.string('\n'), ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::join'), 1),
            ('newobject', 3), ('callpropvoid', e.q('http://adobe.com/AS3/2006/builtin::push'), 1),
            ('inclocal_i', index), ('jump', again), ('label', done)]
