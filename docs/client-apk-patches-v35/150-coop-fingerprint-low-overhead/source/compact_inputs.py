"""TASK18 ordered top-level input counters; no nested command copy or JSON."""
from fp_emit import BATTLE, Ops, local as L, NULL, PROLOGUE
from fp_input_copy import build_schemas, ROOT_TYPES
from compact_input_helpers import build as helpers, increment, feed

TARGETS = ['Battle$/wfxFpCapture', 'Battle$/wfxFpInputEvent']


def known_kind(e, o, value, cls, prefix, result, bad, suffix):
    """Only known exact top-level enum indexes are admitted; payload stays unread."""
    schemas, _ = build_schemas(e)
    c = value + [('iffalse', bad)]
    c += value + [('istype', e.q(cls)), ('iffalse', bad)]
    c += o.get(value, 'index') + [('setlocal', result)]
    for idx in sorted(schemas[cls]['variants']):
        next_label = f'KIND_{suffix}_{idx}'
        c += L(result) + o.num(idx) + [('ifne', next_label)]
        c += o.string(f'{prefix}.{idx}') + [('setlocal', result), ('jump', 'KIND_DONE_' + suffix),
                                            ('label', next_label)]
    c += [('jump', bad), ('label', 'KIND_DONE_' + suffix)]
    return c


