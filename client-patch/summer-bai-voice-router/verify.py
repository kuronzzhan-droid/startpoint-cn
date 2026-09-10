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
    before = SwfAbc(source)
    after = SwfAbc(final)
    report = json.loads(build_report.read_text(encoding='utf-8'))
    assert report['output_sha256'] == patch.sha(final.read_bytes())
    assert report['new_slots'] == ['wtsReadyNormalNext','wtsReadyFeverNext']
    independent = load_independent()
    a,b = independent.parse_abc(before._raw), independent.parse_abc(after.abc.serialize())
    for key in ('methods','metadata','classes','scripts'):
        assert a[key] == b[key], key
    for key in a['pools']:
        old,new=a['pools'][key],b['pools'][key]
        assert old == new[:len(old)], key
        if key not in ('strs','mns','ints'): assert old == new,key
    changed_classes=[i for i,(x,y) in enumerate(zip(a['instances'],b['instances'])) if x!=y]
    assert len(changed_classes)==1,changed_classes
    ci=changed_classes[0]
    old,new=a['instances'][ci],b['instances'][ci]
    assert old[:6]==new[:6] and old[6]==new[6][:-2]
    for added,name in zip(new[6][-2:],report['new_slots']):
        assert after.abc.mn_name(added[0])==name
        assert added[1]==0 and added[2]==(0,38,0,0),added
    changed=[i for i,(x,y)in enumerate(zip(a['bodies'],b['bodies']))if x!=y]
    assert changed==[58960,59924,92290],changed
    assert len(a['bodies'])==len(b['bodies'])
    for detail in report['changed_methods']:
        idx=detail['body_index'];old,new=a['bodies'][idx],b['bodies'][idx]
        for key in ('method','maxstack','localcount','initscope','maxscope','ex','traits'):
            assert old[key]==new[key],(detail['method'],key)
        assert asm.unsplice_many(new['code'],detail['insertions'])==old['code']
    # The complete non-ABC SWF prefix/suffix is immutable.
    assert before.body[:before._offset]==after.body[:after._offset]
    assert before.body[before._offset+before._length:]==after.body[after._offset+after._length:]
    # Extract the actual output bytecode insertions, rebased to zero for execution.
    chunks={}
    for d in report['changed_methods']:
        instructions=asm.decode(after.abc.bodies[d['body_index']][5])
        chunks[d['method']]=[]
        for at,count,_policy in d['insertions']:
            part=[]
            for x in instructions[at:at+count]:
                y=asm.Instruction(x.op,x.args,
                                  target=None if x.target is None else x.target-at)
                part.append(y)
            chunks[d['method']].append(part)
    skill=chunks['SquadManagerImpl/invokeActionSkill'][0]
    phase,alternate=chunks['HudMemberStatus/update']
    preload=chunks['BattleCharacterLogic/resolveFollowingPathCollection'][0]
    cases=[]
    for code in ('white_tiger_summer','seris_dragon_king','unicorn_lancer_rose'):
        for fever in (False,True):
            for gameplay in (False,True):
                character=Obj(mainCharacterStringId=code,skillVoicePaths=['n0','n1'],
                              switchedSkillVoicePaths=['f0','f1'])
                native=character.switchedSkillVoicePaths if gameplay else character.skillVoicePaths
                regs={0:Obj(zoneManager=Obj(isFeverMode=lambda:fever)),3:character,6:gameplay,8:native}
                execute(skill,after.abc,regs)
                assert regs[8]==(character.switchedSkillVoicePaths if fever else character.skillVoicePaths) if code=='white_tiger_summer' else regs[8]==native
                assert regs[6]==gameplay
                cases.append(f'skill:{code}:fever={fever}:gameplay={gameplay}')
    normal='character/white_tiger_summer/voice/battle/skill_ready'
    fever_path='character/white_tiger_summer/voice/battle/matched_skill_ready'
    assets={normal+'_alt_1',fever_path+'_alt_1'}
    state={'fever':False}
    container=Obj(existsVoiceFileReader=lambda p:p in assets)
    char=Obj(mainCharacterStringId='white_tiger_summer',logic=Obj(logicAssets=container))
    hud=Obj(character=char,wtsReadyNormalNext=0,wtsReadyFeverNext=0,
            gear=Obj(absorb=lambda *args:Obj(isFeverMode=lambda:state['fever'])))
    got=[]
    for f in (False,True,False,False,True,True):
        state['fever']=f;regs={0:hud,3:not f}
        execute(phase,after.abc,regs);assert regs[3]==f
        regs[4]=Obj(index=0,params=[fever_path if f else normal])
        execute(alternate,after.abc,regs);got.append(regs[4].params[0])
    assert got==[normal,fever_path,normal+'_alt_1',normal,fever_path+'_alt_1',fever_path]
    cases.append('ready:interleaved_phase_independent_alternation')
    # Missing alt safely plays base; absent base never advances a toggle.
    assets.clear();hud.wtsReadyNormalNext=1
    regs={0:hud,3:False,4:Obj(index=0,params=[normal])}
    execute(alternate,after.abc,regs);assert regs[4].params==[normal]
    hud.wtsReadyNormalNext=1;regs[4]=Obj(index=1,params=None)
    execute(alternate,after.abc,regs);assert hud.wtsReadyNormalNext==1
    cases.extend(['ready:missing_alt_fallback','ready:missing_base_no_increment'])
    # Other characters never query ZoneManager or mutate either slot.
    char.mainCharacterStringId='seris_dragon_king'
    hud.gear=Obj(absorb=lambda *args:(_ for _ in ()).throw(AssertionError('unrelated gear queried')))
    regs={0:hud,3:True,4:Obj(index=0,params=['native'])}
    execute(phase,after.abc,regs);execute(alternate,after.abc,regs)
    assert regs[3] is True and regs[4].params==['native'] and hud.wtsReadyNormalNext==1
    cases.append('ready:unrelated_character_unchanged')
    for cid in (149990,179999):
        for present in (False,True):
            assets.update((normal+'_alt_1',fever_path+'_alt_1')) if present else assets.clear()
            paths=[];regs={1:Obj(addSoundEffect=paths.append),5:Obj(characterId=cid,logicAssets=container)}
            execute(preload,after.abc,regs)
            assert paths==([normal+'_alt_1',fever_path+'_alt_1'] if cid==149990 and present else [])
            cases.append(f'preload:cid={cid}:present={present}')
    result={'status':'static_verified_runtime_pending','cases':cases,'case_count':len(cases),
            'only_three_bodies_changed':changed,'only_one_class_two_slots':ci,
            'all_original_pool_entries_preserved':True,'non_abc_swf_bytes_preserved':True,
            'output_sha256':patch.sha(final.read_bytes())}
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('final',type=Path)
    parser.add_argument('build_report',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    verify(args.source,args.final,args.build_report,args.output)
