# 150 联机状态指纹稀疏精简采样降开销（compact-v2）

- 首发版本：v35r / 1008017（run18）
- capability：`coop-state-fingerprint-compact-v2`（build `v35r`）
- 依赖前置补丁：149（基于 v35q SWF 叠加）
- 对应数据边：无客户端数据表变更；服务端需识别 `schema: coop-state-fingerprint-compact-v2`

## 作用

将状态指纹从逐帧全量/差量改为稀疏精简检查点（`coop-state-fingerprint-compact-v2`）：每个 Battle 采一次 initial，之后默认每 30 逻辑帧采一次精简 full，取消逐帧快照与 JSON 差量计算；输入仅统计顶层类别计数与有序哈希摘要，大集合采用排序后双 32 位哈希摘要；引入单次检查点耗时自适应升降档（>2ms 翻倍至最多 300 帧，连续 8 次低耗时减半恢复至 30 帧）及全客户端共享 20,000 B/s 滚动窗口上行预算，离线指令开销降低 86%–89%。

## 改动类与方法

- 修改 5 个既有诊断方法：`Battle$/wfxFpSample`、`Battle$/wfxFpCapture`、`Battle$/wfxFpInputEvent`、`Battle$/wfxFpDrain`、`Battle$/wfxFpEnvelope`。
- 在 `Battle` 类追加 22 个静态辅助方法（`wfxFpAdapt`、`wfxFpCaptureSummary`、`wfxFpCompact*`、`wfxFpHash*`、`wfxFpInputSummary`、`wfxFpRecord*`、`wfxFpReserveUplink`、`wfxFpSampleCompact`、`wfxFpSortStrings`、`wfxFpSummaryRow`、`wfxFpUplinkState`）及静态槽 `Battle.wfxFpUplink`。

## 开关与数据写法

- 沿用 `Battle.wfxFpEnabled` 静态开关（默认 `true`）；协议 schema 升级为 `coop-state-fingerprint-compact-v2`，build 标记为 `v35r`。

## 最终 P-code

