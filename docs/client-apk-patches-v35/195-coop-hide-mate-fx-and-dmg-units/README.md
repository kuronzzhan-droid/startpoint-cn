# 195 — 联机屏蔽队友特效、轻量模式减负、伤害单位 k/m/b/t 档位染色与钻头冲刺场内锁怪（matefx P1–P8 / 1008093–1008094）

## 作用

合并 P1–P8 共 13 个既有方法的可逆指令插片（0 新增类、0 新增方法、0 新增 trait）：

1. **联机固定屏蔽队友特效与多球球体（P1、P2、P2b、P3、P4）**：不依赖客户端轻量模式开关，联机时固定屏蔽远端队友镜像战斗的技能/PF/能力演出（`ActionEffectView`）、能力弹道（`AbilityDamageShotView`）、协力球/召唤球小人（`showOthersMultiball = false`）与非主球球体（`BallView`）、队友技能 Cut-in（`CutinActionSkillView2`）及队友受击火花；保留队友主队小人、主球、状态图标、血条和名字，本机主战斗不受影响。
2. **轻量模式关闭本机受击小光点（P5）**：当勾选「轻量模式」（`battle.lightweightModeLevel >= 1`）时，在 `EffectManagerImpl/show` 的 `HitEffect`（`case 63`）入口跳过受击小光点构造，同时保持 `getRandomRotation()` 调用次数不变。
3. **伤害数字支持 `k` / `m` / `b` / `t` 四档缩写及整串档位色（P6）**：
   - 在 `DamageEffectView$/unitPrefix` 中按 `>= 1e13` 输出 `<int>@<1位小数>t`、`>= 1e10` 输出 `<int>@<1位小数>b`、`>= 1e7` 输出 `<int>@<1位小数>m`、`< 1e7` 保持原生 `k` 与整数格式；
   - 在 `DamageEffectView$/resolvePath`、`AccumulationDamageIndicatorView/createDigit` 与 `updateDigits` 中接入 `unit_prefix_{m,b,t}` 纹理（连击累计伤害数字剪辑扩展为 15 帧）；
   - 当带 `'m'` / `'b'` / `'t'` 缩写时，单次伤害跳字（`DamageEffectView/createSprite`）与连击累计伤害浮字（`AccumulationDamageIndicatorView/updateDigits`）将该串内所有数字与小数点统一染为对应档位色（`m` 青色 `0x40D8FF`、`b` 粉色 `0xFF4FB4`、`t` 紫色 `0xA070FF`），末尾缩写字母自身保持贴图原色（`0xFFFFFF`）。
4. **轻量模式下直击伤害数字全并入合计（P7）**：在 `DamageIndicatorManager/wfxMergeDamage` 中，当 `lightweightModeLevel >= 1` 且 `info.createdByDirectAttack` 为真时，将单目标当帧独立跳字上限由 `2` 设为 `0`，全部并入下一帧合计跳字。
5. **深渊之兽钻头冲刺（`wfx_dash_v2`）只锁场内怪、场内全空静默不冲刺（P8）**：在 `BallImpl/wfxFindDashEnemy` 中过滤坐标位于 `zone.bounds` 之外的场外实体（如 `y = -1500` 的地狱南瓜王）；在 `BallImpl/wfxTryDashReplacement` 中当 `wfx_dash_v2` 找不到任何场内目标时直接静默 `return true`（不冲刺、不扣冲刺槽、不播失败动画、不退回原生冲刺）。

## 改了哪些类/方法

