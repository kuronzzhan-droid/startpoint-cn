# 65 149999四拍准备音轮换

为white_wolf_gerald按原生音和alt_1至alt_3四拍轮换并预载试听

- 首发 APK 版本：**v25**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`HudMemberStatus/update`；`BattleCharacterLogic/resolveFollowingPathCollection`；`CharacterVoiceLogic/createVoicePathMap`。
- 修的问题或错误码：内容扩展；缺文件保留原生音
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:445-495`
- `C:\Users\12101\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
- `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes.HudMemberStatus/update,CharacterVoiceLogic/createVoicePathMap,BattleCharacterLogic/resolveFollowingPathCollection`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [HudMemberStatus/update](pcode/boot_ffc6--HudMemberStatus_update.pcode.txt)；body `58762`；code SHA-256 `7858113b678d100259739c4716f0729c9f3dfc75498fd101efc37f9dbaf9e50c`。
- [BattleCharacterLogic/resolveFollowingPathCollection](pcode/boot_ffc6--BattleCharacterLogic_resolveFollowingPathCollection.pcode.txt)；body `92330`；code SHA-256 `d8d6141c41bcb2d9290f8cfcfe71d5618e65127a8bab1129779fe30b6924e8ea`。
- [CharacterVoiceLogic/createVoicePathMap](pcode/boot_ffc6--CharacterVoiceLogic_createVoicePathMap.pcode.txt)；body `84274`；code SHA-256 `a3f3aa721b20af0547543fb26a0ab4227104248b6aee01289e66fea765dc14d7`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [wf_hitfx_silence.v28.py](source/wf_hitfx_silence.v28.py) ← `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py`；67,120 B；SHA-256 `d4a98723a70b5389409d364a3bf261f773b8b417ddb10bcee9a3063d3bcc2b51`。
