# 188 — 武器裂罅 Round 2：修复 EquipmentListScene 构造 F1009、主题未知裂罅（16000901–919）与一队一张限制（1008093）

## 作用

1. **修复 `EquipmentListScene` 构造函数 `#1009` 空引用**：当 gipo 尚未注入 `this.globalLogic`（为 null）时，回退读取 `PinballClientMain.top.logic.globalLogic`。
2. **支持主题未知裂罅（`16000901..16000919`，如精灵兽裂罅、深渊裂罅）**：在 59 处实例判断（T1）与 16 处未知判断（T2）字节码站点中将其与普通未知裂罅 `16000000` 等价处理，可堆叠、不显示品质、详情标题显示道具自身名称。
3. **一队多张裂罅全部失效与编成页只灰显**：同一队伍中已揭示裂罅超过 1 张时全部不生效；编成页未生效裂罅仅做图标去色灰显，不再叠加「未生效」文字。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | 可逆指令插片（见 `source/`） |
| `AbilitySoulInUseDialog` | `getAbilitySoul` | 可逆指令插片（见 `source/`） |
| `AbilitySoulInUseDialog` | `getInUseAbilitySoul` | 可逆指令插片（见 `source/`） |
| `AbilitySoulListScene` | `abilitySoulClicked` | 可逆指令插片（见 `source/`） |
| `AbilitySoulListScene` | `reuseAbilitySoulFromAnotherCharacterHandler` | 可逆指令插片（见 `source/`） |
| `AbilitySoulListScene` | `useAbilitySoulHandler` | 可逆指令插片（见 `source/`） |
| `AbilitySoulRemoveDialog` | `getWillRemoveAbilitySoul` | 可逆指令插片（见 `source/`） |
| `AbilitySoulReuseFromAnotherCharacterDialog` | `getInUseAbilitySoul` | 可逆指令插片（见 `source/`） |
| `AbilitySoulReuseFromAnotherCharacterDialog` | `getRemoveAbilitySoul` | 可逆指令插片（见 `source/`） |
| `AbilitySoulSellDialog` | `initialize` | 可逆指令插片（见 `source/`） |
| `AbilitySoulThumbnailListRepository` | `translate` | 可逆指令插片（见 `source/`） |
| `AbilitySoulUseDialog` | `getAbilitySoul` | 可逆指令插片（见 `source/`） |
| `BattleCharacterLogic` | `getAbilitySoulAbility` | 可逆指令插片（见 `source/`） |
| `BattleHeaderReadRestore$` | `readString` | 可逆指令插片（见 `source/`） |
| `DialogAbilitySoulDetailView` | `run` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `<ctor>` | 可逆指令插片（见 `source/`） |
| `EquipmentListTableItemView` | `apply` | 可逆指令插片（见 `source/`） |
| `EquipmentUpgradeAbilitySoulGenerateResultDialog` | `initialize` | 可逆指令插片（见 `source/`） |
| `GeneralAbilitySoulLogic` | `getAbility` | 可逆指令插片（见 `source/`） |
| `GeneralDialog` | `buttonClicked` | 可逆指令插片（见 `source/`） |
| `GeneralDialog` | `update` | 可逆指令插片（见 `source/`） |
| `ItemLogic` | `get_name` | 可逆指令插片（见 `source/`） |
| `MultiBattleRoomScene` | `serverMessage_Mates` | 可逆指令插片（见 `source/`） |
| `MultiBattleRoomScene` | `serverMessage_Start` | 可逆指令插片（见 `source/`） |
| `MultiQuestStartLoadingTask` | `remoteFinishedHandler` | 可逆指令插片（见 `source/`） |
| `PanelInnerContentItemListTableView` | `apply` | 可逆指令插片（见 `source/`） |
| `PanelInnerContentItemListTableView` | `draw` | 可逆指令插片（见 `source/`） |
| `PanelInnerContentItemListTableView` | `run` | 可逆指令插片（见 `source/`） |
| `PartyCarouselAbilitySoulView` | `present` | 可逆指令插片（见 `source/`） |
| `PartyLogic` | `getBattleParty` | 可逆指令插片（见 `source/`） |
| `PartyTranslator` | `translate` | 可逆指令插片（见 `source/`） |
| `SingleBattleRestoreLoadingTask` | `restoreInput` | 可逆指令插片（见 `source/`） |

> 注：源工作区通过 `source/*_apply.py` 直接在 SWF 上执行可逆指令插片并输出 JSON 审计回执（`audit/*.json`），未单独导出 `.pcode.txt` 文本文件。

## 开关或数据写法

- 主题未知裂罅 ID 段：`16000901..16000919`；构建参数：`--catalog <p2-catalog.json> --resources <p2-assets>`

## 依赖的前置补丁

- `187-riven-c22-coop-p2-protocol-and-port175`

## 对应的数据边

- 武器裂罅第二轮数据边（主题未知裂罅 `16000901/16000902` 等，位于 `<WORKDIR>/outputs/work/weapon-riven-20261025/round2/data-edges`）

## 已知限制

- 依赖前置裂罅插片方法体锚点，合包时需按 `r2 → C23 → C25 → C26` 顺序依次执行。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/round2/client
