"""可供run6总验收调用的码31真实字节码与变异验收。"""
import json, time, sys, copy
from pathlib import Path
if __package__ in (None, ''):
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    import bootstrap
    __package__ = 'heal_fever'
from .cases import suite
from .integration import suite as integration
from .mutations import mutants
from .inspect_native import LABELS
import bodies
import asm
from static_check import check_body


def run(before, after, mutation=True, write=True):
    started=time.monotonic()
    result=suite(before,after)
    native=[]
    for label in LABELS:
        old=before.bodies[bodies.resolve(before,label)]
        new=after.bodies[bodies.resolve(after,label)]
        assert old == new, '本组原生链非预期改变: '+label
        native.append(label)
    result['native_methods_byte_identical']=native
    integrated='MemberImpl/wfxHealSample' in set(bodies.label_map(after).values())
    if integrated:
        chain=integration(after)
        result['integration_checks']=chain['checks']
        result['new_check_count']+=len(chain['checks'])
        result['executed_methods']=sorted(set(result['executed_methods'])|set(chain['executed_methods']))
    outcomes=[]
    if mutation:
        for name,overrides in mutants(after):
            for label, instructions in overrides.items():
                body=copy.deepcopy(after.bodies[bodies.resolve(after,label)])
                body[5]=asm.encode(instructions)[0]
                check_body(after,body)
            try:
                suite(before,after,overrides,legacy=False)
                if integrated: integration(after,overrides)
            except Exception as exc:outcomes.append({'name':name,'detected':True,'static_valid':True,'reason':str(exc)[:500]})
            else:outcomes.append({'name':name,'detected':False,'static_valid':True})
    final=suite(before,after)
    if integrated:integration(after)
    survived=[r['name'] for r in outcomes if not r['detected']]
    result.update(status='fail' if survived else 'pass',mutations=outcomes,mutant_count=len(outcomes),
                  survived=survived,final_baseline='pass',elapsed_seconds=round(time.monotonic()-started,3),
                  boundary='执行最终SWF字节码；网络输出、渲染和主表读取边界为受控夹具；AIR/真机/真实联机未核实')
    if write:(Path(__file__).resolve().parent/'verify-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    assert not survived,survived
    return result


if __name__=='__main__':
    import sys
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    import bootstrap
    from swfabc import SwfAbc
    after=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent/'test.swf'
    r=run(SwfAbc(bootstrap.BASE).abc,SwfAbc(after).abc)
    print(json.dumps({k:r[k] for k in ('status','old_parity_count','new_check_count','mutant_count','survived')}))
