"""v35h -> v35i：仅自身合击能力的前置 202，原指令均可撤销恢复。"""
import hashlib

import asm
from owner_main.helpers import install_eligibility, install_reason_helpers, splice
from owner_main.element_helpers import ELEMENT, MASK, ELEMENT_LOCKS, ELEMENT_SOURCES
from owner_main.element_helpers import install as install_element

COUNT = 'BattleCharacterLogic/getInstantAbiltyCountWithoutLimit'
PANEL = 'TriggerableAbilityDialogAllAbilitiesGenerator/addAbility'
TARGETS = [COUNT, PANEL, MASK, ELEMENT]
LOCKS = {
    COUNT: {'sha': '65dafd49bdcf77015670a32b60a443677a0cbf116d58c136008559756c20c307', 'header': [6, 17, 6, 7]},
    PANEL: {'sha': 'c2e8d65bd7b8ec6fb1b178d2353c0a4310e59a5f11ce6253f76ac9fbf2d7953e', 'header': [9, 19, 1, 2]},
}
LOCKS.update(ELEMENT_LOCKS)
SOURCE_LOCKS = {
    'AbilityDisabledReasonResolver/resolvePrecondition': {'sha': 'ac6b1df64b737dd96b03ea162883b8861d5b916c2784befc8c2d6dc703d61a4d', 'header': [17, 14, 1, 2]},
    'AbilityDisabledReasonResolver/resolve': {'sha': 'd1cd380cd937ea6c86599d2d6dbe4e8f8ad8d1cdb42f02ad7a0b265d7869d547', 'header': [17, 12, 1, 2]},
}
SOURCE_LOCKS.update(ELEMENT_SOURCES)


def _replace(e, label, body, recovery):
    assert asm.unsplice_many(body[5], recovery) == e.body(label)[5]
    e.replace(label, body[5], body[6], body[1:5])
    e.report[label]['insertions'] = recovery


def build(e):
    for label, lock in {**LOCKS, **SOURCE_LOCKS}.items():
        body = e.body(label)
        if hashlib.sha256(body[5]).hexdigest() != lock['sha'] or body[1:5] != lock['header']:
            raise asm.AsmError('owner-main unknown v35h SHA/header: ' + label)
    own, eligibility = install_eligibility(e)
    reason = install_reason_helpers(e)
    install_element(e, own, _replace)
    # At old #658, enum11 is selected and the original avm_label was already entered.
    body, recovery = splice(e.body(COUNT), 658, [
        ('getlocal_0',), ('getlocal', 4), ('callproperty', own, 1),
        ('iffalse', 'ORIGINAL'), ('pushbyte', 1), ('jump', 'COUNT'),
    ], {'ORIGINAL': 658, 'COUNT': 684})
    _replace(e, COUNT, body, [recovery])
    # Keep native resolve available as fall-through; eligible calls have a separate, scoped helper.
    body = e.body(PANEL)
    body, last = splice(body, 79, [
        ('getlocal', 19), ('iffalse', 'ORIGINAL'),
        ('pushtrue',), ('callpropvoid', reason, 5), ('jump', 'DONE'),
    ], {'ORIGINAL': 79, 'DONE': 80})
    body, middle = splice(body, 52, [('getlocal', 19), ('iftrue', 'RESOLVE')], {'RESOLVE': 69})
    body, first = splice(body, 27, [
        ('getlocal_0',), ('getproperty', e.q('disabledReasonResolver')),
        ('getlocal_2',), ('getlocal', 4),
        ('getlocal_0',), ('getproperty', e.q('partyCharacterIndex')),
        ('callproperty', eligibility, 3), ('setlocal', 19),
    ])
    # Recovery is ordered by final insertion position, accounting for earlier insertions.
    recovery = [first, (middle[0] + first[1], middle[1], middle[2]),
                (last[0] + first[1] + middle[1], last[1], last[2])]
    body[2] = max(body[2], 20)
    _replace(e, PANEL, body, recovery)
    return {'capability': 'wfx-owner-main-unlock-v1', 'targets': TARGETS,
            'origin_range': [1001000, 1007000], 'only_precondition': 202,
            'mask': {'required': 1, 'slot0_only': 8, 'six_same_element': 16}}
