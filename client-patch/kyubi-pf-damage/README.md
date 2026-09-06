# 九尾狐技能按强化弹射伤害计算

本补丁只重分类 `fox_oracle_autumn` 的两档主技能、常态特殊 PF 与能力 2 专属追击。
杰拉尔及合击搭档的技能通过各自的 `program_path` 独立判断，不按主位角色名一刀切。
基础 APK 必须是 2026-09-05 的 V8；从它增量替换三个类，保留已有 APK 补丁。

## 必须同时交付的数据与客户端改动

`ActionDsl` 裸树 `[10] = 3`（`buffTargetAs`）只切换普通增伤桶。
原客户端仍把普通技和 629 标为技能来源，独立技伤乘区、技能抗性和统计不会随之变为 PF。
因此纯资源修改不能完成本次要求。

本补丁在 `SquadManagerImpl` 的主技及合击技入口分别比较精确程序路径；
在 `MemberImpl.applyInstantAbility` 的 629 入口比较两条专属程序路径。
识别成功后仅在 `ActionEvaluator` 的 `CreateNormalAttack` 产物上设置：

- `createdByPowerFlipAction = true`，主技/合击技来源标记为 `false`。
- 普通主动技能使用有效的 Lv1 作为 PF 伤害档位；不凭空获得 Lv2/Lv3 专属收益。
- 两条 629 在创建时从队长读取最近一次真实 PF 档位，固定为本次动作快照。
  每个实际 PF 执行者记录档位；缺少有效历史时回退 Lv1。普通角色只多记录一个数值，伤害不变。
- 保留原 `ActionKind`、技能槽、施放事件、连锁和演出控制流程。

能力 2 的 20 倍近敌伤害必须从 I354 改为专属 I629。
它的 `CreateNormalAttack` 末参 `incrementCombo` 必须为 `false`，
这样仍按 PF 增伤、独立乘区及敌方 PF 抗性计算，但不再次触发 PF 命中计数。
其余主技和特殊 PF 保留原有连击行为。保留能力 2 原触发与 45 帧冷却。

## 来源与安全门

直接核对的客户端源码：

- `ActionEvaluationResolver` 构造器：DSL `params[9]` 是 `buffTargetAs`。
- `NormalAttackCalculator`：PF 普通桶约 422 行，PF 独立桶 451 行，
  技能独立桶 499 行，PF 抗性 593 行，技伤抗性 609 行。
- `EnemyImpl.onNormalAttack`：约 5644–5665 行，只有 `incrementCombo` 为真才递增 PF 命中计数。
- `ActionKind`：`AbilitySkill` 的索引为 4，`PowerFlip` 为 5。

`patch.py` 只接受以下基线的完整三类导出哈希，并对每处替换检查唯一形状。
已生成源可幂等重跑；未知源、部分补丁、被改动的已生成源一律拒绝。

| 基线 | SHA-256 |
|---|---|
| V8 APK | `0cb1d3e438863e3fee167d0946f4816e8b78d807d6cd3d7bc5584427e5e555cb` |
| V8 SWF | `c1c0782bed5bbcaaf097855c041e3b05100a46387d7cccc2ef9372d7b57744ed` |

导出器使用 FFDec 24.0.1；其他版本的不同导出须重新复核后更新哈希，不能绕过验证。

```powershell
python client-patch/kyubi-pf-damage/patch.py --source-dir <V8导出的scripts> --out-dir <新scripts> --dry-run
python client-patch/kyubi-pf-damage/patch.py --source-dir <V8导出的scripts> --out-dir <新scripts>
python -m unittest discover -s client-patch/kyubi-pf-damage/tests -v
```

测试中的完整 V8 源不入库。通过 `KYUBI_PF_V8_SOURCE` 指定导出目录；
测试确认三类完整身份、补丁完全可逆、独立主/副路径、合法档位、其他攻击分支不变及未知源拒绝。
这些是源码门禁，不是 SWF 编译、真机、伤害数值或协力兼容验收。
构建方必须依次替换三个类，重新导出核对完整变更，并验证 V8 既有补丁仍保留。
