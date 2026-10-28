"""逐proceed初值/输入/帧尾采样及相邻帧差量，均在新增助手内。"""
import asm
from fp_emit import BATTLE, Ops, local as L, NULL, TRUE, FALSE, ARRAY, OBJECT, PROLOGUE


def delta(e):
    o = Ops(e)
    # old1,new2,sets3,unsets4,keys5,i6,key7.
    c = PROLOGUE + OBJECT + [('setlocal_3',)] + ARRAY + [('setlocal', 4)]
    for old, new, suffix in ((1, 2, 'UNSET'), (2, 1, 'SET')):
        c += o.static('wfxFpKeys', L(old)) + [('setlocal', 5)]
        c += o.num(0) + [('setlocal', 6), ('label', 'LOOP' + suffix), ('avm_label',)]
        c += L(6) + o.get(L(5), 'length') + [('ifge', 'END' + suffix)]
        c += o.index(L(5), L(6)) + [('setlocal', 7)]
        if suffix == 'UNSET':
            c += L(7) + L(new) + [('in',), ('iftrue', 'NEXT' + suffix)]
            c += o.call(L(4), 'push', L(7), void=True)
        else:
            c += L(7) + L(new) + [('in',), ('iffalse', 'DIFFERENT')]
            for target in (old, new):
                c += [('getlex', e.q('JSON'))] + o.index(L(target), L(7))
                c += [('callproperty', e.q('stringify'), 1)]
            c += [('ifstricteq', 'NEXT' + suffix), ('label', 'DIFFERENT')]
            c += o.put(L(3), L(7), o.index(L(old), L(7)))
        c += [('label', 'NEXT' + suffix), ('inclocal_i', 6), ('jump', 'LOOP' + suffix),
              ('label', 'END' + suffix)]
    c += o.object({'set': L(3), 'unset': L(4)}) + [('returnvalue',)]
    return e.add_method(BATTLE, 'wfxFpDelta', 'Object', ['Object', 'Object'], c, 8, static=True)


