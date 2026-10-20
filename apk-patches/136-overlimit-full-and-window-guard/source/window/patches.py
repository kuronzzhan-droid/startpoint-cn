"""在原持有数循环读取缩略图后跳过缺失格子；其余指令全部可逆。"""
import hashlib

import asm
from perf2_core import splice_with_exits

TARGET = 'OverLimitWindowView/onApplyOverLimitStatusInformation'
TARGETS = [TARGET]
LOCKS = {TARGET: {
    'sha': '26c35555780e7eb6fb2581dd769f9483e74ff903512be4f5af1baad597724b06',
    'header': [10, 9, 1, 2],
}}
AT, COUNT, OLD_CONTINUE = 130, 2, 147


def build(e):
    original = e.body(TARGET)
    lock = LOCKS[TARGET]
    if hashlib.sha256(original[5]).hexdigest() != lock['sha'] or original[1:5] != lock['header']:
        raise asm.AsmError('window guard unknown v35g sha/header: ' + TARGET)
    old = asm.decode(original[5])
    assert old[129].name == 'setlocal' and old[129].args == [8]
    assert old[130].name == 'getlocal' and old[130].args == [8]
    assert old[143].name == 'jump' and old[143].target == OLD_CONTINUE
    assert old[OLD_CONTINUE].name == 'getlocal' and old[OLD_CONTINUE].args == [4]
    assert old[149].name == 'iflt' and old[149].target == 112
    raw, exceptions, _, count = splice_with_exits(original, AT, [
        ('getlocal', 8), ('iffalse', 'NEXT'),
    ], {'NEXT': OLD_CONTINUE})
    assert count == COUNT
    recovery = [(AT, count, asm.FORBID)]
    assert asm.unsplice_many(raw, recovery) == original[5]
    e.replace(TARGET, raw, exceptions)
    e.report[TARGET]['insertions'] = recovery
    e.report[TARGET]['window_guard'] = {
        'strategy': 'skip_missing_thumbnail', 'thumbnail_local': 8,
        'original_continue_instruction': OLD_CONTINUE,
        'new_continue_instruction': OLD_CONTINUE + count,
        'original_bytes_exactly_recoverable': True,
        'same_window_slot_count_changes': False,
    }
    return {'capability': 'wfx-overlimit-window-null-guard-v1', 'targets': TARGETS,
            'new_methods': [], 'new_classes': [], 'pool_additions': [],
            'strategy': '任务书允许的备选：循环跳过不存在的格子'}
