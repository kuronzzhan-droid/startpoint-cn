"""静态有效的真实方法变异，只由语义断言检出。"""
import copy

import asm
import bodies
from static_check import check_body
from .patches import TARGETS, HELPER


def body(abc, label):
    return abc.bodies[bodies.resolve(abc, label)]


def candidates(before, after):
    for label in TARGETS:
        code = asm.decode(body(after, label)[5])
        changes = [(20, 'iffalse', None, '全程入口反转'),
                   (24, 'pushbyte', [5], '旧突破门槛错误移动'),
                   (26, 'pushbyte', [5], 'B台座降回普通'),
                   (31, 'pushbyte', [7], 'C突破门槛提前到7'),
                   (36, 'pushbyte', [119], 'C等级门槛提前到119'),
                   (39, 'iftrue', None, '有键仍要求旧觉醒'),
                   (42, 'iftrue', None, '全盘学习判定反转'),
                   (48, 'pushbyte', [6], 'C台座错误降档')]
        choices = [('整方法恢复v35g', body(before, label)[5])]
        for index, op, args, name in changes:
            mutant = copy.deepcopy(code)
            mutant[index].op = asm.MNEMONICS[op]
            if args is not None:
                mutant[index].args = args
            choices.append((name, asm.encode(mutant)[0]))
        for name, raw in choices:
            candidate = copy.deepcopy(body(after, label))
            candidate[5] = raw
            assert asm.encode(asm.decode(raw))[0] == raw
            yield label, name, raw, check_body(after, candidate)
    code = asm.decode(body(after, HELPER)[5])
    edits = []
    for i, ins in enumerate(code):
        if ins.name == 'pushbyte' and i + 1 < len(code) and code[i + 1].name == 'setlocal':
            if code[i + 1].args in ([4], [8]):
                edits.append((i, 'pushbyte', [1], '跳过首盘' if code[i + 1].args == [4] else '跳过每盘首节点'))
        if ins.name == 'ifle':
            edits.append((i, 'iflt', None, '空盘或空节点误判满:' + str(i)))
        if ins.name == 'in' and i > 50:
            edits.append((i + 1, 'iftrue', None, '节点存在谓词反转'))
        if ins.name == 'pushtrue':
            edits.append((i, 'pushfalse', None, '全部学会仍拒绝'))
        if ins.name == 'pushfalse':
            edits.append((i, 'pushtrue', None, '缺节点误判满'))
    for index, op, args, name in edits:
        mutant = copy.deepcopy(code)
        mutant[index].op = asm.MNEMONICS[op]
        if args is not None:
            mutant[index].args = args
        raw = asm.encode(mutant)[0]
        candidate = copy.deepcopy(body(after, HELPER))
        candidate[5] = raw
        assert asm.encode(asm.decode(raw))[0] == raw
        yield HELPER, name, raw, check_body(after, candidate)
