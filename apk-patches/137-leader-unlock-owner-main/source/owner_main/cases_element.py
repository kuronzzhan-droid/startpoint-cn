"""kind720为自身能力的202；不得借新属性自举bit16六同色。"""
from .runtime import world, enum, some, KEY


def add_element_row(char, element, condition=11):
    source = {'_type': 'InstantAbilitySource',
              'preconditions': [enum(0, enum(condition), cls='AbilityPreconditionKind')],
              'trigger': enum(0, 1, enum(0), cls='InstantAbilityTriggerKind'),
              'content': enum(2, enum(1, enum(0), enum(36, element)))}
    row = enum(0, source, cls='AbilityTrigger')
    ability = {'_type': 'AbilityLogic', 'getTriggers': lambda: [row]}
    char['_controlled_slots'] = [some(ability)]
    char['getSelfAbilitySlots'] = lambda *args: char['_controlled_slots']


def element_cases(before, after, ok, executed):
    for mask, layout in ((m, layout) for m in range(32)
                         for layout in ('mixed', 'five', 'six_water')):
        outputs = []
        for abc in (before, after):
            e, p, mains, unisons = world(abc, {KEY: str(mask)}, layout)
            for char in unisons:
                add_element_row(char, 4)
            actual = [char['get_element']() for char in unisons]
            # Rebuild all characters through actual native getters. These objects must
            # start without cachedElement, retain the correct original/full party links.
            fresh = [x['params'][0] for x in p['get_unisonCharacters']()]
            assert all(c['cachedElement'] is None and c['party'] is p for c in fresh)
            again = [char['get_element']() for char in fresh]
            outputs.append((actual, again))
            if abc is after:
                executed.update(e.executed)
        expected = []
        for slot in range(3):
            enabled = bool(mask & 1 and (not mask & 8 or slot == 0)
                           and (not mask & 16 or layout.startswith('six')))
            expected.append(4 if enabled else outputs[0][0][slot])
        ok(f'720自身202/{mask}/{layout}', outputs[1][0], expected)
        ok(f'720真实重建无缓存/{mask}/{layout}', outputs[1][1], expected)
        if mask & 16 and not layout.startswith('six'):
            ok(f'720不自举共鸣/{mask}/{layout}', outputs[1], outputs[0], True)

    # bit16 snapshots must not change existing bit2-only behavior or regular 203 gates.
    for condition in (6, 7, 12):
        for slot in range(3):
            outputs = []
            for abc in (before, after):
                e, p, _, us = world(abc, {KEY: '27'})
                add_element_row(us[slot], 4, condition)
                outputs.append(us[slot]['get_element']())
                if abc is after:
                    executed.update(e.executed)
            ok(f'720原生非202条件/{condition}/{slot}', outputs[1], outputs[0], True)
