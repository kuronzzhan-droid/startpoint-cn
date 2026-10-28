# 183 — 武器裂罅 C18：服务端 v3 配套「只重铸数值」按钮、每队一张裂罅门禁与品质 0 显示（1008079）

## 作用

新增重铸页「只重铸数值」按钮（`weapon_riven/draw` 携带 `mode: "values"`，词条种类不变仅重随等级）；在编成选魂珠与移槽入口增加「每个队伍只能携带一张武器裂罅」拦截弹窗；支持 `disposition = 0` 显示为五个灰色空心圆 `○○○○○`。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C18 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulListScene` | `abilitySoulClicked` | C18 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulListScene` | `reuseAbilitySoulFromAnotherCharacterHandler` | C18 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulListScene` | `useAbilitySoulHandler` | C18 方法级字节码插片（详见 `pcode/`） |
| `DialogItemTitleView` | `run` | C18 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `apply` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialog` | `getValuesForView` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialogView` | `run` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawRealRemote` | `ctor` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialog` | `getExBoostCharacterName` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `buttonClicked` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoost` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostInformation` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `run` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `updateExBoostButtonState` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C18 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C18 方法级字节码插片（详见 `pcode/`） |
| `InitializeRealRemote` | `loadSuccessHandler` | C18 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `apply` | C18 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `draw` | C18 方法级字节码插片（详见 `pcode/`） |
| `RealRemoteService` | `earlySuccessHandler` | C18 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 远端参数：`mode: "values"` | `"full"`；品质范围扩展为 `0..5`

## 依赖的前置补丁

- `182-riven-c17-reforge-cost-item-select`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c18
