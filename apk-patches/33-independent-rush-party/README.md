# 33 普通深渊EX幻想独立编队

为三类Rush活动分别保存编队并保留其它活动分类

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`cn.mod.IndependentRushParty/*`；`RushEventLoadingTask/summaryRemoteInput`；`EventRushPartyRealRemote/<ctor>`；`RushEventPartyGroupHolder/getPartyCategory`；`PartyGroupEditSceneView/refreshPartyCategory`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

AS与后续SET标题C8601修复脚本都存在。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\README.md:1-30`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [IndependentRushParty$/setEventId](pcode/cn.mod.IndependentRushParty--IndependentRushParty__setEventId.pcode.txt)；body `0`；code SHA-256 `baa6c62433e510eacee4bdb8d3cf0882235d13ab3ca4e49abc9ef2c575f6be5f`。
- [IndependentRushParty$/getEventId](pcode/cn.mod.IndependentRushParty--IndependentRushParty__getEventId.pcode.txt)；body `1`；code SHA-256 `ecc2cf8144dbd0c3fb6d0dff689064a57148cb13d49263f88dba8fac1cf0595c`。
- [IndependentRushParty$/category](pcode/cn.mod.IndependentRushParty--IndependentRushParty__category.pcode.txt)；body `2`；code SHA-256 `5cfa51adb717da8391a74dd4b004480ce83e9d1ae93d20abd196a39b2ee47184`。
- [IndependentRushParty$/<cinit>](pcode/cn.mod.IndependentRushParty--IndependentRushParty___cinit_.pcode.txt)；body `3`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [IndependentRushParty/<ctor>](pcode/cn.mod.IndependentRushParty--IndependentRushParty__ctor_.pcode.txt)；body `4`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.mod.IndependentRushParty--anonymous-method-0.pcode.txt)；body `5`；code SHA-256 `65bb9a4ab560f23ed321a6778500f5d6c01cf44a18b5b465c6229d0f316c8439`。
- [RushEventLoadingTask/summaryRemoteInput](pcode/boot_ffc6--RushEventLoadingTask_summaryRemoteInput.pcode.txt)；body `38717`；code SHA-256 `6a29188afd89a123f1009b58048b88f23516801651fdffe22098fba2ecb9f8e5`。
- [EventRushPartyRealRemote/<ctor>](pcode/boot_ffc6--EventRushPartyRealRemote__ctor_.pcode.txt)；body `48429`；code SHA-256 `6665250af7d41be817e9b39eaa2ad43b1105c04eb1a345ae6a37eb69d3a64a26`。
- [RushEventPartyGroupHolder/getPartyCategory](pcode/boot_ffc6--RushEventPartyGroupHolder_getPartyCategory.pcode.txt)；body `20866`；code SHA-256 `10161f4b71a03f945aae0ef41029ca52df18e59e40d6b942498bccbdf6773e04`。
- [PartyGroupEditSceneView/refreshPartyCategory](pcode/boot_ffc6--PartyGroupEditSceneView_refreshPartyCategory.pcode.txt)；body `77565`；code SHA-256 `52fb8029eaaee239942cbfcfdd7fee9b9c51c3b35e3007e77566c36765899a3b`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_swf.py](source/build_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\build_swf.py`；13,839 B；SHA-256 `a320ca11048be25048e4d88cf909b11c5fd95b12abea9785516c09f0b032d8e4`。
- [IndependentRushParty.as](source/IndependentRushParty.as) ← `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\src\cn\mod\IndependentRushParty.as`；605 B；SHA-256 `f08ed9ca386a322c19e3f095b87821239bad2302cc82c8a1512984db32e2d195`。
- [patch_set_edit_c8601.py](source/patch_set_edit_c8601.py) ← `D:\WF\startpoint-cn-kulo\client-patch\independent-formations\patch_set_edit_c8601.py`；6,287 B；SHA-256 `3e0c7541e1f695c8b86975263167b37bdf80c8389c4bbea8d41567ee2c6dbe12`。
