# 34 常驻文件夹物品来源修复

将已解锁且开放的活动文件夹纳入物品入手来源搜索

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`ItemHowToGetQuestSearcher/getAvailableQuestLogic`；`cn.ui.ItemSourceFolderGate/*`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

AS存在。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\item-source-folders\README.md:3-18`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [ItemHowToGetQuestSearcher/getAvailableQuestLogic](pcode/boot_ffc6--ItemHowToGetQuestSearcher_getAvailableQuestLogic.pcode.txt)；body `75737`；code SHA-256 `60091e604c925ebdaf7d7cd88c020859789ee74b72514cbc8c0c6ecc52c4ced5`。
- [ItemSourceFolderGate$/allow](pcode/cn.ui.ItemSourceFolderGate--ItemSourceFolderGate__allow.pcode.txt)；body `0`；code SHA-256 `9753dbaa99f15f5a9178818b3c31a1bbd69cb510b3cc846f0b3bb9170b570d2a`。
- [ItemSourceFolderGate$/<cinit>](pcode/cn.ui.ItemSourceFolderGate--ItemSourceFolderGate___cinit_.pcode.txt)；body `1`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [ItemSourceFolderGate/<ctor>](pcode/cn.ui.ItemSourceFolderGate--ItemSourceFolderGate__ctor_.pcode.txt)；body `2`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.ui.ItemSourceFolderGate--anonymous-method-0.pcode.txt)；body `3`；code SHA-256 `154e49820801a489ebb2388ddc5ccde375319ed31d03924bd1b21cc90e4181e1`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_swf.py](source/patch_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\item-source-folders\patch_swf.py`；4,136 B；SHA-256 `2a6bde5c58cba5f74b77f1937a4b16a7eafd95922739d93044feb58d520901f6`。
- [ItemSourceFolderGate.as](source/ItemSourceFolderGate.as) ← `D:\WF\startpoint-cn-kulo\client-patch\item-source-folders\src\cn\ui\ItemSourceFolderGate.as`；825 B；SHA-256 `d44e74be2687309fe4638f9f7ad52fb53f58c1b5d46ae76827be12179777d6d9`。
