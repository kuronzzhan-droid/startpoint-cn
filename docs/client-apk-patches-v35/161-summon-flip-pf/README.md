# 161 — 召唤协力球触板弹起发动 PF（p13 N5）

## 作用

新增 `custom_ability_string.orderedmap` 键 `wfx_summon_flip_pf_<multiball_id>`（`client.summon.flip_pf@1`）：当配置了该键的召唤协力球被弹板弹起（`BallImpl/resolveCollisionForPrimaryOrSummons` 的 `hitByFlipper` 分支）且当前有效连击达到 1–3 档 PF 阈值（含 `159-combo-base-wfx41` 连击基数）时，捕获该档位并在当前帧末以该召唤球自身为 executor 发动一次对应档位（最高按 3 档）的真 PF。不消耗连击、不终止其他正在进行的 PF，每次成功发动产生一套本队团队 PF 事件。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `battle.ball.BallImpl` | `resolveCollisionForPrimaryOrSummons(param1:Boolean):void` | 在 `hitByFlipper` 分支计算出充能档位后调用 `wfxSummonFlipCapture(lv)` 捕获召唤球弹起 PF 请求 |
| `battle.ball.BallImpl$` | `wfxSummonFlipInterval(param1:String):int` | 新增静态 helper：严格解析 `"1"`（返回 0）或 `"1:<非负十进制整数帧>"`（返回最小间隔帧数），非法格式返回 `-1` |
| `battle.ball.BallImpl` | `wfxSummonFlipMember():MemberImpl` | 新增 helper：校验当前球属于被模拟玩家活动队伍中的存活召唤协力球并返回其 `MemberImpl` |
| `battle.ball.BallImpl` | `wfxSummonFlipConfig():int` | 新增 helper：查询 `wfx_summon_flip_pf_<multiballId>` 并返回最小间隔帧数（未启用返回 `-1`） |
| `battle.ball.BallImpl` | `wfxSummonFlipOngoing():Boolean` | 新增 helper：检查该召唤球自身是否已有正在执行的 `ActionType.PowerFlip` 动作 |
| `battle.ball.BallImpl` | `wfxSummonFlipCapture(param1:int):void` | 新增 helper：当档位 `>= 1`（高于 3 档夹取为 3 档）、配置启用、自身无进行中 PF 且距上次成功发动已满最小间隔帧时，记入当前帧待发队列 |
| `battle.ball.BallImpl` | `wfxSummonFlipLaunch():Boolean` | 新增 helper：帧末复核存活、自身无进行中 PF 与冷却间隔后，调用 `MemberImpl/wfxDualPfExecute` 与 `SquadImpl/wfxDualPfNotify` 发动 PF 并记录成功帧号 |
| `battle.squad.SquadImpl` | `willRemove():Boolean` | 在帧末 `wfxDualPfFlush()` 之后调用 `wfxSummonFlipFlush()` |
| `battle.squad.SquadImpl` | `wfxSummonFlipFlush():void` | 新增 helper：按本队原生活动队伍顺序依次消费本帧捕获的 N5 弹起 PF（每球每帧最多一次） |

## 开关或数据写法

在 `master/string/custom_ability_string.orderedmap` 中配置：

```text
wfx_summon_flip_pf_<multiball_id> = 1
# 或指定两次成功发动之间的最小逻辑帧间隔：
wfx_summon_flip_pf_<multiball_id> = 1:<min_interval_frames>
```

- `<multiball_id>`：`master/battle/multiball.orderedmap` 中的召唤协力球 ID
- `<min_interval_frames>`：规范非负十进制 int32 帧数（不允许前导零、负数或多余冒号字段；省略时默认为 `0`）

## 依赖的前置补丁

- `159-combo-base-wfx41`（共用有效连击档位计算）
- `160-dual-pf-wfx42`（共用 `MemberImpl/wfxDualPfExecute`、`MemberImpl/wfxDualPfLogic`、`SquadImpl/wfxDualPfNotify`）

## 对应的数据边

- `<WORKDIR>\out\贝瑞塔-20261025\codex\拉芙PF-v7d.md`

## 已知限制

- 召唤球弹起 PF 最高按 3 档动作执行（即使有效连击达到 PF4 阈值也夹取为 3 档）。
- 帧末先完成 N4（码 42）快照再处理 N5；N5 触发的团队 PF 事件若新赋予了码 42 状态，留到下一帧处理。

来源工作区：<WORKDIR>/outputs/work/beretta-p13-20261025、<WORKDIR>/out/贝瑞塔-20261025/codex
