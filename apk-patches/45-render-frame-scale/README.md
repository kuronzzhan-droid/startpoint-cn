# 45 角色像素按frame.scale显示

尊重逐角色frame.scale使自制角色在界面与战斗中的占屏一致

- 首发 APK 版本：**v17以前；具体编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`MemberView/<ctor>`；`PixelArtCharacterView/spriteSheetLoadCompleted`；`CharacterCellView/drawWithAdvanceFlag`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\out\q1056\rv4p\client-patch\render-scale-v1\README.md:3-24`
- `D:\WF\out\q1056\rv4p\client-patch\offline-android\base-lock.json:103-129`
- `D:\WF\apkp1016\research\v33_method_audit.json:changed_named_methods（本次最终v33内存读出，与原v28 build-report逐体比较）`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- `D:\WF\apkp1016\research\early_actual_checks.json:feature_probes（最终活指令）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [MemberView/<ctor>](pcode/boot_ffc6--MemberView__ctor_.pcode.txt)；body `60618`；code SHA-256 `bad0f9ea0fb66f638029fb96c26b2c67b9df352f43265aed6603610eaafc1b35`。
- [PixelArtCharacterView/spriteSheetLoadCompleted](pcode/boot_ffc6--PixelArtCharacterView_spriteSheetLoadCompleted.pcode.txt)；body `92300`；code SHA-256 `05389cca6b968bcc6097e3cb4054636a1ffc132cff35f500449a9c285e669317`。
- [CharacterCellView/drawWithAdvanceFlag](pcode/boot_ffc6--CharacterCellView_drawWithAdvanceFlag.pcode.txt)；body `65790`；code SHA-256 `beedce9917da57caa8d1d65576cc86ea91a18540a14cca0979e3fcd1cda03fc5`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_render_scale_apk.py](source/build_render_scale_apk.py) ← `D:\WF\out\q1056\rv4p\client-patch\render-scale-v1\build_render_scale_apk.py`；4,200 B；SHA-256 `866e18f02b8317140e7857c716d6c36f23c2426fe51e6f711af73c12eb684adb`。
- [patch_memberview_site2.py](source/patch_memberview_site2.py) ← `D:\WF\out\q1056\rv4p\client-patch\render-scale-v1\patch_memberview_site2.py`；6,877 B；SHA-256 `631d38f68cdc20952ff6540732e5d6e1fbcb76e5bc52e8824c3f3cdca70418e6`。
- [render_scale_pcode.py](source/render_scale_pcode.py) ← `D:\WF\out\q1056\rv4p\client-patch\offline-android\render_scale_pcode.py`；37,043 B；SHA-256 `7be4ae8bf89d7f505e397919d85feb9525a036d2eb0978b244775914c5985ce8`。
