"""Reuse existing EX remotes with instance-bound Riven requests and common merge."""
import asm
from c2_common import context, fresh_record, get, prefix, queue
from c1_lookup import number


def constructor(e, first, select=False):
    g = lambda n: ('getlocal', n)
    gp = lambda n: ('getproperty', e.q(n))
    ctx, record, scratch = range(first, first + 3)
    code = context(e, ctx, 'original')
    code += [('getlocal_3',), g(ctx), *get(e, 'item_id'), ('ifne', 'original'),
             *fresh_record(e, ctx, record, scratch, 'done'),
             ('getlocal_0',), ('getlocal_2',), ('setproperty', e.q('dispatcher')),
             ('getlocal_0',), ('getlocal_3',), ('setproperty', e.q('characterId'))]
    if select:
        code += [('getlocal_0',), g(4), ('setproperty', e.q('isConfirm')),
                 g(record), *get(e, 'pending'), ('iffalse', 'done')]
    code += [('getlocal_0',), e.string('weapon_riven/select' if select else 'weapon_riven/draw'),
             e.string('item_id'), ('getlocal_3',)]
    if select:
        code += [e.string('draw_id'), g(record), *get(e, 'pending'), *get(e, 'draw_id'),
                 e.string('is_confirm'), g(4), ('newobject', 3)]
    else:
        code += [e.string('revision'), g(record), *get(e, 'revision'), ('newobject', 2)]
    code += [('getlocal_0',), gp('successHandler'), ('callpropvoid', e.q('startUserRequest'), 3),
             ('label', 'done'), ('returnvoid',), ('label', 'original')]
    return code


def success(e, first, select=False):
    g = lambda n: ('getlocal', n)
    gp = lambda n: ('getproperty', e.q(n))
    ctx, record, scratch = range(first, first + 3)
    # A response can outlive its page. Identify Riven requests by the existing
    # characterId slot before consulting the transient page context; an absent
    # or different context must never invoke the ordinary character parser.
    code = [('getlocal_0',), gp('characterId'), number(e, 16000001), ('iflt', 'original'),
            ('getlocal_0',), gp('characterId'), number(e, 16000200), ('ifgt', 'original')]
    code += context(e, ctx, 'done')
    code += [('getlocal_0',), gp('characterId'), g(ctx), *get(e, 'item_id'), ('ifne', 'done'),
             *fresh_record(e, ctx, record, scratch, 'done')]
    enum = 'pinball.remote.exBoost::ExBoostSelectRemoteInput' if select else 'pinball.remote.exBoost::ExBoostDrawRemoteInput'
    code += [('getlocal_0',), gp('dispatcher'), ('getlex', e.q(enum)),
             ('getlocal_0',), gp('characterId')]
    if not select:
        # The existing Hook TypePacker schema requires an ExBoost-shaped second
        # argument. It is only a completion signal; the window never renders it.
        code += [e.string('ability_id_list'), ('newarray', 0), e.string('status_id'), number(e, 0), ('newobject', 2)]
    # Both select outcomes use the one-argument existing enum variant. Actual
    # current/pending data comes exclusively from the C1 common-response record.
    code += [('callproperty', e.q('FinishedDiscard' if select else 'Finished'), 1 if select else 2),
             ('pushnull',), ('callpropvoid', e.q('instant'), 2),
             ('label', 'done'), ('returnvoid',), ('label', 'original')]
    return code


def queue_remote_splices(e):
    result = {}
    for cls, select in [('ExBoostDrawRealRemote', False), ('ExBoostSelectRealRemote', True)]:
        label = cls + '/<ctor>'
        body = e.body(label)
        ops = asm.decode(body[5])
        matches = [i for i, op in enumerate(ops) if op.name == 'constructsuper']
        assert matches == [8], (label, matches)
        result[label] = queue(e, label, constructor(e, body[2], select), at=matches[0] + 1)
        label = cls + '/successHandler'
        result[label] = prefix(e, label, lambda e, f, select=select: success(e, f, select))
    return {'methods': result, 'draw_path': 'weapon_riven/draw', 'select_path': 'weapon_riven/select',
            'draw_request': ['item_id', 'revision'], 'select_request': ['item_id', 'draw_id', 'is_confirm'],
            'viewer_and_api_count': 'unchanged startUserRequest transport',
            'save_merge': 'unchanged C1 RealRemoteService.earlySuccessHandler before callback',
            'response_shape': 'C1 saveData.weapon_rivens record; no character_list parser in Riven branch',
            'hook_signal': 'draw Finished(item_id,{ability_id_list:[],status_id:0}); select FinishedDiscard(item_id); schema-safe signals only, never rendered'}
