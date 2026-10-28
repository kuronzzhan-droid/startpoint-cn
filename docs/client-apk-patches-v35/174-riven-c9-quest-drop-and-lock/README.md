# 174 — 武器裂罅 C9：五重结算掉落弹窗、裂罅锁定、满档提示、NEW 标记与武器详情跳转（1008070）

## 作用

接入战斗结算 `weapon_riven_granted` 奖励弹窗、裂罅详情锁定按钮（`weapon_riven/lock`）、首次查看消除 NEW 标记（`weapon_riven/seen`）、分解返还预览（`dismantle_return`）、倾向与满档说明、编成武器不匹配去色提示，以及从持有武器详情弹窗一键筛选查看「该武器的裂罅 N 张」。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C9 方法级字节码插片（详见 `pcode/`） |
| `BattleQuestFinishLoadingTask` | `processQuestFinish` | C9 方法级字节码插片（详见 `pcode/`） |
| `BattleQuestFinishRealRemote` | `successHandler` | C9 方法级字节码插片（详见 `pcode/`） |
| `DialogAbilitySoulDetailView` | `run` | C9 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `ctor` | C9 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `filterDialogOkHandler` | C9 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `getFilteredEquipmentList` | C9 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `apply` | C9 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `enhancedEffectAnimationDraw` | C9 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `buttonClicked` | C9 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `characterExBoostSelectRemoteInput` | C9 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostDetail` | C9 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `getExBoostInformation` | C9 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `run` | C9 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindow` | `selectDiscardHandler` | C9 方法级字节码插片（详见 `pcode/`） |
| `GeneralAbilitySoulLogic` | `getAbility` | C9 方法级字节码插片（详见 `pcode/`） |
| `GeneralDialog` | `buttonClicked` | C9 方法级字节码插片（详见 `pcode/`） |
| `GeneralDialog` | `preparation` | C9 方法级字节码插片（详见 `pcode/`） |
| `GeneralDialog` | `sliderValueChangedForAbilityDescriptionVariationWithLevel` | C9 方法级字节码插片（详见 `pcode/`） |
| `GeneralDialog` | `update` | C9 方法级字节码插片（详见 `pcode/`） |
| `GeneralDialogView` | `run` | C9 方法级字节码插片（详见 `pcode/`） |
| `InitializeRealRemote` | `loadSuccessHandler` | C9 方法级字节码插片（详见 `pcode/`） |
| `OwnedEquipmentDetailWithProtectionDialog` | `initialize` | C9 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `apply` | C9 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `draw` | C9 方法级字节码插片（详见 `pcode/`） |
| `PartyCarouselAbilitySoulView` | `draw` | C9 方法级字节码插片（详见 `pcode/`） |
| `PartyCarouselAbilitySoulView` | `present` | C9 方法级字节码插片（详见 `pcode/`） |
| `PartyLogic` | `getBattleParty` | C9 方法级字节码插片（详见 `pcode/`） |
| `PartyTranslator` | `translate` | C9 方法级字节码插片（详见 `pcode/`） |
| `QuestResultScene` | `run` | C9 方法级字节码插片（详见 `pcode/`） |
| `QuestResultScene` | `viewDidChange` | C9 方法级字节码插片（详见 `pcode/`） |
| `RealRemoteService` | `earlySuccessHandler` | C9 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap2201` | C9 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 远端接口：`weapon_riven/lock`、`weapon_riven/seen`；结算字段：`weapon_riven_granted`

## 依赖的前置补丁

- `173-riven-c8-top-sort-and-reforge-layout`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c9
