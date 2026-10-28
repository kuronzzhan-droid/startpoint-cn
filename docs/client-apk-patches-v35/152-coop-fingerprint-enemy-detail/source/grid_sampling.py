"""绝对网格与状态边沿采样；只写诊断上下文。"""
from fp_transport_codegen import Emit, BATTLE, NULL, TRUE, FALSE

TARGETS = ['Battle$/wfxFpSampleCompact', 'Battle$/wfxFpAdapt']


def timer(z):
    return [('findpropstrict', z.q('flash.utils::getTimer')),
            ('callproperty', z.q('flash.utils::getTimer'), 0)]


def adaptive(z):
    # state1, elapsed2, battle3, old4, next5, ctx6, event7.
    c = [('label', 'TRY')] + z.guard()
    c += z.g(1, 'sampleInterval') + [('setlocal', 4)]
    c += z.l(4) + [('setlocal', 5)]
    c += z.l(2) + z.n(0) + [('iflt', 'RESET')]
    c += z.l(2) + z.n(2) + [('ifle', 'LOW')]
    c += z.set(1, 'sampleLowCount', z.n(0))
    c += z.l(4) + z.n(2) + [('multiply',), ('convert_i',), ('setlocal', 5)]
    c += z.l(5) + z.n(240) + [('ifle', 'CHANGED')]
    c += z.n(240) + [('setlocal', 5), ('jump', 'CHANGED'), ('label', 'LOW')]
    # Do not recover cadence while encoded mandatory checkpoints remain queued.
    c += z.g(1, 'ctx') + [('getproperty', z.q('queuedBytes'))] + z.n(0) + [('ifgt', 'RESET')]
    c += z.l(2) + z.n(0.5) + [('ifge', 'RESET')]
    c += z.set(1, 'sampleLowCount', z.g(1, 'sampleLowCount') + z.n(1) + [('add_i',)])
    c += z.g(1, 'sampleLowCount') + z.n(8) + [('iflt', 'DONE')]
    c += z.set(1, 'sampleLowCount', z.n(0))
    c += z.l(4) + z.n(2) + [('divide',), ('convert_i',), ('setlocal', 5)]
    c += z.l(5) + z.n(30) + [('ifge', 'CHANGED')]
    c += z.n(30) + [('setlocal', 5), ('jump', 'CHANGED'), ('label', 'RESET')]
    c += z.set(1, 'sampleLowCount', z.n(0)) + [('jump', 'DONE'), ('label', 'CHANGED')]
    c += z.l(4) + z.l(5) + [('ifne', 'EMIT')]
    c += z.l(2) + z.n(2) + [('ifle', 'DONE'), ('label', 'EMIT')]
    c += z.set(1, 'sampleInterval', z.l(5))
    c += z.g(1, 'ctx') + [('setlocal', 6)]
    c += z.obj(dict(eventId=z.g(6, 'eventId'), stage=z.s('lifecycle'),
        battleId=z.g(3, 'initialData') + [('getproperty', z.q('id'))],
        battleEpoch=z.g(1, 'battleEpoch'), targetFrame=z.g(3, 'currentFrame'),
        sourceBattleId=NULL, sourceBattleEpoch=NULL, sourceFrame=NULL, command=NULL,
        detail=z.obj(dict(reason=z.s('throttle'), previousInterval=z.l(4),
                         interval=z.l(5), elapsedMs=z.l(2))))) + [('setlocal', 7)]
    c += z.set(6, 'eventCursor', z.g(6, 'eventId'))
    c += z.set(6, 'eventId', z.g(6, 'eventId') + z.n(1) + [('add',)])
    c += z.static('wfxFpQueue', z.l(6), z.s('events'), z.l(7), void=True)
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'CATCH'), ('pop',), ('returnvoid',)]
    z.add('wfxFpAdaptGrid', 'void', ['Object', 'Number', BATTLE], c, 8,
          exceptions=[('TRY', 'CATCH', 'CATCH', 0, 0)])


