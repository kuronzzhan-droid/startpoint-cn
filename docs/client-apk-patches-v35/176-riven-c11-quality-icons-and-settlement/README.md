# 176 — 武器裂罅 C11：裂罅自身主图、品质 1–5 稀有度底框与圆点显示（1008072）

## 作用

将列表、详情、重铸页与结算弹窗中的裂罅图标统一改为读取 `item.orderedmap` 自身 `thumbnailId`（如六种 R 图标与 U35），按 `disposition`（品质 1–5）设置原生白/铜/银/金/虹稀有度底框，并在名称旁展示五点品质标识（`●○○○○`..`●●●●●`），移除旧版满档百分比后缀。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C11 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulThumbnailListRepository` | `translate` | C11 方法级字节码插片（详见 `pcode/`） |
| `BattleQuestFinishLoadingTask` | `processQuestFinish` | C11 方法级字节码插片（详见 `pcode/`） |
| `BattleQuestFinishRealRemote` | `successHandler` | C11 方法级字节码插片（详见 `pcode/`） |
| `DialogItemTitleView` | `run` | C11 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `apply` | C11 方法级字节码插片（详见 `pcode/`） |
| `ExBoostCutinView` | `run` | C11 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialog` | `getExBoostCharacterName` | C11 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C11 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostDetail` | C11 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostInformation` | C11 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C11 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C11 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C11 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `apply` | C11 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `draw` | C11 方法级字节码插片（详见 `pcode/`） |
| `QuestResultScene` | `run` | C11 方法级字节码插片（详见 `pcode/`） |
| `QuestResultScene` | `viewDidChange` | C11 方法级字节码插片（详见 `pcode/`） |
| `RealRemoteService` | `earlySuccessHandler` | C11 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap2201` | C11 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 存档字段：`disposition`（1..5 对应五档品质圆点与底框）

## 依赖的前置补丁

- `175-riven-c10-dialog-lifecycle-and-shop`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c11
