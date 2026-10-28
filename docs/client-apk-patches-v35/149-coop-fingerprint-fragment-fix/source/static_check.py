"""AVM2 指令边界、回跳标签、异常区间、栈/作用域和局部数检查。"""
import bootstrap
import asm


def check_control_flow(ins, initial_scope, handlers):
    """补齐原simulate未拒绝的可达fall-through和作用域下溢。"""
    pending = [(0, initial_scope)] + [(i, initial_scope) for i in handlers]
    seen = set()
    while pending:
        i, scope = pending.pop()
        if not 0 <= i < len(ins):
            raise asm.AsmError('reachable control flow falls off method end')
        if (i, scope) in seen:
            continue
        seen.add((i, scope))
        item = ins[i]
        after = scope + (1 if item.op in (0x30, 0x1C) else -1 if item.op == 0x1D else 0)
        if after < initial_scope:
            raise asm.AsmError('scope underflow at instruction ' + str(i))
        if item.name == 'getscopeobject' and item.args[0] >= scope:
            raise asm.AsmError('getscopeobject outside current scope stack')
        if item.op == 0x1B:
            successors = [item.default] + list(item.cases)
        elif item.op == 0x10:
            successors = [item.target]
        elif item.op in asm.CONDITIONAL_BRANCHES:
            successors = [item.target, i + 1]
        elif item.op in (0x03, 0x47, 0x48):
            successors = []
        else:
            successors = [i + 1]
        pending.extend((target, after) for target in successors)


def check_body(abc, body):
    method = abc.methods[body[0]]
    if body[2] < len(method[1]) + 1:
        raise asm.AsmError('localcount does not hold this and all parameters')
    ins = asm.decode(body[5])
    encoded, offsets = asm.encode(ins)
    if encoded != body[5]:
        raise asm.AsmError('instruction roundtrip differs')
    starts = {offset: i for i, offset in enumerate(offsets)}
    boundaries = set(starts) | {len(encoded)}
    handlers = []
    for exc in body[6]:
        start, end, target = exc[:3]
        if start not in starts or end not in boundaries or target not in starts or start >= end:
            raise asm.AsmError('invalid exception range/target: ' + repr(exc))
        handlers.append(starts[target])
    backwards = 0
    for i, item in enumerate(ins):
        targets = ([item.target] if item.target is not None else [])
        if item.cases is not None:
            targets += [item.default] + list(item.cases)
        for target in targets:
            if not 0 <= target < len(ins):
                raise asm.AsmError(f'branch past instruction boundary: {i} -> {target}')
            if target <= i:
                backwards += 1
                if ins[target].op != 0x09:
                    raise asm.AsmError(f'backward branch has no real AVM2 label: {i} -> {target}')
    analysis = [asm.Instruction(0x02) if x.op in (0xEF, 0xF0, 0xF1) else x for x in ins]
    metrics = asm.simulate(analysis, body[3], abc.multinames, handlers)
    check_control_flow(analysis, body[3], handlers)
    if metrics[0] > body[1] or metrics[1] > body[4]:
        raise asm.AsmError(f'stack/scope exceeds header: {metrics}, {body[1:5]}')
    used_locals = asm.block_locals(ins)
    if used_locals > body[2]:
        raise asm.AsmError(f'locals exceed header: {used_locals}, {body[2]}')
    return {'instructions': len(ins), 'max_stack': metrics[0], 'max_scope': metrics[1],
            'locals_used': used_locals, 'unreachable': metrics[2],
            'backward_labels': backwards, 'exceptions': len(handlers), 'header': list(body[1:5])}


def negative_controls():
    from types import SimpleNamespace
    fake = SimpleNamespace(methods=[[0, [], 0, 0, None, None]], multinames=[None])
    cases = {'fall_off_end': [('pushbyte',1)], 'scope_underflow': [('popscope',),('returnvoid',)],
             'stack_underflow': [('pop',),('returnvoid',)],
             'scope_index': [('getscopeobject',0),('returnvalue',)]}
    results = {}
    for name, code in cases.items():
        body = [0, 2, 1, 0, 0, asm.encode(asm.assemble(code))[0], [], []]
        try:
            check_body(fake, body)
        except asm.AsmError as exc:
            results[name] = {'rejected':True,'reason':str(exc)}
        else:
            raise AssertionError('static checker accepted ' + name)
    return results
