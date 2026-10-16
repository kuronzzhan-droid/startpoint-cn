# 25 幻想连战多人结算及房间返回

识别幻想连战多人阶段边界，衔接奖励结算、重试、结束、房主解散、访客退出与场景返回。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`RushEventClearRewardDialog、QuestResultScene、MultiBattleRoomScene、CooperationRoomSocketContact、QuestAbortTransitionRouter`。
- 修的问题或错误码：普通单人 Rush 的推进/返回流程不能直接覆盖幻想多人边界；最终存在独立 boundary/continue 判定与 disband 状态。
- 依赖：fantasy-rush-multi-routing；mode15FantasyDisband 字段与新增 boundary/continue helpers
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

Android 原始重建脚本未找到；最终 v33 精确方法和 P-code 可收。iOS 2026-09-16 的 C2120/G1002 修复不能当成 Android 本条错误码或首发版本。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\account-takeover\README.md:51-61；Android 已有结算返回、后继保留`
- `D:\WF\startpoint-cn-kulo\client-patch\ios-five-in-one\README.md:8-10；阶段边界与房主/访客返回用途交叉来源`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [RushEventClearRewardDialog/isFantasyRushMultiBoundary](pcode/boot_ffc6--RushEventClearRewardDialog_isFantasyRushMultiBoundary.pcode.txt)；body `92027`；code SHA-256 `b7cfdf3e1f68a165c20fd9489fdd79ba38d2e6842381591d9b6fedfb2632bac6`。
- [RushEventClearRewardDialog/prepare](pcode/boot_ffc6--RushEventClearRewardDialog_prepare.pcode.txt)；body `92020`；code SHA-256 `5d7d494c8e26583e4cd57fd9f4f697e75ed844f007d8f5eceb9b7347945c51dd`。
- [RushEventClearRewardDialog/completeAnimation](pcode/boot_ffc6--RushEventClearRewardDialog_completeAnimation.pcode.txt)；body `92028`；code SHA-256 `7170673e44810492c9e71df0b37a2e0d449aeaf07449196cb27efc8037627159`。
- [RushEventClearRewardDialog/buttonClicked](pcode/boot_ffc6--RushEventClearRewardDialog_buttonClicked.pcode.txt)；body `92029`；code SHA-256 `79b8a9a2bd998dfc8d1cac0d70de095f1a1f93501f81e1213d392be727743897`。
- [MultiBattleRoomScene/releaseOpenMultiRoom](pcode/boot_ffc6--MultiBattleRoomScene_releaseOpenMultiRoom.pcode.txt)；body `92123`；code SHA-256 `d5b821ff85589b2c487578c9c78fcfb994ccc9c2f30123cd40c63d826a2d0bec`。
- [MultiBattleRoomScene/BackChangeSceneHandler](pcode/boot_ffc6--MultiBattleRoomScene_BackChangeSceneHandler.pcode.txt)；body `92170`；code SHA-256 `aaa3efba659d97818783b8c4ddc315cf0e5be1b6736ace521719074797f9d512`。
- [CooperationRoomSocketContact/disband](pcode/boot_ffc6--CooperationRoomSocketContact_disband.pcode.txt)；body `92201`；code SHA-256 `c7935d4a4e56433f8786272af58181783f59809b2c3bec13f04ddc8d26d14333`。
- [CooperationRoomSocketContact/applyDisbanded](pcode/boot_ffc6--CooperationRoomSocketContact_applyDisbanded.pcode.txt)；body `92204`；code SHA-256 `df4212688f576811207ec47b4ccb6092b71a8f7ed5ede87d49cfaaedfe7e9099`。
- [CooperationRoomSocketContact/<ctor>](pcode/boot_ffc6--CooperationRoomSocketContact__ctor_.pcode.txt)；body `92207`；code SHA-256 `fe543cc8ab0437439839e6f8279fd128b6804febde07c7ad95e349cfb7bd2ea0`。
- [QuestResultScene/isFantasyRushMultiContinue](pcode/boot_ffc6--QuestResultScene_isFantasyRushMultiContinue.pcode.txt)；body `92218`；code SHA-256 `00bfca84e55d28ddce405e043f1535340d82b46abab71cc0fca61741306902bd`。
- [QuestResultScene/retryQuest](pcode/boot_ffc6--QuestResultScene_retryQuest.pcode.txt)；body `92220`；code SHA-256 `f7bae59bbdb490df9ca1b5f6df7800efa170c1b6d85d7fef3c7732591a8f59df`。
- [QuestResultScene/finishQuestResult](pcode/boot_ffc6--QuestResultScene_finishQuestResult.pcode.txt)；body `92253`；code SHA-256 `b144c1e4dfd056de5a80ca59dc0cdbef7371379d18e199a8dd891b9952dfd1ac`。
- [QuestAbortTransitionRouter/resolve](pcode/boot_ffc6--QuestAbortTransitionRouter_resolve.pcode.txt)；body `92268`；code SHA-256 `4c6a45128864164527a3c5d004034ba4251b75611a0731df4ee325077be6cbe5`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

