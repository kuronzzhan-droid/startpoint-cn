"""v35p诊断传输：原队列通知、marker旁路、限速及离场刷新。"""
import asm
from fp_transport_codegen import BATTLE, Emit, NULL, TRUE, FALSE
from fp_transport_packets import add_packet_helpers

TARGETS = ['BattleConnection/send', 'BattleSocketContact/leavingSceneHandler',
           'BattleSocketContact/discardSocket', 'SockletConnection/close']
TRANSMITTER = 'pinball.context.socket.battle::RealBattleTransmitter'
NOTIFY = 'pinball.online.battle.message::BattleNotifyMessage'


def add_binding(z):
    z.e.add_slot(BATTLE, 'wfxFpConnections', 'haxe.ds::WeakMap', static=True)
    # ctx1,scene2,option3,transmitter4,connection5,map6,sock7.
    code = z.guard() + z.l(1) + [('iffalse', 'DONE')]
    code += z.g(1, 'closed') + [('iftrue', 'DONE')]
    code += z.g(1, 'scene') + [('setlocal_2',)] + z.l(2) + [('iffalse', 'DONE')]
    code += z.g(2, 'battleTransmitter') + [('setlocal_3',)]
    code += z.l(3) + [('iffalse', 'DONE')] + z.g(3, 'index') + z.n(0) + [('ifne', 'DONE')]
    code += z.g(3, 'params') + [('setlocal_3',)] + z.at(3, z.n(0)) + [('setlocal', 4)]
    code += z.l(4) + [('istype', z.q(TRANSMITTER)), ('iffalse', 'DONE')]
    code += z.g(4, 'connection') + [('setlocal', 5)] + z.l(5) + [('iffalse', 'DONE')]
    code += z.g(5, 'connection') + [('setlocal', 7)]
    code += z.g(1, 'connection') + [('iffalse', 'SAME')]
    code += z.g(1, 'connection') + z.l(5) + [('ifne', 'REPLACED')]
    code += z.g(1, 'socket') + [('iffalse', 'SAME')]
    code += z.g(1, 'socket') + z.l(7) + [('ifeq', 'SAME'), ('label', 'REPLACED')]
    code += z.static('wfxFpUnbindConnection', z.l(1), void=True)
    code += z.static('wfxFpRelease', z.l(2), void=True) + [('jump', 'DONE'), ('label', 'SAME')]
    code += z.set(1, 'connection', z.l(5)) + z.set(1, 'transmitter', z.l(4)) + z.set(1, 'socket', z.l(7))
    code += [('getlex', z.q(BATTLE)), ('getproperty', z.q('wfxFpConnections')), ('setlocal', 6)]
    code += z.l(6) + [('iftrue', 'MAP')]
    code += [('getlex', z.q('haxe.ds::WeakMap')), ('construct', 0), ('setlocal', 6)]
    code += [('getlex', z.q(BATTLE))] + z.l(6) + [('setproperty', z.q('wfxFpConnections'))]
    code += [('label', 'MAP')] + z.call(6, 'set', z.l(5), z.l(1), void=True)
    code += z.l(7) + [('iffalse', 'CONTACT')]
    code += z.call(6, 'set', z.l(7), z.l(1), void=True)
    code += [('label', 'CONTACT')] + z.g(2, 'battleSocketContact') + [('setlocal', 7)]
    code += z.l(7) + [('iffalse', 'DONE')] + z.call(6, 'set', z.l(7), z.l(1), void=True)
    code += [('label', 'DONE'), ('returnvoid',)]
    z.add('wfxFpBindConnection', 'void', ['Object'], code, 8)


def add_unbinding(z):
    # Cleanup is permitted while OFF; it neither samples nor sends.
    code = z.l(1) + [('iffalse', 'DONE'), ('getlex', z.q(BATTLE)),
        ('getproperty', z.q('wfxFpConnections')), ('setlocal_2',)]
    code += z.l(2) + [('iffalse', 'CLEAR')]
    code += z.g(1, 'connection') + [('setlocal_3',)] + z.l(3) + [('iffalse', 'SCENE')]
    code += z.call(2, 'remove', z.l(3), void=True)
    code += z.g(1, 'socket') + [('setlocal_3',)] + z.l(3) + [('iffalse', 'SCENE')]
    code += z.call(2, 'remove', z.l(3), void=True)
    code += [('label', 'SCENE')] + z.g(1, 'scene') + [('setlocal_3',)]
    code += z.l(3) + [('iffalse', 'CLEAR')]
    code += z.g(3, 'battleSocketContact') + [('setlocal_3',)] + z.l(3) + [('iffalse', 'CLEAR')]
    code += z.call(2, 'remove', z.l(3), void=True)
    code += [('label', 'CLEAR')] + z.set(1, 'connection', NULL) + z.set(1, 'transmitter', NULL) + z.set(1, 'socket', NULL)
    code += [('label', 'DONE'), ('returnvoid',)]
    z.add('wfxFpUnbindConnection', 'void', ['Object'], code, 4)


