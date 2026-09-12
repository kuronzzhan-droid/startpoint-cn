"""Independent ABC structure diff plus actual inserted-opcode execution."""
import argparse
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace as Obj

import patch
import asm
import router_blocks as blocks
from router_vm import execute
from swfabc import SwfAbc


def independent_parser():
    path = patch.REPO / 'client-patch/rank-scene-p2/independent/myabc.py'
    spec = importlib.util.spec_from_file_location('lion_independent_abc', path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def scenarios(ready, preload, abc):
    cases, coverage = [], set()
    slots = (blocks.NORMAL_SLOT, blocks.MATCHED_SLOT)
    for mask in range(4):
        available = {path for i, path in enumerate(blocks.ALT_PATHS) if mask & (1 << i)}
        for normal in (0, 1):
            for matched in (0, 1):
                for selected in (None, *blocks.BASE_PATHS, 'native_future_path'):
                    for native_condition in (False, True):
                        character = Obj(mainCharacterStringId=blocks.CODE,
                            logic=Obj(logicAssets=Obj(existsVoiceFileReader=lambda path: path in available)))
                        hud = Obj(character=character, **dict(zip(slots, (normal, matched))),
                                  geraldReadyNext=3, wtsReadyNormalNext=1, wtsReadyFeverNext=0)
                        original = Obj(index=1, params=None) if selected is None else Obj(index=0, params=[selected])
                        registers = {0: hud, 3: native_condition, 4: original}
                        coverage.update(execute(ready, abc, registers))
                        expected = selected; state = [normal, matched]
                        if selected in blocks.BASE_PATHS:
                            index = blocks.BASE_PATHS.index(selected)
                            if state[index] and blocks.ALT_PATHS[index] in available: expected = blocks.ALT_PATHS[index]
                            state[index] = 1 - state[index]
                        actual = None if registers[4].index == 1 else registers[4].params[0]
                        assert actual == expected, (mask, selected, state, actual, expected)
                        assert [getattr(hud, slot) for slot in slots] == state
                        assert registers[3] == native_condition
                        assert (hud.geraldReadyNext, hud.wtsReadyNormalNext, hud.wtsReadyFeverNext) == (3, 1, 0)
                        if expected == selected: assert registers[4] is original
                        cases.append(f'Lion/mask{mask}/{normal}{matched}/{selected}/conditional{native_condition}')
    for other in ('white_tiger_summer', 'unicorn_lancer_rose', 'lion_swordman', 'lion_swordman_reborn_ex', 'seris_dragon_king'):
        native = Obj(index=0, params=[blocks.BASE_PATHS[0]])
        hud = Obj(character=Obj(mainCharacterStringId=other), **dict(zip(slots, (0, 1))))
        regs = {0: hud, 4: native}
        coverage.update(execute(ready, abc, regs))
        assert regs[4] is native and [getattr(hud, x) for x in slots] == [0, 1]
        cases.append('unrelated/' + other)
    # Switching normal/matched preserves independent cadence and separate HUDs.
    def hud():
        return Obj(character=Obj(mainCharacterStringId=blocks.CODE,
            logic=Obj(logicAssets=Obj(existsVoiceFileReader=lambda path: True))), **dict(zip(slots, (0, 0))))
    a, b = hud(), hud(); observed=[]
    events = [(a, 0), (a, 1), (a, 0), (a, 1), (b, 0), (a, 0), (b, 0)]
    for owner, phase in events:
        regs = {0: owner, 4: Obj(index=0, params=[blocks.BASE_PATHS[phase]])}
        execute(ready, abc, regs); observed.append(regs[4].params[0])
    assert observed == [blocks.BASE_PATHS[0], blocks.BASE_PATHS[1], *blocks.ALT_PATHS,
                        blocks.BASE_PATHS[0], blocks.BASE_PATHS[0], blocks.ALT_PATHS[0]]
    cases.append('independent_HUD_and_state_cadence')
    preload_coverage = set()
    for cid in (blocks.CID, 149990, 129992, 169999):
        for mask in range(4):
            available = {path for i, path in enumerate(blocks.ALT_PATHS) if mask & (1 << i)}; loaded=[]
            regs = {1: Obj(addSoundEffect=loaded.append), 5: Obj(characterId=cid,
                logicAssets=Obj(existsVoiceFileReader=lambda path: path in available))}
            preload_coverage.update(execute(preload, abc, regs))
            assert loaded == ([path for path in blocks.ALT_PATHS if path in available] if cid == blocks.CID else [])
            cases.append(f'preload/{cid}/{mask}')
    assert coverage == set(range(len(ready)))
    assert preload_coverage == set(range(len(preload)))
    return cases


def verify(source, final, build_report, output):
    source, final, build_report, output = map(Path, (source, final, build_report, output))
    assert patch.sha(source.read_bytes()) == patch.BASE_SHA
    before, after = SwfAbc(source), SwfAbc(final)
    report = json.loads(build_report.read_bytes())
    assert report['output_sha256'] == patch.sha(final.read_bytes())
    parser = independent_parser()
    a, b = parser.parse_abc(before._raw), parser.parse_abc(after._raw)
    for key in ('methods', 'metadata', 'classes', 'scripts'): assert a[key] == b[key], key
    for key, old in a['pools'].items():
        assert old == b['pools'][key][:len(old)], key
        if key not in ('strs', 'mns', 'ints'): assert old == b['pools'][key], key
    changed_classes = [i for i, (x, y) in enumerate(zip(a['instances'], b['instances'])) if x != y]
    assert len(a['instances']) == len(b['instances']) and len(changed_classes) == 1
    assert after.abc.mn_name(after.abc.instances[changed_classes[0]][0]) == 'pinball.scene.battle.battle.hud::HudMemberStatus'
    old, new = a['instances'][changed_classes[0]], b['instances'][changed_classes[0]]
    assert old[:6] == new[:6] and old[6] == new[6][:-2]
    for trait, name in zip(new[6][-2:], (blocks.NORMAL_SLOT, blocks.MATCHED_SLOT)):
        assert after.abc.mn_name(trait[0]) == name and trait[1] == 0 and trait[2] == (0, 38, 0, 0)
    changed = [i for i, (x, y) in enumerate(zip(a['bodies'], b['bodies'])) if x != y]
    assert changed == [58960, 92290] and len(a['bodies']) == len(b['bodies'])
    chunks = {}
    for detail in report['changed_methods']:
        index = detail['body_index']; old, new = a['bodies'][index], b['bodies'][index]
        for key in ('method', 'maxstack', 'localcount', 'initscope', 'maxscope', 'ex', 'traits'): assert old[key] == new[key]
        assert asm.unsplice_many(new['code'], detail['insertions']) == old['code']
        at, count, policy = detail['insertions'][0]; assert policy == 'enter'
        instructions = asm.decode(after.abc.bodies[index][5])
        chunks[detail['method']] = [asm.Instruction(x.op, x.args, target=None if x.target is None else x.target-at)
                                  for x in instructions[at:at+count]]
    assert before.body[:before._offset] == after.body[:after._offset]
    assert before.body[before._offset+before._length:] == after.body[after._offset+after._length:]
    cases = scenarios(chunks['HudMemberStatus/update'], chunks['BattleCharacterLogic/resolveFollowingPathCollection'], after.abc)
    result = dict(status='static_verified_runtime_pending', case_count=len(cases), cases=cases,
        only_two_bodies_changed=changed, only_two_added_hud_slots=[blocks.NORMAL_SLOT, blocks.MATCHED_SLOT],
        unchanged_method_bodies=len(a['bodies'])-2, old_summer_and_gerald_instructions_and_slots_preserved=True,
        original_pool_entries_preserved=True, non_abc_swf_bytes_preserved=True, source_sha256=patch.BASE_SHA,
        output_sha256=patch.sha(final.read_bytes()), device_or_store_writes=False)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8'); return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'final', 'build_report', 'output'): parser.add_argument(name, type=Path)
    args = parser.parse_args(); result = verify(args.source, args.final, args.build_report, args.output)
    print(json.dumps({key:result[key] for key in ('status', 'case_count', 'output_sha256')}, ensure_ascii=False))
