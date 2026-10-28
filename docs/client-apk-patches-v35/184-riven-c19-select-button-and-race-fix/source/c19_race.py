"""Fold complete race unions only at existing riven description call sites."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, queue

RACES = ('Human', 'Beast', 'Mystery', 'Element', 'Dragon', 'Machine',
         'Devil', 'Plants', 'Aquatic', 'Undead', 'Breakableblock')
METHODS = ('ExBoostWindow/getExBoostInformation', 'ExBoostWindow/getExBoostDetail',
           'AbilitySoulDetailDialog/initialize', 'QuestResultScene/run',
           'QuestResultScene/viewDidChange')


def fold(e, ability, first, tag):
    """Read native master values; preserve the complete localized string on stack.

    Native AbilitySoulValues stores CharacterSlayer.character_groups as strings
    in trigger.params[0].{instant,during}_content.params[0]. No key allowlist,
    global context flag, master mutation, or shared description-method patch.
    """
    text, rows, index, row, data, content, groups, names = range(first, first + 8)
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    n = lambda v: number(e, v)
    gp = lambda v: ('getproperty', e.q(v))
    call = lambda v, count: ('callproperty', e.q(v), count)
    done, loop, skip, found = (tag + suffix for suffix in ('_done', '_loop', '_skip', '_found'))
    code = [p(text), g(ability), *get(e, 'values'), p(rows), g(rows),
            ('istype', e.q('Array')), ('iffalse', done), n(0), p(index),
            ('label', loop), ('avm_label',), g(index), g(rows), gp('length'),
            ('ifge', done), g(rows), g(index), ('getproperty', DYNAMIC), p(row),
            g(row), ('iffalse', skip), g(row), *get(e, 'trigger'), p(data),
            g(data), ('iffalse', skip), g(data), *get(e, 'params'), p(data),
            g(data), ('istype', e.q('Array')), ('iffalse', skip),
            g(data), n(0), ('getproperty', DYNAMIC), p(data), g(data), ('iffalse', skip),
            g(data), *get(e, 'instant_content'), p(content), g(content), ('iftrue', found),
            g(data), *get(e, 'during_content'), p(content), g(content), ('iffalse', skip),
            ('label', found), g(content), *get(e, 'tag'), e.string('CharacterSlayer'),
            ('ifne', skip), g(content), *get(e, 'params'), p(content),
            g(content), ('istype', e.q('Array')), ('iffalse', skip),
            g(content), n(0), ('getproperty', DYNAMIC), p(content),
            g(content), ('iffalse', skip), g(content), *get(e, 'character_groups'), p(groups),
            g(groups), ('istype', e.q('Array')), ('iffalse', skip)]
    for race in RACES:
        code += [g(groups), e.string(race), call('http://adobe.com/AS3/2006/builtin::indexOf', 1),
                 n(0), ('iflt', skip)]
    # Recreate this exact group's native localization (including order and
    # separators), so a separate partial-race clause in the same text survives.
    code += [('getlex', e.q('pinball.common.data.ability.description::AbilityDescriptionTools')),
             ('getlex', e.q('pinball.common.data.ability._OrCharacterGroup::OrCharacterGroup_Impl_')),
             g(groups), g(ability), gp('logicAssets'), call('resolve', 2),
             ('getlex', e.q('pinball.common.data.ability.description::AbilityConstraintTargetKind')),
             gp('Enemy'), g(ability), gp('logicAssets'), ('pushfalse',),
             call('stringfyCharacterGroups', 4), p(names),
             g(names), ('iffalse', skip), g(text), g(names),
             call('http://adobe.com/AS3/2006/builtin::indexOf', 1), n(0), ('iflt', skip),
             g(text), g(names), call('http://adobe.com/AS3/2006/builtin::split', 1),
             e.string('敌人'), call('http://adobe.com/AS3/2006/builtin::join', 1), p(text),
             g(text), e.string('独立伤害乘区'),
             call('http://adobe.com/AS3/2006/builtin::indexOf', 1), n(0), ('ifge', skip),
             g(text), e.string('（独立伤害乘区1）'), ('add',), p(text),
             ('label', skip), ('inclocal_i', index), ('jump', loop),
             ('label', done), g(text)]
    return code


def apply(e):
    report = {}
    for method_index, label in enumerate(METHODS):
        body = e.body(label)
        ops = asm.decode(body[5])
        hits = [i for i, op in enumerate(ops[:-2]) if op.name == 'callproperty'
                and e.abc.mn_name(op.args[0]) == 'getDescriptions'
                and ops[i+1].name == 'pushstring' and e.abc.s(ops[i+1].args[0]) == '\n'
                and ops[i+2].name == 'callproperty'
                and e.abc.mn_name(ops[i+2].args[0]).endswith('::join')]
        assert hits, label
        report[label] = []
        for hit_index, at in enumerate(hits):
            # All matching joins are inside existing riven DTO/cap branches.
            # The ordinary soul branch returns Array directly, without this join.
            receiver = body[2]
            capture = queue(e, label, [('dup',), ('setlocal', receiver)], at, asm.SKIP)
            change = queue(e, label, fold(e, receiver, receiver + 1,
                f'c19_race_{method_index}_{hit_index}'), at + 3, asm.SKIP)
            report[label].append({'capture': capture, 'fold': change})
    return {'methods': report, 'races': list(RACES),
            'condition': 'actual CharacterSlayer.character_groups contains all eleven race names',
            'scope': 'riven DTO and cap construction only; native official description methods unchanged',
            'multiplier': 'preserve existing independent-damage annotation, otherwise append multiplier 1'}
