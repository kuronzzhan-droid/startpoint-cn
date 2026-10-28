# 189 — 武器裂罅 C23：裂罅详情弹窗「分解」按钮与裂罅工坊「批量分解」（最多 20 张）（1008093）

## 作用

1. **详情弹窗单张分解**：在裂罅工坊或道具一览打开已揭示裂罅详情时，于锁定按钮旁并排新增「分解」按钮（ID `0x6F000000`），点击弹出带返还碎片数量的确认框并调用 `weapon_riven/dismantle`。
2. **裂罅工坊批量分解**：在工坊页脚新增「批量分解 / 取消 / 分解」按钮与碎片持有/预计返还底栏，复用 `BulkSelect` 勾选模式（上限 20 张，已锁定或有未决重铸的卡盖暗色块禁选），确认后请求 `POST weapon_riven/dismantle_batch {items:[{item_id, revision}]}`。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `EquipmentListScene` | `buttonClicked` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `filterDialogOkHandler` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `run` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `toThumbnailData` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `update` | 可逆指令插片（见 `source/`） |
| `EquipmentListTableItemView` | `apply` | 可逆指令插片（见 `source/`） |
| `EquipmentListTableItemView` | `enhancedEffectAnimationDraw` | 可逆指令插片（见 `source/`） |
| `EquipmentListTableItemView` | `setSelected` | 可逆指令插片（见 `source/`） |
| `EquipmentListView` | `setupHowToButton` | 可逆指令插片（见 `source/`） |
| `GeneralDialog` | `buttonClicked` | 可逆指令插片（见 `source/`） |
| `GeneralDialog` | `preparation` | 可逆指令插片（见 `source/`） |
| `GeneralDialog` | `sliderValueChangedForAbilityDescriptionVariationWithLevel` | 可逆指令插片（见 `source/`） |
| `GeneralDialogView` | `run` | 可逆指令插片（见 `source/`） |

> 注：源工作区通过 `source/*_apply.py` 直接在 SWF 上执行可逆指令插片并输出 JSON 审计回执（`audit/*.json`），未单独导出 `.pcode.txt` 文本文件。

## 开关或数据写法

- 新增远端接口：`weapon_riven/dismantle_batch`（单次最多 20 张 `{item_id, revision}`）

## 依赖的前置补丁

- `188-riven-r2-f1009-themed-and-party-limit`

## 对应的数据边

- 武器裂罅第二轮数据边（主题未知裂罅 `16000901/16000902` 等，位于 `<WORKDIR>/outputs/work/weapon-riven-20261025/round2/data-edges`）

## 已知限制

- 依赖前置裂罅插片方法体锚点，合包时需按 `r2 → C23 → C25 → C26` 顺序依次执行。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/round2/c23
