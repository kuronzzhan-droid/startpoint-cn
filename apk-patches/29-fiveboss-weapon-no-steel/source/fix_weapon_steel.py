"""Hide awakening-crystal substitution only for Five Boss weapon 5900101.

Continue from this task's exact cumulative Lens v2 SWF, preserving every other
method and all existing pool entries. No full-class compiler output is used.
"""
import argparse
import copy
import json
from pathlib import Path
import build_swf as b
from swfabc import PoolEditor

LABEL = 'pinball.common.data.item::OwnedEquipmentLogic/getUseableAwakingCrystal|1'


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--base',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True);ap.add_argument('--expected-sha256',required=True)
    args=ap.parse_args();assert b.sha(args.base.read_bytes())==args.expected_sha256
    assert not args.out.exists()
    view=b.View(b.SwfAbc(args.base),b.asm);a=view.a;baseline=copy.deepcopy(a)
    assert view.by_label[LABEL]==[19690]
    index=19690;body=a.bodies[index];before=view.normalized(index)
    assert len(before[0])==50 and before[1]==[] and body[:5]==[20681,2,5,1,2]
    assert before[0][0][0]==0xd0 and before[0][1][0]==0x30
    def qname(namespace,name):
        ids=[i for i in range(1,len(a.multinames)) if view.mn(i)==(7,(22,namespace),name)]
        assert ids, (namespace,name)
        return ids[0]
    pool=PoolEditor(a)
    block=b.asm.assemble([
        ('getlocal_0',),('getproperty',qname('','id')),
        ('pushint',pool.integer(5900101)),('ifne','ORIGINAL'),
        ('getlex',qname('haxe.ds','Option')),('getproperty',qname('','None')),('returnvalue',),
        ('label','ORIGINAL'),
    ])
    code,exceptions,instructions=b.asm.splice(body,2,block)
    stack,scope,_=b.asm.simulate(instructions,body[3],multinames=a.multinames)
    assert stack<=body[1] and scope<=body[4]
    body[5]=code;body[6]=exceptions
    proof=b.insertion_proof(before,view.normalized(index),[{'at':2,'instructions':len(block)}])
    for i,(old,new) in enumerate(zip(baseline.bodies,a.bodies)):
        if i!=index:assert b.freeze(old)==b.freeze(new)
    assert len(baseline.bodies)==len(a.bodies)
    for attr in ('methods','metadata','instances','classes','scripts'):
        assert b.freeze(getattr(baseline,attr))==b.freeze(getattr(a,attr))
    for attr in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
        old=getattr(baseline,attr);assert b.freeze(getattr(a,attr)[:len(old)])==b.freeze(old)
    view.swf.save(args.out);readback=b.View(b.SwfAbc(args.out),b.asm)
    assert readback.normalized(index)==view.normalized(index)
    assert view.swf.body[:view.swf._offset]==readback.swf.body[:readback.swf._offset]
    assert view.swf.body[view.swf._offset+view.swf._length:]==readback.swf.body[readback.swf._offset+readback.swf._length:]
    result={'status':'static_swf_guard_verified','input':str(args.base),'input_sha256':args.expected_sha256,
            'swf_sha256':b.sha(args.out.read_bytes()),'changed_body':'284:19690','method':LABEL,
            'weapon_id':5900101,'added_instructions':len(block),'old_instructions_and_edges_preserved':proof,
            'all_other_bodies_preserved':True,'existing_pools_preserved':True,'non_main_abc_tags_preserved':True,
            'device_tested':False}
    args.out.with_suffix('.report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':main()
