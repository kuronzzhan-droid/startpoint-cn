# 166 — 武器裂罅 C1：登录存档接入、公共响应合并与基础详情显示（1008052）

## 作用

接入登录 `rawData.data.user_weapon_riven_list` 与 `PlayerLogic/applyCommonResponse` 增量 `weapon_rivens` 合并，写入 `LoadedData.player.weapon_rivens` 动态对象；在 `ItemLogic/get_name`、`GeneralAbilitySoulLogic/getAbility`、`AbilitySoulDetailDialog/initialize` 中支持按槽位查询绑定武器名称与动态词条描述，并在 `PartyLogic/getBattleParty` 中校验主位武器匹配。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulDetailDialog` | `initialize` | C1 方法级字节码插片（详见 `pcode/`） |
| `GeneralAbilitySoulLogic` | `getAbility` | C1 方法级字节码插片（详见 `pcode/`） |
| `InitializeRealRemote` | `loadSuccessHandler` | C1 方法级字节码插片（详见 `pcode/`） |
| `InitializeRealRemote` | `restoreFinishedHandler` | C1 方法级字节码插片（详见 `pcode/`） |
| `ItemLogic` | `get_name` | C1 方法级字节码插片（详见 `pcode/`） |
| `PartyLogic` | `getBattleParty` | C1 方法级字节码插片（详见 `pcode/`） |
| `PlayerLogic` | `applyCommonResponse` | C1 方法级字节码插片（详见 `pcode/`） |
| `RealRemoteService` | `earlySuccessHandler` | C1 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap1254` | C1 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap2201` | C1 方法级字节码插片（详见 `pcode/`） |
| `TypePackerResource2` | `resolveMap848` | C1 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 登录与 API 响应字段：`user_weapon_riven_list`、`weapon_rivens`（槽位键 `16000001..16000999`）

## 依赖的前置补丁

- `165-riven-p0-battle-snapshot`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build
