# 165 — 武器裂罅 P0：能力拼装与战斗编队快照序列化（1008034–1008035 / 1008051）

## 作用

武器裂罅系统客户端前置补丁（P0a `1008034`、P0b `1008035`、P0c 基于 `p13` 重基 `1008051`）：

1. **裂罅魂珠能力拼装（P0a）**：当角色魂珠槽佩戴已揭示武器裂罅载体（`16000001..16000200`）时，在 `BattleCharacterLogic/getAbilitySoulAbility` 与 `GeneralAbilitySoulLogic/getAbility` 中按玩家存档或战斗快照中的裂罅词条列表（1–4 条 `[affix_key, level]`）查询对应词条模板（`15990001..15990096`），按等级 `L`（1..100）线性插值缩放最多 6 个槽位，并将多条词条聚合拼装到单个 `GeneralAbility` 的多组 `AbilityElement` 中。
2. **战斗快照与 TypePacker 白名单（P0b/P0c）**：在 `PartyLogic/getBattleParty` 构造 `BattleParty` 时将当前队伍三槽裂罅数据冻结写入 `BattleParty.weapon_rivens` 快照，并在 `TypePackerResource2/resolveMap2201` 注册字段类型白名单，使战斗结算、重连恢复与回放流转不依赖实时可变背包存档。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `BattleCharacterLogic` | `getAbilitySoulAbility` | P0a/P0b/P0c 武器裂罅能力聚合与 BattleParty 快照序列化 |
| `GeneralAbilitySoulLogic` | `getAbility` | P0a/P0b/P0c 武器裂罅能力聚合与 BattleParty 快照序列化 |
| `PartyLogic` | `getBattleParty` | P0a/P0b/P0c 武器裂罅能力聚合与 BattleParty 快照序列化 |
| `TypePackerResource2` | `resolveMap1471` | P0a/P0b/P0c 武器裂罅能力聚合与 BattleParty 快照序列化 |
| `TypePackerResource2` | `resolveMap2201` | P0a/P0b/P0c 武器裂罅能力聚合与 BattleParty 快照序列化 |

## 开关或数据写法

- **载体魂珠 ID 段**：`16000001..16000200`（`master/equipment_enhancement/ability_soul.orderedmap`）
- **词条模板 ID 段**：`15990001..15990096`
- **等级缩放公式**：1..100 级分母固定为 `99`（`L=1` 取初值，`L=100` 取满值）

## 依赖的前置补丁

- `161-summon-flip-pf` / `162-ball-pf-action`（P0c 以 `v35p13 / 1008050` 为底包重基）

## 对应的数据边

- 武器裂罅数据边（96 条词条模板 + 200 个载体魂珠行）

## 已知限制

- P0 阶段仅完成能力聚合与单机/基础战斗快照结构，完整的登录存档接入、重铸工坊 UI 与联机房间同步由后续 C1–C26 完成。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/p0
