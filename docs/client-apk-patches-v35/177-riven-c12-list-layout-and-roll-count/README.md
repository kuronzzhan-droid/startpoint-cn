# 177 — 武器裂罅 C12：列表三行排版（名字/品质/词条数）与右下角紫色重铸次数徽章（1008073）

## 作用

优化武器一览、道具一览與选魂珠裂罅页的文字排版为「名字 / 品质五圆点 / 词条 N 条」三行显示（超宽自动截断加省略号）；将已揭示裂罅缩略图右下角数量角标（`ThumbnailNumberLabel`）改为紫色（`#C084FC`）显示当前重铸次数 `roll_count`（含 0 次）。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `ComplexThumbnailView` | `culling` | C12 方法级字节码插片（详见 `pcode/`） |
| `DialogItemTitleView` | `run` | C12 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `apply` | C12 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C12 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C12 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C12 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C12 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C12 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `apply` | C12 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `draw` | C12 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `run` | C12 方法级字节码插片（详见 `pcode/`） |
| `ThumbnailNumberLabel` | `setNumber` | C12 方法级字节码插片（详见 `pcode/`） |
| `ThumbnailNumberLabel` | `setRemaining` | C12 方法级字节码插片（详见 `pcode/`） |
| `ThumbnailNumberLabel` | `setStack` | C12 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 存档字段：`roll_count`（缩略图右下角紫色数字徽章）

## 依赖的前置补丁

- `176-riven-c11-quality-icons-and-settlement`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c12
