# 175 — 武器裂罅 C10：修复详情弹窗 G2007 按钮组生命周期与新增商店「裂罅工坊」入口（1008071）

## 作用

修复 C9 在 `GeneralDialog/preparation` 末尾直接调用 `ButtonGroupLogic.append` 导致的 G2007 报错（改为在原 `ButtonGroupLogic` 构造前将锁定按钮 ID 注入原生按钮数组）；在商店首页（`ShopTopScene`）新增「裂罅工坊」常驻入口，点击直达武器一览裂罅分类。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C10 方法级字节码插片（详见 `pcode/`） |
| `EquipmentFilterDialogContentView` | `run` | C10 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `ctor` | C10 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `apply` | C10 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialogView` | `run` | C10 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C10 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C10 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C10 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C10 方法级字节码插片（详见 `pcode/`） |
| `GeneralDialog` | `preparation` | C10 方法级字节码插片（详见 `pcode/`） |
| `MenuListCellContentView` | `setText` | C10 方法级字节码插片（详见 `pcode/`） |
| `ShopTopScene` | `createMenuListData` | C10 方法级字节码插片（详见 `pcode/`） |
| `ShopTopScene` | `listCellEnabledResolver` | C10 方法级字节码插片（详见 `pcode/`） |
| `ShopTopScene` | `listSelected` | C10 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置，商店菜单常驻显示「裂罅工坊」

## 依赖的前置补丁

- `174-riven-c9-quest-drop-and-lock`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c10