def add_drain(z):
    # ctx1,now2,elapsed3,tokens4,transmitter5,queue6,entry7,sock8,generation9.
    code = z.guard() + z.g(1, 'closed') + [('iftrue', 'DONE')]
    code += [('findpropstrict', z.q('flash.utils::getTimer')),
             ('callproperty', z.q('flash.utils::getTimer'), 0), ('setlocal_2',)]
    code += z.l(2) + z.g(1, 'lastTimer') + [('subtract',), ('setlocal_3',)]
    code += z.set(1, 'lastTimer', z.l(2))
    code += z.l(3) + z.n(0) + [('ifge', 'TIME_OK')] + z.n(0) + [('setlocal_3',)]
    code += [('label', 'TIME_OK')] + z.g(1, 'tokens') + z.l(3) + z.n(65536)
    code += [('multiply',)] + z.n(1000) + [('divide',), ('add',), ('setlocal', 4)]
    code += z.l(4) + z.n(16384) + [('ifle', 'TOKENS_OK')] + z.n(16384) + [('setlocal', 4)]
    code += [('label', 'TOKENS_OK')] + z.set(1, 'tokens', z.l(4))
    code += z.g(1, 'transmitter') + [('setlocal', 5)] + z.l(5) + [('iffalse', 'DONE')]
    code += z.g(5, 'socketDriver') + [('getproperty', z.q('sendFailsSocket')), ('iftrue', 'DONE')]
    code += z.g(5, 'connection') + [('getproperty', z.q('connection')), ('setlocal', 8)]
    code += z.l(8) + [('iffalse', 'DONE')] + z.g(8, 'established') + [('iffalse', 'DONE')]
    code += z.g(1, 'sendQueue') + [('setlocal', 6), ('label', 'LOOP')]
    code += z.g(6, 'length') + [('iffalse', 'DONE')]
    code += z.at(6, z.n(0)) + [('setlocal', 7)]
    code += z.g(7, 'bytes') + z.g(1, 'tokens') + [('ifgt', 'DONE')]
    notification = [('getlex', z.q(NOTIFY))] + z.s('Heartbeat') + z.n(5)
    notification += z.arr(z.g(7, 'payload')) + [('construct', 3)]
    code += z.g(1, 'generation') + [('setlocal', 9)]
    code += z.call(5, 'notify', notification, void=True)
    # The marker-only send catch may replace the queue with a recovery gap.
    # Never keep draining the stale local array after that chain is invalidated.
    code += z.g(1, 'generation') + z.l(9) + [('ifne', 'DONE')]
    code += z.set(1, 'tokens', z.g(1, 'tokens') + z.g(7, 'bytes') + [('subtract',)])
    code += z.set(1, 'queuedBytes', z.g(1, 'queuedBytes') + z.g(7, 'bytes') + [('subtract_i',)])
    code += z.call(6, 'shift', void=True) + [('jump', 'LOOP'), ('label', 'DONE'), ('returnvoid',)]
    z.add('wfxFpDrain', 'void', ['Object'], code, 10)


