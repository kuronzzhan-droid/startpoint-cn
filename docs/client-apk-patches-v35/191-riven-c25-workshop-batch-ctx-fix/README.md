# 191 — 武器裂罅 C25：修复裂罅工坊「批量分解 → 分解」因缺少 wfx_riven 上下文无响应（1008093–1008094）

## 作用

修复真机从商店或武器一览直接进入裂罅工坊（未先进入重铸页）时 `loadedData.wfx_riven` 为 null 导致 C23 批量分解点击静默跳过的问题：在 `EquipmentListScene/update` 与 `EquipmentListScene/buttonClicked` 入口当 `filterSetting.wfxRiven` 为真且 `wfx_riven` 为空时，自动写入 `{mode: 'c25_workshop'}`（与重铸页 `'wfx_riven'` 区分，不影响 271 处继承读者）。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `EquipmentListScene` | `buttonClicked` | 可逆指令插片（见 `source/`） |
| `EquipmentListScene` | `update` | 可逆指令插片（见 `source/`） |

> 注：源工作区通过 `source/*_apply.py` 直接在 SWF 上执行可逆指令插片并输出 JSON 审计回执（`audit/*.json`），未单独导出 `.pcode.txt` 文本文件。

## 开关或数据写法

- 内部上下文标记：`{mode: 'c25_workshop'}`

## 依赖的前置补丁

- `189-riven-c23-detail-and-batch-dismantle`

## 对应的数据边

- 武器裂罅第二轮数据边（主题未知裂罅 `16000901/16000902` 等，位于 `<WORKDIR>/outputs/work/weapon-riven-20261025/round2/data-edges`）

## 已知限制

- 依赖前置裂罅插片方法体锚点，合包时需按 `r2 → C23 → C25 → C26` 顺序依次执行。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/round2/c25
