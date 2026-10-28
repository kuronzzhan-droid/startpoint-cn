# 194 — 水杰拉德（129989）玛纳板 2 需 120 级门槛与 1008093/1008094 合包器

## 作用

1. **水杰拉德（`129989`）玛纳板 2 等级门槛调整为 120 级（`board2/`）**：修改 `BattleCharacterLogic/getRequiredConditionsToOpenManaBoard` 与 `BattleCharacterLogic/getMaxOpenableManaBoard`，当 `this.id == 129989` 时将玛纳板 2 开启所需的等级上限 `get_baseLevelCap()`（原为 80）覆写为 `120`。当等级 `< 120` 时不能开启玛纳板 2，点击切换板按钮原生弹出「需要等级 120」，且在 80–119 级进入玛纳板场景时不会误发 `character/open_mana_board` 请求或误亮角色红点。
2. **1008093 / 1008094 多补丁合包流水线（`merge/`）**：提供将 `guard`（码 43）、`board2`（120 级开板 2）、`matefx`（队友特效屏蔽 + 伤害缩写 k/m/b/t + P8 冲刺）、`r2`、`C23`、`C25`、`C26`、准入 Build ID 替换与 M/B/T 字形内置包一键合包并校验零冲突/可逆剥离的合包脚本。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `logic.BattleCharacterLogic` | `getRequiredConditionsToOpenManaBoard(param1:int):Array` | 在 `param1 == 2` 的等级比较与 `ManaBoardOpenRequiredCondition.Level(...)` 构造前各插入 10 条指令：当 `this.id == 129989` 时将栈顶 `get_baseLevelCap()` 替换为 `120` |
| `logic.BattleCharacterLogic` | `getMaxOpenableManaBoard():int` | 在等级比较前插入 10 条指令：当 `this.id == 129989` 时将栈顶 `get_baseLevelCap()` 替换为 `120` |

## 开关或数据写法

- 角色 ID `129989`（水杰拉德）在字节码内以 `(2000 << 6) + 1989` 编码，所需等级固定为 `120`（0 新增常量池条目）。

## 依赖的前置补丁

- 无客户端前置补丁（与服务端 `character/open_mana_board` 120 级校验配套）

## 对应的数据边

- 水杰拉德（`129989`）角色与服务端 `server-board2` 校验补丁

## 已知限制

- 仅针对角色 ID `129989` 要求 120 级开启玛纳板 2，其余所有角色保持原生 `get_baseLevelCap()` 逻辑不变。

来源工作区：<WORKDIR>/outputs/work/gerald-guard-20261027/board2、<WORKDIR>/outputs/work/gerald-guard-20261027/merge
