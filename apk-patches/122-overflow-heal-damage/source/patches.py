"""码27入口及 reference=3 拼接；保留已有 reference0-2 与旧32视觉体。"""
import json
from pathlib import Path
import asm
from perf2_core import splice_with_exits
from .symbols import symbols,MEMBER,DEC,REF
from . import record,timing
TARGETS=['MemberImpl/applyHeal','SquadManagerImpl/updatePhase','AbilityDamageShot/finish']

def build(e):
 m=symbols(e);q=m['q']
 queue,battle,pending=timing.install_queue(e,m)
 emit=timing.install_emit(e,m)
 tick=timing.install_tick(e,m,battle,pending,emit)
 rec=record.install(e,m,queue)
 b=e.body('MemberImpl/applyHeal'); ins=asm.decode(b[5]); assert ins[190].name=='returnvoid'
 e.insert('MemberImpl/applyHeal',190,[('getlocal_0',),('getlocal_1',),('getlocal_2',),('getlocal',4),('getlocal',6),('subtract',),('callpropvoid',rec,3)])
 b=e.body('SquadManagerImpl/updatePhase'); ins=asm.decode(b[5]); assert ins[28].name=='returnvoid'
 e.insert('SquadManagerImpl/updatePhase',28,[('getlex',q(MEMBER)),('getlocal_0',),('callpropvoid',tick,1)])
 label='AbilityDamageShot/finish';b=e.body(label);ins=asm.decode(b[5]);assert ins[126].name=='lookupswitch' and ins[126].cases==[128,143,155]
 # Pre-switch guard: reference 3 maps constant base + multiplier 1. Untouched 0-2 enter exact old switch.
 code=[('getlocal_1',),('getproperty',q('reference')),e.number(3),('ifne','END'),
       ('getlex',q(REF)),('getlocal_1',),('getproperty',q('strength')),('getlex',q(DEC)),e.number(1),
       ('callproperty',q('fromInt'),1),('callproperty',q('MaxHpParameter'),2),('setlocal',9),('jump','COMMON'),('label','END')]
 raw,exc,_,_=splice_with_exits(b,124,code,{'COMMON':162},asm.ENTER)
 e.replace(label,raw,exc)
 return {'targets':TARGETS}

