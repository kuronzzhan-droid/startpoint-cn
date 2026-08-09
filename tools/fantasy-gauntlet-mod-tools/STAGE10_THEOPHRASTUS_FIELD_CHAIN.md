# 第10关：噬星兽原生场地转换链

## 原生结构

- 关卡来源：`advent_event_quest/200028/5`
- Boss：`smr21_big_boss_multi`，等级键 `79`
- 场地 / Zone：`smr21_big_boss_multi`
- Boss 状态链保留原样：`neutral1 -> continue -> neutral1 -> continue`
- 三个场地动作：
  1. `boss_smr21_big_boss$difficulity10_ex3`
  2. `boss_smr21_big_boss$difficulity10_continue1`
  3. `boss_smr21_big_boss$difficulity10_continue2`

三个动作原版都只包含一次 `StartModifierField`。幻想连战只替换该命令的场地效果及解除条件，不插入外部计时器、不借用其他 Boss 动作，也不修改原生阶段状态。

## 当前幻想连战映射

1. 回复无效；能力伤害命中 80 次解除。
2. 攻击力 -50%；累计 3000 万强化弹射伤害解除。
3. 连击数 +10；不设置解除条件。

## 可复用边界

可复用的是“解析原生动作并替换唯一的 `StartModifierField` 负载”这一构建方法。要移植到其他 Boss，目标 Boss 仍必须满足：

1. 自身状态机确实会依次调用多个独立动作；
2. 每个动作具有明确且唯一的 `StartModifierField`；
3. 使用与目标玩法兼容的多人场地容器；
4. 转阶段由 Boss 原生同步，不依赖排名战计时器或其他专属控制器。

因此，不能只复制这三个噬星兽动作路径到任意 Boss。缺少原生阶段动作钩子的 Boss，需要先审计并修改其状态机；否则场地效果不会按阶段触发，或可能出现黑屏、不同步和运行时报错。
