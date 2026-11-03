# 125 超级Fever能量、等级、结束事件和固定爆发

capability：`super-fever-v1`；本地候选，未部署。
输入固定为run2/v35b.swf，方法体SHA256与header同时锁定。
最终SWF SHA256：`d0a8e186203d94ba98d78dcf14a7557fcf4c0a4cea9fcaa340250267ec326682`。

[中文数据例子与完整说明](../../README.md) · [统一验证报告](../../verify-report.json) · [统一构建入口](../../build.py)

## 现有方法合成及源文件

下面是实现目录的完整Python源码快照；运行仍使用run3根目录的工具、依赖和统一构建器。

- [superfever详细说明](../../superfever/notes.md)。
- [superfever/base_runtime.py](source/superfever/base_runtime.py)，SHA256 `a84a6e62f9fac524b260cc148818b85e221ef1bca55f53c5a395179f31875f4b`。
- [superfever/bonus.py](source/superfever/bonus.py)，SHA256 `dbc6afb695f9c319980148a55d5941243acd7e6364b9c7d8f2e33eeaa03a4e32`。
- [superfever/cases.py](source/superfever/cases.py)，SHA256 `82103def041bca83a25b82f862ad0ccab57e022ddb35243355c88bc4f5576827`。
- [superfever/devbuild.py](source/superfever/devbuild.py)，SHA256 `3f5d9fb484a8f7a46b479de5951ab1b44bb84f013f4b62f2bc88ec0f21f19e83`。
- [superfever/energy.py](source/superfever/energy.py)，SHA256 `a5c3b5c6e481d3b10660b38ac29d994f32c092b3c8d47712f56344d6ed3c6194`。
- [superfever/grant.py](source/superfever/grant.py)，SHA256 `fc713cdbb546ed0674150488336445dfc82b20b8aff3575117aa7afb944392fb`。
- [superfever/inspect_more.py](source/superfever/inspect_more.py)，SHA256 `9183fa0edc24e46f467106bfe4ddfd57f1f83fd964273c2670f0525e66055da0`。
- [superfever/inspect_native.py](source/superfever/inspect_native.py)，SHA256 `1dc9979634e56873a69c68b3bc90dc63bff7bb412fe9142f61a537e3d5b4f383`。
- [superfever/lifecycle.py](source/superfever/lifecycle.py)，SHA256 `5243d1e75fa838009839dc11fdd5542b3fc384978a467d5b931ef47d1686cef4`。
- [superfever/mutations.py](source/superfever/mutations.py)，SHA256 `0b67ec31f3b6fa6c9b1e5fdfad0d557d289d9e4673031679de3fedbecead9c95`。
- [superfever/patches.py](source/superfever/patches.py)，SHA256 `ff0eef9703eb29edf4fc1640f18663c80f1f22be8c36ecf57e17a95b417a8eec`。
- [superfever/runtime.py](source/superfever/runtime.py)，SHA256 `869cd9ce6e255b004b1c5d91158924d1910fe708979cdad58c878ded1c20a046`。
- [superfever/smoke.py](source/superfever/smoke.py)，SHA256 `2f10330238c50ce263fb1c2e94ef8e8aecf64b1e64df38909f7393c62149d4f7`。
- [superfever/state.py](source/superfever/state.py)，SHA256 `d798855db0e2d4c90298a951b068ad16ce5a949aafd42852e53745c91c78af30`。
- [superfever/symbols.py](source/superfever/symbols.py)，SHA256 `203fe6f6aca93187828bae11ad184cea724c433a9d6153c7b653f4d5f8f6a0c2`。
- [superfever/verify.py](source/superfever/verify.py)，SHA256 `08631dfd838c987dc141f1031d9ee7aeb37af2830c85db3ec81345ac0bb33eb6`。
- [superdamage详细说明](../../superdamage/notes.md)。
- [superdamage/fixture.py](source/superdamage/fixture.py)，SHA256 `117ea06a54c0a41db4b39a3dd00f4d6080c5a9e32bd16ed278f0c6f2bc14f49a`。
- [superdamage/integration.py](source/superdamage/integration.py)，SHA256 `8360f00a82138d5ba60eb0278f120a9758e5e129f8c584de165698123b121d65`。
- [superdamage/patches.py](source/superdamage/patches.py)，SHA256 `3dcbe1682c6e6551f556046f38744f35414a5fb54bfa876e9a6e4d264eff9f85`。
- [superdamage/poison.py](source/superdamage/poison.py)，SHA256 `afa164321d1461782fa51a5d0818158ae5724012acdc228a3108ffbb3c36d0c7`。
- [superdamage/poison_runtime.py](source/superdamage/poison_runtime.py)，SHA256 `91722ac79d7c56fb2013e05a4f97a82cd4f52c8bf9da9683daaa39983cf285fb`。
- [superdamage/poison_verify.py](source/superdamage/poison_verify.py)，SHA256 `87339f6bc07725e9eff5814a88316c75a33e4458b6d00b6521a9caa6f2ec05c4`。
- [superdamage/record.py](source/superdamage/record.py)，SHA256 `0b7cb40132c75119e02c623047c9035f311b21dd50f8904937b371e6eae8bfd2`。
- [superdamage/source_share.py](source/superdamage/source_share.py)，SHA256 `e0356ade3eeac919d342b4f9d242e5b03da52afef1c7ea1e4ce986babb97e780`。
- [superdamage/verify.py](source/superdamage/verify.py)，SHA256 `25359961fe93242cdf8201ff0729af5f9d8ec4900a2a2358c5b65e3671aa4d90`。
- [superpreload详细说明](../../superpreload/notes.md)。
- [superpreload/checks.py](source/superpreload/checks.py)，SHA256 `7db94ea66fbfeda5db8211ce2a26e52dba5157357644e0536a96075380b31bf9`。
- [superpreload/patches.py](source/superpreload/patches.py)，SHA256 `561f26118d4e9d2575a9b2c7b08d7ccfd25fbf34fd3026df722c369f6ffe320e`。
- [superpreload/runtime.py](source/superpreload/runtime.py)，SHA256 `cc3306ff33bc03181fbcbc823bb9dece3045276dc6c181a4d23f1fce8558c2c2`。
- [superpreload/verify.py](source/superpreload/verify.py)，SHA256 `cdf58358f49074e0e02e8ac33c33febebfa3fe7b7d490a06c0beb11e133c49db`。

