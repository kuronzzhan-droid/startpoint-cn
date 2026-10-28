"""Reserve the native menu footer band in four existing Riven view methods."""
import asm
from c2_common import queue
from c17_cost_common import n
from c18_values_view import riven_start


METHODS = ('setupButtons', 'setupExBoostInformationWindow',
           'onApplyExBoostInformation', 'draw')
# Official content ends 31 units above the footer background (192 - 161).
# Its animated icons extend 260 units above safe.bottom across all visible
# frames, as audited from native transforms/atlas trim in audit/footer.
# Preserve that official 31-unit gap above the complete stable envelope: 291.
# C19 ended at safe.bottom-32, so reserve another 259 logical units.
# Parent safe.top + panel.y(180) makes panel.height = safe.height-471.
# C18/C19 button center is 86 above panel bottom: safe.height-557.
# Reduce the independently scrollable affix budget by the same 259; this also
# moves fee/item-grid content up while preserving its complete 212-unit row.
REPLACEMENTS = {212: 471, 298: 557, 1192: 1451}


def literal(abc, op):
    if op.name == 'pushbyte':
        return op.args[0] if op.args[0] < 128 else op.args[0] - 256
    if op.name == 'pushshort':
        return op.args[0]
    if op.name in ('pushint', 'pushuint', 'pushdouble'):
        return getattr(abc, {'pushint': 'ints', 'pushuint': 'uints', 'pushdouble': 'doubles'}[op.name])[op.args[0]]
    return None


def apply(editor):
    report = {}
    for name in METHODS:
        label = 'ExBoostWindowView/' + name
        ops = asm.decode(editor.body(label)[5])
        start = riven_start(editor, ops)
        rows, counts = [], {value: 0 for value in REPLACEMENTS}
        for at, op in enumerate(ops):
            value = literal(editor.abc, op)
            if at < start or value not in REPLACEMENTS:
                continue
            assert ops[at + 1].name == 'subtract', (label, at, value)
            if value in (212, 298):
                assert ops[at - 1].name == 'getproperty'
                assert editor.abc.mn_name(ops[at - 1].args[0]) == 'height'
            else:
                # C17's reversible replacement of the former 896 budget.
                assert ops[at - 1].name == 'pop'
                assert literal(editor.abc, ops[at - 2]) == 896
            rows.append({'from': value, 'to': REPLACEMENTS[value],
                **queue(editor, label, [('pop',), *n(editor, REPLACEMENTS[value])], at + 1, asm.SKIP)})
            counts[value] += 1
        assert counts[212] == (2 if name in ('setupButtons', 'onApplyExBoostInformation') else 1), (label, counts)
        assert counts[1192] == (0 if name == 'setupExBoostInformationWindow' else 1), (label, counts)
        assert counts[298] == 3 * counts[212], (label, counts)
        report[label] = {'splices': rows, 'counts': counts}
    return {'methods': report, 'official_footer_content_inset': 192,
            'footer_background_height_above_anchor': 161,
            'footer_all_visible_frames_height_above_anchor': 260,
            'official_content_gap': 31, 'content_inset': 291,
            'previous_content_inset': 32, 'additional_footer_reservation': 259,
            'panel_bottom': 'safeArea.bottom - 291',
            'button_center_above_panel_bottom': 86,
            'button_face_bottom_padding': 34, 'button_hit_bottom_padding': 18,
            'affix_scroll_budget': 'max(80, safeArea.height - 1451)',
            'new_methods': 0, 'new_traits': 0}
