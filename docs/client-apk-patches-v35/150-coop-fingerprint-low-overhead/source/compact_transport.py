"""全客户端共享的一秒滑动窗；沿用 run17 的最终 UTF-8 分片。"""
import asm
from fp_transport_codegen import Emit, BATTLE, TRUE, FALSE
from compact_sampling import timer

TARGETS = ['Battle$/wfxFpDrain', 'Battle$/wfxFpEnvelope']


def reserve(z):
    # bytes1,now2,state3,delta4,entries5,entry6,clock7.
    c = timer(z) + [('setlocal', 2)]
    c += [('getlex', z.q(BATTLE)), ('getproperty', z.q('wfxFpUplink')), ('setlocal', 3)]
    c += z.l(3) + [('iftrue', 'READY')]
    c += z.obj(dict(entries=z.arr(), bytes=z.n(0), lastTimer=z.l(2), clock=z.n(0))) + [('setlocal', 3)]
    c += [('getlex', z.q(BATTLE))] + z.l(3) + [('setproperty', z.q('wfxFpUplink'))]
    c += [('label', 'READY')]
    c += z.l(2) + z.g(3, 'lastTimer') + [('subtract',), ('setlocal', 4)]
    # Preserve the high-water mark on small regressions; otherwise returning to
    # that mark would double-count time. Signed int32 getTimer wrap is unwrapped.
    c += z.l(4) + z.n(0) + [('ifge', 'ADVANCE')]
    c += z.l(4) + z.n(-2147483648) + [('iflt', 'WRAP')]
    c += z.n(0) + [('setlocal', 4), ('jump', 'TIME_OK'), ('label', 'WRAP')]
    c += z.l(4) + z.n(4294967296) + [('add',), ('setlocal', 4)]
    c += [('label', 'ADVANCE')] + z.set(3, 'lastTimer', z.l(2))
    c += [('label', 'TIME_OK')]
    c += z.g(3, 'clock') + z.l(4) + [('add',), ('setlocal', 7)]
    c += z.set(3, 'clock', z.l(7)) + z.g(3, 'entries') + [('setlocal', 5)]
    c += [('label', 'EXPIRE')] + z.g(5, 'length') + [('iffalse', 'CHECK')]
    c += z.at(5, z.n(0)) + [('setlocal', 6)]
    c += z.l(7) + z.g(6, 'at') + [('subtract',)] + z.n(1000) + [('iflt', 'CHECK')]
    c += z.set(3, 'bytes', z.g(3, 'bytes') + z.g(6, 'bytes') + [('subtract_i',)])
    c += z.call(5, 'shift', void=True) + [('jump', 'EXPIRE'), ('label', 'CHECK')]
    c += z.l(1) + z.n(0) + [('ifle', 'DENY')]
    c += z.g(3, 'bytes') + z.l(1) + [('add_i',)] + z.n(20000) + [('ifgt', 'DENY')]
    c += z.call(5, 'push', z.obj(dict(at=z.l(7), bytes=z.l(1))), void=True)
    c += z.set(3, 'bytes', z.g(3, 'bytes') + z.l(1) + [('add_i',)])
    c += TRUE + [('returnvalue',), ('label', 'DENY')] + FALSE + [('returnvalue',)]
    z.add('wfxFpReserveUplink', 'Boolean', ['int'], c, 8)


def drain(z):
    # ctx1,tx2,queue3,entry4,socket5,generation6.
    c = z.guard() + z.l(1) + [('iffalse', 'DONE')]
    c += z.g(1, 'closed') + [('iftrue', 'DONE')]
    c += z.g(1, 'sendQueue') + [('setlocal', 3)]
    c += z.g(3, 'length') + [('iffalse', 'DONE')]
    c += z.g(1, 'transmitter') + [('setlocal', 2)] + z.l(2) + [('iffalse', 'DONE')]
    c += z.g(2, 'socketDriver') + [('getproperty', z.q('sendFailsSocket')), ('iftrue', 'DONE')]
    c += z.g(2, 'connection') + [('getproperty', z.q('connection')), ('setlocal', 5)]
    c += z.l(5) + [('iffalse', 'DONE')] + z.g(5, 'established') + [('iffalse', 'DONE')]
    c += [('label', 'LOOP')] + z.g(3, 'length') + [('iffalse', 'DONE')]
    c += z.at(3, z.n(0)) + [('setlocal', 4)]
    c += z.static('wfxFpReserveUplink', z.g(4, 'bytes')) + [('iffalse', 'DONE')]
    # RealBattleTransmitter.sendToServer can enqueue a RandomDelayCommandQueue.
    # Diagnostic markers use the existing marker-only sender synchronously so
    # a deferred queue cannot bunch previously reserved bytes into a later second.
    notification = z.obj(dict(index=z.n(0), params=z.arr(z.obj(dict(
        index=z.n(5), params=z.arr(z.g(4, 'payload')))))))
    c += z.g(1, 'generation') + [('setlocal', 6)]
    c += z.static('wfxFpTrySend', z.g(2, 'connection'), notification) + [('pop',)]
    # Reserve before send. Errors keep the reservation (conservative limit).
    c += z.g(1, 'generation') + z.l(6) + [('ifne', 'DONE')]
    c += z.set(1, 'queuedBytes', z.g(1, 'queuedBytes') + z.g(4, 'bytes') + [('subtract_i',)])
    c += z.call(3, 'shift', void=True) + [('jump', 'LOOP'), ('label', 'DONE'), ('returnvoid',)]
    z.add('wfxFpDrainLimited', 'void', ['Object'], c, 7)


def build(editor):
    z = Emit(editor)
    editor.add_slot(BATTLE, 'wfxFpUplink', 'Object', static=True)
    reserve(z)
    drain(z)
    editor.insert(TARGETS[0], 2, z.static('wfxFpDrainLimited', z.l(1), void=True) + [('returnvoid',)])
    ins = asm.decode(editor.body(TARGETS[1])[5])
    assert ins[7].name == 'pushstring' and editor.abc.strings[ins[7].args[0]] == b'coop-state-fingerprint-v1'
    assert ins[11].name == 'pushstring' and editor.abc.strings[ins[11].args[0]] == b'v35q'
    editor.insert(TARGETS[1], 8, [('pop',)] + z.s('coop-state-fingerprint-compact-v2'))
    editor.insert(TARGETS[1], 12, [('pop',)] + z.s('v35r'))
    return dict(bytes_per_second=20000, window_ms=1000, scope='whole client across all contexts',
                bytes='actual outer UTF-8 plus XMLSocket NUL',
                fragmentation='run17 unchanged', budget_preserved_across_off_and_reconnect=True)
