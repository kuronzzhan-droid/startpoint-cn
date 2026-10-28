# 149 联机状态指纹分片容量修复与超限诊断

- 首发版本：v35q（run17）
- capability：`coop-state-fingerprint-v1`（build `v35q`）
- 依赖前置补丁：148（基于 v35p SWF 叠加）
- 对应数据边：无客户端数据表变更

## 作用

修复 148（v35p）中每片固定最多截取 4096 个 UTF-16 码元导致约 2 MiB 逻辑 JSON 就提前耗尽 512 片上限并触发 `oversize` 丢包的问题。改为按外层 JSON 编码后的实际 UTF-8 字节数（含结尾 NUL 不超过 16,384 字节）二分查找最大分片边界，同时不切断 UTF-16 代理对；并新增 `oversize.logical_limit_bytes`、`oversize.part_limit_bytes`、`oversize.constructed_parts` 生命周期诊断事件。

## 改动类与方法

- 修改 `Battle$/wfxFpPack`、`Battle$/wfxFpEnvelope`（build 标识更新为 `v35q`）。
- 在 `Battle` 类尾部追加静态辅助方法 `Battle$/wfxFpChunkEnd`、`Battle$/wfxFpOversizeInfo`。

## 开关与数据写法

- 沿用 `Battle.wfxFpEnabled` 静态开关（默认 `true`）及 `wf-fp v1` 协议外壳。

## 最终 P-code

- [Battle_static/wfxFpChunkEnd](pcode/Battle_static__wfxFpChunkEnd.pcode.txt)；文件 SHA256 `ca3d391241fd2983263b40a2a7340151ee0d03e174c7ad3fc1274630de799a61`（`Battle$/wfxFpChunkEnd header=[7, 11, 1, 2] sha=5577addbb9204cc281038c95645a265e92a9a35ea1c6ff853f4e0a0ed0fda159`）。
- [Battle_static/wfxFpEnvelope](pcode/Battle_static__wfxFpEnvelope.pcode.txt)；文件 SHA256 `b7e7e3a9110c57e6878d2b7411dff3b40935c8214057f0ffe8882c3092811752`（`Battle$/wfxFpEnvelope header=[16, 7, 1, 2] sha=030b470f35d7e32138dac223a72a5aa05c670df95e99d8a35a492e039cb812c9`）。
- [Battle_static/wfxFpOversizeInfo](pcode/Battle_static__wfxFpOversizeInfo.pcode.txt)；文件 SHA256 `120149e73075a499059ed54c681a66fddc2b94305be893c6ba14b5239fe34f1d`（`Battle$/wfxFpOversizeInfo header=[23, 8, 1, 2] sha=d5acc16b6a290cd9230e3e518fd43b39de0fbc377c4786be59ed512c32d9497f`）。
- [Battle_static/wfxFpPack](pcode/Battle_static__wfxFpPack.pcode.txt)；文件 SHA256 `19880848ce8a2651fbe1e65f47864ab8f04741c69032fc21913d5200b3a74d78`（`Battle$/wfxFpPack header=[7, 16, 1, 2] sha=7dc9bcdd0ad079c1988696b4aa721b02e11d3dd84b1ea24996fed7f54fb1bbdb`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `6eb22589021246cd4477d9af3ee8a6689c23de2d9536ddfcf2b15dba9fa214a9`。
- [build.py](source/build.py) ← `build.py`；SHA256 `84a24bb8b8e17ccd64e89c649720dcf69fa623635be3d1896e8192bd06616332`。
- [fp_transport_codegen.py](source/fp_transport_codegen.py) ← `fp_transport_codegen.py`；SHA256 `6c0941dc27e19f68452730012d869bb3824bdfcc364efef541e1ce9fd07d5c79`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `1f5d1ad4d9c35fd34efff8c64e4fd1af942f405e5f8e2aee3e5a6e89df8861c0`。
- [inheritance.py](source/inheritance.py) ← `inheritance.py`；SHA256 `552cf3882624fff7f7f4b4387d16a545e61e2cf50b43d59e22b6a8f8986e6a44`。
- [integrity.py](source/integrity.py) ← `integrity.py`；SHA256 `76e4cde8b06cb318539b431942df9f944c89510cb602129571ce43a2c5489357`。
- [oversize_diag.py](source/oversize_diag.py) ← `oversize_diag.py`；SHA256 `734c8ab1cb0695c0125bcf19195a1459b0bd6991648750244117e980d0351025`。
- [patch.py](source/patch.py) ← `patch.py`；SHA256 `9b8056aa91d78535d4a2605b8337b42f453e076516a7804622d4cc3b41a0f33f`。
- [scale_boundaries.py](source/scale_boundaries.py) ← `scale_boundaries.py`；SHA256 `ef84287a2d6fdbe07f7115974299414912cb8b4e101736c38e4ae7008be7c715`。
- [scale_fixtures.py](source/scale_fixtures.py) ← `scale_fixtures.py`；SHA256 `013896d1b7e5d9bf964f5caf76b6edd3ba0d4f706c0a572e69d9e0720a92ecfd`。
- [scale_flow.py](source/scale_flow.py) ← `scale_flow.py`；SHA256 `125c35a5ef939c3cd5b2ec6b6a4ff2e0291c78029d836cef88eeede8844b09da`。
- [scale_sources.py](source/scale_sources.py) ← `scale_sources.py`；SHA256 `bcf99e5cf13143da68d919a5d280a64ba7089178f7f99736d5d051af6bd380d2`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。
- [verify.py](source/verify.py) ← `verify.py`；SHA256 `8fc92686c25da4efa8d6bab0e51258b266f48c9e36bd3f52e53e7d189ffeac44`。
- [verify_structural.py](source/verify_structural.py) ← `verify_structural.py`；SHA256 `47bc215262f793889be359d12d897dd9d479fecaec87985fa2fceb244157369d`。

## 已知限制与验收边界

- 仍保留逐帧采样，高密度战斗下客户端每帧开销依然较大（后续由 150 改为稀疏精简检查点）。
- 测试服输出 SWF SHA256 `f3032a18e4f44c107c8f433f5c94b9f2a02b4fc1732f5c6f60aa30b3af4ef0c3`。

来源工作区：`<WORKDIR>/v35-generic-20261018/run17`（任务书 `<WORKDIR>/v35-generic-20261018/TASK17.md`）
