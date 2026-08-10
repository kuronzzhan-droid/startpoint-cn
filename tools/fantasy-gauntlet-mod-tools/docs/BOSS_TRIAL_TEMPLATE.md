# 通用 Boss 试炼模板

`wf_boss_trial.py` 把已经验证成功的三阶段 Boss 试炼从幻想连战构建脚本中拆成了独立模块。日常修改只需要编辑 `boss_trial_templates.json`，不再复制一整段 Boss 状态机代码。

## 当前稳定能力

- 使用官方七字段阶段记录构造三段血条。
- 在阶段中显示原生命中数试炼条。
- 支持直击、技能、强化弹射与技能连携四类原生命中试炼。
- 试炼未完成时，为 Boss 施加与试炼绑定且不可驱散的伤害抗性。
- 试炼完成时，由客户端原生关联机制移除抗性，并切到不再生成试炼的战斗循环。
- 第二阶段抗性通过通用 `Repeat` 调度器等待试炼建立，不依赖雷兽、火魔等 Boss 的专属动作。
- 只复用源 Boss 的动画状态作为“载体”，Boss 攻击与演出仍来自选择的源 Boss。

上述能力全部由原生表与 Action DSL 实现，不要求额外修改 SWF。

## 配置入口

配置文件：`boss_trial_templates.json`

当前幻想连战使用：`fantasy-stage3-generic-trials`

主要字段：

| 字段 | 用途 |
| --- | --- |
| `target.rush_event_id` / `target.round` | 要替换的 Rush 活动与关卡 |
| `source_boss` / `source_phase` | 提供外观、攻击和动画的 Boss 及其模板阶段 |
| `entry_state` | 该 Boss 的稳定普通行动入口，通常为 `neutral1_1` |
| `ids` | 新 Boss、场地、Zone、Routine 的隔离 ID |
| `phases[].hp_threshold` | 第一、二次换血条阈值，当前必须递减 |
| `phases[].trial.kind` | `direct_attack`、`skill`、`power_flip` 或 `skill_chain` |
| `phases[].trial.target` | 命中试炼目标数 |
| `phases[].resistances` | 未完成试炼时启用的抗性列表 |
| `entry_carrier` | 进入新阶段时使用的完整原生动画链 |
| `clear_carrier` | 试炼完成时使用的完整原生动画链 |
| `retry` | 后续阶段抗性等待原生试炼建立的检查周期与总次数 |

抗性名称为 `ability`、`direct_attack`、`power_flip`、`skill`。它们分别生成客户端原生的四类伤害抗性，并设置为不可由玩家消除强化效果移除。

## 更换 Boss 时必须检查

模板是通用机制，不代表动画状态名在所有 Boss 间相同。更换 `source_boss` 后，需要从该 Boss 的 `source_phase` 中挑选实际存在的：

- `entry_state`
- 第二阶段 `entry_carrier.templates`
- 两个 `clear_carrier.templates`

每个 carrier 必须是一条完整且最终能回到普通行动循环的原生动画链。缺失状态会在构建预检时报错，不会发布残缺补丁。

当前原生结构固定为三阶段。两个带抗性的阶段必须使用不同的试炼类型，否则出生时的通用重试调度会让两个阶段同时匹配，校验器会拒绝该配置。

## 验证命令

先只验证配置与 Action DSL：

```powershell
python .\wf_boss_trial.py --config .\boss_trial_templates.json --template fantasy-stage3-generic-trials --check-actions
```

再运行单元测试：

```powershell
python -m unittest .\tests\test_wf_boss_trial.py
```

最后执行完整只读预检：

```powershell
python .\wf_mode15_build.py --server-root F:\startpoint-cn-mode15\server
```

没有 `--write` 和 `--publish` 时不会写入资源，也不会提升客户端资源版本。