## 最终P-code

- [AbilityDamageShot/finish](pcode/AbilityDamageShot__finish.pcode.txt)，body `51320`，SHA256 `57d406ca5b723d9f5acc60afd213ac697aadde8127987ccadd3097cf519d1d8f`，header `[108, 35, 1, 2]`。
- [FeverPointGaugeImpl/addFeverPoint](pcode/FeverPointGaugeImpl__addFeverPoint.pcode.txt)，body `61292`，SHA256 `ced6a6754f7bfdf804a275acffd21e34068f994271f5f0e69cef89c378fdd0f8`，header `[4, 6, 1, 2]`。
- [ConditionSlot/removeCondition](pcode/ConditionSlot__removeCondition.pcode.txt)，body `56606`，SHA256 `01c23dccd42610aff382b891c6d75c42f22d61b9f43aec0ed23f1e18ebf3c222`，header `[3, 15, 1, 2]`。
- [NormalAttackCalculator/_calculate](pcode/NormalAttackCalculator___calculate.pcode.txt)，body `45134`，SHA256 `60f34403fc68edd1d79572b02dd4ac271a9fe171094129a15efe6fb130566807`，header `[90, 131, 1, 2]`。
- [EnemyImpl/applyAttack](pcode/EnemyImpl__applyAttack.pcode.txt)，body `53486`，SHA256 `40bf00989633add7098e00901d1d76a41f67269b798e170fc03962b8c0062b03`，header `[23, 25, 1, 2]`。
- [EnemyImpl/applySlipHandler](pcode/EnemyImpl__applySlipHandler.pcode.txt)，body `53462`，SHA256 `9b57c2ffebbf6713c0794eb4bf8497e48d7eb0197c54440f3ec7223326b38df9`，header `[48, 11, 1, 2]`。
- [FixedAttackCalculator/calculate](pcode/FixedAttackCalculator__calculate.pcode.txt)，body `45121`，SHA256 `f4d7217dd88a8438cbfeef3d3e786cb13c94574afbd81ae50478ad509b19602d`，header `[90, 13, 1, 1]`。
- [DamageShareCalculator/calculateFromAttackResult](pcode/DamageShareCalculator__calculateFromAttackResult.pcode.txt)，body `45235`，SHA256 `688c4151903a7f5ae14ae8d47d947bee039f6ad58334174008f644d661bfb906`，header `[10, 6, 1, 1]`。
- [EnemyImpl/applyDamageShare](pcode/EnemyImpl__applyDamageShare.pcode.txt)，body `53478`，SHA256 `cde94d1fc01d0d80cb316f9ce5e766bf22d6a7ff778e2d71619e4372125c5913`，header `[5, 5, 1, 2]`。
- [InstantAbilitySource/resolvePathCollection](pcode/InstantAbilitySource__resolvePathCollection.pcode.txt)，body `14502`，SHA256 `9bdc9e225abdba5cc26c939eb1287978285ee10d665957cb754632c83548ad88`，header `[7, 12, 1, 2]`。
- [InstantAbilitySource/resolveConditionPathCollection](pcode/InstantAbilitySource__resolveConditionPathCollection.pcode.txt)，body `14503`，SHA256 `ca2b71568bb55f4c9c1be63973f1b712baf98cfef234487b32a93a23a00cf7ae`，header `[3, 4, 1, 2]`。
- [ActionDslAssetResolver/eval](pcode/ActionDslAssetResolver__eval.pcode.txt)，body `15679`，SHA256 `0ba772088a5f1ff0e0d12618c253b3b184ac6313df73db3a1c7e3f56a30134a0`，header `[14, 28, 1, 2]`。
- [ConditionSlot/wfxSuperEntry](pcode/ConditionSlot__wfxSuperEntry.pcode.txt)，body `92634`，SHA256 `4a30c42abb20df18cfe407a1c65fa9fb33dfeb3d6a3a114fa69dfc3293a91733`，header `[6, 7, 1, 2]`。
- [MemberImpl/wfxSuperGrant](pcode/MemberImpl__wfxSuperGrant.pcode.txt)，body `92635`，SHA256 `f81c8d40830b71777799c9a178f61e329a38c487d4cda4ee0e4b9f71fec44ff7`，header `[18, 10, 1, 2]`。
- [MemberImpl/wfxSuperEmit](pcode/MemberImpl__wfxSuperEmit.pcode.txt)，body `92636`，SHA256 `2567bb2ee8dd46134940dd99c6f9223505bae221e7e70d97666c1689b63ebbb0`，header `[8, 7, 1, 2]`。
- [MemberImpl/wfxSuperBonus](pcode/MemberImpl__wfxSuperBonus.pcode.txt)，body `92637`，SHA256 `76fb3c2120e055c7a0918dbaad75a11ab45e1d38be9aff7f85af2bee5b0b82cc`，header `[3, 7, 1, 2]`。
- [ConditionSlot/wfxSuperEnd](pcode/ConditionSlot__wfxSuperEnd.pcode.txt)，body `92638`，SHA256 `45ec946b634e8360359dd884cc5fe02d47f437e81c83167ca3c439f775869d45`，header `[3, 8, 1, 2]`。
- [MemberImpl/wfxSuperRecordDamage](pcode/MemberImpl__wfxSuperRecordDamage.pcode.txt)，body `92639`，SHA256 `e55d8c44f2540e7c37d1f14ad587b5f2e77d83add1e2d4735a95ca5324e39c07`，header `[4, 6, 1, 2]`。
- [FeverPointGaugeImpl/wfxSuperEnergy](pcode/FeverPointGaugeImpl__wfxSuperEnergy.pcode.txt)，body `92640`，SHA256 `a9b08050cd021192d2fe8ef51515377ed1d3892a24633dc192b959de4571fea1`，header `[6, 12, 1, 2]`。
- [EnemyImpl/wfxSuperRecordAttack](pcode/EnemyImpl__wfxSuperRecordAttack.pcode.txt)，body `92641`，SHA256 `a48c45210581a1820083074f2cfb325c311f6ce71dd8fb2b1c7f1c2050eb2a8a`，header `[3, 5, 1, 2]`。
- [UniqueConditionLogic/wfxSuperPreloadIcon](pcode/UniqueConditionLogic__wfxSuperPreloadIcon.pcode.txt)，body `92646`，SHA256 `77c42e014f8be91ae28b11c3125b9b037116a4c7d0a0c2b529167463b1985089`，header `[2, 5, 1, 2]`。
- [UniqueConditionLogic/wfxSuperPreload](pcode/UniqueConditionLogic__wfxSuperPreload.pcode.txt)，body `92647`，SHA256 `71cfbb4a334b6f1b5ee637d01caca302bd29dfd4b27e3a8a09caf854cfa243eb`，header `[5, 6, 1, 2]`。

完整AIR/Android、真实联机和设备呈现未核实。没有APK、签名、安装或发布。
