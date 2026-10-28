# 169 — 武器裂罅 C4：单张分解接口、并发冲突恢复与槽位区间扩展（1008055）

## 作用

新增重铸页「分解裂罅」按钮与 `weapon_riven/dismantle` 请求；为 `draw`、`select`、`dismantle` 补齐 `riven_id` 校验与 `weapon_riven_conflict` 冲突恢复（自动退回裂罅列表并弹出「裂罅已变化，请重试」）；将客户端裂罅槽位识别区间统一扩展至 `16000001..16000999`（排除碎片 `16000900`）。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C4 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulThumbnailListRepository` | `translate` | C4 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `buttonClicked` | C4 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `getFilteredEquipmentList` | C4 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `openDetailDialog` | C4 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `run` | C4 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `toThumbnailData` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawRealRemote` | `ctor` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawRealRemote` | `successHandler` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectRealRemote` | `ctor` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectRealRemote` | `successHandler` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `buttonClicked` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostDrawRemoteInput` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostSelectRemoteInput` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `run` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectDiscardHandler` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C4 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C4 方法级字节码插片（详见 `pcode/`） |
| `GeneralAbilitySoulLogic` | `getAbility` | C4 方法级字节码插片（详见 `pcode/`） |
| `InitializeRealRemote` | `loadSuccessHandler` | C4 方法级字节码插片（详见 `pcode/`） |
| `ItemLogic` | `get_name` | C4 方法级字节码插片（详见 `pcode/`） |
| `ItemTableTranslator` | `translateFromCategorizedItems` | C4 方法级字节码插片（详见 `pcode/`） |
| `ItemTableTranslator` | `translateFromItem` | C4 方法级字节码插片（详见 `pcode/`） |
| `LogicScene` | `finishTransition` | C4 方法级字节码插片（详见 `pcode/`） |
| `PartyLogic` | `getBattleParty` | C4 方法级字节码插片（详见 `pcode/`） |
| `PlayerLogic` | `applyCommonResponse` | C4 方法级字节码插片（详见 `pcode/`） |
| `RealRemoteService` | `earlySuccessHandler` | C4 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap2201` | C4 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap632` | C4 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap848` | C4 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 远端接口：`weapon_riven/dismantle`；冲突标志：`weapon_riven_conflict: true`

## 依赖的前置补丁

- `168-riven-c3-workshop-and-filter`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c4
