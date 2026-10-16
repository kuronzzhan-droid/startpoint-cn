# 37 八岐大蛇阶段血量弱点与同步运行时

按机制配置建立阶段伤害账本，维护弱点伤害窗口、阶段生命值和联机快照恢复。

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`cn.boss.BossMechanicsRuntime/*`；`OrochiExValues/<ctor>`；`OrochiEx/ensurePhase4Ledger`；`OrochiEx/resolvePhase4Break`；`OrochiEx/updatePhase4Extension`；`OrochiEx/reinitialize`；`OrochiEx/getSynchronizeKind`；`OrochiEx/changePhase`；`OrochiEx/applySynchronizeKind`；`OrochiEx/subtractHealthPoint`；`OrochiEx/ensurePhaseDamageLedger`；`OrochiEx/*`；`OrochiExSource/*`；`OrochiExValues/*`；`EnemySynchronizeOwnerKind/*`；`ZoneSourceValues/resolveOrochiExsAction`；`ZoneSource/get_bossGroupName`。
- 修的问题或错误码：具体bug未核实，现存Android构建器只转换已验收LAN载荷
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：原始可重建补丁仅留整份 SWF 二进制载体，按规则未收；本目录有只读提取的最终方法文本，不能视作完整源码恢复。

原 Android Boss 改写源码缺失；只收最终 helper 和相关 owner 的逐方法 P-code、现存公网转换脚本。原构建以已验收 LAN 整份 SWF 为输入；该二进制载体未收。P-code 不能替代新增类、字段和完整重建信息，完整从官方底包重建仍未核实。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\orochi-boss\README.md:7-15`
- `D:\WF\apkp1016\research\early_r8_boss.json:boss.exact_main_hooks`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- `D:\WF\startpoint-cn-kulo\client-patch\orochi-boss\build_public_android.py:1-6,18-39`
- `D:\WF\startpoint-cn-kulo\client-patch\orochi-boss\prepare_ios.py:131-149（仅 owner 范围旁证，非 Android 应用顺序）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BossMechanicsRuntime$/integer](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__integer.pcode.txt)；body `0`；code SHA-256 `edf97da5d5bffd1e12613ea05be0dec2f2ab84712ac765b7c35c721095cbcc2f`。
- [BossMechanicsRuntime$/profile](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__profile.pcode.txt)；body `1`；code SHA-256 `7eb9ddb25dfb14622f8661294ff673ad9ebd8928da058bba3b4f1c636fbeec78`。
- [BossMechanicsRuntime$/create](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__create.pcode.txt)；body `2`；code SHA-256 `34b8c8e5dc860c47eb2bdc052f298949ebbae004e5c2c6b019bbc45e9f44331d`。
- [BossMechanicsRuntime$/reset](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__reset.pcode.txt)；body `3`；code SHA-256 `790acc11361669af09525245dfb01f406eb44855b7ef82855e0d6b3d9600f20b`。
- [BossMechanicsRuntime$/currentSegmentMaximum](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__currentSegmentMaximum.pcode.txt)；body `4`；code SHA-256 `7d2d7ed7522c92ef16ed3784a2cb4bc4dab23cd078d2bc29ca43f16624a016f4`。
- [BossMechanicsRuntime$/currentSegmentComplete](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__currentSegmentComplete.pcode.txt)；body `5`；code SHA-256 `189fa25c1512c6fed2eebee5acc6c77cba8822e5cace81b3dbb88e62d5ea6885`。
- [BossMechanicsRuntime$/complete](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__complete.pcode.txt)；body `6`；code SHA-256 `935b1839567246600555d0b18384ba672eec48df19be70e45b685fdaa00b9d63`。
- [BossMechanicsRuntime$/remaining](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__remaining.pcode.txt)；body `7`；code SHA-256 `9b8150a996a0dd7dfa574b595e8921ae2af6885a587f23730f8f97983f66a2b5`。
- [BossMechanicsRuntime$/accept](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__accept.pcode.txt)；body `8`；code SHA-256 `14669b70ba5eef235f09db03c11829669dc96acbe8f27a22546b521a8e87d3a9`。
- [BossMechanicsRuntime$/advanceSegment](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__advanceSegment.pcode.txt)；body `9`；code SHA-256 `edb57f18091bb6356a0ce359624112157195d6a45e9f8cbe804676ec6e0e32dd`。
- [BossMechanicsRuntime$/targets](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__targets.pcode.txt)；body `10`；code SHA-256 `d52724eb72a1997235ea70d289a27a261b31998c047d3b3db2cf473332a8dffe`。
- [BossMechanicsRuntime$/tick](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__tick.pcode.txt)；body `11`；code SHA-256 `bdea24437d773d8bb43549b04566a63d0d9e078e91db8b7fa660d199a610e8f3`。
- [BossMechanicsRuntime$/snapshot](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__snapshot.pcode.txt)；body `12`；code SHA-256 `45e949c987335e23af313d175d6a8170e0344240b8dc70789b3392411f61c3c8`。
- [BossMechanicsRuntime$/restore](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__restore.pcode.txt)；body `13`；code SHA-256 `cebc74e8c09b19bb91d2f9921c3d63fb0ce8a8fee272fdaa96e73488db16a5f6`。
- [BossMechanicsRuntime$/<cinit>](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime___cinit_.pcode.txt)；body `14`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [BossMechanicsRuntime/<ctor>](pcode/cn.boss.BossMechanicsRuntime--BossMechanicsRuntime__ctor_.pcode.txt)；body `15`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.boss.BossMechanicsRuntime--anonymous-method-0.pcode.txt)；body `16`；code SHA-256 `88c053ef50955c035114ba76dadfa367a9919ff8b8c411833b3c9a8a6f357566`。
- [OrochiExValues/<ctor>](pcode/boot_ffc6--OrochiExValues__ctor_.pcode.txt)；body `92450`；code SHA-256 `41e2e27ed7206a7e712b7ddfb2fd8a68a9491bacd9c9f3da7cbd3456732c1755`。
- [OrochiEx/ensurePhase4Ledger](pcode/boot_ffc6--OrochiEx_ensurePhase4Ledger.pcode.txt)；body `92481`；code SHA-256 `e636af5a929a6d259eaae4630e89ca8468d7236009002845dca2e87220d1e0e7`。
- [OrochiEx/resolvePhase4Break](pcode/boot_ffc6--OrochiEx_resolvePhase4Break.pcode.txt)；body `92488`；code SHA-256 `3d354b593e4fcda48d464533e7378799c7ad91179647b1ff0f3376441ff3aa88`。
- [OrochiEx/updatePhase4Extension](pcode/boot_ffc6--OrochiEx_updatePhase4Extension.pcode.txt)；body `92489`；code SHA-256 `485da7950c4ccbf716c757392019122a7fe9c50c82708b104c37c90f51f69e0d`。
- [OrochiEx/reinitialize](pcode/boot_ffc6--OrochiEx_reinitialize.pcode.txt)；body `92493`；code SHA-256 `9746c5ad87816d480b112a479083fbb37bf04c5e302d5dd8922a7215faab0b2f`。
- [OrochiEx/getSynchronizeKind](pcode/boot_ffc6--OrochiEx_getSynchronizeKind.pcode.txt)；body `92526`；code SHA-256 `3ce9520e3211b40669016a43de0fd950bc982f29dfcbf0f9d90315d2de5c6260`。
- [OrochiEx/changePhase](pcode/boot_ffc6--OrochiEx_changePhase.pcode.txt)；body `92559`；code SHA-256 `1ca1a185adbec74ea6803ae4cfe60e1620fd0f1ef4dcfe97f6b9f3ff93c5cdbc`。
- [OrochiEx/applySynchronizeKind](pcode/boot_ffc6--OrochiEx_applySynchronizeKind.pcode.txt)；body `92564`；code SHA-256 `2efb7a8f2676390a87a2a3bbdef27d52bd29d40fd53f2389cfc77ee8df582eaf`。
- [OrochiEx/subtractHealthPoint](pcode/boot_ffc6--OrochiEx_subtractHealthPoint.pcode.txt)；body `92566`；code SHA-256 `9755480bf06a7a5e401f5951f9ec41a372c2e62cea560d9e7bf271541b2430bf`。
- [OrochiEx/ensurePhaseDamageLedger](pcode/boot_ffc6--OrochiEx_ensurePhaseDamageLedger.pcode.txt)；body `92591`；code SHA-256 `a085f7fe75c3f1456d2cdb05cda4452d2fa4d86640147281f7b9015865c661c9`。
- [OrochiEx/<ctor>](pcode/boot_ffc6--OrochiEx__ctor_.pcode.txt)；body `92579`；code SHA-256 `5f6b45d97a1fed23669c25faa46794deb6d16f62d40b2fc323c9f325c96ee039`。
- [OrochiEx/willRemoveUniqueState](pcode/boot_ffc6--OrochiEx_willRemoveUniqueState.pcode.txt)；body `92469`；code SHA-256 `2a1a7d3128f19cb89d478c83dbe69ee3d79bad6134d51daecf58fc6816ffe6a7`。
- [OrochiEx/updateWeakPointCountdownPosition](pcode/boot_ffc6--OrochiEx_updateWeakPointCountdownPosition.pcode.txt)；body `92470`；code SHA-256 `1ece3d2e7b10baf2ce82e598cb059ca95a9b7e20887c1250bf309e1cfadd39d1`。
- [OrochiEx/updateWeakPointCountdown](pcode/boot_ffc6--OrochiEx_updateWeakPointCountdown.pcode.txt)；body `92471`；code SHA-256 `485a19874d075b3ee741eb793fdbab482aacf12803b6ddc3cd5da273335ddd25`。
- [OrochiEx/updateUniqueState](pcode/boot_ffc6--OrochiEx_updateUniqueState.pcode.txt)；body `92472`；code SHA-256 `525c1b49eb9d28795367d227ac422eebcaac4399e9bfbb9666c986e45556ccbf`。
- [OrochiEx/updateTrialCondition](pcode/boot_ffc6--OrochiEx_updateTrialCondition.pcode.txt)；body `92473`；code SHA-256 `02212353e29928a227c693aeb1ad64297ea09e3ee4a7ec965fd72fbb1d194d07`。
- [OrochiEx/isPhase2TrialGuardReleased](pcode/boot_ffc6--OrochiEx_isPhase2TrialGuardReleased.pcode.txt)；body `92474`；code SHA-256 `cc0bf64a782325cc60aa7d3657d17b6a60a1131ad580a762bb8a87bfbc825fb6`。
- [OrochiEx/isPhase2TrialStunRunning](pcode/boot_ffc6--OrochiEx_isPhase2TrialStunRunning.pcode.txt)；body `92475`；code SHA-256 `ae0bee4df90a968fd018e0cada9905ddd387e536a7372c370b02af7ed67e671e`。
- [OrochiEx/canAdvanceFromPhase2](pcode/boot_ffc6--OrochiEx_canAdvanceFromPhase2.pcode.txt)；body `92476`；code SHA-256 `c6b3929cb480976b82748a43e354dbda0d46221a7dec9a2064d64c76ccd33d9b`。
- [OrochiEx/update](pcode/boot_ffc6--OrochiEx_update.pcode.txt)；body `92477`；code SHA-256 `a092937706f8ac6665ce0a83c857f54de6c4df0fd93aed070934444fbf4821a5`。
- [OrochiEx/hasPhase4HealthMode](pcode/boot_ffc6--OrochiEx_hasPhase4HealthMode.pcode.txt)；body `92478`；code SHA-256 `195868905a7cf59d0b060dd858076ff93447d692cec99135e50086d08878816f`。
- [OrochiEx/phase4HealthRaw](pcode/boot_ffc6--OrochiEx_phase4HealthRaw.pcode.txt)；body `92479`；code SHA-256 `e94ea1d7ea4f3390194951ce156abfd4ee20022ec76eaea4b16f4556a3700231`。
- [OrochiEx/phase4Profile](pcode/boot_ffc6--OrochiEx_phase4Profile.pcode.txt)；body `92480`；code SHA-256 `42dfb2e755682cf1365464d5902023e93b49aef51f0b38bf7f31162769c65a3f`。
- [OrochiEx/phase4DamageRate](pcode/boot_ffc6--OrochiEx_phase4DamageRate.pcode.txt)；body `92482`；code SHA-256 `3a1f53d85f2d85a76d29f173b5f89c42ebd28860ed0dfb8aa3908b00567ca6d3`。
- [OrochiEx/isPhase4AttackRunning](pcode/boot_ffc6--OrochiEx_isPhase4AttackRunning.pcode.txt)；body `92483`；code SHA-256 `5b5f3b9a3dba84237e3175b8d5e813181020b6b684695b64c2b389dd7326c6be`。
- [OrochiEx/countBrokenWeakPoints](pcode/boot_ffc6--OrochiEx_countBrokenWeakPoints.pcode.txt)；body `92484`；code SHA-256 `358fc2bad0dd52e3113d9e48630a458432720ecf960214b4c5754764fcc1e36e`。
- [OrochiEx/resetAllWeakPoints](pcode/boot_ffc6--OrochiEx_resetAllWeakPoints.pcode.txt)；body `92485`；code SHA-256 `1d41aba8473a93ae61e2688b69bf5c23e7eafe60ab2dc9c0a2ff9732fc2e1e89`。
- [OrochiEx/enterPhase4AwakeState](pcode/boot_ffc6--OrochiEx_enterPhase4AwakeState.pcode.txt)；body `92486`；code SHA-256 `c4ad77a5770d83f89b5dc8f8b4ef8c15741591358321f2206dbfa18a0125212f`。
- [OrochiEx/startPhase4Reset](pcode/boot_ffc6--OrochiEx_startPhase4Reset.pcode.txt)；body `92487`；code SHA-256 `6fcc9ff7d9831e682e3a3ba9c6e1f3b82129372402279660ce6ac922ced7f08a`。
- [OrochiEx/resolveUniqueStateGroupKeyFromOwnerKind](pcode/boot_ffc6--OrochiEx_resolveUniqueStateGroupKeyFromOwnerKind.pcode.txt)；body `92490`；code SHA-256 `5db4ca3d81b709bff215ca555853ef64a41fea62e09e90469e0a8eef06154b68`。
- [OrochiEx/resolveUniqueStateGroupKey](pcode/boot_ffc6--OrochiEx_resolveUniqueStateGroupKey.pcode.txt)；body `92491`；code SHA-256 `d83cbbce5a4095bffe56658b98d3be1f307ba1b14180cf20ac43b0ed83da4295`。
- [OrochiEx/resolveCollision](pcode/boot_ffc6--OrochiEx_resolveCollision.pcode.txt)；body `92492`；code SHA-256 `d3ea97c8f672f072c308bfa1b7e20e75da4e96a11ffbb3892dc8c03c035c77a5`。
- [OrochiEx/once](pcode/boot_ffc6--OrochiEx_once.pcode.txt)；body `92494`；code SHA-256 `951584dbaae5e3471b7b3c8ce6f4c6415a4c1dc9868761afd955bfcb10ff6298`。
- [OrochiEx/numUniqueStateFrames](pcode/boot_ffc6--OrochiEx_numUniqueStateFrames.pcode.txt)；body `92495`；code SHA-256 `dc4ac528c3eed95c9c1d9fa1e38399c80f8472f677c322e2ed77946307030ee0`。
- [OrochiEx/numNormalStateFrames](pcode/boot_ffc6--OrochiEx_numNormalStateFrames.pcode.txt)；body `92496`；code SHA-256 `04f3a97fd2b6dc3f6b20a7b05082f1ba22e5d048348c91ee04d144574d707dfc`。
- [OrochiEx/numIdleStateFrames](pcode/boot_ffc6--OrochiEx_numIdleStateFrames.pcode.txt)；body `92497`；code SHA-256 `cdb719272bd3fce4d128134ff0cfffa605a9d27c420382f78b34331d0e260e9a`。
- [OrochiEx/numAttackStateFrames](pcode/boot_ffc6--OrochiEx_numAttackStateFrames.pcode.txt)；body `92498`；code SHA-256 `d257fee65c5a14bb0d52787e1709a457cdc60765448caed73818b7b0d51b4c76`。
- [OrochiEx/moveUniqueState](pcode/boot_ffc6--OrochiEx_moveUniqueState.pcode.txt)；body `92499`；code SHA-256 `e81b92f78055771191100a2c21a365aaf3710fcb7e219ef7820474d004c5de18`。
- [OrochiEx/move](pcode/boot_ffc6--OrochiEx_move.pcode.txt)；body `92500`；code SHA-256 `2d2ad36165bbf997321c09e4ce180fd2b317eafb3df24a9d24ac53c54ec5bccd`。
- [OrochiEx/matchTrial](pcode/boot_ffc6--OrochiEx_matchTrial.pcode.txt)；body `92501`；code SHA-256 `ee0681681fe323f91fe4c3249d6e000143363b8c98c92aa440dc3212ad94f9df`。
- [OrochiEx/loop](pcode/boot_ffc6--OrochiEx_loop.pcode.txt)；body `92502`；code SHA-256 `511b9bd85ba7ed58e2ceb8e03575212daa4b3bef06dae3b4417b5914a828acd4`。
- [OrochiEx/isTrialGaugeVisible](pcode/boot_ffc6--OrochiEx_isTrialGaugeVisible.pcode.txt)；body `92503`；code SHA-256 `d585616625656f7803c9407d288dca461830151e2b66e2009440e239c604ef48`。
- [OrochiEx/isLinkConditionEffectVisible](pcode/boot_ffc6--OrochiEx_isLinkConditionEffectVisible.pcode.txt)；body `92504`；code SHA-256 `8bd91b4d6662c2af4743360fdfdadd0ffd59568f99d5771831541eb0e40a633f`。
- [OrochiEx/isInvincible](pcode/boot_ffc6--OrochiEx_isInvincible.pcode.txt)；body `92505`；code SHA-256 `f0962643573d1de38f10ee7aad5d132cd67f97a5a30eacc5bd33cda4df6927c0`。
- [OrochiEx/isHealthPointGaugeVisible](pcode/boot_ffc6--OrochiEx_isHealthPointGaugeVisible.pcode.txt)；body `92506`；code SHA-256 `ca8b4ba43041466cdd88bd130f8a1824a7bf3b96001bdf62a01e4d6a44df79e6`。
- [OrochiEx/isGenericDeathEffect](pcode/boot_ffc6--OrochiEx_isGenericDeathEffect.pcode.txt)；body `92507`；code SHA-256 `8bd91b4d6662c2af4743360fdfdadd0ffd59568f99d5771831541eb0e40a633f`。
- [OrochiEx/isContemporizing](pcode/boot_ffc6--OrochiEx_isContemporizing.pcode.txt)；body `92508`；code SHA-256 `ca2fa85333efd90732cdbdb46a7fe5d32bfd7c847b36903022a32b404fb6dcd3`。
- [OrochiEx/isChargingSpecialAttack](pcode/boot_ffc6--OrochiEx_isChargingSpecialAttack.pcode.txt)；body `92509`；code SHA-256 `7df64c4ae27ef6d6ea6da686e7b0bcf3b83e85513b555c85f8d8245c7c5e8a08`。
- [OrochiEx/initialize](pcode/boot_ffc6--OrochiEx_initialize.pcode.txt)；body `92510`；code SHA-256 `6ae503cc170a73e44214bbc52ca28521db9b71b8c2c4f5c44b501e428cbd7178`。
- [OrochiEx/init](pcode/boot_ffc6--OrochiEx_init.pcode.txt)；body `92511`；code SHA-256 `108f66137272f086c09e35ca675ebc054663e912db1f7129ac5efc3b7a8f6a68`。
- [OrochiEx/incrementFunnelSpawnCount](pcode/boot_ffc6--OrochiEx_incrementFunnelSpawnCount.pcode.txt)；body `92512`；code SHA-256 `f3f70deaca6e853279769895600e46c900985792ce4ef99fcfbdf4eca27e4e7c`。
- [OrochiEx/hasPinched](pcode/boot_ffc6--OrochiEx_hasPinched.pcode.txt)；body `92513`；code SHA-256 `e14f063642ed90ce68708e85bad060693fbaa28010127676118bbc81afa8c525`。
- [OrochiEx/gotoTrialStunIfPossible](pcode/boot_ffc6--OrochiEx_gotoTrialStunIfPossible.pcode.txt)；body `92514`；code SHA-256 `28be89f0d2931d581f3c789f194e4e1f1aa1202c3327b3f23613c880fb3ea286`。
- [OrochiEx/gotoTrialStun](pcode/boot_ffc6--OrochiEx_gotoTrialStun.pcode.txt)；body `92515`；code SHA-256 `2232a87e6eebd62d54f79c2e1bcea3d0bdc0c1bf20b0e77270f72d7e157c7dd8`。
- [OrochiEx/gotoSkillChainStunIfPossible](pcode/boot_ffc6--OrochiEx_gotoSkillChainStunIfPossible.pcode.txt)；body `92516`；code SHA-256 `81b47d70b51b8fa32c4b13a60101081a93df1cf06556d206b3ffd21b91602d78`。
- [OrochiEx/gotoNextState](pcode/boot_ffc6--OrochiEx_gotoNextState.pcode.txt)；body `92517`；code SHA-256 `4208c1a297a715745ad92e7568e7d6813a9a6bffaca652c44fbe00b96e84f77d`。
- [OrochiEx/gotoNextPhaseIfPossible](pcode/boot_ffc6--OrochiEx_gotoNextPhaseIfPossible.pcode.txt)；body `92518`；code SHA-256 `14a808e8f3ec478164b42bd6f8f0c50606f1e0190ba4b0de18f6a715b07345d6`。
- [OrochiEx/getWeakPointCountdownY](pcode/boot_ffc6--OrochiEx_getWeakPointCountdownY.pcode.txt)；body `92519`；code SHA-256 `153a987248bcbeee11e08159e5d9fdefd7a8e84ac38f837a2e2ae98f00f14ae1`。
- [OrochiEx/getWeakPointCountdownX](pcode/boot_ffc6--OrochiEx_getWeakPointCountdownX.pcode.txt)；body `92520`；code SHA-256 `dcf83a40950a05cbd14674e74bf46ab8dbb0cd10944b32e0357e14057d009b90`。
- [OrochiEx/getWeakPointCountdownAnimation](pcode/boot_ffc6--OrochiEx_getWeakPointCountdownAnimation.pcode.txt)；body `92521`；code SHA-256 `a92f5c15a7f3397b0910e98dffd75a9b12513e8beddcc88ff93bff0947eab163`。
- [OrochiEx/getTrialNameOfChallenging](pcode/boot_ffc6--OrochiEx_getTrialNameOfChallenging.pcode.txt)；body `92522`；code SHA-256 `bae64dcef22daf250c3242ff5bfe46a6aa836cd8f74e9932b83c9bbcdfa02acc`。
- [OrochiEx/getTrialKindOfChallenging](pcode/boot_ffc6--OrochiEx_getTrialKindOfChallenging.pcode.txt)；body `92523`；code SHA-256 `1e2452f8540df0ea98973220b467cdb9692ddee0f16b96c1a7d2c7f2e58839c3`。
- [OrochiEx/getTrialIdOfChallenging](pcode/boot_ffc6--OrochiEx_getTrialIdOfChallenging.pcode.txt)；body `92524`；code SHA-256 `e4e54d656e8f586a86dc13808464610e8ee0fd242048f8c27c00c83ba118278d`。
- [OrochiEx/getTrialGauge](pcode/boot_ffc6--OrochiEx_getTrialGauge.pcode.txt)；body `92525`；code SHA-256 `33909bbfdccab8498877fe988cf2d79cc8ed1ce05c6754bb60d1e06e21ae3a26`。
- [OrochiEx/getScriptContext](pcode/boot_ffc6--OrochiEx_getScriptContext.pcode.txt)；body `92527`；code SHA-256 `3955430267c7daaf757f4cc0f0ff5f3270daf5903d8ad872c796cef0e761f18b`。
- [OrochiEx/getRemainingFramesOfUniqueStateGroup](pcode/boot_ffc6--OrochiEx_getRemainingFramesOfUniqueStateGroup.pcode.txt)；body `92528`；code SHA-256 `62320b753e31aac9702e912ab36f7162ea0d420fd18c24f1016acfb8418aa661`。
- [OrochiEx/getRealMaximumHealthPoint](pcode/boot_ffc6--OrochiEx_getRealMaximumHealthPoint.pcode.txt)；body `92529`；code SHA-256 `069dad8533adcd86dd8c395926f482f76d5607aa27bf83501fe0b915516b9c91`。
- [OrochiEx/getRealHealthPointRatio](pcode/boot_ffc6--OrochiEx_getRealHealthPointRatio.pcode.txt)；body `92530`；code SHA-256 `5064bdc75a0a082ea140339ca0ddb7bbd4cdb98d1cea5cf9d162745de79a7895`。
- [OrochiEx/getRealCurrentHealthPoint](pcode/boot_ffc6--OrochiEx_getRealCurrentHealthPoint.pcode.txt)；body `92531`；code SHA-256 `7b200c0758b7725a45a342ad2b3bd5759283e1c28a087f1c544a276a6e0e41f5`。
- [OrochiEx/getPhaseIconRefreshIndex](pcode/boot_ffc6--OrochiEx_getPhaseIconRefreshIndex.pcode.txt)；body `92532`；code SHA-256 `eb2e3cb02375ba5a360c536082f5d4fcf90ca3129dc1b8de4e3c56f0c643e47d`。
- [OrochiEx/getNextPhaseChangeThreshold](pcode/boot_ffc6--OrochiEx_getNextPhaseChangeThreshold.pcode.txt)；body `92533`；code SHA-256 `d479ffc97d37be3aeed5bdd3b4d323649a0299af04adcd9b829a62992d3b0692`。
- [OrochiEx/getLinkConditionEffectCurrentFrame](pcode/boot_ffc6--OrochiEx_getLinkConditionEffectCurrentFrame.pcode.txt)；body `92534`；code SHA-256 `69eedd7aa98da5862c8e5de196299b58bdf66a5dbed7e17ebb51659e40f15336`。
- [OrochiEx/getInitialState](pcode/boot_ffc6--OrochiEx_getInitialState.pcode.txt)；body `92535`；code SHA-256 `b50449eb971ab1eb55cf4d32ead190e2d9f293ecc5ed51436857ef48efe6c0d6`。
- [OrochiEx/getEnemyCount](pcode/boot_ffc6--OrochiEx_getEnemyCount.pcode.txt)；body `92536`；code SHA-256 `f3ad9eb56e11200c747758c56041cb3a97602ec54153b935e6bad75743f4f6aa`。
- [OrochiEx/getDebugStatus](pcode/boot_ffc6--OrochiEx_getDebugStatus.pcode.txt)；body `92537`；code SHA-256 `145c810f6038f005c9019993936a8d8169ffcf3217f69dd3baeef992a918061f`。
- [OrochiEx/getCurrentFrameWeakPointCountdownAnimation](pcode/boot_ffc6--OrochiEx_getCurrentFrameWeakPointCountdownAnimation.pcode.txt)；body `92538`；code SHA-256 `6445ba04d63450744c62b9225f0e27a44307cc320cab4cd45afe317aae933998`。
- [OrochiEx/getConditionIconVisible](pcode/boot_ffc6--OrochiEx_getConditionIconVisible.pcode.txt)；body `92539`；code SHA-256 `6de1229675e25aa935a4316b2e6d1cc72d20140728aa0783d7c1054ae799695a`。
- [OrochiEx/getConditionIconBaseY](pcode/boot_ffc6--OrochiEx_getConditionIconBaseY.pcode.txt)；body `92540`；code SHA-256 `de6b89aa3b0a38cfd7aefa0bd4e89896296f1b6d19159890f849aabcc7556ab6`。
- [OrochiEx/getAttackValues](pcode/boot_ffc6--OrochiEx_getAttackValues.pcode.txt)；body `92541`；code SHA-256 `106b12452c0ed41dec096bab86f0a20a97e412f04ad0ef4adb4f1d0e633fd90a`。
- [OrochiEx/getAnimationLabel](pcode/boot_ffc6--OrochiEx_getAnimationLabel.pcode.txt)；body `92542`；code SHA-256 `2d6c9e11e219f62f095ca7a9865e7b9ec75da1d2a39a33917412535032f36aac`。
- [OrochiEx/getActionSubjects](pcode/boot_ffc6--OrochiEx_getActionSubjects.pcode.txt)；body `92543`；code SHA-256 `2d6e46be4139b6f111ba3aa181a8c3e8351f2d50cb7e5ea6ea120de8c86407d8`。
- [OrochiEx/generateAttackAnimationLabel](pcode/boot_ffc6--OrochiEx_generateAttackAnimationLabel.pcode.txt)；body `92544`；code SHA-256 `739fe81befa4e1311e33cfec432bb9435c8534535199742ec266ce47a24d4a3b`。
- [OrochiEx/forwardDamageFromHead](pcode/boot_ffc6--OrochiEx_forwardDamageFromHead.pcode.txt)；body `92545`；code SHA-256 `9c53f45d311696991d78c94fb7ed04bab189c85126d12a65994ece39b7f4ad23`。
- [OrochiEx/exitUniqueState](pcode/boot_ffc6--OrochiEx_exitUniqueState.pcode.txt)；body `92546`；code SHA-256 `3520c279d89a0f8692216b9ad4cdac3f455a01038e67c0b6a8468daf5d4f0b75`。
- [OrochiEx/executeAction](pcode/boot_ffc6--OrochiEx_executeAction.pcode.txt)；body `92547`；code SHA-256 `1d4108c09c24d1c5a0c9408091defaea6cf19c689ab837a59f9bb0daa854ecd6`。
- [OrochiEx/enterWinceState](pcode/boot_ffc6--OrochiEx_enterWinceState.pcode.txt)；body `92548`；code SHA-256 `ca862387625f56fedf996560ce49dda8ac4250e87b0addae5bdc091f52a331ed`。
- [OrochiEx/startPhase1Trial2Masked](pcode/boot_ffc6--OrochiEx_startPhase1Trial2Masked.pcode.txt)；body `92549`；code SHA-256 `2d6af5312a8e9fbe642974ec8fb56ac6b541a9e8eb7038cd9c03996fa730d964`。
- [OrochiEx/tryStartPhase1Trial](pcode/boot_ffc6--OrochiEx_tryStartPhase1Trial.pcode.txt)；body `92550`；code SHA-256 `0da23e82bcd372028d33377d9fa807528d0997923ef7815ff298f41d52f65e53`。
- [OrochiEx/enterUniqueState](pcode/boot_ffc6--OrochiEx_enterUniqueState.pcode.txt)；body `92551`；code SHA-256 `441339a33b2e20fe6f0da6574a46337773638cbfc8cff143a0ea68d099418b7d`。
- [OrochiEx/enterStunState](pcode/boot_ffc6--OrochiEx_enterStunState.pcode.txt)；body `92552`；code SHA-256 `ce447cdb581fd0ae2852f3a5a66861a2f3b630a8e25e78e5d5d00baf49bd3ea3`。
- [OrochiEx/enterDeadState](pcode/boot_ffc6--OrochiEx_enterDeadState.pcode.txt)；body `92553`；code SHA-256 `723f09a6a64f37a5ac201a8d66f0e1fe59a58f5cf43d5ac84b14a7cdb60b8f3c`。
- [OrochiEx/dispelAllConditions](pcode/boot_ffc6--OrochiEx_dispelAllConditions.pcode.txt)；body `92554`；code SHA-256 `1e59ef99a398ad1cb33d3bd40eb12fefc736cd44991b62d51c7c62f368d753ed`。
- [OrochiEx/dieIfPossible](pcode/boot_ffc6--OrochiEx_dieIfPossible.pcode.txt)；body `92555`；code SHA-256 `a968960b201420953c59656517f78c74a88e3e2aebf37839d8e70f6e531134c4`。
- [OrochiEx/createTargetAttack](pcode/boot_ffc6--OrochiEx_createTargetAttack.pcode.txt)；body `92556`；code SHA-256 `84230d22a5a081c16547036af4b9d13de1a694e58ce52cc2b89861d9d53ca887`。
- [OrochiEx/changeState](pcode/boot_ffc6--OrochiEx_changeState.pcode.txt)；body `92557`；code SHA-256 `796d7c3b75be72f407a9a729027d1449239da6b36ee85994b3c88d1c936c8297`。
- [OrochiEx/configurePhase4WeakPointKind](pcode/boot_ffc6--OrochiEx_configurePhase4WeakPointKind.pcode.txt)；body `92558`；code SHA-256 `6c0c6c5154ea75cec37886ce841b82abbcf8e030b4c7acad51c2cd4d01c507d3`。
- [OrochiEx/canRemoveOnContinue](pcode/boot_ffc6--OrochiEx_canRemoveOnContinue.pcode.txt)；body `92560`；code SHA-256 `8bd91b4d6662c2af4743360fdfdadd0ffd59568f99d5771831541eb0e40a633f`。
- [OrochiEx/canEnterWinceStateFromUniqueState](pcode/boot_ffc6--OrochiEx_canEnterWinceStateFromUniqueState.pcode.txt)；body `92561`；code SHA-256 `6cba9f46fd9acc6080106b8671490c85d057554ba7d6177e0fb757a9e20007d1`。
- [OrochiEx/canEnterStunStateFromUniqueState](pcode/boot_ffc6--OrochiEx_canEnterStunStateFromUniqueState.pcode.txt)；body `92562`；code SHA-256 `9b92a8fadf5fee15c721ce3c05f0b8f4a53f746e685ec7641eadaf84801f300f`。
- [OrochiEx/backtrackUniqueState](pcode/boot_ffc6--OrochiEx_backtrackUniqueState.pcode.txt)；body `92563`；code SHA-256 `ec3ab737e3ba3660a75adb903b9dfb94dc30ffa2c30b36a472ff8afdbb93f7a8`。
- [OrochiEx/applyConditionChanges](pcode/boot_ffc6--OrochiEx_applyConditionChanges.pcode.txt)；body `92565`；code SHA-256 `4b612aed5aafab33cc88a72edf7e48d45ad0afdb5a53c4aa07569592548fa508`。
- [OrochiEx/applyAttack](pcode/boot_ffc6--OrochiEx_applyAttack.pcode.txt)；body `92567`；code SHA-256 `b26fc55076a3b1a5acce32b20b35fd41a35178b09fd73bb953625474414194dc`。
- [OrochiEx/afterAddition](pcode/boot_ffc6--OrochiEx_afterAddition.pcode.txt)；body `92568`；code SHA-256 `a968960b201420953c59656517f78c74a88e3e2aebf37839d8e70f6e531134c4`。
- [OrochiEx/_state](pcode/boot_ffc6--OrochiEx__state.pcode.txt)；body `92569`；code SHA-256 `f77330aefefcde1b43e3898794cd05b8b4e0646722a192aa7ddcbc6e12fb740e`。
- [OrochiEx/_changeState](pcode/boot_ffc6--OrochiEx__changeState.pcode.txt)；body `92570`；code SHA-256 `4a701be9510e8d71511c0125e898271beada23403b595ce80fc0db80012316f1`。
- [OrochiEx/showCutin](pcode/boot_ffc6--OrochiEx_showCutin.pcode.txt)；body `92587`；code SHA-256 `5e6b5f76cbcdd8a3f0dcfa78096fc8fcd323cd04163ba44afd94a1e808a2485b`。
- [OrochiEx/scoutOut](pcode/boot_ffc6--OrochiEx_scoutOut.pcode.txt)；body `92588`；code SHA-256 `63bc6ff7daf625f3672a3cd2078809707b4031dc9af72b94d6dbadcc2b06799d`。
- [OrochiEx/hasUnifiedPhaseHealthMode](pcode/boot_ffc6--OrochiEx_hasUnifiedPhaseHealthMode.pcode.txt)；body `92589`；code SHA-256 `b613bca595a3265d253b82a8024609acdff9d405ed0e1ce1f65267ba8c41a8b6`。
- [OrochiEx/unifiedPhaseHealthPoint](pcode/boot_ffc6--OrochiEx_unifiedPhaseHealthPoint.pcode.txt)；body `92590`；code SHA-256 `62983fb2c3c4617b15ce1ca2e0a73b045b5cceb8aca9bda04e46ac3ed40c835e`。
- [OrochiEx/unifiedPhaseDamage](pcode/boot_ffc6--OrochiEx_unifiedPhaseDamage.pcode.txt)；body `92592`；code SHA-256 `389284ec7545d425db1b3c014136cc9c5f884f4827579e71c7e70d851173dd76`。
- [OrochiEx/acceptUnifiedPhaseDamage](pcode/boot_ffc6--OrochiEx_acceptUnifiedPhaseDamage.pcode.txt)；body `92593`；code SHA-256 `e5db0f61378c7d2f3544763c39e38c677b047dfc7826ae2afaf07ca47d98deef`。
- [OrochiEx/isUnifiedPhaseComplete](pcode/boot_ffc6--OrochiEx_isUnifiedPhaseComplete.pcode.txt)；body `92594`；code SHA-256 `e44f988ef27deb0379ae125b6e4cda26605c86bd803b690e2fe2557644daa4e7`。
- [OrochiEx$/<cinit>](pcode/boot_ffc6--OrochiEx___cinit_.pcode.txt)；body `92580`；code SHA-256 `a97687d77bd5812dbf56fcbc27f918b697e26cfb805ed6a7a8495346e29f3526`。
- [OrochiEx$/next](pcode/boot_ffc6--OrochiEx__next.pcode.txt)；body `92571`；code SHA-256 `f9ea40e20e977ecc7b6c4f4be7c3922a212ff8b29c3efd3cff779fc0b4cc1c18`。
- [OrochiEx$/back](pcode/boot_ffc6--OrochiEx__back.pcode.txt)；body `92572`；code SHA-256 `38b6f2fcb324450172de98065d4c73f84eabbbf42f94daf2222c0acc5f43a6b3`。
- [OrochiEx$/getNextStateName](pcode/boot_ffc6--OrochiEx__getNextStateName.pcode.txt)；body `92573`；code SHA-256 `f228ab09009e09ae9166dc82e3a2e69caa116edb12a6627119830f516512ccdc`。
- [OrochiEx$/isIdleable](pcode/boot_ffc6--OrochiEx__isIdleable.pcode.txt)；body `92574`；code SHA-256 `df91636e6268b10879dac7e59c1feacee03a7b804c5d12d04f1430063a43f295`。
- [OrochiEx$/isAttack](pcode/boot_ffc6--OrochiEx__isAttack.pcode.txt)；body `92575`；code SHA-256 `0ab66b9a82c535e2a36a6b362ec46848f0019afc595fb23210da6d4172677c42`。
- [OrochiEx$/isSkill](pcode/boot_ffc6--OrochiEx__isSkill.pcode.txt)；body `92576`；code SHA-256 `1ca1e46a9c5edf5463663a0f4c7fddff4dabe5aec6bfcb2775c0464bf1a65277`。
- [OrochiEx$/_equals](pcode/boot_ffc6--OrochiEx___equals.pcode.txt)；body `92577`；code SHA-256 `646b1e4a5003baddd41a0089e1f286ad77cd03229298a97fb60f0641b153c62d`。
- [OrochiEx$/_toString](pcode/boot_ffc6--OrochiEx___toString.pcode.txt)；body `92578`；code SHA-256 `3d4156578cad8ebeca3aa4caebc79428ea55dd2ae9369c629d13bfde525add98`。
- [OrochiExSource/<ctor>](pcode/boot_ffc6--OrochiExSource__ctor_.pcode.txt)；body `92585`；code SHA-256 `67b88a122c30bc7e27ca630c8bf3f6132b550f4ce18b7cc0602f37cb9eff6f11`。
- [OrochiExSource/dynamicWeakPointSource](pcode/boot_ffc6--OrochiExSource_dynamicWeakPointSource.pcode.txt)；body `92582`；code SHA-256 `dfb103ca3a8107bb28e7f4fc217165d313c6d72152eac134a57ae7a8ce01ff3b`。
- [OrochiExSource/resolvePathCollection](pcode/boot_ffc6--OrochiExSource_resolvePathCollection.pcode.txt)；body `92583`；code SHA-256 `6f245e5ba92f0f16a8e813ab1d87d9105055838c66ca16b25fabb026c95417d2`。
- [OrochiExSource/resolveEnemyActions](pcode/boot_ffc6--OrochiExSource_resolveEnemyActions.pcode.txt)；body `92584`；code SHA-256 `c6c6f0716a2f228f25c3d7cf6507876b8b168e647a8fdc4c5eb3ca5de9060665`。
- [OrochiExSource$/<cinit>](pcode/boot_ffc6--OrochiExSource___cinit_.pcode.txt)；body `92586`；code SHA-256 `a968960b201420953c59656517f78c74a88e3e2aebf37839d8e70f6e531134c4`。
- [OrochiExValues$/<cinit>](pcode/boot_ffc6--OrochiExValues___cinit_.pcode.txt)；body `92451`；code SHA-256 `a968960b201420953c59656517f78c74a88e3e2aebf37839d8e70f6e531134c4`。
- [OrochiExValues$/init](pcode/boot_ffc6--OrochiExValues__init.pcode.txt)；body `92448`；code SHA-256 `b0885e8a619be441b7c3df8ce589d4be35353eb60b17a1a9f166e50e1de89ed3`。
- [OrochiExValues$/_new](pcode/boot_ffc6--OrochiExValues___new.pcode.txt)；body `92449`；code SHA-256 `b4fed9eca204cbfe429785b2466fda013ded719d4e44dfcc8b143898be701d0d`。
- [EnemySynchronizeOwnerKind/<ctor>](pcode/boot_ffc6--EnemySynchronizeOwnerKind__ctor_.pcode.txt)；body `92466`；code SHA-256 `7979072a95c57c395e3c40246f53d8ecd3d89ff1c967d87f9dd114c2cf51751d`。
- [EnemySynchronizeOwnerKind/toString](pcode/boot_ffc6--EnemySynchronizeOwnerKind_toString.pcode.txt)；body `92453`；code SHA-256 `7b0a4ae6426e151cef7cfc66d964d9a8e28302e9d5aacefdc7bf55a346ba4978`。
- [EnemySynchronizeOwnerKind$/<cinit>](pcode/boot_ffc6--EnemySynchronizeOwnerKind___cinit_.pcode.txt)；body `92467`；code SHA-256 `8f9a01801d79bf8673b27a7a918a5245f2a95ea09ef8a7373d5986ed429cedc8`。
- [EnemySynchronizeOwnerKind$/Conductor](pcode/boot_ffc6--EnemySynchronizeOwnerKind__Conductor.pcode.txt)；body `92454`；code SHA-256 `66cca0f18a09746bc4724e8e0559bfa7447daff68b8863798050d92fc08f6b72`。
- [EnemySynchronizeOwnerKind$/registerBossMechanics](pcode/boot_ffc6--EnemySynchronizeOwnerKind__registerBossMechanics.pcode.txt)；body `92455`；code SHA-256 `f8a49b52685cfa2f5893f716e5abf29004a8a71d6babfc6fae0d252cb161f655`。
- [EnemySynchronizeOwnerKind$/BossMechanics](pcode/boot_ffc6--EnemySynchronizeOwnerKind__BossMechanics.pcode.txt)；body `92456`；code SHA-256 `29665f2f83e8be2dda60a1fa17158ea327e9995fd8aced862653727eeb1f69f2`。
- [EnemySynchronizeOwnerKind$/GeneralBoss](pcode/boot_ffc6--EnemySynchronizeOwnerKind__GeneralBoss.pcode.txt)；body `92457`；code SHA-256 `01352bab3abbc6e8e5dc3bba13ab485ecabed4011b14bf577a4ec15a5299a39b`。
- [EnemySynchronizeOwnerKind$/GeneralEnemy](pcode/boot_ffc6--EnemySynchronizeOwnerKind__GeneralEnemy.pcode.txt)；body `92458`；code SHA-256 `476014a4caa147b69dcb05b2131023f17e5636af477ad20d243e9e0a4095e068`。
- [EnemySynchronizeOwnerKind$/GeneralFunnel](pcode/boot_ffc6--EnemySynchronizeOwnerKind__GeneralFunnel.pcode.txt)；body `92459`；code SHA-256 `623231711fcb05ef7cbee7e512054413d53425bc26b4be0573b1032a57cfd8e3`。
- [EnemySynchronizeOwnerKind$/Kraken](pcode/boot_ffc6--EnemySynchronizeOwnerKind__Kraken.pcode.txt)；body `92460`；code SHA-256 `ecb5ec20b72066eedc58b402a9d2ae674450a36e7a60d7dc76e28ca391d289d8`。
- [EnemySynchronizeOwnerKind$/Orochi](pcode/boot_ffc6--EnemySynchronizeOwnerKind__Orochi.pcode.txt)；body `92461`；code SHA-256 `1fc680cacb141e84e0cb30c120b73bff13a337ecd7a0a14ef944bcf52f869642`。
- [EnemySynchronizeOwnerKind$/OrochiEx](pcode/boot_ffc6--EnemySynchronizeOwnerKind__OrochiEx.pcode.txt)；body `92462`；code SHA-256 `d8f0489675d7700be7d58ddc4a67e5bc3115613dd3e3eebd111d8f1983a44592`。
- [EnemySynchronizeOwnerKind$/OrochiExHead](pcode/boot_ffc6--EnemySynchronizeOwnerKind__OrochiExHead.pcode.txt)；body `92463`；code SHA-256 `8c1f8ad1bac55b3da8d1013e21ecd6c3d91958449741aee6daf2d35c035baa26`。
- [EnemySynchronizeOwnerKind$/Tentacle](pcode/boot_ffc6--EnemySynchronizeOwnerKind__Tentacle.pcode.txt)；body `92464`；code SHA-256 `7d8717e706b2a912bd8fb6452510bbc0be47394e41bea9c730124bf2eef49fd1`。
- [EnemySynchronizeOwnerKind$/TouyakirenCeo](pcode/boot_ffc6--EnemySynchronizeOwnerKind__TouyakirenCeo.pcode.txt)；body `92465`；code SHA-256 `85c8b7acfd55fd1020f7263301eea0de942b89a363778a07f23e873b118baf53`。
- [ZoneSourceValues/resolveOrochiExsAction](pcode/boot_ffc6--ZoneSourceValues_resolveOrochiExsAction.pcode.txt)；body `15656`；code SHA-256 `430d93a9cad247dc0b4d1e56b21c6c5558ca3f7128465b7a390be1dd5a962e04`。
- [ZoneSource/get_bossGroupName](pcode/boot_ffc6--ZoneSource_get_bossGroupName.pcode.txt)；body `15641`；code SHA-256 `3f0e8c912aeebd0c9529a15cd6f6c8acf27ef0d03a74691e5208f23523d09250`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_public_android.py](source/build_public_android.py) ← `D:\WF\startpoint-cn-kulo\client-patch\orochi-boss\build_public_android.py`；2,853 B；SHA-256 `2fe8169f3379a071209b3bea96290a210b8ba62284ca81189e12f431ae7c62a6`。
