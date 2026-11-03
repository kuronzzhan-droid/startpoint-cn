# 122 溢出治疗按30帧累计转能力伤害

- 首发层：v35b第二轮，本地离线候选。
- capability：`overflow-heal-damage-v1`；仅登记草稿。
- 固定输入：run1/v35a.swf；方法body SHA与header均锁定。
- 提供指令构造源及最终P-code，不使用整类回编。

## 数据接口

`wfx:27:0:10000:0:overflow_all` = 每层溢出量×1打全体；`wfx:27:1:5000:0:overflow_nearest` = 每层×0.5打最近敌人。两模式各自累加；由治疗者当前属性按原生能力伤害流程结算。

## 采用与验证证据

- 最终SWF SHA256：`cae0605da80b069800eef83cc252fd16263be72da77cb87c08ba694e73a9959b`。
- [完整说明](../../README.md)；[统一验收](../../verify-report.json)；[全包保持性](../../framework-report.json)。
- [统一构建入口](../../build.py)；[本组说明](../../overflow/README.md)。

## 最终 P-code

- [AbilityDamageShot/finish](pcode/AbilityDamageShot__finish.pcode.txt)；ABC `boot_ffc6`；body `51320`；SHA256 `a81f8861132b7bfd9d15b54afcadb19460ed78a0129ab1eb0ce89535582b867e`；header `[108, 35, 1, 2]`。
- [MemberImpl/applyHeal](pcode/MemberImpl__applyHeal.pcode.txt)；ABC `boot_ffc6`；body `60556`；SHA256 `9b58acb942b51fea70693b9034034b7738387d27778abe3af552897b21b3425a`；header `[5, 9, 1, 2]`。
- [SquadManagerImpl/updatePhase](pcode/SquadManagerImpl__updatePhase.pcode.txt)；ABC `boot_ffc6`；body `59703`；SHA256 `b1de02513d4ce9f4ffb4db39a0449bb2bec16f15ca36019efd91ee0e09bd824c`；header `[3, 2, 1, 2]`。
- [MemberImpl$/wfxOverflowQueue](pcode/MemberImpl$__wfxOverflowQueue.pcode.txt)；ABC `boot_ffc6`；body `92626`；SHA256 `5ef67648174f42a94def393d5d27aff3d476dac757b3a0a845c20a383edd0e10`；header `[4, 6, 1, 2]`。
- [MemberImpl/wfxOverflowEmit](pcode/MemberImpl__wfxOverflowEmit.pcode.txt)；ABC `boot_ffc6`；body `92627`；SHA256 `e9f4ad9ea0ee424d8782a449f7822040091a6daa0e07a352181de9a8c78c7eb8`；header `[8, 9, 1, 2]`。
- [MemberImpl$/wfxOverflowTick](pcode/MemberImpl$__wfxOverflowTick.pcode.txt)；ABC `boot_ffc6`；body `92628`；SHA256 `9a6573b030f2c920b5a91f61cdd635b1074f68e8267d888083b1edbf08066711`；header `[4, 8, 1, 2]`。
- [MemberImpl/wfxOverflowRecord](pcode/MemberImpl__wfxOverflowRecord.pcode.txt)；ABC `boot_ffc6`；body `92629`；SHA256 `3c3616e4a128ea57582061b699d61fcaec78b8c8c344ffd8057724cdca940554`；header `[5, 11, 1, 2]`。

## 补丁源

source为实现目录源码快照；完整依赖与工具链在run2根目录，重放只用统一构建器。

- [integration.py](source/integration.py)；来源 `overflow/integration.py`；SHA256 `08f49d48df272a6a59777371e9af5113ece130923f122e537db09dfbc85f98ec`。
- [origin_review.py](source/origin_review.py)；来源 `overflow/origin_review.py`；SHA256 `9b8ec7558962f6da225c93b6cf4eddbbc7727dddaa5203ccd05765ee159b5643`。
- [patches.py](source/patches.py)；来源 `overflow/patches.py`；SHA256 `1ae1f210335940a6de888f2ad891fbe51398a21cc6f4665915650b6ee0c0ccd0`。
- [record.py](source/record.py)；来源 `overflow/record.py`；SHA256 `3c1e5efc078cba5799fd505ee9c2a8f21aade9689749c00f7fb6ebd7d7aff592`。
- [regeneration.py](source/regeneration.py)；来源 `overflow/regeneration.py`；SHA256 `45ba7d306c4f05f7ec3f881d249972f17265004c6286448cc32ddc4ac0ef35af`。
- [symbols.py](source/symbols.py)；来源 `overflow/symbols.py`；SHA256 `2272c0acfe01412c2dbb88de72f6d4369e389b636584e3bb2045a3fb86cb44b9`。
- [timing.py](source/timing.py)；来源 `overflow/timing.py`；SHA256 `6e1a6f2a72a0cf310193c86fb31cf9f12fea95e7c03fdfc7ee711507e79731e8`。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象下验证；AIR/Android实机、联机、视觉和设备性能未核实。本任务不含联网、部署、APK、安装或签名。