def capture(e):
    o = Ops(e)
    # battle1,list2,state3,summary4,node5,command6,kind7,source8,frame9,inner10.
    c = PROLOGUE + NULL + [('setlocal_3',)] + NULL + [('setlocal', 4), ('label', 'TRY')]
    c += o.slot('wfxFpEnabled') + [('iffalse', 'DISABLED')]
    c += o.slot('wfxFpBattles') + [('iffalse', 'DONE')]
    c += o.call(o.slot('wfxFpBattles'), 'get', L(1)) + [('setlocal_3',)]
    c += L(3) + [('iffalse', 'DONE')]
    c += o.get(o.get(L(3), 'ctx'), 'closed') + [('iftrue', 'DONE')]
    c += o.get(L(2), 'h') + [('setlocal', 5)]
    c += L(5) + [('iffalse', 'DONE')]
    c += o.static('wfxFpInputSummary', L(3)) + [('setlocal', 4)]
    c += [('label', 'LOOP'), ('avm_label',)] + L(5) + [('iffalse', 'DONE')]
    c += o.get(L(5), 'item') + [('setlocal', 6)]
    c += o.get(L(5), 'next') + [('setlocal', 5)]
    c += o.get(L(1), 'initialData', 'id') + [('setlocal', 8)]
    c += NULL + [('setlocal', 9)]
    c += o.get(L(6), 'index') + o.num(0) + [('ifeq', 'USER')]
    c += o.get(L(6), 'index') + o.num(1) + [('ifne', 'BAD')]
    c += o.index(o.get(L(6), 'params'), o.num(1)) + [('setlocal', 8)]
    c += o.index(o.get(L(6), 'params'), o.num(2)) + [('setlocal', 9)]
    c += increment(o, L(4), 'coop')
    c += o.index(o.get(L(6), 'params'), o.num(0)) + [('setlocal', 10)]
    c += known_kind(e, o, L(10), ROOT_TYPES[1], 'Coop', 7, 'BAD', 'COOP')
    c += [('jump', 'CHECK'), ('label', 'USER')] + increment(o, L(4), 'user')
    c += o.index(o.get(L(6), 'params'), o.num(0)) + [('setlocal', 10)]
    c += known_kind(e, o, L(10), ROOT_TYPES[0], 'User', 7, 'BAD', 'USER')
    c += [('label', 'CHECK')]
    for value in (L(8), L(9), o.get(L(1), 'currentFrame')):
        c += o.static('wfxFpSummaryScalar', value) + [('iffalse', 'BAD')]
    c += [('jump', 'RECORD'), ('label', 'BAD')]
    c += o.string('Unknown') + [('setlocal', 7)] + NULL + [('setlocal', 8)]
    c += NULL + [('setlocal', 9)]
    c += o.static('wfxFpSummaryUnknown', L(4), o.get(L(3), 'ctx'), o.get(L(1), 'currentFrame'), void=True)
    c += [('label', 'RECORD')]
    c += o.static('wfxFpSummaryRecord', L(4), L(7), o.get(L(1), 'currentFrame'), void=True)
    c += feed(o, L(4), L(8)) + feed(o, L(4), L(9))
    c += [('jump', 'LOOP'), ('label', 'DISABLED')]
    c += o.static('wfxFpDisabled', void=True)
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'END'), ('label', 'CATCH'),
          ('pop',), ('getlocal_0',), ('pushscope',)]
    c += L(3) + [('iffalse', 'FAILEND')]
    c += o.static('wfxFpInputSummary', L(3)) + [('setlocal', 4)]
    c += increment(o, L(4), 'readErrors')
    c += o.static('wfxFpSummaryUnknown', L(4), o.get(L(3), 'ctx'), NULL, void=True)
    c += [('label', 'FAILEND'), ('returnvoid',)]
    e.add_method(BATTLE, 'wfxFpCaptureSummary', 'void', [BATTLE, 'haxe.ds::List'], c, 11,
                 static=True, exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def event(e):
    o = Ops(e)
    # original nine args retained; ctx10,summary11,kind12. wire8 is never read.
    c = PROLOGUE + NULL + [('setlocal', 10), ('label', 'TRY')]
    c += o.slot('wfxFpEnabled') + [('iffalse', 'DISABLED')]
    c += o.static('wfxFpContext', L(1)) + [('setlocal', 10)]
    c += L(10) + [('iffalse', 'DONE')]
    c += o.get(L(10), 'closed') + [('iftrue', 'DONE')]
    c += o.static('wfxFpRouteSummary', L(10)) + [('setlocal', 11)]
    stages = ('route_received', 'route_decoded', 'route_rejected', 'speed_received', 'speed_applied')
    for stage in stages:
        c += L(3) + o.string(stage) + [('ifne', 'NEXT_' + stage)]
        c += increment(o, L(11), stage) + [('jump', 'STAGE'), ('label', 'NEXT_' + stage)]
    c += [('jump', 'BAD'), ('label', 'STAGE')]
    for arg in (4, 5, 6, 9):
        c += o.static('wfxFpSummaryScalar', L(arg)) + [('iffalse', 'BAD')]
    c += o.string('NoCommand') + [('setlocal', 12)]
    c += L(7) + [('iffalse', 'RECORD')]
    c += known_kind(e, o, L(7), ROOT_TYPES[2], 'Socket', 12, 'BAD', 'SOCKET')
    c += [('jump', 'RECORD'), ('label', 'BAD')]
    c += o.static('wfxFpSummaryUnknown', L(11), L(10), NULL, void=True)
    c += o.string('Unknown') + [('setlocal', 12)]
    # Invalid scalar shapes are replaced with null before bounded hashing.
    for arg in (3, 4, 5, 6, 9):
        c += o.static('wfxFpSummaryScalar', L(arg)) + [('iftrue', 'OK' + str(arg))]
        c += NULL + [('setlocal', arg), ('label', 'OK' + str(arg))]
    c += [('label', 'RECORD')]
    c += o.static('wfxFpSummaryRecord', L(11), L(12), L(4), void=True)
    for arg in (3, 5, 6, 9):
        c += feed(o, L(11), L(arg))
    c += [('jump', 'DONE'), ('label', 'DISABLED')] + o.static('wfxFpDisabled', void=True)
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'END'), ('label', 'CATCH'),
          ('pop',), ('getlocal_0',), ('pushscope',)]
    c += L(10) + [('iffalse', 'FAILEND')]
    c += o.static('wfxFpRouteSummary', L(10)) + [('setlocal', 11)]
    c += increment(o, L(11), 'readErrors')
    c += o.static('wfxFpSummaryUnknown', L(11), L(10), NULL, void=True)
    c += [('label', 'FAILEND'), ('returnvoid',)]
    e.add_method(BATTLE, 'wfxFpEventSummary', 'void', ['*', '*', 'String', '*', 'String', '*', '*', 'String', 'String'],
                 c, 13, static=True, exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def build(e):
    helpers(e)
    capture(e)
    event(e)
    o = Ops(e)
    for label, helper, count in (
        (TARGETS[0], 'wfxFpCaptureSummary', 2), (TARGETS[1], 'wfxFpEventSummary', 9)):
        e.insert(label, 2, o.static(helper, *(L(i) for i in range(1, count + 1)), void=True)
                 + [('returnvoid',)])
    return {'targets': TARGETS, 'input_api': 'wfxFpTakeInputSummary(state)',
            'route_api': 'wfxFpTakeRouteSummary(ctx)',
            'coverage': 'ordered top-level enum kinds/source/frame only; no nested payload, wire or JSON'}
