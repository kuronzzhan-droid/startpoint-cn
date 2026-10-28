# 151 联机状态指纹本机 Battle 绑定与绝对帧网格（v35s）

- 首发版本：v35s / 1008018（run20）
- capability：`coop-state-fingerprint-compact-v2`（build `v35s`）
- 依赖前置补丁：150（基于 v35r SWF 叠加）
- 对应数据边：无客户端数据表变更

## 作用

修复 150（v35r）实机录制暴露的两项覆盖缺口：
1. **补齐本机主战斗绑定**：在 `BattleScenePlayingStateImpl/proceedBattles` 入口绑定 `myBattleDriver.battle`，使每台设备同时上报本机主战斗与两个远端副本共 3 份 Battle 指纹；
2. **绝对帧网格与状态边沿采样**：将采样帧改为 `postFrame % interval == 0`（档位 `30/60/120/240`，并强制 `postFrame % 240 == 0` 保底公共帧），在 `Battle.state.index` 变化时额外采样一次，且在 20,000 B/s 预算受阻时先将各 Battle 采样档位同步升一级。

## 改动类与方法

- 修改 `BattleScenePlayingStateImpl/proceedBattles`、`Battle$/wfxFpSampleCompact`、`Battle$/wfxFpAdapt`、`Battle$/wfxFpReserveUplink`、`Battle$/wfxFpEnvelope`（build 标识 `v35s`）。
- 在 `Battle` 类尾部追加 5 个静态辅助方法：`Battle$/wfxFpBindPrimary`、`Battle$/wfxFpSampleGrid`、`Battle$/wfxFpAdaptGrid`、`Battle$/wfxFpBudgetDenied`、`Battle$/wfxFpBudgetGrid`。

## 开关与数据写法

- 沿用 `Battle.wfxFpEnabled` 静态开关（默认 `true`）；协议 schema 为 `coop-state-fingerprint-compact-v2`，build 标记为 `v35s`。

## 最终 P-code