| 编号 | 类 | 方法 | 改动 |
|---|---|---|---|
| P1 | `pinball.scene.battle.viewInput.BattleViewInputSettings` | `isOtherBattleActionVisible():Boolean` | 插入 `pushfalse; returnvalue` 恒返回 `false` |
| P2 | `pinball.scene.battle.battle.Battle` | `preparation():void` | 在原生 `showOthersMultiball` 赋值后覆写为 `false` |
| P2b + P3 | `pinball.scene.battle.view.BattleView` | `show(param1:int, param2:ViewCommand):int` | 他人分支 `case 43`（非主球 `Ball`）与 `case 55`（`CutinActionSkill`）直接返回 `_loc5_` |
| P4 | `pinball.scene.battle.battle.effect.EffectManagerImpl` | `canPlayEffect(param1:Boolean, param2:EffectKind):Boolean` | `param1 == false`（非本机主战斗）时直接返回 `false` |
| P5 | `pinball.scene.battle.battle.effect.EffectManagerImpl` | `show(param1:EffectKind):void` | 内层 `SimpleEffectKind` `case 63`（`HitEffect`）在 `lightweightModeLevel >= 1` 时保持随机数调用次数并跳过构造 |
| P6-1 | `pinball.scene.battle.battle.effect.DamageEffectView$` | `unitPrefix(param1:Number):String` | 新增 `t`（`>=1e13`）、`b`（`>=1e10`）、`m`（`>=1e7`）三档格式化分支 |
| P6-2 | `pinball.scene.battle.battle.effect.DamageEffectView$` | `resolvePath(param1:String):String` | 映射 `'m'` / `'b'` / `'t'` 到 `battle/common/layer1/damage_font/unit_prefix_{m,b,t}` |
| P6-3 | `pinball.scene.battle.battle.effect.DamageEffectView` | `createSprite(param1:ViewAssetContainer, param2:Number):DisplayObject` | 末尾为 `m/b/t` 时将数字与小数点染为青/粉/紫档位色，单位字母设 `0xFFFFFF` |
| P6-4 | `pinball.scene.battle.battle.effect.AccumulationDamageIndicatorView` | `createDigit():MovieClip` | 向数字纹理数组追加第 13、14、15 帧（`unit_prefix_m/b/t`） |
| P6-5 | `pinball.scene.battle.battle.effect.AccumulationDamageIndicatorView` | `updateDigits(param1:Number):void` | 支持 `'m'->12`、`'b'->13`、`'t'->14` 帧映射与整串数字档位色覆写 |
| P7 | `pinball.scene.battle.battle.effect.DamageIndicatorManager` | `wfxMergeDamage(...)` | `lightweightModeLevel >= 1 && info.createdByDirectAttack` 时将单目标独立跳字上限置为 `0` |
| P8-1 | `pinball.scene.battle.battle.squad.ball.BallImpl` | `wfxFindDashEnemy():Enemy` | 跳过 `!zone.bounds.contains(posX, posY)` 的场外目标 |
| P8-2 | `pinball.scene.battle.battle.squad.ball.BallImpl` | `wfxTryDashReplacement(param1:EscapeTarget):Boolean` | `wfx_dash_v2` 且 `wfxFindDashEnemy() == null` 时静默返回 `true` |

## 开关或数据写法

- **P1–P4、P6、P8**：常驻生效，无需配置表开关。
- **P5、P7**：受游戏内设置「轻量模式」（`battle.lightweightModeLevel >= 1`）控制。
- **APK 内置图集同步（必做）**：打包 APK 时须运行 `bundle_m_glyph.py` 将 `assets/bundle.zip` 内的 `battle/common/layer1` 图集更新为含 `unit_prefix_m/b/t` 的版本并重算 `bundle.zip.sha1`，否则打出 `>= 1000 万` 伤害时会触发 C8004 缺纹理报错。

## 依赖的前置补丁

- `139-dash-v2-safe-landing`（提供 `BallImpl/wfxFindDashEnemy` 与 `wfxTryDashReplacement`）
- `146-client-perf-presentation`（提供 `DamageIndicatorManager/wfxMergeDamage` 与 `EffectManagerImpl/show` `hitbudget`）

## 对应的数据边

- `1.4.340`（`balance-1022/patch340`）`battle/common/layer1` 的 `unit_prefix_m/b/t` 伤害数字单位字形资源边

## 已知限制

- 必须同步替换 APK 内置 `assets/bundle.zip` 中的 `layer1` 图集（内置 bundle 优先级高于 CDN 下发资源）。

来源工作区：<WORKDIR>/outputs/work/coop-hide-mate-fx-20261027
