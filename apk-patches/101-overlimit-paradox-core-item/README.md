# 101 悖论之核双道具次数限制

超限可突破次数取结晶数、悖论之核数、剩余次数的最小值。

- 首发 APK 版本：**v31**。
- v33 使用的最终修订：v31，后续原样继承。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`OwnedCharacterLogic/getPossibleOverLimitCountByItem`。
- 修的问题或错误码：无明确错误码；为超限功能的客户端规则支持。
- 依赖：O1；O2；O3；O4
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

本条是 v31 已构建、v33 实际保留的 O5 双道具限制：超限仍消耗悖论之核。用户已澄清，尚未构建的是后续 O5 零核调整（超限突破不再消耗悖论之核），两者分别登记。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\角色超限-120\apk\overlimit_patches.py:170-217`
- `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v31-overlimit120.build-report.json:108-113`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [OwnedCharacterLogic/getPossibleOverLimitCountByItem](pcode/boot_ffc6--OwnedCharacterLogic_getPossibleOverLimitCountByItem.pcode.txt)；body `17768`；code SHA-256 `7fa65be8a2181e01a0a17b400d74fecbd0565c2600be4e78a7be8d96a94e837e`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [overlimit_patches.py](source/overlimit_patches.py) ← `D:\WF\out\角色超限-120\apk\overlimit_patches.py`；15,453 B；SHA-256 `1971f1c69925e15786ec2931503238623c66bc6ba175b8564435054510ea7496`。
- [build_overlimit_apk.py](source/build_overlimit_apk.py) ← `D:\WF\out\角色超限-120\apk\build_overlimit_apk.py`；11,436 B；SHA-256 `3896b43ef3aa495cb2cac8bac82fed9403df1ea8fd4efe50af045d7d1fda3a13`。