- [Battle_static/wfxFpAdapt](pcode/Battle_static__wfxFpAdapt.pcode.txt)；文件 SHA256 `98673f632f16ec2b3e4ed0bbf3e1134efb86f03a800948c3d2dfe8b414fe4c50`（`Battle$/wfxFpAdapt header=[27, 8, 1, 2] sha=ab982b75bfa2004f43dcac1ab54be0721bc4d3213dc9807805406788b9be7eb2`）。
- [Battle_static/wfxFpCapture](pcode/Battle_static__wfxFpCapture.pcode.txt)；文件 SHA256 `de91863e0d8889156e0b7e4a15659cd99ed16833493d04499bf6b5d09ceca7ea`（`Battle$/wfxFpCapture header=[5, 5, 1, 2] sha=87e4f52f624d6c1fdfbec9f0efeb008af1c3653b7c5ad8e962cad4e2f77d6555`）。
- [Battle_static/wfxFpCaptureSummary](pcode/Battle_static__wfxFpCaptureSummary.pcode.txt)；文件 SHA256 `dce68bcc1308563e5f0aebb177d4acaae4497558bc401e0399754de34c3342e5`（`Battle$/wfxFpCaptureSummary header=[4, 11, 1, 2] sha=71da3340680ec2053781f3bcf60dc3c0ea764ec672de711a2e905f36bab1b893`）。
- [Battle_static/wfxFpCompactEnemy](pcode/Battle_static__wfxFpCompactEnemy.pcode.txt)；文件 SHA256 `f37d2f0a9aaa252d691911895219a935a9cdaf015127a95f067bd9911409c7cf`（`Battle$/wfxFpCompactEnemy header=[9, 11, 1, 2] sha=817ba22a7e7acbd4a601ce68db51b109ba83dd035ff5ec56b46d329bb40ae916`）。
- [Battle_static/wfxFpCompactFunnels](pcode/Battle_static__wfxFpCompactFunnels.pcode.txt)；文件 SHA256 `534d5dc5e50dcf127cf049cb8b3e803d256c0a2d0408949fce78bd8431347bc6`（`Battle$/wfxFpCompactFunnels header=[5, 5, 1, 2] sha=0110da8a21f2b62068d3d47fd1f0048eaee4d640778f7975a603aa6fdbdc27ac`）。
- [Battle_static/wfxFpCompactFunnelSub](pcode/Battle_static__wfxFpCompactFunnelSub.pcode.txt)；文件 SHA256 `25893f4e9e89465ba82bee27d9352812ee8dfeabb54c0017267869dca700d4cf`（`Battle$/wfxFpCompactFunnelSub header=[7, 8, 1, 2] sha=f0576af7481a79ae3af7cabb90bf37f97769057028e7d74d198256f5fcd1efb0`）。
- [Battle_static/wfxFpCompactModifier](pcode/Battle_static__wfxFpCompactModifier.pcode.txt)；文件 SHA256 `6db56b723d9fd99c15e29b2bf956a1b209f661c570b6d835edb37cac946a9798`（`Battle$/wfxFpCompactModifier header=[14, 4, 1, 2] sha=6963bab78ceacec91da4b62a687d211e684ecb7da1462d819a9001873262efc1`）。
- [Battle_static/wfxFpCompactRng](pcode/Battle_static__wfxFpCompactRng.pcode.txt)；文件 SHA256 `55b3571311cf93d4869712e6204fa8c5f7b1806d5271cb0d9944d9afcf89c5d2`（`Battle$/wfxFpCompactRng header=[5, 4, 1, 2] sha=056c6e81ececb370ac63c54f64561644385d7ea4c9872a9a180a5641c78e55c6`）。
- [Battle_static/wfxFpCompactSet](pcode/Battle_static__wfxFpCompactSet.pcode.txt)；文件 SHA256 `35c7b058444bbf8345d1ef9a60beca83557cfa9e50fc05846a587d44bb30407b`（`Battle$/wfxFpCompactSet header=[6, 10, 1, 2] sha=6c6f710845721e3238c079625b319bb0945a5a042b6bfe971d2b1a2c63b27ff9`）。
- [Battle_static/wfxFpCompactSnapshot](pcode/Battle_static__wfxFpCompactSnapshot.pcode.txt)；文件 SHA256 `2021106da4bfc4a1168a3f90ec8facacb2f4b049359a601fcf5175bba03102bf`（`Battle$/wfxFpCompactSnapshot header=[5, 10, 1, 2] sha=d33538a928e5a95d39f394230bf2eb7eff5b061a2da1efe05de1a3b92a6f54a5`）。
- [Battle_static/wfxFpCompactTrial](pcode/Battle_static__wfxFpCompactTrial.pcode.txt)；文件 SHA256 `213e997bd3cfbf793b0216308243f6255b15523ab44ff4856f563b809506a14b`（`Battle$/wfxFpCompactTrial header=[6, 9, 1, 2] sha=03a5a0037f208dbba7a2e187f97f4d8f0be1e555d05368312efebe9556cf9a42`）。
- [Battle_static/wfxFpDrain](pcode/Battle_static__wfxFpDrain.pcode.txt)；文件 SHA256 `15d1ea02fc62abc78a99e4151737a49ce3f99e5f664081859ec79d1f47ce3145`（`Battle$/wfxFpDrain header=[5, 10, 1, 2] sha=409cc578ed05ed6ab0431d1a8159192816ba08eb3d7d54dd1134077fc5d4a8ea`）。
- [Battle_static/wfxFpDrainLimited](pcode/Battle_static__wfxFpDrainLimited.pcode.txt)；文件 SHA256 `8f9a24bc41c23e8bf0870999c9d7d640c4e71c3166517423f1dd9ad949a6385c`（`Battle$/wfxFpDrainLimited header=[9, 7, 1, 2] sha=f6104cfb44f17568fcf0f64bbd6fa14b458ec61c1f3f7feb6df35bfcd2f0abb6`）。
- [Battle_static/wfxFpEnvelope](pcode/Battle_static__wfxFpEnvelope.pcode.txt)；文件 SHA256 `dd2775545e7871f93609be5c28471c7b6fa5b12880fbceb1f656531e3342bef6`（`Battle$/wfxFpEnvelope header=[16, 7, 1, 2] sha=4ba1023c64d757e7db461cc51d0e93b22d81a77eb80f063b9eaa74e63b85e649`）。
- [Battle_static/wfxFpEventSummary](pcode/Battle_static__wfxFpEventSummary.pcode.txt)；文件 SHA256 `ec6c7a66efabcbfb90383420d552b23f19862cc3f2135a812f674860f866c43f`（`Battle$/wfxFpEventSummary header=[4, 13, 1, 2] sha=73e3ac2f486ce7697f0d984ef99154fc1433fe25c098d33599f4fc6025818d5b`）。
- [Battle_static/wfxFpInputEvent](pcode/Battle_static__wfxFpInputEvent.pcode.txt)；文件 SHA256 `1ff1b12280d1ce4934b835f457317c7641e03df6e134605346778543e38b0d04`（`Battle$/wfxFpInputEvent header=[20, 18, 1, 2] sha=c7a0030c8eec219c75c9d6cb0c3ad1783425042dfee5f1b9c9dbd799af3d3a11`）。
- [Battle_static/wfxFpInputSummary](pcode/Battle_static__wfxFpInputSummary.pcode.txt)；文件 SHA256 `8bfbbb0483c30c5a879f5e7ab1a8cbda1426769e0b4fad1e60e7ccd4b811bdcc`（`Battle$/wfxFpInputSummary header=[20, 3, 1, 2] sha=ab1c9760a6145ffab4b4ee29936466f15c9fe6eeff363275210caa60971a2d53`）。
- [Battle_static/wfxFpReserveUplink](pcode/Battle_static__wfxFpReserveUplink.pcode.txt)；文件 SHA256 `6ad1762d61d018232850897c3b370cb5e9271132f01de1f6dc1ce71dbb476014`（`Battle$/wfxFpReserveUplink header=[8, 8, 1, 2] sha=7deabdc1a81afdb704ead1dce4df9acdb1cf077806526a2f4b19f9c8826da0a5`）。
- [Battle_static/wfxFpRouteSummary](pcode/Battle_static__wfxFpRouteSummary.pcode.txt)；文件 SHA256 `54a8e68e502c3783a23fb22f59f9393a6a1a2eb89979c803564a48267ea60a89`（`Battle$/wfxFpRouteSummary header=[26, 3, 1, 2] sha=f0f5a469f651ed2bb1aa86f8909d3af08b2057aa28f65c5739bfcb5cfbc88e9d`）。
- [Battle_static/wfxFpSample](pcode/Battle_static__wfxFpSample.pcode.txt)；文件 SHA256 `fd8e173df15a2a5c3766f73294d6160b260a5c4de4f9b02261f373bd76500506`（`Battle$/wfxFpSample header=[18, 11, 1, 2] sha=b7e54adb8ecefcd4e3a1ce8ed757ed9fbbb72d0aee91175d90276815cc54c3bb`）。
- [Battle_static/wfxFpSampleCompact](pcode/Battle_static__wfxFpSampleCompact.pcode.txt)；文件 SHA256 `8c81a9ea6a9dd1ffa0674a2fdf839308f54f959179145efed308504755be3b1b`（`Battle$/wfxFpSampleCompact header=[28, 12, 1, 2] sha=2b8e7730f5df03559528fd5649992ba7bf370fff394070481faab59c13000d47`）。
- [Battle_static/wfxFpSummaryHash](pcode/Battle_static__wfxFpSummaryHash.pcode.txt)；文件 SHA256 `614b223e42a169c013a31e526aea25a612bbdb26f02f652ae561aa71334d005a`（`Battle$/wfxFpSummaryHash header=[3, 5, 1, 2] sha=bfe10530e6081ac358b3cd1d3ac21d70a2d3c74db626b5160616806d03ac5368`）。
- [Battle_static/wfxFpSummaryRecord](pcode/Battle_static__wfxFpSummaryRecord.pcode.txt)；文件 SHA256 `e5cadd27971e8fdf6aefcadc98ba664da32c1062bbf2aecffa23c447004923f0`（`Battle$/wfxFpSummaryRecord header=[4, 5, 1, 2] sha=2684890fcd8643ed0f993271a141c5e36f559a5d1d798adb90c5b66147a7e0bf`）。
- [Battle_static/wfxFpSummaryScalar](pcode/Battle_static__wfxFpSummaryScalar.pcode.txt)；文件 SHA256 `8557d3e3380ada1141f21e0151dd6de2221fbd658d1a63a4b805e7364f3e1ec9`（`Battle$/wfxFpSummaryScalar header=[2, 2, 1, 2] sha=c9144fabebb72993beabd5058589f50825665544bfec497f9f8104515a52c294`）。
- [Battle_static/wfxFpSummaryUnknown](pcode/Battle_static__wfxFpSummaryUnknown.pcode.txt)；文件 SHA256 `43bcb7e171f03617c3307c5eabe40e3ade9fe6ac6111bc8b652cf89e03d10743`（`Battle$/wfxFpSummaryUnknown header=[5, 4, 1, 2] sha=d8a72864767a347553f66f5484d5236d87119e76d114326a8bb9720678634911`）。
- [Battle_static/wfxFpTakeInputSummary](pcode/Battle_static__wfxFpTakeInputSummary.pcode.txt)；文件 SHA256 `913cc4ed2339add4930144bbaef5417706b546c67af58399d6630c182a2b8eb3`（`Battle$/wfxFpTakeInputSummary header=[2, 3, 1, 2] sha=a6e8792139294daeb80f2c2812e893b8c69e7f1a56177f88e6a0127226f04573`）。
- [Battle_static/wfxFpTakeRouteSummary](pcode/Battle_static__wfxFpTakeRouteSummary.pcode.txt)；文件 SHA256 `51c64efef864af43c16688e317d68038d0ea26c6a0fe8a21a97cfe33ce241c93`（`Battle$/wfxFpTakeRouteSummary header=[2, 3, 1, 2] sha=c0fd455b050368de13d3c6e6d698f67e350da3f82c5c5b81580b79cc49642429`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `62a9658c8f1fc78c1e604aacebe022189fdd2f92fc77310406c85f5a711605bf`。
- [build.py](source/build.py) ← `build.py`；SHA256 `72b37b88793d6fa0deb2d4b362f880e92a2c763e610c7e799321797e92eb9901`。
- [compact_fields.py](source/compact_fields.py) ← `compact_fields.py`；SHA256 `6c29587f59048a1f5708913e4bf2e932c8ab311e8ba570b8e5517d337f61cfbf`。
- [compact_fields_codec.py](source/compact_fields_codec.py) ← `compact_fields_codec.py`；SHA256 `44ef5fbb71109f06e514dd1bd0f319cca7228a2b1ff436920625ae15d7a7d7b2`。
- [compact_fields_enemy.py](source/compact_fields_enemy.py) ← `compact_fields_enemy.py`；SHA256 `1563c6e3bf3ffb13ea729a30850319739d1f44bc693eb0ceb2fa85966c7ba626`。
- [compact_fields_zone.py](source/compact_fields_zone.py) ← `compact_fields_zone.py`；SHA256 `684591b7cde06f05827a5dec0e320079fa65aba3a1c05239e1f1c8e852017211`。
- [compact_input_helpers.py](source/compact_input_helpers.py) ← `compact_input_helpers.py`；SHA256 `ee342eb6d5881579ca15aa0d8e97e19ba30745521fb0ba8974a281e455255074`。
- [compact_inputs.py](source/compact_inputs.py) ← `compact_inputs.py`；SHA256 `4e419fac40d4fee37cc11080daabd5f03abfbe6c9d7b32cb49a4efd1c88454dc`。
- [compact_sampling.py](source/compact_sampling.py) ← `compact_sampling.py`；SHA256 `36a8d8a8aca81a39b0c5477fac57b96367dc96605e41f5dcefd9618591cee66b`。
- [compact_test_vm.py](source/compact_test_vm.py) ← `compact_test_vm.py`；SHA256 `c69560d1d4563426c3024f8e9239f3fdad5d781d222a2e8d19a9d2361a7be2a6`。
- [compact_transport.py](source/compact_transport.py) ← `compact_transport.py`；SHA256 `c465f3b208fd388a9414a0508b369f982d5e43a8d6b8c2e59e02edfc44435db2`。
- [fp_transport_codegen.py](source/fp_transport_codegen.py) ← `fp_transport_codegen.py`；SHA256 `6c0941dc27e19f68452730012d869bb3824bdfcc364efef541e1ce9fd07d5c79`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `1f5d1ad4d9c35fd34efff8c64e4fd1af942f405e5f8e2aee3e5a6e89df8861c0`。
- [integrity.py](source/integrity.py) ← `integrity.py`；SHA256 `76e4cde8b06cb318539b431942df9f944c89510cb602129571ce43a2c5489357`。
- [patch.py](source/patch.py) ← `patch.py`；SHA256 `6e0e95ebfae2d8a3b336b1f6aeff65e8ca04ba9e95c1f952f543a8cbe73a9536`。
- [round18_test_support.py](source/round18_test_support.py) ← `round18_test_support.py`；SHA256 `1fe772d1d35f76ded9034a9b20e078f64fc0a20666779849f0a87221130c39de`。
- [scale_fixtures.py](source/scale_fixtures.py) ← `scale_fixtures.py`；SHA256 `013896d1b7e5d9bf964f5caf76b6edd3ba0d4f706c0a572e69d9e0720a92ecfd`。
- [scale_sources.py](source/scale_sources.py) ← `scale_sources.py`；SHA256 `bcf99e5cf13143da68d919a5d280a64ba7089178f7f99736d5d051af6bd380d2`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。
- [verify.py](source/verify.py) ← `verify.py`；SHA256 `d23d89f94a91625ffba6b2319d2f9654d8c6179fe686e1f931c0b49902ed13e5`。
- [verify_structural.py](source/verify_structural.py) ← `verify_structural.py`；SHA256 `47bc215262f793889be359d12d897dd9d479fecaec87985fa2fceb244157369d`。

## 已知限制与验收边界

- `run18` 仅在副本 `BattleDerailleur.proceed` 入口绑定，遗漏了本机主战斗 `myBattleDriver.battle` 的绑定，且相对采样间隔在自适应升档后会导致不同端采样帧相位错开（已在 151 修复）。
- 测试服输出 SWF SHA256 `ce5e1b4d62ae879c6f204d70be7785aad3515076b0a28647e3a9d416dbb13040`。

来源工作区：`<WORKDIR>/v35-generic-20261018/run18`、`<WORKDIR>/outputs/apk/coop-fingerprint-20261022`（任务书 `<WORKDIR>/v35-generic-20261018/TASK18.md`）
