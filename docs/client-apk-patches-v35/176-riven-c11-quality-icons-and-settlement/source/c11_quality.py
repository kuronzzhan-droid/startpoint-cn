"""Remove cap rendering and add five-dot quality without editing old bytes."""
import asm
from c1_lookup import number
from c2_common import get, queue
from c10_strings import TEXT
from c11_quality_tokens import dots, suffix, COLORS


def queue_caps(e):
    result = {}
    for label in ('ExBoostWindow/getExBoostInformation', 'ExBoostWindow/getExBoostDetail',
                  'AbilitySoulDetailDialog/initialize'):
        ops = asm.decode(e.body(label)[5])
        cap = next(i for i, op in enumerate(ops) if op.name == 'pushstring'
                   and e.abc.s(op.args[0]) == '（满档 ')
        sites = [i for i in range(cap) if ops[i].name == 'getproperty'
                 and e.abc.mn_name(ops[i].args[0]) == 'length'
                 and ops[i + 1].name == 'pushbyte' and ops[i + 1].args == [3]
                 and ops[i + 2].name == 'iflt']
        assert len(sites) == 1, (label, sites)
        at = sites[0] + 1
        result[label] = queue(e, label, [('pop',), number(e, 0)], at, asm.SKIP)
        result[label]['cap_code_bypassed_before_read_or_ability_construction'] = True
    return result


def queue_existing_names(e):
    result = {}
    for label in ('ExBoostWindow/getExBoostInformation', 'AbilitySoulDetailDialog/initialize'):
        body = e.body(label); ops = asm.decode(body[5])
        at = next(i for i, op in enumerate(ops) if op.name == 'pushstring'
                  and e.abc.s(op.args[0]) == ' · 倾向 ')
        assert ops[at - 1].name == 'iffalse' and ops[at + 5].name == 'convert_i'
        result[label] = {
            'fallback_one': queue(e, label, [('pop',), ('pushtrue',)], at - 1, asm.SKIP),
            'label': queue(e, label, [('pop',), e.string(TEXT['quality'])], at + 1, asm.SKIP),
            'dots': queue(e, label, dots(e, body[2], 'c11_quality'), at + 6, asm.SKIP),
        }
    label = 'ExBoostSelectDialog/getExBoostCharacterName'
    body = e.body(label); ops = asm.decode(body[5])
    at = next(i for i, op in enumerate(ops) if op.name == 'returnvalue')
    assert ops[at - 1].name == 'add'
    result[label] = queue(e, label, suffix(e,
        [('getlocal', 1), *get(e, 'record'), *get(e, 'disposition')],
        body[2], 'c11_select_quality'), at, asm.SKIP)
    return result


def queue_quality(e):
    from c11_quality_views import queue_views
    return {'caps': queue_caps(e), 'names': queue_existing_names(e),
            'views': queue_views(e), 'quality_colors': [f'#{n:06x}' for n in COLORS],
            'dot_text': {str(n): TEXT['quality_' + str(n)] for n in range(1, 6)},
            'fallback_quality': 1, 'new_art_assets': 0, 'html_markup': False,
            'runtime_font_rendering_verified': False}
