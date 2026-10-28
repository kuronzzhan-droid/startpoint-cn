"""Mode dispatch and snapshot fields; ordinary EX and all transaction stages remain native."""
import asm
from c2_common import DYNAMIC, get, set_, queue, prefix
from c4_dismantle import owned_window
from c17_cost_common import g, p, n, context

BUTTON = 201326592


def choose(e, ctx, field, target, tag):
    return [e.string('full'), p(target), g(ctx), *get(e, field), e.string('values'),
            ('ifne', tag), e.string('values'), p(target), ('label', tag)]


def clicked(e, first):
    ctx, mode = first, first + 1; q = e.q
    code = [('getlocal_1',), *n(e, BUTTON), ('ifeq', 'c18_click_match'),
            ('getlocal_1',), *n(e, 33554432), ('ifne', 'c18_click_original'),
            ('label', 'c18_click_match')]
    code += context(e, ctx, 'c18_click_original') + owned_window(e, ctx, 'c18_click_done')
    code += [('getlocal_0',), ('getproperty', q('scene')), ('getlocal_0',), ('getproperty', q('kind')),
             ('callproperty', q('isInputAvailableForStateKind'), 1), ('iffalse', 'c18_click_done'),
             ('getlocal_0',), ('getproperty', q('scene')), ('callproperty', q('isMainLoop'), 0),
             ('iffalse', 'c18_click_done'), ('getlocal_0',), ('getproperty', q('windowStatus')),
             ('getproperty', q('index')), *n(e, 0), ('ifne', 'c18_click_done'),
             e.string('full'), p(mode), ('getlocal_1',), *n(e, BUTTON), ('ifne', 'c18_click_mode'),
             e.string('values'), p(mode), ('label', 'c18_click_mode'),
             g(ctx), *set_(e, 'c18_next_mode', [g(mode)]),
             ('getlocal_0',), ('callpropvoid', q('characterExBoost'), 0),
             ('label', 'c18_click_done'), ('returnvoid',), ('label', 'c18_click_original')]
    return code


def begin(e, first):
    # A transient one-shot flag is consumed at the existing entry. A direct
    # ordinary reforge entry, cancellation or a newly selected card starts full.
    code = context(e, first, 'c18_begin_original')
    code += choose(e, first, 'c18_next_mode', first + 1, 'c18_begin_mode')
    for field, value in [('c18_draw_mode', [g(first + 1)]), ('c18_next_mode', [('pushnull',)]),
                         ('c18_confirm_mode', [('pushnull',)])]:
        code += [g(first), *set_(e, field, value)]
    return code + [('label', 'c18_begin_original')]


def register(e, first):
    q = e.q
    code = context(e, first, 'c18_register_done')
    code += [('getlocal_0',), ('getproperty', q('buttonGroup')), *n(e, BUTTON),
             ('callproperty', q('exists'), 1), ('iftrue', 'c18_registered'),
             ('getlocal_0',), ('getproperty', q('buttonGroup')), *n(e, BUTTON),
             ('callpropvoid', q('append'), 1), ('label', 'c18_registered')]
    for field in ('c18_next_mode', 'c18_draw_mode', 'c18_confirm_mode'):
        code += [g(first), *set_(e, field, [('pushnull',)])]
    return code + [('label', 'c18_register_done')]


def enabled(e, first):
    q = e.q
    return context(e, first, 'c18_enable_done') + [
        ('getlocal_0',), ('getproperty', q('buttonGroup')), *n(e, BUTTON),
        ('callproperty', q('exists'), 1), ('iffalse', 'c18_enable_done'),
        ('getlocal_0',), ('getproperty', q('buttonGroup')), *n(e, BUTTON),
        ('callproperty', q('get'), 1), ('getlocal_1',), ('callproperty', q('get_enabled'), 0),
        ('callpropvoid', q('set_enabled'), 1), ('label', 'c18_enable_done')]


def apply(e):
    report = {}
    for label, fn in [('ExBoostWindow/buttonClicked', clicked), ('ExBoostWindow/characterExBoost', begin)]:
        report[label] = prefix(e, label, fn)
    label = 'ExBoostWindow/run'; body = e.body(label); ops = asm.decode(body[5])
    assert ops[-1].name == 'returnvoid'
    report[label] = queue(e, label, register(e, body[2]), len(ops) - 1)
    label = 'ExBoostWindow/updateExBoostButtonState'; body = e.body(label); ops = asm.decode(body[5])
    assert ops[-1].name == 'returnvoid'
    report[label] = queue(e, label, enabled(e, body[2]), len(ops) - 1)
    # Insert at the selected-cost DTO construction, not the ordinary EX return.
    label = 'ExBoostDrawConfirmDialog/getValuesForView'; body = e.body(label); ops = asm.decode(body[5])
    key = next(i for i, op in enumerate(ops) if op.name == 'pushstring' and e.abc.s(op.args[0]) == 'c17_confirm_owner')
    ctx = ops[key - 1].args[0]
    at = next(i for i in range(key, len(ops)) if ops[i].name == 'newobject') + 1
    mode = body[2]
    code = choose(e, ctx, 'c18_draw_mode', mode, 'c18_dto_mode')
    code += [g(ctx), *set_(e, 'c18_confirm_mode', [g(mode)]),
             ('dup',), *set_(e, 'rivenDrawMode', [g(mode)])]
    report[label] = queue(e, label, code, at, asm.SKIP)
    label = 'ExBoostDrawRealRemote/<ctor>'; body = e.body(label); ops = asm.decode(body[5])
    path = next(i for i, op in enumerate(ops) if op.name == 'pushstring' and e.abc.s(op.args[0]) == 'weapon_riven/draw')
    key = next(i for i in range(path - 1, -1, -1) if ops[i].name == 'pushstring' and e.abc.s(ops[i].args[0]) == 'record')
    ctx = ops[key - 1].args[0]
    at = next(i for i in range(path, len(ops)) if ops[i].name == 'newobject') + 1
    code = choose(e, ctx, 'c18_confirm_mode', body[2], 'c18_request_mode')
    code += [g(body[2]), e.string('values'), ('ifne', 'c18_request_default'),
             ('dup',), *set_(e, 'mode', [g(body[2])]), ('label', 'c18_request_default'),
             g(ctx), *set_(e, 'c18_confirm_mode', [('pushnull',)])]
    report[label] = queue(e, label, code, at, asm.SKIP)
    return report
