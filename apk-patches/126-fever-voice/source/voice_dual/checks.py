"""行为验收：旧数据整方法对照、新键/标签边界，以及已核实语音资产路径。"""
import itertools
import json
from pathlib import Path
import asm
import bodies
from .runtime import World, some, NONE
from .ready_audit import CHARACTERS, paths


def behavior(old, new, overrides=None):
    checks=[]
    def check(name, value, wanted):
        assert value==wanted,(name,value,wanted)
        checks.append(name)
    inv=json.loads((Path(__file__).parent/'voice-asset-inventory.json').read_text(encoding='utf8'))
    for code,fever,gameplay,loaded in itertools.product(['other','white_tiger_summer',*[c[0] for c in CHARACTERS.values()]], [False,True],[False,True],[False,True]):
        before,after=World(old,loaded=loaded),World(new,loaded=loaded,overrides=overrides)
        check(f'legacy.skill.{code}.{fever}.{gameplay}.{loaded}',after.invoke(code,fever,gameplay),before.invoke(code,fever,gameplay))
        available=[r['logical_path'][:-4] for r in inv['files'] if '/'+code+'/' in r['logical_path'] and r['found']]
        for world in (before,after):
            world.sounds.clear()
            hud=world.hud(code,available,fever,gameplay)
            for phase,key in [('skill_ready','skillReadyVoicePath'),('matched_skill_ready','switchedSkillReadyVoicePath')]:
                p=f'character/{code}/voice/battle/{phase}'
                hud['character'][key]=some(p) if p in available or code in ('other','white_tiger_summer') else NONE
            for _ in range(14):
                world.update(hud)
        check(f'legacy.ready.{code}.{fever}.{gameplay}.{loaded}',after.sounds,before.sounds)
    for value,loaded,fever,gameplay in itertools.product([None,'','0','1','01','true',' 1','2'],[False,True],[False,True],[False,True]):
        custom={} if value is None else {'wfx_fever_voice_hero':value}
        active=loaded and value=='1'; selected=fever if active else gameplay
        w=World(new,custom,loaded,overrides)
        check(f'new.skill.{value}.{loaded}.{fever}.{gameplay}',w.invoke('hero',fever,gameplay),'fever_skill' if selected else 'normal_skill')
        w.sounds.clear()
        check(f'new.ready.{value}.{loaded}.{fever}.{gameplay}',w.update(w.hud('hero',fever=fever,gameplay=gameplay)),f'character/hero/voice/battle/{"matched_" if selected else ""}skill_ready')
        if not loaded or value is None:
            check('safe_get_guard',any(x[0]=='get' for x in w.reads),False)
    w=World(new,{'wfx_fever_voice_someone_else':'1'},overrides=overrides)
    check('key_owner_isolation',w.invoke('hero',True,False),'normal_skill')
    for tags,uid in [([],0),(['ModDualForm'],22),(['ModDualForm:123'],123),(['ModDualForm:2147483647'],2147483647),
                     (['ModDualForm:0'],0),(['ModDualForm:-1'],0),(['ModDualForm:'],0),(['ModDualForm:1:2'],0),
                     (['ModDualForm:2147483648'],0),(['ModDualForm:x'],0),(['ModDualForm:1.5'],0),(['ModDualForm: 2'],0),
                     (['ModDualForm:0x16'],0),(['ModDualForm','ModDualForm:123'],123),
                     (['ModDualForm:bad','ModDualForm'],22),(['ModDualForm:123','ModDualForm:456'],123)]:
        for active in ([],[uid]):
            w=World(new,overrides=overrides)
            check('dual.'+str(tags)+str(active),w.draw(tags,active),{'uids':[uid] if uid else [],
                  'loaded':(['character/hero/pixelart/special' if uid in active else 'normal'] if uid else [])})
    for tags in ([],['Other'],['ModDualForm']):
        for active in ([],[22]):
            check('dual.legacy',World(new,overrides=overrides).draw(tags,active),World(old).draw(tags,active))
    return checks


def ready_migration(old,new,overrides=None):
    """比较最终 SWF 的预载/图鉴真实块；全现有资产路径必须相同。"""
    results=[]
    inv=json.loads((Path(__file__).parent/'voice-asset-inventory.json').read_text(encoding='utf8'))
    for cid,(code,alts) in CHARACTERS.items():
        normal,matched,_=paths(code,alts)
        files=[r['logical_path'][:-4] for r in inv['files'] if r['character_id']==cid and r['found']]
        outputs=[]
        for abc,isnew in ((old,False),(new,True)):
            w,got=World(abc,overrides=overrides if isnew else None),[]
            short={'characterId':cid,'logicAssets':{'existsVoiceFileReader':set(files).__contains__},
                   'get_skillReadyVoicePath':lambda:some(normal),
                   'get_switchedSkillReadyVoicePath':lambda:some(matched) if matched in files else NONE}
            args=[None]*39;args[1]={'addSoundEffect':got.append};args[3]={'playsSkillReady':True};args[5]=short
            w.block('BattleCharacterLogic/resolveFollowingPathCollection',112,457 if isnew else 488,args,[('returnvoid',)])
            args[2]=short;args[21]=[normal]+([matched] if matched in files else [])
            gallery=w.block('CharacterVoiceLogic/createVoicePathMap',213,526 if isnew else 557,args,[('getlocal',21),('returnvalue',)])
            outputs.append({'preload':got,'gallery':gallery})
        # 预载顺序可变；相同路径集合与图鉴顺序、听到的轮换已分别锁定。
        assert sorted(outputs[0]['preload'])==sorted(outputs[1]['preload']),(cid,outputs)
        assert outputs[0]['gallery']==outputs[1]['gallery'],(cid,outputs)
        results.append({'cid':cid,'before':outputs[0],'after':outputs[1]})
    return results
