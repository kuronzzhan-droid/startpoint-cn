import sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
import bootstrap,bodies
from swfabc import SwfAbc
from common import listing
abc=SwfAbc(HERE.parent.parent/'run2/v35b.swf').abc
for row in abc.instances:
 if abc.mn_name(row[0]).split('::')[-1] in ['FeverPointGaugeImpl','ConditionSlot','ConditionChange','ConditionChanges','UniqueConditionValues']:
  print(abc.mn_name(row[0]),'base',abc.mn_name(row[1]))
  print([(abc.mn_name(t.name),t.data) for t in row[6]])
for i,label in bodies.label_map(abc).items():
 if any(s in label for s in ['ConditionChangeTools$/','ConditionChanges/','ConditionChange$/','ConditionChange/<ctor>','UniqueConditionValues/','MemberImpl/internalApplyConditionChanges','MemberImpl/applyInstantAbilityCondition','ConditionMasterValueTools$/','FeverPointGaugeImpl/run']):
  body=abc.bodies[i]
  (HERE/(label.replace('/','__').replace('<','').replace('>','').replace('|','_')+'.txt')).write_text(f'{label} header={body[1:5]} method={abc.methods[body[0]]}\n'+'\n'.join(listing(abc,body[5])),encoding='utf-8')
  print(label)
