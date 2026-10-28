"""Riven draw/select flow, inserted ahead of the untouched character EX paths."""
from c2_common import context, fresh_record, get, prefix, OPTION
from c1_lookup import number

WINDOW = 'ExBoostWindow/'
TOOLS = 'pinball.common.tools._FunctionTools::'
COMMAND = 'pinball.scene.expod.viewOrder::ExpodSceneViewOrderCommand'
STATUS = 'pinball.scene.expod.exBoostWindow._ExBoostWindow::ExBoostWindowStatus'
SELECT = 'pinball.dialog.expod.exBoost::ExBoostSelectDialog'
CONFIRM = 'pinball.dialog.expod.exBoost::ExBoostDrawConfirmDialog'


def ops(e):
    return (lambda n: ('getlocal', n), lambda n: ('setlocal', n),
            lambda n: ('getproperty', e.q(n)),
            lambda n, c=0: ('callproperty', e.q(n), c),
            lambda n, c=0: ('callpropvoid', e.q(n), c))


def begin(e, first):
    ctx, record, scratch = range(first, first + 3)
    return (context(e, ctx, 'original') +
            fresh_record(e, ctx, record, scratch, 'done'), ctx, record)


def selection(e, record, pending):
    g, p, gp, call, void = ops(e)
    return [('getlocal_0',), gp('scene'), ('getlex', e.q(SELECT)),
            ('getlex', e.q(TOOLS + 'BindImpl1_0')), ('getlocal_0',), gp('selectOverrideHandler'),
            ('pushfalse',), ('construct', 2), gp('execute'),
            ('getlex', e.q(TOOLS + 'BindImpl1_0')), ('getlocal_0',), gp('selectDiscardHandler'),
            ('pushfalse',), ('construct', 2), gp('execute'),
            ('getlocal_0',), gp('characterId'),
            ('getlocal_0',), g(record), call('getExBoostDetail', 1),
            ('getlocal_0',), g(pending), call('getExBoostDetail', 1),
            ('construct', 5), void('openDialog', 1)]


def refresh(e):
    g, p, gp, call, void = ops(e)
    return [('getlocal_0',), void('updateExBoostItems'),
            ('getlocal_0',), gp('viewOrder'), ('getlex', e.q(COMMAND)),
            ('getlocal_0',), call('getExBoostInformation'),
            call('ApplyExBoostInformation', 1), void('notifyCommand', 1)]


def affordability(e, record):
    """A second check at confirmation time protects against a stale balance."""
    g, p, gp, call, void = ops(e)
    return [('getlocal_0',), gp('player'), number(e, 2370099), call('getItemNumber', 1),
            g(record), *get(e, 'next_cost'), ('ifge', 'affordable'),
            ('getlocal_0',), gp('scene'), e.string('深渊币不足'),
            ('getlex', e.q('pinball.context.scene.instantMessage::InstantMessagePosition')),
            gp('Center'), void('showInstantMessage', 2), ('jump', 'done'),
            ('label', 'affordable')]


def launch(e, ctx, first, select=None):
    """Keep the existing processing dialog and ServiceLauncher ownership chain."""
    g, p, gp, call, void = ops(e)
    manager, callback, entry, launcher, gear, handler, dispatcher = range(first, first + 7)
    code = [('getlocal_0',), gp('processingDialogManager'), p(manager),
            ('getlex', e.q(TOOLS + 'BindImpl2_1')), ('getlocal_0',), gp('closeProcessingDialogThenInput')]
    if select is None:
        code += [('getlocal_0',), gp('characterExBoostDrawRemoteInput')]
    else:
        code += [('getlex', e.q(TOOLS + 'BindImpl2_1')), ('getlocal_0',),
                 gp('characterExBoostSelectRemoteInput'), ('pushfalse',), ('construct', 2), gp('execute')]
    code += [('construct', 2), gp('execute'), p(callback), g(manager),
             ('getlex', e.q('pinball.dialog.processing::ProcessingDialogKind')), gp('Connecting'),
             ('getlex', e.q(OPTION)), gp('None'), call('open', 2), p(entry),
             g(manager), gp('serviceLauncher'), p(launcher), g(manager), gp('gear'), p(gear),
             ('getlex', e.q(TOOLS + 'BindImpl3_1')), g(manager), gp('dialogInputHandler'),
             g(entry), g(callback), ('construct', 3), gp('execute'), p(handler),
             g(launcher), gp('hookDispatcherProvider'), call('isAlive'), ('iffalse', 'done'),
             g(launcher), gp('hookDispatcherProvider'), g(handler),
             ('getlex', e.q('pinball.context::SectionCommand')),
             gp('ExBoostDraw' if select is None else 'ExBoostSelect'),
             call('createHookDispatcher', 2), p(dispatcher),
             g(gear), g(dispatcher), ('pushnull',), void('addChild', 2),
             ('getlocal_0',), gp('remote'), g(dispatcher), g(ctx), *get(e, 'item_id'), ('convert_i',)]
    code += ([number(e, 2370099), void('exBoostDraw', 3)] if select is None else
             [('pushtrue',) if select else ('pushfalse',), void('exBoostSelect', 3)])
    return code


