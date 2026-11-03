"""针对给定最终SWF执行旧数据对照、新预载及字节码变异复审。"""
import copy
import hashlib
import json
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
import bootstrap
import asm
import bodies
from swfabc import SwfAbc
from superpreload.checks import behavior
from superpreload.patches import SITES


def mutations(abc):
    result=[]
    def code(label):return asm.decode(abc.bodies[bodies.resolve(abc,label)][5])
    def change(name,label,at,op=None,args=None):
        c=copy.deepcopy(code(label))
        if op is not None:c[at].op=asm.assemble([(op,'TARGET'),('label','TARGET'),('returnvoid',)])[0].op
        if args is not None:c[at].args=args
        result.append((name,label,c,at))
    def q(name):
        return next(i for i,v in enumerate(abc.multinames) if v[0]==7 and abc.mn_name(i)==name)
    main='UniqueConditionLogic/wfxSuperPreload'
    c=code(main)
    for value,nth,new,name in [(60,0,59,'code60_gate'),(61,0,59,'code61_gate'),(61,1,60,'linked_S_code'),
                              (6,0,5,'six_colors'),(3,0,1,'marker_flags_index')]:
        at=[i for i,v in enumerate(c) if v.name=='pushbyte' and v.args==[value]][nth]
        change(name,main,at,args=[new])
    # E分支取arg改为flags，丢失真实S引用。
    branch=next(i for i,v in enumerate(c) if v.name=='pushbyte' and v.args==[1] and i>20)
    change('energy_S_reference',main,branch,args=[3])
    for kind in ('Hit','Player','Shot'):
        name='getAbilityDamage'+kind+'Effect'
        at=next(i for i,v in enumerate(c) if v.name=='callproperty' and abc.mn_name(v.args[0])==name)
        other='getAbilityDamage'+('Shot' if kind!='Shot' else 'Hit')+'Effect'
        change('native_'+kind+'_path',main,at,args=[q(other),1])
    icon='UniqueConditionLogic/wfxSuperPreloadIcon';c=code(icon)
    for nth,name in [(0,'table_guard'),(1,'exists_guard'),(2,'empty_icon_guard')]:
        at=[i for i,v in enumerate(c) if v.name=='iffalse'][nth]
        change(name,icon,at,op='iftrue')
    at=next(i for i,v in enumerate(c) if v.name=='getproperty' and abc.mn_name(v.args[0])=='icon_image')
    change('icon_column',icon,at,args=[q('string_id')])
    # 每一实际接入点独立关闭；保留合法栈形状，用undefined资产令新助手正常短路。
    for label in SITES:
        c=code(label)
        for n,at in enumerate(i for i,v in enumerate(c) if v.name=='callpropvoid' and abc.mn_name(v.args[0])=='wfxSuperPreload'):
            assert c[at-1].name=='getproperty' and abc.mn_name(c[at-1].args[0])=='logicAssets'
            change(f'hook.{label}.{n}',label,at-1,args=[q('values')])
    return result


def main():
    path=Path(sys.argv[1]) if len(sys.argv)>1 else HERE.parent/'v35c.swf'
    assert hashlib.sha256(bootstrap.BASE.read_bytes()).hexdigest()==bootstrap.BASE_SHA
    old,new=SwfAbc(bootstrap.BASE).abc,SwfAbc(path).abc
    baseline=behavior(old,new)
    reports=[];survived=[]
    for name,label,code,at in mutations(new):
        try:
            behavior(old,new,{label:code})
        except Exception as exc:
            reports.append({'name':name,'method':label,'instruction':at,'status':'killed',
                            'failure':type(exc).__name__+': '+str(exc)[:700]})
        else:
            survived.append(name);reports.append({'name':name,'status':'survived'})
    final=behavior(old,new)
    assert final==baseline
    result={'status':'pass' if not survived else 'fail','swf_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            **baseline,'mutants':reports,'mutant_count':len(reports),'survived':survived,'final_baseline':'pass',
            'boundary':'AVM2真实整方法；资产容器与收集器是外围替身；未运行AIR/设备'}
    (HERE/'verify-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'status':result['status'],'checks':len(baseline['checks']),'mutants':len(reports),
                      'survived':survived,'final_baseline':'pass','swf_sha256':result['swf_sha256']},ensure_ascii=False))
    assert not survived,survived


if __name__=='__main__':main()
