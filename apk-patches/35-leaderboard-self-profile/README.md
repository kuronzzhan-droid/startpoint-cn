# 35 排行榜本人资料路由

点击榜单本人时打开原生本人资料，其他玩家仍走公开资料路由

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`RushEventRankingPartyScene/copyPlayedParty`。
- 修的问题或错误码：未发现专用错误码
- 依赖：rush-native-leaderboard
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\TITLE-CNTIPS.md:18-23`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [RushEventRankingPartyScene/copyPlayedParty](pcode/boot_ffc6--RushEventRankingPartyScene_copyPlayedParty.pcode.txt)；body `71000`；code SHA-256 `e44d600bf617c0b100dbc4b2aebadb9f977a72d9b0a4f651719f9627f4cdef00`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_self_profile_lan_apk.py](source/build_self_profile_lan_apk.py) ← `D:\WF\startpoint-cn-kulo\client-patch\rush-leaderboard\build_self_profile_lan_apk.py`；8,642 B；SHA-256 `71836144e6f8fe6c11f65aece132d351d7d6fe3aebffd7268ff09081f05f2aea`。
