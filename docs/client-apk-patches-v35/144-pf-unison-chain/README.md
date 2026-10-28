# 144 合击强化弹射通用化（wfx 码 36）

- 首发版本：v35l / 1008011（run12，离线候选与测试服构建）
- capability：`pf-unison-chain-v1`（wfx 效果码 36）
- 依赖前置补丁：112（`wfx-effect-query-v1`，`ConditionSlot.wfxRows` 查询）、120/134/137（`wfx_unlock_*` 合击队长技解锁）、153（P-a `HitCountCheck.matchTrial` 底包输入）
- 对应数据边：水属性杰拉德等角色数据边（`rel-1.4.265`–`1.4.273` 中 `unique_condition` 与 `leader` 表对应行）

## 作用

当主位成员持有 `wfx:36` 固有状态且编入合击角色时，在主位发动强化弹射（PowerFlip）后同帧自动追加一次同等级的合击位强化弹射。支持隔离主位与合击位的 `PowerFlipOverride` 来源，优先采用合击位自身生效的专属 PF 覆盖，若无则回退至合击角色特技类型（`unisonSpecialityType`）对应的通用 PF 动作；同时支持按是否处于 Fever 状态分别缩放合击 PF 链造成的普通/比例/固定伤害，并协调配对动作的球移动与压制生命周期、补齐合击 PF 资源预载。

## 改动类与方法

- **覆盖来源隔离（`BattleAbilityTotalizerImpl`）**：修改 `applyInstantCommonContent`、`addDuringContent`，新增 `wfxPfRecordInstant`、`wfxPfRecordDuring`、`wfxPfSelect` 及静态弱键表 `wfxPfOriginMap`，按 `memberIndex << 16 | originMemberKind` 记录覆盖来源。
- **发动与合击链执行（`MemberImpl`）**：修改 `startPowerFlip`，新增 `wfxPfCode36Spec`、`wfxPfMainOverride`、`wfxPfChainExecute`，在主位 PF 执行后追加同档位合击 PF（地址 `AbilitySkill(count, Initial(-36, memberAddress, true))`，属性取持有者当前 `source.element`）。
- **Fever/平时伤害倍率（`ActionEvaluator` / `ImpactCalculator`）**：修改 `ActionEvaluator/addImpactToSubject`、`NormalAttackCalculator/_calculate`、`RatioAttackCalculator/calculate`、`FixedAttackCalculator/calculate`，新增 `ActionEvaluator/wfxPfStampDamage` 与 `NormalAttackCalculator$/wfxPfScaleDamage`。
- **生命周期与球移动仲裁（`ActionEvaluator`）**：修改 `evalCommand`、`dispose`，新增 `wfxPfPairedContext`、`wfxPfMovementFrames`、`wfxPfLifecycleCommand`、`wfxPfRestoreMovement`。
- **资源预载（`BattleCharacterLogic` / `BattlePartyLogic` / `CommonAbilityContentTools`）**：修改 `BattleCharacterLogic/resolvePathCollection`、`BattleCharacterLogic/wfxPreloadExtraLeaders`、`BattlePartyLogic/resolvePathCollection`、`CommonAbilityContentTools$/resolvePathCollection`，新增 `wfxPfHasCode36`、`wfxPfPreloadUnison`、`wfxPfPreloadFinish`。

## 开关与数据写法

- 数据表 `unique_condition.c0` 写法：`wfx:36:<arg>:<value>:<flags>:<label>`（例如 `wfx:36:0:20000:10000:hidden_wg_aqua_unison_pf`）。
- `arg & 1 == 1` 时忽略合击专属覆盖、强制使用合击角色类型 PF；`value` 为 Fever 下合击链伤害万分比（`<=0` 视为 `10000`），`flags` 为非 Fever 下合击链伤害万分比（`<=0` 视为 `10000`）；`label` 以 `hidden_` 开头时复用 131 规则隐藏状态图标。

## 最终 P-code

