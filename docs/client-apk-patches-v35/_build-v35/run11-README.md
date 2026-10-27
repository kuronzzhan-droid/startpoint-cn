# 第十一轮新增补丁归档草稿

- [141-direct-count-target-debuff](141-direct-count-target-debuff/README.md)：按本次命中目标官方弱体数增加原生直接攻击计算次数。
- [142-heal-damage-any-source](142-heal-damage-any-source/README.md)：本队受到任意来源治疗时逐成员量化转伤害，支持持有者独立CT。
- [143-heal-fever-any-source](143-heal-fever-any-source/README.md)：本队受到任意来源治疗时逐成员档位量化后由持有者加Fever。

前十轮112–140条目保持在原轮目录，本轮只追加141–143号本地草稿。
累计登记见 [registry-draft.json](source/registry-draft.json)，前十轮定义保持原值；共享源码附带任务裁定、验证报告和源码锁。
裁定：[联机 B、Fever A](source/task-evidence/decision-status.json)，无待澄清项；真实双端联机仍未核实。
第三版码34追加5s CT；第二版完整产物保存在 [work/pre-ct](../work/pre-ct)，档位和CT增量证据见 [CT审计](source/audit/ct-delta-report.json)。
总验收 pass；[外部只读变化确认](source/task-evidence/TASK11-readonly-ack.md)与[三项精确登记](source/task-evidence/known-external-changes.json)已归档，原始只读锁保留。
