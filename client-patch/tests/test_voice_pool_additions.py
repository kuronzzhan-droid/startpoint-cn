from pathlib import Path
from types import SimpleNamespace as Obj
import copy, importlib.util, json, sys, unittest
R=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(R/'client-patch/abcasm'),str(R/'client-patch/gerald-ready-voice-router')]
import asm, bodies
from swfabc import SwfAbc
import verify as reference_vm


class VoicePoolAdditionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out=R.parent/'out/夏勇希与杰拉尔调整-20260924'
        if not (out/'voice-pools-ui.swf').exists():raise unittest.SkipTest('local v4 voice candidate absent')
        cls.before=SwfAbc(R.parent/'out/战斗黑屏修复-20260924/rules-v4.swf')
        cls.after=SwfAbc(out/'voice-pools-ui.swf')
        cls.report=json.loads((out/'voice-pools-ui-report.json').read_bytes())
        cls.blocks={}
        for edit in cls.report['edits']:
            idx=bodies.resolve(cls.after.abc,edit['method']);at=edit['at']
            ins=copy.deepcopy(asm.decode(cls.after.abc.bodies[idx][5])[at:at+edit['new_count']])
            for x in ins:
                if x.target is not None:x.target-=at
            cls.blocks[edit['method']]=ins
        cls.paths=[f'character/unicorn_lancer_rose/voice/battle/skill_ready'+(f'_alt_{i}' if i else '') for i in range(6)]
        cls.tekuto='character/super_robot_tailcoat/voice/battle/skill_ready_alt_2'

    def execute(self,name,regs):reference_vm.execute(self.blocks[name],self.after.abc,regs)

    def test_gerald_six_slots_missing_assets_and_other_characters(self):
        for code in ['unicorn_lancer_rose','lion_swordman_moon','kyon']:
            for mask in range(64):
                assets={p for i,p in enumerate(self.paths) if mask & (1<<i)}
                for initial in range(6):
                    native=Obj(index=0,params=['native'])
                    hud=Obj(character=Obj(mainCharacterStringId=code,logic=Obj(logicAssets=Obj(existsVoiceFileReader=lambda p:p in assets))),geraldReadyNext=initial)
                    regs={0:hud,4:native};self.execute('HudMemberStatus/update',regs)
                    if code!='unicorn_lancer_rose' or self.paths[0] not in assets:
                        self.assertIs(regs[4],native);self.assertEqual(hud.geraldReadyNext,initial)
                    else:
                        self.assertEqual(regs[4].params,[self.paths[initial] if self.paths[initial] in assets else self.paths[0]])
                        self.assertEqual(hud.geraldReadyNext,(initial+1)%6)

    def test_tekuto_preserves_native_split_and_adds_every_third_ready(self):
        for present in [False,True]:
            for phase in ['skill_ready','matched_skill_ready','skill_ready_alt','matched_skill_ready_alt']:
                hud=Obj(character=Obj(mainCharacterStringId='super_robot_tailcoat',logic=Obj(logicAssets=Obj(existsVoiceFileReader=lambda p:present and p==self.tekuto))),geraldReadyNext=0)
                heard=[]
                for _ in range(6):
                    regs={0:hud,4:Obj(index=0,params=[phase])};self.execute('HudMemberStatus/update',regs);heard.append(regs[4].params[0])
                self.assertEqual(heard,([phase,phase,self.tekuto]*2 if present else [phase]*6))

    def test_preload_and_no_gameplay_or_structural_mutation(self):
        allpaths=self.paths[1:]+[self.tekuto]
        for cid in [129992,139993,119990]:
            for mask in range(64):
                assets={p for i,p in enumerate(allpaths) if mask & (1<<i)};collected=[]
                self.execute('BattleCharacterLogic/resolveFollowingPathCollection',
                    {1:Obj(addSoundEffect=collected.append),5:Obj(characterId=cid,logicAssets=Obj(existsVoiceFileReader=lambda p:p in assets))})
                want=([p for p in self.paths[1:] if p in assets] if cid==129992 else [self.tekuto] if cid==139993 and self.tekuto in assets else [])
                self.assertEqual(collected,want)
        independent=reference_vm.load_independent()
        a=independent.parse_abc(self.before._raw);b=independent.parse_abc(self.after._raw)
        for key in ['methods','metadata','classes','scripts','instances']:self.assertEqual(a[key],b[key],key)
        for key,value in a['pools'].items():self.assertEqual(value,b['pools'][key][:len(value)],key)
        changed=[i for i,(old,new) in enumerate(zip(a['bodies'],b['bodies'])) if old!=new]
        self.assertEqual(changed,self.report['changed_bodies'])
        self.assertEqual(len(self.before.abc.bodies),len(self.after.abc.bodies))
        self.assertEqual(self.before.body[:self.before._offset],self.after.body[:self.after._offset])
        self.assertEqual(self.before.body[self.before._offset+self.before._length:],
                         self.after.body[self.after._offset+self.after._length:])

    def test_ready_ui_lists_each_recording_and_omits_missing_assets(self):
        def load(name, path):
            spec=importlib.util.spec_from_file_location(name,R/path)
            mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
        ui=load('voice_ui_test', 'client-patch/voice-pool-additions/ui.py')
        sys.path.insert(0,str(R/'client-patch/lion-skill-voice-selection'))
        vm=load('voice_ui_vm_test','client-patch/lion-skill-voice-selection/ui_verify.py')
        code=self.blocks[ui.TARGET]
        for cid,(role,leaves) in ui.ROSTER.items():
            paths=[f'character/{role}/voice/battle/{leaf}'for leaf in leaves]
            for mask in range(1<<len(paths)):
                available={p for i,p in enumerate(paths)if mask&(1<<i)}
                for actual in (cid,119996,10):
                    original=['native-old'];actor=Obj(characterId=actual,logicAssets=Obj(existsVoiceFileReader=lambda p:p in available))
                    regs={2:actor,21:original}
                    vm.execute(code,self.after.abc,regs)
                    self.assertEqual(regs[21],[p for p in paths if p in available]if actual==cid else original)
                    if actual!=cid:self.assertIs(regs[21],original)
        edit=next(x for x in self.report['edits']if x['method']==ui.TARGET)
        idx=bodies.resolve(self.after.abc,ui.TARGET)
        self.assertEqual(asm.unsplice(self.after.abc.bodies[idx][5],edit['at'],edit['new_count']),
                         self.before.abc.bodies[idx][5])

    def test_zantetsu_ready_cycle_keeps_native_states_and_preloads_additions(self):
        paths=[f'character/samurai_robot_plum/voice/battle/skill_ready_alt_{i}'for i in (2,3)]
        for mask in range(4):
            available={p for i,p in enumerate(paths)if mask&(1<<i)}
            for native_path in ('skill_ready','matched_skill_ready'):
                hud=Obj(character=Obj(mainCharacterStringId='samurai_robot_plum',logic=Obj(logicAssets=Obj(existsVoiceFileReader=lambda p:p in available))),geraldReadyNext=0)
                heard=[]
                for _ in range(8):
                    regs={0:hud,4:Obj(index=0,params=[native_path])}
                    self.execute('HudMemberStatus/update',regs);heard.append(regs[4].params[0])
                self.assertEqual(heard,([native_path,native_path]+[p if p in available else native_path for p in paths])*2)
                regs={0:hud,4:Obj(index=1,params=[])}
                self.execute('HudMemberStatus/update',regs);self.assertEqual(hud.geraldReadyNext,0)
            collected=[]
            self.execute('BattleCharacterLogic/resolveFollowingPathCollection',
                         {1:Obj(addSoundEffect=collected.append),5:Obj(characterId=159998,logicAssets=Obj(existsVoiceFileReader=lambda p:p in available))})
            self.assertEqual(collected,[p for p in paths if p in available])


if __name__=='__main__':unittest.main()
