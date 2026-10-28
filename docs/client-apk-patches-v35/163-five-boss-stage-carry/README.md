# 163 — 五连战（bothbossNext）跨 Stage 状态完整继承（1008090）

## 作用

原客户端在五连战（`BattleContinuationData/bothbossNext` 切换下一 Stage）时，新 `SquadImpl` 重建后不会继承上一 Stage 队伍成员身上已有的 `ConditionSlot`（Buff/Debuff/自定义状态、剩余帧数、护盾值与动态属性），导致五连战跨关时暖机层数与护盾全部丢失。本补丁在 `BattleContinuationData/bothbossNext` 切关前捕获存活角色的状态槽快照（`wfxStageCapture`），并在下一关 `SquadImpl/setContinuationData` 时原样恢复到对应成员的 `ConditionSlot` 中（`wfxStageApply`），同时不触发“新增状态”通知事件、不重发关联特效。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `battle.BattleContinuationData` | `bothbossNext(param1:Squad, param2:Number):BattleContinuationData` | 在原生切关逻辑末尾调用 `result.wfxStageCapture(param1)` 捕获当前队伍成员状态快照 |
| `battle.BattleContinuationData` | `wfxStageCapture(param1:Squad):void` | 新增方法：当 `param1` 存活时，遍历成员索引 `0..2`，调用每个成员 `ConditionSlot/wfxStageSnapshot()` 并存入弱键字典 `STAGE_CARRY_MAP[this]` |
| `battle.BattleContinuationData$` | `_wfxStageClone(param1:*):*` | 新增静态深拷贝 helper：递归克隆 `ConditionElement`、`DynamicConditionValues`、`Array`、`Vector` 与普通 `Object` |
| `battle.condition.ConditionSlot` | `wfxStageSnapshot():Object` | 新增方法：快照当前 `ConditionSlot` 的 `elements`、`conditionTimerMap`、`currentId`、`slipDamageWaitCount`、`barrierHpMap` 与 `dynamicValuesMap` |
| `battle.condition.ConditionSlot` | `wfxStageRestore(param1:Object):void` | 新增方法：将快照深拷贝恢复到目标 `ConditionSlot`，直接写底层容器，不调用 `add()`、不触发 `notifyConditionUpdated` 或 `createLinkEffect` |
| `battle.squad.SquadImpl` | `setContinuationData(param1:BattleContinuationData):void` | 在原生 `setContinuationData` 末尾调用 `this.wfxStageApply(param1)` |
| `battle.squad.SquadImpl` | `wfxStageApply(param1:BattleContinuationData):void` | 新增方法：从 `STAGE_CARRY_MAP[param1]` 取出快照，对存活成员恢复 `ConditionSlot` 并重算 `maxHp`（`recalculateMaxHp`），保证最大生命值修饰与当前 HP 顺序正确 |

## 开关或数据写法

常驻机制修复，无需新增数据表开关。凡通过 `BattleContinuationData.bothbossNext` 进入下一关的连续战斗自动生效。

## 依赖的前置补丁

- 无硬性前置补丁（兼容 `wfx` 自定义状态与护盾状态）

## 对应的数据边

- 五连战（five-boss）玩法关卡数据边

## 已知限制

- 仅作用于走 `BattleContinuationData/bothbossNext` 的切关流程；普通关卡结算或阵亡重开不走该路径。
- 恢复状态时故意静默（不触发“当获得某状态时”的被动触发器），以避免切关瞬间重复叠加被动。

来源工作区：<WORKDIR>/outputs/work/stage-carry-20261026
