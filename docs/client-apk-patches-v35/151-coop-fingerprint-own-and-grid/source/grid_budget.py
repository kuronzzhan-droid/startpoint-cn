"""共享发送拒绝先触发全 Battle 升档；强制样本仍进入原有有界队列。"""
import asm
from fp_transport_codegen import Emit, BATTLE, NULL

TARGETS = ['Battle$/wfxFpReserveUplink', 'Battle$/wfxFpEnvelope']


def denied(z):
    # Uplink clock is the existing wrap-safe high-water-mark clock.
    c = [('label', 'TRY')] + z.guard()
    c += [('getlex', z.q(BATTLE)), ('getproperty', z.q('wfxFpUplink')), ('setlocal', 1)]
    c += z.l(1) + [('iffalse', 'DONE')]
    c += z.g(1, 'budgetSerial') + [('iftrue', 'EXISTING')]
    c += z.set(1, 'budgetSerial', z.n(0)) + [('jump', 'RAISE'), ('label', 'EXISTING')]
    c += z.g(1, 'clock') + z.g(1, 'budgetNextRaise') + [('iflt', 'DONE'), ('label', 'RAISE')]
    c += z.set(1, 'budgetSerial', z.g(1, 'budgetSerial') + z.n(1) + [('add',)])
    c += z.set(1, 'budgetNextRaise', z.g(1, 'clock') + z.n(1000) + [('add',)])
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'CATCH'), ('pop',), ('returnvoid',)]
    z.add('wfxFpBudgetDenied', 'void', [], c, 2,
          exceptions=[('TRY', 'CATCH', 'CATCH', 0, 0)])


def consume(z):
    # state1,battle2,uplink3,serial4,old5,next6,ctx7,event8.
    c = [('label', 'TRY')] + z.guard()
    c += [('getlex', z.q(BATTLE)), ('getproperty', z.q('wfxFpUplink')), ('setlocal', 3)]
    c += z.l(3) + [('iffalse', 'DONE')]
    c += z.g(3, 'budgetSerial') + [('setlocal', 4)]
    c += z.l(4) + [('iffalse', 'DONE')]
    c += z.g(1, 'sampleBudgetSerial') + z.l(4) + [('ifeq', 'DONE')]
    c += z.set(1, 'sampleBudgetSerial', z.l(4))
    c += z.set(1, 'sampleLowCount', z.n(0))
    c += z.g(1, 'sampleInterval') + [('setlocal', 5)]
    c += z.l(5) + z.n(2) + [('multiply',), ('convert_i',), ('setlocal', 6)]
    c += z.l(6) + z.n(240) + [('ifle', 'CAPPED')]
    c += z.n(240) + [('setlocal', 6), ('label', 'CAPPED')]
    c += z.l(5) + z.l(6) + [('ifeq', 'DONE')]
    c += z.set(1, 'sampleInterval', z.l(6))
    c += z.g(1, 'ctx') + [('setlocal', 7)]
    c += z.obj(dict(eventId=z.g(7, 'eventId'), stage=z.s('lifecycle'),
        battleId=z.g(2, 'initialData') + [('getproperty', z.q('id'))],
        battleEpoch=z.g(1, 'battleEpoch'), targetFrame=z.g(2, 'currentFrame'),
        sourceBattleId=NULL, sourceBattleEpoch=NULL, sourceFrame=NULL, command=NULL,
        detail=z.obj(dict(reason=z.s('throttle'), cause=z.s('uplink_budget'),
                         previousInterval=z.l(5), interval=z.l(6), elapsedMs=NULL,
                         budgetSerial=z.l(4))))) + [('setlocal', 8)]
    c += z.set(7, 'eventCursor', z.g(7, 'eventId'))
    c += z.set(7, 'eventId', z.g(7, 'eventId') + z.n(1) + [('add',)])
    c += z.static('wfxFpQueue', z.l(7), z.s('events'), z.l(8), void=True)
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'CATCH'), ('pop',), ('returnvoid',)]
    z.add('wfxFpBudgetGrid', 'void', ['Object', BATTLE], c, 9,
          exceptions=[('TRY', 'CATCH', 'CATCH', 0, 0)])


def build(editor):
    z = Emit(editor)
    denied(z)
    consume(z)
    ins = asm.decode(editor.body(TARGETS[0])[5])
    ends = [i for i, op in enumerate(ins) if op.name == 'pushfalse' and
            i + 1 < len(ins) and ins[i + 1].name == 'returnvalue']
    assert len(ends) == 1, 'unknown reserve-denial block'
    editor.insert(TARGETS[0], ends[0], z.static('wfxFpBudgetDenied', void=True))
    ins = asm.decode(editor.body(TARGETS[1])[5])
    builds = [i for i, op in enumerate(ins) if op.name == 'pushstring' and
              editor.abc.strings[op.args[0]] == b'v35r']
    assert len(builds) == 1, 'unknown build marker'
    editor.insert(TARGETS[1], builds[0] + 1, [('pop',)] + z.s('v35s'))
    return dict(bytes_per_rolling_second=20000, scope='all Battle/all contexts',
                pressure_cooldown_ms=1000, mandatory_rows='sample and queue',
                overflow='inherited explicit gap; no silent drop')
