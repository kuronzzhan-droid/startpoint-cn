"""Bounded scalar hashing and lazily allocated diagnostic accumulators."""
from fp_emit import BATTLE, Ops, local as L, NULL, OBJECT, PROLOGUE


def increment(o, obj, key):
    return o.set(obj, key, o.get(obj, key) + o.num(1) + [('add',)])


def feed(o, summary, value):
    return o.set(summary, 'orderedHash', o.static('wfxFpSummaryHash',
        o.get(summary, 'orderedHash'), value))


def build(e):
    o = Ops(e)
    # Only small scalars may reach String conversion. No arbitrary toString.
    c = PROLOGUE + L(1) + NULL + [('ifeq', 'YES')]
    c += L(1) + [('istype', e.q('Number')), ('iftrue', 'YES')]
    c += L(1) + [('istype', e.q('String')), ('iffalse', 'NO')]
    c += o.get(L(1), 'length') + o.num(128) + [('ifgt', 'NO')]
    c += [('label', 'YES'), ('pushtrue',), ('returnvalue',),
          ('label', 'NO'), ('pushfalse',), ('returnvalue',)]
    e.add_method(BATTLE, 'wfxFpSummaryScalar', 'Boolean', ['*'], c, 2, static=True)

    # hash1,value2,text3,i4. Prefix type and length, then each UTF-16 code unit.
    c = PROLOGUE + L(2) + NULL + [('ifeq', 'NULL')]
    c += L(2) + [('istype', e.q('String')), ('iffalse', 'NUMBER')]
    c += o.string('s:') + L(2) + [('add',), ('setlocal_3',), ('jump', 'HASH')]
    c += [('label', 'NUMBER')] + o.string('n:') + L(2)
    c += [('convert_s',), ('add',), ('setlocal_3',), ('jump', 'HASH')]
    c += [('label', 'NULL')] + o.string('null') + [('setlocal_3',)]
    c += [('label', 'HASH')] + L(1) + o.num(31) + [('multiply_i',)]
    c += o.get(L(3), 'length') + [('bitxor',), ('setlocal_1',)]
    c += o.num(0) + [('setlocal', 4), ('label', 'LOOP'), ('avm_label',)]
    c += L(4) + o.get(L(3), 'length') + [('ifge', 'DONE')]
    c += L(1) + o.num(31) + [('multiply_i',)]
    c += o.call(L(3), 'charCodeAt', L(4)) + [('bitxor',), ('setlocal_1',)]
    c += [('inclocal_i', 4), ('jump', 'LOOP'), ('label', 'DONE')]
    c += L(1) + [('returnvalue',)]
    e.add_method(BATTLE, 'wfxFpSummaryHash', 'int', ['int', '*'], c, 5, static=True)

    for property_name, maker, take in (
        ('inputSummary', 'wfxFpInputSummary', 'wfxFpTakeInputSummary'),
        ('routeSummary', 'wfxFpRouteSummary', 'wfxFpTakeRouteSummary'),
    ):
        counts = ('count', 'unknown', 'readErrors', 'user', 'coop') if property_name == 'inputSummary' else (
            'count', 'unknown', 'readErrors', 'route_received', 'route_decoded',
            'route_rejected', 'speed_received', 'speed_applied')
        fields = {key: o.num(0) for key in counts}
        fields.update(orderedHash=o.num(5381), firstFrame=NULL, lastFrame=NULL,
                      kinds=OBJECT, coverage=o.string('top_level_only'))
        c = PROLOGUE + o.get(L(1), property_name) + [('setlocal_2',)]
        c += L(2) + [('iftrue', 'DONE')]
        c += o.object(fields) + [('setlocal_2',)] + o.set(L(1), property_name, L(2))
        c += [('label', 'DONE')] + L(2) + [('returnvalue',)]
        e.add_method(BATTLE, maker, 'Object', ['Object'], c, 3, static=True)
        c = PROLOGUE + o.static(maker, L(1)) + [('setlocal_2',)]
        c += o.set(L(1), property_name, NULL) + L(2) + [('returnvalue',)]
        e.add_method(BATTLE, take, 'Object', ['Object'], c, 3, static=True)

    # summary1,kind2,frame3,count4. Kinds are generated bounded whitelist keys.
    c = PROLOGUE + o.get(L(1), 'count') + o.num(0) + [('ifne', 'FRAME')]
    c += o.set(L(1), 'firstFrame', L(3)) + [('label', 'FRAME')]
    c += o.set(L(1), 'lastFrame', L(3)) + increment(o, L(1), 'count')
    c += o.index(o.get(L(1), 'kinds'), L(2)) + [('setlocal', 4)]
    c += L(4) + [('iftrue', 'ADD')] + o.num(0) + [('setlocal', 4), ('label', 'ADD')]
    c += o.put(o.get(L(1), 'kinds'), L(2), L(4) + o.num(1) + [('add',)])
    c += feed(o, L(1), L(2)) + feed(o, L(1), L(3)) + [('returnvoid',)]
    e.add_method(BATTLE, 'wfxFpSummaryRecord', 'void', ['Object', 'String', '*'], c, 5, static=True)

    # One explicit gap per incomplete summary bounds errors under malformed spam.
    c = PROLOGUE + increment(o, L(1), 'unknown')
    c += o.get(L(1), 'unknown') + o.num(1) + [('ifne', 'DONE')]
    c += o.static('wfxFpGap', L(2), o.string('sampling_error'), L(3), L(3), void=True)
    c += [('label', 'DONE'), ('returnvoid',)]
    e.add_method(BATTLE, 'wfxFpSummaryUnknown', 'void', ['Object', 'Object', '*'], c, 4, static=True)
