"""直接变异最终SWF解码指令，覆盖接入点、门控、比较、数值与算术。"""
import copy
import asm
import bodies

FACTOR = 'MemberImpl/wfxDirectFactor'
SPEC = 'ConditionSlot$/wfxSpec'
HELPER = 'MemberImpl/wfxDirectTargetUnique'
FLIPS = {'ifeq': 'ifne', 'ifne': 'ifeq', 'iflt': 'ifge', 'ifge': 'iflt',
         'ifle': 'ifgt', 'ifgt': 'ifle', 'iftrue': 'iffalse', 'iffalse': 'iftrue',
         'ifngt': 'ifgt', 'ifnlt': 'iflt', 'ifnge': 'ifge', 'ifnle': 'ifle'}


def candidates(before, after):
    result = []

    def code(abc, label):
        return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])

    def add(name, label, changed, at=None):
        # 编码再解码，确保执行的不是解释器独有的不可序列化Instruction对象。
        raw, _ = asm.encode(changed)
        canonical = asm.decode(raw)
        assert asm.encode(canonical)[0] == raw
        result.append((name, label, canonical, at))

    for label in (FACTOR, SPEC):
        add('restore_v35c.' + label, label, code(before, label))
    add('disable_helper.zero', HELPER, asm.assemble([('pushbyte', 0), ('returnvalue',)]))
    for label in (HELPER, FACTOR):
        original = code(after, label)
        for at, ins in enumerate(original):
            if ins.name in FLIPS:
                changed = copy.deepcopy(original)
                changed[at].op = asm.MNEMONICS[FLIPS[ins.name]]
                add(f'flip.{label}.{at}.{ins.name}', label, changed, at)
            if label == HELPER and ins.name in ('pushbyte', 'pushshort', 'pushint'):
                changed = copy.deepcopy(original)
                value = after.ints[ins.args[0]] if ins.name == 'pushint' else ins.args[0]
                # N>0 ? N : 1 的边界0改1对整数域完全等价；改-1才是有差异的反例。
                replacement = -1 if value == 0 and original[at + 1].name == 'ifgt' else value + 1
                changed[at] = asm.Instruction(asm.MNEMONICS['pushbyte'], [replacement & 255])
                add(f'number.{label}.{at}.{value}_to_{replacement}', label, changed, at)
            if label == HELPER and ins.name in ('add', 'multiply'):
                changed = copy.deepcopy(original)
                changed[at].op = asm.MNEMONICS['subtract' if ins.name == 'add' else 'add']
                add(f'arithmetic.{label}.{at}.{ins.name}', label, changed, at)
            if label == HELPER and ins.name == 'pushtrue':
                changed = copy.deepcopy(original)
                changed[at].op = asm.MNEMONICS['pushfalse']
                add(f'holder_scope.{label}.{at}', label, changed, at)
    # 只变异新插入的两个码门控，既有解析规则由旧数据逐项对照保护。
    original = code(after, SPEC)
    for at, ins in enumerate(original):
        if ins.name == 'pushbyte' and ins.args[0] in (28, 29):
            changed = copy.deepcopy(original)
            changed[at].args = [27]
            add(f'spec_gate_code.{ins.args[0]}', SPEC, changed, at)
            assert original[at + 1].name == 'ifeq'
            changed = copy.deepcopy(original)
            changed[at + 1].op = asm.MNEMONICS['ifne']
            add(f'spec_gate_compare.{ins.args[0]}', SPEC, changed, at + 1)
    # 保持调用与栈形状，单独截断消费结果，而非仅改变夹具返回值。
    body = after.bodies[bodies.resolve(after, FACTOR)]
    original = asm.decode(body[5])
    at = next(i for i, ins in enumerate(original) if ins.name == 'callproperty'
              and after.mn_name(ins.args[0]) == 'wfxDirectTargetUnique')
    changed, _, _ = asm.splice(body, at + 1, asm.assemble([('pop',), ('pushbyte', 0)]), asm.ENTER)
    add('disable_factor_consumption', FACTOR, asm.decode(changed), at)
    # 调用原生Unique枚举时故意改UID索引：通过真实native匹配链检出。
    original = code(after, HELPER)
    for at, ins in enumerate(original):
        if ins.name == 'callproperty' and after.mn_name(ins.args[0]) == 'Unique':
            assert original[at - 3].name == 'pushbyte' and original[at - 3].args == [0]
            changed = copy.deepcopy(original)
            changed[at - 3].args = [2]
            add(f'wrong_target_uid.{at}', HELPER, changed, at - 3)
    return result
