# 03 冲刺参数能力422

支持由能力修改冲刺参数的解析、文案、汇总和战斗执行

- 首发 APK 版本：**v12**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`AbilityValues$/parseAt109`；`DuringAbilitySource$/createFromDuringAbilityValues`；`BattleAbilityTotalizerImpl/addDuringContent`；`BallImpl/update`；`BallImpl/findEscapeTarget`；`BallImpl/tryEscape`；`BallImpl/canEscapeNow`。
- 修的问题或错误码：C7050：未支持的新枚举解析
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\newchars-v14-20260908\BUILD.md:8`
- `D:\WF\out\newchars-v14-20260908\BUILD.md:244-248`
- `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:39-43`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [AbilityValues$/parseAt109](pcode/boot_ffc6--AbilityValues__parseAt109.pcode.txt)；body `39060`；code SHA-256 `3e42c85d4ee45ce33be9a7aec70e350a2303ce3cb7132dd0e8183c02310516eb`。
- [BattleAbilityTotalizerImpl/addDuringContent](pcode/boot_ffc6--BattleAbilityTotalizerImpl_addDuringContent.pcode.txt)；body `51465`；code SHA-256 `8d64bbf5744ba5a257ee6f81e46eec7995868d8eb62f6df6583411bcfde0d4bc`。
- [BallImpl/update](pcode/boot_ffc6--BallImpl_update.pcode.txt)；body `59818`；code SHA-256 `7b51eee71693ca74a1f69feacc7220cbcf60fb27b2c617e9b6cf9a367c7594bd`。
- [BallImpl/findEscapeTarget](pcode/boot_ffc6--BallImpl_findEscapeTarget.pcode.txt)；body `59973`；code SHA-256 `eff8bb9bf1840c36e2e9b3076759397f31a492ee31de4e8d0323eb671801facc`。
- [BallImpl/tryEscape](pcode/boot_ffc6--BallImpl_tryEscape.pcode.txt)；body `59819`；code SHA-256 `0a8f0df53ce4171c79c2e29b1a5ebfd6777211a65c5353f1e3777a3feda5c2c7`。
- [BallImpl/canEscapeNow](pcode/boot_ffc6--BallImpl_canEscapeNow.pcode.txt)；body `60011`；code SHA-256 `487e8f3e1fbc2be41fc00aaddb468f5db239fb7eb014fbe796720f85dea5f268`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [abcpatch.py](source/abcpatch.py) ← `D:\WF\out\q1056\rv4p\client-patch\dash-parameter\abcpatch.py`；27,276 B；SHA-256 `a004add43ffed6c901cc6ca92dee2472f58d9860ec10275b6715ca91ad58027b`。

## 未收与限制

- 最终 boot_ffc6:DuringAbilitySource$/createFromDuringAbilityValues 的完整 P-code 文本为 1,045,521 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
