"""C14 fixes first-open stale HTML and bounds the Riven text presentation."""
from c14_text_guards import guard_setters, clear_before_fit, guard_fields, guard_native_creation
from c14_text_fee import apply as fee

TARGETS = (
    'ExBoostWindowView/setupExBoostInformationWindow',
    'ExBoostWindowView/setupButtons',
    'ExBoostWindowView/onApplyExBoostInformation',
    'ExBoostWindowView/draw',
    'ExBoostInformationAbilityView/applyExAbility',
    'ExBoostDetailView/createText',
    'ExBoostSelectDialogView/run',
    'DialogItemTitleView/run',
    'BoxButtonContentView/addTextField',
)


def apply(editor):
    changes = {}
    for label in TARGETS:
        changes[label] = {'setters': guard_setters(editor, label),
                          'fit_stale_text': clear_before_fit(editor, label),
                          'native_creation': guard_native_creation(editor, label)}
        if label in ('ExBoostWindowView/setupButtons', 'ExBoostSelectDialogView/run'):
            changes[label]['new_fields'] = guard_fields(editor, label)
        if label in ('ExBoostWindowView/setupButtons', 'ExBoostWindowView/onApplyExBoostInformation',
                     'ExBoostWindowView/draw'):
            changes[label]['bounded_fee_fit'] = fee(editor, label)
    return {'methods': changes, 'text_width_bounds': [48, 1536],
            'text_height_bounds': [48, 1536], 'font_size_bounds': [18, 64],
            'fee_font_floor': 18, 'fee_measurement_limit': 11,
            'ordinary_context_preserved': True, 'new_methods': 0, 'new_traits': 0}
