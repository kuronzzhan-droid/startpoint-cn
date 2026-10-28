# 156 — 直击连击增伤连击数封顶（wfx 码 24 `flags` 上限）

## 作用

扩展补丁 `113-direct-base` 的 `MemberImpl/wfxDirectFactor`（`wfx` 码 24：按当前连击数提升直接攻击伤害）。原实现中参数槽 1（`flags`）未参与计算，连击数无上限。本补丁在 `wfxDirectFactor` 中读取每个生效码 24 状态的整数参数槽 1（`flags`）：当 `flags > 0` 时，将该状态用于计算增伤的 `effectiveCombo` 封顶为 `min(currentCombo, flags)`；当 `flags <= 0` 时保持原有无上限行为。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `battle.member.MemberImpl` | `wfxDirectFactor():Number` | 遍历码 24 状态时，对每个匹配的 `ConditionElement` 调用 `wfxCondInt(cond, 1)` 读取 `flags`；若 `flags > 0 && effCombo > flags` 则令 `effCombo = flags`，再计算 `effCombo * rate / step` 并累加 |

> 注：源工作区仅保留字节码生成脚本（`direct_combo_cap/patch.py`），未单独导出 `.pcode.txt` 快照文件。

## 开关或数据写法

在 `unique_condition` 第 0 列写 wfx 行：

```text
wfx:24:1:<每连击万分比>:<连击上限>:<label>
```

- 码 24 是直击基础倍率（113）；`arg=1` 表示按连击数加成，`value` 为每连击的万分比。
- 本补丁新增的是 `flags`：`> 0` 时最多计入这么多连击（同一角色多条取最小值），`0` 保持旧行为不封顶。
- 先例：凯尔 1.4.287 起 `13999014 = wfx:24:1:100:99`（每连击 +1%，最多 99 连击）。

## 依赖的前置补丁

- `112-wfx-effect-query`

## 对应的数据边

- 测试服 `v35p10`（`versionCode 1008030`）起使用连击上限的 `wfx:24` 角色/队长能力数据边

## 已知限制

- 连击封顶按每个码 24 状态条目各自独立计算后再求和，不改变角色实际连击计数值。

来源工作区：<WORKDIR>/outputs/work/leader-kind-patch-20261025
