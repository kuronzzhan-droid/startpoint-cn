# 160 — 主位角色与配对召唤球双实体追加 PF 及资源预载（wfx 码 42 / p12 & p12b N4）

## 作用

新增 `wfx_WriteCondition` 效果码 **42**（`client.pf.dual@1`）：当主位角色获得含码 42 的一次性令牌状态时，在当前帧末（`SquadImpl/willRemove` 阶段）一次性快照并消费一层该状态，令状态持有者（主位角色）与其召唤出的指定 `multiball_id` 存活协力球**各自作为独立 executor** 立即发动一次指定档位（1–3 档）的强化弹射（Power Flip），不消耗当前连击、不打断已有 PF，且每消费一层只触发一套团队 PF 计数/能力事件。同时在 `BattlePartyLogic/resolvePathCollection` 中根据 `unique_condition` 表的码 42 配置自动预载全队主位角色与目标召唤球的三档 PF 动作资源闭包。

`v35p12b`（`1008033`）修复了 `SquadImpl/wfxDualPfFlush` 中的联机一致性问题：移除旧版误加的 `Battle.__isMyBattle__()` 门槛，使三人联机中被模拟的远端玩家队伍同样按自身队伍执行码 42 双实体 PF，保证三端模拟一致。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `battle.squad.SquadImpl` | `willRemove():Boolean` | 在主队帧末调用 `wfxDualPfFlush()` 一次性快照并处理本队所有码 42 令牌 |
| `battle.squad.SquadImpl` | `wfxDualPfFlush():void` | 新增 helper：使用弱键静态字典 `SquadImpl.wfxDualPfFrames` 记录主队对象最后处理的逻辑帧号防同帧重入；先执行 `wfxDualPfCollect` 快照当前层，再消费并触发双实体 PF（p12b 已移除 `__isMyBattle__` 限制） |
| `battle.squad.SquadImpl` | `wfxDualPfNotify(param1:int):void` | 新增 helper：每成功处理一层令牌，统一触发一次团队 PF 通知与 totalizer 更新 |
| `battle.member.MemberImpl` | `wfxDualPfCollect():Array` | 新增 helper：扫描主位角色身上的码 42 状态并生成待执行快照 |
| `battle.member.MemberImpl` | `wfxDualPfConsume(param1:int):Boolean` | 新增 helper：消费一层指定 `conditionId` 的码 42 状态 |
| `battle.member.MemberImpl` | `wfxDualPfPartner(param1:int):MemberImpl` | 新增 helper：在同一玩家的 `SquadManager` 活动队伍中查找满足 `multiballId == param1` 且 `(originMemberIndex == holderIndex, originMemberKind == 0)` 的存活召唤球成员 |
| `battle.member.MemberImpl` | `wfxDualPfLogic(param1:int, param2:Boolean):BattlePowerFlipLogic` | 新增 helper：为角色或召唤球构造对应档位（1–3 档）的 `BattlePowerFlipLogic`（队长支持 722 替换，非队长与召唤球按类型选动作） |
| `battle.member.MemberImpl` | `wfxDualPfExecute(param1:int, param2:Boolean):Boolean` | 新增 helper：以指定成员自身为 executor 调用 `startPowerFlip` 发动 PF |
| `battle.logic.BattlePartyLogic` | `resolvePathCollection(param1:AssetPathCollection):void` | 追加调用 `wfxDualPreload(param1)` |
| `battle.logic.BattlePartyLogic` | `wfxDualPreload` / `wfxDualPreloadMembers` / `wfxDualPreloadPaths` | 新增 3 个预载 helper：扫描 `unique_condition` 表中所有合法的码 42 配置，预载本队主位角色与目标 `multiball_id` 的三档 PF 动作、leading DSL 与视觉资源闭包 |

## 开关或数据写法

在 `master/string/custom_ability_string.orderedmap` 中配置：

```text
wfx:42:<pf_lv>:<flags>:<multiball_id>:0
```

- `arg0` (`pf_lv`, int)：发动的 PF 档位，取值 `1`、`2` 或 `3`
- `arg1` (`flags`, int)：位标志。`bit0 (1)` 表示当场上不存在匹配的存活召唤球时，允许主位持有者单独发动一次 PF；`0` 表示必须主位与配对召唤球同时存活才双发
- `arg2` (`multiball_id`, float/int)：配对召唤协力球在 `multiball.orderedmap` 中的正整数 ID
- `arg3`：保留填 `0`

## 依赖的前置补丁

- `112-wfx-effect-query`

## 对应的数据边

- `<WORKDIR>\out\贝瑞塔-20261025\codex\接口-p12与v7.md`、`拉芙PF-v7d.md`

## 已知限制

- 配对仅认领主位角色（`originMemberKind == 0`）召唤出的协力球，不认领 Unison 来源，也不支持“协力球再召唤的子球”精确双实体配对。
- 同帧内由 PF 团队事件回调新赋予的码 42 状态层会留到下一逻辑帧处理，不在当前帧同步递归触发。

来源工作区：<WORKDIR>/outputs/work/beretta-p12-20261025、<WORKDIR>/out/贝瑞塔-20261025/codex
