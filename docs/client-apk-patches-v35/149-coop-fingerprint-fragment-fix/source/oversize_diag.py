"""合同已有lifecycle事件：区分oversize分支，不改变原gap语义。"""
from fp_transport_codegen import NULL


def add(z):
    # ctx1, serializedLogical2, stagedParts3; bytes4, parts5, reason6, event7.
    c = z.guard() + z.static('wfxFpUtf8Size', z.l(2)) + [('setlocal', 4)]
    c += z.n(0) + [('setlocal', 5)] + z.l(3) + [('iffalse', 'COUNTED')]
    c += z.g(3,'length') + [('setlocal', 5), ('label', 'COUNTED')]
    c += z.s('oversize.part_limit_bytes') + [('setlocal', 6)]
    c += z.l(4) + z.n(4194304) + [('ifle', 'REASON')]
    c += z.s('oversize.logical_limit_bytes') + [('setlocal', 6), ('label', 'REASON')]
    for reason, length in ((z.l(6), z.l(4)), (z.s('oversize.constructed_parts'), z.l(5))):
        event = {'eventId':z.g(1,'eventId'), 'stage':z.s('lifecycle'),
                 'battleId':NULL, 'battleEpoch':NULL, 'targetFrame':NULL,
                 'sourceBattleId':NULL, 'sourceBattleEpoch':NULL,
                 'sourceFrame':NULL, 'command':NULL,
                 'detail':z.obj({'reason':reason, 'length':length})}
        c += z.obj(event) + [('setlocal', 7)]
        c += z.set(1,'eventCursor',z.g(1,'eventId'))
        c += z.set(1,'eventId',z.g(1,'eventId')+z.n(1)+[('add',)])
        c += z.static('wfxFpQueue', z.l(1), z.s('events'), z.l(7), void=True)
    c += [('label','DONE'), ('returnvoid',)]
    z.add('wfxFpOversizeInfo','void',['Object','String','*'],c,8)
