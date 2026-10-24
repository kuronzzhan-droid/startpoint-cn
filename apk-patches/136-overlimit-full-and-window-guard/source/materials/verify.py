"""正式 SWF 真实字节码验收、有效变异、恢复后的完整基线。"""
import argparse,hashlib,json,sys,time,os
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
import bootstrap
from swfabc import SwfAbc
from materials.patches import TARGETS
from materials.helper import HELPER
from materials.cases import suite,body
from materials.mutations import candidates,reference,smoke


def source_locks():
    paths=set(HERE.glob('*.py'))
    paths.update(bootstrap.ROOT/name for name in ['bootstrap.py','framework.py','static_check.py'])
    for module in list(sys.modules.values()):
        file=getattr(module,'__file__',None)
        if file:
            p=Path(file).resolve()
            if p.suffix=='.py' and p.is_relative_to(bootstrap.ROOT.parent):paths.add(p)
    return [{'path':os.path.relpath(p,bootstrap.ROOT).replace('\\','/'),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(paths)]


def run(before=bootstrap.BASE,after=bootstrap.ROOT/'v35h.swf',mutations=True):
    begin=time.monotonic()
    hashes={name+'_swf_sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest() for name,p in [('before',before),('after',after)]}
    assert hashes['before_swf_sha256']==bootstrap.BASE_SHA
    old=SwfAbc(before).abc;new=SwfAbc(after).abc
    sources=source_locks();result=suite(old,new)
    expected=reference(new);result['mutation_probe_baseline_checks']=smoke(new,expected)
    killed=[];survived=[]
    if mutations:
        for label,name,raw,static in candidates(new):
            target=body(new,label);saved=target[5];target[5]=raw
            try:smoke(new,expected)
            except AssertionError as exc:
                killed.append({'method':label,'mutation':name,'status':'killed','static_check':static,'failure':str(exc)[:1200]})
            else:survived.append({'method':label,'mutation':name})
            finally:target[5]=saved
        final=suite(old,new)
        assert all(final[k]==result[k] for k in ('old_parity_count','new_check_count','examples'))
        assert smoke(new,expected)==result['mutation_probe_baseline_checks']
    assert source_locks()==sources,'验证中源码变化'
    result.update(status='pass' if not survived else 'fail',**hashes,mutants=killed,
      mutant_count=len(killed)+len(survived),survived=survived,all_mutants_killed=not survived,
      final_baseline='pass',evidence_source_locks=sources,evidence_sources_unchanged_during_verification=True,
      elapsed_seconds=round(time.monotonic()-begin,3),
      method_locks={label:{'sha256':hashlib.sha256(body(new,label)[5]).hexdigest(),'header':body(new,label)[1:5]} for label in TARGETS+[HELPER]},
      boundary='八个入口及O1/rest/max/全程助手均解释执行真实AVM2到return；表、集合和UI资源为夹具。AIR/真机未核实')
    (HERE/'verify-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    assert not survived,survived
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--before',type=Path,default=bootstrap.BASE)
    p.add_argument('--after',type=Path,default=bootstrap.ROOT/'v35h.swf');p.add_argument('--no-mutations',action='store_true')
    a=p.parse_args();r=run(a.before,a.after,not a.no_mutations)
    print(json.dumps({k:r[k] for k in ['status','old_parity_count','new_check_count','mutant_count','survived','final_baseline','elapsed_seconds']},ensure_ascii=False))
