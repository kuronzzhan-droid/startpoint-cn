# 01 九尾 PF 弹射前连击快照

在消耗连击前保留真实连击，供私有 PF 的35连击判定使用

- 首发 APK 版本：**v10**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BallImpl/resolveCollisionForPrimaryOrSummons`；`ActionEvaluationResolver/<ctor>`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\q1056\rv4p\client-patch\kyubi-pf-combo\README.md:3-31`
- `D:\WF\out\newchars-v14-20260908\BUILD.md:8-13`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BallImpl/resolveCollisionForPrimaryOrSummons](pcode/boot_ffc6--BallImpl_resolveCollisionForPrimaryOrSummons.pcode.txt)；body `59837`；code SHA-256 `fde02ea9a9645500b28a7990bb0404d300dc4ee3184fd7bab10f3942fdd1bf52`。
- [ActionEvaluationResolver/<ctor>](pcode/boot_ffc6--ActionEvaluationResolver__ctor_.pcode.txt)；body `52225`；code SHA-256 `f04f8ade940fe81b9221c9b0e5fdd848e213dd89eca0c6623ac31b3fb8dc2140`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [slot.py](source/slot.py) ← `D:\WF\out\q1056\rv4p\client-patch\kyubi-pf-combo\slot.py`；4,652 B；SHA-256 `a4f603b4df98843dc748ec9def90fe3e63c09a0a14569ae155a50cf80e043c6a`。
- [pcode.py](source/pcode.py) ← `D:\WF\out\q1056\rv4p\client-patch\kyubi-pf-combo\pcode.py`；5,228 B；SHA-256 `99db53ea8c6c00ab908f67535f1d6899c09253511f6b01e255cdc0fea2db675e`。
