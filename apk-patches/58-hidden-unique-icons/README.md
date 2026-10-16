# 58 hidden_ 固有图标与翻页计数过滤

不在状态栏绘制 string_id 以 hidden_ 开头的固有状态，并以过滤后数量计算翻页。

- 首发 APK 版本：**v23**。
- v33 使用的最终修订：v25 同步翻页计数最终修订。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MemberImpl/getConditionsIncludingOuterEnvironments、MemberImpl/getTotalConditions`。
- 修的问题或错误码：专门承载机制的固有状态挤占图标；v23 仅过滤图标后，原始总数仍造成空页/页数不一致，v25 改用过滤后长度。
- 依赖：UniqueConditionTable.string_id 以 hidden_ 开头；状态效果和层数逻辑保留
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v23.build-report.json:2-14；v23 首发`
- `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:372-431；最终过滤和计数同源`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberImpl/getConditionsIncludingOuterEnvironments](pcode/boot_ffc6--MemberImpl_getConditionsIncludingOuterEnvironments.pcode.txt)；body `60430`；code SHA-256 `582e23ac1290798c11380451f6c0cdb7a894eb1719e3ef82dd01f3e34787af31`。
- [MemberImpl/getTotalConditions](pcode/boot_ffc6--MemberImpl_getTotalConditions.pcode.txt)；body `60292`；code SHA-256 `405cc8b1a873c66be00b5dc4b84c7e6b0acfbe84e2f673644fcbf6a9614cb7d5`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [wf_hitfx_silence.v28.py](source/wf_hitfx_silence.v28.py) ← `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py`；67,120 B；SHA-256 `d4a98723a70b5389409d364a3bf261f773b8b417ddb10bcee9a3063d3bcc2b51`。
