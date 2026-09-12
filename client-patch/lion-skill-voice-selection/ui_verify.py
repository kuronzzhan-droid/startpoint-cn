"""从最终 ABC 提取的 UI 插入块执行检查。"""
from types import SimpleNamespace
import ui_block


def execute(code, abc, registers):
    pc, stack, visited = 0, [], set()
    while pc < len(code):
        visited.add(pc)
        item = code[pc]
        op, args = item.name, item.args
        pc += 1
        if op == 'getlocal_2':
            stack.append(registers[2])
        elif op == 'getlocal':
            stack.append(registers[args[0]])
        elif op == 'setlocal':
            registers[args[0]] = stack.pop()
        elif op == 'getproperty':
            stack.append(getattr(stack.pop(), abc.mn_name(args[0]).split('::')[-1]))
        elif op == 'pushint':
            stack.append(abc.ints[args[0]])
        elif op == 'pushstring':
            stack.append(abc.strings[args[0]].decode('utf-8'))
        elif op == 'newarray':
            assert args[0] == 0
            stack.append([])
        elif op == 'coerce':
            assert abc.mn_name(args[0]) == 'Array' and isinstance(stack[-1], list)
        elif op == 'ifne':
            b, a = stack.pop(), stack.pop()
            if a != b:
                pc = item.target
        elif op == 'iffalse':
            if not stack.pop():
                pc = item.target
        elif op == 'jump':
            pc = item.target
        elif op == 'callproperty':
            assert args == [8215, 1]
            path, assets = stack.pop(), stack.pop()
            stack.append(assets.existsVoiceFileReader(path))
        elif op == 'callpropvoid':
            assert args == [65, 1]
            path, values = stack.pop(), stack.pop()
            values.append(path)
        else:
            raise AssertionError('unexpected UI opcode: ' + op)
    assert not stack
    return visited


def scenarios(code, abc):
    coverage, count = set(), 0
    for cid in (119996, 119995, 119997, 149990, 169989):
        for mask in range(16):
            available = {p for i, p in enumerate(ui_block.PATHS) if mask & (1 << i)}
            original = [p for p in ui_block.PATHS[:2] if p in available]
            assets = SimpleNamespace(existsVoiceFileReader=lambda path: path in available)
            actor = SimpleNamespace(characterId=cid, logicAssets=assets)
            registers = {2: actor, 21: original, 3: object(), 22: object()}
            preserved = {key: value for key, value in registers.items() if key != 21}
            coverage.update(execute(code, abc, registers))
            expected = original
            if cid == 119996:
                old = next((p for p in ui_block.PATHS[:2] if p in available), None)
                expected = ([old] if old else []) + [p for p in ui_block.PATHS[2:] if p in available]
            else:
                assert registers[21] is original
            assert registers[21] == expected
            assert {key: value for key, value in registers.items() if key != 21} == preserved
            count += 1
    assert coverage == set(range(len(code)))
    return count