- [Battle_static/wfxFpAdapt](pcode/Battle_static__wfxFpAdapt.pcode.txt)；文件 SHA256 `7e56f00e4f65737f0e47896fb4225e9704d0bd0a4df99533a49a21b4adbc58c8`（`Battle$/wfxFpAdapt header=[27, 8, 1, 2] sha=bfb58c5d67c8c98a159361dfcec5bb95a1b56c644344c12c34d032b96ac3a08e`）。
- [Battle_static/wfxFpAdaptGrid](pcode/Battle_static__wfxFpAdaptGrid.pcode.txt)；文件 SHA256 `bae71408fe9f68bc1aa58cd57c7697ad92cee63e678cd4645a8a6afc7101ab0a`（`Battle$/wfxFpAdaptGrid header=[27, 8, 1, 2] sha=b12479680da5ea209043f9175cf1dce56ca436dadc5cf18b19c206149cccd46b`）。
- [Battle_static/wfxFpBindPrimary](pcode/Battle_static__wfxFpBindPrimary.pcode.txt)；文件 SHA256 `ce820c8c25bc566fc904dee7ca9e58286ee0997e086b8317018e596be85fe79a`（`Battle$/wfxFpBindPrimary header=[3, 3, 1, 2] sha=7b0b99c1f7851c5979ea4f5bb63daf4f42f836965efa170a6ef61d72c2398efd`）。
- [Battle_static/wfxFpBudgetDenied](pcode/Battle_static__wfxFpBudgetDenied.pcode.txt)；文件 SHA256 `9188568b997455250337a2f5bbc63cf20c065e77528b36787cbd922480252a76`（`Battle$/wfxFpBudgetDenied header=[3, 2, 1, 2] sha=c60ade31acf1c741df39c5a851afa22281548b95f44066366b3c6b75b1b10459`）。
- [Battle_static/wfxFpBudgetGrid](pcode/Battle_static__wfxFpBudgetGrid.pcode.txt)；文件 SHA256 `a35ebc56e8a2e5247b016ac072f591a44f10d800b1f97535b617b9f9ac2a91b7`（`Battle$/wfxFpBudgetGrid header=[31, 9, 1, 2] sha=22514e740776b370d2611860e3b43fc584666c5a773602732299d48d49625882`）。
- [Battle_static/wfxFpEnvelope](pcode/Battle_static__wfxFpEnvelope.pcode.txt)；文件 SHA256 `fe1454ee13af071e4bf325b171c7dda9cacb921b0042f811ceba87472169cb39`（`Battle$/wfxFpEnvelope header=[16, 7, 1, 2] sha=5314cb3480831c19bcd11ff5c067e51526d3ae7518dd257bd06e574a67329e72`）。
- [Battle_static/wfxFpReserveUplink](pcode/Battle_static__wfxFpReserveUplink.pcode.txt)；文件 SHA256 `20c5e7095ee1073607be414af605f334f29d2640abfe83eb4d2074890f5ecae5`（`Battle$/wfxFpReserveUplink header=[8, 8, 1, 2] sha=fce4bb0fd75584b0fcce895a7583b68db7dae7d9479c5e59b3f44e5d8d5c6868`）。
- [Battle_static/wfxFpSampleCompact](pcode/Battle_static__wfxFpSampleCompact.pcode.txt)；文件 SHA256 `b05e1ba3f05346269ee4449ddeaa64f4d3657e72a88185e3c4b01039f74d00a5`（`Battle$/wfxFpSampleCompact header=[28, 12, 1, 2] sha=6a415db6b771a1dc1359baf8d2b0a3bc83810e47ac5cc2b1aed57d8b8b2af38a`）。
- [Battle_static/wfxFpSampleGrid](pcode/Battle_static__wfxFpSampleGrid.pcode.txt)；文件 SHA256 `1d417cdc53f883f4198bcac60db0c98d0bdb51f945046eb759095a56517325ac`（`Battle$/wfxFpSampleGrid header=[28, 14, 1, 2] sha=c1b1ad3c4bba0306c10c309dffedf41f7d50555d01bba6310ca315567f5429d1`）。
- [BattleScenePlayingStateImpl/proceedBattles](pcode/BattleScenePlayingStateImpl__proceedBattles.pcode.txt)；文件 SHA256 `b5a392f0af3adc276abe2a3f911d935d8820d8fa4ac7c4880d20aa13a99b23a5`（`BattleScenePlayingStateImpl/proceedBattles header=[10, 37, 1, 2] sha=381a7bd4057e4bb22d086d54ce34f6bf6d2e36f0ab3e9ebc3021b0b0cf1137bf`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `ba0ab0fab9634f51b56e69722f20a5be21ac6e62999bd9102578573acc86053d`。
- [build.py](source/build.py) ← `build.py`；SHA256 `72b37b88793d6fa0deb2d4b362f880e92a2c763e610c7e799321797e92eb9901`。
- [compact_test_vm.py](source/compact_test_vm.py) ← `compact_test_vm.py`；SHA256 `c69560d1d4563426c3024f8e9239f3fdad5d781d222a2e8d19a9d2361a7be2a6`。
- [coverage_binding.py](source/coverage_binding.py) ← `coverage_binding.py`；SHA256 `48b37580bd7bf4234a8db60b108fd8dbc05985e5121028f3270144dff6ea2dd0`。
- [evidence_audit.py](source/evidence_audit.py) ← `evidence_audit.py`；SHA256 `fee88612c5bf51b3ef7b263d2e2d02a9d54a90026428a950c707537010d8cc0b`。
- [fp_transport_codegen.py](source/fp_transport_codegen.py) ← `fp_transport_codegen.py`；SHA256 `6c0941dc27e19f68452730012d869bb3824bdfcc364efef541e1ce9fd07d5c79`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `1f5d1ad4d9c35fd34efff8c64e4fd1af942f405e5f8e2aee3e5a6e89df8861c0`。
- [grid_budget.py](source/grid_budget.py) ← `grid_budget.py`；SHA256 `03bca20e4e235e0567c94fdf0ebaa9740ebd6acf8f2a94bea301a8386d4a1649`。
- [grid_sampling.py](source/grid_sampling.py) ← `grid_sampling.py`；SHA256 `31843ddd0b8dd05a0f8debbea4c280ef84d57daf390cf8b02db131a18de4b115`。
- [integrity.py](source/integrity.py) ← `integrity.py`；SHA256 `76e4cde8b06cb318539b431942df9f944c89510cb602129571ce43a2c5489357`。
- [patch.py](source/patch.py) ← `patch.py`；SHA256 `43efc5d56cfde751adaa16eeab53a6cd9ffe2b8faa681a1fcf7f36a239b37c87`。
- [round18_test_support.py](source/round18_test_support.py) ← `round18_test_support.py`；SHA256 `1fe772d1d35f76ded9034a9b20e078f64fc0a20666779849f0a87221130c39de`。
- [scale_fixtures.py](source/scale_fixtures.py) ← `scale_fixtures.py`；SHA256 `013896d1b7e5d9bf964f5caf76b6edd3ba0d4f706c0a572e69d9e0720a92ecfd`。
- [scale_sources.py](source/scale_sources.py) ← `scale_sources.py`；SHA256 `bcf99e5cf13143da68d919a5d280a64ba7089178f7f99736d5d051af6bd380d2`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。
- [verify.py](source/verify.py) ← `verify.py`；SHA256 `c367bffd0d26ea0e0f3d317b48815ad51687427656ef5050e53f87566cf176a8`。
- [verify_structural.py](source/verify_structural.py) ← `verify_structural.py`；SHA256 `47bc215262f793889be359d12d897dd9d479fecaec87985fa2fceb244157369d`。

## 已知限制与验收边界

- 敌人集合在 `v35s` 中仍为紧凑哈希摘要，当首差出现在 `/enemies` 时无法直接展开单只敌人的条件、坐标、计数器与完整试炼进度（后续由 152 补充明细）。
- 测试服输出 SWF SHA256 `42cf9d8e9ece058ba3250f8eb0ac9bcac1a8e1494dfcefb0610a1e2e8567968f`。

来源工作区：`<WORKDIR>/v35-generic-20261018/run20`、`<WORKDIR>/outputs/apk/coop-fingerprint-20261022`（任务书 `<WORKDIR>/v35-generic-20261018/TASK20.md`）
