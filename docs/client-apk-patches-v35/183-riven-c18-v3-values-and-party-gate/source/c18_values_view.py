"""Three native actions in the existing bottom row; mode comes from the owned DTO."""
import asm
from c2_common import get, set_, queue
from c2_page_view import panel
from c2_presentation import text
from c2_presentation_dialogs import check_values_mode
from c17_cost_common import g, p, n, context
from c18_values_logic import BUTTON


def riven_start(e, ops):
    # C17's first mode guard jumps over its byte-exact p13 clone. Never insert
    # into that restored ordinary body, including its return instructions.
    for i, op in enumerate(ops):
        if op.name == 'ifeq' and ops[i-1].name == 'pushstring' and e.abc.s(ops[i-1].args[0]) == 'wfx_riven':
            return op.target
    raise AssertionError('C17 native presentation fork missing')


def setup(e, first, tag):
    ctx, node = first, first + 1; q = e.q
    code = context(e, ctx, tag + '_done')
    code += [g(ctx), *get(e, 'c13_reforge'), ('iffalse', tag + '_done'),
             ('getlex', q('starling.display::Sprite')), ('construct', 0), p(node),
             *panel(e), g(node), ('callpropvoid', q('addChild'), 1),
             g(ctx), *set_(e, 'c18_values_button', [g(node)]),
             ('getlocal_0',), ('getproperty', q('buttonGroupView')), *n(e, BUTTON), g(node),
             ('getlex', q('flash.geom::Rectangle')), *n(e, 0), *n(e, 0),
             g(ctx), *get(e, 'c13_width'), *n(e, 408), ('subtract',), *n(e, 104), ('construct', 4),
             ('getlex', q('pinball.ui.component.button.config::ButtonConfigs')), e.string('只重铸数值'),
             ('callproperty', q('negativeWithCustomString'), 1), ('callpropvoid', q('addWithConfig'), 4),
             ('label', tag + '_done')]
    return code


def geometry(e, first, tag):
    ctx = first; q = e.q
    code = context(e, ctx, tag + '_done')
    code += [g(ctx), *get(e, 'c18_values_button'), ('iffalse', tag + '_done')]
    for key, x in [('c13_dismantle', n(e, 84)), ('c13_reforge', n(e, 256)),
                   ('c18_values_button', [g(ctx), *get(e, 'c13_width'), *n(e, 344), ('add',), *n(e, 2), ('divide',)])]:
        code += [g(ctx), *get(e, key), *x, ('setproperty', q('x')),
                 g(ctx), *get(e, key), g(ctx), *get(e, 'c13_viewport'), *n(e, 894), ('add',),
                 ('setproperty', q('y'))]
    return code + [('label', tag + '_done')]


def confirm(e, tag):
    q = e.q; v = [('getlocal_0',), ('getproperty', q('values'))]
    code = check_values_mode(e, tag + '_done')
    code += [*v, *get(e, 'rivenDrawMode'), e.string('values'), ('ifne', tag + '_done')]
    code += text(e, 1, ('content',), 'description', [e.string('只重铸数值（词条不变），消耗 '),
                 *v, *get(e, 'itemCostNum'), ('add',), e.string(' 个'), ('add',),
                 *v, *get(e, 'itemName'), ('add',)])
    return code + [('label', tag + '_done')]


def apply(e):
    report = {}
    label = 'ExBoostWindowView/setupButtons'; body = e.body(label); ops = asm.decode(body[5]); widths = []
    for key, width in [('c13_dismantle', 104), ('c13_reforge', 144)]:
        start = next(i for i, op in enumerate(ops) if op.name == 'pushstring' and e.abc.s(op.args[0]) == key)
        at = next(i for i in range(start, len(ops)) if ops[i].name == 'construct' and ops[i].args == [4])
        assert any(o.name == 'getlex' and e.abc.mn_name(o.args[0]) == 'flash.geom::Rectangle' for o in ops[start:at])
        widths.append(queue(e, label, [('pop',), ('pop',), *n(e, width), *n(e, 104)], at, asm.SKIP))
    report['native_action_widths'] = widths
    for label in ('ExBoostWindowView/setupButtons', 'ExBoostWindowView/setupExBoostInformationWindow',
                  'ExBoostWindowView/onApplyExBoostInformation', 'ExBoostWindowView/draw'):
        body = e.body(label); ops = asm.decode(body[5]); rows = []
        start = riven_start(e, ops)
        for at, op in enumerate(ops):
            if op.name != 'returnvoid' or at < start: continue
            tag = 'c18_actions_' + str(at)
            code = setup(e, body[2], tag + '_setup') if label.endswith('setupButtons') else []
            code += geometry(e, body[2] + 2, tag)
            rows.append(queue(e, label, code, at))
        report[label] = rows
    label = 'ExBoostDrawConfirmDialogView/run'; body = e.body(label); ops = asm.decode(body[5])
    start = riven_start(e, ops)
    report[label] = [queue(e, label, confirm(e, 'c18_confirm_' + str(i)), i)
                     for i, op in enumerate(ops) if op.name == 'returnvoid' and i >= start]
    return report
