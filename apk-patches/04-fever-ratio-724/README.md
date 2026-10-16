# 04 Fever 槽百分比增减724

新增按 Fever 满槽比例加减槽的瞬时能力，配套解析、文案和执行

- 首发 APK 版本：**v12**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`AbilityValues$/parseAt47`；`InstantAbilitySource$/resolveInstantContent`；`AbilitySlotImpl/applyInstantBattle`。
- 修的问题或错误码：C7050：未支持的新枚举解析
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\newchars-v14-20260908\BUILD.md:8`
- `D:\WF\out\newchars-v14-20260908\BUILD.md:244-248`
- `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:26-43`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [AbilitySlotImpl/applyInstantBattle](pcode/boot_ffc6--AbilitySlotImpl_applyInstantBattle.pcode.txt)；body `51424`；code SHA-256 `0c6c80690b2862bbbd44a962a5225296e5c1ffac862cd1f9a8e6b9e513560d25`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [abcpatch.py](source/abcpatch.py) ← `D:\WF\out\q1056\rv4p\client-patch\kyubi-fever-ratio\abcpatch.py`；15,704 B；SHA-256 `31dcd6614d925034c008c330d441d3d0d6a7f734a7143afd530d5815d9e846ed`。

## 未收与限制

- 最终 boot_ffc6:AbilityValues$/parseAt47 的完整 P-code 文本为 848,725 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
- 最终 boot_ffc6:InstantAbilitySource$/resolveInstantContent 的完整 P-code 文本为 1,580,144 B，超过 500KB，未收完整方法；以所收插入脚本/P-code 生成块为源。
