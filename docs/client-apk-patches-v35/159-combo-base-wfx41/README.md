# 159 — 连击常驻基数（wfx 码 41 / p12 N3）

## 作用

新增 `wfx_WriteCondition` 效果码 **41**（`client.combo.base@1`）：在状态持续期间为当前玩家队伍提供常驻连击基数（底数）。有效连击数 `effectiveCombo = rawCombo + baseCombo`，用于 `getCombo`、`getComboInt`、PF 充能档位 `getPowerFlipChargeLv`、PF 充能比例 `getPowerFlipChargeRate` 以及连击减少阈值通知 `decreaseComboTo`。当弹板消耗连击（`expire`）或连击归零时，仅清空原始连击 `rawCombo`，有效连击回到 `baseCombo`（例如基数为 25 时，连击永远不低于 25，触板可直接达到对应 PF 档位）。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `battle.ComboCalculatorImpl` | `wfxComboBase():int` | 新增 helper：扫描当前 `ComboCalculatorImpl` 所属 `Battle` 的本队活动且存活成员身上的 `wfx` 码 41 状态，读取 `arg0`（正整数基数），多个状态并存时取最大值（不按层数倍增），排除外队与召唤物 |
| `battle.ComboCalculatorImpl` | `wfxComboEffective():Number` | 新增 helper：返回 `Number(this.combo) + Number(this.wfxComboBase())` |
| `battle.ComboCalculatorImpl` | `getCombo():Number` | 改为返回 `this.wfxComboEffective()` |
| `battle.ComboCalculatorImpl` | `getComboInt():int` | 改为返回 `int(this.wfxComboEffective())` |
| `battle.ComboCalculatorImpl` | `getPowerFlipChargeLv(param1:int = 0):int` | 将用于比较Lv1/Lv2/Lv3/Lv4阈值的连击值改为 `getComboInt() + param1`（含有效连击基数） |
| `battle.ComboCalculatorImpl` | `getPowerFlipChargeRate():Number` | 按含基数的有效连击数与有效档位计算充能进度比 |
| `battle.ComboCalculatorImpl` | `decreaseComboTo(param1:int):void` | 原始存储 `this.combo` 仍按原生逻辑下调，但向 `BattleAbilityTrigger` 派发通知时传入加上 `wfxComboBase()` 后的有效连击 |

## 开关或数据写法

在 `master/string/custom_ability_string.orderedmap` 中配置：

```text
wfx:41:<base_combo>:0:0:0
```

- `arg0` (`base_combo`, int)：常驻连击基数（须 `> 0`，如 `25`）
- `arg1`、`arg2`、`arg3`：保留填 `0`

## 依赖的前置补丁

- `112-wfx-effect-query`（提供 `MemberImpl/wfxHasCode`、`wfxCondInt` 等状态查询基础设施）
- `154-pf4-source-unison`（`getPowerFlipChargeLv` 兼容 PF4 阈值判断）

## 对应的数据边

- `<WORKDIR>\out\贝瑞塔-20261025\codex\接口-p12与v7.md`（贝瑞塔连击基数能力）

## 已知限制

- 多来源码 41 状态并存时取最大 `base_combo`，不叠加、不按层数倍增。
- 基数状态赋予瞬间不伪造连击增加事件（`COMBO_CREATED`），僅改变有效连击读取与 PF 档位判定。
- 三人联机中每个玩家的 `ComboCalculatorImpl` 仅扫描该玩家自身 `SquadManager` 下的主队角色，不会跨玩家串队。

来源工作区：<WORKDIR>/outputs/work/beretta-p12-20261025、<WORKDIR>/out/贝瑞塔-20261025/codex
