"""Let the leader-ability table parse content kinds that our client patches only taught the ability table.

The leader table is the ability table minus columns 1-2 (unisonable, statue), so
leader column i == ability column i + 2. For a patched kind, clone the row, splice
two empty cells in at index 1 and hand it to the already-patched AbilityValues
parser, which returns the same master value type. Everything downstream
(AbilityTriggerTools.resolve, AbilitySlotImpl execution, descriptions) is shared
between leader and ability rows, so no other method changes.
"""
KINDS = {
    # leader parser, ability parser, kinds the ability parser was patched for
    ('LeaderAbilityValues$/parseAt45', 45, 'parseAt47'): ['724'],   # instant content: AddFeverPointRatio
    ('LeaderAbilityValues$/parseAt107', 107, 'parseAt109'): ['422'],  # during content: DashParameter
}
TARGETS = [label for (label, _, _) in KINDS]
BUILTIN = 'http://adobe.com/AS3/2006/builtin::'


def install(e):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)  # MultinameL for row[col]
    for (label, col, ability_parser), kinds in KINDS.items():
        local = e.body(label)[2]
        code = []
        for k, kind in enumerate(kinds):
            code += [('getlocal_1',), n(col), ('getproperty', x), e.string(kind), ('ifne', f'NEXT{k}'),
                     ('getlocal_1',), n(0), ('callproperty', q(BUILTIN + 'slice'), 1), ('setlocal', local),
                     ('getlocal', local), n(1), n(0), e.string(''), e.string(''),
                     ('callpropvoid', q(BUILTIN + 'splice'), 4),
                     ('getlex', q('pinball.master.generated::AbilityValues')), ('getlocal', local),
                     ('callproperty', q(ability_parser), 1), ('returnvalue',),
                     ('label', f'NEXT{k}')]
        e.insert(label, 0, code)


def build(editor):
    install(editor)
    return {'capability': 'leader-table-patched-kinds-v1',
            'kinds': {label: kinds for (label, _, _), kinds in KINDS.items()},
            'mapping': 'leader column i == ability column i + 2; row cloned, master row untouched'}
