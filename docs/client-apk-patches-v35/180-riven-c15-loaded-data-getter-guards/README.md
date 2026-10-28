# 180 — 武器裂罅 C15：修复标题页按钮 C2001 与 54 个方法 getLoadedData 全量判空保护（1008076）

## 作用

修复共享按钮 `BoxButtonContentView/addTextField` 在标题页（`loadedData = Option.None`）调用 `getLoadedData()` 触发 C2001 的问题：对 C1–C14 涉及的 54 个既有方法、219 处 `getLoadedData()` 调用点全部插入 `loadedData.index == 0`（Some）前置检查，未加载时安全回退至原生路径。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `BoxButtonContentView` | `addTextField` | C15 方法级字节码插片（详见 `pcode/`） |
| `DialogItemTitleView` | `run` | C15 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `run` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostCutin` | `startExBoost` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostCutinView` | `run` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDetailView` | `createText` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialog` | `getValuesForView` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawRealRemote` | `ctor` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawRealRemote` | `successHandler` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `applyExAbility` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `fitHeight` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialog` | `getExBoostCharacterName` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialog` | `run` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `setupNewDetailScrollArea` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `setupNowDetailScrollArea` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectRealRemote` | `ctor` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectRealRemote` | `successHandler` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `buttonClicked` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `canChangeStateBySwipe` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoost` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostDrawRemoteInput` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostHandler` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostSelectRemoteInput` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `finishTransitionToExpodScene` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostDetail` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostInformation` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostItems` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostState` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `needShowSideArrow` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `run` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectDiscardHandler` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectOverrideHandler` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `startInTransition` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `tabChanged` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `updateExBoostCutin` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `updateExBoostItems` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `viewInitialized` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `willLeave` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `willLeaveScene` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `canBeginSwipe` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `refreshExAbilitiesScrollArea` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExAbilitiesScrollArea` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExpodScene` | `back` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExpodScene` | `changeStateByTab` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExpodScene` | `showHowToPlayForMode` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExpodScene` | `tabChanged` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExpodSceneView` | `draw` | C15 方法级字节码插片（详见 `pcode/`） |
| `ExpodSwipeLogic` | `swipeInput` | C15 方法级字节码插片（详见 `pcode/`） |
| `PlayerLogic` | `applyCommonResponse` | C15 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `179-riven-c14-truetype-compositor-and-f0-fix`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c15
