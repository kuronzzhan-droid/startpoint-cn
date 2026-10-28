"""Optional cost_options normalization and existing TypePacker record extension."""
import asm
from c2_common import DYNAMIC,get,set_,queue
from c9_data_records import local
from c17_cost_common import g,p,n


def parse(e,row,first,tag):
    result,rows,index,pair,value,out,seen=range(first,first+7);q=e.q
    code=[p(result),g(row),*get(e,'cost_options'),p(rows),g(rows),('istype',q('Array')),('iffalse',tag+'_done'),
          ('newarray',0),p(out),('newobject',0),p(seen),*n(e,0),p(index),('label',tag+'_loop'),('avm_label',),
          g(index),g(rows),('getproperty',q('length')),('ifge',tag+'_store'),g(rows),g(index),
          ('getproperty',DYNAMIC),p(pair),g(pair),('istype',q('Array')),('iffalse',tag+'_skip'),
          g(pair),('getproperty',q('length')),*n(e,2),('ifne',tag+'_skip')]
    for slot,minimum in ((0,1),(1,0)):
        code += [g(pair),*n(e,slot),('getproperty',DYNAMIC),p(value),g(value),g(value),('convert_i',),
                 ('ifstrictne',tag+'_skip'),g(value),*n(e,minimum),('iflt',tag+'_skip')]
    code += [g(seen),g(pair),*n(e,0),('getproperty',DYNAMIC),('getproperty',DYNAMIC),('iftrue',tag+'_skip'),
        g(seen),g(pair),*n(e,0),('getproperty',DYNAMIC),('pushtrue',),('setproperty',DYNAMIC),
        g(out),g(pair),*n(e,0),('getproperty',DYNAMIC),g(pair),*n(e,1),('getproperty',DYNAMIC),
        ('newarray',2),('callpropvoid',q('http://adobe.com/AS3/2006/builtin::push'),1),('label',tag+'_skip'),('inclocal_i',index),
        ('jump',tag+'_loop'),('label',tag+'_store'),g(out),('getproperty',q('length')),('iffalse',tag+'_done'),
        g(result),*set_(e,'cost_options',[g(out)]),('label',tag+'_done'),g(result)]
    return code


def apply(e):
    report={}
    for label in ('InitializeRealRemote/loadSuccessHandler','RealRemoteService/earlySuccessHandler'):
        body=e.body(label);ops=asm.decode(body[5])
        hits=[i for i,o in enumerate(ops) if o.name=='newobject' and o.args==[7]
              and any(x.name=='pushstring' and e.abc.s(x.args[0])=='affixes' for x in ops[i-7:i])]
        assert len(hits)==1,(label,hits)
        at=hits[0];ri=next(i for i in range(at-35,at) if ops[i].name=='pushstring' and e.abc.s(ops[i].args[0])=='riven_id')
        report[label]=queue(e,label,parse(e,local(ops[ri+1]),body[2],'c17_cost_parse'),at+1)
    label='TypePackerResource2/resolveMap2201';body=e.body(label);ops=asm.decode(body[5]);reg,params=body[2],body[2]+1;q=e.q
    code=[('dup',),p(reg),g(reg),('getproperty',q('h')),e.string('c1.WeaponRivenRecord'),('getproperty',DYNAMIC),
        ('getproperty',q('params')),p(params),g(params),*n(e,0),('getproperty',DYNAMIC),('getproperty',q('h')),
        e.string('cost_options'),e.string('c1.WeaponRivenAffixes'),('setproperty',DYNAMIC)]
    for slot in (1,4):code += [g(params),*n(e,slot),('getproperty',DYNAMIC),e.string('cost_options'),('callpropvoid',q('http://adobe.com/AS3/2006/builtin::push'),1)]
    report[label]=queue(e,label,code,len(ops)-1)
    return report
