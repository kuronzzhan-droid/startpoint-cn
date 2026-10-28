# 192 — 武器裂罅 C26：武器一览「持有裂罅」筛选按钮与道具一览主题未知裂罅置顶（1008094）

## 作用

1. **武器一览「持有裂罅」筛选**：在装备分类的筛选弹窗（`EquipmentFilterDialog`）属性行下方新增 460×112 白色按钮「持有裂罅」（kind 3），勾选确定后仅保留当前持有且在 `saveData.weapon_rivens` 中至少有一张已揭示裂罅绑定的武器。
2. **道具一览主题未知裂罅置顶**：在 `ItemTableTranslator/translateFromCategorizedItems` 裂罅分组内重排顺序为「未知裂罅 `16000000` → 主题未知裂罅 `16000901..16000919`（升序）→ 已揭示裂罅实例」，解决主题未知裂罅因 item ID 大而沉在分组底部的问题。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `EquipmentFilterDialog` | `dialogButtonClicked` | 可逆指令插片（见 `source/`） |
| `EquipmentFilterDialog` | `prepare` | 可逆指令插片（见 `source/`） |
| `EquipmentFilterDialogContentView` | `get_height` | 可逆指令插片（见 `source/`） |
| `EquipmentFilterDialogContentView` | `run` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `buttonClicked` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `filterDialogOkHandler` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `getFilteredEquipmentList` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `rebuildAllThumbnails` | 可逆指令插片（见 `source/`） |
| `ItemTableTranslator` | `translateFromCategorizedItems` | 可逆指令插片（见 `source/`） |

> 注：源工作区通过 `source/*_apply.py` 直接在 SWF 上执行可逆指令插片并输出 JSON 审计回执（`audit/*.json`），未单独导出 `.pcode.txt` 文本文件。

## 开关或数据写法

- 筛选设置动态字段：`c26Host`、`c26Pending`、`c26OwnRiven`；主题未知裂罅置顶段：`16000901..16000919`

## 依赖的前置补丁

- `191-riven-c25-workshop-batch-ctx-fix`

## 对应的数据边

- 武器裂罅第二轮数据边（主题未知裂罅 `16000901/16000902` 等，位于 `<WORKDIR>/outputs/work/weapon-riven-20261025/round2/data-edges`）

## 已知限制

- 依赖前置裂罅插片方法体锚点，合包时需按 `r2 → C23 → C25 → C26` 顺序依次执行。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/round2/c26
