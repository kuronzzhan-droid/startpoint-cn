import sys,json,hashlib
from pathlib import Path
p=Path(r'D:\WF\v35-generic-20261018\run6\heal_fever')
d=p.parent/'heal_damage'
sha=lambda x:hashlib.sha256(x.read_bytes()).hexdigest()
files=['patches.py','sample.py','record.py','timing.py','emission.py','stance.py','cases.py','runtime.py','damage_fixture.py']
report={
 'status':'reviewed_logic_pass_with_spec_conflict_pending',
 'candidate':'run6/heal_damage/probe.swf','candidate_sha256':sha(d/'probe.swf'),
 'reviewed_sources':{f:sha(d/f) for f in files},
 'scope':['真实共享治疗采样和原方法调用次数保持','有效/溢出百分比与层数快照','有符号贡献同类相加和窗口退休','码27并存与每治疗者每分类窗口','异步弹分类元数据生命周期','实际原生分类统计消费和治疗者归属'],
 'findings':[{
   'id':'HD-PURGE-01','severity':'medium','status':'fixed_and_independently_retested',
   'description':'原实现只在finish消费分类元数据，原生AbilityDamageManagerImpl.purge只调用dispose导致同battle残留强引用。',
   'original_reproduction':{'before_metadata_entries':1,'after_metadata_entries':1,'native_manager_list_cleared':True,'flights_purged':2},
   'fix':'每弹独立Instant地址和单次元数据条目；finish与dispose入口同调用take，首次删除后后续调用自然幂等。',
   'retest':json.loads((p/'purge-review-result.json').read_text(encoding='utf-8')),
   'evidence':['review-native/AbilityDamageManagerImpl__purge.txt','cross_purge.py']
 }],
 'spec_conflicts':[{
  'id':'TASK6-REFERENCE-NUMBER','status':'reported_to_root_author_decision_required',
  'description':'TASK6同时要求攻击力乘倍率和reference0。固定v35e AbilityDamageShot.finish原生reference0为MaxHpParameter，reference2才为AttackParameter。当前实现按攻击力语义使用2，尚不能声明逐字满足reference0字面。',
  'evidence':'../heal_damage/AbilityDamageShot_finish.txt #154-184'
 }],
 'confirmed':[
  'sample仅复制原getRealMaximumHealthPoint返回值到新增局部，未增加原生最大HP调用次数；最终公共返回前取总/有效Decimal100。',
  'record的eff乘已加权row1，over乘flags和row3层数；每次治疗即时累计故后续改层不追溯。',
  '负贡献与正贡献在同分类累加；到期非正余额清零，不发负伤害。',
  'queue按治疗者对象和分类存30帧窗口，battle对象隔离；code27原有队列和tick保留。',
  '分类marker在ImpactSourceContent.NormalAttack前写buffTargetAs，实际经过v28已有wfConvertNormalAttack，清理所有原分类后设置对应类别和PF Lv3。',
  '新的每弹地址使finish反序、目标消失、dispose和purge均可独立消费，重复dispose不会扣其他弹。'
 ],
 'stats_integration':json.loads((p/'stats-review-result.json').read_text(encoding='utf-8')),
 'unverified':['完整AIR虚拟机','真实设备战斗','真实联机传输'],
}
(p/'cross-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':report['status'],'candidate_sha256':report['candidate_sha256']}))