def add_flush(z):
    # Only diagnostic operations are caught. Original caller instructions remain
    # outside this method's handler, preserving business exception propagation.
    code = z.guard() + z.l(1) + [('iffalse', 'DONE')]
    code += z.g(1, 'closed') + [('iftrue', 'DONE'), ('label', 'TRY')]
    code += z.static('wfxFpBindConnection', z.l(1), void=True)
    code += z.g(1, 'closed') + [('iftrue', 'DONE')]
    code += z.static('wfxFpPack', z.l(1)) + [('iftrue', 'PACKED')]
    code += z.static('wfxFpPack', z.l(1), void=True)
    code += [('label', 'PACKED')] + z.static('wfxFpDrain', z.l(1), void=True)
    code += [('label', 'END'), ('jump', 'DONE'), ('label', 'CATCH'), ('pop',), ('getlocal_0',), ('pushscope',)]
    code += z.static('wfxFpTransportDrop', z.l(1), z.s('sampling_error'), void=True)
    code += [('label', 'DONE'), ('returnvoid',)]
    z.add('wfxFpFlush', 'void', ['Object', 'Boolean'], code, 3,
          exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def add_close(z):
    # One map supports contact-level leave/discard and low-level socket.close.
    code = z.guard() + [('label', 'TRY'), ('getlex', z.q(BATTLE)),
        ('getproperty', z.q('wfxFpConnections')), ('setlocal_2',)]
    code += z.l(2) + [('iffalse', 'DONE')]
    code += z.call(2, 'get', z.l(1)) + [('setlocal_3',)] + z.l(3) + [('iffalse', 'DONE')]
    code += z.g(3, 'closed') + [('iftrue', 'DONE')]
    code += z.static('wfxFpFlush', z.l(3), TRUE, void=True)
    code += z.g(3, 'scene') + [('setlocal', 4)]
    code += z.l(4) + [('iffalse', 'DONE')]
    code += z.static('wfxFpUnbindConnection', z.l(3), void=True)
    code += z.static('wfxFpRelease', z.l(4), void=True)
    code += [('label', 'END'), ('jump', 'DONE'), ('label', 'CATCH'), ('pop',), ('getlocal_0',), ('pushscope',),
             ('label', 'DONE'), ('returnvoid',)]
    z.add('wfxFpClose', 'void', ['Object'], code, 6,
          exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def add_sender(z):
    # args BattleConnection1,Client2Server2; notify3,params4,payload5,marker6,map7,ctx8.
    code = FALSE + [('setlocal', 6), ('label', 'TRY')] + z.g(2, 'index') + z.n(0) + [('ifne', 'ORDINARY')]
    code += z.g(2, 'params') + [('setlocal_3',)] + z.at(3, z.n(0)) + [('setlocal_3',)]
    code += z.g(3, 'index') + z.n(5) + [('ifne', 'ORDINARY')]
    code += z.g(3, 'params') + [('setlocal', 4)] + z.l(4) + [('iffalse', 'ORDINARY')]
    code += z.g(4, 'length') + z.n(1) + [('ifne', 'ORDINARY')]
    code += z.at(4, z.n(0)) + [('setlocal', 5)] + z.l(5) + [('iffalse', 'ORDINARY')]
    code += z.g(5, 'kind') + z.s('wf-fp') + [('ifne', 'ORDINARY')]
    code += TRUE + [('setlocal', 6)]
    # OFF consumes already queued diagnostic markers without sending an ACK
    # polluting ordinary heartbeat through the native simplifier.
    code += z.guard('DISABLED')
    code += z.g(1, 'connection') + z.json(z.arr(z.n(0), z.arr(z.n(5), z.l(5))))
    code += [('callpropvoid', z.q('send'), 1), ('label', 'END'), ('label', 'HANDLED')]
    code += TRUE + [('returnvalue',), ('label', 'ORDINARY')] + FALSE + [('returnvalue',)]
    code += [('label', 'DISABLED')] + z.static('wfxFpDisabled', void=True)
    code += TRUE + [('returnvalue',)]
    code += [('label', 'CATCH'), ('pop',), ('getlocal_0',), ('pushscope',)]
    code += z.l(6) + [('iffalse', 'ORDINARY')]
    code += [('getlex', z.q(BATTLE)), ('getproperty', z.q('wfxFpConnections')), ('setlocal', 7)]
    code += z.l(7) + [('iffalse', 'HANDLED')]
    code += z.call(7, 'get', z.l(1)) + [('setlocal', 8)]
    code += z.l(8) + [('iffalse', 'HANDLED')]
    code += z.static('wfxFpTransportDrop', z.l(8), z.s('sampling_error'), void=True)
    code += [('jump', 'HANDLED')]
    z.add('wfxFpTrySend', 'Boolean', ['Object', 'Object'], code, 9,
          exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def build(editor):
    z = Emit(editor)
    add_packet_helpers(z)
    add_unbinding(z)
    add_binding(z)
    add_drain(z)
    add_flush(z)
    add_close(z)
    add_sender(z)
    for label in TARGETS:
        original = asm.decode(editor.body(label)[5])
        assert original[0].name == 'getlocal_0' and original[1].name == 'pushscope'
        if label == 'BattleConnection/send':
            code = z.static('wfxFpTrySend', z.l(0), z.l(1))
            code += [('iffalse', 'OLD'), ('returnvoid',), ('label', 'OLD')]
        else:
            code = z.static('wfxFpClose', z.l(0), void=True)
        editor.insert(label, 2, code)
    return {'targets': TARGETS, 'max_packet_bytes': 16384,
            'max_buffer_bytes': 4194304, 'bytes_per_second': 65536,
            'burst_bytes': 16384, 'snapshot_source': 'ctx immutable diagnostic records'}
