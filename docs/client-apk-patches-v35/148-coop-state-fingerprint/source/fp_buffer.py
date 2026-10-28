"""诊断专用缓冲和容量上限；不阻塞原战斗。"""
from fp_emit import BATTLE, Ops, local as L, NULL, TRUE, ARRAY, PROLOGUE


def measure(e):
    o = Ops(e)
    c = PROLOGUE + [('getlex', e.q('flash.utils::ByteArray')), ('construct', 0), ('setlocal_2',)]
    c += o.call(L(2), 'writeUTFBytes',
        [('getlex', e.q('JSON'))] + L(1) + [('callproperty', e.q('stringify'), 1)], void=True)
    c += o.get(L(2), 'length') + [('returnvalue',)]
    return e.add_method(BATTLE, 'wfxFpMeasure', 'int', ['*'], c, 3, static=True)


def gap(e):
    o = Ops(e)
    fields = dict(reason=L(2), battleId=NULL, battleEpoch=NULL, fromFrame=L(3), toFrame=L(4),
                  fromSeq=NULL, toSeq=NULL, fromEventId=NULL, toEventId=NULL)
    c = PROLOGUE + o.slot('wfxFpEnabled') + [('iffalse', 'DONE')]
    c += L(1) + [('iffalse', 'DONE')]
    # These gaps have epoch-wide scope; every Battle must renew its baseline.
    c += o.set(L(1), 'generation', o.get(L(1), 'generation') + o.num(1) + [('add_i',)])
    c += o.set(L(1), 'forceFull', TRUE)
    c += o.object(fields) + [('setlocal', 5)]
    c += o.static('wfxFpQueue', L(1), o.string('gaps'), L(5), void=True)
    c += [('label', 'DONE'), ('returnvoid',)]
    return e.add_method(BATTLE, 'wfxFpGap', 'void', ['Object', 'String', '*', '*'], c, 6, static=True)


def queue(e):
    o = Ops(e)
    c = PROLOGUE + [('label', 'TRY')]
    c += o.slot('wfxFpEnabled') + [('iffalse', 'DONE')]
    c += L(1) + [('iffalse', 'DONE')]
    c += o.static('wfxFpMeasure', L(3)) + o.num(1) + [('add_i',), ('setlocal', 4)]
    c += o.get(L(1), 'pendingBytes') + o.get(L(1), 'queuedBytes') + [('add',)] + L(4)
    c += [('add',)] + o.num(4190000) + [('ifgt', 'OVERFLOW')]  # reserve gap/envelope room
    c += o.index(L(1), L(2)) + L(3) + [('callpropvoid', o.q('push'), 1)]
    c += o.set(L(1), 'pendingBytes', o.get(L(1), 'pendingBytes') + L(4) + [('add_i',)])
    c += [('jump', 'DONE'), ('label', 'OVERFLOW')]
    for name in ('rows', 'events', 'gaps', 'sendQueue'):
        c += o.set(L(1), name, ARRAY)
    for name in ('pendingBytes', 'queuedBytes'):
        c += o.set(L(1), name, o.num(0))
    c += o.set(L(1), 'generation', o.get(L(1), 'generation') + o.num(1) + [('add_i',)])
    c += o.set(L(1), 'forceFull', TRUE)
    fields = dict(reason=o.string('buffer_overflow'), battleId=NULL, battleEpoch=NULL,
                  fromFrame=NULL, toFrame=NULL, fromSeq=NULL, toSeq=o.get(L(1), 'seq'),
                  fromEventId=NULL, toEventId=o.get(L(1), 'eventCursor'))
    c += o.object(fields) + [('setlocal', 5)]
    c += o.call(o.get(L(1), 'gaps'), 'push', L(5), void=True)
    c += o.set(L(1), 'pendingBytes', o.static('wfxFpMeasure', L(5)) + o.num(1) + [('add_i',)])
    c += o.set(L(1), 'seq', o.get(L(1), 'seq') + o.num(1) + [('add',)])
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'END'), ('label', 'CATCH'),
          ('pop',), ('getlocal_0',), ('pushscope',)]
    c += L(1) + [('iffalse', 'FAILEND')]
    # Serialization failure invalidates the queued history as well as the current row.
    # Do not call measure recursively from this recovery path; 512 conservatively
    # budgets the fixed small gap object and stays within the reserved room.
    for name in ('rows', 'events', 'gaps', 'sendQueue'):
        c += o.set(L(1), name, ARRAY)
    c += o.set(L(1), 'queuedBytes', o.num(0))
    c += o.set(L(1), 'pendingBytes', o.num(512))
    c += o.set(L(1), 'generation', o.get(L(1), 'generation') + o.num(1) + [('add_i',)])
    c += o.set(L(1), 'forceFull', TRUE)
    fields['reason'] = o.string('sampling_error')
    c += o.call(o.get(L(1), 'gaps'), 'push', o.object(fields), void=True)
    c += o.set(L(1), 'seq', o.get(L(1), 'seq') + o.num(1) + [('add',)])
    c += [('label', 'FAILEND'), ('returnvoid',)]
    return e.add_method(BATTLE, 'wfxFpQueue', 'void', ['Object', 'String', 'Object'], c, 6,
                        static=True, exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def keys(e):
    o = Ops(e)
    c = PROLOGUE + ARRAY + [('setlocal_2',)] + o.num(0) + [('setlocal_3',)]
    c += [('label', 'LOOP'), ('avm_label',), ('hasnext2', 1, 3), ('iffalse', 'KEYS_DONE')]
    c += L(2) + L(1) + L(3) + [('nextname',), ('callpropvoid', o.q('push'), 1)]
    c += [('jump', 'LOOP'), ('label', 'KEYS_DONE')]
    c += o.call(L(2), 'sort') + [('pop',)] + L(2) + [('returnvalue',)]
    return e.add_method(BATTLE, 'wfxFpKeys', 'Array', ['Object'], c, 4, static=True)


def build(e):
    return {'measure': measure(e), 'gap': gap(e), 'queue': queue(e), 'keys': keys(e)}
