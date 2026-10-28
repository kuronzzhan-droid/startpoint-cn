"""Riven branches for existing EX window lifecycle, data and navigation methods."""
from c2_common import DYNAMIC, MODE, OPTION, context, fresh_record, get, set_, prefix, queue, dtos
from c1_lookup import number
import asm

STATE = 'pinball.scene.expod.exBoostWindow._ExBoostWindow::ExBoostState'
WINDOW_STATE = 'pinball.scene.expod.exBoostWindow::ExBoostWindowState'
ORDER = 'pinball.scene.expod.viewOrder::ExpodSceneViewOrderCommand'


def loaded(e):
    q = e.q
    return [('getlex', q('PinballClientMain')), ('getproperty', q('top')),
            ('getproperty', q('logic')), ('getproperty', q('globalLogic')),
            ('getproperty', q('logicStatus')), ('callproperty', q('getLoadedData'), 0)]


def ctx_record(e, first, tag):
    return context(e, first, tag) + fresh_record(e, first, first + 1, first + 2, tag)


def guard_return(e, first, value=None):
    code = context(e, first, 'page_original')
    code += [('returnvoid',)] if value is None else [(value,), ('returnvalue',)]
    return code + [('label', 'page_original')]


def run_prefix(e, first):
    q = e.q
    ctx, encoded, record, scratch = range(first, first + 4)
    code = [('getlocal_0',), ('getproperty', q('drawResult')), ('getproperty', q('index')),
            number(e, 0), ('ifne', 'page_original'), ('getlocal_0',),
            ('getproperty', q('drawResult')), ('getproperty', q('params')), number(e, 0),
            ('getproperty', DYNAMIC), ('coerce_a',), ('setlocal', ctx),
            ('getlocal', ctx), ('iffalse', 'page_original'), ('getlocal', ctx),
            *get(e, 'mode'), e.string(MODE), ('ifeq', 'page_context_ready'),
            # Existing CharacterExBoostInfo serialization retains only these
            # two legacy fields. A negative reserved item ID is an internal
            # discriminator; ordinary zero/positive EX statuses fall through.
            ('getlocal', ctx), *get(e, 'status_id'), ('convert_i',), ('setlocal', encoded),
            ('getlocal', encoded), number(e, 16000200), ('negate_i',), ('iflt', 'page_original'),
            ('getlocal', encoded), number(e, 16000001), ('negate_i',), ('ifgt', 'page_original'),
            e.string('mode'), e.string(MODE), e.string('item_id'),
            ('getlocal', encoded), ('negate_i',), e.string('status_id'), ('getlocal', encoded),
            e.string('ability_id_list'), ('newarray', 0), ('newobject', 4), ('setlocal', ctx),
            ('label', 'page_context_ready')]
    code += fresh_record(e, ctx, record, scratch, 'page_original')
    return code + [('getlocal_0',), ('getlex', q(OPTION)), ('getlocal', ctx),
                   ('callproperty', q('Some'), 1), ('setproperty', q('drawResult')),
                   *loaded(e), *set_(e, MODE, [('getlocal', ctx)]), ('label', 'page_original')]


def leave_prefix(e, first):
    q = e.q
    # The global context can already belong to a newly entered window. Clear only
    # the context carried by this window's second state argument.
    return context(e, first, 'page_original') + [
        ('getlocal_0',), ('getproperty', q('drawResult')), ('getproperty', q('index')),
        number(e, 0), ('ifne', 'page_original'), ('getlocal_0',),
        ('getproperty', q('drawResult')), ('getproperty', q('params')), number(e, 0),
        ('getproperty', DYNAMIC), ('getlocal', first), ('ifne', 'page_original'),
        *loaded(e), *set_(e, MODE, [('pushnull',)]), ('label', 'page_original')]


def view_initialized(e, first):
    q = e.q
    return context(e, first, 'page_original') + [
        ('getlocal_0',), ('getproperty', q('viewOrder')), ('getlex', q(ORDER)),
        ('getlocal_0',), ('callproperty', q('getExBoostInformation'), 0),
        ('callproperty', q('ApplyExBoostInformation'), 1), ('callpropvoid', q('notifyCommand'), 1),
        ('getlocal_0',), ('getlex', q(WINDOW_STATE)), ('getproperty', q('In')),
        ('callpropvoid', q('changeState'), 1), ('returnvoid',), ('label', 'page_original')]


def state_prefix(e, first):
    q = e.q
    ctx, record, scratch = range(first, first + 3)
    return ctx_record(e, first, 'page_original') + [
        ('getlocal', record), *get(e, 'pending'), ('iftrue', 'page_unavailable'),
        ('getlocal', record), *get(e, 'next_cost'), ('convert_i',), number(e, 1),
        ('iflt', 'page_unavailable'), ('getlocal_0',), ('getproperty', q('player')),
        number(e, 2370099), ('callproperty', q('getItemNumber'), 1),
        ('getlocal', record), *get(e, 'next_cost'), ('convert_i',), ('iflt', 'page_shortage'),
        ('getlex', q(STATE)), ('getproperty', q('Possible')), ('returnvalue',),
        ('label', 'page_shortage'), ('getlex', q(STATE)), e.string('深渊币'),
        ('callproperty', q('InsufficientEitherStackOrItem'), 1), ('returnvalue',),
        ('label', 'page_unavailable'), ('getlex', q(STATE)), ('getproperty', q('NotSelectedItem')),
        ('returnvalue',), ('label', 'page_original')]


