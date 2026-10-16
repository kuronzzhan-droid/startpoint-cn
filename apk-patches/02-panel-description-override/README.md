# 02 能力与队长技文案覆盖

按 desc_override_<string_id> 显示作者文案，缺表时沿用原文避免8013

- 首发 APK 版本：**v11（v14 泛化与安全取表）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`AbilityLogic/getDescriptions`；`AbilityLogic/getDescriptionWithSimplify`；`LeaderAbilityLogic/getDescriptions`；`LeaderAbilityLogic/getDescriptionWithSimplify`。
- 修的问题或错误码：8013：CustomAbilityStringTable 未加载时原 getMasterTable 会抛错
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\newchars-v14-20260908\BUILD.md:19-33`
- `D:\WF\out\newchars-v14-20260908\BUILD.md:85-108`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [AbilityLogic/getDescriptions](pcode/boot_ffc6--AbilityLogic_getDescriptions.pcode.txt)；body `7341`；code SHA-256 `3e396ebe35c717c1e064f14bf2b9708672ab7352f0a5271c48e5397e875a3e27`。
- [AbilityLogic/getDescriptionWithSimplify](pcode/boot_ffc6--AbilityLogic_getDescriptionWithSimplify.pcode.txt)；body `7342`；code SHA-256 `229ef6943988233f9f13b8201dc12d8180bf571ba041e16b96a0aad42dde26a9`。
- [LeaderAbilityLogic/getDescriptions](pcode/boot_ffc6--LeaderAbilityLogic_getDescriptions.pcode.txt)；body `7678`；code SHA-256 `3e396ebe35c717c1e064f14bf2b9708672ab7352f0a5271c48e5397e875a3e27`。
- [LeaderAbilityLogic/getDescriptionWithSimplify](pcode/boot_ffc6--LeaderAbilityLogic_getDescriptionWithSimplify.pcode.txt)；body `7679`；code SHA-256 `229ef6943988233f9f13b8201dc12d8180bf571ba041e16b96a0aad42dde26a9`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [pcode.py](source/pcode.py) ← `D:\WF\out\q1056\rv4p\client-patch\kyubi-panel-override\pcode.py`；12,328 B；SHA-256 `2b20d3afecac4e43a88ff06fbe3439cd36328e8448c9d92f29c2d96861baada9`。
