"""Independent ABC comparison and actual-bytecode lifecycle matrix."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace as Obj
sys.path.insert(0,str(Path(__file__).resolve().parent))
import patch
import asm
from swfabc import SwfAbc


def run(ins,a,owner,hostile,count,total,statistics=False,invisible=False):
    calls=[]
    def get_count(target):
        calls.append(target)
        assert target==('Unique',1499901)
        return count
    regs={0:Obj(owner=Obj(index=owner),getConditionAccumulationCount=get_count,
                get_isInvisibleSlot=lambda:invisible,
                exceptsReductionForStatistics=statistics),1:hostile,3:total}
    stack=[];pc=0
    def name(m):return a.mn_name(m).split('::')[-1]
    while pc<len(ins):
        x=ins[pc];op,args=x.name,x.args;pc+=1
        if op.startswith('getlocal_'):stack.append(regs[int(op[-1])])
        elif op=='getlocal':stack.append(regs[args[0]])
        elif op.startswith('setlocal_'):regs[int(op[-1])]=stack.pop()
        elif op=='setlocal':regs[args[0]]=stack.pop()
        elif op=='getproperty':stack.append(getattr(stack.pop(),name(args[0])))
        elif op=='pushint':stack.append(a.ints[args[0]])
        elif op=='pushbyte':stack.append(args[0])
        elif op=='getlex':
            assert args[0]==8990;stack.append(Obj(Unique=lambda uid:('Unique',uid)))
        elif op=='callproperty':
            vals=[stack.pop()for _ in range(args[1])][::-1]
            obj=stack.pop();stack.append(getattr(obj,name(args[0]))(*vals))
        elif op=='coerce':pass
        elif op=='convert_i':stack.append(int(stack.pop()))
        elif op=='convert_d':stack.append(float(stack.pop()))
        elif op in ('multiply','subtract'):
            y,z=stack.pop(),stack.pop();stack.append(z*y if op=='multiply'else z-y)
        elif op=='iftrue':
            if stack.pop():pc=x.target
        elif op in ('ifne','ifle'):
            y,z=stack.pop(),stack.pop()
            condition=z!=y if op=='ifne'else z<=y
            if condition:pc=x.target
        else:raise AssertionError(op)
    assert not stack
    return regs[3],calls


def verify(source,final,build_report,output):
    source,final,build_report,output=map(Path,(source,final,build_report,output))
    assert patch.sha(source.read_bytes())in patch.ACCEPTED_INPUTS
    before,after=SwfAbc(source),SwfAbc(final)
    p=patch.REPO/'client-patch/rank-scene-p2/independent/myabc.py'
    spec=importlib.util.spec_from_file_location('sunburn_independent_abc',p)
    independent=importlib.util.module_from_spec(spec);spec.loader.exec_module(independent)
    a,b=independent.parse_abc(before._raw),independent.parse_abc(after._raw)
    for key in ('methods','metadata','classes','scripts','instances'):assert a[key]==b[key],key
    for key in a['pools']:
        x,y=a['pools'][key],b['pools'][key];assert x==y[:len(x)],key
        if key!='ints':assert x==y,key
    changed=[i for i,(x,y)in enumerate(zip(a['bodies'],b['bodies']))if x!=y]
    assert changed==[56922] and len(a['bodies'])==len(b['bodies'])
    old,new=a['bodies'][56922],b['bodies'][56922]
    for key in old:
        if key!='code':assert old[key]==new[key],key
    report=json.loads(build_report.read_text(encoding='utf-8'))
    assert patch.sha(final.read_bytes())==report['output_sha256']
    assert asm.unsplice(new['code'],241,report['insert_count'])==old['code']
    assert before.body[:before._offset]==after.body[:after._offset]
    assert before.body[before._offset+before._length:]==after.body[after._offset+after._length:]
    all_ins=asm.decode(new['code']);ins=[]
    for x in all_ins[241:241+report['insert_count']]:
        ins.append(asm.Instruction(x.op,x.args,target=None if x.target is None else x.target-241))
    cases=[]
    for owner in (0,1,2):
        for hostile in (False,True):
            for statistics in (False,True):
                for invisible in (False,True):
                    for count in (-2,0,1,2,3,4,100):
                        for total in (-90000,0,40000):
                            actual,calls=run(ins,after.abc,owner,hostile,count,total,statistics,invisible)
                            eligible=owner==2 and not hostile and not invisible
                            expected=total-min(3,max(0,count))*15000 if eligible else total
                            assert actual==expected,(owner,hostile,statistics,invisible,count,total,actual)
                            assert bool(calls)==eligible
                            cases.append([owner,hostile,statistics,invisible,count,total,actual])
    life=[0,1,2,3,3,1,0]
    observed=[run(ins,after.abc,2,False,n,0)[0]for n in life]
    assert observed==[0,-15000,-30000,-45000,-45000,-15000,0]
    # Native EnemyImpl remains exactly unchanged: its existing lower limit and
    # hostile-side addition are preserved. Exercise their composition explicitly.
    assert a['bodies'][53363]==b['bodies'][53363]
    negative=run(ins,after.abc,2,False,3,-90000)[0]
    assert max(-100000,negative)+25000==-75000
    result={'status':'static_verified_runtime_pending','matrix_case_count':len(cases),
            'lifecycle_counts':life,'lifecycle_resistance_decimal':observed,
            'statistics_mode_same_bad_debuff_semantics':True,
            'invisible_slot_unchanged':True,
            'native_enemy_clamp_and_hostile_side_preserved':True,
            'only_changed_method':56922,'all_other_abc_and_swf_bytes_preserved':True,
            'output_sha256':patch.sha(final.read_bytes())}
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ('source','final','build_report','output'):p.add_argument(arg,type=Path)
    x=p.parse_args();verify(x.source,x.final,x.build_report,x.output)
