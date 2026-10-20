"""对最终SWF执行旧行为对照、新场景、语义变异和恢复全绿。"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
if __package__ in (None,''):
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap
import bodies
from swfabc import SwfAbc
from heal_any.cases import parity,scenarios
from heal_any.resources import suite
from heal_any.edges import suite as edges
from heal_any.coop_cases import suite as coop
from heal_any.mutations import run as mutate
from heal_any.patches import TARGETS,ADDED
from heal_any.ct_cases import suite as ct_cases
from heal_any.ct_parity import suite as ct_parity
from heal_any.ct_mutations import run as ct_mutate

PRE_CT = bootstrap.ROOT/'work/pre-ct/v35k.swf'
PRE_CT_SHA = '608bf66914dc5e0a0b8c16e795b88692f67b2b9a23a898be4254c42710e4353b'


def source_locks():
    paths=set(Path(__file__).resolve().parent.glob('*.py'))
    for module in list(sys.modules.values()):
        filename=getattr(module,'__file__',None)
        if filename:
            path=Path(filename).resolve()
            if path.suffix=='.py' and path.is_relative_to(bootstrap.ROOT.parent): paths.add(path)
    return [{'path':os.path.relpath(path,bootstrap.ROOT).replace('\\','/'),
             'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(paths)]


def run(before,after,previous):
    digest=lambda:{l:hashlib.sha256(after.bodies[bodies.resolve(after,l)][5]).hexdigest()
                   for l in TARGETS+ADDED}
    locked=digest()
    old=parity(before,after)
    new=scenarios(after)+edges(after)+coop(after)
    resources=suite(before,after)
    compatibility=ct_parity(previous,after)
    ct=ct_cases(after)
    mutations=mutate(before,after)+ct_mutate(previous,after)
    survivors=[m for m in mutations if m['status']!='killed']
    assert not survivors,survivors
    assert digest()==locked
    assert old==parity(before,after) and new==scenarios(after)+edges(after)+coop(after) and resources==suite(before,after)
    assert compatibility==ct_parity(previous,after) and ct==ct_cases(after)
    return {'status':'pass','old_parity_count':len(old)+len(compatibility),'new_check_count':len(new)+len(resources)+len(ct),
            'mutant_count':len(mutations),'survived':0,'final_baseline':'pass',
            'old_checks':old+compatibility,'new_checks':new+resources+ct,'mutations':mutations,'methods':locked,
            'ct':{'previous_swf_sha256':PRE_CT_SHA,'second_edition_byte_parity_count':len(compatibility),
                  'scenarios':len(ct),'logic_frames_per_second':60,'example_ct_frames':300,
                  'final_full_baseline_after_mutations':'pass'},
            'scope':'真实AVM2字节码离线解释执行；AIR/真机/真实网络未核实',
            'rulings':{'coop':'B：34/35允许跨statsBattleId本端实际回复；30/31原排除不变',
                       'fever':'A：每个受治疗成员applyHeal中，每持有者量化后立即调用一次，无批次标记'},
            'known_boundary':'本端battle及primary成员身份限定；转发/反馈无applyHeal，镜像无新效果；真实网络传输及重复包未核实'}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--before',type=Path,default=bootstrap.BASE)
    parser.add_argument('--after',type=Path,default=bootstrap.ROOT/'v35k.swf')
    parser.add_argument('--output',type=Path,default=Path(__file__).with_name('verify-report.json'))
    args=parser.parse_args()
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    assert sha(args.before)==bootstrap.BASE_SHA
    assert sha(PRE_CT)==PRE_CT_SHA, '第二版基线SHA不符'
    before,after=SwfAbc(args.before).abc,SwfAbc(args.after).abc
    previous=SwfAbc(PRE_CT).abc
    sources=source_locks()
    report=run(before,after,previous)
    assert source_locks()==sources,'验证期间源码或执行依赖集合变化'
    report.update(before_swf_sha256=sha(args.before),after_swf_sha256=sha(args.after))
    report['evidence_source_locks']=sources
    report['evidence_sources_unchanged_during_verification']=True
    destination=args.output.resolve()
    assert destination.is_relative_to(Path(__file__).resolve().parent)
    destination.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['status','old_parity_count','new_check_count','mutant_count','survived','final_baseline']}))


if __name__=='__main__': main()
