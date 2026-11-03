# 121 已学会能力触发战斗自适应属性

- 首发层：v35b第二轮，本地离线候选。
- capability：`adaptive-element-v1`；仅登记草稿。
- 固定输入：run1/v35a.swf；方法body SHA与header均锁定。
- 提供指令构造源及最终P-code，不使用整类回编。

## 数据接口

custom_ability_string：`wfx_adaptive_1210011` = `1`；角色学会该能力才生效，战斗取slot0主位队长原属性。编成及属性限定关仍用原属性。

## 采用与验证证据

- 最终SWF SHA256：`cae0605da80b069800eef83cc252fd16263be72da77cb87c08ba694e73a9959b`。
- [完整说明](../../README.md)；[统一验收](../../verify-report.json)；[全包保持性](../../framework-report.json)。
- [统一构建入口](../../build.py)；[本组说明](../../party/notes.md)。

## 最终 P-code

- [BattleCharacterLogic/getElement](pcode/BattleCharacterLogic__getElement.pcode.txt)；ABC `boot_ffc6`；body `92412`；SHA256 `af3bd846acede1a3ace8c1ff2cc7221a3fc28cef44730ed59c9f59d998b1318f`；header `[3, 20, 6, 7]`。
- [BattleCharacterLogic/getSelfAbilitySlots](pcode/BattleCharacterLogic__getSelfAbilitySlots.pcode.txt)；ABC `boot_ffc6`；body `92379`；SHA256 `fe07e77266e1b8cbb75e501ff32bdccde1e63a875fc11516e3dde34323543f0d`；header `[3, 2, 6, 7]`。
- [BattleCharacterLogic/wfxPartyRead](pcode/BattleCharacterLogic__wfxPartyRead.pcode.txt)；ABC `boot_ffc6`；body `92618`；SHA256 `2ca6a43a5c62d35b275e3ad45c2e0f2b9fe3e7c434d11caebd2a50438055f423`；header `[2, 3, 1, 2]`。
- [BattleCharacterLogic/wfxAdaptiveElement](pcode/BattleCharacterLogic__wfxAdaptiveElement.pcode.txt)；ABC `boot_ffc6`；body `92621`；SHA256 `505bc3e60962b8ca5953cd63c3014f81ad2eec36714104cdc09431e2e857d2f1`；header `[4, 2, 1, 2]`。
- [BattleCharacterLogic/wfxAdaptiveSlots](pcode/BattleCharacterLogic__wfxAdaptiveSlots.pcode.txt)；ABC `boot_ffc6`；body `92622`；SHA256 `702e4e51f20a4a492a234646b220bad6329979c2b8b858c97ceaef2f69e79081`；header `[2, 5, 1, 2]`。

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
