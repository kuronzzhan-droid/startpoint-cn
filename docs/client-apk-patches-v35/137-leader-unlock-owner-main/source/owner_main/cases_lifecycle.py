"""负缓存、202与其他条件组合，以及无202既有能力的保持。"""
from .runtime import world, panel, battle, COUNT, KEY, enum, none
from .cases_element import add_element_row


def lifecycle(before, after, ok, executed):
    for initial in ('missing', 'unloaded'):
        e, p, mains, _ = world(after, {} if initial == 'missing' else {KEY: '27'},
                               loaded=initial != 'unloaded')
        for stage in (0, 1):
            count = e.run(COUNT, mains[0], enum(11), p, 0, 1001000, False)['params'][0]
            active = len(panel(e, p, mains)['triggerableAbilities'])
            ok(f'晚加载/{initial}/{stage}/计数', count, stage)
            ok(f'晚加载/{initial}/{stage}/面板', active, stage)
            e.loaded = True
            e.table[KEY] = '27'
        executed.update(e.executed)
    for slot in range(3):
        for condition in (enum(6), enum(7), enum(12), enum(3, []), enum(10, [])):
            e, p, mains, _ = world(after, {KEY: '19'})
            ae, ap, am, _ = world(before, {KEY: '19'})
            for mode in ('initial', 'battle', 'during'):
                actual = battle(e, p, mains[slot], 1001000, (11, condition), mode)
                expected = battle(ae, ap, am[slot], 1001000, (condition,), mode)
                ok(f'仅移除202组合/{slot}/{condition}/{mode}', actual, expected)
            if condition['index'] in (6, 7, 12):
                actual = panel(e, p, mains, slot, kinds=(11, condition))
                expected = panel(ae, ap, am, slot, kinds=(condition,))
                ok(f'面板仅移除202组合/{slot}/{condition}', actual, expected)
            executed.update(e.executed)
        for table in ({}, {KEY: '27'}):
            e, p, mains, _ = world(after, table)
            ae, ap, am, _ = world(before, table)
            ok(f'无202既有可合击能力/{slot}/{table}', panel(e, p, mains, slot, kinds=(0,)),
               panel(ae, ap, am, slot, kinds=(0,)), True)
            executed.update(e.executed)
    for safety in ('no_party', 'first_none'):
        results = []
        for abc in (before, after):
            e, p, mains, unisons = world(abc, {KEY: '27'})
            if safety == 'no_party':
                for char in mains + unisons:
                    char['party'] = None
            else:
                p['mainCharacters'][0] = none()
            for char in unisons:
                add_element_row(char, 4)
            results.append([char['get_element']() for char in unisons])
            if abc is after:
                executed.update(e.executed)
        ok('720无队伍边界/' + safety, results[1], results[0], True)
