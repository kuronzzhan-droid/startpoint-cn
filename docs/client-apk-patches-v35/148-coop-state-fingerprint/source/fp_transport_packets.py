"""逻辑批次的UTF-8计量、分片和有界队列；全部只操作诊断对象。"""
from fp_transport_codegen import BATTLE, NULL, TRUE, FALSE, EMPTY


def add_packet_helpers(z):
    # UTF-8 length is measured by the same AVM2 ByteArray encoder used on device.
    z.add('wfxFpUtf8Size', 'int', ['String'],
        [('getlex', z.q('flash.utils::ByteArray')), ('construct', 0), ('setlocal_2',)]
        + z.call(2, 'writeUTFBytes', z.l(1), void=True)
        + z.g(2, 'length') + [('returnvalue',)], 3)
    z.add('wfxFpPacketSize', 'int', ['Object'],
        z.static('wfxFpUtf8Size', z.json(z.arr(z.n(0), z.arr(z.n(5), z.l(1)))))
        + z.n(1) + [('add_i',), ('returnvalue',)], 2)
    # args ctx,part,parts,chunk,logical; local6=payload.
    code = z.obj({'kind': z.s('wf-fp'), 'v': z.n(1),
        'schema': z.s('coop-state-fingerprint-v1'), 'build': z.s('v35p'),
        'epoch': z.g(1, 'epoch'), 'seq': z.g(1, 'seq'),
        'part': z.l(2), 'parts': z.l(3)}) + [('setlocal', 6)]
    code += z.l(3) + z.n(1) + [('ifne', 'CHUNK')]
    for key in ('rows', 'events', 'gaps'):
        code += z.set(6, key, z.g(5, key))
    code += [('jump', 'RETURN'), ('label', 'CHUNK')]
    code += z.set(6, 'chunk', z.l(4))
    code += [('label', 'RETURN')] + z.l(6) + [('returnvalue',)]
    z.add('wfxFpEnvelope', 'Object', ['Object', 'int', 'int', 'String', 'Object'], code, 7)

    # A drop covers the entire queued chain, including any earlier unsent gap.
    # The lower bound is unknown: choosing the first queued seq would narrow a
    # prior gap carried by that batch and lose its earlier uncertainty range.
    code = z.obj({'reason': z.l(2), 'battleId': NULL, 'battleEpoch': NULL,
        'fromFrame': NULL, 'toFrame': NULL, 'fromSeq': NULL,
        'toSeq': z.g(1, 'seq'), 'fromEventId': NULL, 'toEventId': NULL}) + [('setlocal', 5)]
    for key in ('rows', 'events', 'sendQueue'):
        code += z.set(1, key, EMPTY)
    code += z.set(1, 'gaps', z.arr(z.l(5)))
    for key in ('queuedBytes', 'pendingBytes'):
        code += z.set(1, key, z.n(0))
    code += z.set(1, 'forceFull', TRUE)
    for key in ('generation', 'seq'):
        code += z.set(1, key, z.g(1, key) + z.n(1) + [('add',)])
    code += [('returnvoid',)]
    z.add('wfxFpTransportDrop', 'void', ['Object', 'String'], code, 6)

    # Pack locals: L2,text3,payload4,size5,stage6,total7,offset8,end9,
    # chunk10,parts11,i12,entry13,textLength14. No game object is retained.
    code = []
    for key in ('rows', 'events', 'gaps'):
        code += z.g(1, key) + [('getproperty', z.q('length'))]
    code += [('add_i',), ('add_i',), ('iftrue', 'PENDING'), ('pushtrue',), ('returnvalue',),
             ('label', 'PENDING')]
    code += z.obj({k: z.g(1, k) for k in ('rows', 'events', 'gaps')}) + [('setlocal_2',)]
    code += z.json(z.l(2)) + [('setlocal_3',)]
    code += z.static('wfxFpUtf8Size', z.l(3)) + z.n(4194304) + [('ifgt', 'OVERSIZE')]
    code += z.static('wfxFpEnvelope', z.l(1), z.n(0), z.n(1), NULL, z.l(2)) + [('setlocal', 4)]
    code += z.static('wfxFpPacketSize', z.l(4)) + [('setlocal', 5)]
    code += EMPTY + [('setlocal', 6)] + z.n(0) + [('setlocal', 7)]
    code += z.l(5) + z.n(16384) + [('ifgt', 'FRAGMENT')]
    code += z.call(6, 'push', z.obj({'payload': z.l(4), 'bytes': z.l(5), 'seq': z.g(1, 'seq')}), void=True)
    code += z.l(5) + [('setlocal', 7), ('jump', 'ENQUEUE'), ('label', 'FRAGMENT')]
    code += z.n(0) + [('setlocal', 8)] + z.g(3, 'length') + [('setlocal', 14)]
    code += [('label', 'CHUNK_LOOP')] + z.l(8) + z.l(14) + [('ifge', 'CHUNKS_DONE')]
    code += z.g(6, 'length') + z.n(512) + [('ifge', 'OVERSIZE')]
    code += z.l(8) + z.n(4096) + [('add_i',), ('setlocal', 9)]
    code += z.l(9) + z.l(14) + [('ifle', 'END_READY')] + z.l(14) + [('setlocal', 9)]
    code += [('label', 'END_READY')]
    # Never split UTF-16 surrogate pairs: move a high-surrogate boundary back.
    code += z.l(9) + z.l(14) + [('ifge', 'SURROGATE_OK')]
    code += z.call(3, 'charCodeAt', z.l(9) + z.n(1) + [('subtract_i',)]) + [('setlocal', 15)]
    code += z.l(15) + z.n(55296) + [('iflt', 'SURROGATE_OK')]
    code += z.l(15) + z.n(56319) + [('ifgt', 'SURROGATE_OK')]
    code += [('declocal_i', 9), ('label', 'SURROGATE_OK')]
    code += z.call(3, 'slice', z.l(8), z.l(9)) + [('setlocal', 10)]
    code += z.static('wfxFpEnvelope', z.l(1), z.g(6, 'length'), z.n(512), z.l(10), NULL) + [('setlocal', 4)]
    code += z.static('wfxFpPacketSize', z.l(4)) + [('setlocal', 5)]
    code += z.l(5) + z.n(16384) + [('ifle', 'CHUNK_FITS')]
    code += z.l(9) + z.l(8) + [('subtract_i',)] + z.n(2) + [('divide',), ('convert_i',)]
    code += z.l(8) + [('add_i',), ('setlocal', 9), ('jump', 'END_READY'), ('label', 'CHUNK_FITS')]
    code += z.call(6, 'push', z.obj({'payload': z.l(4), 'bytes': z.l(5), 'seq': z.g(1, 'seq')}), void=True)
    code += z.l(7) + z.l(5) + [('add_i',), ('setlocal', 7)]
    code += z.l(7) + z.n(4194304) + [('ifgt', 'OVERFLOW')]
    code += z.l(9) + [('setlocal', 8), ('jump', 'CHUNK_LOOP'), ('label', 'CHUNKS_DONE')]
    code += z.g(6, 'length') + [('setlocal', 11)] + z.n(0) + [('setlocal', 12)]
    code += z.n(0) + [('setlocal', 7), ('label', 'FINAL_PARTS')]
    code += z.l(12) + z.l(11) + [('ifge', 'ENQUEUE')]
    code += z.at(6, z.l(12)) + [('setlocal', 13)]
    code += z.g(13, 'payload') + [('setlocal', 4)] + z.set(4, 'parts', z.l(11))
    code += z.static('wfxFpPacketSize', z.l(4)) + [('setlocal', 5)]
    code += z.set(13, 'bytes', z.l(5)) + z.l(7) + z.l(5) + [('add_i',), ('setlocal', 7)]
    code += [('inclocal_i', 12), ('jump', 'FINAL_PARTS'), ('label', 'ENQUEUE')]
    code += z.l(7) + z.g(1, 'queuedBytes') + [('add',)] + z.n(4194304) + [('ifgt', 'OVERFLOW')]
    code += z.g(1, 'sendQueue') + [('setlocal', 4)] + z.n(0) + [('setlocal', 12)]
    code += [('label', 'APPEND')] + z.l(12) + z.g(6, 'length') + [('ifge', 'APPENDED')]
    code += z.call(4, 'push', z.at(6, z.l(12)), void=True)
    code += [('inclocal_i', 12), ('jump', 'APPEND'), ('label', 'APPENDED')]
    code += z.set(1, 'queuedBytes', z.g(1, 'queuedBytes') + z.l(7) + [('add',)])
    code += z.set(1, 'pendingBytes', z.n(0))
    for key in ('rows', 'events', 'gaps'):
        code += z.set(1, key, EMPTY)
    code += z.set(1, 'seq', z.g(1, 'seq') + z.n(1) + [('add',)])
    code += [('pushtrue',), ('returnvalue',), ('label', 'OVERSIZE')]
    code += z.static('wfxFpTransportDrop', z.l(1), z.s('oversize'), void=True)
    code += FALSE + [('returnvalue',), ('label', 'OVERFLOW')]
    code += z.static('wfxFpTransportDrop', z.l(1), z.s('buffer_overflow'), void=True)
    code += FALSE + [('returnvalue',)]
    z.add('wfxFpPack', 'Boolean', ['Object'], code, 16)
