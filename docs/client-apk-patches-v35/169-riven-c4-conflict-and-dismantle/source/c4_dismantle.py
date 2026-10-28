"""A confirmed single-card dismantle action using existing EX controls/handlers."""
import asm
from c1_lookup import number
from c2_common import context, fresh_record, get, set_, prefix, queue
from c2_page_view import ui
from c2_transaction import launch

BUTTON = 150994944


def owned_window(e, ctx, fail):
    return [('getlocal_0',), ('getproperty', e.q('drawResult')),
            ('getproperty', e.q('index')), number(e, 0), ('ifne', fail),
            ('getlocal_0',), ('getproperty', e.q('drawResult')),
            ('getproperty', e.q('params')), number(e, 0), ('getproperty', 14),
            ('getlocal', ctx), ('ifne', fail)]


def visible(e, first):
    return context(e, first, 'c4_visible_done') + ui(
        e, [('getlocal_0',), ('getproperty', e.q('uiLayout'))],
        ['bottom_center', 'mana_board_button']) + [
        ('pushtrue',), ('setproperty', e.q('visible')), ('label', 'c4_visible_done')]


def button_config(e, first):
    return context(e, first, 'c4_config_done') + [
        ('pop',), ('getlex', e.q('pinball.ui.component.button.config::ButtonConfigs')),
        e.string('分解裂罅'), ('callproperty', e.q('negativeWithCustomString'), 1),
        ('label', 'c4_config_done')]


def click(e, first):
    ctx, record, scratch = range(first, first + 3)
    q = e.q
    g = lambda n: ('getlocal', n)
    gp = lambda n: ('getproperty', q(n))
    code = [('getlocal_1',), number(e, BUTTON), ('ifne', 'c4_click_original')]
    code += context(e, ctx, 'c4_click_original')
    code += owned_window(e, ctx, 'c4_click_done')
    code += [('getlocal_0',), gp('scene'), ('getlocal_0',), gp('kind'),
             ('callproperty', q('isInputAvailableForStateKind'), 1),
             ('iffalse', 'c4_click_done'), ('getlocal_0',), gp('windowStatus'),
             gp('index'), number(e, 0), ('ifne', 'c4_click_done')]
    code += fresh_record(e, ctx, record, scratch, 'c4_click_done')
    code += [g(ctx), *set_(e, 'c4_dismantle_target', [g(record), *get(e, 'riven_id')]),
             ('getlocal_0',), gp('scene'),
             ('getlex', q('pinball.dialog.general::GeneralDialog')),
             ('getlex', q('pinball.dialog.general::DialogContent')),
             e.string('确定分解这张裂罅吗？分解后无法恢复，并会解除所有编队中的装备。'),
             ('callproperty', q('DynamicText'), 1), ('newarray', 1),
             ('getlex', q('pinball.dialog.general::DialogButtonLayoutKind')),
             ('getlex', q('pinball.dialog.general.button::DialogButton')),
             e.string('分解'), ('callproperty', q('PositiveDynamicText'), 1),
             ('getlex', q('pinball.dialog.general.button::DialogButton')), gp('Close'),
             ('getlex', q('pinball.common.tools._FunctionTools::BindImpl2_1')),
             ('getlex', q('pinball.common.tools::FunctionTools0')), gp('expanded1'),
             ('getlex', q('pinball.common.tools._FunctionTools::BindImpl1_0')),
             ('getlocal_0',), gp('selectDiscardHandler'), ('pushtrue',), ('construct', 2),
             gp('execute'), ('construct', 2), gp('execute'),
             ('getlex', q('pinball.common.tools::FunctionTools')), gp('emptyFunction1'),
             ('callproperty', q('Select'), 4),
             ('pushnull',), ('construct', 3), ('callpropvoid', q('openDialog'), 1),
             ('label', 'c4_click_done'), ('returnvoid',), ('label', 'c4_click_original')]
    return code


def confirm(e, first):
    ctx, record, scratch, target = range(first, first + 4)
    g = lambda n: ('getlocal', n)
    # True is exclusively the new confirmation callback in Riven mode. C2's
    # keep-old handler binds False; ordinary EX falls through its original body.
    code = [('getlocal_1',), ('iffalse', 'c4_confirm_original'),
            ('getlocal_0',), ('getproperty', e.q('drawResult')),
            ('getproperty', e.q('index')), number(e, 0), ('ifne', 'c4_confirm_original'),
            ('getlocal_0',), ('getproperty', e.q('drawResult')),
            ('getproperty', e.q('params')), number(e, 0), ('getproperty', 14),
            *get(e, 'mode'), e.string('wfx_riven'), ('ifne', 'c4_confirm_original')]
    code += context(e, ctx, 'c4_confirm_unowned')
    code += owned_window(e, ctx, 'c4_confirm_unowned')
    code += [g(ctx), *get(e, 'c4_dismantle_target'), ('setlocal', target),
             g(target), ('iffalse', 'done')]
    code += fresh_record(e, ctx, record, scratch, 'c4_confirm_stale')
    code += [g(target), g(record), *get(e, 'riven_id'), ('ifne', 'c4_confirm_stale'),
             ('getlocal_0',), ('getproperty', e.q('processingDialogManager')),
             ('getproperty', e.q('serviceLauncher')), ('getproperty', e.q('hookDispatcherProvider')),
             ('callproperty', e.q('isAlive'), 0), ('iffalse', 'done'),
             g(ctx), *set_(e, 'c4_dismantle_target', [('pushnull',)]),
             g(ctx), *set_(e, 'c4_dismantle', [('pushtrue',)])]
    code += launch(e, ctx, first + 4, select=False)
    code += [('jump', 'done'), ('label', 'c4_confirm_stale')]
    from c4_conflict import recover_window
    code += [g(ctx), *set_(e, 'c4_conflict', [('pushtrue',)]),
             g(ctx), *set_(e, 'c4_conflict_reason', [e.string('local_record_changed')])]
    code += recover_window(e, ctx, first + 4, show_message=True)
    return code + [('label', 'done'),
                   g(ctx), *set_(e, 'c4_dismantle', [('pushfalse',)]),
                   ('label', 'c4_confirm_unowned'), ('returnvoid',),
                   ('label', 'c4_confirm_original')]


def queue_dismantle_splices(e):
    result = {
        'ExBoostWindow/buttonClicked': prefix(e, 'ExBoostWindow/buttonClicked', click),
        'ExBoostWindow/selectDiscardHandler': prefix(e, 'ExBoostWindow/selectDiscardHandler', confirm),
    }
    label = 'ExBoostWindowView/setupButtons'
    body = e.body(label)
    ops = asm.decode(body[5])
    positions = [i for i, op in enumerate(ops) if op.name == 'getproperty'
                 and e.abc.mn_name(op.args[0]) == 'switchToManaBoard']
    assert len(positions) == 1
    result[label] = {'config': queue(e, label, button_config(e, body[2]), positions[0] + 1)}
    for label in ('ExBoostWindowView/setupButtons', 'ExBoostWindowView/draw'):
        body = e.body(label)
        ops = asm.decode(body[5])
        assert ops[-1].name == 'returnvoid'
        result.setdefault(label, {})['visibility'] = queue(e, label, visible(e, body[2]), len(ops) - 1)
    return {'methods': result, 'button_id': BUTTON,
            'entry': 'Riven reroll window, existing mana-board control relabelled 分解裂罅',
            'confirmation': 'existing GeneralDialog; close/cancel never sends a request',
            'identity': 'confirmation captures riven_id and rechecks current saveData before sending',
            'scope': 'one card only; ordinary EX and bulk actions retain their original behavior'}
