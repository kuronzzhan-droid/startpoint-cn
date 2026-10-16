# 29 5900101 禁五星铁钢替代觉醒材料

对五重武器 5900101 返回无可替代觉醒结晶，防止用五星铁钢跳过专用材料。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`OwnedEquipmentLogic.getUseableAwakingCrystal`。
- 修的问题或错误码：5900101 不应接受五星铁钢替代；其他武器原有替代规则保留。
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:11-15；单方法最终限制`
- `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\fix_weapon_steel.py:20-38；5900101 返回 Option.None 分支`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [OwnedEquipmentLogic/getUseableAwakingCrystal](pcode/boot_ffc6--OwnedEquipmentLogic_getUseableAwakingCrystal.pcode.txt)；body `19690`；code SHA-256 `fe1599d83a31b5229bbe7532248035500177e33b63f889aa66c72f15979f722f`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [fix_weapon_steel.py](source/fix_weapon_steel.py) ← `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\fix_weapon_steel.py`；3,376 B；SHA-256 `4cec70e13a0f98ee5d6f123559d6439f7ff69ca498251a326c738871ad61ac4e`。
- [package_steel_fix.py](source/package_steel_fix.py) ← `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\package_steel_fix.py`；4,296 B；SHA-256 `2d3911d4c7bb4291d198acaa3cccfa4316307ff44892405ae7f2806a1878c247`。
