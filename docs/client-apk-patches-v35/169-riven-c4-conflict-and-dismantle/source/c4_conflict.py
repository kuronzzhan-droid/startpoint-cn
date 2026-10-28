"""C4 schema-safe completion and page-owned conflict recovery splices."""
from c1_lookup import number
from c2_common import DYNAMIC, context, fresh_record, get, set_, prefix
from c4_conflict_ui import recover_window, queue_ui


def success(e, first, select):
    q = e.q
    ctx, data, record, scratch = range(first, first + 4)
    g = lambda n: ('getlocal', n)
    gp = lambda n: ('getproperty', q(n))
    code = [('getlocal_0',), gp('characterId'), number(e, 16000001),
            ('iflt', 'c4_original'), ('getlocal_0',), gp('characterId'),
            number(e, 16000999), ('ifgt', 'c4_original')]
    # Closed/different pages have disposed their Hook owner. Do not dispatch into
    # another instance, even when the new page reused the same numeric slot.
    code += context(e, ctx, 'c4_done')
    code += [g(ctx), *get(e, 'c4_request_remote'), ('getlocal_0',), ('ifne', 'c4_done'),
             ('getlocal_0',), gp('characterId'), g(ctx), *get(e, 'item_id'),
             ('ifne', 'c4_done'), ('getlocal_1',), gp('rawData'), *get(e, 'data'),
             ('setlocal', data), g(ctx), *set_(e, 'c4_response_remote', [('getlocal_0',)]),
             g(data), *get(e, 'weapon_riven_conflict'), ('pushtrue',), ('ifne', 'c4_not_conflict'),
             g(ctx), *set_(e, 'c4_conflict', [('pushtrue',)]),
             g(ctx), *set_(e, 'c4_conflict_reason', [g(data), *get(e, 'reason')]),
             ('jump', 'c4_signal'), ('label', 'c4_not_conflict'),
             g(ctx), *get(e, 'c4_request_kind'), e.string('dismantle'), ('ifeq', 'c4_signal'),
             *fresh_record(e, ctx, record, scratch, 'c4_signal'),
             ('label', 'c4_signal'), ('getlocal_0',), gp('dispatcher'),
             ('getlex', q('pinball.remote.exBoost::ExBoostSelectRemoteInput' if select else
                          'pinball.remote.exBoost::ExBoostDrawRemoteInput')),
             ('getlocal_0',), gp('characterId')]
    if not select:
        code += [e.string('ability_id_list'), ('newarray', 0), e.string('status_id'),
                 number(e, 0), ('newobject', 2)]
    code += [('callproperty', q('FinishedDiscard' if select else 'Finished'), 1 if select else 2),
             ('pushnull',), ('callpropvoid', q('instant'), 2), ('label', 'c4_done'),
             ('returnvoid',), ('label', 'c4_original')]
    return code


def window_input(e, first, select):
    q = e.q
    ctx, event, ident = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    gp = lambda n: ('getproperty', q(n))
    code = [('getlocal_2',) if select else ('getlocal_1',), ('setlocal', event),
            g(event), gp('params'), number(e, 0), ('getproperty', DYNAMIC),
            ('setlocal', ident), g(ident), number(e, 16000001), ('iflt', 'c4_original'),
            g(ident), number(e, 16000999), ('ifgt', 'c4_original')]
    code += context(e, ctx, 'c4_done')
    code += [g(ident), g(ctx), *get(e, 'item_id'), ('ifne', 'c4_done'),
             ('getlocal_0',), gp('drawResult'), gp('index'), number(e, 0), ('ifne', 'c4_done'),
             ('getlocal_0',), gp('drawResult'), gp('params'), number(e, 0),
             ('getproperty', DYNAMIC), g(ctx), ('ifne', 'c4_done'),
             g(ctx), *get(e, 'c4_response_remote'), ('iffalse', 'c4_done'),
             g(ctx), *get(e, 'c4_response_remote'), g(ctx), *get(e, 'c4_request_remote'),
             ('ifne', 'c4_done'), g(ctx), *get(e, 'c4_conflict'), ('iftrue', 'c4_recover'),
             g(ctx), *get(e, 'c4_request_kind'), e.string('dismantle'),
             ('ifne', 'c4_original'),
             *recover_window(e, ctx, first + 3, False), ('jump', 'c4_done'),
             ('label', 'c4_recover')]
    # Reuse the recovery emitter, but give its two local branch labels a distinct
    # namespace because both recovery paths reside in the same existing method.
    recover = recover_window(e, ctx, first + 3, True)
    code += [tuple('c4_conflict_' + a if isinstance(a, str) and a.startswith('c4_recover_')
                   else a for a in ins) for ins in recover]
    return code + [('label', 'c4_done'), ('returnvoid',), ('label', 'c4_original')]


def queue_conflict_splices(e):
    methods = {}
    for cls, select in [('ExBoostDrawRealRemote', False), ('ExBoostSelectRealRemote', True)]:
        label = cls + '/successHandler'
        methods[label] = prefix(e, label, lambda e, f, s=select: success(e, f, s))
    for name, select in [('characterExBoostDrawRemoteInput', False),
                         ('characterExBoostSelectRemoteInput', True)]:
        label = 'ExBoostWindow/' + name
        methods[label] = prefix(e, label, lambda e, f, s=select: window_input(e, f, s))
    methods.update(queue_ui(e))
    return {'methods': methods, 'message': '裂罅已变化，请重试',
            'dialog': 'existing OkDialog + DialogContent.DynamicText',
            'completion': 'existing Hook schema; deleted records do not block completion',
            'ownership': 'request object plus active drawResult context identity',
            'processing': 'unchanged CloseThen through ProcessingDialogManager',
            'normal_dismantle': 'same return path without conflict notice'}
