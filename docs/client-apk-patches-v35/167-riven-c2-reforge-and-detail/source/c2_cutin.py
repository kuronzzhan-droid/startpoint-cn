"""Riven cutin rows use existing timelines and self-identifying value DTOs."""
from c2_common import context, dtos, get, prefix, DYNAMIC, MODE

KIND = 'pinball.scene.expod.cutin._ExAbilityCutin::ExAbilityCutinKind'
STATUS = 'pinball.scene.expod.cutin._ExAbilityCutin::ExAbilityCutinStatus'
BOOST = 'pinball.scene.expod.cutin::ExBoostCutinStatus'


def start(e, first):
    ctx, affixes, values, index, row = range(first, first + 5)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    gp = lambda n: ('getproperty', e.q(n))
    code = context(e, ctx, 'cutin_original')
    code += [('getlocal_1',), *get(e, 'affixes'), p(affixes)]
    code += dtos(e, affixes, values, first + 5,
                 [('getlocal_0',), gp('logic'), gp('asset')], 'cutin_dto')
    code += [('getlocal_0',), ('getlex', e.q(BOOST)),
             e.string('mode'), e.string(MODE), ('newobject', 1),
             ('callproperty', e.q('ShowingExBoost'), 1), ('setproperty', e.q('cutinStatus')),
             ('getlocal_0',), gp('cutinPlayhead'), e.string('start'),
             ('callpropvoid', e.q('gotoAndPlay'), 1), ('pushbyte', 0), p(index),
             ('label', 'cutin_rows'), ('avm_label',), g(index), g(values), gp('length'),
             ('ifge', 'cutin_done'), ('getlocal_0',), gp('exAbilityCutins'), g(index),
             ('getproperty', DYNAMIC), p(row), g(row), ('getlex', e.q(KIND)),
             e.string('ExAbility'), ('pushbyte', 2), g(values), g(index),
             ('getproperty', DYNAMIC), ('newarray', 1), ('construct', 3),
             ('setproperty', e.q('kind')), g(row), ('getlex', e.q(STATUS)), g(index),
             ('callproperty', e.q('WaitStart'), 1), ('setproperty', e.q('status')),
             ('inclocal_i', index), ('jump', 'cutin_rows'), ('label', 'cutin_done'),
             ('returnvoid',), ('label', 'cutin_original')]
    return code


def dto(e, value, fail):
    """Check the row itself, so exit animation survives cleared scene context."""
    gp = lambda n: ('getproperty', e.q(n))
    return [('getlocal_0',), gp('kind'), gp('index'), ('pushbyte', 2), ('ifne', fail),
            ('getlocal_0',), gp('kind'), gp('params'), ('pushbyte', 0),
            ('getproperty', DYNAMIC), ('coerce_a',), ('setlocal', value),
            e.string('mode'), ('getlocal', value), ('in',), ('iffalse', fail),
            ('getlocal', value), *get(e, 'mode'), e.string(MODE), ('ifne', fail)]


def row_animation(e, first, out=False):
    value = first
    tag = 'riven_out' if out else 'riven_start'
    gp = lambda n: ('getproperty', e.q(n))
    code = dto(e, value, tag + '_original')
    # DTO rarity is currently 5. Keep all three existing rarities supported.
    for rarity, name in [(3, 'bronze'), (4, 'silver'), (5, 'gold')]:
        code += [('getlocal', value), *get(e, 'rarity'), ('pushbyte', rarity),
                 ('ifne', tag + '_' + name + '_next'), ('getlocal_0',), gp('cutinPlayhead'),
                 e.string(name + ('_out' if out else '_start')),
                 ('callpropvoid', e.q('gotoAndPlay'), 1)]
        if not out:
            code += [('getlocal_0',), gp('starSetEffectPlayhead'),
                     e.string('hide' if rarity == 3 else name + '_loop'),
                     ('callpropvoid', e.q('gotoAndPlay'), 1)]
        code += [('returnvoid',), ('label', tag + '_' + name + '_next')]
    code += [('returnvoid',), ('label', tag + '_original')]
    return code


def description(e, first):
    return dto(e, first, 'description_original') + [
        ('getlocal', first), *get(e, 'description'), ('coerce_s',),
        ('returnvalue',), ('label', 'description_original')]


def queue_cutin_splices(e):
    return {
        'ExBoostCutin/startExBoost': prefix(e, 'ExBoostCutin/startExBoost', start),
        'ExAbilityCutin/innerStart': prefix(e, 'ExAbilityCutin/innerStart', row_animation),
        'ExAbilityCutin/innerOut': prefix(e, 'ExAbilityCutin/innerOut',
                                         lambda e, first: row_animation(e, first, True)),
        'ExAbilityCutin/getDescriptionText': prefix(e, 'ExAbilityCutin/getDescriptionText', description),
    }
