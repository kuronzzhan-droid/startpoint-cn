"""最终真实指令语义变异；每个候选编码后通过同一静态检查再执行。"""
import copy
import asm
import bodies
from static_check import check_body
from .patches import HELPER, SCHEDULE, SPEC


def candidates(before, after):
    result = []

    def original(label, abc=after):
        return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])

    def add(name, label, ins, at=None):
        raw, _ = asm.encode(ins)
        canonical = asm.decode(raw)
        assert asm.encode(canonical)[0] == raw
        body = copy.deepcopy(after.bodies[bodies.resolve(after, label)])
        body[5] = raw
        static = check_body(after, body)
        result.append((name, label, canonical, at, static))

    def edit(name, label, at, opcode=None, args=None):
        code = original(label)
        if opcode is not None:
            code[at].op = asm.MNEMONICS[opcode]
        if args is not None:
            code[at].args = args
        add(name, label, code, at)

    add('restore_v35j_schedule', SCHEDULE, original(SCHEDULE, before))
    add('restore_v35j_parser', SPEC, original(SPEC, before))
    add('disable_helper', HELPER, asm.assemble([('getlocal_0',), ('pushscope',), ('pushbyte', 0), ('returnvalue',)]))
    h = original(HELPER)
    assert len(h) == 82
    edits = [
        ('wrong_effect_code', 4, None, [32]),
        ('omit_invisible_and_squad', 5, 'pushfalse', None),
        ('k_zero_gate', 25, 'ifge', None),
        ('use_k_plus_one', 28, 'add', None),
        ('wrong_cap_field', 43, None, [0]),
        ('cap_nonpositive_gate', 48, 'ifgt', None),
        ('cap_min_becomes_max', 51, 'iflt', None),
        ('wrong_base_field', 56, None, [1]),
        ('wrong_holder_layers_field', 59, None, [2]),
        ('base_layer_multiply', 61, 'add', None),
        ('wrong_per_field', 63, None, [4]),
        ('per_k_multiply', 66, 'add', None),
        ('base_per_sum', 67, 'subtract', None),
        ('state_sum', 68, 'subtract', None),
        ('negative_clamp', 77, 'ifge', None),
    ]
    for name, at, opcode, args in edits:
        edit(name, HELPER, at, opcode, args)
    spec = original(SPEC)
    gates = [i for i, item in enumerate(spec) if item.name == 'pushbyte' and item.args == [33]]
    assert len(gates) == 2
    for at, field in zip(gates, ('base', 'cap')):
        edit('parser_wrong_code_' + field, SPEC, at, args=[34])
        assert spec[at+1].name == 'ifne'
        edit('parser_inverted_code_' + field, SPEC, at+1, opcode='ifeq')
    schedule = original(SCHEDULE)
    at = next(i for i, item in enumerate(schedule)
              if item.name == 'callproperty' and after.mn_name(item.args[0]) == 'wfxDirectTargetCount')
    # 数值、消费和最大次数统计分别检出，避免只验证helper公式。
    assert schedule[at+6].name == 'add'
    edit('subtract_extra_from_native', SCHEDULE, at+6, opcode='subtract')
    assert schedule[at+3].name == 'iffalse'
    edit('invert_extra_consumption', SCHEDULE, at+3, opcode='iftrue')
    maximum = next(i for i in range(at, at+30) if schedule[i].name == 'ifnlt')
    edit('skip_maximum_statistics', SCHEDULE, maximum, opcode='iflt')
    return result