- [ActionEvaluator/addImpactToSubject](pcode/ActionEvaluator__addImpactToSubject.pcode.txt)；文件 SHA256 `4d88772060f817c64bbdb4a96538e12c8ed75aede04e8544177d4a1cc5ef79f4`（`ActionEvaluator/addImpactToSubject header=[20, 18, 1, 2] sha=767a5eb2543e351d0ed91e5384698518761b238dd60254731459129a6712e24c`）。
- [ActionEvaluator/dispose](pcode/ActionEvaluator__dispose.pcode.txt)；文件 SHA256 `5b7233bad67e405a0edb2c410bbac852a936b2ea631efdaaac27116da733d73a`（`ActionEvaluator/dispose header=[2, 2, 1, 2] sha=d3c5f25d9a6539f114607a796ca735ce216d889418d05116b433c5ed12525912`）。
- [ActionEvaluator/evalCommand](pcode/ActionEvaluator__evalCommand.pcode.txt)；文件 SHA256 `c754b9a53ce41c75a82d024647cf781962405dd2ba95c8b939eb40c3b5333b35`（`ActionEvaluator/evalCommand header=[109, 191, 1, 2] sha=d9d51acfca4a12127b13cc87f3d2f0b4e7d69978ffc418e1c9c3220e43c2f95b`）。
- [ActionEvaluator/wfxPfLifecycleCommand](pcode/ActionEvaluator__wfxPfLifecycleCommand.pcode.txt)；文件 SHA256 `534bcdd51e35d0d471d74910f5404b5a819ef97e1f7be4379fdc0c620476164e`（`ActionEvaluator/wfxPfLifecycleCommand header=[3, 9, 1, 2] sha=6dfccea544b517b88e0b8e3e6cf722a7dd670ca8b50c78acecc3cc937e179235`）。
- [ActionEvaluator/wfxPfMovementFrames](pcode/ActionEvaluator__wfxPfMovementFrames.pcode.txt)；文件 SHA256 `802593e625e0f7d5a16847809e3832f43e7c5e9ad0f5433c08b37339c890be2e`（`ActionEvaluator/wfxPfMovementFrames header=[2, 7, 1, 2] sha=8ea8a53f81a2e5a8f04b5f233c25019d9e83e549aa3c2ccccccedaef1942cceb`）。
- [ActionEvaluator/wfxPfPairedContext](pcode/ActionEvaluator__wfxPfPairedContext.pcode.txt)；文件 SHA256 `af188450419e04089e567605731eb024563db5a15e262a007888de93955edf60`（`ActionEvaluator/wfxPfPairedContext header=[2, 2, 1, 2] sha=bd46a4ce20155579878c8369d7d86253a0d1a1c5d29069293b8bd0b3102f6a5c`）。
- [ActionEvaluator/wfxPfRestoreMovement](pcode/ActionEvaluator__wfxPfRestoreMovement.pcode.txt)；文件 SHA256 `3888a0c18e8acadf032052db7800c5b9d8c7c5f02551b9ea1d4ddbe8a287762e`（`ActionEvaluator/wfxPfRestoreMovement header=[4, 8, 1, 2] sha=1195b7cc18829f9473fbab9ff7b49bef0787bb716841f002830c0657eb28b5eb`）。
- [ActionEvaluator/wfxPfStampDamage](pcode/ActionEvaluator__wfxPfStampDamage.pcode.txt)；文件 SHA256 `889c42a1bb6fcb590fee2a1f93dab16dc72d5687c4b9797908288bdbc831595f`（`ActionEvaluator/wfxPfStampDamage header=[2, 4, 1, 2] sha=a65c87f55cc1f05529caa87276000f8e41fcd510a5854c6366da2a9eaba7317b`）。
- [BattleAbilityTotalizerImpl/addDuringContent](pcode/BattleAbilityTotalizerImpl__addDuringContent.pcode.txt)；文件 SHA256 `34f44877e6d279eb37001f67c57599ad9bb568b40454326f741730d02d031c7c`（`BattleAbilityTotalizerImpl/addDuringContent header=[9, 7, 1, 2] sha=206dd327e6fc77c0cc926dfab1bac9a6dfcdea076d41304f49a1744ab69c4765`）。
- [BattleAbilityTotalizerImpl/applyInstantCommonContent](pcode/BattleAbilityTotalizerImpl__applyInstantCommonContent.pcode.txt)；文件 SHA256 `a40761525d014bc8514fd8e502ba2faa00348cae7657c07fd60fbc39961c2bac`（`BattleAbilityTotalizerImpl/applyInstantCommonContent header=[8, 20, 1, 2] sha=adabf39bc5daaa30687aa705d75a3d3442aaf8e78a5d50f9e96e8782b5f54e43`）。
- [BattleAbilityTotalizerImpl/wfxPfLedger](pcode/BattleAbilityTotalizerImpl__wfxPfLedger.pcode.txt)；文件 SHA256 `1db4121e77cf368ccecd221218d80dff80840711c1bd8928e85dcb8f2005628c`（`BattleAbilityTotalizerImpl/wfxPfLedger header=[3, 3, 1, 2] sha=deb4ee93f0d63751f8bd7c0ef078da4418739b8b79159762e0bc47885f8c93d5`）。
- [BattleAbilityTotalizerImpl/wfxPfRecord](pcode/BattleAbilityTotalizerImpl__wfxPfRecord.pcode.txt)；文件 SHA256 `5ece2a1cd07f6ceb438636c95e4e8e582f1b417dadff75a4f590e30434a14e61`（`BattleAbilityTotalizerImpl/wfxPfRecord header=[5, 8, 1, 2] sha=3f4256e0843c8b04c97add9b23a26196852a40a5c62d59fec27ef74e6348e648`）。
- [BattleAbilityTotalizerImpl/wfxPfSelect](pcode/BattleAbilityTotalizerImpl__wfxPfSelect.pcode.txt)；文件 SHA256 `ee2ac7d72031dc9f332c28914a0489c1a6b543db6a02958f110c6cbd9cca403d`（`BattleAbilityTotalizerImpl/wfxPfSelect header=[2, 9, 1, 2] sha=8ea7f72cab91444c78f8f2536daee89f7c134f7053fc779a4c6a71570adb34a5`）。
- [BattlePartyLogic/resolvePathCollection](pcode/BattlePartyLogic__resolvePathCollection.pcode.txt)；文件 SHA256 `6ec224a6658a5f5363e8fe66a64c5a7a1347d1c1ce13a6ec6fb89a530963b440`（`BattlePartyLogic/resolvePathCollection header=[6, 10, 1, 2] sha=1560d620443cad58868b5cca0ae64b403f9974be3cb1a196308883040ac8363e`）。
- [BattlePartyLogic/wfxPfPreloadAbility](pcode/BattlePartyLogic__wfxPfPreloadAbility.pcode.txt)；文件 SHA256 `2f0e6cc6c9facf206cc48480ddd2020de6e188a3947adc868e7529a470339e1f`（`BattlePartyLogic/wfxPfPreloadAbility header=[7, 8, 1, 2] sha=62f35098f314019f486c68def98a90c557cb10ed8e8c915e2dcbb1ab93c055b2`）。
- [BattlePartyLogic/wfxPfPreloadFinish](pcode/BattlePartyLogic__wfxPfPreloadFinish.pcode.txt)；文件 SHA256 `ce613dc61f008609520d8a5f308e40273bde4fbc9c6d263b5369360146d90209`（`BattlePartyLogic/wfxPfPreloadFinish header=[6, 11, 1, 2] sha=ba9e1c109c7b6dd9f20fb35cd4ad0f999fd8f74ab7b66b3b19d6ca593ff6daa5`）。
- [BattlePartyLogic/wfxPfPreloadType](pcode/BattlePartyLogic__wfxPfPreloadType.pcode.txt)；文件 SHA256 `36635f7d11f12e30c643f2a0beffcfbfb74f0323b2618f8e97060476773b6a01`（`BattlePartyLogic/wfxPfPreloadType header=[3, 6, 1, 2] sha=37330f3df95c7a3d728c17bba7da8b6f4949717c9bc0d303653543d5f81165d2`）。
- [ConditionSlot_static/wfxSpec](pcode/ConditionSlot_static__wfxSpec.pcode.txt)；文件 SHA256 `85f34848bfb8ca94337e9752454e7d986b3fdba0f8f741764f467e188a8e5d5e`（`ConditionSlot$/wfxSpec header=[5, 9, 1, 2] sha=7b6dda3fdfd5f0704a0c02c6c4306eba136e109f130a65fba38432ed4fcd7936`）。
- [FixedAttackCalculator/calculate](pcode/FixedAttackCalculator__calculate.pcode.txt)；文件 SHA256 `6bf76576e5ce1d5d2b3760b0ca74256d02537d54ca80db9b661ca600618176a2`（`FixedAttackCalculator/calculate header=[90, 13, 1, 1] sha=f2a805037012569cf8a3e1e9b08e28a7b75ca42956f5d6468c99968cf9b58c38`）。
- [MemberImpl/startPowerFlip](pcode/MemberImpl__startPowerFlip.pcode.txt)；文件 SHA256 `33ba32218668856897195d8c70b77b8901e2b5823ea98c75cbf7a179d0d531ef`（`MemberImpl/startPowerFlip header=[27, 21, 1, 2] sha=64e4b7fdcbd0b55bec3bd627b34257655e0e6972b2a615320ef24d934cfa7e1b`）。
- [MemberImpl/wfxPfChainAddress](pcode/MemberImpl__wfxPfChainAddress.pcode.txt)；文件 SHA256 `d26aa9a63c9a8cfec80e752789538ef5b6223e25d7cce4f3d768e80f1786578c`（`MemberImpl/wfxPfChainAddress header=[6, 2, 1, 2] sha=48344dec5f8224fe99a3543045c75c920e729f68336b8f07a94ff92a511a8860`）。
- [MemberImpl/wfxPfChainExecute](pcode/MemberImpl__wfxPfChainExecute.pcode.txt)；文件 SHA256 `be15a3bb25ba7769d3bdd6e492dcf0c42c899297c8e783dcac7b51b58f5b66c4`（`MemberImpl/wfxPfChainExecute header=[28, 11, 1, 2] sha=4a836087a9086f07c4cc04603e653a26de212d60cc8ca61f9b1346f7ddcc2d7c`）。
- [MemberImpl/wfxPfConfig](pcode/MemberImpl__wfxPfConfig.pcode.txt)；文件 SHA256 `6e946735a55aae546b225c553314b3a17c3bcb32fe36e7b06c2b16d0ec2760c2`（`MemberImpl/wfxPfConfig header=[3, 4, 1, 2] sha=8228f91f82cf370ec127496d4b129d59c3a04dc0add8c562b6ccb0c4c6d32671`）。
- [MemberImpl/wfxPfEnabled](pcode/MemberImpl__wfxPfEnabled.pcode.txt)；文件 SHA256 `16715a817f9dd612fa52d7bfb5a83585a47c019ad5d1a8f50de292461cbcabe9`（`MemberImpl/wfxPfEnabled header=[1, 1, 1, 2] sha=c86f9c86d311918de2c81f67dde5e13fbb12743942267c5c0f43eb68a6fc3797`）。
- [MemberImpl/wfxPfMainOverride](pcode/MemberImpl__wfxPfMainOverride.pcode.txt)；文件 SHA256 `ad23592d260a5d9f9a2c99a2f61dd26ba3e70f4c653b16328d0e314393a8d6b4`（`MemberImpl/wfxPfMainOverride header=[4, 3, 1, 2] sha=2b72e44d4c7d23d9b08f2ed12121c297d75608d6dbbbdde4b2ea10c8a7faa1df`）。
- [NormalAttackCalculator/_calculate](pcode/NormalAttackCalculator___calculate.pcode.txt)；文件 SHA256 `efeaac07fc76a88745ce5d30cf7391a45c12cc49d9115a49ecffe99d213f69ac`（`NormalAttackCalculator/_calculate header=[90, 131, 1, 2] sha=0ab03cde5caacf2cebb9b3d60f9c9df9b9615891ef21168c52e2459bfe07114f`）。
- [NormalAttackCalculator_static/wfxPfScaleDamage](pcode/NormalAttackCalculator_static__wfxPfScaleDamage.pcode.txt)；文件 SHA256 `503d315a1f01182662e18202915f1781ba30d62a7d26782d6014013fb9b1c394`（`NormalAttackCalculator$/wfxPfScaleDamage header=[3, 4, 1, 2] sha=3597dfb551802be13e16218be444a5aea704a4156bd3f5c5763f5c5063514b7b`）。
- [RatioAttackCalculator/calculate](pcode/RatioAttackCalculator__calculate.pcode.txt)；文件 SHA256 `b1826860c1c069a17fff193261ea13275430b3f11c1545fc6a0081ef44ea2403`（`RatioAttackCalculator/calculate header=[90, 13, 1, 1] sha=b64a2efc5779e801265b8ba9ff0bb16832743c7e65d81b7057414f29723cf6ec`）。
- [UniqueConditionLogic/wfxSuperPreload](pcode/UniqueConditionLogic__wfxSuperPreload.pcode.txt)；文件 SHA256 `1fb374b9c5dc15ee7e069f8d2d83c37e568c9bff437442b9b5ffd3071822e5f1`（`UniqueConditionLogic/wfxSuperPreload header=[5, 6, 1, 2] sha=532d4fa85d708060156c2ac0334b16110d68f752122fa7aa94e561a19cac2ef3`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `fbae997d0a209109b785e521c300a013df47e199328fd2412c5dfa1106b26853`。
- [build.py](source/build.py) ← `build.py`；SHA256 `a052c61d654d4760b93d0d4b132576ddfae3f04a06f9444c1efa670eacffe213`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `2d4862f42b9a0c452a0e0b9cf1f7974630473590171a7c7bb36b481e1ad97082`。
- [integrity.py](source/integrity.py) ← `integrity.py`；SHA256 `7103f04b17d3598682996a38ae10748030dfec5ac06c193586242a8f56a0b69c`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。
- [chain/config.py](source/chain/config.py) ← `chain/config.py`；SHA256 `960fd1078c572c4f1c213f39bf874a577dcdc79a09a5271e65d89162d6bb7548`。
- [chain/patch.py](source/chain/patch.py) ← `chain/patch.py`；SHA256 `13af783d2d3673d210c8d66d984f4a6a67cc678d5a9d4a4cfbf7fc29dbd5ddc8`。
- [damage/patch.py](source/damage/patch.py) ← `damage/patch.py`；SHA256 `ea0b1f9b3b1f0fe254fbc798dfa8d2b883b721cb652e51602fd95c1c0b19c799`。
- [lifecycle/address.py](source/lifecycle/address.py) ← `lifecycle/address.py`；SHA256 `bae004b6a602e9ff546bcfcadf35a18d1657b3bae0eab2eae3edd40f52d26a90`。
- [lifecycle/movement.py](source/lifecycle/movement.py) ← `lifecycle/movement.py`；SHA256 `f77c48cb82c732781f6286ba9f224a655ed83477ac114869c284529c3c834402`。
- [lifecycle/patch.py](source/lifecycle/patch.py) ← `lifecycle/patch.py`；SHA256 `d81a576b1f4d6d3ebb65449382351c0b935bc81be35bca0f1e97e3c050f86344`。
- [override/patch.py](source/override/patch.py) ← `override/patch.py`；SHA256 `32c9939637d26643dffc9a50e9eff3f7637f20c13a938d908fab5e8d09e7bdfe`。
- [preload/patch.py](source/preload/patch.py) ← `preload/patch.py`；SHA256 `87b6c5011d0a1efd491891e37fa4577ff51a474b9ec16d2d0ac7716877d9a41f`。

## 已知限制与验收边界

- 原生主位与合击位共用 `Member` 状态槽，`Condition` 不区分主/合击施加来源；数据侧需通过 `202` 或主位前置确保码 36 仅在预期主位上挂出，且需移除旧数据树中手工硬编码枚举的合击 PF 分支以免重复触发。
- 离线字节码解释与受控夹具验证通过（测试服输出 SWF SHA256 `48e9eaf76b5d7e3a822a440f36c47056d98bfeeebebd7978ca13371c0facdb1a`）；真实联机混版与完整 AIR 画面表现待核。

来源工作区：`<WORKDIR>/v35-generic-20261018/run12`（任务书 `<WORKDIR>/v35-generic-20261018/TASK12.md`）