def items_prefix(e, first):
    q = e.q
    ctx, record, scratch, coin, count = range(first, first + 5)
    return ctx_record(e, first, 'page_original') + [
        ('getlocal_0',), ('getproperty', q('globalLogic')), number(e, 2370099),
        ('callproperty', q('getItem'), 1), ('setlocal', coin), ('getlocal_0',),
        ('getproperty', q('player')), number(e, 2370099), ('callproperty', q('getItemNumber'), 1),
        ('setlocal', count), e.string('itemId'), number(e, 2370099), e.string('kind'),
        ('getlex', q('pinball.ui.component.item::ItemThumbnailKind')),
        ('getlocal', coin), ('callproperty', q('get_thumbnailId'), 0),
        ('getlocal', coin), ('callproperty', q('get_rarity'), 0),
        ('callproperty', q('Item'), 2), e.string('number'), ('getlex', q(OPTION)),
        ('getlocal', count), ('callproperty', q('Some'), 1), e.string('isEnable'),
        ('getlocal', count), ('getlocal', record), *get(e, 'next_cost'), ('convert_i',),
        ('greaterequals',), ('newobject', 4), ('newarray', 1), ('returnvalue',),
        ('label', 'page_original')]


def information_prefix(e, first):
    q = e.q
    ctx, record, scratch, affixes, rows, weapon = range(first, first + 6)
    code = ctx_record(e, first, 'page_original') + [
        ('getlocal', record), *get(e, 'affixes'), ('setlocal', affixes)]
    code += dtos(e, affixes, rows, first + 6,
                 [('getlocal_0',), ('getproperty', q('logicAsset'))], 'page_rows')
    code += [('getlocal_0',), ('getproperty', q('globalLogic')), ('getlocal', record),
             *get(e, 'weapon_id'), ('convert_i',), ('callproperty', q('getGeneralEquipment'), 1),
             ('setlocal', weapon), e.string('mode'), e.string(MODE), e.string('characterName'),
             ('getlocal', weapon), ('callproperty', q('get_name'), 0), e.string('裂罅'), ('add',),
             e.string('exStatus'), ('getlex', q(OPTION)), ('getproperty', q('None')),
             e.string('exAbilities'), ('getlocal', rows), e.string('record'), ('getlocal', record),
             e.string('balance'), ('getlocal_0',), ('getproperty', q('player')), number(e, 2370099),
             ('callproperty', q('getItemNumber'), 1), e.string('weaponImage'),
             ('getlocal', weapon), ('callproperty', q('get_pixelArtPath'), 0),
             ('newobject', 7), ('returnvalue',), ('label', 'page_original')]
    return code


def detail_prefix(e, first):
    q = e.q
    ctx, affixes, result = range(first, first + 3)
    code = context(e, ctx, 'page_original') + [('getlocal_1',), *get(e, 'affixes'),
            ('coerce_a',), ('setlocal', affixes), ('getlocal', affixes), ('iffalse', 'page_empty')]
    code += dtos(e, affixes, result, first + 3,
                 [('getlocal_0',), ('getproperty', q('logicAsset'))], 'page_detail')
    return code + [('getlocal', result), ('returnvalue',), ('label', 'page_empty'),
                   ('newarray', 0), ('returnvalue',), ('label', 'page_original')]


def button_prefix(e, first):
    q = e.q
    return context(e, first, 'page_original') + [
        ('getlocal_0',), ('getproperty', q('scene')), ('getlocal_0',),
        ('getproperty', q('kind')), ('callproperty', q('isInputAvailableForStateKind'), 1),
        ('iffalse', 'page_done'), ('getlocal_0',), ('getproperty', q('windowStatus')),
        ('getproperty', q('index')), number(e, 0), ('ifne', 'page_done'),
        ('getlocal_1',), number(e, 33554432), ('ifne', 'page_done'),
        ('getlocal_0',), ('callpropvoid', q('characterExBoost'), 0),
        ('label', 'page_done'), ('returnvoid',), ('label', 'page_original')]


def back_prefix(e, first):
    q = e.q
    return context(e, first, 'page_original') + [
        ('getlocal_0',), ('callpropvoid', q('backChangeScene'), 0),
        ('label', 'page_done'), ('returnvoid',), ('label', 'page_original')]


def queue_logic(e):
    builders = {'run': run_prefix, 'willLeave': leave_prefix,
                'willLeaveScene': leave_prefix, 'viewInitialized': view_initialized,
                'startInTransition': guard_return, 'getExBoostState': state_prefix,
                'getExBoostItems': items_prefix, 'getExBoostInformation': information_prefix,
                'getExBoostDetail': detail_prefix, 'tabChanged': guard_return,
                'needShowSideArrow': lambda e,n: guard_return(e,n,'pushfalse'),
                'canChangeStateBySwipe': lambda e,n: guard_return(e,n,'pushfalse'),
                'buttonClicked': button_prefix}
    result = {}
    for name, fn in builders.items():
        label = f'ExBoostWindow/{name}'
        body = e.body(label)
        ops = asm.decode(body[5])
        at = 2 if [x.name for x in ops[:2]] == ['getlocal_0', 'pushscope'] else 0
        result[label] = queue(e, label, fn(e, body[2]), at)
        if name == 'canChangeStateBySwipe':
            queue(e, label, [('pushfalse',), ('returnvalue',)], len(ops))
    for name in ('tabChanged', 'changeStateByTab', 'showHowToPlayForMode'):
        result[f'ExpodScene/{name}'] = prefix(e, f'ExpodScene/{name}', guard_return)
    result['ExpodScene/back'] = prefix(e, 'ExpodScene/back', back_prefix)
    return result
