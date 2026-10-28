"""F1009: EquipmentListScene() dereferenced the injected `globalLogic` slot.

The C9 weapon-detail entry (`EquipmentList(0, Some(0x0C000000|weapon))`) makes
the constructor resolve the weapon name via
    this.globalLogic.getGeneralEquipment(id).get_name()
`LogicScene.globalLogic` is a plain slot filled by gipo injection *after*
construction (LogicScene.prepare is the first native reader), so it is null
inside the constructor -> TypeError #1009 with EquipmentListScene() on top.

Fix (one insert, same method): after `getproperty globalLogic`, if the value is
null use the process-wide PinballClientMain.top.logic.globalLogic (the same
object the riven patches already use everywhere else). Injected value, when
present, still wins.
"""
import asm
from r2_common import ops_of, mn

LABEL = 'EquipmentListScene/<ctor>'


def queue_f1009(q):
    e = q.e
    ops = ops_of(e, LABEL)
    hits = [i for i in range(1, len(ops) - 2)
            if ops[i].name == 'getproperty' and mn(e, ops[i]) == 'globalLogic'
            and ops[i - 1].name == 'getlocal_0'
            and ops[i + 1].name == 'getlocal'
            and ops[i + 2].name == 'callproperty' and mn(e, ops[i + 2]) == 'getGeneralEquipment']
    assert len(hits) == 1, ('F1009 anchor', hits)
    at = hits[0] + 1
    code = [('dup',), ('iftrue', 'ok'), ('pop',),
            ('getlex', e.q('PinballClientMain')), ('getproperty', e.q('top')),
            ('getproperty', e.q('logic')), ('getproperty', e.q('globalLogic')),
            ('label', 'ok')]
    q.add('f1009', LABEL, at, code, asm.FORBID,
          'after this.globalLogic (null during construction) fall back to PinballClientMain.top.logic.globalLogic')
    return {'method': LABEL, 'anchor': 'getlocal_0; getproperty globalLogic; ^ getlocal N; callproperty getGeneralEquipment',
            'at': at}
