"""每项为可编码、可静态校验的语义破坏；不用哈希变化代替检出。"""
import copy

import asm
import bodies
from static_check import check_body
from .patches import MASK, LEADERS, OPTIONS, TARGETS
from .runtime import world
from .cases import KEY, LAYOUTS


def body(abc, label):
    return abc.bodies[bodies.resolve(abc, label)]


def candidates(before, after):
    for label in TARGETS:
        check_body(after, body(before, label))
        yield label, '恢复整个v35e方法', body(before, label)[5]
    edits = [
        (MASK, 41, 'pushbyte', 8, '共鸣位错读为8'),
        (MASK, 43, 'iftrue', None, '共鸣位守卫反转'),
        (MASK, 47, 'pushbyte', 5, '共鸣阈值降为5'),
        (MASK, 48, 'ifle', None, '共鸣阈值错误拒绝6'),
        (MASK, 48, 'ifge', None, '共鸣比较反转'),
        (MASK, 51, 'pushbyte', 7, '返回掩码丢掉新增位'),
        (LEADERS, 35, 'pushbyte', 1, '队长技开关错读bit1'),
        (LEADERS, 39, 'pushbyte', 16, '队长技范围错读bit16'),
        (LEADERS, 41, 'iftrue', None, '队长技范围守卫反转'),
        (LEADERS, 44, 'pushbyte', 1, '队长技允许位置错为slot1'),
        (LEADERS, 45, 'ifeq', None, '队长技位置比较反转'),
        (OPTIONS, 88, 'pushbyte', 16, '能力范围错读bit16'),
        (OPTIONS, 90, 'iftrue', None, '能力范围守卫反转'),
        (OPTIONS, 93, 'pushbyte', 1, '能力允许位置错为slot1'),
        (OPTIONS, 94, 'ifne', None, '能力位置比较反转'),
        (OPTIONS, 96, 'pushbyte', 1, '受限合击仍放开能力'),
        (OPTIONS, 97, 'pushbyte', 2, '能力开关错读bit2'),
    ]
    for label, index, opcode, operand, reason in edits:
        code = copy.deepcopy(asm.decode(body(after, label)[5]))
        code[index].op = asm.MNEMONICS[opcode]
        if operand is not None:
            code[index].args = [operand]
        raw = asm.encode(code)[0]
        assert asm.encode(asm.decode(raw))[0] == raw
        candidate = copy.deepcopy(body(after, label))
        candidate[5] = raw
        check_body(after, candidate)
        yield label, reason, raw


def option_ids(char):
    return [(item['index'], item['params'][0]['number'], item['params'][0]['id'])
            if item['index'] == 0 else (1,)
            for item in char['getOpitionAbilitiesWithoutAbilitySoul']()]


def smoke_reference(before):
    expected = {}
    for mask in range(8):
        e, p, mains, _ = world(before, {KEY: str(mask)}, LAYOUTS['mixed'], restricted=True)
        expected[mask] = [option_ids(char) for char in mains]
    return expected


def smoke(after, reference):
    checks = 0
    for mask, layout in [(1, 'mixed'), (2, 'mixed'), (7, 'mixed'), (8, 'mixed'),
                         (9, 'mixed'), (10, 'mixed'), (15, 'mixed'), (16, 'mixed'),
                         (17, 'mixed'), (27, 'five'), (27, 'six_water'), (31, 'six_water')]:
        e, p, mains, unisons = world(after, {KEY: str(mask)}, LAYOUTS[layout], restricted=True)
        allowed = not(mask & 16) or layout == 'six_water'
        for slot, char in enumerate(mains):
            actual_mask = char['wfxPartyMask']()
            assert actual_mask == (mask if allowed else 0), ('mask', mask, layout, slot, actual_mask)
            bits = (mask & 7) if allowed else 0
            if mask & 8 and slot:
                bits &= 4
            actual = option_ids(char)
            assert actual == reference[bits][slot], ('options', mask, layout, slot, actual)
            leaders = [[row[0]['id'], row[2]] for row in char['wfxExtraLeaders']()]
            expected = []
            if allowed and mask & 4 and slot:
                expected.append([char['id'], 22000 + slot * 1000])
            if allowed and mask & 2 and (slot == 0 or not(mask & 8)):
                expected.append([unisons[slot]['id'], 1021000 + slot * 1000])
            assert leaders == expected, ('leaders', mask, layout, slot, leaders, expected)
            checks += 3
    return checks
