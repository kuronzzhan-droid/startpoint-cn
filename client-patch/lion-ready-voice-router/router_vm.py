"""Execute the actual inserted AVM2 subset for independent branch testing."""
from types import SimpleNamespace as Obj


def execute(instructions, abc, registers):
    pc, stack, visited = 0, [], set()
    def name(index): return abc.mn_name(index).split('::')[-1]
    while pc < len(instructions):
        visited.add(pc)
        instruction = instructions[pc]; op, args = instruction.name, instruction.args; pc += 1
        if op.startswith('getlocal_'): stack.append(registers[int(op[-1])])
        elif op == 'getlocal': stack.append(registers[args[0]])
        elif op.startswith('setlocal_'): registers[int(op[-1])] = stack.pop()
        elif op == 'setlocal': registers[args[0]] = stack.pop()
        elif op == 'getproperty':
            if args[0] == 14:
                key, obj = stack.pop(), stack.pop(); stack.append(obj[key])
            else: stack.append(getattr(stack.pop(), name(args[0])))
        elif op == 'setproperty':
            value, obj = stack.pop(), stack.pop(); setattr(obj, name(args[0]), value)
        elif op == 'pushstring': stack.append(abc.strings[args[0]].decode('utf-8'))
        elif op == 'pushint': stack.append(abc.ints[args[0]])
        elif op == 'pushbyte': stack.append(args[0])
        elif op == 'getlex':
            if args[0] != 79: raise AssertionError('unexpected global lookup')
            stack.append(Obj(Some=lambda path: Obj(index=0, params=[path])))
        elif op in ('callproperty', 'callpropvoid'):
            values = [stack.pop() for _ in range(args[1])][::-1]
            result = getattr(stack.pop(), name(args[0]))(*values)
            if op == 'callproperty': stack.append(result)
        elif op in ('coerce', 'coerce_a'): pass
        elif op == 'jump': pc = instruction.target
        elif op in ('ifeq', 'ifne'):
            b, a = stack.pop(), stack.pop()
            if (a == b) == (op == 'ifeq'): pc = instruction.target
        elif op in ('iftrue', 'iffalse'):
            if bool(stack.pop()) == (op == 'iftrue'): pc = instruction.target
        else: raise AssertionError('unexpected opcode ' + op)
    assert not stack, stack
    return visited
