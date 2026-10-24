"""有效可编码的语义反例：过滤门控、段号、前缀、计数同源与label误读。"""
import copy
import asm
import bodies
from hidden_icons.runtime import LIST, TOTAL, SPEC

FLIPS = {'ifne': 'ifeq', 'ifeq': 'ifne', 'iflt': 'ifge', 'iffalse': 'iftrue'}


def candidates(before, after):
    result = []

    def code(abc, label):
        return asm.decode(abc.bodies[bodies.resolve(abc, label)][5])

    def add(name, label, changed, at=None):
        raw, _ = asm.encode(changed)
        canonical = asm.decode(raw)
        assert asm.encode(canonical)[0] == raw
        result.append((name, label, canonical, at))

    original = code(after, LIST)
    assert len(original) == 76
    add('restore_v35d_filter', LIST, code(before, LIST))
    add('filter_return_empty', LIST, asm.assemble([('newarray', 0), ('returnvalue',)]))
    for at in (27, 37, 43, 49, 58, 65, 73):
        changed = copy.deepcopy(original)
        changed[at].op = asm.MNEMONICS[FLIPS[changed[at].name]]
        add(f'branch_flip.{at}', LIST, changed, at)
    for at, target, name in [(27, 44, 'nonunique_enters_new_check'),
                              (37, 44, 'missing_row_enters_new_check'),
                              (43, 66, 'legacy_hidden_is_shown'),
                              (49, 69, 'nonwfx_is_hidden'),
                              (58, 69, 'short_wfx_is_hidden'),
                              (65, 66, 'new_hidden_is_shown')]:
        changed = copy.deepcopy(original)
        changed[at].target = target
        add(name, LIST, changed, at)
    for at, values in [(42, [1]), (48, [1, 255]), (57, [5, 7]),
                        (60, [0, 1, 2, 3, 4, 6]), (64, [1, 255])]:
        for value in values:
            changed = copy.deepcopy(original)
            changed[at].args = [value]
            add(f'number.{at}.{value}', LIST, changed, at)
    string_index = {item: index for index, item in enumerate(after.strings)}
    for at, text in [(46, b'wfx'), (46, b'hidden_'), (52, b'|'),
                     (62, b'wfx:'), (62, b'')]:
        changed = copy.deepcopy(original)
        changed[at].args = [string_index[text]]
        add(f'string.{at}.{text.decode()}', LIST, changed, at)
    total = code(after, TOTAL)
    # 58号已改成过滤列表.length；负对照恢复原槽未过滤总数，须被隐藏/混合案例检出。
    add('page_count_uses_unfiltered_slot', TOTAL, asm.assemble([
        ('getlocal_0',), ('getproperty', total[3].args[0]), ('pushfalse',),
        ('callproperty', total[5].args[0], 1), ('returnvalue',)]))
    spec = code(after, SPEC)
    assert spec[147].name == 'pushbyte' and spec[147].args == [1]
    changed = copy.deepcopy(spec)
    changed[147].args = [5]
    add('wfx_parser_erroneously_reads_label', SPEC, changed, 147)
    return result
