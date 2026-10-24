"""在58号原过滤方法中只插入新分支；保留全部旧指令。"""
import asm
from perf2_core import splice_with_exits

FILTER = 'MemberImpl/getConditionsIncludingOuterEnvironments'
TOTAL = 'MemberImpl/getTotalConditions'
SPEC = 'ConditionSlot$/wfxSpec'
INSERT_AT = 44


def build(e):
    body = e.body(FILTER)
    ins = asm.decode(body[5])
    assert len(ins) == 54 and body[1:5] == [3, 7, 1, 2]
    assert ins[27].name == 'ifne' and ins[27].target == INSERT_AT
    assert ins[37].name == 'iffalse' and ins[37].target == INSERT_AT
    assert [i.name for i in ins[38:44]] == [
        'getlocal', 'getproperty', 'pushstring', 'callproperty', 'pushbyte', 'ifeq']
    assert e.abc.strings[ins[40].args[0]] == b'hidden_'
    assert ins[43].target == 47
    assert [i.name for i in ins[44:48]] == [
        'getlocal_2', 'getlocal', 'callpropvoid', 'inclocal_i']
    q = e.q
    dynamic = ins[33].args[0]
    code = [
        ('getlocal', 5), ('getproperty', q('string_id')),
        e.string('wfx:'), ('callproperty', q('indexOf'), 1),
        e.number(0), ('ifne', 'SHOW'),
        ('getlocal', 5), ('getproperty', q('string_id')),
        e.string(':'), ('callproperty', q('http://adobe.com/AS3/2006/builtin::split'), 1),
        ('setlocal', 7),
        ('getlocal', 7), ('getproperty', q('length')), e.number(6), ('iflt', 'SHOW'),
        ('getlocal', 7), e.number(5), ('getproperty', dynamic),
        e.string('hidden_'), ('callproperty', q('indexOf'), 1),
        e.number(0), ('ifeq', 'HIDE'),
    ]
    # 原 #27 的非Unique和 #37 的缺表分支必须跳过新检查，直接沿原显示路径。
    # 只有原 hidden_ 前缀检查为 false 的顺序执行路径会进入本块。
    raw, exceptions, _, count = splice_with_exits(
        body, INSERT_AT, code, {'SHOW': 44, 'HIDE': 47}, asm.SKIP)
    recovery = [(INSERT_AT, count, asm.SKIP)]
    if asm.unsplice_many(raw, recovery) != body[5]:
        raise asm.AsmError('原过滤方法无法逐字节恢复')
    e.replace(FILTER, raw, exceptions)
    e.report[FILTER]['insertions'] = recovery
    return {'capability': 'wfx-hidden-unique-icons-v1',
            'filter': FILTER, 'count_unchanged': TOTAL,
            'label_segment': 6, 'prefix': 'hidden_'}
