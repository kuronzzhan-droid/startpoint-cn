"""C8: promote the existing virtual group, leaving all other group ordering intact."""
import asm
from c1_lookup import number
from c2_common import queue
from c3_inventory import GROUP


def promote(e, first):
    result, keys, index = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    return [('setlocal', result), g(result), ('getproperty', e.q('_keys')),
            ('setlocal', keys), g(keys), number(e, GROUP),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
            ('setlocal', index), g(index), number(e, 0), ('ifle', 'done'),
            g(keys), g(index), number(e, 1),
            ('callpropvoid', e.q('http://adobe.com/AS3/2006/builtin::splice'), 2),
            g(result), number(e, GROUP), ('newarray', 1), g(keys),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::concat'), 1),
            ('setproperty', e.q('_keys')),
            ('label', 'done'), g(result)]


def queue_inventory(e):
    label = 'ItemTableTranslator/translateFromCategorizedItems'
    body = e.body(label)
    ops = asm.decode(body[5])
    assert ops[-1].name == 'returnvalue'
    return {'methods': {label: queue(e, label, promote(e, body[2]), len(ops) - 1)},
            'group': GROUP, 'other_group_order': 'stable',
            'sale_policy': 'C7 eligibility and sale selection preserved; only the virtual display group order changes'}
