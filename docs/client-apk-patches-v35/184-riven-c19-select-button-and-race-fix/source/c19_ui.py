"""C19 values count and author 14:31 bottom actions; inline method splices only."""
import asm
from c2_common import get, set_, queue, DYNAMIC
from c2_page_view import panel
from c2_presentation import text
from c2_presentation_dialogs import check_values_mode
from c17_cost_common import g, n, context
from c18_values_view import riven_start


def action_width(e):
    # Panel is safe.width - 64. Keep 32px visual outer margins and 40px
    # visual gaps: native Box hitQuads expand 16px on each side. The two
    # secondary actions are 104/200px, leaving >=208px for the primary.
    return [('getlocal_0',), ('getproperty', e.q('safeArea')),
            ('getproperty', e.q('width')), *n(e, 512), ('subtract',)]


def geometry(e, first, tag):
    code = context(e, first, tag + '_done')
    code += [g(first), *get(e, 'c18_values_button'), ('iffalse', tag + '_done')]
    height = [('getlocal_0',), ('getproperty', e.q('safeArea')), ('getproperty', e.q('height'))]
    # C13 places bottom_left at safeArea.top and the panel at y=180.
    # Therefore these are panel-local coordinates, not screen coordinates.
    # Match C17's maximum panel extent: safe.bottom - 32. Only the affix
    # viewport/content remains variable; the frame and action row stay fixed.
    code += [*panel(e), *n(e, 0), ('callproperty', e.q('getChildAt'), 1),
             *height, *n(e, 212), ('subtract',), ('setproperty', e.q('height'))]
    for key, x in [('c13_dismantle', n(e, 84)), ('c18_values_button', n(e, 276)),
                   ('c13_reforge', [g(first), *get(e, 'c13_width'), *n(e, 2), ('divide',),
                                   *n(e, 192), ('add',)])]:
        code += [g(first), *get(e, key), *x, ('setproperty', e.q('x')),
                 g(first), *get(e, key), *height, *n(e, 298), ('subtract',), ('setproperty', e.q('y'))]
    return code + [('label', tag + '_done')]


def blue_skin(e):
    # Keep the native negativeWithCustomString content/label config and swap
    # its per-instance background parent to the shipped boxBlueColor preset.
    # No shared preset, image, method, or trait is changed.
    return [('dup',), ('getproperty', e.q('params')), *n(e, 0), ('getproperty', DYNAMIC),
            ('getproperty', e.q('background')),
            ('getlex', e.q('pinball.ui.component.button.config.preset::ButtonBackgroundDefaultConfigs')),
            ('getproperty', e.q('boxBlueColor')), ('setproperty', e.q('parent')),
            # Native base content is 40px. Five CJK glyphs need explicit 30px
            # sizing to retain padding inside the 200px secondary action.
            ('dup',), ('getproperty', e.q('params')), *n(e, 0), ('getproperty', DYNAMIC),
            ('getproperty', e.q('content')), *n(e, 30), ('setproperty', e.q('textSize'))]


def confirmation(e, tag):
    values = [('getlocal_0',), ('getproperty', e.q('values'))]
    code = check_values_mode(e, tag + '_done')
    code += [*values, *get(e, 'rivenDrawMode'), e.string('values'), ('ifne', tag + '_done')]
    code += text(e, 1, ('content',), 'value_ex_ability',
                 [*values, *get(e, 'rivenAffixCount'), ('convert_s',),
                  e.string(' 条（不变）'), ('add',)])
    return code + [('label', tag + '_done')]


def apply(e):
    report = {}
    label = 'ExBoostDrawConfirmDialog/getValuesForView'
    ops = asm.decode(e.body(label)[5])
    owner = next(i for i, op in enumerate(ops)
                 if op.name == 'pushstring' and e.abc.s(op.args[0]) == 'c17_confirm_owner')
    ctx = ops[owner - 1].args[0]
    mode = next(i for i, op in enumerate(ops)
                if op.name == 'pushstring' and e.abc.s(op.args[0]) == 'rivenDrawMode')
    at = next(i for i in range(mode + 1, len(ops)) if ops[i].name == 'setproperty') + 1
    # The DTO is still on stack here, after C18 froze the selected draw mode.
    # Freeze the count from that same freshly validated record, so closing or
    # switching the background page cannot change the confirmation contents.
    report[label] = queue(e, label, [('dup',), *set_(e, 'rivenAffixCount', [
        g(ctx), *get(e, 'record'), *get(e, 'affixes'), ('getproperty', e.q('length'))])], at, asm.SKIP)

    label = 'ExBoostWindowView/setupButtons'; ops = asm.decode(e.body(label)[5]); widths = []
    for key in ('c13_reforge', 'c18_values_button'):
        start = next(i for i, op in enumerate(ops)
                     if op.name == 'pushstring' and e.abc.s(op.args[0]) == key)
        at = next(i for i in range(start, len(ops)) if ops[i].name == 'construct' and ops[i].args == [4])
        assert any(op.name == 'getlex' and e.abc.mn_name(op.args[0]) == 'flash.geom::Rectangle'
                   for op in ops[start:at])
        width = action_width(e) if key == 'c13_reforge' else n(e, 200)
        widths.append(queue(e, label, [('pop',), ('pop',), *width, *n(e, 104)], at, asm.SKIP))
        if key == 'c18_values_button':
            skin_at = next(i for i in range(at, len(ops)) if ops[i].name == 'callproperty'
                           and e.abc.mn_name(ops[i].args[0]) == 'negativeWithCustomString') + 1
            report['values_native_blue_skin'] = queue(e, label, blue_skin(e), skin_at, asm.SKIP)
    report['action_widths'] = widths

    for label in ('ExBoostWindowView/setupButtons', 'ExBoostWindowView/setupExBoostInformationWindow',
                  'ExBoostWindowView/onApplyExBoostInformation', 'ExBoostWindowView/draw',
                  'ExBoostDrawConfirmDialogView/run'):
        body = e.body(label); ops = asm.decode(body[5]); start = riven_start(e, ops); edits = []
        for at, op in enumerate(ops):
            if op.name != 'returnvoid' or at < start:
                continue
            tag = 'c19_ui_' + str(at)
            code = confirmation(e, tag) if label.endswith('DialogView/run') else geometry(e, body[2], tag)
            edits.append(queue(e, label, code, at))
        report[label] = edits
    return report
