# 182 — 武器裂罅 C17：恢复普通角色 EX 富文本与新增重铸费用道具选择（cost_options）（1008078）

## 作用

在 20 个共享展示方法中隔离普通角色 EX 分支，恢复原生富文本渲染；在裂罅重铸页新增费用道具水平选择栏（读取服务端 `cost_options: [[item_id, next_cost], ...]`，如深渊币或超限结晶），并在 `weapon_riven/draw` 请求中携带所选 `cost_item_id`。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `ExBoostCutin` | `startExBoost` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostCutinView` | `run` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDetailView` | `createText` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialog` | `getValuesForView` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialogView` | `run` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawRealRemote` | `ctor` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `applyExAbility` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `fitHeight` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialog` | `getExBoostCharacterName` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialog` | `run` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `setupNewDetailScrollArea` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `setupNowDetailScrollArea` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `buttonClicked` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoost` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostDrawRemoteInput` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostHandler` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostSelectRemoteInput` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostItems` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostState` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectDiscardHandler` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `updateExBoostItems` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `viewInitialized` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `canBeginSwipe` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `refreshExAbilitiesScrollArea` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExAbilitiesScrollArea` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C17 方法级字节码插片（详见 `pcode/`） |
| `ExpodSceneView` | `draw` | C17 方法级字节码插片（详见 `pcode/`） |
| `InitializeRealRemote` | `loadSuccessHandler` | C17 方法级字节码插片（详见 `pcode/`） |
| `LogicScene` | `finishTransition` | C17 方法级字节码插片（详见 `pcode/`） |
| `RealRemoteService` | `earlySuccessHandler` | C17 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap2201` | C17 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 存档/接口字段：`cost_options: [[item_id, next_cost], ...]`，请求参数 `cost_item_id`

## 依赖的前置补丁

- `181-riven-c16-reforge-richtext-restore`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c17
