# 55 凯尔 PF 追加命中标记静音

识别凯尔 PF 追加判定区的专用命中特效标记，省去该追加命中的数字、特效、音效和闪烁。

- 首发 APK 版本：**v18**。
- v33 使用的最终修订：v25 修订；v28 源体与 v33 相同。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`EnemyImpl/applyAttack`。
- 修的问题或错误码：凯尔 PF 多次追加产生重复表现；没有错误码。最终 v25 删除普通多段直击的通用静音，只保留专用 marker。
- 依赖：数据端以 attack_to_hostile_hit 且 randomRotation=false 标记凯尔 PF 追加命中；普通直击无需该标记
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\apk\世界弹射测试服-v18.build-report.json:2-12；v18 首发能力与 v17 基线`
- `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:285-296；最终只保留 PF marker 分支`
- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\build\kyle_pf_marker.py:2-3；数据标记用途`
- `D:\WF\out\kulo-patch-toolkit\cursed_abyss\build\kyle_pf_marker.py:14-25；marker 数据编码和作用范围`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [EnemyImpl/applyAttack](pcode/boot_ffc6--EnemyImpl_applyAttack.pcode.txt)；body `53486`；code SHA-256 `989cd6d4d05f0e88c4073ad3d6107bff66c2e8438247e14097b6144ed56e957e`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [wf_hitfx_silence.v28.py](source/wf_hitfx_silence.v28.py) ← `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py`；67,120 B；SHA-256 `d4a98723a70b5389409d364a3bf261f773b8b417ddb10bcee9a3063d3bcc2b51`。
