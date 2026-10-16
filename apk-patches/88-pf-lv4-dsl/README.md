# 88 PF Lv4 DSL 选择

队长拍板快照连击至少 100 时优先使用 forLevels=4 的 override，仍走 Lv3 乘区。

- 首发 APK 版本：**v32**。
- v33 使用的最终修订：v32f。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MemberImpl/startPowerFlip`。
- 修的问题或错误码：无明确错误码；支持新增 PF Lv4 功能。
- 依赖：v28 kyubiPowerFlipInitialCombo 写点
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py:127-158`
- `D:\WF\out\赛瑞斯重做-20261015\apk\out\世界弹射测试服-v32f-pflv4.build-report.json:29-34`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberImpl/startPowerFlip](pcode/boot_ffc6--MemberImpl_startPowerFlip.pcode.txt)；body `60180`；code SHA-256 `0aaa43db85c048dda9784925de22fccc38068f638449fcb59938420f12fc2d6b`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [pflv4_patches.py](source/pflv4_patches.py) ← `D:\WF\out\赛瑞斯重做-20261015\apk\pflv4_patches.py`；24,815 B；SHA-256 `623cbe32a7cb7b950b12fd4ef03a3e50c0c4354ba195d4c7e3890746fdfb64e1`。
- [build_pflv4_apk.py](source/build_pflv4_apk.py) ← `D:\WF\out\赛瑞斯重做-20261015\apk\build_pflv4_apk.py`；5,761 B；SHA-256 `6c39dfc5c0bc61e2860dbd05fba30fd839348de61fc3cf2ff0f931f26eb0b929`。
