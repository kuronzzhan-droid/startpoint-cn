# 152 联机状态指纹逐敌明细与前 1200 帧固定 30 帧采样（v35t）

- 首发版本：v35t / 1008019（run21）
- capability：`coop-state-fingerprint-compact-v2`（build `v35t`）
- 依赖前置补丁：151（基于 v35s SWF 叠加）
- 对应数据边：无客户端数据表变更

## 作用

为精确定位地狱南瓜等协力关卡在 240–480 帧窗口内的首个跨端分叉源头，在 `v35s` 基础上扩展三项能力：
1. **逐敌完整明细**：当存活敌人数 `<=32` 时，在 `/enemies` 中除保留原紧凑哈希外，额外输出每只敌人的 16 项完整明细（`address`、`enemyId`、`kind`、`hp`、`position`、`stateName`、`stateFrame`、`stateGroup`、`conditions`、`spawnPoint`、`counters`、`trialGauge`、`legacyCompactEnemy`、`reservedParalysis`、`trialFull`、`spawnSlots`）；
2. **补齐逻辑 RNG 跟踪**：新增 `/rng/conditionChange`（减益命中判定随机数）与 `/rng/coffin`（棺材选择随机数）及命名清控事件计数；
3. **前 1200 帧固定 30 帧采样**：在 `0 <= postFrame <= 1200` 期间锁定每 30 帧采样一次（禁止耗时或预算压力升档），1200 帧后恢复 `v35s` 自适应网格。

## 改动类与方法

- 修改 4 个既有诊断方法：`Battle$/wfxFpCompactSnapshot`、`Battle$/wfxFpSampleGrid`、`Battle$/wfxFpAdaptGrid`、`Battle$/wfxFpBudgetGrid`、`Battle$/wfxFpEnvelope`（build 标识 `v35t`）。
- 在 `Battle` 类追加 16 个静态辅助方法：`Battle$/wfxFpFixedEarly` 及 `Battle$/wfxFp21*`（`Condition`、`Conditions`、`Copy`、`Enemy`、`EnemyAtZone`、`EnumActionEvaluatorAddress`、`EnumConditionChangeContent`、`EnumConditionDirection`、`EnumConditionOverwriteStrategy`、`EnumOption`、`Events`、`Extend`、`Paralysis`、`SpawnSlots`、`Trial`）。

## 开关与数据写法

- 沿用 `Battle.wfxFpEnabled` 静态开关（默认 `true`）；协议 schema 为 `coop-state-fingerprint-compact-v2`，build 标记为 `v35t`。

## 最终 P-code

