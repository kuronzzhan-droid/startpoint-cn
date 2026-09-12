"""独立 ABC 解析和实际产物指令执行；不访问设备或 live 资源。"""
import argparse
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import patch
import asm
import bodies
from swfabc import SwfAbc
import ui_block
import ui_verify


def execute(instructions, abc, actor):
    """执行本 getter 全部实际 opcode，未知 opcode 即失败。"""
    pc, stack, scope, visited = 0, [], [], set()
    while pc < len(instructions):
        visited.add(pc)
        item = instructions[pc]
        op, args = item.name, item.args
        pc += 1
        if op == 'getlocal_0':
            stack.append(actor)
        elif op == 'pushscope':
            scope.append(stack.pop())
        elif op == 'findproperty':
            assert abc.mn_name(args[0]) == 'generateVoicePaths'
            stack.append(actor)
        elif op == 'getproperty':
            stack.append(getattr(stack.pop(), abc.mn_name(args[0])))
        elif op == 'pushint':
            stack.append(abc.ints[args[0]])
        elif op == 'pushstring':
            stack.append(abc.strings[args[0]].decode('utf-8'))
        elif op == 'pushbyte':
            stack.append(args[0])
        elif op == 'coerce':
            assert abc.mn_name(args[0]) == 'Array' and isinstance(stack[-1], list)
        elif op == 'dup':
            stack.append(stack[-1])
        elif op in ('ifne', 'ifeq'):
            b, a = stack.pop(), stack.pop()
            if (a != b) == (op == 'ifne'):
                pc = item.target
        elif op == 'callproperty':
            assert args[1] == 1 and abc.mn_name(args[0]) == 'generateVoicePaths'
            prefix, receiver = stack.pop(), stack.pop()
            stack.append(receiver.generateVoicePaths(prefix))
        elif op == 'callpropvoid':
            assert args[1] == 2 and abc.mn_name(args[0]) == 'http://adobe.com/AS3/2006/builtin::splice'
            count, start, values = stack.pop(), stack.pop(), stack.pop()
            del values[start:start+count]
        elif op == 'returnvalue':
            result = stack.pop()
            assert not stack and scope == [actor]
            return result, visited
        else:
            raise AssertionError('unexpected getter opcode: ' + op)
    raise AssertionError('getter did not return')


def scenarios(instructions, abc):
    cases, coverage = [], set()
    for cid in (patch.CID, 119995, 119997, 149990, 169989):
        for mask in range(128):
            present = {i for i in range(7) if mask & (1 << i)}
            native = []
            for suffix in range(7):
                if suffix not in present:
                    break
                native.append(f'character/{cid}/voice/battle/skill_{suffix}')
            expected = [path for index, path in enumerate(native)
                        if cid != patch.CID or index not in (2, 3)]
            calls = []
            def generate(prefix):
                calls.append(prefix)
                return native
            actor = SimpleNamespace(characterId=cid, generateVoicePaths=generate)
            result, visited = execute(instructions, abc, actor)
            coverage.update(visited)
            assert result == expected, (cid, mask, result, expected)
            assert result is native and calls == ['battle/skill_']
            cases.append(f'{cid}/exists-mask-{mask}')
    assert coverage == set(range(len(instructions))), coverage
    return cases