def sample(e):
    o = Ops(e)
    # b1,initial2,state3,ctx4,snapshot5,row6,delta7,frame8,values9,generation10.
    c = PROLOGUE + NULL + [('setlocal', 4), ('label', 'TRY')]
    c += o.slot('wfxFpEnabled') + [('iffalse', 'DONE')]
    c += o.slot('wfxFpBattles') + [('iffalse', 'DONE')]
    c += o.call(o.slot('wfxFpBattles'), 'get', L(1)) + [('setlocal_3',)]
    c += L(3) + [('iffalse', 'DONE')]
    c += o.get(L(3), 'ctx') + [('setlocal', 4)]
    c += o.get(L(4), 'closed') + [('iftrue', 'DONE')]
    c += L(2) + [('iffalse', 'SNAP')]
    c += o.get(L(3), 'started') + [('iftrue', 'DONE')]
    c += [('label', 'SNAP')]
    c += o.get(L(4), 'generation') + [('setlocal', 10)]
    c += o.static('wfxFpSnapshot', L(1)) + [('setlocal', 5)]
    c += L(5) + [('iffalse', 'DONE')]
    c += o.get(L(5), 'values') + [('setlocal', 9)]
    c += o.get(L(1), 'currentFrame') + [('setlocal', 8)]
    c += o.object(dict(battleId=o.get(L(1), 'initialData', 'id'),
        battleEpoch=o.get(L(3), 'battleEpoch'), postFrame=L(8),
        phase=o.string('post'), zone=o.get(L(1), 'currentZoneIndex'),
        floor=o.get(L(1), 'floor'), inputs=o.get(L(3), 'inputs'),
        unsupported=o.call(o.get(L(5), 'unsupported'), 'concat', o.get(L(3), 'unsupported')),
        eventCursor=o.get(L(4), 'eventCursor'))) + [('setlocal', 6)]
    # concat owns this array; normalize the combined state/input coverage paths.
    c += o.call(o.get(L(6), 'unsupported'), 'sortOn', o.string('path'), void=True)
    c += L(2) + [('iffalse', 'POST')]
    c += o.set(L(6), 'phase', o.string('initial')) + o.set(L(6), 'inputs', ARRAY)
    c += L(8) + o.num(0) + [('ifeq', 'FULL')]
    c += o.static('wfxFpGap', L(4), o.string('initial_missing'), o.num(0),
                  L(8) + o.num(1) + [('subtract_i',)], void=True) + [('jump', 'FULL')]
    c += [('label', 'POST')]
    c += o.get(L(3), 'previous') + [('iffalse', 'FULL')]
    c += o.get(L(3), 'generation') + L(10) + [('ifne', 'FULL')]
    c += L(8) + o.num(30) + [('modulo',)] + o.num(0) + [('ifeq', 'FULL')]
    c += o.get(L(3), 'previousFrame') + L(8) + o.num(1) + [('subtract_i',), ('ifne', 'MISSING')]
    c += o.static('wfxFpDelta', o.get(L(3), 'previous'), L(9)) + [('setlocal', 7)]
    c += o.set(L(6), 'mode', o.string('delta'))
    c += o.set(L(6), 'baseFrame', o.get(L(3), 'previousFrame'))
    c += o.set(L(6), 'set', o.get(L(7), 'set')) + o.set(L(6), 'unset', o.get(L(7), 'unset'))
    c += [('jump', 'APPEND'), ('label', 'MISSING')]
    c += o.static('wfxFpGap', L(4), o.string('sampling_error'), NULL, L(8), void=True)
    c += [('label', 'FULL')]
    c += o.set(L(6), 'mode', o.string('full')) + o.set(L(6), 'values', L(9))
    c += [('label', 'APPEND')]
    c += o.static('wfxFpQueue', L(4), o.string('rows'), L(6), void=True)
    c += o.set(L(3), 'previous', L(9)) + o.set(L(3), 'previousFrame', L(8))
    c += o.set(L(3), 'generation', L(10)) + o.set(L(3), 'started', TRUE)
    c += o.set(L(3), 'inputs', ARRAY) + o.set(L(3), 'unsupported', ARRAY)
    c += L(2) + [('iftrue', 'DONE')]
    c += o.get(L(1), 'primary') + [('iffalse', 'DONE')]
    c += L(8) + o.num(15) + [('modulo',)] + o.num(0) + [('ifne', 'DONE')]
    c += o.static('wfxFpFlush', L(4), FALSE, void=True)
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'END'), ('label', 'CATCH'),
          ('pop',), ('getlocal_0',), ('pushscope',)]
    c += L(4) + [('iffalse', 'FAILEND')]
    c += o.set(L(4), 'generation', o.get(L(4), 'generation') + o.num(1) + [('add_i',)])
    c += o.static('wfxFpGap', L(4), o.string('sampling_error'), NULL, NULL, void=True)
    c += [('label', 'FAILEND'), ('returnvoid',)]
    return e.add_method(BATTLE, 'wfxFpSample', 'void', [BATTLE, 'Boolean'], c, 11,
                        static=True, exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def capture(e):
    o = Ops(e)
    c = PROLOGUE + [('label', 'TRY')]
    c += o.slot('wfxFpEnabled') + [('iffalse', 'DONE')]
    c += o.slot('wfxFpBattles') + [('iffalse', 'DONE')]
    c += o.call(o.slot('wfxFpBattles'), 'get', L(1)) + [('setlocal_3',)]
    c += L(3) + [('iffalse', 'DONE')]
    c += o.static('wfxFpCaptureInputs', L(1), L(2)) + [('setlocal', 4)]
    c += L(4) + [('iffalse', 'DONE')]
    c += o.set(L(3), 'inputs', o.get(L(4), 'inputs'))
    c += o.set(L(3), 'unsupported', o.get(L(4), 'unsupported'))
    c += [('label', 'DONE'), ('returnvoid',), ('label', 'END'), ('label', 'CATCH'),
          ('pop',), ('getlocal_0',), ('pushscope',)]
    c += L(3) + [('iffalse', 'FAILEND')]
    c += o.set(L(3), 'inputs', ARRAY)
    c += o.set(L(3), 'unsupported', o.object(dict(path=o.string('/inputs'),
        reason=o.string('read_error'))) + [('newarray', 1)])
    c += o.static('wfxFpGap', o.get(L(3), 'ctx'), o.string('sampling_error'), NULL, NULL, void=True)
    c += [('label', 'FAILEND'), ('returnvoid',)]
    return e.add_method(BATTLE, 'wfxFpCapture', 'void', [BATTLE, 'haxe.ds::List'], c, 5,
                        static=True, exceptions=[('TRY', 'END', 'CATCH', 0, 0)])


def hooks(e):
    o = Ops(e)
    ins = asm.decode(e.body('Battle/proceed')[5])
    assert ins[79].name == 'setlocal_2' and ins[598].name == 'returnvalue'
    assert ins[597].name == 'getlocal' and ins[597].args == [10]
    e.insert('Battle/proceed', 2, o.static('wfxFpSample', L(0), TRUE, void=True))
    e.insert('Battle/proceed', 80, o.static('wfxFpCapture', L(0), L(2), void=True))
    e.insert('Battle/proceed', 597, o.static('wfxFpSample', L(0), FALSE, void=True))
    e.insert('BattleDerailleur/proceed', 2, o.static('wfxFpBind',
        o.get(L(0), 'battle'), o.get(L(0), 'scene')) + [('pop',)])


def build(e):
    result = {'delta': delta(e), 'sample': sample(e), 'capture': capture(e)}
    hooks(e)
    return result
