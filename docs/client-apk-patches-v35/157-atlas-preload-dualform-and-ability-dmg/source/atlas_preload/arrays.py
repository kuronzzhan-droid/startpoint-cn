"""Read a literal animation array and prove that its entry is unconditional."""
import asm


def animation_array(abc, ops, anchor):
    start, end = anchor, anchor
    while start > 0 and ops[start - 1].name == 'pushstring':
        start -= 1
    while end < len(ops) and ops[end].name == 'pushstring':
        end += 1
    paths = [abc.s(op.args[0]) for op in ops[start:end]]
    if (start == 0 or end + 1 >= len(ops)
            or ops[start - 1].name != 'findproperty'
            or abc.mn_name(ops[start - 1].args[0]) != 'addAnimationLayouts'
            or ops[end].name != 'newarray' or ops[end].args != [len(paths)]
            or ops[end + 1].name != 'callpropvoid'
            or abc.mn_name(ops[end + 1].args[0]) != 'addAnimationLayouts'
            or ops[end + 1].args[1:] != [1]):
        raise asm.AsmError('unknown animation array structure')
    return start - 1, end, paths


def require_unconditional(ops, entry):
    """Reject any normal return reachable while bypassing this array entry."""
    pending, seen = [0], set()
    while pending:
        index = pending.pop()
        if index in seen or index == entry:
            continue
        if not 0 <= index < len(ops):
            raise asm.AsmError('unexpected common-assets CFG boundary')
        seen.add(index)
        op = ops[index]
        if op.name in ('returnvoid', 'returnvalue'):
            raise asm.AsmError('animation array is conditional, not a global preload')
        if op.name == 'throw':
            continue
        if op.cases is not None:
            pending.extend([op.default, *op.cases])
        elif op.name == 'jump':
            pending.append(op.target)
        elif op.target is not None:
            pending.extend([op.target, index + 1])
        else:
            pending.append(index + 1)