def independent_parser():
    path = patch.REPO/'client-patch/rank-scene-p2/independent/myabc.py'
    spec = importlib.util.spec_from_file_location('lion_selection_independent_abc', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify(source, final, build_report, output):
    source, final, build_report, output = map(Path, (source, final, build_report, output))
    if output.exists() or output.resolve() in {p.resolve() for p in (source, final, build_report)}:
        raise ValueError('verification output must be new and distinct')
    assert patch.sha(source.read_bytes()) == patch.BASE_SHA
    before, after = SwfAbc(source), SwfAbc(final)
    report = json.loads(build_report.read_bytes())
    assert report['output_sha256'] == patch.sha(final.read_bytes())
    parser = independent_parser()
    a, b = parser.parse_abc(before._raw), parser.parse_abc(after._raw)
    for key in a:
        if key not in ('bodies', 'end'):
            assert a[key] == b[key], key
    index = bodies.resolve(after.abc, patch.TARGET)
    assert report['body_index'] == index
    changed = [i for i, (old, new) in enumerate(zip(a['bodies'], b['bodies'])) if old != new]
    ui_index = bodies.resolve(after.abc, ui_block.TARGET)
    assert len(a['bodies']) == len(b['bodies']) and set(changed) == {index, ui_index}
    old, new = a['bodies'][index], b['bodies'][index]
    assert patch.sha(old['code']) == patch.BODY_SHA
    assert old['maxstack'] == 2 and new['maxstack'] == 4
    for key in ('method', 'localcount', 'initscope', 'maxscope', 'ex', 'traits'):
        assert old[key] == new[key], key
    assert report['insertions'] == [[6, 8, 'enter']]
    assert asm.unsplice_many(new['code'], report['insertions']) == old['code']
    ui_old, ui_new = a['bodies'][ui_index], b['bodies'][ui_index]
    assert report['ready_ui']['body_index'] == ui_index
    assert patch.sha(ui_old['code']) == ui_block.BODY_SHA
    assert report['ready_ui']['insertions'] == [[213, 40, 'enter']]
    for key in ('method', 'maxstack', 'localcount', 'initscope', 'maxscope', 'ex', 'traits'):
        assert ui_old[key] == ui_new[key], key
    assert asm.unsplice_many(ui_new['code'], report['ready_ui']['insertions']) == ui_old['code']
    assert before.body[:before._offset] == after.body[:after._offset]
    assert before.body[before._offset+before._length:] == after.body[after._offset+after._length:]
    instructions = asm.decode(new['code'])
    cases = scenarios(instructions, after.abc)
    ui_instructions = asm.decode(ui_new['code'])
    ui_slice = [asm.Instruction(x.op, x.args, target=None if x.target is None else x.target-213)
                for x in ui_instructions[213:253]]
    ui_cases = ui_verify.scenarios(ui_slice, after.abc)
    unchanged_hashes = {str(i): patch.sha(body['code']) for i, body in enumerate(a['bodies'])
                        if i not in (index, ui_index)}
    hash_file = output.parent/'unchanged-method-sha256.json'
    if hash_file.exists():
        raise ValueError('method hash evidence already exists')
    hash_file.write_text(json.dumps(unchanged_hashes, separators=(',', ':'))+'\n', encoding='utf-8')
    result = dict(status='static_verified_runtime_pending', case_count=len(cases)+ui_cases,
        skill_case_count=len(cases), ready_ui_case_count=ui_cases,
        changed_methods=[patch.TARGET, ui_block.TARGET], changed_body_indices=[index,ui_index],
        unchanged_method_bodies=len(unchanged_hashes),
        immutable_method_hash_manifest=str(hash_file), immutable_method_hash_manifest_sha256=patch.sha(hash_file.read_bytes()),
        original_pools_classes_scripts_traits_preserved=True, original_getter_instructions_preserved=True,
        non_abc_swf_bytes_preserved=True, target_maxstack_change=[2,4], inserted_instruction_counts=[8,40],
        source_sha256=patch.BASE_SHA, output_sha256=patch.sha(final.read_bytes()),
        current_seven_assets_select_suffixes=[0,1,4,5,6], native_missing_asset_stop_preserved=True,
        ready_ui_paths=[ui_block.PATHS[i] for i in (0,2,3)], ready_ui_missing_normal_falls_back_to_old_alias=True,
        battle_ready_home_matched_and_other_methods_unchanged=True, device_or_store_writes=False)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'final', 'build_report', 'output'):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.source, args.final, args.build_report, args.output), ensure_ascii=False))
