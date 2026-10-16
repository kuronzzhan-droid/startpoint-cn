# 38 编队切换空引用修复

先初始化目标队伍再绑定触摸，空角色格触摸安全返回

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`PartyCarousel/changeIndex`；`CharacterCellButtonProcessor/beginTouch`。
- 修的问题或错误码：F1009：切队名称或beginTouch空引用
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\party-carousel-f1009\README.md:9-18`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [PartyCarousel/changeIndex](pcode/boot_ffc6--PartyCarousel_changeIndex.pcode.txt)；body `66403`；code SHA-256 `fbba333b70b8b6517019079caab12747dc06915491f3f54891e8a8b86946fe43`。
- [CharacterCellButtonProcessor/beginTouch](pcode/boot_ffc6--CharacterCellButtonProcessor_beginTouch.pcode.txt)；body `65893`；code SHA-256 `d304073b7f4d0970b3ebfab1248525861b3257da086f76b6e08e72401f9c4220`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_swf.py](source/patch_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\party-carousel-f1009\patch_swf.py`；4,085 B；SHA-256 `1e25e83a7abb21dc9fdcc4281adbf77a1e9c385d97138bf7c6158ec2778d8a05`。
- [build_apk.py](source/build_apk.py) ← `D:\WF\startpoint-cn-kulo\client-patch\party-carousel-f1009\build_apk.py`；6,122 B；SHA-256 `ad0dc11705e401f81dcccbdcdf42a7a47eaecdd4e5af5e124b4b1069efd19522`。
