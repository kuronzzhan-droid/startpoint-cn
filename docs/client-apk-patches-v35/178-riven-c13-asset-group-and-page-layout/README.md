# 178 — 武器裂罅 C13：修复选魂珠切换按钮 C8007 跨场景 UI 依赖与重铸页滚动区重排（1008074）

## 作用

修复 C8 在选魂珠页（`AbilitySoulListView/setupButton`）引用未加载的 `equipment_list_scene` UI 资源导致的 C8007 崩溃（改为使用本场景已加载的 `ability_soul_list` 按钮容器）；重新排版重铸页与二选一弹窗的词条滚动视口高度及字号。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulListView` | `setupButton` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDetailView` | `createText` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `applyExAbility` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `fitHeight` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `setupNewDetailScrollArea` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `setupNowDetailScrollArea` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `refreshExAbilitiesScrollArea` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExAbilitiesScrollArea` | C13 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C13 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `177-riven-c12-list-layout-and-roll-count`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c13
