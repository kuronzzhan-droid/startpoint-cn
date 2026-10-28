# 193 — 受伤必定完美防御（wfx 码 43 / 1008093）

## 作用

实现 v35 通用框架效果码 **43**（受伤必定触发完美防御判定）：当角色持有码 43 状态（无论来自本成员可见状态槽、隐形被动固有状态槽还是队伍共享状态槽，也无论主位或合击位）时，`MemberImpl/hasGuarded()` 恒返回 `true`，使该角色受击时必定触发完美防御（Perfect Guard）减伤与判定。仅修改 2 个既有方法（0 新增类、0 新增方法、0 新增 trait、0 新增常量池条目）。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `pinball.scene.battle.battle.squad.member.MemberImpl` | `hasGuarded():Boolean` | 先执行原生 `Boolean(ball.hasAura())` 短路判断；若为 `false` 且 `this.conditionSlot != null`，则调用 `this.conditionSlot.wfxRows(43, true).length > 0` 返回布尔值 |
| `pinball.scene.battle.battle.condition.ConditionSlot$` | `wfxSpec(param1:int):Object` | 在 `arg`（第 2 段）与 `flags`（第 4 段）负数拦截 `iflt` 前各插入 10 条指令放行码 43，允许码 43 忽略任意有符号 32 位整数参数 |

## 开关或数据写法

在 `unique_condition` 第 0 列写 wfx 行（与 112 的写法相同）：

```text
wfx:43:0:0:0:hidden_guard
```

- 持有即生效：只检查 `wfxRows(43, true).length > 0`，不看层数和参数；label 以 `hidden_` 开头时不显示图标。
- 数据先例：1.4.323 水杰拉德 UQ 12998920，300 帧。

## 依赖的前置补丁

- `112-wfx-effect-query`（提供 `ConditionSlot/wfxRows` 与 `ConditionSlot$/wfxSpec`）

## 对应的数据边

- 水属性杰拉德（`129989`）完美防御能力数据边

## 已知限制

- 纯函数判定，不修改角色或球体状态；与原生光环完美防御完全兼容（有光环时直接走原生短路返回 `true`）。

来源工作区：<WORKDIR>/outputs/work/gerald-guard-20261027
