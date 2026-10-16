# 24 幻想连战多人阶段准入与战斗路由

为幻想连战 300098001–300098003 阶段提供活动可见/选择、直达多人战斗以及房间准备路由。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`AdventEventQuestLogic、BossBattleModeSelectScene、SingleQuestStartFlow、PartySelectScene、RushEventQuestSelectScene、MultiBattleRoomPrepareFlow`。
- 修的问题或错误码：幻想连战第5/10/15阶段需要走多人房间与战斗流程，并保持相关解锁/准入分支。
- 依赖：幻想连战阶段/事件数据；对应多人协议
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

Android 最初制作脚本未在现存 client-patch 文本源中找到；F:/codex 原输出路径当前不存在。收最终 v33 方法 P-code；不可声称已有可从官方底包一键重建的完整脚本。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:51-61；Android V51 已有幻想活动路由/战斗门控并受后继方法保护`
- `D:\WF\startpoint-cn-kulo\client-patch\ios-five-in-one\README.md:8-10；跨端文档描述第5/10/15阶段房主/访客流程，仅作用途交叉来源`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [AdventEventQuestLogic/isViewable](pcode/boot_ffc6--AdventEventQuestLogic_isViewable.pcode.txt)；body `91897`；code SHA-256 `8798d2e905f224a0af773692342b2e40a8c869bad76520b7aec0ab605b47a9d4`。
- [AdventEventQuestLogic/isSelectable](pcode/boot_ffc6--AdventEventQuestLogic_isSelectable.pcode.txt)；body `91898`；code SHA-256 `fa30506f61f35800ca78a3c9070406adf9322ea7df3e5f06d4476a8f096bca7b`。
- [AdventEventQuestLogic/isRequiredHostClearFromOtherQuest](pcode/boot_ffc6--AdventEventQuestLogic_isRequiredHostClearFromOtherQuest.pcode.txt)；body `91899`；code SHA-256 `93d440800eca6bf9d9281c98dbfb1132f2e4853bb124b1b73b8c292e75846765`。
- [BossBattleModeSelectScene/prepareScene](pcode/boot_ffc6--BossBattleModeSelectScene_prepareScene.pcode.txt)；body `91926`；code SHA-256 `a68d3be29d63c16ea97129b04e080ce9b56c9d50fa5aaa8210839c92cf58afcf`。
- [BossBattleModeSelectScene/isFantasyRushBossQuest](pcode/boot_ffc6--BossBattleModeSelectScene_isFantasyRushBossQuest.pcode.txt)；body `91927`；code SHA-256 `498f61fe586f70bf4169bd100373135748e0cde9de7b03148d9a1d8c10c89848`。
- [BossBattleModeSelectScene/startFantasyRushMultiBattle](pcode/boot_ffc6--BossBattleModeSelectScene_startFantasyRushMultiBattle.pcode.txt)；body `91928`；code SHA-256 `f6034f2437ce5ea49cf919a4f5e89d3bd1cf4dbe24ed66056f4c437379119284`。
- [SingleQuestStartFlow/start](pcode/boot_ffc6--SingleQuestStartFlow_start.pcode.txt)；body `91951`；code SHA-256 `bcba39e333edb74276821d1b37ba89eed26e6e6378daccf5e39634be6b621525`。
- [PartySelectScene/run](pcode/boot_ffc6--PartySelectScene_run.pcode.txt)；body `91975`；code SHA-256 `e7e852be6d1763117e4a1adf4be9d4a9d7fe043789525c650fa23e1d1a0f5570`。
- [RushEventQuestSelectScene/startQuest](pcode/boot_ffc6--RushEventQuestSelectScene_startQuest.pcode.txt)；body `92050`；code SHA-256 `a48f031b6b87320a16c11ebf44194036dfdaa13310e1d7ce42591bbcc0f27100`。
- [RushEventQuestSelectScene/selectQuest](pcode/boot_ffc6--RushEventQuestSelectScene_selectQuest.pcode.txt)；body `92051`；code SHA-256 `4caa158cb310699932c3b816cab07537c0a80e7ce6610c861c77458bd832d912`。
- [MultiBattleRoomPrepareFlow/sceneChangeToRoom](pcode/boot_ffc6--MultiBattleRoomPrepareFlow_sceneChangeToRoom.pcode.txt)；body `92034`；code SHA-256 `a366ee6fae39650e5796c50eb9260f9897ad11f410fabaf60958310c3a857124`。
- [MultiBattleRoomPrepareFlow/createRoomNotFoundDialog](pcode/boot_ffc6--MultiBattleRoomPrepareFlow_createRoomNotFoundDialog.pcode.txt)；body `92040`；code SHA-256 `46614ab0ff0cc8024bcd42740c25a87edd36a84c07474e629d1f8cbf5fb45c23`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

