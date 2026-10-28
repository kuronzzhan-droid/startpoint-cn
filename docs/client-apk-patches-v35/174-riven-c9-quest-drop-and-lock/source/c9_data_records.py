"""C9 optional record fields and two/three-element affix normalization."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, set_, queue

FIELDS = {'disposition': 'Int', 'locked': 'Int', 'seen': 'Int',
          'dismantle_return': 'c1.WeaponRivenAffixes'}


def local(op):
    if op.name == 'getlocal': return op.args[0]
    if op.name.startswith('getlocal_'): return int(op.name[-1])
    raise AssertionError(op.name)


def length_compatible(e, term, validate_cap, tag):
    """Stack contains tuple length. Map a valid triple to the inherited length 2."""
    n=lambda v:number(e,v)
    g=lambda v:('getlocal',v)
    valid,done,bad=[tag+s for s in ('_valid','_done','_bad')]
    code=[('dup',),n(3),('ifne',done)]
    if validate_cap:
        code += [g(term),n(2),('getproperty',DYNAMIC),g(term),n(2),
                 ('getproperty',DYNAMIC),('convert_i',),('ifstrictne',bad),
                 g(term),n(2),('getproperty',DYNAMIC),n(1),('iflt',bad),
                 g(term),n(2),('getproperty',DYNAMIC),n(100),('ifgt',bad)]
    code += [('pop',),n(2),('jump',done)]
    if validate_cap: code += [('label',bad),('pop',),n(4)]
    return code+[('label',done)]


def append_cap(e, term, tag):
    return [('getlocal',term),('getproperty',e.q('length')),number(e,3),
            ('ifne',tag),('dup',),('getlocal',term),number(e,2),
            ('getproperty',DYNAMIC),('callpropvoid',e.q('push'),1),('label',tag)]


def optional_fields(e, row, first, tag):
    result,value,rows,index,pair,out=range(first,first+6)
    g=lambda v:('getlocal',v)
    p=lambda v:('setlocal',v)
    n=lambda v:number(e,v)
    code=[p(result)]
    for field,lo,hi in [('disposition',1,5),('locked',0,1),('seen',0,1)]:
        done=tag+'_'+field
        code += [g(row),*get(e,field),p(value),g(value),g(value),('convert_i',),('ifstrictne',done),
                 g(value),n(lo),('iflt',done),g(value),n(hi),('ifgt',done),
                 g(result),*set_(e,field,[g(value)]),('label',done)]
    done,test,skip,store=[tag+'_'+s for s in ('done','test','skip','store')]
    code += [g(row),*get(e,'dismantle_return'),p(rows),g(rows),('istype',e.q('Array')),
             ('iffalse',done),('newarray',0),p(out),n(0),p(index),('label',test),
             ('avm_label',),g(index),g(rows),('getproperty',e.q('length')),('ifge',store),
             g(rows),g(index),('getproperty',DYNAMIC),p(pair),g(pair),('istype',e.q('Array')),
             ('iffalse',skip),g(pair),('getproperty',e.q('length')),n(2),('ifne',skip)]
    for slot,minimum in [(0,1),(1,0)]:
        code += [g(pair),n(slot),('getproperty',DYNAMIC),p(value),g(value),g(value),
                 ('convert_i',),('ifstrictne',skip),g(value),n(minimum),('iflt',skip)]
    code += [g(out),g(pair),n(0),('getproperty',DYNAMIC),g(pair),n(1),
             ('getproperty',DYNAMIC),('newarray',2),('callpropvoid',e.q('push'),1),
             ('label',skip),('inclocal_i',index),('jump',test),('label',store),
             g(result),*set_(e,'dismantle_return',[g(out)]),('label',done),g(result)]
    return code


def queue_records(e):
    report={}
    for label in ['InitializeRealRemote/loadSuccessHandler','RealRemoteService/earlySuccessHandler']:
        body=e.body(label); ops=asm.decode(body[5]); rows=[]
        # Precisely identify the two C1 deep-copy loops by their integer strict checks.
        for i,op in enumerate(ops):
            if op.name!='pushbyte' or op.args!=[2] or ops[i+1].name!='ifne': continue
            if ops[i-1].name!='getproperty' or e.abc.mn_name(ops[i-1].args[0])!='length': continue
            if not any(x.name=='ifstrictne' for x in ops[i+2:i+15]): continue
            term=local(ops[i-2]); tag='c9_tuple_'+str(i)
            queue(e,label,length_compatible(e,term,True,tag),i)
            array=next(j for j in range(i+2,i+100) if ops[j].name=='newarray' and ops[j].args==[2])
            queue(e,label,append_cap(e,term,tag+'_copy'),array+1)
            rows.append({'length_at':i,'copy_at':array+1,'term_local':term})
        assert len(rows)==2,(label,rows)
        # The record is the only newobject(7) immediately after literal pending.
        hits=[i for i,op in enumerate(ops) if op.name=='newobject' and op.args==[7]
              and any(x.name=='pushstring' and e.abc.s(x.args[0])=='affixes' for x in ops[i-7:i])]
        assert len(hits)==1,(label,hits)
        at=hits[0]
        ri=next(i for i in range(at-35,at) if ops[i].name=='pushstring' and e.abc.s(ops[i].args[0])=='riven_id')
        row=local(ops[ri+1])
        queue(e,label,optional_fields(e,row,body[2],'c9_record'),at+1)
        report[label]={'tuple_sites':rows,'optional_record_at':at+1}
    for label in ['GeneralAbilitySoulLogic/getAbility','PartyLogic/getBattleParty']:
        ops=asm.decode(e.body(label)[5]); sites=[]
        for i,op in enumerate(ops):
            if op.name=='pushbyte' and op.args==[2] and ops[i+1].name=='ifne' and ops[i-1].name=='getproperty' and e.abc.mn_name(ops[i-1].args[0])=='length':
                queue(e,label,length_compatible(e,local(ops[i-2]),False,'c9_flat_'+str(i)),i)
                sites.append(i)
        assert len(sites)==1,(label,sites)
        report[label]={'tuple_length_sites':sites,'snapshot':'item_id,weapon_id,key,L; cap_L excluded'}
    return report
