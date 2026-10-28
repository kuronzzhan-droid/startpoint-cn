"""双输入最终指令验收：保持性、继承回归和三Battle规模分片。"""
import argparse
import time
import bootstrap
from bootstrap import ROOT, INPUTS, sha
from build import json_write
from inheritance import run as inherited


def run(candidate=False):
    directory = ROOT/'work' if candidate else ROOT
    report = {'status':'running','scope':'offline AVM2 instruction fixtures; not AIR/device acceptance',
              'source_evidence':bootstrap.source_evidence(),'profiles':{}}
    target=directory/'verify-report.json'
    json_write(target,report)
    start=time.perf_counter()
    try:
        from verify_structural import run as structural
        report['structure']=structural(candidate)['status']
        from test_scale_acceptance import verify_swf
        for profile,(_,_,name) in INPUTS.items():
            path=directory/name
            detail={'sha256':sha(path.read_bytes()),'tests':{}}
            report['profiles'][profile]=detail
            detail['tests']['inherited']=inherited(path,directory,profile)
            from test_oversize_diag import verify_swf as oversize_diag
            diag=oversize_diag(path)
            json_write(directory/('oversize-'+profile+'.json'),diag)
            detail['tests']['oversize']={'status':diag['status'],'evidence':'oversize-'+profile+'.json'}
            scale=verify_swf(path)
            assert scale['status']=='pass'
            json_write(directory/('scale-'+profile+'.json'),scale)
            detail['tests']['scale']={'status':'pass','evidence':'scale-'+profile+'.json'}
        assert report['source_evidence']==bootstrap.source_evidence(),'编译或测试源在验收中变更'
        report['status']='pass'
    except Exception as exc:
        report.update(status='fail',error=str(exc))
        json_write(target,report)
        raise
    report['elapsed_seconds']=round(time.perf_counter()-start,2)
    json_write(target,report)
    print('run17 verify '+report['status'],flush=True)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--candidate',action='store_true')
    run(parser.parse_args().candidate)
