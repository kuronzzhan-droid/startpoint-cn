"""Weak continuation-object storage; fixed member order and exact index match."""
from .common import BCD, SQUAD


def build(c):
    storage = c.e.add_slot(BCD, 'wfxStageStates', 'flash.utils::Dictionary', static=True)
    code = [('getlex', c.q(BCD)), ('getproperty', storage), ('iftrue', 'ready'),
            ('getlex', c.q(BCD)), ('getlex', c.q('flash.utils::Dictionary')),
            ('pushtrue',), ('construct', 1), ('setproperty', storage),
            ('label', 'ready'), ('newarray', 0), ('setlocal_2',),
            ('pushbyte', 0), ('setlocal_3',), ('label', 'loop'),
            ('getlocal_3',), ('getlocal_1',), c.get('members'), c.get('length'),
            ('ifge', 'done'), ('getlocal_1',), c.get('members'), ('getlocal_3',),
            ('getproperty', c.dynamic), ('setlocal', 4), ('inclocal_i', 3),
            ('getlocal', 4), c.get('index'), ('pushbyte', 0), ('ifne', 'loop'),
            ('getlocal', 4), c.get('params'), *c.at(0), ('setlocal', 4),
            ('getlocal_2',), ('getlocal', 4), c.get('index'),
            ('getlocal', 4), c.get('conditionSlot'), c.helper('wfxStageSnapshot'),
            ('newarray', 2), c.void('http://adobe.com/AS3/2006/builtin::push', 1),
            ('jump', 'loop'), ('label', 'done'),
            ('getlex', c.q(BCD)), ('getproperty', storage), ('getlocal_0',),
            ('getlocal_1',), c.get('conditionSlot'), c.helper('wfxStageSnapshot'),
            ('getlocal_2',), ('newarray', 2), ('setproperty', c.dynamic), ('returnvoid',)]
    c.add(BCD, 'wfxStageCapture', 'void', [SQUAD], code, 5)

    # r2 state, r3 rows, r4 member index, r5 member, r6 row index, r7 row.
    code = [('getlex', c.q(BCD)), ('getproperty', storage), ('iffalse', 'done'),
            ('getlex', c.q(BCD)), ('getproperty', storage), ('getlocal_1',),
            ('getproperty', c.dynamic), ('setlocal_2',), ('getlocal_2',),
            ('iffalse', 'done'), ('getlocal_2',), *c.at(1), ('setlocal_3',),
            ('pushbyte', 0), ('setlocal', 4), ('label', 'members'),
            ('getlocal', 4), ('getlocal_0',), c.get('members'), c.get('length'),
            ('ifge', 'shared'), ('getlocal_0',), c.get('members'), ('getlocal', 4),
            ('getproperty', c.dynamic), ('setlocal', 5), ('inclocal_i', 4),
            ('getlocal', 5), c.get('index'), ('pushbyte', 0), ('ifne', 'members'),
            ('getlocal', 5), c.get('params'), *c.at(0), ('setlocal', 5),
            ('pushbyte', 0), ('setlocal', 6), ('label', 'rows'),
            ('getlocal', 6), ('getlocal_3',), c.get('length'), ('ifge', 'members'),
            ('getlocal_3',), ('getlocal', 6), ('getproperty', c.dynamic),
            ('setlocal', 7), ('inclocal_i', 6), ('getlocal', 7), *c.at(0),
            ('getlocal', 5), c.get('index'), ('ifne', 'rows'),
            ('getlocal', 5), c.get('conditionSlot'), ('getlocal', 7), *c.at(1),
            c.helper('wfxStageRestore', 1, void=True), ('jump', 'members'),
            ('label', 'shared'), ('getlocal_0',), c.get('conditionSlot'),
            ('getlocal_2',), *c.at(0), c.helper('wfxStageRestore', 1, void=True),
            ('label', 'done'), ('returnvoid',)]
    c.add(SQUAD, 'wfxStageApply', 'void', [BCD], code, 8)
