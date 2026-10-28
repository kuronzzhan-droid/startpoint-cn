"""按场景/Battle身份隔离诊断缓存；原游戏对象只读。"""
from fp_emit import BATTLE, Ops, local as L, NULL, TRUE, FALSE, ARRAY, OBJECT, PROLOGUE


def add_slots(e, enabled_default=True):
    enabled = e.add_slot(BATTLE, 'wfxFpEnabled', 'Boolean', static=True)
    ci, _ = e.instance(BATTLE)
    trait = next(t for t in e.abc.classes[ci][1] if t.name == enabled)
    trait.data[3:5] = [1, 0x0B if enabled_default else 0x0A]  # AVM2 Boolean default.
    for name, typ in [('wfxFpScenes', 'haxe.ds::WeakMap'),
                      ('wfxFpBattles', 'haxe.ds::WeakMap'),
                      ('wfxFpEpoch', 'Number'), ('wfxFpWasDisabled', 'Boolean'),
                      ('wfxFpReadFailed', 'Boolean')]:
        e.add_slot(BATTLE, name, typ, static=True)
    # Protocol counters are safe nonnegative integers, not wrapping int32.
    zero = next((i for i, value in enumerate(e.abc.doubles) if i and value == 0.0), None)
    if zero is None:
        e.abc.doubles.append(0.0)
        zero = len(e.abc.doubles) - 1
    epoch = next(t for t in e.abc.classes[ci][1] if e.abc.mn_name(t.name) == 'wfxFpEpoch')
    epoch.data[3:5] = [zero, 0x06]


