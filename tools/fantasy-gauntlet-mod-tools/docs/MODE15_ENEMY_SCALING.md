# 幻想连战敌人血量倍率配置

幻想连战构建器从 `mode15_abyss_plan.json` 读取 Boss 与小怪的独立血量倍率。

## 全局小怪倍率

在 `rules` 中设置：

```json
"minion_hp_scale": 0.08
```

该值只作用于 `zako`（场上小怪）与 `funnel`（动态召唤单位），Boss 主体仍使用关卡的 `hp` 值。本项目当前默认值为 `0.08`，即小怪和召唤物使用该关 Boss 倍率的 8%。

## 单关覆盖

如某一关需要不同的小怪倍率，可直接在对应的 `stages` 项目中加入：

```json
"minion_hp_scale": 0.05
```

单关配置优先于 `rules.minion_hp_scale`。未填写时使用全局值。

## Boss 倍率

每关的 `hp` 只控制 Boss 主体。例如：

```json
"stage": 14,
"hp": 1.0
```

表示第14关 Boss 使用原始 HP 倍率 1；小怪仍按 `hp × minion_hp_scale` 计算。

若该特殊倍率不符合原先的单人关递增校验，应同时在 `rules` 中明确登记：

```json
"hp_progression_exempt_stages": [14]
```

只有列入该数组的关卡会跳过递增性检查，其余关卡仍受保护。

构建器同时对 Rush 单人表和 Advent 多人表写入正确的列顺序：`zako / funnel / boss`，避免降低小怪时误改 Boss 主体。
