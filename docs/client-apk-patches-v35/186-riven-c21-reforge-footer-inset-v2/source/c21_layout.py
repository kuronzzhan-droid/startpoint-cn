"""Fixed remaining-space viewport and content-sized native item row."""
import asm
from c2_common import queue
from c17_cost_common import n
from c18_values_view import riven_start
from c20_layout import literal, METHODS

# C21 brief appendix selects the background top, allowing animated icons above it.
# Native background top is safeArea.bottom - 161; leave exactly 14 logical units.
FOOTER_INSET = 175


def height(e):
    return [('getlocal_0',), ('getproperty', e.q('safeArea')),
            ('getproperty', e.q('height'))]


def capacity(e):
    return [('getlex', e.q('Math')), *n(e, 80), *height(e),
            *n(e, 1160 + FOOTER_INSET), ('subtract',),
            ('callproperty', e.q('max'), 2)]


def table(e):
    return [('getlocal_0',), ('getproperty', e.q('selectItemTableView'))]


def fit_width(e, width_local):
    return [('getlex', e.q('Math')), ('getlocal', width_local), *n(e, 64),
            ('subtract',), *table(e), ('callproperty', e.q('getContentsWidth'), 0),
            ('callproperty', e.q('min'), 2)]


def apply(e):
    report = {}
    replacements = {471: 180 + FOOTER_INSET, 557: 266 + FOOTER_INSET,
                    1451: 1160 + FOOTER_INSET}
    for method in METHODS:
        label = 'ExBoostWindowView/' + method
        ops = asm.decode(e.body(label)[5]); start = riven_start(e, ops)
        rows, fixed, widths, centers = [], 0, 0, 0
        for at, op in enumerate(ops):
            if at < start:
                continue
            value = literal(e.abc, op)
            if value in replacements and replacements[value] != value:
                assert ops[at + 1].name == 'subtract', (label, at)
                rows.append({'kind': 'footer_constant', 'from': value, 'to': replacements[value],
                    **queue(e, label, [('pop',), *n(e, replacements[value])], at + 1, asm.SKIP)})
            if (op.name == 'pushstring' and e.abc.s(op.args[0]) == 'c13_viewport'
                    and ops[at + 1].name == 'getlocal'
                    and ops[at + 2].name == 'setproperty'):
                # The original measured content height remains available to the
                # native scroll-range calculation. Only its viewport is fixed.
                anchor = at - 2
                assert ops[anchor].name == 'setlocal'
                assert ops[anchor - 1].name == 'callproperty'
                assert e.abc.mn_name(ops[anchor - 1].args[0]) == 'max'
                rows.append({'kind': 'fixed_viewport',
                    **queue(e, label, [('pop',), *capacity(e)], anchor, asm.ENTER)})
                fixed += 1
            if (op.name == 'callproperty' and e.abc.mn_name(op.args[0]) == 'get_width'
                    and ops[at - 1].name == 'getproperty'
                    and e.abc.mn_name(ops[at - 1].args[0]) == 'selectItemTableView'):
                assert ops[at + 1].name == 'getlocal'
                width_local = ops[at + 1].args[0]
                assert literal(e.abc, ops[at + 2]) == 64
                assert ops[at + 3].name == 'subtract' and ops[at + 4].name == 'ifeq'
                join = ops[at + 4].target
                setter = join - 1
                assert ops[setter].name == 'callpropvoid'
                assert e.abc.mn_name(ops[setter].args[0]) == 'set_width'
                for anchor in (at + 4, setter):
                    rows.append({'kind': 'content_width',
                        **queue(e, label, [('pop',), *fit_width(e, width_local)], anchor, asm.SKIP)})
                    widths += 1
                # The grid node is the local used by the immediately preceding
                # authored y assignment, so no extra display objects are needed.
                assert ops[at - 3].name == 'setproperty'
                assert e.abc.mn_name(ops[at - 3].args[0]) == 'y'
                assert ops[at - 7].name == 'getlocal'
                node_local = ops[at - 7].args[0]
                code = [('getlocal', node_local), ('getlocal', width_local),
                        *table(e), ('callproperty', e.q('get_width'), 0),
                        ('subtract',), *n(e, 2), ('divide',), ('setproperty', e.q('x'))]
                rows.append({'kind': 'center_grid', **queue(e, label, code, join, asm.ENTER)})
                centers += 1
        assert fixed == (0 if method == 'setupExBoostInformationWindow' else 1), (label, fixed)
        assert widths == 2 * centers and centers == (2 if method in ('setupButtons', 'onApplyExBoostInformation') else 1), (label, widths, centers)
        report[label] = rows
    return {'methods': report, 'footer_inset': FOOTER_INSET,
            'viewport': f'max(80, safeArea.height - {1160 + FOOTER_INSET})',
            'panel_height': f'safeArea.height - {180 + FOOTER_INSET}',
            'button_center': f'safeArea.height - {266 + FOOTER_INSET}',
            'fee_y': 'viewport + 472', 'heading_y': 'viewport + 544',
            'grid_y': 'viewport + 606', 'grid_width': 'min(panel.width - 64, native contents width)',
            'grid_x': '(panel.width - grid.width) / 2', 'text_alignment': 'left',
            'new_methods': 0, 'new_traits': 0}
