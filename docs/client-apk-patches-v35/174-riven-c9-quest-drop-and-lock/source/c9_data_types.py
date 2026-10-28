"""C9 append-only TypePacker descriptor extensions, without runtime types."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, queue
from c9_data_records import FIELDS

COMMON='pinball.remote.common.CommonResponse'
FINISH='pinball.remote.quest.finish.BattleQuestFinishResponse'
CONTEXT='pinball.common.data.quest.battle.QuestResultContext'
GRANTED='weapon_riven_granted'


def queue_types(e):
    label='TypePackerResource2/resolveMap2201'
    body=e.body(label); ops=asm.decode(body[5]); reg,params,optional,descriptor=range(body[2],body[2]+4)
    g=lambda v:('getlocal',v)
    p=lambda v:('setlocal',v)
    gp=lambda v:('getproperty',e.q(v))
    n=lambda v:number(e,v)
    extensions={'c1.WeaponRivenRecord':FIELDS,COMMON:{GRANTED:'Array<Int>'},
                FINISH:{GRANTED:'Array<Int>'},CONTEXT:{GRANTED:'Array<Int>'}}
    code=[('dup',),p(reg)]
    for idx,(name,fields) in enumerate(extensions.items()):
        code += [g(reg),gp('h'),e.string(name),('getproperty',DYNAMIC),('dup',),p(descriptor),gp('params'),p(params)]
        for field,kind in fields.items():
            code += [g(params),n(0),('getproperty',DYNAMIC),gp('h'),e.string(field),
                     e.string(kind),('setproperty',DYNAMIC),g(params),n(1),('getproperty',DYNAMIC),
                     e.string(field),('callpropvoid',e.q('push'),1)]
        done='c9_optional_'+str(idx)
        code += [g(params),n(4),('getproperty',DYNAMIC),p(optional),g(optional),('iftrue',done),
                 ('newarray',0),p(optional),g(descriptor),
                 *[op for slot in range(4) for op in (g(params),n(slot),('getproperty',DYNAMIC))],
                 g(optional),('newarray',5),('setproperty',e.q('params')),('label',done)]
        for field in fields:
            code += [g(optional),e.string(field),('callpropvoid',e.q('push'),1)]
    queue(e,label,code,len(ops)-1)
    return {'extensions':extensions,'all_optional':True,'new_runtime_types':[]}
