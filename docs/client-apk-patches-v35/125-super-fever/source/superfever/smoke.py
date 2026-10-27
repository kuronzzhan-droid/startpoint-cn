import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap
from swfabc import SwfAbc
from superfever.runtime import Harness,row
abc=SwfAbc(Path(__file__).resolve().parent/'test.swf').abc
h=Harness(abc,{101:row('wfx:60:102:10000:10:e',9999,11),102:row('wfx:61:0:2000:103:s'),103:row('end',1,99)})
for i in range(3):h.unit()
h.add_condition(h.members[1],101)
print('pre',h.calls,[(s[1],s[2],s[3]) for s in (h.lex['ConditionSlot']['wfxSuperStates'] or [])])
h.add(10)
print('post',h.calls,[(s[1],s[2],s[3]) for s in (h.lex['ConditionSlot']['wfxSuperStates'] or [])])
print([h.layers(m,102) for m in h.members]);print(h.events)
h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100)
h.remove(h.members[0],102)
print(h.shots)
h.tick(2)
print(h.events)
