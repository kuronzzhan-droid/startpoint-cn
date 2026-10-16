# 44 关卡属性耐性入口

读取关卡 sub_name 的属性伤害配置并附加原生耐性条件

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattleQuestBaseImpl/getInitialEnemyConditions`；`cn.rules.QuestElementResistance/*`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

关卡配置属性耐性helper。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\quest-element-resistance\README.md:14-18`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattleQuestBaseImpl/getInitialEnemyConditions](pcode/boot_ffc6--BattleQuestBaseImpl_getInitialEnemyConditions.pcode.txt)；body `21496`；code SHA-256 `36116b39b8e406997d649d04c5d127c9cddca89c2ec6a848fbb8dfdd647e3416`。
- [QuestElementResistance$/parse](pcode/cn.rules.QuestElementResistance--QuestElementResistance__parse.pcode.txt)；body `0`；code SHA-256 `17f628f2111e65e0857c51fc837669a933be8ec2557ef2a85ef19c6ddf91cd7d`。
- [QuestElementResistance$/apply](pcode/cn.rules.QuestElementResistance--QuestElementResistance__apply.pcode.txt)；body `1`；code SHA-256 `ef924e6c2b73679d06650fb71f9159ca0ce2372d2485195abc6c24c682341bc8`。
- [QuestElementResistance$/<cinit>](pcode/cn.rules.QuestElementResistance--QuestElementResistance___cinit_.pcode.txt)；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [QuestElementResistance/<ctor>](pcode/cn.rules.QuestElementResistance--QuestElementResistance__ctor_.pcode.txt)；body `3`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.rules.QuestElementResistance--anonymous-method-0.pcode.txt)；body `4`；code SHA-256 `65bb9a4ab560f23ed321a6778500f5d6c01cf44a18b5b465c6229d0f316c8439`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_channel.py](source/build_channel.py) ← `D:\WF\startpoint-cn-kulo\client-patch\quest-element-resistance\build_channel.py`；8,912 B；SHA-256 `cb8a0924973ffed5f98827a0101263c49e70c3210c124f84957989560ab5adf4`。
- [build_apk.py](source/build_apk.py) ← `D:\WF\startpoint-cn-kulo\client-patch\quest-element-resistance\build_apk.py`；3,231 B；SHA-256 `c6880a3888bd457e901e1ae0a02cb2ef1d91d2accca33419020ee4adba217b36`。
- [QuestElementResistance.as](source/QuestElementResistance.as) ← `D:\WF\startpoint-cn-kulo\client-patch\quest-element-resistance\src\cn\rules\QuestElementResistance.as`；4,070 B；SHA-256 `bf51cfb283cc746cd695937626bcd757f91d6678219d62605f3d84b46a78f86c`。
