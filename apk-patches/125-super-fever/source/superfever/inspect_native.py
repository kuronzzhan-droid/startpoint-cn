"""只读输入SWF，保存本组需要的原生方法证据。"""
import os,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.dont_write_bytecode=True
sys.path.insert(0,str(HERE.parent.parent/'run2'))
import bootstrap
from swfabc import SwfAbc
import bodies
from common import listing
abc=SwfAbc(HERE.parent.parent/'run2/v35b.swf').abc
labels=bodies.label_map(abc)
selected=['FeverPointGaugeImpl/','ConditionSlot/','Condition/','MemberImpl/applyCondition','MemberImpl/getConditions','SquadManagerImpl/getLeader','SquadManagerImpl/getPrimary','SquadManagerImpl/updatePhase','ConditionContent$/','ConditionTargetKind$/','UniqueConditionTableRow/','UniqueConditionValues/']
for i,label in labels.items():
 if any(label.startswith(s) for s in selected):
  body=abc.bodies[i]
  path=HERE/(label.replace('/','__').replace('<','').replace('>','').replace('|','_')+'.txt')
  path.write_text(f'{label} header={body[1:5]} method={abc.methods[body[0]]}\n'+'\n'.join(listing(abc,body[5])),encoding='utf-8')
print('\n'.join(label for label in labels.values() if any(label.startswith(s) for s in selected)))
