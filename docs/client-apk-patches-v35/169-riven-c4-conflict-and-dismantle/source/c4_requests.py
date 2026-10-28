"""Bind each existing Riven transport to the current saved instance identity."""
import asm
from c2_common import DYNAMIC, get, set_, queue


def mark_request(e, ctx, kind):
    return [('getlocal', ctx), *set_(e, 'c4_request_remote', [('getlocal_0',)]),
            ('getlocal', ctx), *set_(e, 'c4_request_kind', [e.string(kind)]),
            ('getlocal', ctx), *set_(e, 'c4_dismantle', [('pushfalse',)])]


def queue_requests_splices(e):
    result = {}
    for kind in ('draw', 'select'):
        label = 'ExBoost' + kind.title() + 'RealRemote/<ctor>'
        ops = asm.decode(e.body(label)[5])
        path = [i for i, op in enumerate(ops) if op.name == 'pushstring'
                and e.abc.s(op.args[0]) == 'weapon_riven/' + kind]
        assert len(path) == 1, (label, path)
        at = path[0]
        record_key = [i for i, op in enumerate(ops[:at]) if op.name == 'pushstring'
                      and e.abc.s(op.args[0]) == 'record']
        assert len(record_key) == 1
        anchor = record_key[0]
        assert ops[anchor - 1].name == ops[anchor + 1].name == 'getlocal'
        ctx, record = ops[anchor - 1].args[0], ops[anchor + 1].args[0]
        payload = next(i for i in range(at + 1, len(ops)) if ops[i].name == 'newobject')
        assert ops[payload].args == [3 if kind == 'select' else 2]
        code = [('dup',), e.string('riven_id'), ('getlocal', record),
                *get(e, 'riven_id'), ('setproperty', DYNAMIC), *mark_request(e, ctx, kind)]
        result[label] = {'payload': queue(e, label, code, payload + 1),
                         'save_record_local': record, 'context_local': ctx}
        if kind == 'select':
            # C2 has already validated context/item identity and refreshed the
            # saved record. Dismantle must branch before the pending-only guard.
            pending = next(i for i in range(anchor + 1, at) if ops[i].name == 'pushstring'
                           and e.abc.s(ops[i].args[0]) == 'pending')
            assert ops[pending - 1].name == 'getlocal'
            code = [('getlocal', ctx), *get(e, 'c4_dismantle'), ('iffalse', 'select_original'),
                    *mark_request(e, ctx, 'dismantle'), ('getlocal_0',),
                    e.string('weapon_riven/dismantle'), e.string('item_id'), ('getlocal_3',),
                    e.string('riven_id'), ('getlocal', record), *get(e, 'riven_id'),
                    ('newobject', 2), ('getlocal_0',), ('getproperty', e.q('successHandler')),
                    ('callpropvoid', e.q('startUserRequest'), 3), ('returnvoid',),
                    ('label', 'select_original')]
            result[label]['dismantle'] = queue(e, label, code, pending - 1)
    return {'methods': result, 'fields': {'draw': ['item_id', 'revision', 'riven_id'],
             'select': ['item_id', 'draw_id', 'is_confirm', 'riven_id'],
             'dismantle': ['item_id', 'riven_id']},
            'identity_source': 'fresh saveData.weapon_rivens[item_id], never cached UI record',
            'completion_ownership': 'context.c4_request_remote and c4_request_kind',
            'ordinary_transport': 'existing EX request bodies retained unchanged'}
