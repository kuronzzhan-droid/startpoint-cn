# 72 转场GC去重

1.5秒内重复显式GC只执行一次

- 首发 APK 版本：**v28**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`LogicSceneTransition/deactivatePreviousScene`；`ProductionLoading/resetAssets`；`cn.loading.GcGate/*`。
- 修的问题或错误码：性能问题，无专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `%USERPROFILE%\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py:663-707`
- `%USERPROFILE%\Downloads\世界弹射测试服-v28.build-report.json:capability/methods`
- `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [LogicSceneTransition/deactivatePreviousScene](pcode/boot_ffc6--LogicSceneTransition_deactivatePreviousScene.pcode.txt)；body `31072`；code SHA-256 `96ee8a34ddee66156b98761c766815eeec8a24f4ca1dc350a4b7f42b924c40bd`。
- [ProductionLoading/resetAssets](pcode/boot_ffc6--ProductionLoading_resetAssets.pcode.txt)；body `37884`；code SHA-256 `88f4837fd4a910380176d6fd9072c5236ea43dce3140a33ea6864346040330ce`。
- [GcGate$/skip](pcode/cn.loading.GcGate--GcGate__skip.pcode.txt)；body `0`；code SHA-256 `a00223b7235ef27c13a66128ea077eba6f97da6225b702781cd0f3a87de5589b`。
- [GcGate$/reset](pcode/cn.loading.GcGate--GcGate__reset.pcode.txt)；body `1`；code SHA-256 `c9ad1a6cdcf04b416ceac9b98f1740986e68e7a99be7544a1bb98a8682a85a4a`。
- [GcGate$/<cinit>](pcode/cn.loading.GcGate--GcGate___cinit_.pcode.txt)；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [GcGate/<ctor>](pcode/cn.loading.GcGate--GcGate__ctor_.pcode.txt)；body `3`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.loading.GcGate--anonymous-method-0.pcode.txt)；body `4`；code SHA-256 `52740a7b374657cecba183b68c1302d20c8510d24260a33589c73afd78cbc408`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [wf_hitfx_silence.v28.py](source/wf_hitfx_silence.v28.py) ← `%USERPROFILE%\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\wf_hitfx_silence.v28.py`；67,120 B；SHA-256 `d4a98723a70b5389409d364a3bf261f773b8b417ddb10bcee9a3063d3bcc2b51`。
- [GcGate.as](source/GcGate.as) ← `%USERPROFILE%\AppData\Local\Temp\claude\D--WF-startpoint-cn\3c92cbf7-5f37-4242-89f5-9470072d4201\scratchpad\apk28\src\cn\loading\GcGate.as`；897 B；SHA-256 `49036c9c1699d3d308d0de2a53447358d9fb54a40d10c68d5890fa72737eb70a`。
