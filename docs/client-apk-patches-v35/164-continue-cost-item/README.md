# 164 — 特定关卡道具续关（`continue_cost_<questId>` / 1008091）

## 作用

原客户端战败续关（Continue）固定消耗免费/付费星导石或每日续关次数。本补丁支持在 `custom_ability_string.orderedmap` 中按关卡配置 `continue_cost_<questKind>_<questId> = <itemId>:<amount>`（或回退键 `continue_cost_<questId>`）：当命中配置时，战败弹出的 `ContinueDialog` 与 `Continue2Dialog` 自动切换为读取并展示玩家持有的指定道具数量、消耗前/消耗后数量、道具名称与道具图标纹理，并在点击确认续关时向服务端 `questPlayContinue` 接口发送 `useFreeVirtualMoney = 2`（标识道具续关）而无需走星导石不足的商店跳转。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `scenes.battle.Continue2Dialog$` | `_wfxContinuePositiveInt` / `_wfxContinueRead` / `_wfxContinueCost` / `_wfxContinueView` / `_wfxContinueContents` / `_wfxContinueTitle` / `_wfxContinueTextureLoaded` | 新增 7 个静态 helper：解析 `continue_cost_<questKind>_<questId>` 或 `continue_cost_<questId>` 配置，读取 `UserData.itemCount(itemId)`，动态替换续关弹窗标题、说明文案与道具图标纹理 |
| `scenes.battle.ContinueDialog` | `continueVirtualMoney` / `beforeVirtualMoney` / `afterVirtualMoney` / `canContinue` / `buttonClicked` | 命中道具续关配置时，改为返回道具消耗量、持有量与扣除后余量；持有量足够时允许直接点击 OK 续关，不足时禁用确认按钮且不跳转充值商店 |
| `scenes.battle.ContinueDialogView` | `setupTexts():void` | 调用 `_wfxContinueView(this)` 将弹窗文案与图标切换为目标道具 |
| `scenes.battle.Continue2Dialog` | `initialize` / `continueVirtualMoney` / `beforeVirtualMoney` / `afterVirtualMoney` | 同步适配新版二次确认续关弹窗 `Continue2Dialog` 的数值与图标/文案展示 |
| `scenes.battle.BattleScenePlayingStateImpl` | `annihilatedDialog2TryAgainSelected(param1:int):void` | 当存在有效道具续关配置且进入二次确认续关时，将续关模式标记设为 `2`（代替原生的 `0/1` 星导石模式） |
| `scenes.battle.BattleScene` | `startQuestPlayContinue(param1:int, param2:Function = null):void` | 当 `param1 == 2` 时，向 `BattleSystem.questPlayContinue` 传入 `2`（道具续关协议值） |

## 开关或数据写法

在 `master/string/custom_ability_string.orderedmap` 中配置：

```text
# 优先匹配带 questKind 的精确键：
continue_cost_<questKind>_<questId> = <itemId>:<amount>
# 或通用 questId 键：
continue_cost_<questId> = <itemId>:<amount>
```

- `<itemId>`：`master/item/item.orderedmap` 中的正整数道具 ID
- `<amount>`：每次续关消耗的正整数道具数量

## 依赖的前置补丁

- 无客户端前置补丁（需配合服务端支持 `quest_play_continue` 的 `use_free_vm = 2` 扣减对应道具）

## 对应的数据边

- 高难关卡道具续关数据边与服务端 `continue-cost-20261026/work/server` 路由补丁

## 已知限制

- 必须前后端同时启用：若仅客户端配置 `continue_cost_*` 而服务端未支持 `use_free_vm = 2`，服务端续关请求会校验失败。

来源工作区：<WORKDIR>/outputs/work/continue-cost-20261026
