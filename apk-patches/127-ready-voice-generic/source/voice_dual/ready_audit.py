"""同一 SWF 的旧专用与 94-96 通用分支逐路径对照；不凭名称近似迁移。"""
import hashlib
import json
from pathlib import Path
import asm
import bodies
from .runtime import World, some, NONE

CHARACTERS = {129992: ('unicorn_lancer_rose', [1, 2, 3, 4, 5]),
              139993: ('super_robot_tailcoat', [2]),
              159998: ('samurai_robot_plum', [2, 3]),
              149999: ('white_wolf_gerald', [1, 2, 3])}


def paths(code, alts):
    base = f'character/{code}/voice/battle/'
    return base+'skill_ready', base+'matched_skill_ready', [base+'skill_ready_alt_'+str(n) for n in alts]


def compare(abc):
    inventory=json.loads((Path(__file__).parent/'voice-asset-inventory.json').read_text(encoding='utf8'))
    rows = []
    for cid, (code, alts) in CHARACTERS.items():
        normal, matched, extra = paths(code, alts)
        files = [r['logical_path'][:-4] for r in inventory['files'] if r['character_id']==cid and r['found']]
        cases = []
        for scenario, available, switched in [('normal_complete', files, False), ('switched_complete', files, True),
                                               ('normal_alt1_missing', [p for p in files if not p.endswith('_alt_1')], False)]:
            result = {}
            for flavor in ('legacy', 'generic'):
                w = World(abc)
                h = w.hud(code if flavor == 'legacy' else 'generic_probe', available, gameplay=switched)
                h['character']['skillReadyVoicePath'] = some(normal) if normal in available else NONE
                h['character']['switchedSkillReadyVoicePath'] = some(matched) if matched in available else NONE
                result[flavor] = []
                for _ in range(12):
                    prior = len(w.sounds)
                    w.update(h)
                    result[flavor].append(w.sounds[-1] if len(w.sounds)>prior else None)
            cases.append({'scenario': scenario, **result, 'equal': result['legacy']==result['generic']})
        # 同一段实际 bytecode，比预载与图鉴输出；generic 仅把 skip id 换为无关 id。
        preload, gallery = {}, {}
        for flavor in ('legacy', 'generic'):
            w, got = World(abc), []
            short = {'characterId': cid if flavor=='legacy' else 111001,
                     'logicAssets': {'existsVoiceFileReader': set(files).__contains__},
                     'get_skillReadyVoicePath': lambda: some(normal),
                     'get_switchedSkillReadyVoicePath': lambda: some(matched) if matched in files else NONE}
            args=[None]*39;args[1]={'addSoundEffect':got.append};args[3]={'playsSkillReady':True};args[5]=short
            w.block('BattleCharacterLogic/resolveFollowingPathCollection',112,488,args,[('returnvoid',)])
            preload[flavor]=got
            args[2]=short;args[21]=[normal]+([matched] if matched in files else [])
            gallery[flavor]=w.block('CharacterVoiceLogic/createVoicePathMap',213,557,args,[('getlocal',21),('returnvalue',)])
        current_equal=all(c['equal'] for c in cases if c['scenario']!='normal_alt1_missing')
        assert current_equal == (cid==149999)
        rows.append({'character_id':cid,'code_name':code,'swf_declared_existing_paths':files,
                     'runtime':cases,'preload':preload,'gallery':gallery,
                     'decision':'remove_legacy' if current_equal else 'retain_legacy',
                     'reason':'真实现有资产完整 normal/switched 路由等价' if current_equal else '真实现有资产下切换或 alt 缺口造成不同音频选择'})
    labels=['BattleCharacterLogic/resolveFollowingPathCollection','CharacterVoiceLogic/createVoicePathMap']
    return {'status':'PASS','characters':rows,'evidence':'执行输入 SWF 专用分支与通用分支；资源清单来自 204 个本地 active ZIP 实际文件核验，非设备或线上实测',
            'unchanged_method_sha256':{n:hashlib.sha256(abc.bodies[bodies.resolve(abc,n)][5]).hexdigest() for n in labels}}
