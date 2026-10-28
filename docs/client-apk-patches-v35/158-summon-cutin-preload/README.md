# 158 — 召唤协力球主动技能 Cutin 与远端技能名纹理预载（p12/p12b N1）

## 作用

原客户端 `ActionDslAssetResolver/addAnimationLayoutForSummonedMultiball` 在预载召唤协力球（`multiball`）资源时，虽然在逻辑层（`ActionDslHandler`）已递归解析其 `c9`（召唤物主动技能 `actionId`）的动作 DSL，但在视觉层未预载召唤物释放主动技能时的 Cutin 肖像图、Assist/Single 布局及远端玩家视角所需的 `064` 缩放技能名动态纹理（`v35p12 / 1008032` 首版完成肖像与布局，`v35p12b / 1008033` 补齐远端 `064` 动态纹理）。本补丁在 `addAnimationLayoutForSummonedMultiball` 中补齐完整预载闭包，使具有主动技能 `c9` 的召唤协力球（如拉芙召唤物）在本机与三人联机远端视角下释放技能 Cutin 时均不缺图。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `battle.action.dsl.ActionDslAssetResolver` | `addAnimationLayoutForSummonedMultiball(param1:String):void` | 当 `!withoutView` 且 `multiball` 表项的 `c9`（`actionId`）非空时：① 按 `c1`（像素画/外观路径）调用 `CharacterAssetPath.getSkillCutinImagePath` 预载 Cutin 角色图；② 按 `c8`（布尔值）预载 `Assist` 布局或 `me/other` Single Cutin 布局；③ 除原生 `100` 比例技能名纹理外，额外注册 `ActionSkillName(skillName, "064", 0.64)` 供联机远端 Cutin 视图（`View2`）读取 |

## 开关或数据写法

无需新增自定义表键，直接由原生 `master/battle/multiball.orderedmap` 字段驱动：

- `c9`：召唤物主动技能 `action_id`（非空时触发预载）
- `c1`：召唤物资源路径（用于推导 `getSkillCutinImagePath`）
- `c8`：Cutin 布局类型开关（真值走 Assist 布局，假值走 Single 布局）

## 依赖的前置补丁

- 无硬性前置补丁（与 `142-dsl-asset-preload-closure` 协同工作）

## 对应的数据边

- `<WORKDIR>\out\贝瑞塔-20261025\codex\拉芙PF-v7d.md`（拉芙召唤协力球主动技能 Cutin）

## 已知限制

- 仅当 `!withoutView` 时预载视觉纹理与布局；无视图模式（纯逻辑模拟）不加载纹理。
- 远端玩家 Cutin 是否实际弹出仍受客户端原生设置（`displaysSkillCutin` / `displayOther`）控制，不影响技能逻辑执行。

来源工作区：<WORKDIR>/outputs/work/beretta-p12-20261025、<WORKDIR>/out/贝瑞塔-20261025/codex
