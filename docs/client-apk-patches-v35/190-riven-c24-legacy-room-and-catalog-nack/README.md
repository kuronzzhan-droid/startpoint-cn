# 190 — 武器裂罅 C24：无 P2 上下文旧房间兼容启动与 catalog 不一致 NACK 原因上报（1008093）

## 作用

兼容未下发 P2 上下文的老版本联机房间（无裂罅正常开局），并在 `MultiBattleRoomScene/serverMessage_Mates` 校验发现 catalog 不一致时在 NACK 日志中附带 `|catalog` 原因后缀。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `BattleCharacterLogic` | `getAbilitySoulAbility` | 可逆指令插片（见 `source/`） |
| `BattleHeaderReadRestore$` | `readString` | 可逆指令插片（见 `source/`） |
| `MultiBattleRoomScene` | `serverMessage_Mates` | 可逆指令插片（见 `source/`） |
| `MultiBattleRoomScene` | `serverMessage_Start` | 可逆指令插片（见 `source/`） |
| `SingleBattleRestoreLoadingTask` | `restoreInput` | 可逆指令插片（见 `source/`） |

> 注：源工作区通过 `source/*_apply.py` 直接在 SWF 上执行可逆指令插片并输出 JSON 审计回执（`audit/*.json`），未单独导出 `.pcode.txt` 文本文件。

## 开关或数据写法

- NACK 原因后缀：`|catalog`

## 依赖的前置补丁

- `189-riven-c23-detail-and-batch-dismantle`

## 对应的数据边

- 武器裂罅第二轮数据边（主题未知裂罅 `16000901/16000902` 等，位于 `<WORKDIR>/outputs/work/weapon-riven-20261025/round2/data-edges`）

## 已知限制

- 依赖前置裂罅插片方法体锚点，合包时需按 `r2 → C23 → C25 → C26` 顺序依次执行。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/round2/c24
