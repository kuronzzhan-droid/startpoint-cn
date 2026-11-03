# 141-direct-count-target-debuff

`direct-count-target-debuff-v1`：按本次命中目标官方弱体数增加原生直接攻击计算次数。

产物 SHA256：`4f7b894b11e1f377a91e1d4c9b132bd676f850bc6d49f48268fe9ecb7aaaa46b`。
总验收 **pass**；三项已知外部变化已按[精确哈希登记](../source/task-evidence/known-external-changes.json)，原始只读锁保留。
完整源码共用 [source](../source)，本条目的最终方法位于 [pcode](pcode)。
统一重放使用 [run11 构造器](../../build.py)，`--from-v34` 从 v34 串联十一轮。
路径边界绑定 run11，归档源码副本用于审计，不在副本位置执行。
见 [本轮说明](../../README.md)、[分组说明](../../direct_count/README.md)、[验收报告](../../verify-report.json)。
本次 [任务快照](../source/task-evidence/TASK11-current.md) 与 [裁定记录](../source/task-evidence/decision-status.json) 已归档：联机 B、Fever A，无待澄清项。
第三版追加码34的5s CT：[追加前任务](../source/task-evidence/TASK11-before-ct.md)，[CT增量审计](../source/audit/ct-delta-report.json)。
码34示例为 `wfx:34:5050:100000:150000:hidden_wg_aqua_heal_damage_any`；arg=分类+10×档位百分比+1000×CT秒数。
按60逻辑帧/秒换算；30帧窗口发伤害时起算CT，CT内治疗丢弃，每个持有者独立且有效/溢出共用；码35不受CT限制。
码 34/35 只计本端成员实际执行的回复，允许跨玩家来源，转发/镜像不计；码 30/31 原跨 statsBattleId 排除不变。
Fever 按每名受治疗成员的每次实际 applyHeal 独立量化并各调用一次 API，不新增批次标记。
本地草稿；完整 AIR、真机、实际 UI、真实联机均未核实。
