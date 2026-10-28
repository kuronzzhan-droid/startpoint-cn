# 167 — 武器裂罅 C2：裂罅重铸（ExBoost 复用）、二选一与重铸演出（1008053）

## 作用

复用星导增幅（`ExBoostWindow` / `ExpodScene`）页面与演出流程实现裂罅重铸（抽词条 `weapon_riven/draw` 与二选一 `weapon_riven/select`），支持未决重铸（`pending_affixes` / `pending_draw_id`）断线恢复，从魂珠详情弹窗一键跳转对应裂罅重铸页。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExAbilityCutin` | `getDescriptionText` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExAbilityCutin` | `innerOut` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExAbilityCutin` | `innerStart` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostCutin` | `startExBoost` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostCutinView` | `run` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialog` | `getValuesForView` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialogView` | `run` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawRealRemote` | `ctor` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawRealRemote` | `successHandler` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `applyExAbility` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialog` | `getExBoostCharacterName` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialog` | `run` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectRealRemote` | `ctor` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectRealRemote` | `successHandler` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `buttonClicked` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `canChangeStateBySwipe` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoost` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostDrawRemoteInput` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostHandler` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostSelectRemoteInput` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `finishTransitionToExpodScene` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostDetail` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostInformation` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostItems` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostState` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `needShowSideArrow` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `run` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectDiscardHandler` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectOverrideHandler` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `startInTransition` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `tabChanged` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `updateExBoostCutin` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `viewInitialized` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `willLeave` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `willLeaveScene` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExpodScene` | `back` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExpodScene` | `changeStateByTab` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExpodScene` | `showHowToPlayForMode` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExpodScene` | `tabChanged` | C2 方法级字节码插片（详见 `pcode/`） |
| `ExpodSceneView` | `draw` | C2 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 远端接口：`weapon_riven/draw`、`weapon_riven/select`；上下文挂载于 `LoadedData.wfx_riven`

## 依赖的前置补丁

- `166-riven-c1-save-and-lookup`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c2
