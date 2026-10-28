# 184 — 武器裂罅 C19（修订版）：全种族特攻文案折叠、未知裂罅提示与重铸三按钮横排布局（1008080）

## 作用

当裂罅词条的 `CharacterSlayer.character_groups` 同时覆盖全部 11 个种族时，将冗长种族枚举折叠为「对敌人造成的伤害 +X%（独立伤害乘区1）」；未知裂罅详情统一显示「通关五重后揭示为武器裂罅」；将重铸页底部操作区改为「分解｜只重铸数值｜重铸」三按钮横排布局。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C19 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulInUseDialog` | `getAbilitySoul` | C19 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulInUseDialog` | `getInUseAbilitySoul` | C19 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulRemoveDialog` | `getWillRemoveAbilitySoul` | C19 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulReuseFromAnotherCharacterDialog` | `getInUseAbilitySoul` | C19 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulReuseFromAnotherCharacterDialog` | `getRemoveAbilitySoul` | C19 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulSellDialog` | `initialize` | C19 方法级字节码插片（详见 `pcode/`） |
| `AbilitySoulUseDialog` | `getAbilitySoul` | C19 方法级字节码插片（详见 `pcode/`） |
| `DialogAbilitySoulDetailScrollableView` | `run` | C19 方法级字节码插片（详见 `pcode/`） |
| `EquipmentUpgradeAbilitySoulGenerateResultDialog` | `initialize` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialog` | `getValuesForView` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDrawConfirmDialogView` | `run` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `finishTransitionToExpodScene` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostDetail` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostInformation` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectDiscardHandler` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectOverrideHandler` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `updateExBoostCutin` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C19 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C19 方法级字节码插片（详见 `pcode/`） |
| `QuestResultScene` | `run` | C19 方法级字节码插片（详见 `pcode/`） |
| `QuestResultScene` | `viewDidChange` | C19 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `183-riven-c18-v3-values-and-party-gate`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c19-revised
