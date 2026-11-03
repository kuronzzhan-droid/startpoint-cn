"""对真实方法字节做静态有效变异，检出完全由业务结果或真实执行异常驱动。"""
import copy
import asm
import bodies
from static_check import check_body
from perf2_core import splice_with_exits
from .patches import TARGETS
from .runtime import world, panel, battle, COUNT, KEY, enum
from .cases_element import add_element_row


def body(abc, label):
    return abc.bodies[bodies.resolve(abc, label)]


def probe(abc):
    records = []
    scenarios = [(None, 'six_water'), (1, 'mixed'), (2, 'six_water'), (9, 'six_water'),
                 (16, 'six_water'), (18, 'mixed'), (17, 'five'), (27, 'six_water'),
                 (27, 'mixed'), (27, 'five'), (31, 'six_water')]
    for mask, layout in scenarios:
        e, p, mains, unisons = world(abc, {} if mask is None else {KEY: str(mask)}, layout)
        for slot in range(3):
            records.append(e.run(COUNT, mains[slot], enum(11), p, slot, 1001000, False))
            records.append(panel(e, p, mains, slot, unisonable=False))
        add_element_row(unisons[0], 4)
        records.append(unisons[0]['get_element']())
    e, p, mains, _ = world(abc, {KEY: '27'})
    for origin in (1000, 1000000, 1000999, 1001000, 1006999, 1007000, 1021000):
        records.append(e.run(COUNT, mains[0], enum(11), p, 0, origin, False))
    for kind in (6, 7, 12):
        records.append(e.run(COUNT, mains[0], enum(kind), p, 0, 1001000, False))
        records.append(panel(e, p, mains, kinds=(kind,)))
    for number, origin_kind in ((0, 0), (1, 0), (6, 0), (7, 0), (1, 2), (1, 3), (1, 4)):
        records.append(panel(e, p, mains, number=number, origin_kind=origin_kind))
    records.append(panel(e, p, mains, unison=False))
    records.append(panel(e, p, mains, kinds=(11, enum(13, 7))))
    return records


def candidates(before, after):
    def checked(label, name, code):
        raw = asm.encode(code)[0] if not isinstance(code, bytes) else code
        assert asm.encode(asm.decode(raw))[0] == raw
        candidate = copy.deepcopy(body(after, label))
        candidate[5] = raw
        static = check_body(after, candidate)
        return label, name, raw, static
    for label in TARGETS:
        yield checked(label, '撤回该方法至v35h', bytes(body(before, label)[5]))
    own = 'BattleCharacterLogic/wfxOwnerMainUnlocked'
    eligibility = 'AbilityDisabledReasonResolver/wfxOwnAbilityUnlocked'
    pre = 'AbilityDisabledReasonResolver/wfxResolveOwnPrecondition'
    edits = [(own, 'pushshort', 1001, 1000, '来源下限错放1000000'),
             (own, 'pushshort', 1007, 1008, '来源上限错放1007000'),
             (own, 'pushbyte', 1, 2, '能力开关错读bit2'),
             (own, 'pushbyte', 8, 16, 'slot0门错读bit16'),
             (own, 'pushbyte', 0, 1, 'slot0门错选slot1'),
             (eligibility, 'pushbyte', 1, 0, '面板自身槽下限错放0'),
             (eligibility, 'pushbyte', 6, 7, '面板自身槽上限错放7'),
             (pre, 'pushbyte', 11, 12, '前置202错放203'),
             ('BattleCharacterLogic/wfxPartyMask', 'pushbyte', 16, 8, '共鸣门错读bit8'),
             ('BattleCharacterLogic/wfxPartyMask', 'pushbyte', 6, 5, '共鸣阈值降为五人')]
    for label, op, operand, replacement, name in edits:
        code = copy.deepcopy(asm.decode(body(after, label)[5]))
        found = [i for i, ins in enumerate(code) if ins.name == op and ins.args == [operand]]
        assert found, (label, name)
        code[found[0]].args = [replacement]
        yield checked(label, name, code)
    code = copy.deepcopy(asm.decode(body(after, own)[5]))
    index = next(i for i, x in enumerate(code) if x.name == 'pushtrue')
    code[index].op = asm.MNEMONICS['pushfalse']
    yield checked(own, '合格分支错误返回false', code)
    code = asm.decode(body(after, eligibility)[5])
    index = next(i for i, x in enumerate(code) if x.name == 'returnvalue')
    raw, _, _, _ = splice_with_exits(body(after, eligibility), index,
        [('pop',), ('pushfalse',)], {}, asm.FORBID)
    yield checked(eligibility, '合格面板分支错误返回false', raw)
    mask = 'BattleCharacterLogic/wfxPartyMask'
    raw, _, _, _ = splice_with_exits(body(after, mask), 52,
        [('getlocal_2',), ('pushbyte', 1), ('bitand',), ('iffalse', 'OLD')],
        {'OLD': 56}, asm.FORBID)
    yield checked(mask, '恢复仅bit1走快照造成无bit1的720递归', raw)
    # Same-signature getter substitution is valid AVM2 but recreates the real panel defect.
    for label, old, new, name in [
        (eligibility, 'get_unisonCharacters', 'get_mainCharacters', '面板错误取main-only队伍'),
        ('BattlePartyLogic/wfxSameElementBeforeOwnerMain', 'wfxCachedElementBeforeOwnerMain',
         'get_element', '共鸣快照错误回读live元素导致递归')]:
        code = copy.deepcopy(asm.decode(body(after, label)[5]))
        target = next(i for i in range(1, len(after.multinames)) if after.mn_name(i) == new)
        index = next(i for i, x in enumerate(code) if x.name == 'callproperty'
                     and after.mn_name(x.args[0]) == old)
        code[index].args[0] = target
        yield checked(label, name, code)
