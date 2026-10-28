# 157 — 双形态像素动画选路与总能力伤害特效预载（p11）

## 作用

修复两处战斗图集预载问题（对应 `v35p11 / versionCode 1008031`）：

1. **非双形态角色误预载 `pixelart/special`**：此前补丁在 `BattleCharacterLogic/resolvePathCollection` 中无条件调用了 `getSpecialPixelArtAnimationPath`，导致未配置 `ModDualForm_` 的普通角色也把本不存在的 `special` 像素动画打进战斗动态图集，挤占图集预算。本补丁在 `getSpecialPixelArtAnimationPath` 调用外包一层内联检查：仅当 `MasterData.ModDualForm` 表中存在键 `"ModDualForm_" + String(characterId)` 且非空字符串时才预载 `special` 像素动画。
2. **补齐 `total_ability_damage_effect` 公共战斗特效预载**：在 `BattleAssetPathCollectionBuilder/addCommonAssets` 的公共特效数组（`total_skill_damage_effect`、`total_power_flip_damage_effect` 之后）追加 `"battle/Events/effect/in_game/common/total_ability_damage_effect"`，防止能力伤害总计特效因未预载而在战斗中缺图。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `battle.logic.BattleCharacterLogic` | `resolvePathCollection(param1:AssetPathCollection):void` | 在 `getSpecialPixelArtAnimationPath` 调用前内联查询 `MasterData.getTable(MasterData.ModDualForm)["ModDualForm_" + String(characterId)]`，仅非空时调用 |
| `battle.asset.BattleAssetPathCollectionBuilder` | `addCommonAssets():void` | 将公共特效数组元素数从 14 扩为 15，追加 `"battle/Events/effect/in_game/common/total_ability_damage_effect"` |

## 开关或数据写法

- **双形态 `special` 预载门槛**：读取 `master/string/custom_ability_string.orderedmap`（`MasterData.ModDualForm`）中的 `"ModDualForm_" + <characterId>`，非空字符串才预载该角色的 `special` 像素动画。
- **`total_ability_damage_effect`**：常驻预载于战斗公共资源，无需额外配置。

## 依赖的前置补丁

- `129-dual-form-ui-and-preload`（双形态基础接入）

## 对应的数据边

- 深渊兽重做（`abyss-beast-rework-20261025`）及双形态角色资源边

## 已知限制

- 仅依据角色自身的 `characterId` 检查 `"ModDualForm_" + characterId`，不新增额外 helper 方法或改变类的 trait 布局。

来源工作区：<WORKDIR>/outputs/work/atlas-audit-20261025/p11-patch、<WORKDIR>/outputs/work/abyss-beast-rework-20261025
