# 95 通用技能准备 alt 预载

战斗预载正常和变身技能准备路径的连续 alt，最多五条且遇缺号停止。

- 首发 APK 版本：**v33**。
- v33 使用的最终修订：v33。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattleCharacterLogic/resolveFollowingPathCollection`。
- 修的问题或错误码：无明确错误码；为通用语音轮换功能。
- 依赖：V1
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\角色超限-120\apk\voice_patches.py:132-174`
- `D:\WF\out\角色超限-120\apk\out\世界弹射测试服-v33-voiceready.build-report.json:30-35`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattleCharacterLogic/resolveFollowingPathCollection](pcode/boot_ffc6--BattleCharacterLogic_resolveFollowingPathCollection.pcode.txt)；body `92330`；code SHA-256 `d8d6141c41bcb2d9290f8cfcfe71d5618e65127a8bab1129779fe30b6924e8ea`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [voice_patches.py](source/voice_patches.py) ← `D:\WF\out\角色超限-120\apk\voice_patches.py`；14,417 B；SHA-256 `cebbe4868343265d7e9d711d71d20eaadfabf5699c8d6d941a899118811d0ff8`。
- [build_voice_apk.py](source/build_voice_apk.py) ← `D:\WF\out\角色超限-120\apk\build_voice_apk.py`；3,766 B；SHA-256 `4e578e1bb35e1749bb49233efbc2b147e518e43666241ffdad2c504e6f6efbd7`。
