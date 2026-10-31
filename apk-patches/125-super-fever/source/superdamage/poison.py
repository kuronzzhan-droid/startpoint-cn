"""毒/滑落来源必须在Condition仍可见时保存，避免把远端毒tick算成本队。"""
import asm

OWNER = 'wfxSuperOwnerLocal'
TARGETS = ['EnemyImpl/applySlipHandler', 'FixedAttackCalculator/calculate']


def install(e):
    q = e.q
    owner = e.newq(OWNER)
    # applySlipHandler still has its ModifierOwner (the native Condition).
    # The old FixedAttack payload and all old damage fields remain untouched.
    label = TARGETS[0]
    ins = asm.decode(e.body(label)[5])
    objects = [i for i, x in enumerate(ins) if x.name == 'newobject']
    assert objects == [82] and ins[82].args == [23]
    e.insert(label, 83, [
        ('dup',), ('getlocal_3',), ('getproperty', q('statsBattleId')),
        ('getlocal_0',), ('getproperty', q('battle')), ('callproperty', q('get_id'), 0),
        ('equals',), ('getlocal_3',), ('getproperty', q('isFromHostile')),
        ('not',), ('bitand',), ('convert_b',), ('setproperty', owner)])
    # Only tagged slips add a provenance field. Ordinary FixedAttack results
    # preserve their original properties and behavior exactly.
    label = TARGETS[1]
    ins = asm.decode(e.body(label)[5])
    assert ins[354].name == 'newobject' and ins[354].args == [45]
    e.insert(label, 355, [
        e.string(OWNER), ('getlocal_2',), ('in',), ('iffalse', 'OLD'),
        ('dup',), ('getlocal_2',), ('getproperty', owner), ('setproperty', owner),
        ('label', 'OLD')])