def draw_button(e, first):
    g, p, gp, call, void = ops(e)
    code, ctx, record = begin(e, first)
    code += [g(record), *get(e, 'pending'), ('iffalse', 'no_pending'),
             ('getlocal_0',), void('finishTransitionToExpodScene'), ('jump', 'done'),
             ('label', 'no_pending'), *affordability(e, record),
             ('getlocal_0',), gp('scene'), ('getlex', e.q(CONFIRM)),
             ('getlocal_0',), gp('characterId'), ('pushnull',), ('pushfalse',),
             ('getlocal_0',), gp('characterExBoostHandler'), ('construct', 4), void('openDialog', 1),
             ('label', 'done'), ('returnvoid',), ('label', 'original')]
    return code


def draw_handler(e, first):
    g, p, gp, call, void = ops(e)
    code, ctx, record = begin(e, first)
    return code + [g(record), *get(e, 'pending'), ('iffalse', 'no_pending'),
                   ('getlocal_0',), void('finishTransitionToExpodScene'), ('jump', 'done'),
                   ('label', 'no_pending'), *affordability(e, record),
                   *launch(e, ctx, first + 3), ('label', 'done'), ('returnvoid',), ('label', 'original')]


def draw_input(e, first):
    g, p, gp, call, void = ops(e)
    code, ctx, record = begin(e, first)
    pending = first + 3
    return code + [g(record), *get(e, 'pending'), p(pending), g(pending), ('iffalse', 'done'),
                   *refresh(e), ('getlocal_0',), ('getlex', e.q(STATUS)), ('pushfalse',), g(pending),
                   call('Cutin', 2), ('setproperty', e.q('windowStatus')),
                   ('getlocal_0',), gp('exBoostCutin'), g(pending), void('startExBoost', 1),
                   ('getlocal_0',), gp('viewOrder'), ('getlex', e.q(COMMAND)),
                   gp('RefreshExBoostCutin'), void('notifyCommand', 1),
                   ('getlocal_0',), void('lockForExBoost'),
                   ('label', 'done'), ('returnvoid',), ('label', 'original')]


def cutin_update(e, first):
    g, p, gp, call, void = ops(e)
    code = context(e, first, 'original')
    code += [('getlocal_0',), gp('exBoostCutin'), void('update'),
             ('getlocal_0',), gp('exBoostCutin'), call('isPlayingAnimation'), ('iftrue', 'done'),
             ('getlocal_0',), void('unlockForExBoost'),
             ('getlocal_0',), gp('windowStatus'), gp('index'), number(e, 0), ('ifeq', 'done'),
             ('getlocal_0',), gp('scene'), void('unlockGeneralMenu'),
             ('getlocal_0',), ('getlex', e.q(STATUS)), gp('Neutral'), ('setproperty', e.q('windowStatus')),
             *fresh_record(e, first, first + 1, first + 2, 'done'),
             g(first + 1), *get(e, 'pending'), p(first + 3), g(first + 3), ('iffalse', 'done'),
             *selection(e, first + 1, first + 3),
             ('label', 'done'), ('returnvoid',), ('label', 'original')]
    return code


def select_handler(e, first, confirm):
    g, p, gp, call, void = ops(e)
    code, ctx, record = begin(e, first)
    return code + [g(record), *get(e, 'pending'), ('iffalse', 'done'),
                   *launch(e, ctx, first + 3, confirm),
                   ('label', 'done'), ('returnvoid',), ('label', 'original')]


def select_input(e, first):
    code, ctx, record = begin(e, first)
    return code + refresh(e) + [('label', 'done'), ('returnvoid',), ('label', 'original')]


def transition(e, first):
    g, p, gp, call, void = ops(e)
    code, ctx, record = begin(e, first)
    return code + [g(record), *get(e, 'pending'), p(first + 3), g(first + 3), ('iffalse', 'done'),
                   *selection(e, record, first + 3),
                   ('label', 'done'), ('returnvoid',), ('label', 'original')]


def queue_transaction_splices(e):
    builders = {'characterExBoost': draw_button, 'characterExBoostHandler': draw_handler,
                'characterExBoostDrawRemoteInput': draw_input, 'updateExBoostCutin': cutin_update,
                'selectOverrideHandler': lambda e, f: select_handler(e, f, True),
                'selectDiscardHandler': lambda e, f: select_handler(e, f, False),
                'characterExBoostSelectRemoteInput': select_input,
                'finishTransitionToExpodScene': transition}
    return {'methods': {WINDOW + name: prefix(e, WINDOW + name, builder)
                        for name, builder in builders.items()},
            'currency': 2370099, 'balance_source': 'PlayerLogic.getItemNumber',
            'cost_source': 'saveData.weapon_rivens[item_id].next_cost',
            'pending_recovery': 'same old/new dialog; no draw request',
            'in_flight_ownership': 'existing ProcessingDialogManager modal lifecycle; no extra persistent busy flag',
            'ordinary_ex': 'all original instructions retained behind explicit context guard'}
