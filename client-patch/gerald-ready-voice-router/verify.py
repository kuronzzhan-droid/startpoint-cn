"""Independent ABC structure diff plus execution of actual inserted instructions."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace as Obj

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import patch
import asm
from swfabc import SwfAbc


def load_independent():
    p = patch.REPO / 'client-patch/rank-scene-p2/independent/myabc.py'
    spec = importlib.util.spec_from_file_location('voice_independent_abc', p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def execute(ins, abc, registers):
    """Small VM for the spliced AVM2 opcodes; no hand-written router model."""
    pc, stack, visited = 0, [], set()
    def propname(index):
        return abc.mn_name(index).split('::')[-1]
    def value(obj, index):
        if index == 14:
            return obj[stack.pop()]
        return getattr(obj, propname(index))
    while pc < len(ins):
        visited.add(pc)
        x = ins[pc]; name, args = x.name, x.args; pc += 1
        if name.startswith('getlocal_'):
            stack.append(registers[int(name[-1])])
        elif name == 'getlocal': stack.append(registers[args[0]])
        elif name.startswith('setlocal_'):
            registers[int(name[-1])] = stack.pop()
        elif name == 'setlocal': registers[args[0]] = stack.pop()
        elif name == 'getproperty':
            if args[0] == 14:
                key, obj = stack.pop(), stack.pop(); stack.append(obj[key])
            else: stack.append(value(stack.pop(), args[0]))
        elif name == 'setproperty':
            val, obj = stack.pop(), stack.pop(); setattr(obj, propname(args[0]), val)
        elif name == 'pushstring': stack.append(abc.strings[args[0]].decode('utf-8'))
        elif name == 'pushint': stack.append(abc.ints[args[0]])
        elif name == 'pushbyte': stack.append(args[0])
        elif name == 'pushnull': stack.append(None)
        elif name == 'getlex':
            stack.append(Obj(Some=lambda path: Obj(index=0, params=[path]))
                         if args[0] == 79 else ('class', args[0]))
        elif name in ('callproperty', 'callpropvoid'):
            vals = [stack.pop() for _ in range(args[1])][::-1]
            obj = stack.pop()
            val = getattr(obj, propname(args[0]))(*vals)
            if name == 'callproperty': stack.append(val)
        elif name in ('coerce','coerce_a'): pass
        elif name == 'convert_b': stack.append(bool(stack.pop()))
        elif name == 'add':
            b,a=stack.pop(),stack.pop();stack.append(a+b)
        elif name == 'jump': pc=x.target
        elif name in ('ifeq','ifne'):
            b,a=stack.pop(),stack.pop()
            if (a == b) == (name == 'ifeq'): pc=x.target
        elif name in ('iftrue','iffalse'):
            if bool(stack.pop()) == (name == 'iftrue'): pc=x.target
        else: raise AssertionError('unexpected VM opcode ' + name)
    assert stack == [], stack
    return visited


def verify(source, final, build_report, output):
    source, final, build_report, output = map(Path, (source, final, build_report, output))
    assert patch.sha(source.read_bytes()) == patch.BASE_SHA
    before, after = SwfAbc(source), SwfAbc(final)
    report = json.loads(build_report.read_text(encoding='utf-8'))
    assert report['output_sha256'] == patch.sha(final.read_bytes())
    assert report['new_slots'] == ['geraldReadyNext']
    independent = load_independent()
    a, b = independent.parse_abc(before._raw), independent.parse_abc(after.abc.serialize())
    for key in ('methods', 'metadata', 'classes', 'scripts'):
        assert a[key] == b[key], key
    for key in a['pools']:
        old, new = a['pools'][key], b['pools'][key]
        assert old == new[:len(old)], key
        if key not in ('strs', 'mns', 'ints'):
            assert old == new, key
    changed_classes = [i for i, (x, y) in enumerate(zip(a['instances'], b['instances'])) if x != y]
    assert len(changed_classes) == 1
    ci = changed_classes[0]
    old, new = a['instances'][ci], b['instances'][ci]
    assert old[:6] == new[:6] and old[6] == new[6][:-1]
    added = new[6][-1]
    assert after.abc.mn_name(added[0]) == 'geraldReadyNext'
    assert added[1] == 0 and added[2] == (0, 38, 0, 0), added
    changed = [i for i, (x, y) in enumerate(zip(a['bodies'], b['bodies'])) if x != y]
    assert changed == [58960, 92290], changed
    assert len(a['bodies']) == len(b['bodies'])
    chunks = {}
    for detail in report['changed_methods']:
        idx = detail['body_index']
        old, new = a['bodies'][idx], b['bodies'][idx]
        for key in ('method', 'maxstack', 'localcount', 'initscope', 'maxscope', 'ex', 'traits'):
            assert old[key] == new[key], (detail['method'], key)
        assert asm.unsplice_many(new['code'], detail['insertions']) == old['code']
        instructions = asm.decode(after.abc.bodies[idx][5])
        at, count, policy = detail['insertions'][0]
        assert policy == 'enter'
        chunks[detail['method']] = [asm.Instruction(x.op, x.args,
            target=None if x.target is None else x.target-at) for x in instructions[at:at+count]]
    assert before.body[:before._offset] == after.body[:after._offset]
    assert before.body[before._offset+before._length:] == after.body[after._offset+after._length:]
    ready = chunks['HudMemberStatus/update']
    preload = chunks['BattleCharacterLogic/resolveFollowingPathCollection']
    base = 'character/unicorn_lancer_rose/voice/battle/skill_ready'
    paths = [base] + [base+f'_alt_{i}' for i in range(1, 4)]
    cases = []
    for mask in range(16):
        assets = {path for i, path in enumerate(paths) if mask & (1 << i)}
        for initial in range(4):
            for matched in (False, True):
                for fever in (False, True):
                    for native_missing in (False, True):
                        container = Obj(existsVoiceFileReader=lambda p: p in assets)
                        character = Obj(mainCharacterStringId='unicorn_lancer_rose', logic=Obj(logicAssets=container))
                        hud = Obj(character=character, geraldReadyNext=initial,
                                  wtsReadyNormalNext=1, wtsReadyFeverNext=0, fever=fever)
                        native = Obj(index=1, params=None) if native_missing else Obj(index=0, params=['native_matched' if matched else 'native_normal'])
                        regs = {0:hud, 3:matched, 4:native}
                        execute(ready, after.abc, regs)
                        if base in assets:
                            expected = paths[initial] if paths[initial] in assets else base
                            assert regs[4].params == [expected]
                            assert hud.geraldReadyNext == (initial+1) % 4
                        else:
                            assert regs[4] is native and hud.geraldReadyNext == initial
                        assert regs[3] == matched and hud.fever == fever
                        assert (hud.wtsReadyNormalNext, hud.wtsReadyFeverNext) == (1, 0)
                        cases.append(f'ready/mask{mask}/next{initial}/matched{matched}/fever{fever}/none{native_missing}')
    for other in ('white_tiger_summer', 'seris_dragon_king', 'dimension_witch_smr20_ex'):
        for initial in range(4):
            native = Obj(index=0, params=['native_'+other])
            hud = Obj(character=Obj(mainCharacterStringId=other), geraldReadyNext=initial,
                      wtsReadyNormalNext=1, wtsReadyFeverNext=0)
            regs = {0:hud, 3:True, 4:native}
            execute(ready, after.abc, regs)
            assert regs[4] is native and hud.geraldReadyNext == initial
            assert (hud.wtsReadyNormalNext, hud.wtsReadyFeverNext) == (1,0)
            cases.append(f'unrelated/{other}/{initial}')
    # Two separate HUD instances never share a counter; phase changes do not reset it.
    container = Obj(existsVoiceFileReader=lambda p: p in paths)
    def new_hud():
        return Obj(character=Obj(mainCharacterStringId='unicorn_lancer_rose',logic=Obj(logicAssets=container)),geraldReadyNext=0)
    hud_a, hud_b = new_hud(), new_hud()
    observed = []
    for hud, matched in [(hud_a,False),(hud_a,True),(hud_b,True),(hud_a,False),(hud_b,False),(hud_a,True),(hud_a,False)]:
        regs = {0:hud, 3:matched, 4:Obj(index=1, params=None)}
        execute(ready, after.abc, regs)
        observed.append(regs[4].params[0])
    assert observed == [paths[0],paths[1],paths[0],paths[2],paths[1],paths[3],paths[0]]
    cases.append('separate_huds_and_matched_changes_share_no_state')
    for cid in (129992,149990,179999):
        for mask in range(8):
            assets = {path for i,path in enumerate(paths[1:]) if mask & (1<<i)}
            collected = []
            regs = {1:Obj(addSoundEffect=collected.append), 5:Obj(characterId=cid,
                    logicAssets=Obj(existsVoiceFileReader=lambda p:p in assets))}
            execute(preload, after.abc, regs)
            assert collected == ([path for path in paths[1:] if path in assets] if cid==129992 else [])
            cases.append(f'preload/cid{cid}/mask{mask}')
    preserved = {}
    for name in ('SquadManagerImpl/invokeActionSkill', 'ConditionSlot/getOneSideTotalAbilityDamageResistance'):
        idx = patch.bodies.resolve(after.abc, name)
        assert before.abc.bodies[idx] == after.abc.bodies[idx]
        preserved[name] = patch.sha(after.abc.bodies[idx][5])
    result = {'status':'static_verified_runtime_pending', 'case_count':len(cases), 'cases':cases,
              'only_two_bodies_changed':changed, 'only_one_added_hud_slot':'geraldReadyNext',
              'existing_summer_hud_slots_and_instructions_preserved':True,
              'preserved_methods':preserved, 'original_pool_entries_preserved':True,
              'non_abc_swf_bytes_preserved':True, 'output_sha256':patch.sha(final.read_bytes())}
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source','final','build_report','output'):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    result = verify(args.source,args.final,args.build_report,args.output)
    print(json.dumps({'status':result['status'],'cases':result['case_count'],
                      'sha256':result['output_sha256']},ensure_ascii=False))
