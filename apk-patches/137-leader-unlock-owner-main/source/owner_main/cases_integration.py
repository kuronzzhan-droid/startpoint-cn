"""真实完整能力分发/汇总入口，以及kind720的原生角色重建路径。"""
from .runtime import world, enum, none, some, KEY, VM, battle, panel


def install_two_rows(e, mains, unisons):
    original = e.lex['AbilityLogic'].ctor
    def ability(*args):
        obj = original(*args)
        number = args[0]
        from .runtime import trigger
        obj['getTriggers'] = lambda: ([trigger((11,))] if number == 1001 else
                                     [trigger((11, enum(13, 6)))] if number == 1002 else [])
        obj['values'] = [{'unisonable': True}]
        return obj
    e.lex['AbilityLogic'].ctor = ability
    e.lex['BattleAbilitySource'] = VM.Cls('BattleAbilitySource',
        lambda: e.construct_native('BattleAbilitySource'))
    e.leader_ids.clear()
    for char in mains + unisons:
        char['getLeaderAbility'] = lambda: none()
    e.lex['AbilitySummarizer'] = {
        'summaryInstantBattleAbility': lambda chars, slot, row, opts: [[slot, row['origin']]],
        'applyValue': lambda chars, rows: rows}


def integration(before, after, ok, executed):
    for mask in (None, 27, 31):
        for layout in ('mixed', 'six_water'):
            captures = []
            for abc in (before, after):
                e, p, mains, unisons = world(abc, {} if mask is None else {KEY: str(mask)}, layout)
                install_two_rows(e, mains, unisons)
                available = [e.run('BattleCharacterLogic/getAvailableAbilities', c, p, slot,
                                  enum(9), [none()] * 3) for slot, c in enumerate(mains)]
                filtered = [e.run('BattleCharacterLogic/getAvailableAbilitiesWithCond', c, p, slot,
                                 lambda cond: True, [none()] * 3, False, False)
                            for slot, c in enumerate(mains)]
                summary = e.run('AbilitySummarizer$/summaryAbilities', e.lex['AbilitySummarizer'],
                                p, mains, {}, False)
                captures.append({'available': [[r['origin'] for r in a['instantBattleAbilities']]
                                               for a in available],
                                 'filtered': [[r['origin'] for r in a['instantBattleAbilities']]
                                              for a in filtered], 'summary': summary})
                if abc is after:
                    executed.update(e.executed)
            expected = [[1001000, 1002000], [], []] if mask and layout == 'six_water' else [[], [], []]
            for field in ('available', 'filtered'):
                ok(f'完整官方分发/{mask}/{layout}/{field}', captures[1][field], expected)
            ok(f'完整官方面板汇总/{mask}/{layout}', captures[1]['summary'],
               [[0, 1001000], [0, 1002000]] if mask and layout == 'six_water' else [])
            if not(mask and layout == 'six_water'):
                ok(f'完整官方入口旧行为/{mask}/{layout}', captures[1], captures[0], True)
    from .cases_element import element_cases
    element_cases(before, after, ok, executed)
