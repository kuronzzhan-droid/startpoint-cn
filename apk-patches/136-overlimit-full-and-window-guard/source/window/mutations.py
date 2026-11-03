"""全部真实、静态有效方法体变异；每项由行为测试检出。"""
import copy

import asm
from static_check import check_body
from .patches import TARGET, AT, COUNT
from .runtime import body


def candidates(before, after):
    source = asm.decode(body(after, TARGET)[5])
    rows = [('删除整个守卫恢复v35g', body(before, TARGET)[5])]
    edits = [
        (AT + 1, 'iftrue', None, None, '反转缺失守卫'),
        (AT, 'getlocal', [7], None, '错误检查道具记录而非缩略图'),
        (AT, 'pushnull', [], None, '所有缩略图错误视为缺失'),
        (AT + 1, None, None, 150 + COUNT, '缺失时直接退出导致后续格子不更新'),
        (132 + COUNT, 'getproperty', [5259], None, '错误用道具ID回写持有数'),
        (141 + COUNT, 'pushfalse', [], None, '零持有数不置灰'),
        (145 + COUNT, 'pushtrue', [], None, '非零持有数错误置灰'),
    ]
    assert after.mn_name(5259) == 'id'
    for index, opcode, args, target, name in edits:
        code = copy.deepcopy(source)
        if opcode is not None:
            code[index].op = asm.MNEMONICS[opcode]
        if args is not None:
            code[index].args = args
        if target is not None:
            code[index].target = target
        rows.append((name, asm.encode(code)[0]))
    for name, raw in rows:
        assert asm.encode(asm.decode(raw))[0] == raw
        candidate = copy.deepcopy(body(after, TARGET))
        candidate[5] = raw
        yield name, raw, check_body(after, candidate)
