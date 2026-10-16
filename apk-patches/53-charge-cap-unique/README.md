# 53 强化充能速度固有上限

让固有 13999010 的层数指定高于官方上限的充能速度上限，并在原始值未超官方 MAX 时跳过状态扫描。

- 首发 APK 版本：**v18**。
- v33 使用的最终修订：v25 max-first 最终修订。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MemberImpl/getStatModifierSkillGaugeCharging`。
- 修的问题或错误码：官方上限固定；早期 1+n/50 公式后改成 n/100，最终 v25 先比较原始和再查固有以降低逐帧开销。
- 依赖：固有 13999010 层数数据；n/100 仅在高于官方 MAX 时生效
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v18.build-report.json:2-12；v18 首发`
- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v20.build-report.json:174-175；v20 修正公式`
- `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:298-312；最终 max-first P-code`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberImpl/getStatModifierSkillGaugeCharging](pcode/boot_ffc6--MemberImpl_getStatModifierSkillGaugeCharging.pcode.txt)；body `60305`；code SHA-256 `37fbc1b1aac0037ec9b75147e2bd7411d301be0a37e526e2a2d2075ad0fcda1f`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [wf_hitfx_silence.v28.py](source/wf_hitfx_silence.v28.py) ← `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py`；67,120 B；SHA-256 `d4a98723a70b5389409d364a3bf261f773b8b417ddb10bcee9a3063d3bcc2b51`。
