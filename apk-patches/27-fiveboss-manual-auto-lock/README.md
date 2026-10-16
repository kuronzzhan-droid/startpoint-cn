# 27 五重联机手动开局 Auto 锁及暂停状态

仅对联机 1099001–1099003，在手动开局后禁止切到自动，并在暂停菜单显示同一锁状态。

- 首发 APK 版本：**v17 以前，最早 APK 版本未核实（已确认 v17 存在且最终 v33 保留）**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`BattleScene.preparation/changeAutoplayMode、BattlePauseMenu.prepare、fiveBossManualAutoLock 实例槽`。
- 修的问题或错误码：需要维持手动开局模式，避免战斗按钮与暂停菜单的锁状态不一致。
- 依赖：BattleScene.fiveBossManualAutoLock 新增实例槽
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\README.md:40-43；最终范围`
- `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\build_swf.py:246-285；定点插入锁初始化、切换守门与暂停菜单`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [BattleScene/preparation](pcode/boot_ffc6--BattleScene_preparation.pcode.txt)；body `28963`；code SHA-256 `45b02faa310bc154d58ce2e1faf3271204c39e9ce5d67b174d1c1c717ff4c160`。
- [BattleScene/changeAutoplayMode](pcode/boot_ffc6--BattleScene_changeAutoplayMode.pcode.txt)；body `29002`；code SHA-256 `b73d7228d948edd41a830651a7c8a835fa13b2c0f73142ae61b9dcd976c86e3c`。
- [BattlePauseMenu/prepare](pcode/boot_ffc6--BattlePauseMenu_prepare.pcode.txt)；body `32286`；code SHA-256 `22967194267098e2e0b666eb95c149e133a9cdd44a46866bf6efe61227904334`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_swf.py](source/build_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\build_swf.py`；21,318 B；SHA-256 `fda30d7f435f8d0a9c0ab6a2a09cde1178014d65c25f8eae0b8163151736d4f4`。
- [method-plan.json](source/method-plan.json) ← `D:\WF\startpoint-cn-kulo\client-patch\lens0907-0908\method-plan.json`；12,882 B；SHA-256 `8e726176d9273f1c85573fe0cdcc0ff4246c6110c7cd7f248daad79a997cbf40`。
