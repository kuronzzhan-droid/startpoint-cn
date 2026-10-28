# 172 — 武器裂罅 C7：修复武器一览裂罅行 F1034 强转与分类切换按钮样式（1008058）

## 作用

在 `EquipmentListTableView/run`、`EquipmentListTableItemView/get_equipmentId`、`EquipmentListTableItemView/registerButton` 三处补齐裂罅 DTO（`wfxRiven=true`）分流，防止将普通对象强转为 `OwnedEquipmentPeek` 触发 F1034；并将右上角分类切换按钮改为清晰的圆形图标按钮。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `ButtonViewBase` | `setTextLabel` | C7 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `buttonClicked` | C7 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `run` | C7 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `get_equipmentId` | C7 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `registerButton` | C7 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableView` | `run` | C7 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListView` | `setupHowToButton` | C7 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `171-riven-c6-startup-transition-guard`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c7
