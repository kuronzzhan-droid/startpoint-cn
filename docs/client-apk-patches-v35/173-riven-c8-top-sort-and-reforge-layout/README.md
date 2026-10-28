# 173 — 武器裂罅 C8：道具一览裂罅分组置顶、重铸页左右切卡与魂珠页分类切换（1008058）

## 作用

在 `ItemTableTranslator/translateFromCategorizedItems` 中将虚拟「裂罅」分组置顶到第一位；在重铸页（`ExBoostWindow`）支持左右箭头与滑动切换前后裂罅实例并重新排版词条区；在编成选魂珠列表（`AbilitySoulListScene`）右上角新增「常规 ↔ 裂罅」切换按钮。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C8 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulListScene` | `abilitySoulClicked` | C8 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulListScene` | `filterDialogOkHandler` | C8 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulListScene` | `run` | C8 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulListScene` | `showThumbnails` | C8 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulListView` | `setupButton` | C8 方法级字节码插片（详见 `pcode/`） |
| `DialogAbilitySoulDetailView` | `run` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDetailView` | `createText` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `applyExAbility` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `buttonClicked` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `canChangeStateBySwipe` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostDetail` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostInformation` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `needShowSideArrow` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `run` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `updateExBoostItems` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `canBeginSwipe` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C8 方法级字节码插片（详见 `pcode/`） |
| `ExpodSwipeLogic` | `swipeInput` | C8 方法级字节码插片（详见 `pcode/`） |
| `ItemTableTranslator` | `translateFromCategorizedItems` | C8 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `draw` | C8 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `run` | C8 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `172-riven-c7-equipment-category-switch`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c8
