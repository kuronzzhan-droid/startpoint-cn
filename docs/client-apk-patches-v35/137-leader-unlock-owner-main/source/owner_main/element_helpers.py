"""前置 202 的变属性路径及无递归的 v35h 共鸣判据。"""
import copy

import asm
from owner_main.helpers import clone_method, splice

ELEMENT = 'BattleCharacterLogic/getElement'
MASK = 'BattleCharacterLogic/wfxPartyMask'
ELEMENT_LOCKS = {
    ELEMENT: {'sha': 'af3bd846acede1a3ace8c1ff2cc7221a3fc28cef44730ed59c9f59d998b1318f', 'header': [3, 20, 6, 7]},
    MASK: {'sha': '73531ade920c9db8d32da86499c84356e98876bee548204e19bb777fe1a38b26', 'header': [4, 3, 1, 2]},
}
ELEMENT_SOURCES = {
    'BattleCharacterLogic/get_element': {'sha': '3800540a45d4d97f5779b3b2a9f06771ace34c91843615c255eea7458d8146e6', 'header': [3, 5, 6, 7]},
    'BattlePartyLogic/getNumberOfSameElement': {'sha': 'f9e08aad72294b9d1063a860505916526c5f9acfe8bbd9163cc9111834549c22', 'header': [3, 10, 1, 2]},
}


def _retarget_calls(e, label, old, new):
    body = copy.deepcopy(e.body(label))
    ins = asm.decode(body[5])
    hits = []
    for at, instruction in enumerate(ins):
        if instruction.name == 'callproperty' and instruction.args == [e.q(old), 0]:
            instruction.args = [new, 0]
            hits.append(at)
    if not hits:
        raise asm.AsmError('missing native call: ' + label + '/' + old)
    body[5] = asm.encode(ins)[0]
    return body, hits


def install(e, own, replace):
    # Each native party getter creates fresh character objects. Retain the old cached
    # getter as well as old getElement so the resonance query keeps that exact lifecycle.
    before_element = clone_method(e, ELEMENT, 'wfxElementBeforeOwnerMain', e.body(ELEMENT))
    label = 'BattleCharacterLogic/get_element'
    body, hits = _retarget_calls(e, label, 'getElement', before_element)
    assert hits == [23]
    before_cached = clone_method(e, label, 'wfxCachedElementBeforeOwnerMain', body)
    label = 'BattlePartyLogic/getNumberOfSameElement'
    body, hits = _retarget_calls(e, label, 'get_element', before_cached)
    assert hits == [47, 52]
    same = clone_method(e, label, 'wfxSameElementBeforeOwnerMain', body)

    # Every bit16 query uses unchanged v35h element semantics: even a mask without
    # bit1 must not recurse through live getElement before that bit can be checked.
    body, recovery = splice(e.body(MASK), 52, [
        ('getlocal_0',), ('getproperty', e.q('party')),
        ('callproperty', same, 0), ('jump', 'GATE'),
    ], {'GATE': 55})
    replace(e, MASK, body, [recovery])

    # This site is reached only by the original isUnison + own getSelfAbilitySlots
    # path and only in the preconditions loop. Initial trigger/other conditions stay native.
    body, recovery = splice(e.body(ELEMENT), 247, [
        ('getlocal', 16), ('getproperty', e.q('index')), ('pushbyte', 11),
        ('ifne', 'ORIGINAL'),
        ('getlocal_0',), ('pushshort', 1001), ('pushshort', 1000), ('multiply',),
        ('callproperty', own, 1), ('iftrue', 'MATCHED'),
    ], {'ORIGINAL': 247, 'MATCHED': 259}, incoming=asm.ENTER)
    replace(e, ELEMENT, body, [recovery])
