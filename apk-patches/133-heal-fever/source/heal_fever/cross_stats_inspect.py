import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap
from swfabc import SwfAbc
from common import listing
import bodies
abc=SwfAbc(bootstrap.BASE).abc
out=Path(__file__).resolve().parent/'review-native';out.mkdir(exist_ok=True)
for index,label in bodies.label_map(abc).items():
 if label.endswith('/summerizeAttackToEnemy') or label in ['SquadManagerImpl/summerizeAttackResult','EnemyImpl/applyAttack','BattleZoneMemberStats/summerizeAttackResult','BattleZoneMemberStats/summerizeAttackResultAsOrigin']:
  text='\n'.join(listing(abc,abc.bodies[index][5]))
  (out/(label.replace('/','__')+'.txt')).write_text(text,encoding='utf-8');print(label, len(text))

