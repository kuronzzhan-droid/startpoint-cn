"""仅在 v35f 两个助手的非空 party 检查后插入首位 Some 守卫。"""
import hashlib

import asm
from perf2_core import splice_with_exits

ADAPTIVE = 'BattleCharacterLogic/wfxAdaptiveElement'
MASK = 'BattleCharacterLogic/wfxPartyMask'
NATIVE = 'BattlePartyLogic/get_leaderCharacter'
TARGETS = [ADAPTIVE, MASK]
LOCKS = {
    ADAPTIVE: {'sha': '505bc3e60962b8ca5953cd63c3014f81ad2eec36714104cdc09431e2e857d2f1',
               'header': [4, 2, 1, 2]},
    MASK: {'sha': '65c0ed107a976dca1160bead05cea133be7e22502e3c17cff9837f36a3725d41',
           'header': [4, 3, 1, 2]},
}
NATIVE_LOCK = {'sha': '11c13bbf18f831bc787456aa6a69ca901dacd9476d23b2768f24dbda47daa0b8',
               'header': [9, 5, 1, 2]}
INSERTIONS = {ADAPTIVE: (5, 9), MASK: (7, 8)}


def build(e):
    for label, lock in {**LOCKS, NATIVE: NATIVE_LOCK}.items():
        b = e.body(label)
        if hashlib.sha256(b[5]).hexdigest() != lock['sha'] or b[1:5] != lock['header']:
            raise asm.AsmError('leader-presence-guard unknown v35f sha/header: ' + label)
    native = asm.decode(e.body(NATIVE)[5])
    # 从未修改原生读取链取现有池索引；无新类、读表或常量池追加。
    donors = [(12, 'getproperty', 'values'), (13, 'getproperty', 'characters'),
              (16, 'getproperty', '<mn kind 0x1b>'), (21, 'getproperty', 'index')]
    for i, opcode, name in donors:
        assert native[i].name == opcode and e.abc.mn_name(native[i].args[0]) == name
    values, characters, runtime_index, index = [native[i].args[0] for i, _, _ in donors]
    for label in TARGETS:
        original = e.body(label)
        old = asm.decode(original[5])
        at, expected_count = INSERTIONS[label]
        null_exit = old[4 if label == ADAPTIVE else 6].target
        assert old[null_exit].name == 'pushbyte'
        assert old[null_exit].args == ([255] if label == ADAPTIVE else [0])
        prefix = [('getlocal_0',), ('getproperty', e.q('party'))] if label == ADAPTIVE else [('getlocal_1',)]
        source = prefix + [
            ('getproperty', values), ('getproperty', characters), ('pushbyte', 0),
            ('getproperty', runtime_index), ('getproperty', index), ('pushbyte', 0),
            ('ifne', 'NO_PARTY'),
        ]
        raw, exceptions, _, count = splice_with_exits(original, at, source, {'NO_PARTY': null_exit})
        assert count == expected_count
        recovery = [(at, count, asm.FORBID)]
        assert asm.unsplice_many(raw, recovery) == original[5], label + ' 原指令不能逐字节恢复'
        e.replace(label, raw, exceptions)
        e.report[label]['insertions'] = recovery
        e.report[label]['leader_guard'] = {
            'first_slot': 0, 'some_index': 0, 'native_read_method': NATIVE,
            'original_null_exit_instruction': null_exit,
            'new_null_exit_instruction': null_exit + count,
            'original_bytes_exactly_recoverable': True,
        }
    return {'capability': 'wfx-no-leader-guard-v1', 'targets': TARGETS,
            'native_methods_changed': [], 'new_classes': [], 'new_table_reads': [],
            'new_pool_entries': [], 'guard': 'party.values.characters[0].index == 0'}
