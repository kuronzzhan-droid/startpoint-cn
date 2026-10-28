"""run17：最大化有界分片，原方法仅可逆插入；字段和采样不变。"""
import asm
import oversize_diag
from fp_transport_codegen import Emit, NULL

TARGETS = ['Battle$/wfxFpPack', 'Battle$/wfxFpEnvelope']


def chunk_end(z):
    # text1, offset2, context3, part4; lo5 hi6 mid7 payload8 size9 code10.
    # Binary search the actual escaped outer JSON size, reserving parts=512.
    c = z.l(2) + [('setlocal', 5)]
    c += z.l(2) + z.n(16384) + [('add_i',), ('setlocal', 6)]
    c += z.l(6) + z.g(1, 'length') + [('ifle', 'BOUNDED')]
    c += z.g(1, 'length') + [('setlocal', 6), ('label', 'BOUNDED')]
    c += [('label', 'LOOP')] + z.l(5) + z.l(6) + [('ifge', 'DONE')]
    c += z.l(5) + z.l(6) + [('add_i',)] + z.n(1) + [('add_i',)] + z.n(2)
    c += [('divide',), ('convert_i',), ('setlocal', 7)]
    c += z.l(7) + [('setlocal', 10)]
    c += z.l(7) + z.g(1, 'length') + [('ifge', 'PAIR_OK')]
    c += z.call(1, 'charCodeAt', z.l(7) + z.n(1) + [('subtract_i',)]) + [('setlocal', 9)]
    c += z.l(9) + z.n(55296) + [('iflt', 'PAIR_OK')]
    c += z.l(9) + z.n(56319) + [('ifgt', 'PAIR_OK')]
    c += [('declocal_i', 7), ('label', 'PAIR_OK')]
    c += z.static('wfxFpEnvelope', z.l(3), z.l(4), z.n(512),
                  z.call(1, 'slice', z.l(2), z.l(7)), NULL) + [('setlocal', 8)]
    c += z.static('wfxFpPacketSize', z.l(8)) + z.n(16384) + [('ifgt', 'LARGE')]
    c += z.l(10) + [('setlocal', 5), ('jump', 'LOOP'), ('label', 'LARGE')]
    c += z.l(10) + z.n(1) + [('subtract_i',), ('setlocal', 6), ('jump', 'LOOP'), ('label', 'DONE')]
    # The original packer already moves high-surrogate end boundaries back;
    # keep that one adjustment and its exact final byte measurement unchanged.
    c += z.l(5) + [('returnvalue',)]
    z.add('wfxFpChunkEnd', 'int', ['String','int','Object','int'], c, 11)


def build(e):
    z = Emit(e)
    chunk_end(z)
    oversize_diag.add(z)
    ins = asm.decode(e.body(TARGETS[0])[5])
    # After existing offset+4096 computation: discard that end and choose the
    # largest fitting chunk. All original instructions remain reversible.
    assert ins[84].name == 'pushint' and e.abc.ints[ins[84].args[0]] == 4096
    assert ins[86].name == 'setlocal' and ins[86].args == [9]
    assert ins[252].name == 'callpropvoid' and e.abc.mn_name(ins[252].args[0]) == 'wfxFpTransportDrop'
    e.insert(TARGETS[0], 253, z.static('wfxFpOversizeInfo', z.l(1), z.l(3), z.l(6), void=True))
    e.insert(TARGETS[0], 86, [('pop',)] + z.static('wfxFpChunkEnd', z.l(3), z.l(8), z.l(1), z.g(6,'length')))
    ins = asm.decode(e.body(TARGETS[1])[5])
    assert ins[10].name == 'pushstring' and e.abc.strings[ins[9].args[0]] == b'v35p'
    e.insert(TARGETS[1], 10, [('pop',)] + z.s('v35q'))
    return {'targets': TARGETS, 'max_packet_bytes_with_nul':16384, 'parts_limit':512,
            'logical_limit':4194304,'queue_limit':4194304,'max_utf16_search_window':16384,
            'sampling_changed':False,'rng_changed':False}