- [Battle_static/wfxFp21Condition](pcode/Battle_static__wfxFp21Condition.pcode.txt)；文件 SHA256 `29c2846d9511eb14153dff06e3c9109930ca24374b237db6c65f0709835e2d49`（`Battle$/wfxFp21Condition header=[28, 4, 1, 2] sha=490ef7a947ca6f2b1766768694140ff88762da6945d4ed12799130dc01267da7`）。
- [Battle_static/wfxFp21Conditions](pcode/Battle_static__wfxFp21Conditions.pcode.txt)；文件 SHA256 `89c2121d5db4d011b3d3f24072e1eb2051da7e0f1dfa33cc852eea7c37f63674`（`Battle$/wfxFp21Conditions header=[11, 14, 1, 2] sha=71e4b49966230aaa3bfe85828224f83d454d85d47d08b8dd4725df23aa7a7c30`）。
- [Battle_static/wfxFp21Copy](pcode/Battle_static__wfxFp21Copy.pcode.txt)；文件 SHA256 `c109f49b416906efb32ece75342c7e32dbc1bca00f0e2a47a641cd932e2af4ec`（`Battle$/wfxFp21Copy header=[22, 7, 1, 2] sha=35849524a03199abcb16b3cfa1a1523153226682820bb34303254ee48998406c`）。
- [Battle_static/wfxFp21Enemy](pcode/Battle_static__wfxFp21Enemy.pcode.txt)；文件 SHA256 `7dab2bbfecff9f8d3bd7e6240ed1af4f2e4a42f0805f4801fe138a6075ef8797`（`Battle$/wfxFp21Enemy header=[19, 13, 1, 2] sha=a9a4968302b912129b3bdbb8f9a0c0476238e29a7732fe0c96d08a03f7ddce2f`）。
- [Battle_static/wfxFp21EnemyAtZone](pcode/Battle_static__wfxFp21EnemyAtZone.pcode.txt)；文件 SHA256 `29e6dfae9e0e517a7b57f20edef35acfada7e457a30c90ee60635b28a57457e6`（`Battle$/wfxFp21EnemyAtZone header=[5, 5, 1, 2] sha=b68bc02a51bb28357295916438ccd74acc9876e7027619dcf82d91ddbaf8c8e8`）。
- [Battle_static/wfxFp21EnumActionEvaluatorAddress](pcode/Battle_static__wfxFp21EnumActionEvaluatorAddress.pcode.txt)；文件 SHA256 `41439a1389bc82208a0e0e58868c295f0defccd31fafbacc69cdb81097afc64b`（`Battle$/wfxFp21EnumActionEvaluatorAddress header=[9, 6, 1, 2] sha=4ec7fdd41a2a6623fedf45fcebf91dab40a237d738c87fbb642841a3f4eb03e2`）。
- [Battle_static/wfxFp21EnumConditionChangeContent](pcode/Battle_static__wfxFp21EnumConditionChangeContent.pcode.txt)；文件 SHA256 `478b0a401c97b9fb7a516e54b81519fb5c870ef15d6e267abb959e92d5d607bd`（`Battle$/wfxFp21EnumConditionChangeContent header=[10, 6, 1, 2] sha=17c58df2004befe39818a071c87860d9cef4e8c580c76fc230b156a455304aa6`）。
- [Battle_static/wfxFp21EnumConditionDirection](pcode/Battle_static__wfxFp21EnumConditionDirection.pcode.txt)；文件 SHA256 `bd03b3f5ccb1adfc6376bcde13dcd2bf7b972352637c3a7a5853cc78eecad8e5`（`Battle$/wfxFp21EnumConditionDirection header=[5, 6, 1, 2] sha=8343ce614cb8436fa4d916fb74da8953f2ad84dd63c065663322aae62def6521`）。
- [Battle_static/wfxFp21EnumConditionOverwriteStrategy](pcode/Battle_static__wfxFp21EnumConditionOverwriteStrategy.pcode.txt)；文件 SHA256 `f1b71f78dfa44b6df7f92cc27aa77dbcee18b049b6dafeed230440a70fd5bfd5`（`Battle$/wfxFp21EnumConditionOverwriteStrategy header=[8, 6, 1, 2] sha=5debf058fa98085bbb13b94d0d774f06c655d590c6456e301c8111ea3f6e8083`）。
- [Battle_static/wfxFp21EnumOption](pcode/Battle_static__wfxFp21EnumOption.pcode.txt)；文件 SHA256 `a56f3f7288f6dc384ac346681b89fe37fd607467fbda08d91e232f8fff922ca1`（`Battle$/wfxFp21EnumOption header=[8, 6, 1, 2] sha=6d203885548842797b4daad0cbc0a4699e05a9257f917b3dcff69fa40db5e4a2`）。
- [Battle_static/wfxFp21Events](pcode/Battle_static__wfxFp21Events.pcode.txt)；文件 SHA256 `fecb733775d8ed287a752876ba8f375605104ee5b818251eaef9fbbb42f66730`（`Battle$/wfxFp21Events header=[7, 10, 1, 2] sha=01da702309b02b188c839b1a59321ebb271acca51919c65c9e1a10c7537f4b55`）。
- [Battle_static/wfxFp21Extend](pcode/Battle_static__wfxFp21Extend.pcode.txt)；文件 SHA256 `51c5d53384fb8ac4d610db882ee2d0975b6348207b294974f32a69a0680eb343`（`Battle$/wfxFp21Extend header=[5, 11, 1, 2] sha=7f566b2ff8e384466bbdba0e54b7d77ad0123583834e4131b249208fe39dfad1`）。
- [Battle_static/wfxFp21Paralysis](pcode/Battle_static__wfxFp21Paralysis.pcode.txt)；文件 SHA256 `f3bb4d35f2ed46ff3924dface1f2c7d88717c5e7bba728ce5265476ced0652ac`（`Battle$/wfxFp21Paralysis header=[12, 7, 1, 2] sha=7d8ac2335a181f35217dea4b7dc4bf6739436bcfaba00fdb968240dbf9e907f4`）。
- [Battle_static/wfxFp21SpawnSlots](pcode/Battle_static__wfxFp21SpawnSlots.pcode.txt)；文件 SHA256 `71dfa3353e1d120354868e8fcaae68b466bc193605cf862a69b2539052fc9ed8`（`Battle$/wfxFp21SpawnSlots header=[3, 9, 1, 2] sha=e3f86a257ac248dfc0a6b4e37f4a0379d9839f15ec7072cc2fc64cd4facd4fce`）。
- [Battle_static/wfxFp21Trial](pcode/Battle_static__wfxFp21Trial.pcode.txt)；文件 SHA256 `1789db25efc5c12695cb5868999e211ba8b7ca36bb5353346363fab65297df01`（`Battle$/wfxFp21Trial header=[6, 10, 1, 2] sha=f839c665d38f05ca9353cd8d3d95ab3c938059e96faff3dad2b0192418a34c81`）。
- [Battle_static/wfxFpAdaptGrid](pcode/Battle_static__wfxFpAdaptGrid.pcode.txt)；文件 SHA256 `87e6a74a6bc6499fc7e1114818058070e862d882b72865da484078f6830aad8e`（`Battle$/wfxFpAdaptGrid header=[27, 8, 1, 2] sha=d187bc94d48e7ab9a601b5128e017d74643b68dcc05df687ac1a9ba5e115e95a`）。
- [Battle_static/wfxFpBudgetGrid](pcode/Battle_static__wfxFpBudgetGrid.pcode.txt)；文件 SHA256 `a1c6e64d509bdab68b9530cc6dca8186e89ed2aaafdd3668c5c52c8be5c67ee3`（`Battle$/wfxFpBudgetGrid header=[31, 9, 1, 2] sha=72a463c14e38a6ad5a872bf319036e81deca7d2189e05101d9658b23002fe508`）。
- [Battle_static/wfxFpCompactSnapshot](pcode/Battle_static__wfxFpCompactSnapshot.pcode.txt)；文件 SHA256 `9b3adb62350b281ed0f0408eaa139e01b6cae05d3a2709cf88791904c47ee95d`（`Battle$/wfxFpCompactSnapshot header=[5, 10, 1, 2] sha=a2100552d8523eb05ad6c31eeea9780c62bc8d8c454515b428ba62aa9aa7a854`）。
- [Battle_static/wfxFpEnvelope](pcode/Battle_static__wfxFpEnvelope.pcode.txt)；文件 SHA256 `cc43d1cd7c2da3a5aa0cbbe907e0dc6d1705c673ce91979781daeffa56f9043a`（`Battle$/wfxFpEnvelope header=[16, 7, 1, 2] sha=cb7f9322050985398038c87954bf739d67082af31c4b07a4e552afd677cbbd9a`）。
- [Battle_static/wfxFpFixedEarly](pcode/Battle_static__wfxFpFixedEarly.pcode.txt)；文件 SHA256 `0bbfe913dd4c87d5cf4baf69133949430cd5aef10ecb3c395e8f490d5bd235e4`（`Battle$/wfxFpFixedEarly header=[2, 4, 1, 2] sha=2d01c3fcdebcedb946245ff378af7addff0160df586f4603a0e77908f8b77547`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `524e4ba5c77978c7af23d402258b0ae945ff57c85cb12acabab4aa071c703b0f`。
- [build.py](source/build.py) ← `build.py`；SHA256 `72b37b88793d6fa0deb2d4b362f880e92a2c763e610c7e799321797e92eb9901`。
- [compact_test_vm.py](source/compact_test_vm.py) ← `compact_test_vm.py`；SHA256 `c69560d1d4563426c3024f8e9239f3fdad5d781d222a2e8d19a9d2361a7be2a6`。
- [coverage_binding.py](source/coverage_binding.py) ← `coverage_binding.py`；SHA256 `48b37580bd7bf4234a8db60b108fd8dbc05985e5121028f3270144dff6ea2dd0`。
- [enemy21.py](source/enemy21.py) ← `enemy21.py`；SHA256 `af9650ac76c5bff138b7a906e5ea2735102f37bb1c257fb1670c240a117fc16e`。
- [enemy21_codec.py](source/enemy21_codec.py) ← `enemy21_codec.py`；SHA256 `cb4dd76345b83877db81515f968a4cb0f984f87b23db93017f3eae6d45e4d1ff`。
- [enemy21_conditions.py](source/enemy21_conditions.py) ← `enemy21_conditions.py`；SHA256 `281b7103e0f0398aa26ab0eb7d940c10f8561e3e77d8340b035b64746ec54c82`。
- [enemy21_events.py](source/enemy21_events.py) ← `enemy21_events.py`；SHA256 `2e3c17b9922be4f71dcb3e7524507872b6ccf68ac6fcd40660bfdc0050ae62b7`。
- [enemy21_fixture.py](source/enemy21_fixture.py) ← `enemy21_fixture.py`；SHA256 `05adcecebd85de73bde8e2b73ff1ed382904e2da9616383c1c1d50861d83ac6d`。
- [enemy21_spawn.py](source/enemy21_spawn.py) ← `enemy21_spawn.py`；SHA256 `7ab82027eb384ccfc7ecbae052c14fbf3275c336d93bc5a57c46a515e4b01015`。
- [evidence_audit.py](source/evidence_audit.py) ← `evidence_audit.py`；SHA256 `fee88612c5bf51b3ef7b263d2e2d02a9d54a90026428a950c707537010d8cc0b`。
- [fp_transport_codegen.py](source/fp_transport_codegen.py) ← `fp_transport_codegen.py`；SHA256 `6c0941dc27e19f68452730012d869bb3824bdfcc364efef541e1ce9fd07d5c79`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `1f5d1ad4d9c35fd34efff8c64e4fd1af942f405e5f8e2aee3e5a6e89df8861c0`。
- [grid_budget.py](source/grid_budget.py) ← `grid_budget.py`；SHA256 `03bca20e4e235e0567c94fdf0ebaa9740ebd6acf8f2a94bea301a8386d4a1649`。
- [grid_sampling.py](source/grid_sampling.py) ← `grid_sampling.py`；SHA256 `31843ddd0b8dd05a0f8debbea4c280ef84d57daf390cf8b02db131a18de4b115`。
- [integrity.py](source/integrity.py) ← `integrity.py`；SHA256 `76e4cde8b06cb318539b431942df9f944c89510cb602129571ce43a2c5489357`。
- [pa_semantics.py](source/pa_semantics.py) ← `pa_semantics.py`；SHA256 `b1a709007155a0c7e0576fe4713c074b31fa79024744d8f78cebaa55e572d4d0`。
- [patch.py](source/patch.py) ← `patch.py`；SHA256 `4ca0ac782980bf0a72af8f16a35a2a46664aa42db58a996ebda1e41db48030a3`。
- [promote21.py](source/promote21.py) ← `promote21.py`；SHA256 `a655d5391be9d3733127f4ed52541c8019207145340e1ebeedae01c8af63435d`。
- [round18_test_support.py](source/round18_test_support.py) ← `round18_test_support.py`；SHA256 `1fe772d1d35f76ded9034a9b20e078f64fc0a20666779849f0a87221130c39de`。
- [sampling21.py](source/sampling21.py) ← `sampling21.py`；SHA256 `6c28008d1cded3d0870bb2dd9c871c2dd2a616cc73d0614f09c52e90ebac277b`。
- [scale_fixtures.py](source/scale_fixtures.py) ← `scale_fixtures.py`；SHA256 `013896d1b7e5d9bf964f5caf76b6edd3ba0d4f706c0a572e69d9e0720a92ecfd`。
- [scale_sources.py](source/scale_sources.py) ← `scale_sources.py`；SHA256 `bcf99e5cf13143da68d919a5d280a64ba7089178f7f99736d5d051af6bd380d2`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。
- [verify.py](source/verify.py) ← `verify.py`；SHA256 `d7e80ec9da348892d84c4a397b1856b529adb5121f3b21f53111738ec7bc853f`。
- [verify_structural.py](source/verify_structural.py) ← `verify_structural.py`；SHA256 `47bc215262f793889be359d12d897dd9d479fecaec87985fa2fceb244157369d`。
- [version21.py](source/version21.py) ← `version21.py`；SHA256 `14f9085e57e425d89fbbbb7906d51185c7732ab45b2ae533f562599be945bb4d`。
- [write_readme21.py](source/write_readme21.py) ← `write_readme21.py`；SHA256 `f116777690e4200655a3cb906dc330cbc5072895ddf2cd123d25af9852856ae7`。

## 已知限制与验收边界

- 当同场存活敌人数 `>32` 时不展开 `details` 数组（仅保留紧凑哈希并标记 `detailStatus`），前 1200 帧密集采样产生的积压受 20,000 B/s 发送限速约束在后续帧逐步排空。
- 测试服输出 SWF SHA256 `4533da9ea4b47662b6a2d5a72937988290365ac18c2bb942190070964f52e25e`。

来源工作区：`<WORKDIR>/v35-generic-20261018/run21`、`<WORKDIR>/outputs/apk/coop-fingerprint-20261022`（任务书 `<WORKDIR>/v35-generic-20261018/TASK21.md`）
