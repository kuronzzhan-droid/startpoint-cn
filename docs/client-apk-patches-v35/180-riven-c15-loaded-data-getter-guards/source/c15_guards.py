"""Guard serialized C1-C14 Riven readers, preserving each block's native fallback."""
import asm
import bodies
from bootstrap import sha


def context_sites(editor):
    """Match the full critical suffix of the inherited context emitter."""
    labels = bodies.label_map(editor.abc)
    found = []
    for index, body in enumerate(editor.abc.bodies):
        ops = asm.decode(body[5])
        for at, op in enumerate(ops):
            if op.name != 'callproperty' or editor.abc.mn_name(op.args[0]) != 'getLoadedData':
                continue
            if at < 2 or at + 7 >= len(ops):
                continue
            if not (ops[at - 2].name == 'iffalse' and ops[at + 6].name == 'pushstring'
                    and editor.abc.s(ops[at + 6].args[0]) == 'wfx_riven'):
                continue
            assert op.args[1] == 0
            assert [x.name for x in ops[at - 4:at + 7]] == [
                'setlocal', 'getlocal', 'iffalse', 'getlocal', 'callproperty',
                'coerce_a', 'setlocal', 'getlocal', 'iffalse', 'getlocal', 'pushstring']
            assert ops[at - 4].args == ops[at - 3].args == ops[at - 1].args
            fail = ops[at - 2].target
            assert fail == ops[at + 4].target and fail > at
            found.append((labels[index], at, fail))
    assert len(found) == 216 and len({row[0] for row in found}) == 52
    return found


def insert_guard(editor, label, at, fail, kind):
    body = editor.body(label)
    ops = asm.decode(body[5])
    assert ops[at].name == 'callproperty'
    assert editor.abc.mn_name(ops[at].args[0]) == 'getLoadedData'
    assert at < fail < len(ops)
    editor.locks.setdefault(label, {'sha': sha(body[5]), 'header': list(body[1:5])})
    # The getter receiver is already on the stack. Some leaves it for the
    # existing call; None removes only that receiver and takes the block's
    # existing failure edge. Lower operands (constructors/setters) survive.
    block = asm.assemble([
        ('dup',), ('getproperty', editor.q('loadedData')),
        ('getproperty', editor.q('index')), ('pushbyte', 0),
        ('ifeq', 'END'), ('pop',), ('jump', 'END')])
    # asm.splice rebases block-relative targets; subsequent insertions rebase
    # this existing external edge again. All failure targets are forward.
    block[-1].target = fail - at + len(block)
    editor.insertions.setdefault(label, []).append((at, block, asm.ENTER))
    return {'method': label, 'instruction': at, 'fallback_instruction': fail,
            'guard': 'receiver.loadedData.index == 0 (Some)', 'kind': kind,
            'instructions': len(block), 'preserves_lower_operands': True}


def apply(editor):
    sites = context_sites(editor)
    result = [insert_guard(editor, *row, 'inherited_riven_context') for row in sites]
    label = 'PlayerLogic/applyCommonResponse'
    ops = asm.decode(editor.body(label)[5])
    assert ops[35].name == 'callproperty' and editor.abc.mn_name(ops[35].args[0]) == 'getLoadedData'
    assert [x.name for x in ops[36:39]] == ['setlocal', 'getlocal', 'iffalse']
    assert ops[38].target == 194
    result.append(insert_guard(editor, label, 35, 194, 'party_response_cache'))
    for label, at, fail, kind in [
            ('EquipmentListScene/run', 7, 16, 'restore_inventory_filter'),
            ('ExBoostWindow/run', 205, 209, 'install_window_context')]:
        result.append(insert_guard(editor, label, at, fail, kind))
    return {'guards': result, 'guard_count': len(result), 'guarded_method_count': 54,
            'none_policy': 'skip only the Riven/context or party cache extension; continue native code',
            'some_policy': 'execute the original getter and unchanged inherited extension',
            'existing_c6_scene_guard_preserved': True}
