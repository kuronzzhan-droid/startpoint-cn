"""完整毒→FixedAttack→applyAttack及Attack→DamageShare→applyDamageShare验证。"""
import argparse,copy,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap,asm,bodies
from framework import sha
from swfabc import SwfAbc
from superdamage.poison import OWNER,TARGETS as POISON
from superdamage.source_share import TARGETS as SHARE,FIELDS
from superdamage.poison_runtime import Harness,slip,fixed,share,apply_share,apply_attack


def scenarios(before,after,overrides=None):
    cases=[]
    def check(name,actual,wanted):
        assert actual==wanted,(name,actual,wanted)
        cases.append(name)
    def machine(abc):
        return Harness(abc,overrides=overrides if abc is after else None)
    def records(events):
        return [x[1] for x in events if x[0]=='record']
    for name,kwargs,expected in [
        ('local',{},True),('local-slot2',{'origin':2},True),
        ('remote',{'stats_battle':'battle-B'},False),('missing-battle',{'stats_battle':None},False),
        ('hostile',{'hostile':True},False),('local-slip',{'poison':False},True)]:
        old,new=machine(before),machine(after)
        old_source,new_source=slip(old,**kwargs),slip(new,**kwargs)
        check(name+' source ownership',new_source.get(OWNER),expected)
        check(name+' source fields preserved',{k:v for k,v in new_source.items() if k!=OWNER},old_source)
        old_result,new_result=fixed(old,old_source),fixed(new,new_source)
        check(name+' result ownership',new_result.get(OWNER),expected)
        check(name+' fixed values preserved',{k:v for k,v in new_result.items() if k!=OWNER},old_result)
        events=apply_attack(new,new_result)
        check(name+' real applyAttack record',records(events),[25] if expected else [])
        old_events=apply_attack(old,old_result)
        check(name+' old enemy behavior',[x for x in events if x[0]!='record'],old_events)
        shared=share(new,new_result)
        check(name+' actual shared ownership',shared[OWNER],expected)
        check(name+' actual shared record',records(apply_share(new,shared)),[25] if expected else [])
    # Explicitly retain ordinary FixedAttack with no provenance metadata.
    for primary,summon,origin in ((True,False,0),(False,True,-1),(False,False,2),(False,False,-1)):
        old,new=machine(before),machine(after)
        source=slip(old)
        source.update(createdByPrimarySquad=primary,createdBySummonsMultiBall=summon,originMemberIndex=origin)
        a,b=fixed(old,source),fixed(new,source)
        check(f'ordinary fixed exact {primary}/{summon}/{origin}',b,a)
        expected=primary or summon or 0<=origin<3
        shared=share(new,b)
        check(f'ordinary share owner {primary}/{summon}/{origin}',shared[OWNER],expected)
        check(f'ordinary share record {primary}/{summon}/{origin}',records(apply_share(new,shared)),[25] if expected else [])
    # Source provenance and each of the original ownership gates remain active.
    for name,changes,expected in [
        ('boss',{'createdByBoss':True},False),('funnel',{'createdByFunnel':True},False),
        ('hostile-field',{'isFromHostile':True},False),('explicit-deny',{OWNER:False},False),
        ('origin-over',{'createdByPrimarySquad':False,'originMemberIndex':3},False),
        ('origin-negative',{'createdByPrimarySquad':False,'originMemberIndex':-1},False)]:
        new=machine(after);result=fixed(new,slip(new))
        result.update(changes)
        shared=share(new,result)
        check('source gate '+name,shared[OWNER],expected)
        check('source gate record '+name,records(apply_share(new,shared)),[])
    new=machine(after);result=fixed(new,slip(new)); result.pop('originMemberIndex')
    shared=share(new,result)
    check('absent origin preserved unowned',shared['originMemberIndex'],-1)
    check('absent origin never slot0',shared[OWNER],False)
    for field in FIELDS:
        new=machine(after);result=fixed(new,slip(new));result.pop(field,None)
        shared=share(new,result)
        check('missing source field '+field,shared[field],-1 if field=='originMemberIndex' else False)
    for kwargs,expected in [({},[25]),({'primary':False},[]),({'mybattle':False},[]),({'hp':1000},[10])]:
        new=machine(after);result=share(new,fixed(new,slip(new)))
        check('share output gates '+str(kwargs),records(apply_share(new,result,**kwargs)),expected)
    for primary in (True,False):
        old,new=machine(before),machine(after)
        source=slip(old); a=share(old,fixed(old,source),only_coop=True)
        b=share(new,fixed(new,source),only_coop=True)
        events=apply_share(new,b,primary=primary)
        check('sync mirror excluded '+str(primary),records(events),[])
        check('sync mirror original effects '+str(primary),events,apply_share(old,a,primary=primary))
    for primary in (True,False):
        old,new=machine(before),machine(after)
        source={'damage':2500}
        a,b=share(old,source,chain=True),share(new,source,chain=True)
        check('public chain share unchanged '+str(primary),b,a)
        check('public chain share unowned '+str(primary),apply_share(new,b,primary=primary),apply_share(old,a,primary=primary))
    return cases


def mutations(before,after):
    for label in POISON+SHARE:
        yield label,'恢复整个原方法',asm.decode(before.bodies[bodies.resolve(before,label)][5])
    opposite={'iffalse':'iftrue','iftrue':'iffalse','iflt':'ifge','ifge':'iflt'}
    for label,start in [(POISON[1],355),(SHARE[0],67),(SHARE[1],63)]:
        raw=asm.decode(after.bodies[bodies.resolve(after,label)][5])
        for i,item in enumerate(raw):
            if i<start:continue
            if label==SHARE[1] and i>80:continue
            if item.name in opposite:
                mutant=copy.deepcopy(raw);mutant[i].op=asm.MNEMONICS[opposite[item.name]]
                yield label,'翻转新来源分支 '+str(i),mutant
    label=POISON[0];raw=asm.decode(after.bodies[bodies.resolve(after,label)][5])
    for i,item in enumerate(raw):
        if item.name in ('equals','not'):
            mutant=copy.deepcopy(raw);mutant[i].op=asm.MNEMONICS['lessthan' if item.name=='equals' else 'convert_b']
            yield label,'颠倒毒归属 '+str(i),mutant


def verify(before,after):
    baseline=scenarios(before,after)
    killed=[]
    for label,reason,mutant in mutations(before,after):
        try:scenarios(before,after,{label:mutant})
        except Exception as exc:killed.append({'method':label,'mutation':reason,'detected':str(exc)[:260]})
        else:raise AssertionError('变异存活: '+label+' '+reason)
    assert scenarios(before,after)==baseline
    return {'status':'PASS','checks':len(baseline),'cases':baseline,'mutants':len(killed),
            'mutation_results':killed,'survivors':[],'final_baseline':'PASS',
            'changed_methods':POISON+SHARE}


def main():
    p=argparse.ArgumentParser();p.add_argument('final',type=Path);args=p.parse_args()
    assert sha(bootstrap.BASE.read_bytes())==bootstrap.BASE_SHA
    before,after=SwfAbc(bootstrap.BASE).abc,SwfAbc(args.final).abc
    report=verify(before,after)
    report['swf_sha256']=sha(args.final.read_bytes())
    Path(__file__).with_name('poison-verify-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({k:report[k] for k in ['status','checks','mutants','final_baseline']}))


if __name__=='__main__':main()
