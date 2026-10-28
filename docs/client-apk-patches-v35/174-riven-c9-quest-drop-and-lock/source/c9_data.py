"""C9 shared granted-list normalization and optional response parsing."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, set_, queue
from c9_data_records import queue_records
from c9_data_types import queue_types, GRANTED


def parse_granted(e, source, target, first, tag):
    rows,index,value,out,seen=range(first,first+5)
    g=lambda v:('getlocal',v)
    p=lambda v:('setlocal',v)
    n=lambda v:number(e,v)
    done,test,skip,store=[tag+'_'+s for s in ('done','test','skip','store')]
    return [*source,*get(e,GRANTED),p(rows),g(rows),('istype',e.q('Array')),('iffalse',done),
            ('newarray',0),p(out),('newobject',0),p(seen),n(0),p(index),
            ('label',test),('avm_label',),g(index),g(rows),('getproperty',e.q('length')),('ifge',store),
            g(rows),g(index),('getproperty',DYNAMIC),p(value),g(value),g(value),('convert_i',),
            ('ifstrictne',skip),g(value),n(16000001),('iflt',skip),g(value),n(16000999),('ifgt',skip),
            g(seen),g(value),('getproperty',DYNAMIC),('iftrue',skip),g(seen),g(value),('pushtrue',),
            ('setproperty',DYNAMIC),g(out),g(value),('callpropvoid',e.q('push'),1),
            ('label',skip),('inclocal_i',index),('jump',test),('label',store),
            *target,*set_(e,GRANTED,[g(out)]),('label',done)]


def queue_data(e):
    records=queue_records(e)
    label='RealRemoteService/earlySuccessHandler'
    body=e.body(label);ops=asm.decode(body[5])
    at=next(i+4 for i,o in enumerate(ops) if o.name=='pushstring' and e.abc.s(o.args[0])=='weapon_riven_deleted'
            and i>0 and ops[i-1].name=='getlocal' and ops[i-1].args==[28]
            and ops[i+2].name=='setproperty')
    # Insert directly after the inherited deleted-list assignment; no existing locals are changed.
    at-=1
    code=parse_granted(e,[('getlocal_2',),('getproperty',e.q('rawData')),*get(e,'data')],
                       [('getlocal',28)],body[2]+6,'c9_common_granted')
    parse=queue(e,label,code,at)
    return {'records':records,'types':queue_types(e),'common_granted':parse}
