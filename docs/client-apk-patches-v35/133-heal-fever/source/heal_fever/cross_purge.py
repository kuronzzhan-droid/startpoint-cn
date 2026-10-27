"""独立执行原生purge，检查新增分类元数据同步释放。"""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap
from swfabc import SwfAbc
from heal_damage.runtime import Harness


def verify(abc):
 h=Harness(abc,{1:'wfx:30:4:10000:0:test'},delayed=True)
 h.unit([h.condition(1)]);target=h.unit(hp=80);h.heal(target,20);h.tick(30)
 head=None
 for shot in reversed(h.flights):
  shot['playhead']=None
  shot['dispose']=lambda shot=shot:h.run('AbilityDamageShot/dispose',shot)
  head={'item':shot,'next':head}
 items={'h':head}
 items['clear']=lambda:items.__setitem__('h',None)
 manager={'shots':items}
 initial=len(h.lex['MemberImpl']['wfxHealShots'])
 h.run('AbilityDamageManagerImpl/purge',manager)
 result={'before_metadata_entries':initial,'after_metadata_entries':len(h.lex['MemberImpl']['wfxHealShots']),
         'native_manager_list_cleared':items['h'] is None,'flights_purged':len(h.flights)}
 assert result['after_metadata_entries']==0 and result['native_manager_list_cleared'],result
 for shot in h.flights:h.run('AbilityDamageShot/dispose',shot)
 assert h.lex['MemberImpl']['wfxHealShots']==[],'重复dispose不应重建或双扣其他条目'
 result['repeat_dispose_idempotent']=True
 return result


if __name__=='__main__':
 source=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'heal_damage'/'probe.swf'
 result=verify(SwfAbc(source).abc)
 print(json.dumps(result))
 (Path(__file__).resolve().parent/'purge-review-result.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
