# 155 — 队长表复用 AbilityValues 补丁分支（724/422）

## 作用

原客户端补丁模块仅修改了 `AbilityValues` 静态解析器（`parseAt45` 写入状态型 kind 724、`parseAt107` 乘算属性型 kind 422），未同步修改 `LeaderAbilityValues` 同名解析方法。当数据把 `wfx_WriteCondition`（kind 724，如 `wfx:24` 直击连击增伤）或乘算属性能力（kind 422）配在 `leader_ability` 表时，队长技能栏会落入原生 default 分支抛错或忽略。本补丁将 `LeaderAbilityValues$/parseAt45` 与 `LeaderAbilityValues$/parseAt107` 委托给已打补丁的 `AbilityValues` 对应方法，使队长表原生支持所有已注册在 `AbilityValues` 对应分组下的补丁能力。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `action.master.LeaderAbilityValues$` | `parseAt45(values:Array):AbilityElement` | 直接转发调用 `AbilityValues.parseAt45(param1)`并返回结果 |
| `action.master.LeaderAbilityValues$` | `parseAt107(values:Array):AbilityElement` | 直接转发调用 `AbilityValues.parseAt107(param1)` 并返回结果 |

> 注：源工作区仅保留字节码补丁构建脚本（`leader_kinds/patch.py`），未单独导出 `.pcode.txt` 快照文件。

## 开关或数据写法

无需新增开关。在 `master/leader_ability/leader_ability.orderedmap` 中可直接使用与 `ability.orderedmap` 相同写法的：

- **kind 724**（`parseAt45`，如 `unique_condition` 第 0 列的 `wfx:<码>:<arg>:<value>:<flags>:<label>`）
- **kind 422**（`parseAt107`，乘算属性/狂热等）

## 依赖的前置补丁

- `112-wfx-effect-query`（以及后续在 `AbilityValues$/parseAt45` 与 `parseAt107` 上挂载的补丁，如 `113-direct-base`）

## 对应的数据边

- 深渊兽重做 / 测试服 `v35p10`（`versionCode 1008030`）起将 `wfx_WriteCondition`（如 `wfx:24`）配置于 `leader_ability` 表的角色数据边

## 已知限制

- 仅转发 `parseAt45` 与 `parseAt107` 两个分组；若未来在 `AbilityValues` 其他 `parseAt*` 分组新增补丁 kind 且需用于队长表，需另行转发对应分组。

来源工作区：<WORKDIR>/outputs/work/leader-kind-patch-20261025
