# 162 — 数据指定召唤协力球专用 PF 动作与预载（p13 N6）

## 作用

新增 `custom_ability_string.orderedmap` 键 `wfx_ball_pf_action_<multiball_id>`（`client.ball.pf_action@1`），允许为特定召唤协力球指定 `master/skill/power_flip_action.orderedmap` 中的自定义三档 PF 动作键（替代默认的按协力球 PF 类型选择内置 `knight/fighter/ranged/supporter` 动作）。N4（码 42 配对双发 PF）与 N5（召唤球触板弹起 PF）共用该选择逻辑，并在 `BattlePartyLogic/resolvePathCollection` 中自动预载所有合法 N6 自定义动作及 N5 召唤球回退类型 PF 的三档资源闭包。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `battle.member.MemberImpl$` | `wfxBallPfActionKey(param1:int):String` | 新增静态 helper：查询 `wfx_ball_pf_action_<multiballId>`；若键存在、非空、不在内置基础动作键拒绝名单（`knight/fighter/ranged/supporter`）中，且在 `MasterData.PowerFlipAction` 表中拥有完整的三档（Lv1/Lv2/Lv3）非空动作字段，则返回该自定义动作键，否则返回 `""` |
| `battle.member.MemberImpl` | `wfxDualPfLogic(param1:int, param2:Boolean):BattlePowerFlipLogic` | 当为召唤协力球构造 PF 逻辑时，优先调用 `wfxBallPfActionKey(multiballId)`；若返回非空自定义动作键则按该键与球自身元素构造三档 PF，否则回退至球类型默认 PF |
| `battle.logic.BattlePartyLogic` | `resolvePathCollection(param1:AssetPathCollection):void` | 追加调用 `wfxBallPfPreload(param1)` |
| `battle.logic.BattlePartyLogic` | `wfxBallPfPreload(param1:AssetPathCollection):void` | 新增 helper：扫描 `custom_ability_string` 表中所有合法的 `wfx_ball_pf_action_<id>` 与 `wfx_summon_flip_pf_<id>`，预载自定义 PF 动作三档及回退类型 PF 三档的完整动作/视觉资源闭包（含联机本方与远端队伍） |

## 开关或数据写法

在 `master/string/custom_ability_string.orderedmap` 中配置：

```text
wfx_ball_pf_action_<multiball_id> = <power_flip_action_key>
```

- `<multiball_id>`：`master/battle/multiball.orderedmap` 中的正整数 ID
- `<power_flip_action_key>`：`master/skill/power_flip_action.orderedmap` 中新增的动作键名（不得与内置键 `knight`、`fighter`、`ranged`、`supporter` 重名，且必须包含非空 Lv1/Lv2/Lv3 动作 ID）

## 依赖的前置补丁

- `160-dual-pf-wfx42`
- `161-summon-flip-pf`

## 对应的数据边

- `<WORKDIR>\out\贝瑞塔-20261025\codex\拉芙PF-v7d.md`

## 已知限制

- 若配置的 `<power_flip_action_key>` 缺失、为空、与内置四键同名或缺少任一档位字段，客户端静默回退为该协力球类型的默认 PF 动作。

来源工作区：<WORKDIR>/outputs/work/beretta-p13-20261025、<WORKDIR>/out/贝瑞塔-20261025/codex
