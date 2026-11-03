# 120 合击主位能力及多角色队长技开关

- 首发层：v35b第二轮，本地离线候选。
- capability：`leader-unlock-v1`；仅登记草稿。
- 固定输入：run1/v35a.swf；方法body SHA与header均锁定。
- 提供指令构造源及最终P-code，不使用整类回编。

## 数据接口

custom_ability_string：`wfx_unlock_111001` = `7`；只读取slot0主位队长的队长技编号。1=合击主位能力，2=合击队长技，4=另外两位主位队长技；可相加。

## 采用与验证证据

- 最终SWF SHA256：`cae0605da80b069800eef83cc252fd16263be72da77cb87c08ba694e73a9959b`。
- [完整说明](../../README.md)；[统一验收](../../verify-report.json)；[全包保持性](../../framework-report.json)。
- [统一构建入口](../../build.py)；[本组说明](../../party/notes.md)。

## 最终 P-code

- [BattleCharacterLogic/getOpitionAbilitiesWithoutAbilitySoul](pcode/BattleCharacterLogic__getOpitionAbilitiesWithoutAbilitySoul.pcode.txt)；ABC `boot_ffc6`；body `92390`；SHA256 `a2e15db07a25960667fa958a57813682351f347baf8f2a1afccd95c23c71be26`；header `[3, 11, 6, 7]`。
- [BattleCharacterLogic/getAvailableAbilities](pcode/BattleCharacterLogic__getAvailableAbilities.pcode.txt)；ABC `boot_ffc6`；body `92420`；SHA256 `bb0aff2057665c0a4a1463868942bdd690b665c79b0a86fc2b9fa9a12ebadaad`；header `[9, 23, 6, 7]`。
- [BattleCharacterLogic/getAvailableAbilitiesWithCond](pcode/BattleCharacterLogic__getAvailableAbilitiesWithCond.pcode.txt)；ABC `boot_ffc6`；body `92419`；SHA256 `447a94c290475756970b51e099b484dea8da1b3a8048cb37a4dfb4e50237b1be`；header `[7, 21, 6, 7]`。
- [AbilitySummarizer$/summaryAbilities](pcode/AbilitySummarizer$__summaryAbilities.pcode.txt)；ABC `boot_ffc6`；body `15140`；SHA256 `894b1ce3edc80e1d47e40a8acaa164b9081890fb920024b14c2a206eb6b10dec`；header `[8, 35, 1, 1]`。
- [BattleCharacterLogic/resolvePathCollection](pcode/BattleCharacterLogic__resolvePathCollection.pcode.txt)；ABC `boot_ffc6`；body `92329`；SHA256 `1635d24840bc0c5e81cff3730159741f783528dd20bd417838c61c60aafbd8db`；header `[7, 8, 7, 9]`。
- [BattleCharacterLogic/getInstantAbiltyCountWithoutLimit](pcode/BattleCharacterLogic__getInstantAbiltyCountWithoutLimit.pcode.txt)；ABC `boot_ffc6`；body `92403`；SHA256 `65dafd49bdcf77015670a32b60a443677a0cbf116d58c136008559756c20c307`；header `[6, 17, 6, 7]`。
- [BattleCharacterLogic/wfxPartyRead](pcode/BattleCharacterLogic__wfxPartyRead.pcode.txt)；ABC `boot_ffc6`；body `92618`；SHA256 `2ca6a43a5c62d35b275e3ad45c2e0f2b9fe3e7c434d11caebd2a50438055f423`；header `[2, 3, 1, 2]`。
- [BattleCharacterLogic/wfxPartyMask](pcode/BattleCharacterLogic__wfxPartyMask.pcode.txt)；ABC `boot_ffc6`；body `92619`；SHA256 `c7a1db19edc1938f331ceee3e029d6e22d700741a17dc5432b5451f5e95bfbda`；header `[4, 3, 1, 2]`。
- [BattleCharacterLogic/wfxPartyLeader](pcode/BattleCharacterLogic__wfxPartyLeader.pcode.txt)；ABC `boot_ffc6`；body `92620`；SHA256 `475e536059b2866e0adf74378b72bcfbbd5ee2d1b763e6e8bbd6e830c9240946`；header `[3, 3, 1, 2]`。
- [BattleCharacterLogic/wfxExtraLeaders](pcode/BattleCharacterLogic__wfxExtraLeaders.pcode.txt)；ABC `boot_ffc6`；body `92623`；SHA256 `739ab8d642fb22bf761006710b7fb1df09b8dc7a1324d5594312cfe0b110ee41`；header `[6, 5, 1, 2]`。
- [BattleCharacterLogic/wfxAddExtraLeaders](pcode/BattleCharacterLogic__wfxAddExtraLeaders.pcode.txt)；ABC `boot_ffc6`；body `92624`；SHA256 `9a40c656096f2e1d7100bb05efa45760e3fbaeea212528faecbdc65a610eb8fc`；header `[7, 12, 1, 2]`。
- [BattleCharacterLogic/wfxPreloadExtraLeaders](pcode/BattleCharacterLogic__wfxPreloadExtraLeaders.pcode.txt)；ABC `boot_ffc6`；body `92625`；SHA256 `925c9c3323f723bfe4660c880f677e74d1a1622b745034c8b602b4af415d5fc8`；header `[4, 6, 1, 2]`。

## 补丁源

source为实现目录源码快照；完整依赖与工具链在run2根目录，重放只用统一构建器。

- [adaptive.py](source/adaptive.py)；来源 `party/adaptive.py`；SHA256 `c378a035abce63627442d97d8c7bbfcc73c7076d58eff0882224e1316938877d`。
- [checks.py](source/checks.py)；来源 `party/checks.py`；SHA256 `41bc89a05d2704b5c16f84c2c10a1405afaf4f9d3dabc9e5d0e79893f1e161c3`。
- [common.py](source/common.py)；来源 `party/common.py`；SHA256 `434e9f4beccf634480ade2fc29abc4b37b7d8f11ff3178332ba1f5df06c05a60`。
- [consumers.py](source/consumers.py)；来源 `party/consumers.py`；SHA256 `ad1bef1a2d223c57dcd79f0f8a43f3cde166a98f66dd0d1a81edeef0fddebd1e`。
- [leaders.py](source/leaders.py)；来源 `party/leaders.py`；SHA256 `18fc0a83c98c5783fa851d2a34dc991bc60a4b4650a66bdbdab35de746f535db`。
- [patches.py](source/patches.py)；来源 `party/patches.py`；SHA256 `bcce0e5d4380269315b4a2ee0c679cf89677c7447915bc7b4668e7123b99ccf7`。

## 验收边界

真实方法字节码在离线解释器与受控游戏对象下验证；AIR/Android实机、联机、视觉和设备性能未核实。本任务不含联网、部署、APK、安装或签名。