def context(e):
    o = Ops(e)
    weak = [('getlex', e.q('haxe.ds::WeakMap')), ('construct', 0)]
    # scene1, scenes2, option3, connection4, context5.
    c = PROLOGUE + NULL + [('setlocal', 5), ('label', 'TRY')]
    c += o.slot('wfxFpEnabled') + [('iffalse', 'NONE')]
    c += L(1) + [('iffalse', 'NONE')]
    c += o.get(L(1), 'kind', 'index') + o.num(1) + [('ifne', 'NONE')]
    c += o.index(o.get(L(1), 'kind', 'params'), o.num(0))
    c += [('getproperty', o.q('config')), ('getproperty', o.q('index'))]
    c += o.num(0) + [('ifne', 'NONE')]
    c += o.get(L(1), 'questId', 'index') + o.num(1) + [('ifne', 'NONE')]
    c += o.get(L(1), 'isolated') + [('iftrue', 'NONE')]
    c += o.get(L(1), 'battleTransmitter') + [('setlocal_3',)]
    c += L(3) + [('iffalse', 'NONE')]
    c += o.get(L(3), 'index') + o.num(0) + [('ifne', 'NONE')]
    c += o.get(o.index(o.get(L(3), 'params'), o.num(0)), 'connection') + [('setlocal', 4)]
    c += L(4) + [('iffalse', 'NONE')]
    c += o.get(L(4), 'connection') + [('iffalse', 'NONE')]
    c += o.get(L(4), 'connection', 'established') + [('iffalse', 'NONE')]
    c += o.slot('wfxFpScenes') + [('setlocal_2',)]
    c += L(2) + [('iftrue', 'MAP')]
    c += weak + [('setlocal_2',)] + o.slot_set('wfxFpScenes', L(2))
    c += [('label', 'MAP')]
    c += o.call(L(2), 'get', L(1)) + [('setlocal', 5)]
    c += L(5) + [('iffalse', 'NEW')]
    c += o.get(L(5), 'closed') + [('iftrue', 'NEW')]
    c += o.get(L(5), 'connection') + L(4) + [('ifstrictne', 'REPLACE')]
    c += o.get(L(5), 'socket') + o.get(L(4), 'connection') + [('ifstrictne', 'REPLACE')]
    c += [('jump', 'RETURN'), ('label', 'REPLACE')]
    c += o.static('wfxFpRelease', L(1), void=True)
    c += [('label', 'NEW')]
    fields = {k: ARRAY for k in ('rows', 'events', 'gaps', 'sendQueue')}
    fields.update(scene=L(1), connection=L(4), epoch=o.slot('wfxFpEpoch'),
                  seq=o.num(0), eventId=o.num(0), eventCursor=NULL,
                  queuedBytes=o.num(0), pendingBytes=o.num(0), tokens=o.num(16384),
                  lastTimer=[('findpropstrict', e.q('flash.utils::getTimer')),
                             ('callproperty', e.q('flash.utils::getTimer'), 0)],
                  generation=o.num(0), forceFull=TRUE, closed=FALSE, byId=OBJECT)
    c += o.object(fields) + [('setlocal', 5)]
    c += o.slot_set('wfxFpEpoch', o.slot('wfxFpEpoch') + o.num(1) + [('add',)])
    c += o.call(L(2), 'set', L(1), L(5), void=True)
    c += o.static('wfxFpBindConnection', L(5), void=True)
    c += o.slot('wfxFpWasDisabled') + [('iffalse', 'RETURN')]
    c += o.static('wfxFpGap', L(5), o.string('disabled'), NULL, NULL, void=True)
    c += o.slot_set('wfxFpWasDisabled', FALSE)
    c += [('label', 'RETURN')]
    c += o.slot('wfxFpReadFailed') + [('iffalse', 'VALID')]
    c += o.static('wfxFpGap', L(5), o.string('sampling_error'), NULL, NULL, void=True)
    c += o.slot_set('wfxFpReadFailed', FALSE)
    c += [('label', 'VALID')] + L(5) + [('returnvalue',)]
    c += [('label', 'NONE'), ('pushnull',), ('returnvalue',), ('label', 'END'),
          ('label', 'CATCH'), ('pop',), ('getlocal_0',), ('pushscope',)]
    c += o.slot_set('wfxFpReadFailed', TRUE)
    c += L(5) + [('iffalse', 'FAILEND')]
    c += o.static('wfxFpTransportDrop', L(5), o.string('sampling_error'), void=True)
    c += o.static('wfxFpUnbindConnection', L(5), void=True)
    c += o.set(L(5), 'closed', TRUE) + o.set(L(5), 'scene', NULL)
    c += L(2) + [('iffalse', 'FAILEND')]
    c += o.call(L(2), 'remove', L(1)) + [('pop',)]
    c += [('label', 'FAILEND'), ('pushnull',), ('returnvalue',)]
    return e.add_method(BATTLE, 'wfxFpContext', 'Object', ['*'], c, 6,
                        static=True, exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def bind(e):
    o = Ops(e)
    # b1, scene2, ctx3, map4, state5, oldById6, epoch7.
    c = PROLOGUE + NULL + [('setlocal_3',), ('label', 'TRY')]
    c += o.slot('wfxFpEnabled') + [('iftrue', 'ENABLED')]
    c += o.static('wfxFpDisabled', void=True) + [('jump', 'NONE')]
    c += [('label', 'ENABLED')]
    c += o.static('wfxFpContext', L(2)) + [('setlocal_3',)]
    c += L(3) + [('iffalse', 'NONE')]
    c += o.slot('wfxFpBattles') + [('setlocal', 4)]
    c += L(4) + [('iftrue', 'MAP')]
    c += [('getlex', e.q('haxe.ds::WeakMap')), ('construct', 0), ('setlocal', 4)]
    c += o.slot_set('wfxFpBattles', L(4)) + [('label', 'MAP')]
    c += o.call(L(4), 'get', L(1)) + [('setlocal', 5)]
    c += L(5) + [('iffalse', 'NEW')]
    c += o.get(L(5), 'ctx') + L(3) + [('ifstrictne', 'NEW')]
    c += L(5) + [('returnvalue',), ('label', 'NEW')]
    c += o.num(0) + [('setlocal', 7)]
    c += o.index(o.get(L(3), 'byId'), o.get(L(1), 'initialData', 'id')) + [('setlocal', 6)]
    c += L(6) + [('iffalse', 'EPOCH')]
    c += o.get(L(6), 'battleEpoch') + o.num(1) + [('add',), ('setlocal', 7)]
    c += [('label', 'EPOCH')]
    c += o.object(dict(ctx=L(3), battleEpoch=L(7), previous=NULL, previousFrame=o.num(-1),
                       inputs=ARRAY, unsupported=ARRAY, generation=o.num(-1),
                       started=FALSE)) + [('setlocal', 5)]
    c += o.call(L(4), 'set', L(1), L(5), void=True)
    c += o.put(o.get(L(3), 'byId'), o.get(L(1), 'initialData', 'id'), L(5))
    c += L(5) + [('returnvalue',), ('label', 'NONE'), ('pushnull',), ('returnvalue',),
                  ('label', 'END'), ('label', 'CATCH'), ('pop',), ('getlocal_0',), ('pushscope',)]
    c += L(3) + [('iftrue', 'KNOWNFAIL')]
    c += o.slot_set('wfxFpReadFailed', TRUE) + [('jump', 'FAILEND'), ('label', 'KNOWNFAIL')]
    c += o.static('wfxFpTransportDrop', L(3), o.string('sampling_error'), void=True)
    c += [('label', 'FAILEND'), ('pushnull',), ('returnvalue',)]
    return e.add_method(BATTLE, 'wfxFpBind', 'Object', [BATTLE, '*'], c, 8,
                        static=True, exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def release(e):
    o = Ops(e)
    c = PROLOGUE + o.slot('wfxFpEnabled') + [('iffalse', 'DONE')]
    c += o.slot('wfxFpScenes') + [('setlocal_2',)] + L(2) + [('iffalse', 'DONE')]
    c += o.call(L(2), 'get', L(1)) + [('setlocal_3',)] + L(3) + [('iffalse', 'DONE')]
    c += o.static('wfxFpUnbindConnection', L(3), void=True)
    c += o.set(L(3), 'closed', TRUE) + o.set(L(3), 'scene', NULL)
    c += o.call(L(2), 'remove', L(1)) + [('pop',)]
    c += [('label', 'DONE'), ('returnvoid',)]
    return e.add_method(BATTLE, 'wfxFpRelease', 'void', ['*'], c, 4, static=True)


def disabled(e):
    o = Ops(e)
    c = PROLOGUE[:]
    for name in ('wfxFpScenes', 'wfxFpBattles', 'wfxFpConnections'):
        c += o.slot_set(name, NULL)
    c += o.slot_set('wfxFpWasDisabled', TRUE) + [('returnvoid',)]
    return e.add_method(BATTLE, 'wfxFpDisabled', 'void', [], c, 1, static=True)


def build(e):
    return {'disabled': disabled(e), 'context': context(e), 'bind': bind(e), 'release': release(e)}
