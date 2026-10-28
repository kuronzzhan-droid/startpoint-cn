# 187 — 武器裂罅 C22 & port175：联机 P2 房间快照协议（ACK/NACK/Start）与测试服 1008092 合入（1008083 / 1008092）

## 作用

实现武器裂罅三人联机 P2 协议（`weapon-riven-multi-v1`）：在 `MultiBattleRoomScene` 的 `Mates` / `Start` / `Disbanded` / `socketInput_receive` 中完成全房裂罅快照校验、catalog 一致性比对、`wfr2_pending` → `wfr2_committed` 二阶段提交、NACK 拒绝与 `WFR2_DISABLED` / `WFR2_CANCEL` 降级提示；战斗消费端（`BattleCharacterLogic/getAbilitySoulAbility`）严格按各玩家 `BattleParty` 冻结行读取。同时包含 `port175` 将 P0+C1–C22 完整重放合入测试服 `1008091` 产出 `1008092` 的构建脚本。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `BattleCharacterLogic` | `getAbilitySoulAbility` | C22 方法级字节码插片（详见 `pcode/`） |
| `BattleHeaderReadRestore$` | `readString` | C22 方法级字节码插片（详见 `pcode/`） |
| `MultiBattleRoomScene` | `run` | C22 方法级字节码插片（详见 `pcode/`） |
| `MultiBattleRoomScene` | `serverMessage_Disbanded` | C22 方法级字节码插片（详见 `pcode/`） |
| `MultiBattleRoomScene` | `serverMessage_Mates` | C22 方法级字节码插片（详见 `pcode/`） |
| `MultiBattleRoomScene` | `serverMessage_Start` | C22 方法级字节码插片（详见 `pcode/`） |
| `MultiBattleRoomScene` | `socketInput_receive` | C22 方法级字节码插片（详见 `pcode/`） |
| `MultiQuestStartLoadingTask` | `remoteFinishedHandler` | C22 方法级字节码插片（详见 `pcode/`） |
| `SingleBattleRestoreLoadingTask` | `restoreInput` | C22 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap1471` | C22 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap2201` | C22 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 准入能力：`weapon-riven-v1`、`weapon-riven-multi-v1`；环境变量/参数：`RIVEN_P2_CATALOG`（`riven-multi-v1-<sha256_prefix32>`）

## 依赖的前置补丁

- `186-riven-c21-reforge-footer-inset-v2、163-five-boss-stage-carry、164-continue-cost-item`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c22、<WORKDIR>/outputs/work/weapon-riven-20261025/port175