def sample(z):
    # b1,initial2,state3,ctx4,snap5,row6,frame7,start8,end9,generation10,previous11,stateIndex12,changed13.
    c = NULL + [('setlocal', 4)] + NULL + [('setlocal', 8), ('label', 'TRY')]
    c += z.guard('OFF')
    c += [('getlex', z.q(BATTLE)), ('getproperty', z.q('wfxFpBattles')), ('setlocal', 3)]
    c += z.l(3) + [('iffalse', 'DONE')]
    c += z.call(3, 'get', z.l(1)) + [('setlocal', 3)]
    c += z.l(3) + [('iffalse', 'DONE')]
    c += z.g(3, 'ctx') + [('setlocal', 4)]
    c += z.g(4, 'closed') + [('iftrue', 'DONE')]
    c += z.g(1, 'currentFrame') + [('setlocal', 7)]
    c += z.g(3, 'sampleInterval') + [('iftrue', 'READY')]
    c += z.set(3, 'sampleInterval', z.n(30)) + z.set(3, 'sampleLowCount', z.n(0))
    c += [('label', 'READY')]
    c += z.l(2) + [('iffalse', 'OBSERVE')]
    c += z.g(3, 'started') + [('iftrue', 'DONE'), ('label', 'OBSERVE')]
    c += z.static('wfxFpBudgetGrid', z.l(3), z.l(1), void=True)
    c += z.g(1, 'state') + [('getproperty', z.q('index')), ('setlocal', 12)]
    c += FALSE + [('setlocal', 13)]
    c += z.g(3, 'sampleStateKnown') + [('iffalse', 'STORE_STATE')]
    c += z.l(12) + z.g(3, 'sampleObservedState') + [('ifeq', 'STORE_STATE')]
    c += TRUE + [('setlocal', 13), ('label', 'STORE_STATE')]
    # Remember every observed post state, including failed snapshot attempts.
    c += z.set(3, 'sampleObservedState', z.l(12)) + z.set(3, 'sampleStateKnown', TRUE)
    c += z.g(3, 'started') + [('iffalse', 'SAMPLE')]
    c += z.l(13) + [('iftrue', 'SAMPLE')]
    c += z.l(7) + z.g(3, 'previousFrame') + [('ifeq', 'DRAIN')]
    c += z.l(7) + z.n(240) + [('modulo',)] + z.n(0) + [('ifeq', 'SAMPLE')]
    c += z.l(7) + z.g(3, 'sampleInterval') + [('modulo',)] + z.n(0) + [('ifne', 'DRAIN')]
    c += [('label', 'SAMPLE')] + timer(z) + [('setlocal', 8)]
    c += z.g(3, 'previousFrame') + [('setlocal', 11)]
    c += z.set(3, 'previousFrame', z.l(7)) + z.set(3, 'started', TRUE)
    c += z.g(4, 'generation') + [('setlocal', 10)]
    c += z.static('wfxFpCompactSnapshot', z.l(1)) + [('setlocal', 5)]
    c += z.l(5) + [('iftrue', 'SNAPSHOT_OK')] + z.s('missing diagnostic snapshot') + [('throw',), ('label', 'SNAPSHOT_OK')]
    c += z.obj(dict(battleId=z.g(1, 'initialData') + [('getproperty', z.q('id'))],
        battleEpoch=z.g(3, 'battleEpoch'), postFrame=z.l(7), phase=z.s('post'),
        zone=z.g(1, 'currentZoneIndex'), floor=z.g(1, 'floor'), mode=z.s('full'),
        values=z.g(5, 'values'), unsupported=z.g(5, 'unsupported'),
        inputSummary=z.static('wfxFpTakeInputSummary', z.l(3)),
        routeSummary=z.static('wfxFpTakeRouteSummary', z.l(4)),
        sampleInterval=z.g(3, 'sampleInterval'), previousCheckpointFrame=z.l(11),
        eventCursor=z.g(4, 'eventCursor'))) + [('setlocal', 6)]
    c += z.l(2) + [('iffalse', 'APPEND')]
    c += z.set(6, 'phase', z.s('initial'))
    c += z.l(7) + z.n(0) + [('ifeq', 'APPEND')]
    c += z.static('wfxFpGap', z.l(4), z.s('initial_missing'), z.n(0),
                  z.l(7) + z.n(1) + [('subtract_i',)], void=True)
    c += [('label', 'APPEND')]
    c += z.static('wfxFpQueue', z.l(4), z.s('rows'), z.l(6), void=True)
    c += z.set(3, 'previous', NULL) + z.set(3, 'generation', z.l(10))
    c += z.static('wfxFpFlush', z.l(4), FALSE, void=True)
    c += timer(z) + [('setlocal', 9)]
    c += z.static('wfxFpAdapt', z.l(3), z.l(9) + z.l(8) + [('subtract',)], z.l(1), void=True)
    c += [('jump', 'DONE'), ('label', 'DRAIN')]
    c += z.static('wfxFpDrain', z.l(4), void=True) + [('jump', 'DONE'), ('label', 'OFF')]
    c += z.static('wfxFpDisabled', void=True)
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'CATCH'), ('pop',)]
    c += [('getlocal_0',), ('pushscope',), ('label', 'RECOVER')]
    c += z.l(4) + [('iffalse', 'FAILEND')]
    c += z.static('wfxFpGap', z.l(4), z.s('sampling_error'), NULL, NULL, void=True)
    c += z.l(8) + NULL + [('ifeq', 'FAILEND')]
    c += z.static('wfxFpAdapt', z.l(3), timer(z) + z.l(8) + [('subtract',)], z.l(1), void=True)
    c += [('label', 'FAILEND'), ('returnvoid',), ('label', 'RECOVERY_CATCH'), ('pop',), ('returnvoid',)]
    z.add('wfxFpSampleGrid', 'void', [BATTLE, 'Boolean'], c, 14,
          exceptions=[('TRY', 'CATCH', 'CATCH', 0, 0),
                      ('RECOVER', 'RECOVERY_CATCH', 'RECOVERY_CATCH', 0, 0)])


def build(editor):
    z = Emit(editor)
    adaptive(z)
    sample(z)
    editor.insert(TARGETS[0], 2, z.static('wfxFpSampleGrid', z.l(1), z.l(2), void=True) + [('returnvoid',)])
    editor.insert(TARGETS[1], 2, z.static('wfxFpAdaptGrid', z.l(1), z.l(2), z.l(3), void=True) + [('returnvoid',)])
    return dict(intervals=[30, 60, 120, 240], absolute_grid=True, mandatory_grid=240,
                state_edges='all state.index changes', recover_consecutive_samples=8)
