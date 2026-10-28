"""Preserve native ability markup at the two C13 annotation escape sites."""
import asm
from c2_common import queue

TARGETS = {
    'ExBoostInformationAbilityView/applyExAbility': 10,
    'ExBoostDetailView/createText': 1,
}
RESTORE = (
    (r'&lt;icon id=(?:\x27|")([0-9a-zA-Z_]+)(?:\x27|")&gt;', "<icon id='$1'>"),
    (r'&amp;(nbsp|amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);', '&$1;'),
)


def apply(editor):
    changes = {}
    for label, value_local in TARGETS.items():
        ops = asm.decode(editor.body(label)[5])
        sites = [i for i, op in enumerate(ops) if op.name == 'callproperty'
                 and editor.abc.mn_name(op.args[0]) == 'htmlEscape']
        assert len(sites) == 1, (label, sites)
        at = sites[0]
        assert ops[at].args[1] == 2
        assert ops[at - 3].name == 'getlex'
        assert editor.abc.mn_name(ops[at - 3].args[0]) == 'StringTools'
        assert ops[at - 2].name == 'getlocal'
        assert ops[at - 2].args == [value_local]
        assert ops[at - 1].name == 'pushfalse'
        assert ops[at + 1].name == 'setlocal'
        assert ops[at + 1].args == [value_local]
        # The escape result is on stack. Restore only the exact native icon
        # grammar and existing entities; literal comparison signs/unknown tags
        # retain C13's escaping. Rendering still uses native enableIconTags.
        code = []
        for pattern, replacement in RESTORE:
            code += [('getlex', editor.q('RegExp')), editor.string(pattern),
                     editor.string('g'), ('construct', 2), editor.string(replacement),
                     ('callproperty', editor.q('replace'), 2)]
        changes[label] = queue(editor, label, code, at + 1, asm.SKIP)
        changes[label].update(value_local=value_local,
                              html_escape_instruction=at,
                              restores_native_markup=True)
    return {'modified_method_count': len(changes), 'inserted_instruction_count': 24,
            'restored_markup': [list(pair) for pair in RESTORE],
            'methods': changes, 'new_methods': 0, 'new_traits': 0}
