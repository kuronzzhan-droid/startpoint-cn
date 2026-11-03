"""静态有效的真实方法字节变异；只用行为探针检出，不以哈希或插入形状判红。"""
import copy

import asm
from static_check import check_body
from .cases import body
from .patches import TARGETS, ADAPTIVE, MASK, INSERTIONS
from .runtime import world, FIXTURE
from .old_cases import KEY, LAYOUTS


def candidates(before, after):
    for label in TARGETS:
        original = asm.decode(body(after, label)[5])
        at, count = INSERTIONS[label]
        pushed_slot = at + (4 if label == ADAPTIVE else 3)
        pushed_some = at + count - 2
        branch = at + count - 1
        original_party_guard = 4 if label == ADAPTIVE else 6
        null_exit = original[original_party_guard].target
        choices = [('恢复整个v35f助手', body(before, label)[5])]
        edits = [
            (pushed_slot, 'pushbyte', [1], '首位错误改为slot1'),
            (pushed_slot, 'pushbyte', [2], '首位错误改为slot2'),
            (pushed_some, 'pushbyte', [1], 'Some枚举错误改为None'),
            (branch, 'ifeq', None, 'Some守卫比较反转'),
            (branch, 'ifge', None, '错误拒绝Some和None'),
            (original_party_guard, 'iftrue', None, '原party非空守卫反转'),
            (null_exit, 'pushbyte', [0 if label == ADAPTIVE else 1], '无队长出口返回值被破坏'),
        ]
        if label == MASK:
            index = next(i for i, x in enumerate(original) if x.name == 'pushbyte' and x.args == [31])
            edits.append((index, 'pushbyte', [7], '有队长旧掩码丢失v2位8和16'))
        for index, opcode, args, name in edits:
            code = copy.deepcopy(original)
            code[index].op = asm.MNEMONICS[opcode]
            if args is not None:
                code[index].args = args
            choices.append((name, asm.encode(code)[0]))
        choices.append(('停用整个助手', asm.encode(asm.assemble([
            ('pushbyte', 255 if label == ADAPTIVE else 0), ('returnvalue',)]))[0]))
        for name, raw in choices:
            assert asm.encode(asm.decode(raw))[0] == raw
            candidate = copy.deepcopy(body(after, label))
            candidate[5] = raw
            static = check_body(after, candidate)
            yield label, name, raw, static


def smoke_reference(before):
    reference = {}
    for layout in ('mixed', 'six_water'):
        for mask in range(32):
            _, _, mains, unisons = world(before, {KEY: str(mask)}, LAYOUTS[layout])
            reference[layout, mask] = [c['wfxPartyMask']() for c in mains + unisons]
    return reference


def smoke(after, reference):
    checks = 0

    def eq(actual, expected, name):
        nonlocal checks
        assert actual == expected, (name, actual, expected)
        checks += 1

    # Some先测，能发现误拒绝队长/旧v2行为退化；与v35f真实方法结果逐项比。
    for layout in ('mixed', 'six_water'):
        for mask in range(32):
            _, _, mains, unisons = world(after, {KEY: str(mask)}, LAYOUTS[layout])
            eq([c['wfxPartyMask']() for c in mains + unisons], reference[layout, mask],
               ('Some掩码', layout, mask))
    for slot in range(1, 7):
        table = {'wfx_adaptive_' + FIXTURE['character'][cid][0][18 + slot]: '1'
                 for cid in FIXTURE['main_ids'] + FIXTURE['unison_ids']}
        _, _, mains, unisons = world(after, table)
        eq([c['wfxAdaptiveElement']() for c in mains + unisons], [0] * 6, ('Some六槽自适应', slot))
        # 同一数据首位None时必须停止，不进入真实原生throw路径。
        for learned in (False, True):
            e, _, mains, unisons = world(after, table, first_some=False, learned=learned)
            chars = mains + unisons
            eq([c['wfxAdaptiveElement']() for c in chars], [-1] * 6, ('None自适应', slot, learned))
            eq([c['get_element']() for c in chars], [0, 1, 2, 0, 1, 3], ('None属性', slot, learned))
            eq(e.reads, [], ('None自适应提前退出', slot, learned))
    for mask in range(32):
        e, _, mains, unisons = world(after, {KEY: str(mask)}, first_some=False)
        eq([c['wfxPartyMask']() for c in mains + unisons], [0] * 6, ('None掩码', mask))
        eq(e.reads, [], ('None掩码不读表', mask))
    e, _, mains, unisons = world(after, {KEY: '31', 'wfx_adaptive_1210011': '1'})
    for char in mains + unisons:
        char['party'] = None
    eq([c['wfxAdaptiveElement']() for c in mains + unisons], [-1] * 6, 'party空自适应')
    eq([c['wfxPartyMask']() for c in mains + unisons], [0] * 6, 'party空掩码')
    return checks
