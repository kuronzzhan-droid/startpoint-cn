# 54 凯尔队长直击固有参数倍率

由凯尔专用固有状态层数控制直击基础倍率和每连击加成，使倍率配置落在数据中。

- 首发 APK 版本：**v18**。
- v33 使用的最终修订：v21 参数化；最终随 v28 组合源继承。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MemberImpl/scheduleDirectAttack 的 kyle 块`。
- 修的问题或错误码：v18 初版硬编码倍率/连击上限；最终版改为 13999011 基础倍率 × (1 + 13999012 层数 × combo / 10000)，无另设 combo 设计上限。
- 依赖：凯尔队长且 mainCharacterStringId=kyle_moon；固有 13999011/13999012 的数据配置
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v18.build-report.json:2-12；v18 首发`
- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v21.build-report.json:163-167；v21 参数化公式`
- `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:266-284；最终公式和队长限制`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberImpl/scheduleDirectAttack](pcode/boot_ffc6--MemberImpl_scheduleDirectAttack.pcode.txt)；body `60192`；code SHA-256 `223640cd78b631640313859bb39410d270696644f058435cd1258c88c9f30576`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [wf_hitfx_silence.v28.py](source/wf_hitfx_silence.v28.py) ← `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py`；67,120 B；SHA-256 `d4a98723a70b5389409d364a3bf261f773b8b417ddb10bcee9a3063d3bcc2b51`。
