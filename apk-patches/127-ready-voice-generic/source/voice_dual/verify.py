"""最终 SWF 真实字节码验收与变异复审，所有报告限制在 voice_dual。"""
import copy
import hashlib
import json
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
import bootstrap
import asm
import bodies
from swfabc import SwfAbc
from voice_dual.checks import behavior,ready_migration
from voice_dual.ready_audit import compare


def mutate(abc):
    def code(label):
        return copy.deepcopy(asm.decode(abc.bodies[bodies.resolve(abc,label)][5]))
    v='CalculatedBattleCharacterLogic/wfxUsesFeverVoice'
    d='MemberView/wfxDualFormUid'
    for label in (v,d):
        original=code(label)
        for i,x in enumerate(original):
            replacement=None
            if x.name in ('ifeq','ifne','ifge','ifle'):
                replacement=copy.deepcopy(x)
                replacement.op=asm.MNEMONICS[{'ifeq':'ifne','ifne':'ifeq','ifge':'ifgt','ifle':'ifge'}[x.name]]
            elif x.name=='pushbyte' and x.args[0] in (22,10,2):
                replacement=asm.assemble([('pushbyte',x.args[0]+1)])[0]
            elif x.name=='pushtrue':
                replacement=asm.assemble([('pushfalse',)])[0]
            elif label==v and x.name=='pushstring':
                replacement=asm.assemble([('pushstring',next(j for j,s in enumerate(abc.strings) if j and s==b'0'))])[0]
            if replacement is not None:
                mutant=code(label);mutant[i]=replacement
                yield label+':'+str(i),label,mutant
    for label,i in [('SquadManagerImpl/invokeActionSkill',114),('HudMemberStatus/update',68),('MemberView/draw',46)]:
        mutant=code(label);x=mutant[i]
        x.op=asm.MNEMONICS['ifne' if x.name=='ifeq' else 'iftrue']
        yield label+':gate',label,mutant
    label='MemberView/draw';mutant=code(label);mutant[50]=asm.assemble([('pushbyte',22)])[0]
    yield label+':uid22',label,mutant
    for label in ('HudMemberStatus/update','BattleCharacterLogic/resolveFollowingPathCollection','CharacterVoiceLogic/createVoicePathMap'):
        mutant=code(label)
        target=next(i for i,x in enumerate(mutant) if x.name=='pushstring' and abc.s(x.args[0])=='_alt_1'
                    and (label!='HudMemberStatus/update' or i>397))
        mutant[target].args=[next(j for j,s in enumerate(abc.strings) if j and s==b'0')]
        yield label+':generic_alt_prefix',label,mutant


def verify(path):
    old=SwfAbc(bootstrap.BASE).abc
    new=SwfAbc(path).abc
    assert hashlib.sha256(bootstrap.BASE.read_bytes()).hexdigest()==bootstrap.BASE_SHA
    checks=behavior(old,new)
    migration=ready_migration(old,new)
    audit=compare(old)
    mutants=[];survived=[]
    for name,label,code in mutate(new):
        overrides={label:code}
        try:
            behavior(old,new,overrides)
            ready_migration(old,new,overrides)
        except (AssertionError,KeyError,IndexError,ValueError,TypeError) as exc:
            mutants.append({'name':name,'status':'killed','reason':str(exc)[:260]})
        else:
            survived.append(name)
    assert not survived,('survived',survived)
    assert behavior(old,new)==checks
    assert ready_migration(old,new)==migration
    report={'status':'pass','swf':str(path),'swf_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'checks':len(checks)+len(migration),'behavior_check_names':checks,'ready_migration':migration,
            'mutants':mutants,'mutant_count':len(mutants),'survived':survived,'final_baseline':'pass',
            'execution':'修改后的 invokeActionSkill/update/draw 整方法、两助手、既有安全表读取与数字解析；预载/图鉴执行实际相关完整字节码块',
            'asset_evidence':'voice-asset-inventory.json: 本地 active 204 个实际 ZIP 文件，无设备/线上核验',
            'ready_decisions':{str(r['character_id']):r['decision'] for r in audit['characters']},
            'unverified':['完整 AIR/Android','设备语音与动画','线上资产状态']}
    (HERE/'ready-path-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8')
    (HERE/'verify-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    return report


if __name__=='__main__':
    report=verify(Path(sys.argv[1]) if len(sys.argv)>1 else HERE.parent/'v35c.swf')
    print(json.dumps({k:report[k] for k in ['status','swf_sha256','checks','mutant_count','survived','final_baseline']},ensure_ascii=False))
