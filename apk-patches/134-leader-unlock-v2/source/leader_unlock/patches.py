"""v35e 双锁后只插入范围/共鸣守卫；所有旧指令可逆恢复。"""
import copy
import hashlib

import asm
from perf2_core import splice_with_exits

MASK = 'BattleCharacterLogic/wfxPartyMask'
LEADERS = 'BattleCharacterLogic/wfxExtraLeaders'
OPTIONS = 'BattleCharacterLogic/getOpitionAbilitiesWithoutAbilitySoul'
TARGETS = [MASK, LEADERS, OPTIONS]
LOCKS = {
    MASK: {'sha': 'c7a1db19edc1938f331ceee3e029d6e22d700741a17dc5432b5451f5e95bfbda', 'header': [4, 3, 1, 2]},
    LEADERS: {'sha': '739ab8d642fb22bf761006710b7fb1df09b8dc7a1324d5594312cfe0b110ee41', 'header': [6, 5, 1, 2]},
    OPTIONS: {'sha': 'a2e15db07a25960667fa958a57813682351f347baf8f2a1afccd95c23c71be26', 'header': [3, 11, 6, 7]},
}


def _splice(e, label, at, source, exits, edit=None):
    original = e.body(label)
    prepared = copy.deepcopy(original)
    if edit:
        ins = asm.decode(prepared[5])
        index, old, new = edit
        assert ins[index].name == 'pushbyte' and ins[index].args == [old]
        ins[index].args = [new]
        prepared[5] = asm.encode(ins)[0]
    raw, exceptions, _, count = splice_with_exits(prepared, at, source, exits)
    recovery = [(at, count, asm.FORBID)]
    restored = asm.unsplice_many(raw, recovery)
    if edit:
        ins = asm.decode(restored)
        ins[edit[0]].args = [edit[1]]
        restored = asm.encode(ins)[0]
    assert restored == original[5], label + ' 原指令不能逐字节恢复'
    e.replace(label, raw, exceptions)
    e.report[label]['insertions'] = recovery
    if edit:
        e.report[label]['operand_edit'] = {'instruction': edit[0], 'before': edit[1], 'after': edit[2]}


def build(e):
    # 独立模块同样拒绝未知 v35e 目标；根 Editor 再执行它的统一双锁。
    for label, lock in LOCKS.items():
        b = e.body(label)
        if hashlib.sha256(b[5]).hexdigest() != lock['sha'] or b[1:5] != lock['header']:
            raise asm.AsmError('leader-unlock-v2 unknown v35e sha/header: ' + label)
    q = e.q
    _splice(e, MASK, 40, [
        ('getlocal_2',), ('pushbyte', 16), ('bitand',), ('iffalse', 'ORIGINAL'),
        ('getlocal_0',), ('getproperty', q('party')),
        ('callproperty', q('getNumberOfSameElement'), 0),
        ('pushbyte', 6), ('iflt', 'ZERO'),
    ], {'ORIGINAL': 40, 'ZERO': 46}, edit=(42, 7, 31))
    _splice(e, LEADERS, 38, [
        ('getlocal_2',), ('pushbyte', 8), ('bitand',), ('iffalse', 'UNISON'),
        ('getlocal_0',), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'DONE'),
    ], {'UNISON': 38, 'DONE': 71})
    # 入栈已有 [原生unisonable, mask]；仅在 slot1/2 且 bit8 时把 mask 换成0。
    _splice(e, OPTIONS, 87, [
        ('dup',), ('pushbyte', 8), ('bitand',), ('iffalse', 'APPLY'),
        ('getlocal_0',), ('getproperty', q('index')), ('pushbyte', 0), ('ifeq', 'APPLY'),
        ('pop',), ('pushbyte', 0),
    ], {'APPLY': 87})
    return {'capability': 'leader-unlock-v2', 'mask_bits': 31,
            'slot0_only': 8, 'same_element_six': 16, 'targets': TARGETS}
