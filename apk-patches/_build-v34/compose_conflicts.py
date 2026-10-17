"""v33/R4 single-method P-code composition; exported patcher adapters.

Original game-class instructions remain recoverable with unsplice_many. No
class recompilation or input-pin weakening is performed by these adapters.
"""
from __future__ import annotations
import copy

RANKS = 'pinball.scene.character.characterTable::CharacterTable/applyCharacters|1'
CELLS = 'pinball.scene.character.characterTable::CharacterTable/updateCells|1'
PRESENT = 'pinball.scene.character.characterTable::CharacterTableView/present|1'
PATCH = 'pinball.scene.character.characterTable::CharacterTableView/applyPatch|1'
V33_PINS = {
    RANKS: 'cc8f9aff1df3b621da06717d1cb401d93942ef2a6607978659544d97bdd85945',
    CELLS: '917156e5da4c81f2d395de7a76739eee259217f906fad883120ed91a8326fb8b',
    PRESENT: '4d056fc151a6fe4d85a32ef408dc6ba7e79c9f41d1d8a3b80d12fff393091530',
    PATCH: 'ef807c15a01668ec1b6ad0f3b64a368a8ce22965b3f614c68a8d7defee8c8591',
}


def finish(s, abc, label, index, original, edits, logic):
    body = abc.bodies[index]
    body[5], body[6], _, placed = s.m.asm.splice_many(body, edits)
    assert s.m.asm.unsplice_many(body[5], placed) == original[5]
    check = s.m.check_body(body, abc)
    body[1] = max(body[1], check['max_stack'])
    body[4] = max(body[4], check['max_scope'])
    return {'body': index, 'method': label, 'kind': 'v33-r4-reversible-composition',
            'input_code_sha256': s.sha(original[5]), 'output_code_sha256': s.sha(body[5]),
            'insertion_reversible': True, 'placed_insertions': placed,
            'original_header': original[:5], 'check': check, 'composition_logic': logic}


def compose_ranks(data_module, abc):
    """Keep v33 linear reorder; cache R4 ranks only on anomalous-length fallback."""
    p = data_module
    s = p.s
    index, body = p.label_body(abc, RANKS)
    original = copy.deepcopy(body)
    assert s.sha(body[5]) == V33_PINS[RANKS]
    rows = s.m.asm.decode(body[5])
    v = p.view(abc)
    assert len(rows) == 317 and body[2] == 17 and not body[6]
    assert rows[274].op == 0x14 and rows[274].target == 293
    assert rows[293].op == 0x5e and v.mn(rows[293].args[0])[-1] == 'characterCells'
    assert rows[295].op == 0x66 and v.mn(rows[295].args[0])[-1] == '_keys'
    assert rows[296].op == 0x5d and v.mn(rows[296].args[0])[-1] == 'BindImpl3_2'
    assert rows[304].op == 0x4f and v.mn(rows[304].args[0])[-1] == 'sort'
    assert rows[194].op == 0x11 and rows[194].target == 203
    helper = p.q(abc, 'cn.optimize.data', 'DataOptimization')
    block = s.m.asm.assemble([
        ('getlex', helper), ('getlex', helper), ('getlocal', 5),
        ('callproperty', p.q(abc, '', 'ranks'), 1),
        ('callproperty', p.q(abc, '', 'rankComparator'), 1),
        ('pushtrue',), ('iftrue', 'END'), ('pop',),
    ])
    block[6].target = len(block) + (304 - 296)
    return finish(s, abc, RANKS, index, original, [(296, block, s.m.asm.ENTER)],
                  '保留 v33 局部可见集合、正常线性重排及长度异常分支；仅在异常长度排序路径上，以 R4 首次索引 ranks/rankComparator 替代反复 indexOf 的 Bind 比较器。原比较器字节保留，可逆摘除插入块。')


def compose_ui(ui_module, abc, label):
    """Add UI helper hooks without re-enabling v33 skipped debug expressions."""
    p = ui_module
    s = p.s
    v = p.view(abc)
    index, = v.by_label[label]
    body = abc.bodies[index]
    original = copy.deepcopy(body)
    assert label in (CELLS, PRESENT, PATCH)
    assert s.sha(body[5]) == V33_PINS[label]
    if label == CELLS:
        rows = s.m.asm.decode(body[5])
        assert len(rows) == 129 and not body[6]
        assert rows[101].op == 0x68 and v.mn(rows[101].args[0])[-1] == 'alpha'
        assert rows[102].op == 0x62 and tuple(rows[102].args) == (5,)
        assert rows[121].op == 0x62 and tuple(rows[121].args) == (5,)
        assert rows[122].op == 0x4f and v.mn(rows[122].args[0])[-1] == 'update'
        assert rows[127].op == 0x15 and rows[127].target == 22
        block = s.m.asm.assemble(p.call_rows(abc, 'shouldUpdateCell', [0, 5]) + [
            ('iftrue', 'END'), ('jump', 'END'),
        ])
        block[-2].target = len(block) + (121 - 102)
        block[-1].target = len(block) + (123 - 102)
        edits = [(102, block, s.m.asm.ENTER)]
        logic = ('先执行 v33 原 z/alpha 同步，再使用 R4 shouldUpdateCell 决定执行原 update 或继续循环；'
                 '保留稳定远屏省帧，并让入退场、非 usual、气泡等完成敏感状态可更新。'
                 '旧远屏 guard 保留为可逆字节，但新执行路径不再与旧 guard 取交集，避免旧 guard 吞掉存活性更新。')
    elif label == PRESENT:
        block = s.m.asm.assemble(p.call_rows(abc, 'present', [0, 1]) + [('iffalse', 'END'), ('returnvoid',)])
        edits = [(2, block, s.m.asm.ENTER)]
        logic = '沿用 R4 增量 present hook，原 v33 日志参数求值跳过和正常绑定回退字节保留；CharacterTableView/draw 的每帧三格上限不改。'
    else:
        block = s.m.asm.assemble(p.call_rows(abc, 'invalidatePatch', [0, 1]) + [('pop',)])
        edits = [(2, block, s.m.asm.ENTER)]
        logic = '先失效 R4 行快照，再执行 v33 原 applyPatch；保留 v33 无效日志求值跳过。'
    return finish(s, abc, label, index, original, edits, logic)

